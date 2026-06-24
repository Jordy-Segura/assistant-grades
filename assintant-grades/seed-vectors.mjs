import pg from "pg";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEGACY_PATH = resolve(__dirname, "src", "legacyRuntime.js");

function loadEnv() {
  for (const envPath of [resolve(__dirname, "server", ".env"), resolve(__dirname, ".env"), resolve(__dirname, ".env.local")]) {
    if (!existsSync(envPath)) continue;
    for (const line of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

function extractAssignedLiteral(source, name) {
  const marker = `var ${name} = `;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`No se encontro ${name} en legacyRuntime.js`);
  const literalStart = source.indexOf(source.slice(start + marker.length).trimStart()[0], start + marker.length);
  const opener = source[literalStart];
  const closer = opener === "[" ? "]" : "}";
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let i = literalStart; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === opener) depth++;
    if (ch === closer) depth--;
    if (depth === 0) return source.slice(literalStart, i + 1);
  }
  throw new Error(`No se pudo cerrar ${name}`);
}

function slug(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "item";
}

function readLegacyVectors() {
  const source = readFileSync(LEGACY_PATH, "utf-8");
  const sandbox = {};
  for (const name of ["DB_RACS_TI", "FULL_RAAU_TI", "EVAL_PROCEDURES"]) {
    const literal = extractAssignedLiteral(source, name);
    vm.runInNewContext(`result = ${literal}`, sandbox);
    sandbox[name] = sandbox.result;
  }
  return {
    racs: sandbox.DB_RACS_TI || [],
    raau: sandbox.FULL_RAAU_TI || {},
    procedures: sandbox.EVAL_PROCEDURES || {},
  };
}

async function main() {
  loadEnv();
  const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Configure DATABASE_URL antes de sembrar vectores.");
  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    const vectors = readLegacyVectors();
    const rows = [];
    vectors.racs.forEach((rac, order) => {
      rows.push({
        id: `catalog:ti:rac:${rac.id || rac.code}`,
        tipo: "RAC",
        carrera: "TECNOLOGIAS DE LA INFORMACION",
        asignatura: "",
        componente: "",
        legacy_id: rac.id || rac.code,
        codigo: rac.code || rac.id,
        descripcion: rac.description || "",
        rac_legacy_id: "",
        data: { ...rac, order },
      });
    });
    Object.entries(vectors.raau).forEach(([asignatura, value], order) => {
      const descripcion = Array.isArray(value) ? value[0] : "";
      const racId = Array.isArray(value) ? value[1] : "";
      rows.push({
        id: `catalog:ti:raau:${slug(asignatura)}`,
        tipo: "RAAU",
        carrera: "TECNOLOGIAS DE LA INFORMACION",
        asignatura,
        componente: "",
        legacy_id: asignatura,
        codigo: "RAAU1",
        descripcion,
        rac_legacy_id: racId,
        data: { asignatura, descripcion, racId, order },
      });
    });
    Object.entries(vectors.procedures).forEach(([component, items]) => {
      (items || []).forEach((item, order) => {
        rows.push({
          id: `catalog:procedure:${component}:${item.id}`,
          tipo: "PROCEDIMIENTO",
          carrera: "",
          asignatura: "",
          componente: component,
          legacy_id: item.id,
          codigo: item.id,
          descripcion: item.name || "",
          rac_legacy_id: "",
          data: { ...item, component, order },
        });
      });
    });

    await client.query("BEGIN");
    for (const row of rows) {
      await client.query(
        `INSERT INTO app_vectores_catalogo
          (id,tipo,carrera,asignatura,componente,legacy_id,codigo,descripcion,rac_legacy_id,data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
          tipo=$2,carrera=$3,asignatura=$4,componente=$5,legacy_id=$6,codigo=$7,
          descripcion=$8,rac_legacy_id=$9,data=$10,updated_at=now()`,
        [row.id, row.tipo, row.carrera, row.asignatura, row.componente, row.legacy_id, row.codigo, row.descripcion, row.rac_legacy_id, row.data]
      );
    }
    await client.query("COMMIT");
    console.log(`Vectores sembrados: ${rows.length}`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
