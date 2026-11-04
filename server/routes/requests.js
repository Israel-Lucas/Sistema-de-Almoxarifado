const express = require("express");
const { z } = require("zod");
const pool = require("../database/pool");
const validate = require("../middleware/validate");
const { requireAuth, requireMaster } = require("../middleware/auth");
const { pagination, metadata } = require("../utils/pagination");
const { queueEmailProcessing } = require("../services/email-worker");

const router = express.Router();
const batchSchema = z.object({
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
const batchDecisionSchema = z.object({
  confirmed: z.literal(true),
  items: z
    .array(
      z.object({
        requestId: z.string().uuid(),
        decision: z.enum(["APPROVE", "PARTIAL", "REJECT"]),
        approvedQuantity: z.number().int().min(1).max(999).optional(),
        note: z.string().trim().max(500).optional().default(""),
      }),
    )
    .min(1),
});
const equipmentSetRequestSchema = z.object({
  setId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
  optionalComponentIds: z.array(z.string().uuid()).max(30).default([]),
  reason: z.string().trim().min(1).max(500),
});
async function notifyGroup(client, group, title, message, emailBody = null) {
  const notification = await client.query(
    "INSERT INTO notifications(title,message,link,request_id) VALUES($1,$2,'/html/pedidos.html',$3) RETURNING id",
    [title, message, group.first_request_id || null],
  );
  await client.query(
    `INSERT INTO notification_recipients(notification_id,user_id)
     SELECT DISTINCT $1::uuid,u.id FROM users u JOIN units un ON un.id=u.unit_id
     WHERE u.active AND u.deleted_at IS NULL AND (u.unit_id=$2 OR (u.role='MASTER' AND un.code='MATRIZ'))`,
    [notification.rows[0].id, group.unit_id],
  );
  if (emailBody)
    await client.query(
      `INSERT INTO email_outbox(recipient,subject,body)
       SELECT DISTINCT u.email,$1,$2 FROM users u JOIN units un ON un.id=u.unit_id
       WHERE u.active AND u.deleted_at IS NULL AND u.role='MASTER'
         AND un.code='MATRIZ' AND u.email IS NOT NULL`,
      [`Solicitação de itens para ${group.unit_name}`, emailBody],
    );
}

router.get("/v2", requireAuth, async (req, res, next) => {
  try {
    const isMaster = req.session.user.role === "MASTER";
    const { page, limit, offset } = pagination(req.query, 15);
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();
    const params = [isMaster, req.session.user.unitId, search, status];
    const where = `WHERE ($1::boolean OR g.unit_id=$2) AND ($3='' OR u.name ILIKE '%'||$3||'%' OR EXISTS(SELECT 1 FROM requests rx JOIN products px ON px.id=rx.product_id WHERE rx.group_id=g.id AND px.name ILIKE '%'||$3||'%')) AND ($4='' OR g.status=$4)`;
    const [groups, count] = await Promise.all([
      pool.query(
        `SELECT g.*,u.name AS unit_name,ru.name AS requested_by_name,es.name AS equipment_set_name,
          COALESCE(json_agg(json_build_object('id',r.id,'productId',p.id,'productName',p.name,'model',p.model,'requestedQuantity',r.requested_quantity,'approvedQuantity',r.approved_quantity,'status',r.status,'deliveryStatus',r.delivery_status,'note',r.decision_note) ORDER BY p.name) FILTER (WHERE r.id IS NOT NULL),'[]') AS items
         FROM request_groups g JOIN units u ON u.id=g.unit_id JOIN users ru ON ru.id=g.requested_by LEFT JOIN equipment_sets es ON es.id=g.equipment_set_id
         LEFT JOIN requests r ON r.group_id=g.id LEFT JOIN products p ON p.id=r.product_id
         ${where} GROUP BY g.id,u.name,ru.name,es.name ORDER BY g.created_at DESC,g.id DESC LIMIT $5 OFFSET $6`,
        [...params, limit, offset],
      ),
      pool.query(
        `SELECT count(*)::int AS total FROM request_groups g JOIN units u ON u.id=g.unit_id ${where}`,
        params,
      ),
    ]);
    res.json({
      orders: groups.rows,
      pagination: metadata(count.rows[0].total, page, limit),
    });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/batch",
  requireAuth,
  validate(batchSchema),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      const unit = await client.query(
        "SELECT name FROM units WHERE id=$1 AND active AND deleted_at IS NULL",
        [req.session.user.unitId],
      );
      if (!unit.rowCount)
        return res.status(409).json({
          error: "INVALID_UNIT",
          message: "A unidade do usuário está indisponível.",
        });
      const unitCode = await client.query(
        "SELECT code FROM units WHERE id=$1",
        [req.session.user.unitId],
      );
      if (unitCode.rows[0]?.code === "MATRIZ")
        return res.status(409).json({
          error: "MATRIX_IS_WAREHOUSE",
          message:
            "A Matriz representa o estoque do almoxarifado e não pode receber solicitações.",
        });
      const unique = new Map();
      for (const item of req.validatedBody.items) {
        if (unique.has(item.productId))
          return res.status(400).json({
            error: "DUPLICATE_PRODUCT",
            message: "O mesmo item não pode aparecer duas vezes no pedido.",
          });
        unique.set(item.productId, item.quantity);
      }
      await client.query("BEGIN");
      const ids = [...unique.keys()].sort();
      const available = await client.query(
        `SELECT p.id,p.name,COALESCE(i.quantity,0)::int AS quantity FROM products p
       JOIN product_types pt ON pt.id=p.type_id AND pt.active AND pt.deleted_at IS NULL
       JOIN units m ON m.code='MATRIZ' AND m.active AND m.deleted_at IS NULL
       LEFT JOIN inventory i ON i.product_id=p.id AND i.unit_id=m.id
       WHERE p.id=ANY($1::uuid[]) AND p.deleted_at IS NULL ORDER BY p.id`,
        [ids],
      );
      if (available.rowCount !== ids.length)
        throw Object.assign(
          new Error("Um dos itens não está mais disponível."),
          { status: 409 },
        );
      for (const product of available.rows)
        if (unique.get(product.id) > product.quantity)
          throw Object.assign(
            new Error(
              `${product.name}: disponível para solicitação: ${product.quantity}.`,
            ),
            { status: 409 },
          );
      const groupResult = await client.query(
        "INSERT INTO request_groups(unit_id,requested_by,reason) VALUES($1,$2,$3) RETURNING id,order_number,unit_id",
        [
          req.session.user.unitId,
          req.session.user.id,
          req.validatedBody.reason,
        ],
      );
      const group = { ...groupResult.rows[0], unit_name: unit.rows[0].name };
      for (const product of available.rows) {
        const inserted = await client.query(
          `INSERT INTO requests(group_id,product_id,unit_id,requested_by,requested_quantity,reason,requested_full_stock)
         VALUES($1,$2,$3,$4,$5,$6,$5::smallint=$7::smallint) RETURNING id`,
          [
            group.id,
            product.id,
            req.session.user.unitId,
            req.session.user.id,
            unique.get(product.id),
            req.validatedBody.reason,
            product.quantity,
          ],
        );
        if (!group.first_request_id)
          group.first_request_id = inserted.rows[0].id;
      }
      const total = req.validatedBody.items.reduce(
        (sum, item) => sum + item.quantity,
        0,
      );
      const requestedItems = available.rows
        .map((product) => `- ${unique.get(product.id)}x ${product.name}`)
        .join("\n");
      const notificationMessage = `${req.session.user.name} enviou um pedido com ${total} item(ns) para ${group.unit_name}.`;
      const emailMessage = [
        `Usuário ${req.session.user.name} solicitou os seguintes itens para a unidade de ${group.unit_name}:`,
        "",
        requestedItems,
        "",
        `Motivo: ${req.validatedBody.reason}`,
      ].join("\n");
      await notifyGroup(
        client,
        group,
        "Nova solicitação",
        notificationMessage,
        emailMessage,
      );
      await client.query("COMMIT");
      queueEmailProcessing();
      res
        .status(201)
        .json({ order: { id: group.id, orderNumber: group.order_number } });
    } catch (error) {
      await client.query("ROLLBACK");
      next(error);
    } finally {
      client.release();
    }
  },
);

router.post(
  "/equipment-set",
  requireAuth,
  validate(equipmentSetRequestSchema),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const unit = await client.query(
        "SELECT id,name,code FROM units WHERE id=$1 AND active AND deleted_at IS NULL",
        [req.session.user.unitId],
      );
      if (!unit.rowCount || unit.rows[0].code === "MATRIZ")
        throw Object.assign(
          new Error(
            "A Matriz representa o almoxarifado e não recebe solicitações.",
          ),
          { status: 409 },
        );
      const set = await client.query(
        "SELECT id,name FROM equipment_sets WHERE id=$1 AND active AND deleted_at IS NULL",
        [req.validatedBody.setId],
      );
      if (!set.rowCount)
        throw Object.assign(new Error("Conjunto não encontrado ou inativo."), {
          status: 404,
        });
      const optionalIds = new Set(req.validatedBody.optionalComponentIds);
      if (optionalIds.size !== req.validatedBody.optionalComponentIds.length)
        throw Object.assign(new Error("Há componentes opcionais repetidos."), {
          status: 400,
        });
      const components = await client.query(
        `SELECT c.id,c.product_id,c.quantity::int,c.required,p.name,COALESCE(i.quantity,0)::int AS stock
         FROM equipment_set_components c JOIN products p ON p.id=c.product_id AND p.deleted_at IS NULL
         JOIN units m ON m.code='MATRIZ' AND m.active AND m.deleted_at IS NULL
         LEFT JOIN inventory i ON i.product_id=p.id AND i.unit_id=m.id
         WHERE c.set_id=$1 ORDER BY c.position`,
        [set.rows[0].id],
      );
      const selected = components.rows.filter(
        (item) => item.required || optionalIds.has(item.id),
      );
      if (optionalIds.size !== selected.filter((item) => !item.required).length)
        throw Object.assign(
          new Error("Um componente opcional não pertence a este conjunto."),
          { status: 400 },
        );
      const requested = selected.map((item) => ({
        ...item,
        requestedQuantity: item.quantity * req.validatedBody.quantity,
      }));
      for (const item of requested)
        if (item.requestedQuantity > 999 || item.requestedQuantity > item.stock)
          throw Object.assign(
            new Error(
              `${item.name}: necessário ${item.requestedQuantity}, disponível ${item.stock}.`,
            ),
            { status: 409 },
          );
      const groupResult = await client.query(
        `INSERT INTO request_groups(unit_id,requested_by,reason,equipment_set_id,equipment_set_quantity)
         VALUES($1,$2,$3,$4,$5) RETURNING id,order_number,unit_id`,
        [
          req.session.user.unitId,
          req.session.user.id,
          req.validatedBody.reason,
          set.rows[0].id,
          req.validatedBody.quantity,
        ],
      );
      const group = {
        ...groupResult.rows[0],
        unit_name: unit.rows[0].name,
      };
      for (const item of requested) {
        const inserted = await client.query(
          `INSERT INTO requests(group_id,product_id,unit_id,requested_by,requested_quantity,reason,requested_full_stock)
           VALUES($1,$2,$3,$4,$5,$6,$5::smallint=$7::smallint) RETURNING id`,
          [
            group.id,
            item.product_id,
            req.session.user.unitId,
            req.session.user.id,
            item.requestedQuantity,
            req.validatedBody.reason,
            item.stock,
          ],
        );
        if (!group.first_request_id)
          group.first_request_id = inserted.rows[0].id;
      }
      const itemLines = requested
        .map((item) => `- ${item.requestedQuantity}x ${item.name}`)
        .join("\n");
      await notifyGroup(
        client,
        group,
        "Nova solicitação de conjunto",
        `${req.session.user.name} solicitou ${req.validatedBody.quantity} conjunto(s) ${set.rows[0].name} para ${unit.rows[0].name}.`,
        [
          `${req.session.user.name} solicitou ${req.validatedBody.quantity} conjunto(s) ${set.rows[0].name} para ${unit.rows[0].name}:`,
          "",
          itemLines,
          "",
          `Motivo: ${req.validatedBody.reason}`,
        ].join("\n"),
      );
      await client.query("COMMIT");
      queueEmailProcessing();
      res.status(201).json({
        order: {
          id: group.id,
          orderNumber: group.order_number,
          equipmentSetName: set.rows[0].name,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      next(error);
    } finally {
      client.release();
    }
  },
);

router.post(
  "/groups/:id/cancel",
  requireAuth,
  validate(
    z.object({
      reason: z.string().trim().min(1).max(500),
      confirmed: z.literal(true),
    }),
  ),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT g.*,u.name AS unit_name,u.code AS unit_code,(SELECT id FROM requests WHERE group_id=g.id LIMIT 1) AS first_request_id FROM request_groups g JOIN units u ON u.id=g.unit_id WHERE g.id=$1 FOR UPDATE",
        [req.params.id],
      );
      if (!result.rowCount)
        throw Object.assign(new Error("Pedido não encontrado."), {
          status: 404,
        });
      const group = result.rows[0];
      if (group.status !== "SOLICITADO")
        throw Object.assign(
          new Error(
            "Somente pedidos ainda não analisados podem ser cancelados.",
          ),
          { status: 409 },
        );
      if (
        req.session.user.role !== "MASTER" &&
        group.unit_id !== req.session.user.unitId
      )
        throw Object.assign(
          new Error("Você não pode cancelar pedidos de outra unidade."),
          { status: 403 },
        );
      await client.query(
        "UPDATE request_groups SET status='CANCELADO',cancellation_reason=$2,cancelled_by=$3,cancelled_at=now(),updated_at=now() WHERE id=$1",
        [group.id, req.validatedBody.reason, req.session.user.id],
      );
      await client.query(
        "UPDATE requests SET status='CANCELADO',cancellation_reason=$2,cancelled_by=$3,cancelled_at=now(),updated_at=now() WHERE group_id=$1",
        [group.id, req.validatedBody.reason, req.session.user.id],
      );
      await notifyGroup(
        client,
        group,
        "Pedido cancelado",
        `O pedido ${group.order_number} foi cancelado. Motivo: ${req.validatedBody.reason}`,
      );
      await client.query("COMMIT");
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
  "/groups/:id/decision",
  requireAuth,
  requireMaster,
  validate(batchDecisionSchema),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const groupResult = await client.query(
        "SELECT g.*,u.name AS unit_name,u.code AS unit_code,(SELECT id FROM requests WHERE group_id=g.id LIMIT 1) AS first_request_id FROM request_groups g JOIN units u ON u.id=g.unit_id WHERE g.id=$1 FOR UPDATE",
        [req.params.id],
      );
      if (!groupResult.rowCount)
        throw Object.assign(new Error("Pedido não encontrado."), {
          status: 404,
        });
      const group = groupResult.rows[0];
      if (group.unit_code === "MATRIZ")
        throw Object.assign(
          new Error(
            "A Matriz é o estoque do almoxarifado. Cancele este pedido e vincule o usuário à unidade correta.",
          ),
          { status: 409 },
        );
      if (group.status !== "SOLICITADO")
        throw Object.assign(
          new Error("Um pedido já analisado não pode ser alterado."),
          { status: 409 },
        );
      const itemResult = await client.query(
        "SELECT id,product_id,requested_quantity::int FROM requests WHERE group_id=$1 ORDER BY product_id FOR UPDATE",
        [group.id],
      );
      const decisions = new Map(
        req.validatedBody.items.map((item) => [item.requestId, item]),
      );
      if (
        decisions.size !== itemResult.rowCount ||
        itemResult.rows.some((item) => !decisions.has(item.id))
      )
        throw Object.assign(
          new Error("Analise todos os itens do pedido antes de salvar."),
          { status: 400 },
        );
      const matrixResult = await client.query(
        "SELECT id FROM units WHERE code='MATRIZ' AND active AND deleted_at IS NULL",
      );
      const matrixId = matrixResult.rows[0].id;
      let approved = 0,
        rejected = 0,
        partial = 0;
      for (const item of itemResult.rows) {
        const decision = decisions.get(item.id),
          note = decision.note || "";
        let quantity = null,
          status = "RECUSADO";
        if (decision.decision === "REJECT") {
          if (!note)
            throw Object.assign(
              new Error("Informe o motivo da recusa em cada item recusado."),
              { status: 400 },
            );
          rejected++;
        } else {
          quantity = decision.approvedQuantity;
          if (!quantity)
            throw Object.assign(new Error("Informe a quantidade aprovada."), {
              status: 400,
            });
          if (
            decision.decision === "APPROVE" &&
            quantity !== item.requested_quantity
          )
            throw Object.assign(
              new Error(
                "Na aprovação total, aprove toda a quantidade solicitada.",
              ),
              { status: 400 },
            );
          if (
            decision.decision === "PARTIAL" &&
            (quantity >= item.requested_quantity || !note)
          )
            throw Object.assign(
              new Error("Aprovação parcial exige quantidade menor e uma nota."),
              { status: 400 },
            );
          await client.query(
            "INSERT INTO inventory(product_id,unit_id,quantity) VALUES($1,$2,0) ON CONFLICT DO NOTHING",
            [item.product_id, matrixId],
          );
          const stock = await client.query(
            "SELECT quantity::int FROM inventory WHERE product_id=$1 AND unit_id=$2 FOR UPDATE",
            [item.product_id, matrixId],
          );
          const before = stock.rows[0].quantity;
          if (before < quantity)
            throw Object.assign(
              new Error(
                `Estoque da Matriz insuficiente. Saldo atual: ${before}.`,
              ),
              { status: 409 },
            );
          const after = before - quantity;
          await client.query(
            "UPDATE inventory SET quantity=$3,updated_at=now() WHERE product_id=$1 AND unit_id=$2",
            [item.product_id, matrixId, after],
          );
          status =
            decision.decision === "APPROVE"
              ? "APROVADO"
              : "APROVADO_PARCIALMENTE";
          if (status === "APROVADO") approved++;
          else partial++;
          await client.query(
            "INSERT INTO inventory_movements(product_id,unit_id,request_id,performed_by,kind,quantity,quantity_before,quantity_after,note) VALUES($1,$2,$3,$4,'RESERVA_PEDIDO',$5,$6,$7,$8)",
            [
              item.product_id,
              matrixId,
              item.id,
              req.session.user.id,
              quantity,
              before,
              after,
              note || null,
            ],
          );
        }
        await client.query(
          "UPDATE requests SET status=$2,approved_quantity=$3,delivery_status=$4,decision_note=$5,decided_by=$6,decided_at=now(),updated_at=now() WHERE id=$1",
          [
            item.id,
            status,
            quantity,
            status === "RECUSADO" ? "AGUARDANDO_ANALISE" : "PREPARANDO",
            note || null,
            req.session.user.id,
          ],
        );
      }
      const overall =
        rejected === itemResult.rowCount
          ? "RECUSADO"
          : rejected > 0 || partial > 0
            ? "APROVADO_PARCIALMENTE"
            : "APROVADO";
      const delivery =
        overall === "RECUSADO" ? "AGUARDANDO_ANALISE" : "PREPARANDO";
      await client.query(
        "UPDATE request_groups SET status=$2,delivery_status=$3,decided_by=$4,decided_at=now(),updated_at=now() WHERE id=$1",
        [group.id, overall, delivery, req.session.user.id],
      );
      await notifyGroup(
        client,
        group,
        "Pedido analisado",
        `O pedido ${group.order_number} foi analisado: ${approved} item(ns) aprovado(s), ${partial} parcial(is) e ${rejected} recusado(s).`,
      );
      await client.query("COMMIT");
      res.json({ status: overall, deliveryStatus: delivery });
    } catch (error) {
      await client.query("ROLLBACK");
      next(error);
    } finally {
      client.release();
    }
  },
);

