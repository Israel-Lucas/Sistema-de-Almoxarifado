const express = require("express");
const { z } = require("zod");
const pool = require("../database/pool");
const validate = require("../middleware/validate");
const { requireAuth, requireMaster } = require("../middleware/auth");

const router = express.Router();
const stockSideSchema = z.object({
  unitId: z.string().uuid(),
  quantity: z.number().int().min(1).max(999),
});
const changeSchema = z
  .object({
    productId: z.string().uuid(),
    removal: stockSideSchema.nullable(),
    addition: stockSideSchema.nullable(),
    confirmed: z.literal(true),
  })
  .refine((data) => data.removal || data.addition, {
    message: "Informe uma remoção ou um acréscimo.",
  })
  .refine(
    (data) =>
      !data.removal ||
      !data.addition ||
      data.removal.unitId !== data.addition.unitId,
    { message: "A origem e o destino devem ser unidades diferentes." },
  )
  .refine(
    (data) =>
      !data.removal ||
      !data.addition ||
      data.addition.quantity <= data.removal.quantity,
    {
      message:
        "Em uma transferência, a quantidade acrescentada não pode ser maior que a removida.",
    },
  );

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const isMaster = req.session.user.role === "MASTER";
    const result = await pool.query(
      `SELECT i.product_id,i.unit_id,i.quantity::int,p.name AS product_name,p.model,pt.id AS type_id,pt.name AS type_name,u.code AS unit_code,u.name AS unit_name FROM inventory i JOIN products p ON p.id=i.product_id JOIN product_types pt ON pt.id=p.type_id JOIN units u ON u.id=i.unit_id WHERE ($1::boolean OR i.unit_id=$2) AND p.deleted_at IS NULL AND u.deleted_at IS NULL ORDER BY u.name,p.name`,
      [isMaster, req.session.user.unitId],
    );
    res.json({ inventory: result.rows });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/change",
  requireAuth,
  requireMaster,
  validate(changeSchema),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const data = req.validatedBody;
      const product = await client.query(
        "SELECT id FROM products WHERE id=$1 AND deleted_at IS NULL",
        [data.productId],
      );
      if (!product.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Item não encontrado." });
      }

      const changes = [
        data.removal && { ...data.removal, operation: "REMOVE" },
        data.addition && { ...data.addition, operation: "ADD" },
      ].filter(Boolean);
      const unitIds = changes.map((change) => change.unitId).sort();
      const activeUnits = await client.query(
        "SELECT id FROM units WHERE id=ANY($1::uuid[]) AND active AND deleted_at IS NULL",
        [unitIds],
      );
      if (activeUnits.rowCount !== unitIds.length) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ message: "Selecione somente unidades ativas." });
      }

      for (const unitId of unitIds) {
        await client.query(
          "INSERT INTO inventory(product_id,unit_id,quantity) VALUES($1,$2,0) ON CONFLICT DO NOTHING",
          [data.productId, unitId],
        );
      }
      const balances = await client.query(
        "SELECT unit_id,quantity::int FROM inventory WHERE product_id=$1 AND unit_id=ANY($2::uuid[]) ORDER BY unit_id FOR UPDATE",
        [data.productId, unitIds],
      );
      const currentByUnit = new Map(
        balances.rows.map((row) => [row.unit_id, row.quantity]),
      );

      for (const change of changes) {
        const before = currentByUnit.get(change.unitId);
        const after =
          before +
          (change.operation === "ADD" ? change.quantity : -change.quantity);
        if (after < 0) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            message: `Saldo insuficiente na unidade selecionada. Quantidade atual: ${before}.`,
          });
        }
        if (after > 999) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            message: "A quantidade final não pode ultrapassar 999.",
          });
        }
        await client.query(
          "UPDATE inventory SET quantity=$3,updated_at=now() WHERE product_id=$1 AND unit_id=$2",
          [data.productId, change.unitId, after],
        );
        await client.query(
          `INSERT INTO inventory_movements(product_id,unit_id,performed_by,kind,quantity,quantity_before,quantity_after,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            data.productId,
            change.unitId,
            req.session.user.id,
            change.operation === "ADD" ? "ENTRADA" : "SAIDA",
            change.quantity,
            before,
            after,
            data.removal && data.addition
              ? "TRANSFERÊNCIA MANUAL"
              : "AJUSTE MANUAL",
          ],
        );
      }
      await client.query("COMMIT");
      res.status(204).end();
    } catch (error) {
      await client.query("ROLLBACK");
      next(error);
    } finally {
      client.release();
    }
  },
);

module.exports = router;
