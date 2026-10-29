const pool = require("../database/pool");

const actionNames = {
  POST: "CRIAR_EXECUTAR",
  PUT: "ATUALIZAR",
  PATCH: "ALTERAR",
  DELETE: "EXCLUIR",
  GET: "EXPORTAR",
};
const sanitize = (body) => {
  if (!body || typeof body !== "object") return {};
  const clean = { ...body };
  for (const key of [
    "password",
    "currentPassword",
    "newPassword",
    "password_hash",
    "SESSION_SECRET",
  ])
    if (key in clean) clean[key] = "[PROTEGIDO]";
  return clean;
};

function auditMiddleware(req, res, next) {
  if (["HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.method === "GET" && !req.originalUrl.startsWith("/api/exports/"))
    return next();
  if (req.originalUrl === "/api/notifications/read-all") return next();
  res.on("finish", () => {
    if (res.statusCode < 200 || res.statusCode >= 400) return;
    const user = req.session?.user;
    if (!user) return;
    pool
      .query(
        `INSERT INTO audit_logs(user_id,unit_id,method,action,resource,details,ip_address) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          user.id,
          user.unitId,
          req.method,
          actionNames[req.method] || req.method,
          req.originalUrl,
          JSON.stringify(req.method === "GET" ? req.query : sanitize(req.body)),
          req.ip,
        ],
      )
      .catch((error) =>
        console.error("Falha ao registrar auditoria:", error.message),
      );
  });
  next();
}

module.exports = auditMiddleware;
