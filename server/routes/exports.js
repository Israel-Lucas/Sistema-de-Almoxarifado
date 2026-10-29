const express = require("express");
const pool = require("../database/pool");
const { requireAuth, requireMaster } = require("../middleware/auth");
const { sendCsv } = require("../utils/csv");

const router = express.Router();
const date = (value) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "medium",
        timeZone: "America/Sao_Paulo",
      }).format(new Date(value))
    : "";
const filename = (name) =>
  `${name}_${new Date().toISOString().slice(0, 10)}.csv`;

router.get("/inventory", requireAuth, requireMaster, async (req, res, next) => {
  try {
    const {
      unit = "",
      type = "",
      model = "",
      item = "",
      situation = "",
    } = req.query;
    const result = await pool.query(
      `SELECT p.name,p.model,pt.name AS type_name,u.name AS unit_name,i.quantity::int FROM inventory i JOIN products p ON p.id=i.product_id JOIN product_types pt ON pt.id=p.type_id JOIN units u ON u.id=i.unit_id WHERE p.deleted_at IS NULL AND u.deleted_at IS NULL AND ($1='' OR u.id::text=$1) AND ($2='' OR pt.id::text=$2) AND ($3='' OR p.model=$3) AND ($4='' OR p.id::text=$4) AND ($5='' OR ($5='EMPTY' AND u.code='MATRIZ' AND i.quantity=0) OR ($5='WARNING' AND u.code='MATRIZ' AND i.quantity BETWEEN 1 AND 5) OR ($5='AVAILABLE' AND u.code='MATRIZ' AND i.quantity>5)) ORDER BY u.name,p.name`,
      [unit, type, model, item, situation],
    );
    sendCsv(
      res,
      filename("estoque"),
      ["Item", "Modelo", "Tipo", "Unidade", "Quantidade"],
      result.rows.map((r) => [
        r.name,
        r.model,
        r.type_name,
        r.unit_name,
        r.quantity,
      ]),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/movements", requireAuth, requireMaster, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT m.created_at,p.name,u.name AS unit_name,us.name AS user_name,m.kind,m.quantity,m.quantity_before,m.quantity_after,m.note FROM inventory_movements m JOIN products p ON p.id=m.product_id JOIN units u ON u.id=m.unit_id JOIN users us ON us.id=m.performed_by ORDER BY m.created_at DESC`,
    );
    sendCsv(
      res,
      filename("movimentacoes"),
      [
        "Data",
        "Item",
        "Unidade",
        "Usuário",
        "Operação",
        "Quantidade",
        "Antes",
        "Depois",
        "Nota",
      ],
      result.rows.map((r) => [
        date(r.created_at),
        r.name,
        r.unit_name,
        r.user_name,
        r.kind,
        r.quantity,
        r.quantity_before,
        r.quantity_after,
        r.note,
      ]),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/requests", requireAuth, async (req, res, next) => {
  try {
    const master = req.session.user.role === "MASTER",
      { status = "", search = "" } = req.query;
    const result = await pool.query(
      `SELECT g.order_number AS request_number,g.created_at,es.name AS kit_name,g.equipment_set_quantity,p.name,u.name AS unit_name,ru.name AS user_name,r.requested_quantity,r.approved_quantity,g.reason,r.status,r.delivery_status,COALESCE(r.decision_note,g.cancellation_reason) AS note FROM requests r JOIN request_groups g ON g.id=r.group_id LEFT JOIN equipment_sets es ON es.id=g.equipment_set_id JOIN products p ON p.id=r.product_id JOIN units u ON u.id=g.unit_id JOIN users ru ON ru.id=g.requested_by WHERE ($1::boolean OR g.unit_id=$2) AND ($3='' OR g.status=$3) AND ($4='' OR p.name ILIKE '%'||$4||'%' OR es.name ILIKE '%'||$4||'%' OR u.name ILIKE '%'||$4||'%') ORDER BY g.created_at DESC,p.name`,
      [master, req.session.user.unitId, status, search],
    );
    sendCsv(
      res,
      filename("pedidos"),
      [
        "Número",
        "Data",
        "Kit",
        "Qtd. de kits",
        "Item",
        "Unidade",
        "Usuário",
        "Solicitada",
        "Aprovada",
        "Motivo",
        "Status",
        "Entrega",
        "Nota",
      ],
      result.rows.map((r) => [
        r.request_number,
        date(r.created_at),
        r.kit_name || "Item avulso",
        r.equipment_set_quantity || "",
        r.name,
        r.unit_name,
        r.user_name,
        r.requested_quantity,
        r.approved_quantity,
        r.reason,
        r.status,
        r.delivery_status,
        r.note,
      ]),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/purchases", requireAuth, async (req, res, next) => {
  try {
    const master = req.session.user.role === "MASTER";
    const { search = "", status = "" } = req.query;
    const result = await pool.query(
      `SELECT pr.request_number,pr.created_at,pr.item_name,pr.quantity,u.name unit_name,us.name user_name,pr.priority,pr.estimated_value,pr.justification,pr.reference_link,pr.status,pr.analysis_note,pr.purchase_note
       FROM purchase_requests pr JOIN units u ON u.id=pr.unit_id JOIN users us ON us.id=pr.requested_by
       WHERE ($1::boolean OR pr.unit_id=$2) AND ($3='' OR pr.status=$3) AND ($4='' OR pr.item_name ILIKE '%'||$4||'%' OR u.name ILIKE '%'||$4||'%') ORDER BY pr.created_at DESC`,
      [master, req.session.user.unitId, status, search],
    );
    sendCsv(
      res,
      filename("solicitacoes_de_compra"),
      [
        "Número",
        "Data",
        "Item",
        "Quantidade",
        "Unidade",
        "Usuário",
        "Prioridade",
        "Valor estimado",
        "Justificativa",
        "Link",
        "Status",
        "Nota da análise",
        "Nota da compra",
      ],
      result.rows.map((r) => [
        r.request_number,
        date(r.created_at),
        r.item_name,
        r.quantity,
        r.unit_name,
        r.user_name,
        r.priority,
        r.estimated_value,
        r.justification,
        r.reference_link,
        r.status,
        r.analysis_note,
        r.purchase_note,
      ]),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/returns", requireAuth, async (req, res, next) => {
  try {
    const master = req.session.user.role === "MASTER";
    const { search = "", status = "" } = req.query;
    const result = await pool.query(
      `SELECT g.return_number,g.created_at,u.name AS unit_name,usr.name AS user_name,p.name,p.model,ri.quantity,
        g.reason,g.status,g.cancellation_reason,g.received_at
       FROM unit_return_groups g JOIN unit_return_items ri ON ri.return_group_id=g.id
       JOIN products p ON p.id=ri.product_id JOIN units u ON u.id=g.unit_id JOIN users usr ON usr.id=g.requested_by
       WHERE ($1::boolean OR g.unit_id=$2) AND ($3='' OR g.status=$3)
         AND ($4='' OR p.name ILIKE '%'||$4||'%' OR u.name ILIKE '%'||$4||'%' OR g.return_number::text=$4)
       ORDER BY g.created_at DESC,p.name`,
      [master, req.session.user.unitId, status, search],
    );
    sendCsv(
      res,
      filename("devolucoes"),
      [
        "Número",
        "Data",
        "Unidade",
        "Usuário",
        "Item",
        "Modelo",
        "Quantidade",
        "Motivo",
        "Status",
        "Motivo do cancelamento",
        "Recebida em",
      ],
      result.rows.map((row) => [
        row.return_number,
        date(row.created_at),
        row.unit_name,
        row.user_name,
        row.name,
        row.model,
        row.quantity,
        row.reason,
        row.status,
        row.cancellation_reason,
        date(row.received_at),
      ]),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/audit", requireAuth, requireMaster, async (req, res, next) => {
  try {
    const { search = "", method = "" } = req.query;
    const result = await pool.query(
      `SELECT a.created_at,u.name AS user_name,un.name AS unit_name,a.method,a.action,a.resource,a.details FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN units un ON un.id=a.unit_id WHERE ($1='' OR a.method=$1) AND ($2='' OR u.name ILIKE '%'||$2||'%' OR un.name ILIKE '%'||$2||'%' OR a.resource ILIKE '%'||$2||'%') ORDER BY a.created_at DESC`,
      [method, search],
    );
    sendCsv(
      res,
      filename("registros"),
      ["Data", "Usuário", "Unidade", "Método", "Ação", "Recurso", "Detalhes"],
      result.rows.map((r) => [
        date(r.created_at),
        r.user_name,
        r.unit_name,
        r.method,
        r.action,
        r.resource,
        JSON.stringify(r.details),
      ]),
    );
  } catch (error) {
    next(error);
  }
});

module.exports = router;
