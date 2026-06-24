// ============================================================================
// CAPA DE DOMINIO  ·  Patrón: Data Mapper + DTO
// ----------------------------------------------------------------------------
// Funciones PURAS (sin I/O) que traducen los registros crudos de SOAP a los DTO
// (objetos de transferencia) que consume el frontend. Aquí vive el conocimiento
// del dominio OASIS: nombres de campos, derivación de correo institucional y la
// fusión del código real de matrícula. No conocen HTTP, SOAP ni base de datos.
// ============================================================================

// Correos institucionales conocidos (override manual para casos puntuales).
const CORREOS_CONOCIDOS = {
  "2250044001": "dilan.lucero@espoch.edu.ec",
};

export function soloDigitos(v) {
  return String(v == null ? "" : v).replace(/\D/g, "");
}

// Normaliza texto: sin tildes, MAYÚSCULAS, solo A-Z 0-9 y espacios.
export function norm(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Correo institucional ESPOCH derivado del nombre: primernombre.primerapellido.
// Se usa SOLO como respaldo cuando OASIS no entrega un correo real.
export function correoInstitucional(nombres, apellidos) {
  const primera = (t) => (norm(t).toLowerCase().split(/\s+/)[0] || "");
  const n = primera(nombres);
  const a = primera(apellidos);
  if (!n || !a) return "";
  return n + "." + a + "@espoch.edu.ec";
}

// Limpia valores basura que OASIS a veces devuelve como correo ("null", "-", ...).
export function limpiarEmail(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s || !/@/.test(s) || /^(null|undefined|-{1,}|n\/?a)$/i.test(s)) return "";
  return s;
}

// ¿El correo parece pertenecer a este estudiante? (su parte local contiene algún
// token del nombre). Sirve para descartar correos placeholder que OASIS repite
// idénticos para todos los estudiantes (p. ej. andrei.alarcon@espoch.edu.ec).
function correoCoincideConNombre(email, nombres, apellidos) {
  const local = email.split("@")[0].toLowerCase();
  const tokens = norm(nombres + " " + apellidos).toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
  return tokens.some((t) => local.includes(t));
}

// Resuelve el correo del estudiante priorizando el dato REAL verdadero:
//   1) override conocido,
//   2) correo real de OASIS SOLO si parece pertenecer al estudiante,
//   3) correo institucional derivado (primernombre.primerapellido@espoch.edu.ec).
export function resolverCorreo(rawEmail, cedula, nombres, apellidos) {
  const digits = soloDigitos(cedula);
  if (CORREOS_CONOCIDOS[digits]) return CORREOS_CONOCIDOS[digits];
  const real = limpiarEmail(rawEmail);
  if (real && correoCoincideConNombre(real, nombres, apellidos)) return real;
  return correoInstitucional(nombres, apellidos);
}

// Código REAL del estudiante, nunca la cédula. Útil cuando un servicio sí lo trae.
export function pickCodigo(obj, cedula) {
  if (!obj || typeof obj !== "object") return "";
  const ced = soloDigitos(cedula);
  const candidatos = [obj.Codigo, obj.CodEstudiante, obj.CodigoEstudiante, obj.Matricula, obj.NumMatricula, obj.CodMatricula];
  for (const c of candidatos) {
    if (c != null && typeof c !== "object") {
      const s = String(c).trim();
      if (s && soloDigitos(s) !== ced) return s;
    }
  }
  return "";
}

// ---- Mappers crudo -> DTO ----------------------------------------------------

export const mapPeriodo = (r) => ({
  codigo: r?.Codigo || "",
  descripcion: r?.Descripcion || "",
  fechaInicio: r?.FechaInicio || "",
  fechaFin: r?.FechaFin || "",
});

export const mapFacultad = (f) => ({ codigo: f.Codigo || "", nombre: f.Nombre || "" });

export const mapCarrera = (c) => ({ codigo: c.Codigo || "", nombre: c.Nombre || "", estado: c.CodEstado || "" });

export const mapMateriaPensum = (m) => ({
  codMateria: m.CodMateria || "",
  materia: (m.Materia || "").trim(),
  codNivel: m.CodNivel || "",
  nivel: m.Nivel || "",
});

