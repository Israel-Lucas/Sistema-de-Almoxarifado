const express = require("express");
const bcrypt = require("bcryptjs");
const { rateLimit } = require("express-rate-limit");
const { z } = require("zod");
const pool = require("../database/pool");
const validate = require("../middleware/validate");
const { requireAuth } = require("../middleware/auth");
const { normalize } = require("../utils/text");

const router = express.Router();
const credentialsSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(100),
});
const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(100),
  newPassword: z.string().min(4).max(100),
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

router.post(
  "/login",
  loginLimiter,
  validate(credentialsSchema),
  async (req, res, next) => {
    try {
      const { username, password } = req.validatedBody;
      const result = await pool.query(
        `SELECT u.id, u.username, u.name, u.password_hash, u.role, u.active, u.failed_login_attempts, u.locked_until,
              un.id AS unit_id, un.code AS unit_code, un.name AS unit_name, un.active AS unit_active
       FROM users u JOIN units un ON un.id = u.unit_id
       WHERE u.normalized_username = $1 AND u.deleted_at IS NULL`,
        [normalize(username)],
      );
      const user = result.rows[0];
      if (!user || !user.active || !user.unit_active)
        return res.status(401).json({
          error: "INVALID_CREDENTIALS",
          message: "Usuário ou senha inválidos.",
        });
      if (user.locked_until && new Date(user.locked_until) > new Date())
        return res.status(423).json({
          error: "ACCOUNT_LOCKED",
          message:
            "Conta temporariamente bloqueada. Tente novamente mais tarde.",
        });

      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) {
        const attempts = user.failed_login_attempts + 1;
        await pool.query(
          `UPDATE users SET failed_login_attempts = $2, locked_until = CASE WHEN $2 >= 5 THEN now() + interval '15 minutes' ELSE NULL END WHERE id = $1`,
          [user.id, Math.min(attempts, 10)],
        );
        return res.status(401).json({
          error: "INVALID_CREDENTIALS",
          message: "Usuário ou senha inválidos.",
        });
      }

      await pool.query(
        "UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1",
        [user.id],
      );
      req.session.regenerate((sessionError) => {
        if (sessionError) return next(sessionError);
        req.session.user = {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role,
          unitId: user.unit_id,
          unitCode: user.unit_code,
          unitName: user.unit_name,
        };
        res.json({ user: req.session.user });
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get("/me", requireAuth, (req, res) =>
  res.json({ user: req.session.user }),
);

router.post("/logout", requireAuth, (req, res, next) => {
  req.session.destroy((error) => (error ? next(error) : res.status(204).end()));
});

router.put(
  "/password",
  requireAuth,
  validate(passwordSchema),
  async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.validatedBody;
      const result = await pool.query(
        "SELECT password_hash FROM users WHERE id = $1 AND active",
        [req.session.user.id],
      );
      if (
        !result.rowCount ||
        !(await bcrypt.compare(currentPassword, result.rows[0].password_hash))
      ) {
        return res.status(400).json({
          error: "INVALID_PASSWORD",
          message: "A senha atual está incorreta.",
        });
      }
      await pool.query(
        "UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now() WHERE id = $1",
        [req.session.user.id, await bcrypt.hash(newPassword, 12)],
      );
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
