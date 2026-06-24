// ============================================================================
// CAPA DE INFRAESTRUCTURA  ·  Patrón: Repository
// ----------------------------------------------------------------------------
// Acceso a PostgreSQL (Neon/Supabase) para los datos PROPIOS de la app: docentes,
// asignaciones, configuraciones, estudiantes y notas. Los datos académicos
// (carreras, malla, horarios...) NO se guardan aquí: se consultan en vivo a OASIS.
// Si no hay DATABASE_URL, el repositorio queda deshabilitado y el frontend usa
// sessionStorage como respaldo.
// ============================================================================
import pg from "pg";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const COORDINADOR = {
  email: "ppaguay@espoch.edu.ec",
  nombre: "PAUL PAGUAY",
  cedula: "",
  rol: "coordinador",
  password: "paguay2026",
};

function hashPassword(plain) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(plain), salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}
function verifyPassword(plain, stored) {
  if (!stored || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hash] = parts;
  const calc = scryptSync(String(plain), salt, 64).toString("hex");
  const a = Buffer.from(calc, "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export class Database {
  constructor(databaseUrl) {
    this.enabled = Boolean(databaseUrl);
    this.pool = this.enabled
      ? new pg.Pool({
          connectionString: databaseUrl,
          ssl: { rejectUnauthorized: false }, // Neon/Supabase requieren TLS gestionado.
          max: 5,
          idleTimeoutMillis: 30000,
        })
      : null;
  }

  #q(text, params) {
    if (!this.pool) throw new Error("Base de datos no configurada (defina DATABASE_URL).");
    return this.pool.query(text, params);
  }

  async ensureSchema() {
    if (!this.pool) return;
    await this.#q(`
      CREATE TABLE IF NOT EXISTS docente (
        email TEXT PRIMARY KEY,
        nombre TEXT, cedula TEXT, rol TEXT DEFAULT 'docente',
        password_hash TEXT, updated_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS asignacion (
        id TEXT PRIMARY KEY, docente_email TEXT,
        carrera TEXT, asignatura TEXT, pao TEXT, paralelo TEXT,
        data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS configuracion (
        id TEXT PRIMARY KEY, owner_email TEXT,
        carrera TEXT, asignatura TEXT, pao TEXT,
        data JSONB NOT NULL, saved_at TEXT, updated_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS config_estudiantes (config_id TEXT PRIMARY KEY, data JSONB NOT NULL);
      CREATE TABLE IF NOT EXISTS config_notas (config_id TEXT PRIMARY KEY, data JSONB NOT NULL);
    `);
    await this.#q(`ALTER TABLE docente ADD COLUMN IF NOT EXISTS password_hash TEXT;`).catch(() => {});
    await this.#q(`ALTER TABLE config_estudiantes ADD COLUMN IF NOT EXISTS data JSONB;`).catch(() => {});
    await this.#q(`ALTER TABLE config_notas ADD COLUMN IF NOT EXISTS data JSONB;`).catch(() => {});
    await this.#q(`
      CREATE INDEX IF NOT EXISTS idx_asignacion_docente ON asignacion(docente_email);
      CREATE INDEX IF NOT EXISTS idx_config_owner ON configuracion(owner_email);
    `);
    const r = await this.#q("SELECT 1 FROM docente WHERE email=$1", [COORDINADOR.email]);
    if (r.rowCount === 0) {
      await this.#q(
        "INSERT INTO docente(email,nombre,cedula,rol,password_hash) VALUES ($1,$2,$3,$4,$5)",
        [COORDINADOR.email, COORDINADOR.nombre, COORDINADOR.cedula, COORDINADOR.rol, hashPassword(COORDINADOR.password)]
      );
    }
  }

  async getStore({ email, role } = {}) {
    const docentesRes = await this.#q("SELECT email,nombre,cedula,rol FROM docente ORDER BY nombre");
    const asigRes = await this.#q("SELECT data FROM asignacion");
    const configsRes = role === "coordinador"
      ? await this.#q("SELECT data FROM configuracion ORDER BY updated_at DESC")
      : await this.#q("SELECT data FROM configuracion WHERE owner_email=$1 ORDER BY updated_at DESC", [email || ""]);

    const configuraciones = configsRes.rows.map((r) => r.data);
    const ids = configuraciones.map((c) => c.id).filter(Boolean);

    const studentsByConfig = {};
    const gradesByConfig = {};
    if (ids.length) {
      const est = await this.#q("SELECT config_id,data FROM config_estudiantes WHERE config_id = ANY($1)", [ids]);
      est.rows.forEach((r) => { studentsByConfig[r.config_id] = r.data; });
      const notas = await this.#q("SELECT config_id,data FROM config_notas WHERE config_id = ANY($1)", [ids]);
      notas.rows.forEach((r) => { gradesByConfig[r.config_id] = r.data; });
    }

    return {
      docentes: docentesRes.rows.filter((d) => d.rol !== "coordinador"),
      teacherAssignments: asigRes.rows.map((r) => r.data),
      savedConfigs: configuraciones,
      studentsByConfig,
      gradesByConfig,
    };
  }

  async putStore(payload = {}) {
    if (!this.pool) throw new Error("Base de datos no configurada (defina DATABASE_URL).");
    const email = payload.email || "";
    const role = payload.role || "";
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      if (role === "coordinador" && Array.isArray(payload.docentes)) {
        for (const d of payload.docentes) {
          if (!d.email) continue;
          if (d.password) {
            await client.query(
              `INSERT INTO docente(email,nombre,cedula,rol,password_hash)
               VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (email) DO UPDATE SET nombre=$2,cedula=$3,rol=$4,password_hash=$5,updated_at=now()`,
              [d.email.toLowerCase(), d.nombre || d.name || "", d.cedula || "", d.rol || d.role || "docente", hashPassword(d.password)]
            );
          } else {
            await client.query(
              `INSERT INTO docente(email,nombre,cedula,rol,password_hash)
               VALUES ($1,$2,$3,$4,NULL)
               ON CONFLICT (email) DO UPDATE SET nombre=$2,cedula=$3,rol=$4,updated_at=now()`,
              [d.email.toLowerCase(), d.nombre || d.name || "", d.cedula || "", d.rol || d.role || "docente"]
            );
          }
        }
      }

      if (role === "coordinador" && Array.isArray(payload.teacherAssignments)) {
        await client.query("DELETE FROM asignacion");
        for (const a of payload.teacherAssignments) {
          if (!a.id) continue;
          await client.query(
            `INSERT INTO asignacion(id,docente_email,carrera,asignatura,pao,paralelo,data)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (id) DO UPDATE SET docente_email=$2,carrera=$3,asignatura=$4,pao=$5,paralelo=$6,data=$7,updated_at=now()`,
            [a.id, a.docenteEmail || "", a.carrera || "", a.asignatura || "", String(a.pao || ""), String(a.paralelo || ""), a]
          );
        }
      }

      if (Array.isArray(payload.savedConfigs)) {
        const keepIds = payload.savedConfigs.map((c) => c.id).filter(Boolean);
        if (keepIds.length) {
          await client.query("DELETE FROM configuracion WHERE owner_email=$1 AND NOT (id = ANY($2))", [email, keepIds]);
        } else {
          await client.query("DELETE FROM configuracion WHERE owner_email=$1", [email]);
        }
        for (const c of payload.savedConfigs) {
          if (!c.id) continue;
          const cc = c.courseConfig || {};
          await client.query(
            `INSERT INTO configuracion(id,owner_email,carrera,asignatura,pao,data,saved_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (id) DO UPDATE SET owner_email=$2,carrera=$3,asignatura=$4,pao=$5,data=$6,saved_at=$7,updated_at=now()`,
            [c.id, c.ownerEmail || email, cc.carrera || "", cc.asignatura || "", String(cc.pao || ""), c, c.savedAt || ""]
          );
        }
      }

      if (payload.studentsByConfig && typeof payload.studentsByConfig === "object") {
        for (const [configId, arr] of Object.entries(payload.studentsByConfig)) {
          await client.query(
            `INSERT INTO config_estudiantes(config_id,data) VALUES ($1,$2)
             ON CONFLICT (config_id) DO UPDATE SET data=$2`,
            [configId, JSON.stringify(arr || [])]
          );
        }
      }
      if (payload.gradesByConfig && typeof payload.gradesByConfig === "object") {
        for (const [configId, arr] of Object.entries(payload.gradesByConfig)) {
          await client.query(
            `INSERT INTO config_notas(config_id,data) VALUES ($1,$2)
             ON CONFLICT (config_id) DO UPDATE SET data=$2`,
            [configId, JSON.stringify(arr || [])]
          );
        }
      }

      await client.query("COMMIT");
      return { ok: true };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async login(loginEmail, password) {
    const r = await this.#q("SELECT email,nombre,cedula,rol,password_hash FROM docente WHERE email=$1", [String(loginEmail || "").toLowerCase()]);
    if (r.rowCount === 0) return null;
    const u = r.rows[0];
    if (!u.password_hash || !verifyPassword(password, u.password_hash)) return null;
    return { email: u.email, name: u.nombre, cedula: u.cedula || "", role: u.rol, source: "db" };
  }

  async health() {
    if (!this.pool) return { enabled: false };
    await this.#q("SELECT 1");
    return { enabled: true };
  }
}
