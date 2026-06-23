// Minimal BFF (Backend-For-Frontend) for the Auxiliar de Calificaciones.
// It is the only component that talks SOAP to the ESPOCH OASIS services and
// keeps the service credentials off the browser. No external dependencies.
import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Load server/.env (if present) before importing the SOAP layer, which reads
// credentials from the environment at module load time.
const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(here, ".env"));
} catch {
  /* .env is optional: env vars may come from the shell instead */
}

const oasis = await import("./oasis.mjs");
const db = await import("./db.mjs");

const PORT = Number(process.env.PORT || 3001);
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": process.env.CORS_ORIGIN || "*",
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

// Wrap a handler so SOAP/network errors become clean JSON responses.
async function run(res, handler) {
  try {
    const data = await handler();
    sendJson(res, 200, data);
  } catch (err) {
    const status = err.soapFault ? 400 : 502;
    sendJson(res, status, { error: err.message || "Error consultando el servicio OASIS" });
  }
}

const routes = {
  "GET /api/health": async () => ({ ok: true, base: oasis.config.base, hasCredentials: oasis.config.hasCredentials, mock: oasis.config.mock }),

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
    if (!body.login || !body.password) {
      const e = new Error("Debe ingresar usuario y contraseña.");
      e.soapFault = true;
      throw e;
    }
    return oasis.login(body.login, body.password);
  },

  "POST /api/materias-docente": (body) =>
    oasis.getMateriasDocente(body.codCarrera, body.cedula, body.codPeriodo),

  "POST /api/alumnos-materia": (body) => oasis.getAlumnosMateria(body),

  "POST /api/notas": (body) => oasis.getNotas(body.codCarrera, body.cedula),

  "POST /api/estudiante": (body) => oasis.getDatosEstudiante(body.cedula),

  "POST /api/materias-estudiante": (body) => oasis.getMateriasEstudiante(body.codCarrera, body.cedula, body.codPeriodo),

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
    if (!body.login || !body.password) {
      const e = new Error("Debe ingresar usuario y contraseña.");
      e.soapFault = true;
      throw e;
    }
    const u = await db.login(body.login, body.password);
    if (!u) {
      const e = new Error("Usuario o contraseña incorrectos.");
      e.soapFault = true;
      throw e;
    }
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

// Inicializa el esquema de la BD si hay DATABASE_URL configurada.
if (db.enabled) {
  try {
    await db.ensureSchema();
    console.log("[BFF] PostgreSQL: conectado y esquema listo.");
  } catch (err) {
    console.error("[BFF] PostgreSQL: no se pudo inicializar:", err.message);
  }
} else {
  console.log("[BFF] PostgreSQL: NO configurado (defina DATABASE_URL). El frontend usará sessionStorage como respaldo.");
}

server.listen(PORT, () => {
  console.log(`[OASIS BFF] escuchando en http://localhost:${PORT}`);
  console.log(`[OASIS BFF] servicios SOAP: ${oasis.config.base}`);
  console.log(`[OASIS BFF] credenciales de servicio: ${oasis.config.hasCredentials ? "configuradas" : "NO configuradas (defina OASIS_USER / OASIS_PASS)"}`);
});
