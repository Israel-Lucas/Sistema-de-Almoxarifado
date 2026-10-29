const express = require("express");
const { z } = require("zod");
const pool = require("../database/pool");
const validate = require("../middleware/validate");
const { requireAuth, requireMaster } = require("../middleware/auth");
const { normalize } = require("../utils/text");

const router = express.Router();
const builderSchema = z.object({
  name: z.string().trim().min(1).max(100),
  typeId: z.string().uuid(),
  description: z.string().trim().max(500).optional().default(""),
  components: z
    .array(
      z.object({
        productId: z.string().uuid().optional().nullable(),
        quantity: z.number().int().min(1).max(99),
        name: z.string().trim().max(100).optional().default(""),
        model: z.string().trim().max(100).optional().default(""),
        description: z.string().trim().max(500).optional().default(""),
        typeId: z.string().uuid().optional().nullable(),
        initialQuantity: z.number().int().min(0).max(999).default(0),
      }),
    )
    .min(2)
    .max(30),
});
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT s.id,s.name,s.description,s.active,s.created_at,s.type_id,pt.name AS type_name,
       COALESCE(json_agg(json_build_object('id',c.id,'productId',p.id,'productName',p.name,'model',p.model,'quantity',c.quantity,'required',c.required,'matrixQuantity',COALESCE(i.quantity,0)) ORDER BY c.position,p.name) FILTER(WHERE c.id IS NOT NULL),'[]') AS components
       FROM equipment_sets s LEFT JOIN product_types pt ON pt.id=s.type_id LEFT JOIN equipment_set_components c ON c.set_id=s.id
       LEFT JOIN products p ON p.id=c.product_id LEFT JOIN units m ON m.code='MATRIZ' AND m.deleted_at IS NULL
       LEFT JOIN inventory i ON i.product_id=p.id AND i.unit_id=m.id
       WHERE s.deleted_at IS NULL AND ($1::boolean OR s.active)
       GROUP BY s.id,pt.name ORDER BY s.name`,
      [req.session.user.role === "MASTER"],
    );
    res.json({ sets: result.rows });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/builder",
  requireAuth,
  requireMaster,
  validate(builderSchema),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const data = req.validatedBody;
      const kitType = await client.query(
        "SELECT id FROM product_types WHERE id=$1 AND active AND deleted_at IS NULL",
        [data.typeId],
      );
      if (!kitType.rowCount)
        throw Object.assign(new Error("Selecione um tipo ativo para o kit."), {
          status: 400,
        });
      const matrix = (
        await client.query(
          "SELECT id FROM units WHERE code='MATRIZ' AND active AND deleted_at IS NULL",
        )
      ).rows[0];
      const resolved = [];
      for (const component of data.components) {
        if (component.productId) {
          const existing = await client.query(
            "SELECT id FROM products WHERE id=$1 AND deleted_at IS NULL",
            [component.productId],
          );
          if (!existing.rowCount)
            throw Object.assign(
              new Error("Um item selecionado não existe mais."),
              {
                status: 409,
              },
            );
          resolved.push({
            productId: existing.rows[0].id,
            quantity: component.quantity,
          });
          continue;
        }
        if (!component.name || !component.model || !component.typeId)
          throw Object.assign(
            new Error("Preencha nome, marca/modelo e tipo de cada item novo."),
            { status: 400 },
          );
        const componentType = await client.query(
          "SELECT id FROM product_types WHERE id=$1 AND active AND deleted_at IS NULL",
          [component.typeId],
        );
        if (!componentType.rowCount)
          throw Object.assign(
            new Error("Selecione um tipo ativo para o item novo."),
            {
              status: 400,
            },
          );
        const product = await client.query(
          `INSERT INTO products(name,normalized_name,model,normalized_model,description,type_id,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [
            component.name,
            normalize(component.name),
            component.model,
            normalize(component.model),
            component.description || null,
            component.typeId,
            req.session.user.id,
          ],
        );
        if (component.initialQuantity > 0) {
          await client.query(
            "INSERT INTO inventory(product_id,unit_id,quantity) VALUES($1,$2,$3)",
            [product.rows[0].id, matrix.id, component.initialQuantity],
          );
          await client.query(
            `INSERT INTO inventory_movements(product_id,unit_id,performed_by,kind,quantity,quantity_before,quantity_after,note)
             VALUES($1,$2,$3,'ENTRADA',$4,0,$4,'ESTOQUE INICIAL — ITEM DE KIT')`,
            [
              product.rows[0].id,
              matrix.id,
              req.session.user.id,
              component.initialQuantity,
            ],
          );
        }
        resolved.push({
          productId: product.rows[0].id,
          quantity: component.quantity,
        });
      }
      if (
        new Set(resolved.map((item) => item.productId)).size !== resolved.length
      )
        throw Object.assign(
          new Error("O mesmo item não pode aparecer duas vezes no kit."),
          { status: 400 },
        );
      const inserted = await client.query(
        "INSERT INTO equipment_sets(name,normalized_name,description,type_id,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,name",
        [
          data.name,
          normalize(data.name),
          data.description || null,
          data.typeId,
          req.session.user.id,
        ],
      );
      for (const [position, component] of resolved.entries())
        await client.query(
          "INSERT INTO equipment_set_components(set_id,product_id,quantity,required,position) VALUES($1,$2,$3,true,$4)",
          [
            inserted.rows[0].id,
            component.productId,
            component.quantity,
            position,
          ],
        );
      await client.query("COMMIT");
      res.status(201).json({ set: inserted.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      next(error);
    } finally {
      client.release();
    }
  },
);

