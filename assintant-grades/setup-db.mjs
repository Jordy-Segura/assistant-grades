import pg from "pg";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const candidates = [
    resolve(__dirname, "server", ".env"),
    resolve(__dirname, ".env"),
    resolve(__dirname, ".env.local"),
  ];
  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    const lines = readFileSync(envPath, "utf-8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

loadEnv();

const DATABASE_URL = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "";
if (!DATABASE_URL) {
  console.error("ERROR: configure DATABASE_URL_UNPOOLED o DATABASE_URL antes de ejecutar setup-db.mjs.");
  process.exit(1);
}

const schemaFile = process.env.DB_SCHEMA_FILE || "neon-schema.sql";
const schemaPath = resolve(__dirname, schemaFile);
const schemaSql = readFileSync(schemaPath, "utf-8");
const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  console.log("Conectando a PostgreSQL/Neon...");
  const client = await pool.connect();
  try {
    console.log(`Ejecutando ${schemaFile}...`);
    await client.query(schemaSql);
    const tables = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE 'app_%'
      ORDER BY table_name
    `);
    console.log("Tablas app_*:", tables.rows.map((r) => r.table_name).join(", "));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
