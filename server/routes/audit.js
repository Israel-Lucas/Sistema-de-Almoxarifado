const express = require("express");
const pool = require("../database/pool");
const { requireAuth, requireMaster } = require("../middleware/auth");
const { pagination, metadata } = require("../utils/pagination");
const router = express.Router();

router.get("/", requireAuth, requireMaster, async (req, res, next) => {
  try {
    const { page, limit, offset } = pagination(req.query, 25);
    const search = String(req.query.search || "").trim(),
      method = String(req.query.method || "").trim();
    const [result, products, units, users, types, requests] = await Promise.all(
      [
        pool.query(
          `SELECT a.id,a.method,a.action,a.resource,a.details,a.ip_address,a.created_at,u.name AS user_name,u.username,un.name AS unit_name,count(*) OVER()::int AS total_count FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN units un ON un.id=a.unit_id WHERE ($1='' OR a.method=$1) AND ($2='' OR u.name ILIKE '%'||$2||'%' OR un.name ILIKE '%'||$2||'%' OR a.resource ILIKE '%'||$2||'%') ORDER BY a.created_at DESC,a.id DESC LIMIT $3 OFFSET $4`,
          [method, search, limit, offset],
        ),
        pool.query("SELECT id,name,model FROM products"),
        pool.query("SELECT id,name FROM units"),
        pool.query("SELECT id,name,username FROM users"),
        pool.query("SELECT id,name FROM product_types"),
        pool.query("SELECT id,request_number FROM requests"),
      ],
    );
    res.json({
      logs: result.rows,
      pagination: metadata(result.rows[0]?.total_count || 0, page, limit),
      references: {
        products: products.rows,
        units: units.rows,
        users: users.rows,
        types: types.rows,
        requests: requests.rows,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
