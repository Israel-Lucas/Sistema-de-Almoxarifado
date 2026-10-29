const nodemailer = require("nodemailer");
const config = require("../config");
const pool = require("../database/pool");

let running = false;
let rerunRequested = false;
const enabled = Boolean(
  config.smtp.host && config.smtp.user && config.smtp.password,
);
const transporter = enabled
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.password },
    })
  : null;

async function processEmailOutbox() {
  if (!enabled) return;
  if (running) {
    rerunRequested = true;
    return;
  }
  running = true;
  rerunRequested = false;
  const client = await pool.connect();
  try {
    const pending = await client.query(
      `SELECT id,recipient,subject,body FROM email_outbox WHERE status IN ('PENDING','FAILED') AND attempts<5 ORDER BY created_at LIMIT 10`,
    );
    for (const email of pending.rows) {
      try {
        await transporter.sendMail({
          from: config.emailFrom,
          to: email.recipient,
          subject: email.subject,
          text: email.body,
        });
        await client.query(
          `UPDATE email_outbox SET status='SENT',attempts=attempts+1,last_error=NULL,sent_at=now() WHERE id=$1`,
          [email.id],
        );
      } catch (error) {
        await client.query(
          `UPDATE email_outbox SET status='FAILED',attempts=attempts+1,last_error=$2 WHERE id=$1`,
          [email.id, String(error.message).slice(0, 500)],
        );
      }
    }
  } finally {
    client.release();
    running = false;
    if (rerunRequested)
      setImmediate(() => processEmailOutbox().catch(console.error));
  }
}

function startEmailWorker() {
  if (!enabled) {
    console.warn(
      "SMTP não configurado: e-mails permanecerão na fila até a configuração ser informada.",
    );
    return;
  }
  processEmailOutbox().catch(console.error);
  setInterval(() => processEmailOutbox().catch(console.error), 5_000).unref();
}

function queueEmailProcessing() {
  rerunRequested = true;
  setImmediate(() => processEmailOutbox().catch(console.error));
}

module.exports = { startEmailWorker, processEmailOutbox, queueEmailProcessing };
