const express = require("express");
const { z } = require("zod");
const pool = require("../database/pool");
const validate = require("../middleware/validate");
const {
  requireAuth,
  requireMaster,
  requireMatrixMaster,
} = require("../middleware/auth");
const { normalize, unitCodeFromName } = require("../utils/text");

const router = express.Router();
const nameSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, code, name, active, protected FROM units WHERE deleted_at IS NULL ORDER BY protected DESC, name",
    );
    res.json({ units: result.rows });
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
        "INSERT INTO units(code, name, normalized_name) VALUES ($1, $2, $3) RETURNING id, code, name, active, protected",
        [unitCodeFromName(name), name, normalize(name)],
      );
      res.status(201).json({ unit: result.rows[0] });
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
        "UPDATE units SET name=$2,normalized_name=$3,updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id,code,name,active,protected",
        [req.params.id, name, normalize(name)],
      );
      if (!result.rowCount)
        return res
          .status(404)
          .json({ error: "NOT_FOUND", message: "Unidade não encontrada." });
      res.json({ unit: result.rows[0] });
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
      const unit = await pool.query(
        "SELECT protected FROM units WHERE id = $1 AND deleted_at IS NULL",
        [req.params.id],
      );
      if (!unit.rowCount)
        return res
          .status(404)
          .json({ error: "NOT_FOUND", message: "Unidade não encontrada." });
      if (unit.rows[0].protected && !req.validatedBody.active)
        return res.status(409).json({
          error: "PROTECTED",
          message: "A Matriz não pode ser desativada.",
        });
      await pool.query(
        "UPDATE units SET active = $2, updated_at = now() WHERE id = $1",
        [req.params.id, req.validatedBody.active],
      );
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
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const unit = await client.query(
        "SELECT protected FROM units WHERE id = $1 FOR UPDATE",
        [req.params.id],
      );
      if (!unit.rowCount) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .json({ error: "NOT_FOUND", message: "Unidade não encontrada." });
      }
      if (unit.rows[0].protected) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "PROTECTED",
          message: "A Matriz não pode ser excluída.",
        });
      }
      const dependencies = await client.query(
        `SELECT EXISTS(SELECT 1 FROM users WHERE unit_id = $1 AND deleted_at IS NULL)
           OR EXISTS(SELECT 1 FROM inventory WHERE unit_id = $1 AND quantity > 0)
           OR EXISTS(SELECT 1 FROM requests WHERE unit_id = $1) AS in_use`,
        [req.params.id],
      );
      if (dependencies.rows[0].in_use) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "IN_USE",
          message: "Desative a unidade; ela possui dados vinculados.",
        });
      }
      await client.query(
        "UPDATE units SET active = false, deleted_at = now(), updated_at = now() WHERE id = $1",
        [req.params.id],
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

module.exports = router;
