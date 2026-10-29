const express = require("express");
const bcrypt = require("bcryptjs");
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
const emailSchema = z
  .union([z.string().trim().email().max(254), z.literal("")])
  .optional()
  .transform((value) => value || null);
const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  username: z.string().trim().min(1).max(100),
  password: z.string().min(4).max(100),
  email: emailSchema,
  role: z.enum(["MASTER", "USER"]),
  unitId: z.string().uuid(),
  active: z.boolean().default(true),
});
const updateSchema = createSchema
  .omit({ password: true })
  .extend({ password: z.string().min(4).max(100).optional() });

async function requireMatrixMasterEmail(data, res) {
  const unit = await pool.query(
    "SELECT code FROM units WHERE id=$1 AND deleted_at IS NULL",
    [data.unitId],
  );
  if (!unit.rowCount) {
    res.status(400).json({
      error: "INVALID_UNIT",
      message: "Selecione uma unidade válida.",
    });
    return false;
  }
  if (data.role === "MASTER" && unit.rows[0].code === "MATRIZ" && !data.email) {
    res.status(400).json({
      error: "EMAIL_REQUIRED",
      message: "E-mail é obrigatório para usuários master da Matriz.",
    });
    return false;
  }
  return true;
}

router.get("/", requireAuth, requireMaster, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT u.id,u.name,u.username,u.email,u.role,u.active,u.last_login_at,un.id AS unit_id,un.code AS unit_code,un.name AS unit_name FROM users u JOIN units un ON un.id=u.unit_id WHERE u.deleted_at IS NULL ORDER BY u.name`,
    );
    res.json({ users: result.rows });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/",
  requireAuth,
  requireMaster,
  validate(createSchema),
  async (req, res, next) => {
    try {
      const data = req.validatedBody;
      if (!(await requireMatrixMasterEmail(data, res))) return;
      const result = await pool.query(
        `INSERT INTO users(name,username,normalized_username,password_hash,email,normalized_email,role,unit_id,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,name,username,email,role,unit_id,active`,
        [
          data.name,
          data.username,
          normalize(data.username),
          await bcrypt.hash(data.password, 12),
          data.email,
          data.email ? normalize(data.email) : null,
          data.role,
          data.unitId,
          data.active,
        ],
      );
      res.status(201).json({ user: result.rows[0] });
    } catch (error) {
      next(error);
    }
  },
);

router.put(
  "/:id",
  requireAuth,
  requireMaster,
  validate(updateSchema),
  async (req, res, next) => {
    try {
      const data = req.validatedBody;
      if (
        req.params.id === req.session.user.id &&
        (!data.active ||
          data.role !== "MASTER" ||
          data.unitId !== req.session.user.unitId)
      ) {
        return res.status(409).json({
          error: "CURRENT_USER_PROTECTED",
          message:
            "Você não pode desativar, rebaixar ou trocar a unidade da própria conta.",
        });
      }
      if (!(await requireMatrixMasterEmail(data, res))) return;
      const values = [
        data.name,
        data.username,
        normalize(data.username),
        data.email,
        data.email ? normalize(data.email) : null,
        data.role,
        data.unitId,
        data.active,
        req.params.id,
      ];
      let sql = `UPDATE users SET name=$1,username=$2,normalized_username=$3,email=$4,normalized_email=$5,role=$6,unit_id=$7,active=$8,updated_at=now()`;
      if (data.password) {
        values.splice(8, 0, await bcrypt.hash(data.password, 12));
        sql += `,password_hash=$9,password_changed_at=now() WHERE id=$10 AND deleted_at IS NULL`;
      } else sql += ` WHERE id=$9 AND deleted_at IS NULL`;
      const result = await pool.query(
        `${sql} RETURNING id,name,username,email,role,unit_id,active`,
        values,
      );
      if (!result.rowCount)
        return res
          .status(404)
          .json({ error: "NOT_FOUND", message: "Usuário não encontrado." });
      res.json({ user: result.rows[0] });
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
      if (req.params.id === req.session.user.id && !req.validatedBody.active)
        return res.status(409).json({
          error: "CURRENT_USER_PROTECTED",
          message: "Você não pode desativar a própria conta.",
        });
      const result = await pool.query(
        "UPDATE users SET active=$2,updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id",
        [req.params.id, req.validatedBody.active],
      );
      if (!result.rowCount)
        return res
          .status(404)
          .json({ error: "NOT_FOUND", message: "Usuário não encontrado." });
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
      if (req.params.id === req.session.user.id)
        return res.status(409).json({
          error: "CURRENT_USER_PROTECTED",
          message: "Você não pode excluir a própria conta.",
        });
      const target = await pool.query(
        "SELECT role FROM users WHERE id=$1 AND deleted_at IS NULL",
        [req.params.id],
      );
      if (!target.rowCount)
        return res
          .status(404)
          .json({ error: "NOT_FOUND", message: "Usuário não encontrado." });
      const masters = await pool.query(
        "SELECT count(*)::int AS total FROM users WHERE role='MASTER' AND active AND deleted_at IS NULL",
      );
      if (target.rows[0].role === "MASTER" && masters.rows[0].total <= 1)
        return res.status(409).json({
          error: "LAST_MASTER",
          message: "O último master não pode ser excluído.",
        });
      await pool.query(
        "UPDATE users SET active=false,deleted_at=now(),updated_at=now() WHERE id=$1",
        [req.params.id],
      );
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
