const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const express = require("express");
const multer = require("multer");
const { z } = require("zod");
const pool = require("../database/pool");
const { requireAuth, requireMaster } = require("../middleware/auth");
const validate = require("../middleware/validate");
const { normalize } = require("../utils/text");
const { pagination, metadata } = require("../utils/pagination");
const { queueEmailProcessing } = require("../services/email-worker");

const router = express.Router();
const uploadDirectory = path.resolve(
  __dirname,
  "..",
  "..",
  "storage",
  "purchase-attachments",
);
fs.mkdirSync(uploadDirectory, { recursive: true });
const allowed = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDirectory,
    filename: (req, file, cb) =>
      cb(
        null,
        `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`,
      ),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 3 },
  fileFilter: (req, file, cb) => {
    if (allowed.has(file.mimetype)) return cb(null, true);
    const error = new Error("Envie apenas arquivos PDF, JPG, PNG ou WEBP.");
    error.status = 400;
    cb(error);
  },
});
const createSchema = z.object({
  itemName: z.string().trim().min(1).max(100),
  quantity: z.coerce.number().int().min(1).max(999),
  justification: z.string().trim().min(1).max(500),
  priority: z.enum(["BAIXA", "NORMAL", "ALTA", "URGENTE"]),
  estimatedValue: z
    .union([z.literal(""), z.coerce.number().min(0).max(9999999999)])
    .optional(),
  referenceLink: z.union([z.literal(""), z.string().url().max(500)]).optional(),
});

async function communicate(client, request, title, message, sendEmail = false) {
  const n = await client.query(
    "INSERT INTO notifications(title,message,link) VALUES($1,$2,'/html/pedidos.html') RETURNING id",
    [title, message],
  );
  await client.query(
    `INSERT INTO notification_recipients(notification_id,user_id)
    SELECT DISTINCT $1::uuid,u.id FROM users u JOIN units un ON un.id=u.unit_id
    WHERE u.active AND u.deleted_at IS NULL AND (u.unit_id=$2 OR (u.role='MASTER' AND un.code='MATRIZ'))`,
    [n.rows[0].id, request.unit_id],
  );
  if (sendEmail)
    await client.query(
      `INSERT INTO email_outbox(recipient,subject,body)
    SELECT DISTINCT recipient,$1,$2 FROM (SELECT 'notificacoes@suaempresa.example'::varchar recipient UNION ALL
    SELECT u.email FROM users u JOIN units un ON un.id=u.unit_id WHERE u.active AND u.deleted_at IS NULL AND u.role='MASTER' AND un.code='MATRIZ' AND u.email IS NOT NULL) x WHERE recipient IS NOT NULL`,
      [`Solicitação de compra para ${request.unit_name}`, message],
    );
}

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const master = req.session.user.role === "MASTER",
      { page, limit, offset } = pagination(req.query, 15),
      search = String(req.query.search || "").trim(),
      status = String(req.query.status || "").trim();
    const params = [master, req.session.user.unitId, search, status];
    const where =
      "WHERE ($1::boolean OR pr.unit_id=$2) AND ($3='' OR pr.item_name ILIKE '%'||$3||'%' OR u.name ILIKE '%'||$3||'%') AND ($4='' OR pr.status=$4)";
    const [rows, count] = await Promise.all([
      pool.query(
        `SELECT pr.*,u.name unit_name,us.name requested_by_name,COALESCE(json_agg(json_build_object('id',a.id,'name',a.original_name,'mimeType',a.mime_type,'size',a.size_bytes)) FILTER(WHERE a.id IS NOT NULL),'[]') attachments FROM purchase_requests pr JOIN units u ON u.id=pr.unit_id JOIN users us ON us.id=pr.requested_by LEFT JOIN purchase_request_attachments a ON a.purchase_request_id=pr.id ${where} GROUP BY pr.id,u.name,us.name ORDER BY pr.created_at DESC LIMIT $5 OFFSET $6`,
        [...params, limit, offset],
      ),
      pool.query(
        `SELECT count(*)::int total FROM purchase_requests pr JOIN units u ON u.id=pr.unit_id ${where}`,
        params,
      ),
    ]);
    res.json({
      requests: rows.rows,
      pagination: metadata(count.rows[0].total, page, limit),
    });
  } catch (e) {
    next(e);
  }
});