router.put(
  "/:id/builder",
  requireAuth,
  requireMaster,
  validate(builderSchema),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const data = req.validatedBody;
      const kitType = await client.query(
        "SELECT id FROM product_types WHERE id=$1 AND active AND deleted_at IS NULL",
        [data.typeId],
      );
      if (!kitType.rowCount)
        throw Object.assign(new Error("Selecione um tipo ativo para o kit."), {
          status: 400,
        });
      const current = await client.query(
        "SELECT id FROM equipment_sets WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
        [req.params.id],
      );
      if (!current.rowCount)
        throw Object.assign(new Error("Kit não encontrado."), { status: 404 });
      const matrix = (
        await client.query(
          "SELECT id FROM units WHERE code='MATRIZ' AND active AND deleted_at IS NULL",
        )
      ).rows[0];
      const resolved = [];
      for (const component of data.components) {
        if (component.productId) {
          const existing = await client.query(
            "SELECT id FROM products WHERE id=$1 AND deleted_at IS NULL",
            [component.productId],
          );
          if (!existing.rowCount)
            throw Object.assign(
              new Error("Um item selecionado não existe mais."),
              { status: 409 },
            );
          resolved.push({
            productId: existing.rows[0].id,
            quantity: component.quantity,
          });
          continue;
        }
        if (!component.name || !component.model || !component.typeId)
          throw Object.assign(
            new Error("Preencha nome, marca/modelo e tipo de cada item novo."),
            { status: 400 },
          );
        const componentType = await client.query(
          "SELECT id FROM product_types WHERE id=$1 AND active AND deleted_at IS NULL",
          [component.typeId],
        );
        if (!componentType.rowCount)
          throw Object.assign(
            new Error("Selecione um tipo ativo para o item novo."),
            { status: 400 },
          );
        const product = await client.query(
          `INSERT INTO products(name,normalized_name,model,normalized_model,description,type_id,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [
            component.name,
            normalize(component.name),
            component.model,
            normalize(component.model),
            component.description || null,
            component.typeId,
            req.session.user.id,
          ],
        );
        if (component.initialQuantity > 0) {
          await client.query(
            "INSERT INTO inventory(product_id,unit_id,quantity) VALUES($1,$2,$3)",
            [product.rows[0].id, matrix.id, component.initialQuantity],
          );
          await client.query(
            `INSERT INTO inventory_movements(product_id,unit_id,performed_by,kind,quantity,quantity_before,quantity_after,note)
             VALUES($1,$2,$3,'ENTRADA',$4,0,$4,'ESTOQUE INICIAL — ITEM DE KIT')`,
            [
              product.rows[0].id,
              matrix.id,
              req.session.user.id,
              component.initialQuantity,
            ],
          );
        }
        resolved.push({
          productId: product.rows[0].id,
          quantity: component.quantity,
        });
      }
      if (
        new Set(resolved.map((item) => item.productId)).size !== resolved.length
      )
        throw Object.assign(
          new Error("O mesmo item não pode aparecer duas vezes no kit."),
          { status: 400 },
        );
      await client.query(
        "UPDATE equipment_sets SET name=$2,normalized_name=$3,description=$4,type_id=$5,updated_at=now() WHERE id=$1",
        [
          req.params.id,
          data.name,
          normalize(data.name),
          data.description || null,
          data.typeId,
        ],
      );
      await client.query(
        "DELETE FROM equipment_set_components WHERE set_id=$1",
        [req.params.id],
      );
      for (const [position, component] of resolved.entries())
        await client.query(
          "INSERT INTO equipment_set_components(set_id,product_id,quantity,required,position) VALUES($1,$2,$3,true,$4)",
          [req.params.id, component.productId, component.quantity, position],
        );
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

router.delete(
  "/:id",
  requireAuth,
  requireMaster,
  validate(z.object({ confirmed: z.literal(true) })),
  async (req, res, next) => {
    try {
      const result = await pool.query(
        "UPDATE equipment_sets SET active=false,deleted_at=now(),updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id",
        [req.params.id],
      );
      if (!result.rowCount)
        return res
          .status(404)
          .json({ error: "NOT_FOUND", message: "Kit não encontrado." });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
