function notFound(req, res) {
  if (!req.originalUrl.startsWith("/api/") && req.accepts("html")) {
    return res
      .status(404)
      .sendFile(
        require("node:path").resolve(__dirname, "..", "..", "html", "404.html"),
      );
  }
  res
    .status(404)
    .json({ error: "NOT_FOUND", message: "Recurso não encontrado." });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  console.error(error);
  if (error.name === "MulterError")
    return res.status(400).json({
      error: "INVALID_ATTACHMENT",
      message:
        error.code === "LIMIT_FILE_SIZE"
          ? "Cada anexo pode ter no máximo 5 MB."
          : "Envie no máximo 3 anexos por solicitação.",
    });
  if (error.code === "23505")
    return res.status(409).json({
      error: "DUPLICATE",
      message: "Já existe um registro com estes dados.",
    });
  if (error.code === "23503")
    return res.status(409).json({
      error: "IN_USE",
      message: "O registro possui vínculos e não pode ser removido.",
    });
  if (
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status < 600
  )
    return res.status(error.status).json({
      error: error.code || "REQUEST_ERROR",
      message: error.message,
    });
  res.status(500).json({
    error: "INTERNAL_ERROR",
    message: "Não foi possível concluir a operação.",
  });
}

module.exports = { notFound, errorHandler };
