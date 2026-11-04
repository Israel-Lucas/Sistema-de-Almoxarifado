const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const required = ["DATABASE_URL", "SESSION_SECRET"];
const missing = required.filter((name) => !process.env[name]);

if (missing.length) {
  throw new Error(
    `Configuração ausente: ${missing.join(", ")}. Copie .env.example para .env.`,
  );
}

if (process.env.SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET deve possuir pelo menos 32 caracteres.");
}

module.exports = Object.freeze({
  env: process.env.NODE_ENV || "development",
  host: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL,
  sessionSecret: process.env.SESSION_SECRET,
  sessionHours: Math.max(1, Number(process.env.SESSION_HOURS || 8)),
  emailFrom: process.env.EMAIL_FROM || process.env.SMTP_USER || "",
  smtp: Object.freeze({
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER || "",
    password: process.env.SMTP_PASSWORD || "",
  }),
});
