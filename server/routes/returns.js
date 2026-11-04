const express = require("express");
const { z } = require("zod");
const pool = require("../database/pool");
const validate = require("../middleware/validate");
const { requireAuth, requireMaster } = require("../middleware/auth");
const { pagination, metadata } = require("../utils/pagination");
const { queueEmailProcessing } = require("../services/email-worker");

const router = express.Router();
const createSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1).max(999),
      }),
    )
    .min(1)
    .max(50),
});
const cancelSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  confirmed: z.literal(true),
});
const receiveSchema = z.object({ confirmed: z.literal(true) });

async function notify(client, group, title, message, recipients) {
  const notification = await client.query(
    "INSERT INTO notifications(title,message,link) VALUES($1,$2,'/html/pedidos.html?tab=returns') RETURNING id",
    [title, message],
  );
  if (recipients === "MASTER")
    await client.query(
      `INSERT INTO notification_recipients(notification_id,user_id)
       SELECT $1,u.id FROM users u JOIN units un ON un.id=u.unit_id
       WHERE u.active AND u.deleted_at IS NULL AND u.role='MASTER' AND un.code='MATRIZ'`,
      [notification.rows[0].id],
    );
  else if (recipients === "UNIT")
    await client.query(
      `INSERT INTO notification_recipients(notification_id,user_id)
       SELECT $1,id FROM users WHERE active AND deleted_at IS NULL AND unit_id=$2`,
      [notification.rows[0].id, group.unit_id],
    );
  else
    await client.query(
      `INSERT INTO notification_recipients(notification_id,user_id)
       SELECT DISTINCT $1::uuid,u.id FROM users u JOIN units un ON un.id=u.unit_id
       WHERE u.active AND u.deleted_at IS NULL AND (u.unit_id=$2 OR (u.role='MASTER' AND un.code='MATRIZ'))`,
      [notification.rows[0].id, group.unit_id],
    );
}

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const master = req.session.user.role === "MASTER";
    const { page, limit, offset } = pagination(req.query, 15);
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();
    const params = [master, req.session.user.unitId, search, status];
    const where = `WHERE ($1::boolean OR g.unit_id=$2) AND ($3='' OR p.name ILIKE '%'||$3||'%' OR u.name ILIKE '%'||$3||'%' OR g.return_number::text=$3) AND ($4='' OR g.status=$4)`;
    const [result, count] = await Promise.all([
      pool.query(
        `SELECT g.id,g.return_number,g.reason,g.status,g.cancellation_reason,g.created_at,g.cancelled_at,g.received_at,
          u.id AS unit_id,u.name AS unit_name,usr.name AS requested_by_name,
          COALESCE(json_agg(json_build_object('id',ri.id,'productId',p.id,'productName',p.name,'model',p.model,'quantity',ri.quantity) ORDER BY p.name),'[]') AS items
         FROM unit_return_groups g JOIN unit_return_items ri ON ri.return_group_id=g.id
         JOIN products p ON p.id=ri.product_id JOIN units u ON u.id=g.unit_id JOIN users usr ON usr.id=g.requested_by
         ${where} GROUP BY g.id,u.id,u.name,usr.name ORDER BY g.created_at DESC LIMIT $5 OFFSET $6`,
        [...params, limit, offset],
      ),
      pool.query(
        `SELECT count(DISTINCT g.id)::int AS total FROM unit_return_groups g JOIN unit_return_items ri ON ri.return_group_id=g.id JOIN products p ON p.id=ri.product_id JOIN units u ON u.id=g.unit_id ${where}`,
        params,
      ),
    ]);
    res.json({
      returns: result.rows,
      permissions: {
        canReceive: master,
        canCancel: true,
      },
      pagination: metadata(count.rows[0].total, page, limit),
    });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/",
  requireAuth,
  validate(createSchema),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const unit = await client.query(
        "SELECT id,name,code FROM units WHERE id=$1 AND active AND deleted_at IS NULL FOR UPDATE",
        [req.session.user.unitId],
      );
      if (!unit.rowCount || unit.rows[0].code === "MATRIZ")
        throw Object.assign(
          new Error("A Matriz não pode abrir uma devolução para ela mesma."),
          { status: 400 },
        );
      const ids = req.validatedBody.items.map((item) => item.productId);
      if (new Set(ids).size !== ids.length)
        throw Object.assign(new Error("Há itens repetidos na devolução."), {
          status: 400,
        });
      const stock = await client.query(
        `SELECT p.id,p.name,i.quantity::int FROM products p JOIN inventory i ON i.product_id=p.id AND i.unit_id=$1
       WHERE p.id=ANY($2::uuid[]) AND p.deleted_at IS NULL ORDER BY p.id FOR UPDATE OF i`,
        [unit.rows[0].id, ids],
      );
      if (stock.rowCount !== ids.length)
        throw Object.assign(
          new Error("Um dos itens não está disponível na sua unidade."),
          {
            status: 409,
          },
        );
      const balances = new Map(stock.rows.map((item) => [item.id, item]));
      for (const item of req.validatedBody.items) {
        const current = balances.get(item.productId);
        if (item.quantity > current.quantity)
          throw Object.assign(
            new Error(
              `${current.name}: o saldo disponível é ${current.quantity}.`,
            ),
            { status: 409 },
          );
      }
      const group = await client.query(
        `INSERT INTO unit_return_groups(unit_id,requested_by,reason) VALUES($1,$2,$3)
       RETURNING id,return_number,unit_id`,
        [unit.rows[0].id, req.session.user.id, req.validatedBody.reason],
      );
      for (const item of req.validatedBody.items)
        await client.query(
          "INSERT INTO unit_return_items(return_group_id,product_id,quantity) VALUES($1,$2,$3)",
          [group.rows[0].id, item.productId, item.quantity],
        );
      const list = req.validatedBody.items
        .map(
          (item) => `- ${item.quantity}x ${balances.get(item.productId).name}`,
        )
        .join("\n");
      await notify(
        client,
        group.rows[0],
        "Nova devolução",
        `${req.session.user.name} enviou a devolução #${group.rows[0].return_number} da unidade ${unit.rows[0].name}.`,
        "MASTER",
      );
      await client.query(
        `INSERT INTO email_outbox(recipient,subject,body)
         SELECT DISTINCT u.email,$1,$2 FROM users u JOIN units un ON un.id=u.unit_id
         WHERE u.active AND u.deleted_at IS NULL AND u.role='MASTER'
           AND un.code='MATRIZ' AND u.email IS NOT NULL`,
        [
          `Nova devolução #${group.rows[0].return_number} — ${unit.rows[0].name}`,
          `${req.session.user.name} solicitou a devolução dos seguintes itens da unidade ${unit.rows[0].name}:\n\n${list}\n\nMotivo: ${req.validatedBody.reason}`,
        ],
      );
      await client.query("COMMIT");
      queueEmailProcessing();
      res.status(201).json({ return: group.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      next(error);
    } finally {
      client.release();
    }
  },
);

