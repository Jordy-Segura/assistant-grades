// BFF — único punto de contacto entre el frontend, OASIS SOAP y PostgreSQL.
// Las credenciales de servicio NUNCA salen del servidor.
import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(here, ".env"));
} catch {
  /* .env es opcional */
}

// ── Validación de variables de entorno ──────────────────────────────────
function validateEnv() {
  const requiredVars = ["OASIS_USER", "OASIS_PASS"];
  const warnings = [];
  for (const v of requiredVars) {
    if (!process.env[v]) warnings.push(`Falta ${v} — las operaciones autenticadas usarán mock data`);
  }
  if (!process.env.OASIS_BASE) warnings.push("Falta OASIS_BASE — se usará http://swoasis.espoch.edu.ec/OASis/OAS_Interop");
  return warnings;
}

const envWarnings = validateEnv();
const oasis = await import("./oasis.mjs");
const db = await import("./db.mjs");

const PORT = Number(process.env.PORT || 3001);
const ORIGIN = process.env.CORS_ORIGIN || "*";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) req.destroy(); // basic guard
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

// Envuelve un handler: errores → JSON con código HTTP adecuado.
async function run(res, handler) {
  try {
    const data = await handler();
    sendJson(res, 200, data);
  } catch (err) {
    const status = err.soapFault ? 400 : err.statusCode || 502;
    const msg = err.message || "Error interno del servidor";
    console.error(`[BFF] Error ${status}: ${msg}`);
    sendJson(res, status, { error: msg });
  }
}

// Error personalizado con código HTTP
class HttpError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

