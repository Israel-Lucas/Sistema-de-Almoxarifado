const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const config = require("./config");
const pool = require("./database/pool");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const unitRoutes = require("./routes/units");
const typeRoutes = require("./routes/types");
const productRoutes = require("./routes/products");
const inventoryRoutes = require("./routes/inventory");
const requestRoutes = require("./routes/requests");
const purchaseRequestRoutes = require("./routes/purchase-requests");
const notificationRoutes = require("./routes/notifications");
const auditRoutes = require("./routes/audit");
const exportRoutes = require("./routes/exports");
const analyticsRoutes = require("./routes/analytics");
const equipmentSetRoutes = require("./routes/equipment-sets");
const returnRoutes = require("./routes/returns");
const auditMiddleware = require("./middleware/audit");
const { startEmailWorker } = require("./services/email-worker");
const { notFound, errorHandler } = require("./middleware/errors");

const app = express();
const root = path.resolve(__dirname, "..");
const noStore = {
  maxAge: 0,
  setHeaders: (res) => res.setHeader("Cache-Control", "no-store"),
};
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
        "upgrade-insecure-requests": null,
      },
    },
    strictTransportSecurity: false,
  }),
);
app.use(express.json({ limit: "32kb" }));
app.use(
  session({
    store: new pgSession({ pool, tableName: "user_sessions" }),
    name: "almoxarifado.sid",
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      secure: config.env === "production",
      maxAge: config.sessionHours * 60 * 60 * 1000,
    },
  }),
);
app.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (origin && origin !== `${req.protocol}://${req.get("host")}`)
    return res.status(403).json({
      error: "INVALID_ORIGIN",
      message: "Origem da requisição não permitida.",
    });
  next();
});

app.use(auditMiddleware);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/units", unitRoutes);
app.use("/api/types", typeRoutes);
app.use("/api/products", productRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/requests", requestRoutes);
app.use("/api/purchase-requests", purchaseRequestRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/exports", exportRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/equipment-sets", equipmentSetRoutes);
app.use("/api/returns", returnRoutes);
app.use("/assets", express.static(path.join(root, "assets"), { maxAge: "1d" }));
app.use("/styles", express.static(path.join(root, "styles"), noStore));
app.use("/scripts", express.static(path.join(root, "scripts"), noStore));
app.use("/html", express.static(path.join(root, "html"), noStore));
app.get("/", (req, res) => res.redirect("/html/login.html"));
app.use(notFound);
app.use(errorHandler);

const server = app.listen(config.port, config.host, () =>
  console.log(
    `Almoxarifado disponível em http://${config.host}:${config.port}`,
  ),
);
startEmailWorker();
async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
