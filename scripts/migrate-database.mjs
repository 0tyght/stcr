import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "database", "migrations");
const baselineOnly = process.argv.includes("--baseline");
const password = String(process.env.STCR_DB_PASSWORD || "");
if (!password) throw new Error("STCR_DB_PASSWORD is required");

const connection = await mysql.createConnection({
  host: process.env.STCR_DB_HOST || "127.0.0.1",
  port: Number(process.env.STCR_DB_PORT || 3306),
  user: process.env.STCR_DB_MIGRATION_USER || process.env.STCR_DB_USER || "stcr_app",
  password: process.env.STCR_DB_MIGRATION_PASSWORD || password,
  database: process.env.STCR_DB_NAME || "stcr",
  timezone: "Z",
  multipleStatements: true,
});

try {
  await connection.query("SET time_zone = '+00:00'");
  await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_name VARCHAR(160) NOT NULL,
    checksum_sha256 CHAR(64) NOT NULL,
    applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (migration_name)
  ) ENGINE=InnoDB`);

  const files = (await readdir(migrationsDir))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort((left, right) => left.localeCompare(right));
  const [rows] = await connection.query(
    "SELECT migration_name AS name, checksum_sha256 AS checksum FROM schema_migrations",
  );
  const applied = new Map(rows.map((row) => [row.name, row.checksum]));

  for (const name of files) {
    const sql = await readFile(join(migrationsDir, name), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    if (applied.has(name)) {
      if (applied.get(name) !== checksum) throw new Error(`Migration checksum changed: ${name}`);
      continue;
    }

    if (!baselineOnly) await connection.query(sql);
    await connection.execute(
      "INSERT INTO schema_migrations (migration_name, checksum_sha256, applied_at) VALUES (?, ?, UTC_TIMESTAMP(3))",
      [name, checksum],
    );
    console.log(`${baselineOnly ? "Baselined" : "Applied"}: ${name}`);
  }
} finally {
  await connection.end();
}
