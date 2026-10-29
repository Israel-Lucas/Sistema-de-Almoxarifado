const express = require("express");
const { z } = require("zod");
const pool = require("../database/pool");
const validate = require("../middleware/validate");
const {
  requireAuth,
  requireMaster,
  requireMatrixMaster,
} = require("../middleware/auth");
const { normalize } = require("../utils/text");
const { pagination, metadata } = require("../utils/pagination");

const router = express.Router();
const productSchema = z.object({
  name: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional().default(""),
  typeId: z.string().uuid(),
  controlMode: z.enum(["QUANTITY", "EQUIPMENT"]).default("QUANTITY"),
  initialQuantity: z.number().int().min(0).max(999),
});
const editProductSchema = productSchema
  .omit({ initialQuantity: true, controlMode: true })
  .extend({ controlMode: z.enum(["QUANTITY", "EQUIPMENT"]).optional() });

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const isMaster = req.session.user.role === "MASTER";
    const { page, limit, offset } = pagination(req.query, 20),
      search = String(req.query.search || "").trim();
    const where =
      "WHERE p.deleted_at IS NULL AND ($1::boolean OR (pt.active AND COALESCE(mi.quantity,0)>0)) AND ($2='' OR p.name ILIKE '%'||$2||'%' OR p.model ILIKE '%'||$2||'%' OR pt.name ILIKE '%'||$2||'%')";
    const [result, count] = await Promise.all([
      pool.query(
        `SELECT p.id,p.name,p.model,p.description,p.control_mode,pt.id AS type_id,pt.name AS type_name,COALESCE(mi.quantity,0)::int AS matrix_quantity,COALESCE(t.by_unit,'[]'::jsonb) AS stock_by_unit FROM products p JOIN product_types pt ON pt.id=p.type_id LEFT JOIN units mu ON mu.code='MATRIZ' AND mu.deleted_at IS NULL LEFT JOIN inventory mi ON mi.product_id=p.id AND mi.unit_id=mu.id LEFT JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('unit_id',u.id,'unit_code',u.code,'unit_name',u.name,'quantity',i.quantity) ORDER BY u.name) AS by_unit FROM inventory i JOIN units u ON u.id=i.unit_id AND u.deleted_at IS NULL WHERE i.product_id=p.id)t ON true ${where} ORDER BY p.name,p.model LIMIT $3 OFFSET $4`,
        [isMaster, search, limit, offset],
      ),
      pool.query(
        `SELECT count(*)::int AS total FROM products p JOIN product_types pt ON pt.id=p.type_id LEFT JOIN units mu ON mu.code='MATRIZ' AND mu.deleted_at IS NULL LEFT JOIN inventory mi ON mi.product_id=p.id AND mi.unit_id=mu.id ${where}`,
        [isMaster, search],
      ),
    ]);
    res.json({
      products: result.rows,
      pagination: metadata(count.rows[0].total, page, limit),
    });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/",
  requireAuth,
  requireMaster,
  validate(productSchema),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const data = req.validatedBody;
      const type = await client.query(
        "SELECT id FROM product_types WHERE id=$1 AND active AND deleted_at IS NULL",
        [data.typeId],
      );
      if (!type.rowCount) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ error: "INVALID_TYPE", message: "Selecione um tipo ativo." });
      }
      const product = await client.query(
        `INSERT INTO products(name,normalized_name,model,normalized_model,description,type_id,control_mode,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,name,model,description,type_id,control_mode`,
        [
          data.name,
          normalize(data.name),
          data.model,
          normalize(data.model),
          data.description || null,
          data.typeId,
          data.controlMode,
          req.session.user.id,
        ],
      );
      if (data.initialQuantity > 0) {
        const matrix = await client.query(
          "SELECT id FROM units WHERE code='MATRIZ' AND active AND deleted_at IS NULL",
        );
        await client.query(
          "INSERT INTO inventory(product_id,unit_id,quantity) VALUES($1,$2,$3)",
          [product.rows[0].id, matrix.rows[0].id, data.initialQuantity],
        );
        await client.query(
          `INSERT INTO inventory_movements(product_id,unit_id,performed_by,kind,quantity,quantity_before,quantity_after,note) VALUES($1,$2,$3,'ENTRADA',$4,0,$4,'ESTOQUE INICIAL')`,
          [
            product.rows[0].id,
            matrix.rows[0].id,
            req.session.user.id,
            data.initialQuantity,
          ],
        );
      }
      await client.query("COMMIT");
      res.status(201).json({ product: product.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      next(error);
    } finally {
      client.release();
    }
  },
);

router.put(
  "/:id",
  requireAuth,
  requireMaster,
  validate(editProductSchema),
  async (req, res, next) => {
    try {
      const data = req.validatedBody;
      const type = await pool.query(
        "SELECT id FROM product_types WHERE id=$1 AND active AND deleted_at IS NULL",
        [data.typeId],
      );
      if (!type.rowCount)
        return res.status(400).json({
          error: "INVALID_TYPE",
          message: "Selecione um tipo ativo.",
          fields: { typeId: "Selecione um tipo ativo." },
        });
      if (data.controlMode === "QUANTITY") {
        const membership = await pool.query(
          "SELECT 1 FROM equipment_set_components c JOIN equipment_sets s ON s.id=c.set_id WHERE c.product_id=$1 AND s.deleted_at IS NULL LIMIT 1",
          [req.params.id],
        );
        if (membership.rowCount)
          return res.status(409).json({
            error: "IN_USE",
            message:
              "Remova o produto dos conjuntos antes de alterar o controle para quantidade.",
          });
      }
      const result = await pool.query(
        `UPDATE products SET name=$2,normalized_name=$3,model=$4,normalized_model=$5,description=$6,type_id=$7,control_mode=COALESCE($8,control_mode),updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id,name,model,description,type_id,control_mode`,
        [
          req.params.id,
          data.name,
          normalize(data.name),
          data.model,
          normalize(data.model),
          data.description || null,
          data.typeId,
          data.controlMode,
        ],
      );
      if (!result.rowCount)
        return res
          .status(404)
          .json({ error: "NOT_FOUND", message: "Produto não encontrado." });
      res.json({ product: result.rows[0] });
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  "/:id",
  requireAuth,
  requireMatrixMaster,
  validate(z.object({ confirmed: z.literal(true) })),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const dependencies = await client.query(
        `SELECT COALESCE((SELECT sum(quantity) FROM inventory WHERE product_id=$1),0)::int AS stock,
          (SELECT count(*) FROM equipment_set_components c JOIN equipment_sets s ON s.id=c.set_id WHERE c.product_id=$1 AND s.deleted_at IS NULL)::int AS sets`,
        [req.params.id],
      );
      if (dependencies.rows[0].stock > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "IN_USE",
          message: `O item ainda possui ${dependencies.rows[0].stock} unidade(s) distribuída(s). Zere o estoque de todas as unidades antes de excluir.`,
        });
      }
      if (dependencies.rows[0].sets > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "IN_USE",
          message:
            "O equipamento faz parte de um conjunto. Remova-o da composição antes de excluir.",
        });
      }
      const result = await client.query(
        "UPDATE products SET deleted_at=now(),updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id",
        [req.params.id],
      );
      if (!result.rowCount) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .json({ error: "NOT_FOUND", message: "Produto não encontrado." });
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
