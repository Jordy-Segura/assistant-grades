// ============================================================================
// CAPA DE INFRAESTRUCTURA  -  Repository PostgreSQL
// ----------------------------------------------------------------------------
// Neon es la fuente persistente de la app. OASIS sigue siendo la fuente oficial
// academica; aqui solo se guardan usuarios internos, asignaciones, PAO,
// vectores RAC/RAAU, actividades, nominas y calificaciones.
// ============================================================================
import pg from "pg";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const COORDINADOR = {
  email: "ppaguay@espoch.edu.ec",
  nombre: "PAUL PAGUAY",
  cedula: "",
  rol: "coordinador",
  password: "Paguay2026",
};

const SESSION_TTL_MS = 3 * 60 * 1000;

let schemaReady = false;

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

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function jsonClone(value, fallback) {
  if (value == null) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function safeText(value) {
  return value == null ? "" : String(value);
}

function catalogSlug(value) {
  return safeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "item";
}

function catalogKey(value) {
  return catalogSlug(value).toUpperCase();
}

function stableChildId(configId, type, rawId, index) {
  const suffix = safeText(rawId || index || "x").replace(/[^a-zA-Z0-9_.:-]+/g, "_").slice(0, 120);
  return `${configId}:${type}:${suffix}`;
}

function splitStudentName(student) {
  return [student.apellidos || "", student.nombres || ""].filter(Boolean).join(" ").trim();
}

function studentTotal(student, grades) {
  const sid = student && student.id;
  if (!sid || !Array.isArray(grades)) return 0;
  return grades
    .filter((g) => g && g.studentId === sid && g.score != null)
    .reduce((sum, g) => sum + (Number(g.score) || 0), 0);
}

export class Database {
  constructor(databaseUrl) {
    this.enabled = Boolean(databaseUrl);
    const usesNeonPooler = /-pooler\./i.test(databaseUrl || "");
    this.pool = this.enabled
      ? new pg.Pool({
          connectionString: databaseUrl,
          ssl: { rejectUnauthorized: false },
          max: Number(process.env.PG_POOL_MAX || (usesNeonPooler ? 1 : 5)),
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 10000,
        })
      : null;
  }

  #q(text, params) {
    if (!this.pool) throw new Error("Base de datos no configurada (defina DATABASE_URL).");
    return this.pool.query(text, params);
  }

  async #tableExists(tableName) {
    const r = await this.#q("SELECT to_regclass($1) AS name", [`public.${tableName}`]);
    return Boolean(r.rows[0] && r.rows[0].name);
  }

  async ensureSchema() {
    if (!this.pool || schemaReady) return;
    const schemaPath = resolve(__dirname, "..", "..", "neon-schema.sql");
    if (!existsSync(schemaPath)) throw new Error("No se encontro neon-schema.sql.");
    await this.#q(readFileSync(schemaPath, "utf-8"));
    await this.#seedCoordinator();
    await this.#migrateLegacyTables();
    schemaReady = true;
  }

  async #seedCoordinator() {
    const r = await this.#q("SELECT 1 FROM app_docentes_sistema WHERE email=$1", [COORDINADOR.email]);
    if (r.rowCount > 0) return;
    await this.#q(
      `INSERT INTO app_docentes_sistema(email,nombres,cedula,rol,password_hash,data)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        COORDINADOR.email,
        COORDINADOR.nombre,
        COORDINADOR.cedula,
        COORDINADOR.rol,
        hashPassword(COORDINADOR.password),
        { source: "seed" },
      ]
    );
  }

  async #migrateLegacyTables() {
    if (await this.#tableExists("docente")) {
      await this.#q(`
        INSERT INTO app_docentes_sistema(email,nombres,cedula,rol,password_hash,data)
        SELECT lower(email), nombre, cedula, coalesce(rol,'docente'), password_hash, '{}'::jsonb
        FROM docente
        WHERE email IS NOT NULL
        ON CONFLICT (email) DO NOTHING
      `).catch(() => {});
    }
    if (await this.#tableExists("asignacion")) {
      await this.#q(`
        INSERT INTO app_asignaciones(id,docente_email,carrera,asignatura,pao,paralelo,data)
        SELECT id, lower(coalesce(docente_email,'')), carrera, asignatura, pao, paralelo, data
        FROM asignacion
        WHERE id IS NOT NULL
        ON CONFLICT (id) DO NOTHING
      `).catch(() => {});
    }
    if (await this.#tableExists("configuracion")) {
      await this.#q(`
        INSERT INTO app_configuraciones_pao(id,owner_email,carrera,asignatura,pao,aporte,data,saved_at)
        SELECT id, lower(coalesce(owner_email,'')), carrera, asignatura, pao,
               coalesce(data->'courseConfig'->>'aporte',''), data, saved_at
        FROM configuracion
        WHERE id IS NOT NULL
        ON CONFLICT (id) DO NOTHING
      `).catch(() => {});
    }
  }

  async getStore({ email, role } = {}) {
    await this.ensureSchema();
    const userEmail = cleanEmail(email);
    const isCoordinator = role === "coordinador" || role === "admin";

    const docentesRes = await this.#q(
      `SELECT email,nombres AS nombre,cedula,rol
       FROM app_docentes_sistema
       WHERE activo = true
       ORDER BY nombres`
    );
    const asigRes = await this.#q("SELECT data FROM app_asignaciones WHERE activo = true ORDER BY updated_at DESC");
    const configsRes = isCoordinator
      ? await this.#q("SELECT id,data FROM app_configuraciones_pao WHERE activo = true ORDER BY updated_at DESC")
      : await this.#q(
          "SELECT id,data FROM app_configuraciones_pao WHERE activo = true AND owner_email=$1 ORDER BY updated_at DESC",
          [userEmail]
        );

    const configuraciones = configsRes.rows.map((r) => r.data || { id: r.id });
    const ids = configsRes.rows.map((r) => r.id).filter(Boolean);

    const studentsByConfig = {};
    const gradesByConfig = {};
    if (ids.length) {
      const est = await this.#q(
        `SELECT config_id,data_minima
         FROM app_estudiantes_configuracion
         WHERE activo = true AND config_id = ANY($1)
         ORDER BY config_id, orden, apellidos, nombres`,
        [ids]
      );
      est.rows.forEach((r) => {
        if (!studentsByConfig[r.config_id]) studentsByConfig[r.config_id] = [];
        studentsByConfig[r.config_id].push(r.data_minima || {});
      });

      const notas = await this.#q(
        `SELECT config_id,student_legacy_id,activity_legacy_id,nota,data
         FROM app_notas_estudiantes
         WHERE config_id = ANY($1)
         ORDER BY config_id, student_legacy_id, activity_legacy_id`,
        [ids]
      );
      notas.rows.forEach((r) => {
        if (!gradesByConfig[r.config_id]) gradesByConfig[r.config_id] = [];
        const data = r.data || {};
        gradesByConfig[r.config_id].push({
          ...data,
          studentId: data.studentId || r.student_legacy_id,
          activityId: data.activityId || r.activity_legacy_id,
          score: r.nota == null ? null : Number(r.nota),
        });
      });

      await this.#fillLegacySnapshots(ids, studentsByConfig, gradesByConfig);
    }

    return {
      docentes: docentesRes.rows.filter((d) => d.rol !== "coordinador"),
      teacherAssignments: asigRes.rows.map((r) => r.data),
      savedConfigs: configuraciones,
      studentsByConfig,
      gradesByConfig,
    };
  }

  async #fillLegacySnapshots(ids, studentsByConfig, gradesByConfig) {
    if (await this.#tableExists("config_estudiantes")) {
      const missingStudents = ids.filter((id) => !studentsByConfig[id]);
      if (missingStudents.length) {
        const est = await this.#q("SELECT config_id,data FROM config_estudiantes WHERE config_id = ANY($1)", [missingStudents]);
        est.rows.forEach((r) => {
          studentsByConfig[r.config_id] = Array.isArray(r.data) ? r.data : [];
        });
      }
    }
    if (await this.#tableExists("config_notas")) {
      const missingGrades = ids.filter((id) => !gradesByConfig[id]);
      if (missingGrades.length) {
        const notas = await this.#q("SELECT config_id,data FROM config_notas WHERE config_id = ANY($1)", [missingGrades]);
        notas.rows.forEach((r) => {
          gradesByConfig[r.config_id] = Array.isArray(r.data) ? r.data : [];
        });
      }
    }
  }

  async putStore(payload = {}) {
    if (!this.pool) throw new Error("Base de datos no configurada (defina DATABASE_URL).");
    await this.ensureSchema();
    const email = cleanEmail(payload.email);
    const role = payload.role || "";
    const isCoordinator = role === "coordinador" || role === "admin";
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      if (isCoordinator && Array.isArray(payload.docentes)) {
        await this.#upsertDocentes(client, payload.docentes);
      }

      if (isCoordinator && Array.isArray(payload.teacherAssignments)) {
        await client.query("DELETE FROM app_asignaciones");
        for (const a of payload.teacherAssignments) await this.#upsertAsignacion(client, a);
      }

      if (Array.isArray(payload.savedConfigs)) {
        const configs = payload.savedConfigs.filter((c) => c && c.id);
        const keepIds = configs.map((c) => c.id);
        if (isCoordinator) {
          if (keepIds.length) {
            await client.query("UPDATE app_configuraciones_pao SET activo=false,updated_at=now() WHERE NOT (id = ANY($1))", [keepIds]);
          } else {
            await client.query("UPDATE app_configuraciones_pao SET activo=false,updated_at=now()");
          }
        } else if (keepIds.length) {
          await client.query(
            "UPDATE app_configuraciones_pao SET activo=false,updated_at=now() WHERE owner_email=$1 AND NOT (id = ANY($2))",
            [email, keepIds]
          );
        } else {
          await client.query("UPDATE app_configuraciones_pao SET activo=false,updated_at=now() WHERE owner_email=$1", [email]);
        }

        for (const c of configs) {
          await this.#upsertConfigTree(client, c, {
            fallbackOwner: email,
            students: payload.studentsByConfig && payload.studentsByConfig[c.id],
            grades: payload.gradesByConfig && payload.gradesByConfig[c.id],
          });
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

  async #upsertDocentes(client, docentes) {
    for (const d of docentes) {
      const email = cleanEmail(d.email);
      if (!email) continue;
      const nombre = d.nombre || d.name || "";
      const rol = d.rol || d.role || "docente";
      if (d.password) {
        await client.query(
          `INSERT INTO app_docentes_sistema(email,nombres,cedula,rol,password_hash,data,activo)
           VALUES ($1,$2,$3,$4,$5,$6,true)
           ON CONFLICT (email) DO UPDATE
           SET nombres=$2,cedula=$3,rol=$4,password_hash=$5,data=$6,activo=true,updated_at=now()`,
          [email, nombre, d.cedula || "", rol, hashPassword(d.password), d]
        );
      } else {
        await client.query(
          `INSERT INTO app_docentes_sistema(email,nombres,cedula,rol,data,activo)
           VALUES ($1,$2,$3,$4,$5,true)
           ON CONFLICT (email) DO UPDATE
           SET nombres=$2,cedula=$3,rol=$4,data=$5,activo=true,updated_at=now()`,
          [email, nombre, d.cedula || "", rol, d]
        );
      }
    }
  }

  async #upsertAsignacion(client, a) {
    if (!a || !a.id) return;
    await client.query(
      `INSERT INTO app_asignaciones(id,docente_email,carrera,asignatura,pao,paralelo,
        cod_carrera,cod_materia,cod_nivel,cod_periodo,data,activo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
       ON CONFLICT (id) DO UPDATE
       SET docente_email=$2,carrera=$3,asignatura=$4,pao=$5,paralelo=$6,cod_carrera=$7,
           cod_materia=$8,cod_nivel=$9,cod_periodo=$10,data=$11,activo=true,updated_at=now()`,
      [
        a.id,
        cleanEmail(a.docenteEmail),
        a.carrera || "",
        a.asignatura || "",
        safeText(a.pao),
        safeText(a.codParalelo || a.paralelo),
        a.codCarrera || "",
        a.codMateria || "",
        a.codNivel || "",
        a.codPeriodo || "",
        a,
      ]
    );
  }

  async #upsertConfigTree(client, config, context) {
    const c = config.courseConfig || {};
    const ownerEmail = cleanEmail(config.ownerEmail || context.fallbackOwner);
    await client.query(
      `INSERT INTO app_configuraciones_pao(id,owner_email,carrera,asignatura,pao,paralelo,aporte,
        cod_carrera,cod_materia,cod_nivel,cod_periodo,data,saved_at,activo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true)
       ON CONFLICT (id) DO UPDATE
       SET owner_email=$2,carrera=$3,asignatura=$4,pao=$5,paralelo=$6,aporte=$7,
           cod_carrera=$8,cod_materia=$9,cod_nivel=$10,cod_periodo=$11,data=$12,
           saved_at=$13,activo=true,updated_at=now()`,
      [
        config.id,
        ownerEmail,
        c.carrera || "",
        c.asignatura || "",
        safeText(c.pao),
        safeText(c.codParalelo || c.paralelo),
        c.aporte || "",
        c.codCarrera || "",
        c.codMateria || "",
        c.codNivel || "",
        c.codPeriodo || "",
        config,
        config.savedAt || "",
      ]
    );

    await this.#replaceLearningResults(client, config);
    await this.#replaceActivities(client, config);
    await this.#replaceStudentsAndGrades(client, config.id, context.students || [], context.grades || []);
  }

  async #replaceLearningResults(client, config) {
    const configId = config.id;
    const selected = new Set(Array.isArray(config.selectedRACIds) ? config.selectedRACIds : []);
    const catalog = Array.isArray(config.racsCatalog) ? config.racsCatalog : [];
    const raauEntries = Array.isArray(config.raauEntries) ? config.raauEntries : [];
    raauEntries.forEach((r) => {
      if (r && r.racId) selected.add(r.racId);
    });

    await client.query("DELETE FROM app_resultados_aprendizaje WHERE config_id=$1", [configId]);
    const racMap = new Map();
    const racs = [];
    catalog.forEach((rac, index) => {
      if (!rac || (!selected.has(rac.id) && !selected.has(rac.code))) return;
      racs.push({ ...rac, index });
      selected.delete(rac.id);
      selected.delete(rac.code);
    });
    Array.from(selected).forEach((racId, index) => {
      racs.push({ id: racId, code: racId, description: racId, index: catalog.length + index });
    });

    for (const rac of racs) {
      const legacyId = rac.id || rac.code;
      const rowId = stableChildId(configId, "RAC", legacyId, rac.index);
      racMap.set(legacyId, rowId);
      if (rac.code) racMap.set(rac.code, rowId);
      await client.query(
        `INSERT INTO app_resultados_aprendizaje(id,config_id,tipo,legacy_id,codigo,descripcion,orden,data)
         VALUES ($1,$2,'RAC',$3,$4,$5,$6,$7)`,
        [rowId, configId, legacyId, rac.code || legacyId, rac.description || rac.code || legacyId, rac.index || 0, rac]
      );
    }

    for (const [index, raau] of raauEntries.entries()) {
      if (!raau) continue;
      const legacyId = raau.id || raau.code || index;
      const rowId = stableChildId(configId, "RAAU", legacyId, index);
      const racRowId = racMap.get(raau.racId) || racMap.get(raau.racCode) || null;
      await client.query(
        `INSERT INTO app_resultados_aprendizaje(id,config_id,tipo,legacy_id,codigo,descripcion,rac_id_relacionado,orden,data)
         VALUES ($1,$2,'RAAU',$3,$4,$5,$6,$7,$8)`,
        [rowId, configId, legacyId, raau.code || `RAAU${index + 1}`, raau.description || "", racRowId, index, raau]
      );
    }
  }

  async #replaceActivities(client, config) {
    const configId = config.id;
    const activities = Array.isArray(config.activities) ? config.activities : [];
    await client.query("DELETE FROM app_actividades_evaluacion WHERE config_id=$1", [configId]);
    for (const [index, act] of activities.entries()) {
      if (!act || !act.id) continue;
      const linkedRaau = (config.raauEntries || []).find((r) => r.id === act.raauId);
      const racLegacy = act.racId || (linkedRaau && linkedRaau.racId) || "";
      await client.query(
        `INSERT INTO app_actividades_evaluacion(id,config_id,legacy_id,componente,nombre,puntaje_maximo,
          rac_legacy_id,raau_legacy_id,procedimiento,orden,data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          stableChildId(configId, "ACT", act.id, index),
          configId,
          act.id,
          act.component || "ACD",
          act.name || `Actividad ${index + 1}`,
          Number(act.maxScore) || 0,
          racLegacy,
          act.raauId || "",
          act.procedure || act.procedureId || "",
          index,
          act,
        ]
      );
    }
  }

  async #replaceStudentsAndGrades(client, configId, students, grades) {
    await client.query("DELETE FROM app_notas_estudiantes WHERE config_id=$1", [configId]);
    await client.query("DELETE FROM app_resumen_calificaciones WHERE config_id=$1", [configId]);
    await client.query("DELETE FROM app_estudiantes_configuracion WHERE config_id=$1", [configId]);

    const studentByLegacyId = new Map();
    for (const [index, student] of (students || []).entries()) {
      if (!student || !student.id) continue;
      const rowId = stableChildId(configId, "EST", student.id, index);
      studentByLegacyId.set(student.id, rowId);
      await client.query(
        `INSERT INTO app_estudiantes_configuracion(id,config_id,student_legacy_id,cedula,codigo_estudiante,
          apellidos,nombres,email,orden,data_minima)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          rowId,
          configId,
          student.id,
          student.cedula || "",
          student.codigo || "",
          student.apellidos || splitStudentName(student),
          student.nombres || "",
          student.email || "",
          index,
          student,
        ]
      );
      const total = studentTotal(student, grades);
      await client.query(
        `INSERT INTO app_resumen_calificaciones(id,config_id,estudiante_id,student_legacy_id,estudiante_cedula,total,estado,data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          stableChildId(configId, "SUM", student.id, index),
          configId,
          rowId,
          student.id,
          student.cedula || "",
          total,
          total >= 7 ? "aprobado" : "reprobado",
          { total },
        ]
      );
    }

    for (const [index, grade] of (grades || []).entries()) {
      if (!grade || !grade.studentId || !grade.activityId) continue;
      await client.query(
        `INSERT INTO app_notas_estudiantes(id,config_id,estudiante_id,student_legacy_id,activity_legacy_id,nota,data)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          stableChildId(configId, "NOTE", `${grade.studentId}_${grade.activityId}`, index),
          configId,
          studentByLegacyId.get(grade.studentId) || null,
          grade.studentId,
          grade.activityId,
          grade.score == null ? null : Number(grade.score),
          grade,
        ]
      );
    }
  }

  async getVectorCatalog() {
    await this.ensureSchema();
    const rows = await this.#q(`
      SELECT tipo,carrera,asignatura,componente,legacy_id,codigo,descripcion,rac_legacy_id,data,
             CASE WHEN (data->>'order') ~ '^[0-9]+$' THEN (data->>'order')::int ELSE 0 END AS orden
      FROM app_vectores_catalogo
      WHERE tipo IN ('RAC','RAAU','PROCEDIMIENTO')
      ORDER BY tipo, carrera, asignatura, componente, orden, codigo, legacy_id
    `);

    const carreras = {};
    const procedures = { ACD: [], APEX: [], AAUT: [] };
    const careerAliases = new Map();
    const ensureCareer = (name) => {
      const careerName = safeText(name || "TECNOLOGIAS DE LA INFORMACION").trim();
      const key = catalogKey(careerName);
      const existingName = careerAliases.get(key);
      if (existingName) return carreras[existingName];
      careerAliases.set(key, careerName);
      carreras[careerName] = { maxPao: 0, racs: [], malla: {}, asignaturas: {} };
      return carreras[careerName];
    };

    for (const row of rows.rows) {
      const data = row.data || {};
      if (row.tipo === "RAC") {
        const career = ensureCareer(row.carrera);
        const legacyId = safeText(data.id || row.legacy_id || row.codigo);
        if (!legacyId) continue;
        if (!career.racs.some((r) => r.id === legacyId || r.code === row.codigo)) {
          career.racs.push({
            id: legacyId,
            code: safeText(data.code || row.codigo || legacyId),
            description: safeText(data.description || row.descripcion),
          });
        }
      } else if (row.tipo === "RAAU") {
        const career = ensureCareer(row.carrera);
        const subject = safeText(data.asignatura || row.asignatura).trim();
        if (!subject) continue;
        if (!career.asignaturas[subject]) career.asignaturas[subject] = { raau: [] };
        career.asignaturas[subject].raau.push({
          id: safeText(data.id || row.legacy_id || row.codigo),
          code: safeText(data.code || row.codigo || "RAAU1"),
          description: safeText(data.descripcion || data.description || row.descripcion),
          racId: safeText(data.racId || row.rac_legacy_id),
        });
      } else if (row.tipo === "PROCEDIMIENTO") {
        const component = safeText(data.component || row.componente).toUpperCase();
        if (!procedures[component]) procedures[component] = [];
        procedures[component].push({
          id: safeText(data.id || row.legacy_id || row.codigo),
          name: safeText(data.name || row.descripcion),
        });
      }
    }

    const mallaRows = await this.#q(`
      SELECT DISTINCT carrera,pao,asignatura
      FROM (
        SELECT carrera,pao,asignatura FROM app_asignaciones WHERE activo = true
        UNION
        SELECT carrera,pao,asignatura FROM app_configuraciones_pao WHERE activo = true
      ) s
      WHERE NULLIF(trim(carrera),'') IS NOT NULL AND NULLIF(trim(asignatura),'') IS NOT NULL
      ORDER BY carrera,pao,asignatura
    `).catch(() => ({ rows: [] }));

    for (const row of mallaRows.rows) {
      const career = ensureCareer(row.carrera);
      const pao = safeText(row.pao || "");
      const subject = safeText(row.asignatura || "");
      if (!pao || !subject) continue;
      if (!career.malla[pao]) career.malla[pao] = [];
      if (!career.malla[pao].includes(subject)) career.malla[pao].push(subject);
      const paoNumber = Number(pao);
      if (Number.isFinite(paoNumber)) career.maxPao = Math.max(career.maxPao || 0, paoNumber);
      if (!career.asignaturas[subject]) career.asignaturas[subject] = { raau: [] };
    }

    return { carreras, procedures };
  }

  async replaceVectorCatalog(payload = {}) {
    await this.ensureSchema();
    const rows = [];
    const carreras = payload.carreras && typeof payload.carreras === "object" ? payload.carreras : {};
    const procedures = payload.procedures && typeof payload.procedures === "object" ? payload.procedures : {};

    Object.entries(carreras).forEach(([careerName, career]) => {
      (career.racs || []).forEach((rac, order) => {
        const legacyId = safeText(rac.id || rac.code || `rac_${order + 1}`);
        rows.push({
          id: `catalog:${catalogSlug(careerName)}:rac:${catalogSlug(legacyId)}`,
          tipo: "RAC",
          carrera: careerName,
          asignatura: "",
          componente: "",
          legacy_id: legacyId,
          codigo: safeText(rac.code || legacyId),
          descripcion: safeText(rac.description),
          rac_legacy_id: "",
          data: { ...jsonClone(rac, {}), order },
        });
      });

      Object.entries(career.asignaturas || {}).forEach(([subject, subjectData]) => {
        (subjectData.raau || []).forEach((raau, order) => {
          const legacyId = safeText(raau.id || raau.code || `${subject}_${order + 1}`);
          rows.push({
            id: `catalog:${catalogSlug(careerName)}:raau:${catalogSlug(subject)}:${catalogSlug(legacyId)}`,
            tipo: "RAAU",
            carrera: careerName,
            asignatura: subject,
            componente: "",
            legacy_id: legacyId,
            codigo: safeText(raau.code || `RAAU${order + 1}`),
            descripcion: safeText(raau.description),
            rac_legacy_id: safeText(raau.racId),
            data: { ...jsonClone(raau, {}), asignatura: subject, order },
          });
        });
      });
    });

    Object.entries(procedures).forEach(([component, items]) => {
      (items || []).forEach((item, order) => {
        const legacyId = safeText(item.id || `${component}_${order + 1}`);
        rows.push({
          id: `catalog:procedure:${catalogSlug(component)}:${catalogSlug(legacyId)}`,
          tipo: "PROCEDIMIENTO",
          carrera: "",
          asignatura: "",
          componente: safeText(component).toUpperCase(),
          legacy_id: legacyId,
          codigo: legacyId,
          descripcion: safeText(item.name),
          rac_legacy_id: "",
          data: { ...jsonClone(item, {}), component: safeText(component).toUpperCase(), order },
        });
      });
    });

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM app_vectores_catalogo");
      for (const row of rows) {
        await client.query(
          `INSERT INTO app_vectores_catalogo
            (id,tipo,carrera,asignatura,componente,legacy_id,codigo,descripcion,rac_legacy_id,data)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [row.id, row.tipo, row.carrera, row.asignatura, row.componente, row.legacy_id, row.codigo, row.descripcion, row.rac_legacy_id, row.data]
        );
      }
      await client.query("COMMIT");
      return { ok: true, total: rows.length };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async login(loginEmail, password) {
    await this.ensureSchema();
    const r = await this.#q(
      `SELECT email,nombres,cedula,rol,password_hash
       FROM app_docentes_sistema
       WHERE email=$1 AND activo = true`,
      [cleanEmail(loginEmail)]
    );
    if (r.rowCount === 0) return null;
    const u = r.rows[0];
    if (!u.password_hash || !verifyPassword(password, u.password_hash)) return null;
    return { email: u.email, name: u.nombres, cedula: u.cedula || "", role: u.rol, source: "db" };
  }

  async updatePassword(loginEmail, currentPassword, newPassword) {
    await this.ensureSchema();
    const email = cleanEmail(loginEmail);
    const r = await this.#q(
      `SELECT email,password_hash
       FROM app_docentes_sistema
       WHERE email=$1 AND activo = true`,
      [email]
    );
    if (r.rowCount === 0) return false;
    const u = r.rows[0];
    if (!u.password_hash || !verifyPassword(currentPassword, u.password_hash)) return false;
    await this.#q(
      "UPDATE app_docentes_sistema SET password_hash=$2,updated_at=now() WHERE email=$1",
      [email, hashPassword(newPassword)]
    );
    return true;
  }

  async claimSession(loginEmail, sessionId, data = {}) {
    await this.ensureSchema();
    const email = cleanEmail(loginEmail);
    const sid = safeText(sessionId).trim();
    if (!email || !sid) throw new Error("Sesion invalida.");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM app_user_sessions WHERE expires_at <= now()");
      await client.query(
        `INSERT INTO app_docentes_sistema(email,nombres,cedula,rol,data,activo)
         VALUES ($1,$2,$3,$4,$5,true)
         ON CONFLICT (email) DO NOTHING`,
        [
          email,
          safeText(data.name || data.nombre || email),
          safeText(data.cedula || ""),
          safeText(data.role || data.rol || "docente"),
          jsonClone({ source: "session", ...data }, {}),
        ]
      );
      const existing = await client.query(
        "SELECT session_id,expires_at FROM app_user_sessions WHERE email=$1 FOR UPDATE",
        [email]
      );
      if (existing.rowCount && existing.rows[0].session_id !== sid) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          reason: "active_session",
          expiresAt: existing.rows[0].expires_at,
        };
      }
      await client.query(
        `INSERT INTO app_user_sessions(email,session_id,user_agent,expires_at,data)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (email) DO UPDATE
         SET session_id=$2,user_agent=$3,expires_at=$4,data=$5,updated_at=now()`,
        [email, sid, safeText(data.userAgent).slice(0, 500), expiresAt, jsonClone(data, {})]
      );
      await client.query("COMMIT");
      return { ok: true, expiresAt };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async releaseSession(loginEmail, sessionId) {
    await this.ensureSchema();
    const email = cleanEmail(loginEmail);
    const sid = safeText(sessionId).trim();
    if (!email || !sid) return { ok: true };
    await this.#q("DELETE FROM app_user_sessions WHERE email=$1 AND session_id=$2", [email, sid]);
    return { ok: true };
  }

  async health() {
    if (!this.pool) return { enabled: false };
    await this.ensureSchema();
    await this.#q("SELECT 1");
    return { enabled: true, provider: "neon-postgres" };
  }
}