router.post(
  "/groups/:id/deliver",
  requireAuth,
  requireMaster,
  validate(z.object({ confirmed: z.literal(true) })),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const groupResult = await client.query(
        "SELECT g.*,u.name AS unit_name,u.code AS unit_code,(SELECT id FROM requests WHERE group_id=g.id LIMIT 1) AS first_request_id FROM request_groups g JOIN units u ON u.id=g.unit_id WHERE g.id=$1 FOR UPDATE",
        [req.params.id],
      );
      if (!groupResult.rowCount)
        throw Object.assign(new Error("Pedido não encontrado."), {
          status: 404,
        });
      const group = groupResult.rows[0];
      if (group.unit_code === "MATRIZ")
        throw Object.assign(
          new Error(
            "Pedidos destinados à Matriz não podem ser entregues; ela representa o estoque do almoxarifado.",
          ),
          { status: 409 },
        );
      if (group.delivery_status !== "PREPARANDO")
        throw Object.assign(
          new Error("Somente pedidos em preparação podem ser entregues."),
          { status: 409 },
        );
      const items = await client.query(
        "SELECT id,product_id,approved_quantity::int FROM requests WHERE group_id=$1 AND status IN ('APROVADO','APROVADO_PARCIALMENTE') ORDER BY product_id FOR UPDATE",
        [group.id],
      );
      for (const item of items.rows) {
        await client.query(
          "INSERT INTO inventory(product_id,unit_id,quantity) VALUES($1,$2,0) ON CONFLICT DO NOTHING",
          [item.product_id, group.unit_id],
        );
        const stock = await client.query(
          "SELECT quantity::int FROM inventory WHERE product_id=$1 AND unit_id=$2 FOR UPDATE",
          [item.product_id, group.unit_id],
        );
        const before = stock.rows[0].quantity,
          after = before + item.approved_quantity;
        if (after > 999)
          throw Object.assign(
            new Error(
              "A entrega ultrapassaria o limite de 999 itens na unidade.",
            ),
            { status: 409 },
          );
        await client.query(
          "UPDATE inventory SET quantity=$3,updated_at=now() WHERE product_id=$1 AND unit_id=$2",
          [item.product_id, group.unit_id, after],
        );
        await client.query(
          "UPDATE requests SET delivery_status='ENTREGUE',delivered_by=$2,delivered_at=now(),updated_at=now() WHERE id=$1",
          [item.id, req.session.user.id],
        );
        await client.query(
          "INSERT INTO inventory_movements(product_id,unit_id,request_id,performed_by,kind,quantity,quantity_before,quantity_after,note) VALUES($1,$2,$3,$4,'ENTREGA_PEDIDO',$5,$6,$7,'PEDIDO ENTREGUE')",
          [
            item.product_id,
            group.unit_id,
            item.id,
            req.session.user.id,
            item.approved_quantity,
            before,
            after,
          ],
        );
      }
      if (group.equipment_set_id) {
        const assignment = await client.query(
          `INSERT INTO equipment_assignments(set_id,unit_id,request_group_id,delivery_note,delivered_by)
           VALUES($1,$2,$3,$4,$5) RETURNING id,delivery_number`,
          [
            group.equipment_set_id,
            group.unit_id,
            group.id,
            `ENTREGA DO PEDIDO #${group.order_number}`,
            req.session.user.id,
          ],
        );
        for (const item of items.rows) {
          const component = await client.query(
            "SELECT id,required FROM equipment_set_components WHERE set_id=$1 AND product_id=$2",
            [group.equipment_set_id, item.product_id],
          );
          const snapshot = await client.query(
            `INSERT INTO equipment_assignment_components(assignment_id,source_component_id,product_id,required,delivered_quantity)
             VALUES($1,$2,$3,$4,$5) RETURNING id`,
            [
              assignment.rows[0].id,
              component.rows[0]?.id || null,
              item.product_id,
              component.rows[0]?.required ?? true,
              item.approved_quantity,
            ],
          );
          await client.query(
            `INSERT INTO equipment_component_events(assignment_component_id,event_type,quantity,note,performed_by)
             VALUES($1,'DELIVERED',$2,$3,$4)`,
            [
              snapshot.rows[0].id,
              item.approved_quantity,
              `ENTREGA DO PEDIDO #${group.order_number}`,
              req.session.user.id,
            ],
          );
        }
      }
      await client.query(
        "UPDATE request_groups SET delivery_status='ENTREGUE',delivered_by=$2,delivered_at=now(),updated_at=now() WHERE id=$1",
        [group.id, req.session.user.id],
      );
      await notifyGroup(
        client,
        group,
        "Pedido entregue",
        `O pedido ${group.order_number} foi entregue para ${group.unit_name}.`,
      );
      await client.query("COMMIT");
      res.json({ deliveryStatus: "ENTREGUE" });
    } catch (error) {
      await client.query("ROLLBACK");
      next(error);
    } finally {
      client.release();
    }
  },
);

module.exports = router;
