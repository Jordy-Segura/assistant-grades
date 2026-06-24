// ============================================================================
// CAPA DE INFRAESTRUCTURA  ·  Patrón: Strategy (implementación alternativa)
// ----------------------------------------------------------------------------
// Implementa la MISMA interfaz que OasisGateway pero con datos de demostración
// en memoria. La capa de aplicación la usa como respaldo cuando OASIS no está
// disponible o no hay credenciales, de modo que la app sigue funcionando offline.
// ============================================================================
import { resolverCorreo } from "../domain/mappers.mjs";

const MOCK_PERIODO = { codigo: "P0045", descripcion: "2 MARZO -15 JULIO 2026", fechaInicio: "2026-02-18", fechaFin: "2026-07-18" };

const MOCK_CARRERAS = [
  { codigo: "ITIO", nombre: "TECNOLOGIAS DE LA INFORMACION (SEDE ORELLANA)", estado: "ABI" },
  { codigo: "IAGRENA", nombre: "AGRONOMIA (SEDE ORELLANA)", estado: "ABI" },
  { codigo: "IAMBENA", nombre: "INGENIERIA AMBIENTAL (SEDE ORELLANA)", estado: "ABI" },
  { codigo: "DERECO", nombre: "DERECHO (SEDE ORELLANA)", estado: "ABI" },
  { codigo: "ITS", nombre: "INGENIERIA EN TURISMO SOSTENIBLE (SEDE ORELLANA)", estado: "ABI" },
  { codigo: "IZOOENA", nombre: "ZOOTECNIA (SEDE ORELLANA)", estado: "ABI" },
  { codigo: "IBTA", nombre: "INGENIERIA EN BIOTECNOLOGIA AMBIENTAL (SEDE ORELLANA)", estado: "ABI" },
];

const MOCK_MATERIAS_POR_CARRERA = {
  ITIO: [
    { codMateria: "TEI1TB10", materia: "METODOLOGIA DE LA INVESTIGACION", codNivel: "2", nivel: "SEGUNDO" },
    { codMateria: "TEI1TP16", materia: "FUNDAMENTOS DE BASE DE DATOS", codNivel: "3", nivel: "TERCERO" },
    { codMateria: "TEI1TB26", materia: "METODOS NUMERICOS", codNivel: "4", nivel: "CUARTO" },
    { codMateria: "TEI1TP24", materia: "DISENO DE EXPERIENCIA DE USUARIO", codNivel: "4", nivel: "CUARTO" },
  ],
  IAGRENA: [{ codMateria: "AGR1TB01", materia: "INTRODUCCION A LA AGRONOMIA", codNivel: "1", nivel: "PRIMERO" }],
  IAMBENA: [{ codMateria: "AMB1TB01", materia: "INTRODUCCION A LA INGENIERIA AMBIENTAL", codNivel: "1", nivel: "PRIMERO" }],
};

const MOCK_DOCENTES = {
  ITIO: [
    { cedula: "0601234567", nombres: "JUAN CARLOS", apellidos: "MARTINEZ LOPEZ", email: "juan.martinez@espoch.edu.ec" },
    { cedula: "0602345678", nombres: "MARIA ELENA", apellidos: "SANCHEZ PEREZ", email: "maria.sanchez@espoch.edu.ec" },
  ],
};

const MOCK_ESTUDIANTES_POR_NIVEL = {
  "3": [
    { codigo: "3038", cedula: "1206988014", nombres: "YIXON STALYN", apellidos: "CAMPUZANO AGUIRRE" },
    { codigo: "3047", cedula: "2250281298", nombres: "ANDREA MELANY", apellidos: "MONTANO GREFA" },
    { codigo: "3052", cedula: "2200581318", nombres: "JALITZA ANDREA", apellidos: "QUIROGA PERALTA" },
    { codigo: "3053", cedula: "0804964443", nombres: "WELINTON ISAIAS", apellidos: "SACON CHILA" },
  ],
};

function derivarMateriasDe(codCarrera) {
  return MOCK_MATERIAS_POR_CARRERA[codCarrera] || [];
}