router.post(
  "/",
  requireAuth,
  upload.array("attachments", 3),
  async (req, res, next) => {
    const cleanup = () =>
      Promise.all(
        (req.files || []).map((f) =>
          fs.promises.unlink(f.path).catch(() => {}),
        ),
      );
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      await cleanup();
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Revise os dados da solicitação.",
      });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const unit = (
        await client.query(
          "SELECT id,name,code FROM units WHERE id=$1 AND active AND deleted_at IS NULL",
          [req.session.user.unitId],
        )
      ).rows[0];
      if (!unit || unit.code === "MATRIZ")
        throw Object.assign(
          new Error(
            "Vincule o usuário a uma unidade externa para solicitar uma compra.",
          ),
          { status: 409 },
        );
      const d = parsed.data,
        result = await client.query(
          `INSERT INTO purchase_requests(unit_id,requested_by,item_name,quantity,justification,priority,estimated_value,reference_link) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            unit.id,
            req.session.user.id,
            d.itemName,
            d.quantity,
            d.justification,
            d.priority,
            d.estimatedValue === "" ? null : d.estimatedValue,
            d.referenceLink || null,
          ],
        );
      for (const file of req.files || [])
        await client.query(
          "INSERT INTO purchase_request_attachments(purchase_request_id,original_name,stored_name,mime_type,size_bytes,uploaded_by) VALUES($1,$2,$3,$4,$5,$6)",
          [
            result.rows[0].id,
            file.originalname.slice(0, 255),
            file.filename,
            file.mimetype,
            file.size,
            req.session.user.id,
          ],
        );
      const request = { ...result.rows[0], unit_name: unit.name },
        value =
          d.estimatedValue !== "" && d.estimatedValue !== undefined
            ? `\nValor estimado: R$ ${Number(d.estimatedValue).toFixed(2)}`
            : "";
      await communicate(
        client,
        request,
        "Nova solicitação de compra",
        `Usuário ${req.session.user.name} solicitou a compra de ${d.quantity}x ${d.itemName} para ${unit.name}.\nPrioridade: ${d.priority}.\nJustificativa: ${d.justification}${value}${d.referenceLink ? `\nReferência: ${d.referenceLink}` : ""}`,
        true,
      );
      await client.query("COMMIT");
      queueEmailProcessing();
      res.status(201).json({ request: result.rows[0] });
    } catch (e) {
      await client.query("ROLLBACK");
      await cleanup();
      next(e);
    } finally {
      client.release();
    }
  },
);

router.post(
  "/:id/decision",
  requireAuth,
  requireMaster,
  validate(
    z.object({
      decision: z.enum(["APPROVE", "REJECT"]),
      note: z.string().trim().max(500).optional().default(""),
    }),
  ),
  async (req, res, next) => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const r = (
        await c.query(
          "SELECT pr.*,u.name unit_name FROM purchase_requests pr JOIN units u ON u.id=pr.unit_id WHERE pr.id=$1 FOR UPDATE",
          [req.params.id],
        )
      ).rows[0];
      if (!r)
        throw Object.assign(new Error("Solicitação não encontrada."), {
          status: 404,
        });
      if (r.status !== "SOLICITADO")
        throw Object.assign(new Error("Esta solicitação já foi analisada."), {
          status: 409,
        });
      if (req.validatedBody.decision === "REJECT" && !req.validatedBody.note)
        throw Object.assign(new Error("Informe o motivo da recusa."), {
          status: 400,
        });
      const status =
        req.validatedBody.decision === "APPROVE" ? "APROVADO" : "RECUSADO";
      await c.query(
        "UPDATE purchase_requests SET status=$2,analysis_note=$3,analyzed_by=$4,analyzed_at=now(),updated_at=now() WHERE id=$1",
        [r.id, status, req.validatedBody.note || null, req.session.user.id],
      );
      await communicate(
        c,
        r,
        "Solicitação de compra atualizada",
        `A solicitação de ${r.item_name} foi ${status === "APROVADO" ? "aprovada" : "recusada"}.${req.validatedBody.note ? ` Nota: ${req.validatedBody.note}` : ""}`,
      );
      await c.query("COMMIT");
      res.json({ status });
    } catch (e) {
      await c.query("ROLLBACK");
      next(e);
    } finally {
      c.release();
    }
  },
);
router.post(
  "/:id/purchase",
  requireAuth,
  requireMaster,
  validate(
    z.object({ note: z.string().trim().max(500).optional().default("") }),
  ),
  async (req, res, next) => {
    try {
      const r = await pool.query(
        "UPDATE purchase_requests SET status='EM_COMPRA',purchase_note=$2,purchased_by=$3,purchased_at=now(),updated_at=now() WHERE id=$1 AND status='APROVADO' RETURNING id",
        [req.params.id, req.validatedBody.note || null, req.session.user.id],
      );
      if (!r.rowCount)
        return res.status(409).json({
          error: "INVALID_STATUS",
          message: "Somente solicitações aprovadas podem entrar em compra.",
        });
      res.json({ status: "EM_COMPRA" });
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  "/:id/receive",
  requireAuth,
  requireMaster,
  validate(
    z.object({
      name: z.string().trim().min(1).max(100),
      model: z.string().trim().min(1).max(100),
      description: z.string().trim().max(500).optional().default(""),
      typeId: z.string().uuid(),
      quantity: z.number().int().min(1).max(999),
    }),
  ),
  async (req, res, next) => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const r = (
        await c.query(
          "SELECT pr.*,u.name unit_name FROM purchase_requests pr JOIN units u ON u.id=pr.unit_id WHERE pr.id=$1 FOR UPDATE",
          [req.params.id],
        )
      ).rows[0];
      if (!r)
        throw Object.assign(new Error("Solicitação não encontrada."), {
          status: 404,
        });
      if (r.status !== "EM_COMPRA")
        throw Object.assign(
          new Error("Somente itens em compra podem ser recebidos."),
          { status: 409 },
        );
      const d = req.validatedBody,
        type = await c.query(
          "SELECT id FROM product_types WHERE id=$1 AND active AND deleted_at IS NULL",
          [d.typeId],
        );
      if (!type.rowCount)
        throw Object.assign(new Error("Selecione um tipo ativo."), {
          status: 400,
        });
      const p = (
          await c.query(
            "INSERT INTO products(name,normalized_name,model,normalized_model,description,type_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
            [
              d.name,
              normalize(d.name),
              d.model,
              normalize(d.model),
              d.description || null,
              d.typeId,
              req.session.user.id,
            ],
          )
        ).rows[0],
        matrix = (
          await c.query(
            "SELECT id FROM units WHERE code='MATRIZ' AND active AND deleted_at IS NULL",
          )
        ).rows[0];
      await c.query(
        "INSERT INTO inventory(product_id,unit_id,quantity) VALUES($1,$2,$3)",
        [p.id, matrix.id, d.quantity],
      );
      await c.query(
        "INSERT INTO inventory_movements(product_id,unit_id,performed_by,kind,quantity,quantity_before,quantity_after,note) VALUES($1,$2,$3,'ENTRADA',$4,0,$4,$5)",
        [
          p.id,
          matrix.id,
          req.session.user.id,
          d.quantity,
          `RECEBIMENTO DA COMPRA ${r.request_number}`,
        ],
      );
      await c.query(
        "UPDATE purchase_requests SET status='RECEBIDO',product_id=$2,received_by=$3,received_at=now(),updated_at=now() WHERE id=$1",
        [r.id, p.id, req.session.user.id],
      );
      await communicate(
        c,
        r,
        "Compra recebida",
        `${d.quantity}x ${d.name} foram recebidos e adicionados ao estoque da Matriz.`,
      );
      await c.query("COMMIT");
      res.json({ status: "RECEBIDO", productId: p.id });
    } catch (e) {
      await c.query("ROLLBACK");
      next(e);
    } finally {
      c.release();
    }
  },
);

router.get("/attachments/:id", requireAuth, async (req, res, next) => {
  try {
    const master = req.session.user.role === "MASTER",
      a = (
        await pool.query(
          "SELECT a.*,pr.unit_id FROM purchase_request_attachments a JOIN purchase_requests pr ON pr.id=a.purchase_request_id WHERE a.id=$1 AND ($2::boolean OR pr.unit_id=$3)",
          [req.params.id, master, req.session.user.unitId],
        )
      ).rows[0];
    if (!a)
      return res
        .status(404)
        .json({ error: "NOT_FOUND", message: "Anexo não encontrado." });
    res.download(path.join(uploadDirectory, a.stored_name), a.original_name);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
