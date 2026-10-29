const bcrypt = require("bcryptjs");
const pool = require("./pool");

const normalize = (value) => value.trim().toLocaleUpperCase("pt-BR");

async function seed() {
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
    const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
    await client.query(
      `INSERT INTO users(username, normalized_username, name, password_hash, role, unit_id)
       VALUES ($1, $2, $3, $4, 'MASTER', $5)
       ON CONFLICT (normalized_username) DO NOTHING`,
      [
        "usuario_master",
        normalize("usuario_master"),
        "sua empresa",
        passwordHash,
        unitId,
      ],
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