// Implementa la misma interfaz que OasisGateway con datos de demostración.
export class MockOasisGateway {
  async getPeriodoActual() {
    return { ...MOCK_PERIODO };
  }

  async getFacultades() {
    return [{ codigo: "FRN", nombre: "SEDE ORELLANA" }];
  }

  async getCarreras() {
    return MOCK_CARRERAS.map((c) => ({ ...c }));
  }

  async getMalla(codCarrera) {
    return derivarMateriasDe(codCarrera).map((m) => ({ ...m }));
  }

  async getDictados(codCarrera, codMateria) {
    const materia = derivarMateriasDe(codCarrera).find((m) => m.codMateria === codMateria);
    if (!materia) return [];
    const docentes = MOCK_DOCENTES[codCarrera] || [{ cedula: "0600000000", apellidos: "DOCENTE", nombres: "SISTEMA", email: "docente@espoch.edu.ec" }];
    return [
      { codNivel: materia.codNivel, nivel: materia.nivel, paralelo: "1", docente: { ...docentes[0] } },
      { codNivel: materia.codNivel, nivel: materia.nivel, paralelo: "2", docente: { ...(docentes[1] || docentes[0]) } },
    ];
  }

  async getAlumnosMateria({ codNivel }) {
    const lista = MOCK_ESTUDIANTES_POR_NIVEL[String(codNivel || "")] || [];
    return lista.map((e) => ({
      codigo: "",
      cedula: e.cedula,
      nombres: e.nombres,
      apellidos: e.apellidos,
      email: resolverCorreo("", e.cedula, e.nombres, e.apellidos),
    }));
  }

  async getTodasMatricula() {
    const out = [];
    for (const [codNivel, lista] of Object.entries(MOCK_ESTUDIANTES_POR_NIVEL)) {
      for (const e of lista) {
        out.push({ cedula: e.cedula, codigo: e.codigo, nombres: e.nombres, apellidos: e.apellidos, codNivel, codEstado: "MAT" });
      }
    }
    return out;
  }

  async getMateriasDocente(codCarrera) {
    return derivarMateriasDe(codCarrera).map((m) => ({ codigo: m.codMateria, nombre: m.materia }));
  }

  async getNotas(codCarrera) {
    return derivarMateriasDe(codCarrera).map((m) => ({ codMateria: m.codMateria, materia: m.materia, nota: 0 }));
  }

  async getDatosEstudiante(cedula) {
    const digits = String(cedula || "").replace(/\D/g, "");
    for (const lista of Object.values(MOCK_ESTUDIANTES_POR_NIVEL)) {
      const e = lista.find((s) => String(s.cedula).replace(/\D/g, "") === digits);
      if (e) {
        return {
          cedula: e.cedula, codigo: e.codigo, apellidos: e.apellidos, nombres: e.nombres,
          email: resolverCorreo("", e.cedula, e.nombres, e.apellidos),
          telefono: "", direccion: "", sexo: "", fechaNacimiento: "",
        };
      }
    }
    return null;
  }

  async getMateriasEstudiante() {
    return [];
  }

  async getHorarioDocente(codCarrera) {
    const DIAS = ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"];
    return derivarMateriasDe(codCarrera).slice(0, 5).map((m, i) => ({
      codMateria: m.codMateria, materia: m.materia,
      codDia: String(i + 1), dia: DIAS[i % DIAS.length], inicio: "07:00", fin: "09:00",
    }));
  }

  async getUsuarioFacultad(login) {
    return { cedula: "0600000000", apellidos: "USUARIO DE PRUEBA", nombres: "MODO DEV", email: login || "dev@espoch.edu.ec" };
  }

  async autenticarUsuarioCarrera(login) {
    const isCoordinador = /coordinador|admin/i.test(login) || login === "ppaguay@espoch.edu.ec";
    return [{ codigoCarrera: "ITIO", nombreRol: isCoordinador ? "COORDINADOR" : "DOCENTE" }];
  }
}