export const mapDictado = (d) => ({
  codNivel: d.CodNivel || "",
  nivel: d.DescripcionNivel || "",
  paralelo: d.Paralelo || "",
  docente: {
    cedula: d.Docente?.Cedula || "",
    apellidos: (d.Docente?.Apellidos || "").trim(),
    nombres: (d.Docente?.Nombres || "").trim(),
    email: limpiarEmail(d.Docente?.Email),
  },
});

// GetAlumnosMateria trae cédula/nombre/correo REAL pero NO el código de matrícula.
// El código se completa después con mergeCodigos() usando GetTodasMatriculaEstudiantes.
export const mapAlumno = (e) => ({
  codigo: "",
  cedula: e.Cedula || "",
  nombres: (e.Nombres || "").trim(),
  apellidos: (e.Apellidos || "").trim(),
  email: resolverCorreo(e.Email, e.Cedula, e.Nombres, e.Apellidos),
});

// GetTodasMatriculaEstudiantes: aquí SÍ viene el código real del estudiante.
export const mapMatricula = (m) => ({
  cedula: m.Cedula || "",
  codigo: (m.Codigo || "").trim(),
  nombres: (m.Nombres || "").trim(),
  apellidos: (m.Apellidos || "").trim(),
  codNivel: m.CodNivel || "",
  codEstado: m.CodEstado || "",
});

export const mapMateriaDocente = (m) => ({ codigo: m.Codigo || "", nombre: m.Nombre || "" });

export const mapNota = (n) => ({
  codMateria: n.CodMateria || "",
  materia: n.Materia || "",
  nota: Number(n.Acumulado ?? n.Principal ?? 0) || 0,
});

export const mapMateriaEstudiante = (m) => ({
  codMateria: m.Codigo || "",
  materia: (m.Nombre || "").trim(),
  codNivel: m.CodNivel || "",
  nivel: m.Nivel || "",
  paralelo: m.Paralelo || "",
  nota: Number(m.Nota ?? m.Acumulado ?? 0) || 0,
});

export const mapHorarioClase = (h) => ({
  codMateria: h.CodMateria || "",
  materia: (h.Materia || "").trim(),
  codDia: h.CodDia || "",
  dia: (h.Dia || "").trim(),
  inicio: h.Inicio || "",
  fin: h.Fin || "",
});

export const mapRolCarrera = (x) => ({
  codigoCarrera: x.CodigoCarrera || "",
  nombreRol: x.NombreRol || "",
});

export const mapUsuarioFacultad = (r) => ({
  cedula: r?.Cedula || "",
  apellidos: r?.Apellidos || "",
  nombres: r?.Nombres || "",
  email: r?.Email || "",
});

// Datos completos del estudiante (GetDatosCompletosEstudiante). Trae correo REAL
// y FechaNac; NO trae código (se completa aparte con la matrícula).
export const mapEstudiante = (r, cedula) => {
  const apellidos = (r.Apellidos || "").trim();
  const nombres = (r.Nombres || "").trim();
  return {
    cedula: r.Cedula || cedula,
    codigo: pickCodigo(r, r.Cedula || cedula),
    apellidos,
    nombres,
    email: resolverCorreo(r.Email, r.Cedula || cedula, nombres, apellidos),
    telefono: r.Telefono || "",
    direccion: r.Direccion || "",
    sexo: r.Sexo || "",
    fechaNacimiento: r.FechaNacimiento || r.FechaNac || "",
  };
};

// ---- Reglas de dominio -------------------------------------------------------

// Completa el código real de cada alumno cruzando por cédula con las matrículas.
export function mergeCodigos(alumnos, matriculas) {
  const porCedula = new Map();
  for (const m of matriculas || []) {
    const ced = soloDigitos(m.cedula);
    if (ced && m.codigo) porCedula.set(ced, m.codigo);
  }
  return (alumnos || []).map((a) => {
    const codigo = porCedula.get(soloDigitos(a.cedula)) || a.codigo || "";
    return { ...a, codigo };
  });
}
