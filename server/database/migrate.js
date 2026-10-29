const fs = require("node:fs/promises");
const path = require("node:path");
const pool = require("./pool");

async function migrate() {
  const migrationsDirectory = path.join(__dirname, "migrations");
  const files = (await fs.readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("CREATE SCHEMA IF NOT EXISTS almoxarifado");
    await client.query("SET LOCAL search_path TO almoxarifado, public");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name varchar(255) PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const file of files) {
      const exists = await client.query(
        "SELECT 1 FROM schema_migrations WHERE name = $1",
        [file],
      );
      if (exists.rowCount) continue;
      await client.query(
        await fs.readFile(path.join(migrationsDirectory, file), "utf8"),
      );
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [
        file,
      ]);
      console.log(`Migration aplicada: ${file}`);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
