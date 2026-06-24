import pg from "pg";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Cargar .env manualmente (sin dependencias externas)
function loadEnv() {
  const envPath = resolve(__dirname, "server", ".env");
  if (!existsSync(envPath)) {
    console.error("ERROR: Crea server/.env desde server/.env.example con DATABASE_URL configurada.");
    process.exit(1);
  }
  const lines = readFileSync(envPath, "utf-8").split("\n");
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
    if (key === "DATABASE_URL" && val) {
      process.env.DATABASE_URL = val;
    }
  }
}

loadEnv();

const DATABASE_URL = process.env.DATABASE_URL || "";

if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL no está definida en server/.env");
  console.error("Copia server/.env.example a server/.env y completa DATABASE_URL.");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS docente (
  email TEXT PRIMARY KEY,
  nombre TEXT,
  cedula TEXT,
  rol TEXT DEFAULT 'docente',
  password TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS asignacion (
  id TEXT PRIMARY KEY,
  docente_email TEXT,
  carrera TEXT,
  asignatura TEXT,
  pao TEXT,
  paralelo TEXT,
  cod_carrera TEXT,
  cod_materia TEXT,
  cod_nivel TEXT,
  cod_periodo TEXT,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS configuracion (
  id TEXT PRIMARY KEY,
  owner_email TEXT,
  carrera TEXT,
  asignatura TEXT,
  pao TEXT,
  data JSONB,
  saved_at TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS config_estudiantes (
  config_id TEXT PRIMARY KEY REFERENCES configuracion(id) ON DELETE CASCADE,
  data JSONB
);

CREATE TABLE IF NOT EXISTS config_notas (
  config_id TEXT PRIMARY KEY REFERENCES configuracion(id) ON DELETE CASCADE,
  data JSONB
);

CREATE INDEX IF NOT EXISTS idx_asignacion_docente ON asignacion(docente_email);
CREATE INDEX IF NOT EXISTS idx_config_owner ON configuracion(owner_email);
CREATE INDEX IF NOT EXISTS idx_config_carrera ON configuracion(carrera);
`;

async function main() {
  console.log("Conectando a PostgreSQL...");
  const client = await pool.connect();
  try {
    console.log("Ejecutando esquema...");
    await client.query(SCHEMA);
    console.log("Tablas creadas correctamente.");

    const tables = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `);
    console.log("Tablas existentes:", tables.rows.map(r => r.table_name).join(", "));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
