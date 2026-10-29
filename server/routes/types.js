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

const router = express.Router();
const nameSchema = z.object({ name: z.string().trim().min(1).max(100) });

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, name, active FROM product_types WHERE deleted_at IS NULL ORDER BY name",
    );
    res.json({ types: result.rows });
  } catch (error) {
    next(error);
  }
});
router.post(
  "/",
  requireAuth,
  requireMaster,
  validate(nameSchema),
  async (req, res, next) => {
    try {
      const { name } = req.validatedBody;
      const result = await pool.query(
        "INSERT INTO product_types(name, normalized_name) VALUES ($1, $2) RETURNING id, name, active",
        [name, normalize(name)],
      );
      res.status(201).json({ type: result.rows[0] });
    } catch (error) {
      next(error);
    }
  },
);
router.put(
  "/:id",
  requireAuth,
  requireMaster,
  validate(nameSchema),
  async (req, res, next) => {
    try {
      const { name } = req.validatedBody;
      const result = await pool.query(
        "UPDATE product_types SET name=$2,normalized_name=$3,updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id,name,active",
        [req.params.id, name, normalize(name)],
      );
      if (!result.rowCount)
        return res
          .status(404)
          .json({ error: "NOT_FOUND", message: "Tipo não encontrado." });
      res.json({ type: result.rows[0] });
    } catch (error) {
      next(error);
    }
  },
);
router.patch(
  "/:id/active",
  requireAuth,
  requireMaster,
  validate(z.object({ active: z.boolean() })),
  async (req, res, next) => {
    try {
      const result = await pool.query(
        "UPDATE product_types SET active = $2, updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id",
        [req.params.id, req.validatedBody.active],
      );
      if (!result.rowCount)
        return res
          .status(404)
          .json({ error: "NOT_FOUND", message: "Tipo não encontrado." });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);
router.delete(
  "/:id",
  requireAuth,
  requireMatrixMaster,
  async (req, res, next) => {
    try {
      const used = await pool.query(
        "SELECT EXISTS(SELECT 1 FROM products WHERE type_id = $1 AND deleted_at IS NULL) AS in_use",
        [req.params.id],
      );
      if (used.rows[0].in_use)
        return res.status(409).json({
          error: "IN_USE",
          message: "Desative o tipo; ele possui produtos vinculados.",
        });
      const result = await pool.query(
        "UPDATE product_types SET active = false, deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id",
        [req.params.id],
      );
      if (!result.rowCount)
        return res
          .status(404)
          .json({ error: "NOT_FOUND", message: "Tipo não encontrado." });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
