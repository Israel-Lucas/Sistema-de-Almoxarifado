const bcrypt = require("bcryptjs");
const pool = require("./pool");

const normalize = (value) => value.trim().toLocaleUpperCase("pt-BR");

async function seed() {
  const required = ["ADMIN_USERNAME", "ADMIN_NAME", "ADMIN_PASSWORD"];
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    throw new Error(
      `Configuração ausente: ${missing.join(", ")}. Defina as credenciais do administrador no .env.`,
    );
  }

  const username = process.env.ADMIN_USERNAME.trim();
  const name = process.env.ADMIN_NAME.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (username.length > 100 || name.length > 100) {
    throw new Error(
      "ADMIN_USERNAME e ADMIN_NAME devem ter até 100 caracteres.",
    );
  }
  if (password.length < 12 || password.length > 100) {
    throw new Error("ADMIN_PASSWORD deve ter entre 12 e 100 caracteres.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const unitResult = await client.query(
      `INSERT INTO units(code, name, normalized_name, protected)
       VALUES ('MATRIZ', 'Matriz', 'MATRIZ', true)
       ON CONFLICT (code) DO UPDATE SET active = true, deleted_at = NULL
       RETURNING id`,
    );
    const unitId = unitResult.rows[0].id;
    const passwordHash = await bcrypt.hash(password, 12);
    await client.query(
      `INSERT INTO users(username, normalized_username, name, password_hash, role, unit_id)
       VALUES ($1, $2, $3, $4, 'MASTER', $5)
       ON CONFLICT (normalized_username) DO NOTHING`,
      [username, normalize(username), name, passwordHash, unitId],
    );
    await client.query("COMMIT");
    console.log("Matriz e usuário master inicial preparados.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