const routes = {
  "GET /api/health": async () => ({ ok: true, base: oasis.config.base, hasCredentials: oasis.config.hasCredentials, mock: oasis.config.mock, warnings: envWarnings }),

  "GET /api/periodo-actual": () => oasis.getPeriodoActual(),

  "GET /api/facultades": () => oasis.getFacultades(),

  "GET /api/carreras": async () => (await oasis.getCarreras()).filter((c) => c.estado === "ABI"),

  // Importación automática de nómina: resuelve carrera+asignatura -> estudiantes.
  "POST /api/nomina": (body) => oasis.resolverNomina(body),

  // Docentes de una carrera con sus cargas horarias (para crear perfiles).
  "POST /api/docentes-carrera": (body) => oasis.getDocentesCarrera(body),

  // Horario de clases de un docente.
  "POST /api/horario-docente": (body) => oasis.getHorarioDocente(body),

  "POST /api/login": async (body) => {
    if (!body.login || !body.password) throw new HttpError("Debe ingresar usuario y contraseña.", 400);
    return oasis.login(body.login, body.password);
  },

  "POST /api/materias-docente": (body) =>
    oasis.getMateriasDocente(body.codCarrera, body.cedula, body.codPeriodo),

  "POST /api/alumnos-materia": (body) => oasis.getAlumnosMateria(body),

  "POST /api/notas": (body) => oasis.getNotas(body.codCarrera, body.cedula),

  "POST /api/estudiante": (body) => oasis.getDatosEstudiante(body.cedula),

  "POST /api/materias-estudiante": (body) => oasis.getMateriasEstudiante(body.codCarrera, body.cedula, body.codPeriodo),

  "POST /api/estudiante-full": async (body) => {
    const cedula = body.cedula;
    const [estudiante, periodo, carreras] = await Promise.all([
      oasis.getDatosEstudiante(cedula),
      oasis.getPeriodoActual(),
      oasis.getCarreras(),
    ]);
    const codPeriodo = periodo?.codigo || "";
    if (!codPeriodo || !estudiante) return { estudiante, materias: [], horario: [] };

    // Buscar carrera del estudiante en paralelo (prioriza Sede Orellana)
    const orellana = carreras.filter((c) => c.nombre.toUpperCase().includes("ORELLANA"));
    const otras = carreras.filter((c) => !c.nombre.toUpperCase().includes("ORELLANA"));
    const priorizadas = [...orellana, ...otras].slice(0, 30); // límite por seguridad

    const results = await Promise.allSettled(priorizadas.map((c) =>
      oasis.getMateriasEstudiante(c.codigo, cedula, codPeriodo).then((ms) => ({ carrera: c, materias: ms }))
    ));
    let carreraEst = null;
    let materias = [];
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.materias?.length > 0) {
        carreraEst = r.value.carrera;
        materias = r.value.materias;
        break;
      }
    }

    // Dictados para cada materia en paralelo
    let dictadosArr = (materias.length > 0)
      ? await Promise.all(materias.map((m) =>
          oasis.getDictados(carreraEst.codigo, m.codMateria).then((d) => ({ codMateria: m.codMateria, materia: m.materia, dictados: d }))
        ))
      : [];

    // Intentar obtener el código institucional del estudiante desde getAlumnosMateria
    // Prueba todos los dictados de todas las materias hasta encontrar al estudiante
    if (!estudiante.codigo && materias.length > 0 && carreraEst) {
      const cedulaDigits = cedula.replace(/\D/g, "");
      for (const da of dictadosArr) {
        if (estudiante.codigo) break;
        for (const d of da.dictados) {
          try {
            const alumnos = await oasis.getAlumnosMateria({
              codCarrera: carreraEst.codigo,
              codNivel: d.codNivel,
              codParalelo: d.paralelo,
              codPeriodo: codPeriodo,
              codMateria: da.codMateria,
            });
            if (alumnos?.length) {
              const found = alumnos.find((a) => a.cedula?.replace(/\D/g, "") === cedulaDigits);
              if (found?.codigo) {
                estudiante.codigo = found.codigo;
                break;
              }
            }
          } catch {}
        }
      }
    }

    // Si OASIS no respondió pero tenemos datos mock del estudiante, usar carrera/materias mock
    if (!carreraEst && estudiante?.codigo) {
      const mockCarrera = carreras.find((c) => c.codigo === "ITIO") || carreras[0];
      if (mockCarrera) {
        carreraEst = mockCarrera;
        materias = oasis.getMockMaterias(mockCarrera.codigo);
        dictadosArr = (materias.length > 0)
          ? await Promise.all(materias.map((m) =>
              oasis.getDictados(mockCarrera.codigo, m.codMateria).then((d) => ({ codMateria: m.codMateria, materia: m.materia, dictados: d }))
            ))
          : [];
      }
    }

    return { estudiante, periodo, carrera: carreraEst, materias, horario: dictadosArr };
  },

  // ---- Persistencia en PostgreSQL (datos propios de la app) ----
  "GET /api/db/health": () => db.health(),

  "GET /api/store": (arg) => (db.enabled ? db.getStore({ email: arg.email, role: arg.role }) : { disabled: true }),

  "PUT /api/store": (body) => (db.enabled ? db.putStore(body) : { disabled: true }),

  // Dev/test login: bypass OASIS authentication for role preview.
  // Use login="dev.docente", "dev.coordinador", or "dev.admin".
  "POST /api/dev-login": async (body) => {
    const roleMap = { docente: "DOCENTE", coordinador: "COORDINADOR", admin: "ADMIN" };
    var roleLabel = "docente";
    if (body.login === "dev.coordinador") roleLabel = "coordinador";
    else if (body.login === "dev.admin") roleLabel = "admin";
    return {
      roles: [{ codigoCarrera: "001", nombreRol: roleMap[roleLabel] || "DOCENTE" }],
      perfil: { cedula: "9999999999", apellidos: "Desarrollo", nombres: "Usuario " + roleLabel, email: body.login + "@espoch.edu.ec" },
    };
  },

  "POST /api/db-login": async (body) => {
    if (!db.enabled) return { disabled: true };
    if (!body.login || !body.password) throw new HttpError("Debe ingresar usuario y contraseña.", 400);
    const u = await db.login(body.login, body.password);
    if (!u) throw new HttpError("Usuario o contraseña incorrectos.", 401);
    return u;
  },
};

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }
  const url = new URL(req.url, "http://localhost");
  const key = req.method + " " + url.pathname;
  const handler = routes[key];
  if (!handler) {
    sendJson(res, 404, { error: "Recurso no encontrado: " + key });
    return;
  }
  const hasBody = req.method === "POST" || req.method === "PUT";
  const arg = hasBody ? await readJsonBody(req) : Object.fromEntries(url.searchParams.entries());
  await run(res, () => handler(arg));
});

// Inicializa el esquema de la BD si hay SUPABASE_URL configurada.
if (db.enabled) {
  try {
    await db.ensureSchema();
    console.log("[BFF] Supabase: conectado y esquema listo.");
  } catch (err) {
    console.error("[BFF] Supabase: no se pudo inicializar:", err.message);
  }
} else {
  console.log("[BFF] Supabase: NO configurado (defina SUPABASE_URL y SUPABASE_KEY). El frontend usará localStorage como respaldo.");
}

server.listen(PORT, () => {
  console.log(`[BFF] escuchando en http://localhost:${PORT}`);
  console.log(`[BFF] servicios SOAP: ${oasis.config.base}`);
  console.log(`[BFF] credenciales de servicio: ${oasis.config.hasCredentials ? "configuradas" : "NO configuradas (defina OASIS_USER / OASIS_PASS)"}`);
  console.log(`[BFF] Supabase: ${db.enabled ? "conectado" : "NO configurado (defina SUPABASE_URL / SUPABASE_KEY)"}`);
});
