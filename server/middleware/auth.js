function requireAuth(req, res, next) {
  if (!req.session?.user)
    return res.status(401).json({
      error: "AUTH_REQUIRED",
      message: "Sessão inexistente ou expirada.",
    });
  next();
}

function requireMaster(req, res, next) {
  if (req.session.user.role !== "MASTER")
    return res.status(403).json({
      error: "FORBIDDEN",
      message: "Ação permitida somente para master.",
    });
  next();
}

function requireMatrixMaster(req, res, next) {
  if (
    req.session.user.role !== "MASTER" ||
    req.session.user.unitCode !== "MATRIZ"
  ) {
    return res.status(403).json({
      error: "FORBIDDEN",
      message: "Ação permitida somente ao master da Matriz.",
    });
  }
  next();
}

module.exports = { requireAuth, requireMaster, requireMatrixMaster };