router.post(
  "/:id/cancel",
  requireAuth,
  validate(cancelSchema),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT * FROM unit_return_groups WHERE id=$1 FOR UPDATE",
        [req.params.id],
      );
      if (!result.rowCount)
        throw Object.assign(new Error("Devolução não encontrada."), {
          status: 404,
        });
      const group = result.rows[0];
      if (group.status !== "SOLICITADO")
        throw Object.assign(
          new Error("Somente devoluções pendentes podem ser canceladas."),
          { status: 409 },
        );
      if (
        req.session.user.role !== "MASTER" &&
        group.unit_id !== req.session.user.unitId
      )
        throw Object.assign(
          new Error("Você não pode cancelar a devolução de outra unidade."),
          { status: 403 },
        );
      await client.query(
        `UPDATE unit_return_groups SET status='CANCELADO',cancellation_reason=$2,cancelled_by=$3,cancelled_at=now(),updated_at=now() WHERE id=$1`,
        [group.id, req.validatedBody.reason, req.session.user.id],
      );
      await notify(
        client,
        group,
        "Devolução cancelada",
        `A devolução #${group.return_number} foi cancelada.`,
        "BOTH",
      );
      await client.query(
        `INSERT INTO email_outbox(recipient,subject,body)
         SELECT DISTINCT u.email,$1::varchar,$2::varchar FROM users u JOIN units un ON un.id=u.unit_id
         WHERE u.active AND u.deleted_at IS NULL AND u.email IS NOT NULL
           AND (u.unit_id=$3 OR (u.role='MASTER' AND un.code='MATRIZ'))`,
        [
          `Devolução #${group.return_number} cancelada`,
          `A devolução #${group.return_number} foi cancelada. Motivo: ${req.validatedBody.reason}`,
          group.unit_id,
        ],
      );
      await client.query("COMMIT");
      queueEmailProcessing();
      res.json({ status: "CANCELADO" });
    } catch (error) {
      await client.query("ROLLBACK");
      next(error);
    } finally {
      client.release();
    }
  },
);

