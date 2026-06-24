// Cliente del BFF (Backend-For-Frontend) que consume los servicios SOAP de
// OASIS (ESPOCH). El navegador NUNCA habla SOAP ni conoce credenciales de
// servicio: solo intercambia JSON con este backend intermedio.
//
//   Seguridad.asmx    -> login (AutenticarUsuarioCarrera) + correo (GetUsuarioFacultad)
//   InfoGeneral.asmx  -> periodo académico actual (GetPeriodoActual)
//   InfoCarrera.asmx  -> nómina (GetAlumnosMateria) y notas (GetUltimasNotas...)

const DEFAULT_API_BASE_URL = import.meta.env.PROD ? "" : "http://localhost:3001";
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, "");

function apiUrl(path) {
  if (API_BASE_URL.endsWith("/api") && path.startsWith("/api/")) {
    return `${API_BASE_URL}${path.slice(4)}`;
  }
  return `${API_BASE_URL}${path}`;
}

async function request(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(apiUrl(path), {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const err = new Error("No se pudo contactar el servicio OASIS (BFF sin conexión).");
    err.offline = true;
    throw err;
  }

  let data;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error((data && data.error) || `Error ${response.status} consultando OASIS`);
  }
  return data;
}

/** ¿Está disponible el BFF? Devuelve {ok, hasCredentials} o null si no responde. */
export async function checkHealth() {
  try {
    return await request("/api/health");
  } catch {
    return null;
  }
}

/** Autentica al usuario contra Seguridad.asmx. Devuelve {roles, perfil}. */
export function login(usuario, password) {
  return request("/api/login", { method: "POST", body: { login: usuario, password } });
}

/** Período académico actual (InfoGeneral.asmx). */
export function getPeriodoActual() {
  return request("/api/periodo-actual");
}

/** Materias que dicta un docente en una carrera/periodo (InfoCarrera.asmx). */
export function getMateriasDocente({ codCarrera, cedula, codPeriodo }) {
  return request("/api/materias-docente", { method: "POST", body: { codCarrera, cedula, codPeriodo } });
}

/** Nómina de estudiantes de una materia/paralelo (InfoCarrera.asmx). */
export function getAlumnosMateria(params) {
  return request("/api/alumnos-materia", { method: "POST", body: params });
}

/** Últimas notas de un estudiante en su carrera (InfoCarrera.asmx). */
export function getNotas({ codCarrera, cedula }) {
  return request("/api/notas", { method: "POST", body: { codCarrera, cedula } });
}

/** Datos completos del estudiante + materias + notas + horario en una sola llamada. */
export function getDatosEstudiante({ cedula }) {
  return request("/api/estudiante", { method: "POST", body: { cedula } });
}

/** Todo en uno: datos personales + materias actuales + notas + horario. */
export function getEstudianteFull({ cedula }) {
  return request("/api/estudiante-full", { method: "POST", body: { cedula } });
}

/** Materias de un estudiante en una carrera/periodo (GetMateriasEstudiante). */
export function getMateriasEstudiante({ codCarrera, cedula, codPeriodo }) {
  return request("/api/materias-estudiante", { method: "POST", body: { codCarrera, cedula, codPeriodo } });
}

/** Catálogo de carreras abiertas (InfoGeneral.asmx). */
export function getCarreras() {
  return request("/api/carreras");
}

/**
 * Importación AUTOMÁTICA de nómina: resuelve carrera + asignatura (por nombre)
 * a sus códigos OASIS y devuelve { resuelto, estudiantes }.
 */
export function importarNomina({ carrera, asignatura, facultad, docente, codCarrera, paralelo, codParalelo }) {
  return request("/api/nomina", {
    method: "POST",
    body: { carrera, asignatura, facultad, docente, codCarrera, paralelo, codParalelo },
  });
}

/** Docentes de una carrera con sus cargas horarias (InfoCarrera.GetDictadosMateria). */
export function getDocentesCarrera({ carrera, facultad, codCarrera }) {
  return request("/api/docentes-carrera", { method: "POST", body: { carrera, facultad, codCarrera } });
}

/** Horario de clases de un docente (InfoCarrera.GetHorariosDocente). */
export function getHorarioDocente({ codCarrera, carrera, facultad, cedula, codPeriodo }) {
  return request("/api/horario-docente", {
    method: "POST",
    body: { codCarrera, carrera, facultad, cedula, codPeriodo },
  });
}

// ---- Persistencia en PostgreSQL (a través del BFF) ----

/** ¿Está la base de datos configurada/disponible? */
export async function dbHealth() {
  try {
    return await request("/api/db/health");
  } catch {
    return { enabled: false };
  }
}

/** Trae el "store" (docentes, asignaciones, configuraciones, estudiantes, notas). */
export function getStore({ email, role }) {
  const qs = new URLSearchParams({ email: email || "", role: role || "" }).toString();
  return request(`/api/store?${qs}`);
}

/** Guarda (sincroniza) el store. */
export function putStore(payload) {
  return request("/api/store", { method: "PUT", body: payload });
}

/** Catalogo RAC/RAAU/procedimientos persistido en Neon. */
export function getVectorCatalog() {
  return request("/api/catalogo-vectores");
}

/** Reemplaza el catalogo RAC/RAAU/procedimientos en Neon. */
export function putVectorCatalog(payload) {
  return request("/api/catalogo-vectores", { method: "PUT", body: payload });
}

/** Crea una pagina temporal de descarga para QR (Excel/PDF). */
export async function createExportPage(payload) {
  const data = await request("/api/export-cache", { method: "POST", body: { payload } });
  if (!data || !data.path) return data;
  let base = API_BASE_URL || window.location.origin;
  try {
    const apiUrl = new URL(API_BASE_URL);
    if (/^(localhost|127\.0\.0\.1)$/i.test(apiUrl.hostname) && window.location.hostname && !/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)) {
      apiUrl.hostname = window.location.hostname;
      base = apiUrl.toString().replace(/\/+$/, "");
    }
  } catch {
    /* mantiene API_BASE_URL */
  }
  return { ...data, pageUrl: new URL(data.path, base + "/").toString() };
}

/** Dev/test login: bypass OASIS. Usar login="dev.docente", "dev.coordinador", o "dev.admin". */
export function devLogin(usuario, password) {
  return request("/api/dev-login", { method: "POST", body: { login: usuario, password } });
}

/** Login verificado contra la base de datos (contraseña hasheada). */
export function loginDb(usuario, password) {
  return request("/api/db-login", { method: "POST", body: { login: usuario, password } });
}

/** Cambia la contrasena de una cuenta interna validando la clave actual en Neon. */
export function updateDbPassword({ email, currentPassword, newPassword }) {
  return request("/api/db-password", { method: "POST", body: { email, currentPassword, newPassword } });
}

/** Reclama una sesion activa para impedir dos ingresos simultaneos. */
export function claimSession({ email, sessionId, userAgent, name, role, cedula }) {
  return request("/api/session/claim", {
    method: "POST",
    body: { email, sessionId, userAgent, name, role, cedula },
  });
}

/** Libera la sesion activa al cerrar sesion. */
export function releaseSession({ email, sessionId }) {
  return request("/api/session/release", { method: "POST", body: { email, sessionId } });
}

export const apiBaseUrl = API_BASE_URL;
