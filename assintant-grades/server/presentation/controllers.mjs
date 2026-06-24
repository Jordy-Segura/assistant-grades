// ============================================================================
// CAPA DE PRESENTACIÓN  ·  Controladores + tabla de rutas
// ----------------------------------------------------------------------------
// Asocia cada endpoint HTTP con un caso de uso del servicio de aplicación o del
// repositorio. Solo adapta entrada/salida (HTTP <-> servicios); no contiene
// lógica de negocio. El contrato JSON con el frontend se mantiene intacto.
// ============================================================================
import { HttpError } from "./httpServer.mjs";

// Login de desarrollo/pruebas: omite OASIS (login = "dev.docente" | "dev.coordinador" | "dev.admin").
function devLogin(body) {
  const roleMap = { docente: "DOCENTE", coordinador: "COORDINADOR", admin: "ADMIN" };
  let roleLabel = "docente";
  if (body.login === "dev.coordinador") roleLabel = "coordinador";
  else if (body.login === "dev.admin") roleLabel = "admin";
  return {
    roles: [{ codigoCarrera: "001", nombreRol: roleMap[roleLabel] || "DOCENTE" }],
    perfil: { cedula: "9999999999", apellidos: "Desarrollo", nombres: "Usuario " + roleLabel, email: body.login + "@espoch.edu.ec" },
  };
}

// Construye la tabla de rutas inyectando las dependencias ya compuestas.
export function buildRoutes({ service, db, config }) {
  return {
    "GET /api/health": async () => ({
      ok: true,
      base: config.oasis.base,
      hasCredentials: config.oasis.hasCredentials,
      mock: false,
      dbEnabled: db.enabled,
      warnings: config.warnings,
    }),

    "GET /api/periodo-actual": () => service.getPeriodoActual(),
    "GET /api/facultades": () => service.getFacultades(),
    "GET /api/carreras": async () => (await service.getCarreras()).filter((c) => c.estado === "ABI"),

    "POST /api/nomina": (body) => service.resolverNomina(body),
    "POST /api/docentes-carrera": (body) => service.getDocentesCarrera(body),
    "POST /api/horario-docente": (body) => service.getHorarioDocente(body),

    "POST /api/login": (body) => {
      if (!body.login || !body.password) throw new HttpError("Debe ingresar usuario y contraseña.", 400);
      return service.login(body.login, body.password);
    },

    "POST /api/materias-docente": (body) => service.getMateriasDocente(body.codCarrera, body.cedula, body.codPeriodo),
    "POST /api/alumnos-materia": (body) => service.getAlumnosMateria(body),
    "POST /api/notas": (body) => service.getNotas(body.codCarrera, body.cedula),
    "POST /api/estudiante": (body) => service.getDatosEstudiante(body.cedula),
    "POST /api/materias-estudiante": (body) => service.getMateriasEstudiante(body.codCarrera, body.cedula, body.codPeriodo),
    "POST /api/estudiante-full": (body) => service.getEstudianteFull(body.cedula),

    // ---- Persistencia propia de la app ----
    "GET /api/db/health": () => db.health(),
    "GET /api/store": (arg) => (db.enabled ? db.getStore({ email: arg.email, role: arg.role }) : { disabled: true }),
    "PUT /api/store": (body) => (db.enabled ? db.putStore(body) : { disabled: true }),

    "POST /api/dev-login": async (body) => devLogin(body),

    "POST /api/db-login": async (body) => {
      if (!db.enabled) return { disabled: true };
      if (!body.login || !body.password) throw new HttpError("Debe ingresar usuario y contraseña.", 400);
      const u = await db.login(body.login, body.password);
      if (!u) throw new HttpError("Usuario o contraseña incorrectos.", 401);
      return u;
    },
  };
}