router.post(
  "/:id/receive",
  requireAuth,
  requireMaster,
  validate(receiveSchema),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `SELECT g.*,u.name AS unit_name FROM unit_return_groups g JOIN units u ON u.id=g.unit_id WHERE g.id=$1 FOR UPDATE`,
        [req.params.id],
      );
      if (!result.rowCount)
        throw Object.assign(new Error("Devolução não encontrada."), {
          status: 404,
        });
      const group = result.rows[0];
      if (group.status !== "SOLICITADO")
        throw Object.assign(new Error("Esta devolução já foi finalizada."), {
          status: 409,
        });
      const matrix = (
        await client.query(
          "SELECT id FROM units WHERE code='MATRIZ' AND active AND deleted_at IS NULL",
        )
      ).rows[0];
      const items = await client.query(
        `SELECT ri.product_id,ri.quantity::int,p.name FROM unit_return_items ri JOIN products p ON p.id=ri.product_id
         WHERE ri.return_group_id=$1 ORDER BY ri.product_id`,
        [group.id],
      );
      for (const item of items.rows) {
        await client.query(
          "INSERT INTO inventory(product_id,unit_id,quantity) VALUES($1,$2,0) ON CONFLICT DO NOTHING",
          [item.product_id, matrix.id],
        );
        const balances = await client.query(
          `SELECT unit_id,quantity::int FROM inventory WHERE product_id=$1 AND unit_id=ANY($2::uuid[]) ORDER BY unit_id FOR UPDATE`,
          [item.product_id, [group.unit_id, matrix.id]],
        );
        const byUnit = new Map(
          balances.rows.map((row) => [row.unit_id, row.quantity]),
        );
        const unitBefore = byUnit.get(group.unit_id) || 0;
        const matrixBefore = byUnit.get(matrix.id) || 0;
        if (unitBefore < item.quantity)
          throw Object.assign(
            new Error(`${item.name}: saldo atual da unidade é ${unitBefore}.`),
            { status: 409 },
          );
        if (matrixBefore + item.quantity > 999)
          throw Object.assign(
            new Error(`${item.name}: o saldo da Matriz ultrapassaria 999.`),
            { status: 409 },
          );
        await client.query(
          `UPDATE inventory SET quantity=CASE WHEN unit_id=$2 THEN $4::smallint ELSE $5::smallint END,updated_at=now()
           WHERE product_id=$1 AND unit_id=ANY($3::uuid[])`,
          [
            item.product_id,
            group.unit_id,
            [group.unit_id, matrix.id],
            unitBefore - item.quantity,
            matrixBefore + item.quantity,
          ],
        );
        for (const movement of [
          [group.unit_id, "SAIDA", unitBefore, unitBefore - item.quantity],
          [matrix.id, "ENTRADA", matrixBefore, matrixBefore + item.quantity],
        ])
          await client.query(
            `INSERT INTO inventory_movements(product_id,unit_id,performed_by,kind,quantity,quantity_before,quantity_after,note)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              item.product_id,
              movement[0],
              req.session.user.id,
              movement[1],
              item.quantity,
              movement[2],
              movement[3],
              `DEVOLUÇÃO #${group.return_number}`,
            ],
          );
      }
      await client.query(
        `UPDATE unit_return_groups SET status='RECEBIDO',received_by=$2,received_at=now(),updated_at=now() WHERE id=$1`,
        [group.id, req.session.user.id],
      );
      await notify(
        client,
        group,
        "Devolução recebida",
        `A devolução #${group.return_number} foi recebida pela Matriz.`,
        "UNIT",
      );
      await client.query(
        `INSERT INTO email_outbox(recipient,subject,body)
         SELECT email,$1,$2 FROM users WHERE active AND deleted_at IS NULL AND unit_id=$3 AND email IS NOT NULL`,
        [
          `Devolução #${group.return_number} recebida`,
          `A devolução #${group.return_number} da unidade ${group.unit_name} foi recebida pela Matriz e os estoques foram atualizados.`,
          group.unit_id,
        ],
      );
      await client.query("COMMIT");
      queueEmailProcessing();
      res.json({ status: "RECEBIDO" });
    } catch (error) {
      await client.query("ROLLBACK");
      next(error);
    } finally {
      client.release();
    }
  },
);

module.exports = router;
