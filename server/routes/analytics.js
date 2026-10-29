const express = require("express");
const { z } = require("zod");
const pool = require("../database/pool");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
const querySchema = z.object({
  days: z.coerce.number().int().min(0).max(1825).default(90),
  unit: z.string().uuid().optional(),
  product: z.string().uuid().optional(),
  type: z.string().uuid().optional(),
});

router.get("/dashboard", requireAuth, async (req, res, next) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success)
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Os filtros informados não são válidos.",
      });

    const isMaster = req.session.user.role === "MASTER";
    const filters = parsed.data;
    const unitId = isMaster ? filters.unit || null : req.session.user.unitId;
    const params = [
      filters.days,
      unitId,
      filters.product || null,
      filters.type || null,
    ];
    const period = `($1::int = 0 OR value >= now() - make_interval(days => $1::int))`;
    const scope = `($2::uuid IS NULL OR g.unit_id=$2) AND ($3::uuid IS NULL OR r.product_id=$3) AND ($4::uuid IS NULL OR p.type_id=$4)`;

    const [
      summary,
      trend,
      topProducts,
      topKits,
      topUnits,
      pending,
      movements,
      unused,
      purchases,
    ] = await Promise.all([
      pool.query(
        `SELECT count(*)::int AS orders,
             count(*) FILTER (WHERE status='SOLICITADO')::int AS pending,
             count(*) FILTER (WHERE status='RECUSADO')::int AS rejected,
             count(*) FILTER (WHERE delivery_status='ENTREGUE')::int AS delivered,
             COALESCE(round(avg(extract(epoch FROM (decided_at-created_at))/3600) FILTER (WHERE decided_at IS NOT NULL)::numeric,1),0)::float AS approval_hours,
             COALESCE(round(avg(extract(epoch FROM (delivered_at-decided_at))/3600) FILTER (WHERE delivered_at IS NOT NULL AND decided_at IS NOT NULL)::numeric,1),0)::float AS delivery_hours
           FROM (SELECT DISTINCT g.id,g.status,g.delivery_status,g.created_at,g.decided_at,g.delivered_at
             FROM request_groups g JOIN requests r ON r.group_id=g.id JOIN products p ON p.id=r.product_id
             WHERE ${scope} AND ${period.replace("value", "g.created_at")}) selected`,
        params,
      ),
      pool.query(
        `SELECT to_char(date_trunc('month',g.created_at),'YYYY-MM') AS period,
             count(DISTINCT g.id)::int AS orders,
             count(DISTINCT g.id) FILTER (WHERE g.status='RECUSADO')::int AS rejected,
             count(DISTINCT g.id) FILTER (WHERE g.delivery_status='ENTREGUE')::int AS delivered
           FROM request_groups g JOIN requests r ON r.group_id=g.id JOIN products p ON p.id=r.product_id
           WHERE ${scope} AND ${period.replace("value", "g.created_at")}
           GROUP BY date_trunc('month',g.created_at) ORDER BY date_trunc('month',g.created_at)`,
        params,
      ),
      pool.query(
        `SELECT p.id,p.name,p.model,sum(r.requested_quantity)::int AS requested,
             COALESCE(sum(r.approved_quantity) FILTER (WHERE r.delivery_status='ENTREGUE'),0)::int AS delivered
           FROM request_groups g JOIN requests r ON r.group_id=g.id JOIN products p ON p.id=r.product_id
           WHERE ${scope} AND g.status<>'CANCELADO' AND ${period.replace("value", "g.created_at")}
           GROUP BY p.id,p.name,p.model ORDER BY requested DESC,p.name LIMIT 8`,
        params,
      ),
      pool.query(
        `SELECT es.id,es.name,sum(selected.kit_quantity)::int AS requested
           FROM (
             SELECT DISTINCT g.id,g.equipment_set_id,g.equipment_set_quantity::int AS kit_quantity
             FROM request_groups g JOIN requests r ON r.group_id=g.id JOIN products p ON p.id=r.product_id
             WHERE ${scope} AND g.equipment_set_id IS NOT NULL AND g.status<>'CANCELADO'
               AND ${period.replace("value", "g.created_at")}
           ) selected JOIN equipment_sets es ON es.id=selected.equipment_set_id
           GROUP BY es.id,es.name ORDER BY requested DESC,es.name LIMIT 8`,
        params,
      ),
      pool.query(
        `SELECT u.id,u.name,COALESCE(sum(r.approved_quantity),0)::int AS consumed
           FROM request_groups g JOIN requests r ON r.group_id=g.id JOIN products p ON p.id=r.product_id JOIN units u ON u.id=g.unit_id
           WHERE ${scope} AND r.delivery_status='ENTREGUE' AND ${period.replace("value", "g.delivered_at")}
           GROUP BY u.id,u.name ORDER BY consumed DESC,u.name LIMIT 8`,
        params,
      ),
      pool.query(
        `SELECT g.id,g.order_number,u.name AS unit_name,usr.name AS requested_by,
             g.created_at,extract(epoch FROM (now()-g.created_at))::bigint AS age_seconds,
             count(r.id)::int AS items,sum(r.requested_quantity)::int AS quantity
           FROM request_groups g JOIN requests r ON r.group_id=g.id JOIN products p ON p.id=r.product_id
           JOIN units u ON u.id=g.unit_id JOIN users usr ON usr.id=g.requested_by
           WHERE ${scope} AND g.status='SOLICITADO' AND ${period.replace("value", "g.created_at")}
           GROUP BY g.id,u.name,usr.name ORDER BY g.created_at ASC LIMIT 10`,
        params,
      ),
      pool.query(
        `SELECT m.kind,count(*)::int AS operations,sum(m.quantity)::int AS quantity
           FROM inventory_movements m JOIN products p ON p.id=m.product_id
           WHERE ($2::uuid IS NULL OR m.unit_id=$2) AND ($3::uuid IS NULL OR m.product_id=$3)
             AND ($4::uuid IS NULL OR p.type_id=$4) AND ${period.replace("value", "m.created_at")}
           GROUP BY m.kind ORDER BY quantity DESC`,
        params,
      ),
      pool.query(
        `SELECT p.id,p.name,p.model,pt.name AS type_name,COALESCE(i.quantity,0)::int AS quantity,
             GREATEST(max(r.created_at),max(m.created_at)) AS last_used_at
           FROM products p JOIN product_types pt ON pt.id=p.type_id
           JOIN units matrix ON matrix.code='MATRIZ' AND matrix.deleted_at IS NULL
           LEFT JOIN inventory i ON i.product_id=p.id AND i.unit_id=matrix.id
           LEFT JOIN requests r ON r.product_id=p.id AND r.created_at>=now()-interval '90 days'
           LEFT JOIN inventory_movements m ON m.product_id=p.id AND m.created_at>=now()-interval '90 days'
           WHERE p.deleted_at IS NULL AND ($1::uuid IS NULL OR p.id=$1) AND ($2::uuid IS NULL OR p.type_id=$2)
           GROUP BY p.id,p.name,p.model,pt.name,i.quantity
           HAVING max(r.created_at) IS NULL AND max(m.created_at) IS NULL
           ORDER BY quantity DESC,p.name LIMIT 10`,
        [filters.product || null, filters.type || null],
      ),
      pool.query(
        `SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status IN ('SOLICITADO','APROVADO','EM_COMPRA'))::int AS pending
           FROM purchase_requests pr
           WHERE ($2::uuid IS NULL OR pr.unit_id=$2) AND ${period.replace("value", "pr.created_at")}`,
        [filters.days, unitId],
      ),
    ]);

    res.json({
      filters: { days: filters.days, unitId },
      summary: {
        ...summary.rows[0],
        purchaseRequests: purchases.rows[0].total,
        pendingPurchases: purchases.rows[0].pending,
      },
      trend: trend.rows,
      topProducts: topProducts.rows,
      topKits: topKits.rows,
      topUnits: isMaster ? topUnits.rows : [],
      oldestPending: pending.rows,
      movements: isMaster ? movements.rows : [],
      unusedProducts: isMaster ? unused.rows : [],
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
