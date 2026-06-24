// ============================================================================
// CAPA DE INFRAESTRUCTURA  ·  Patrón: Gateway / Repository (acceso a datos OASIS)
// ----------------------------------------------------------------------------
// Una clase con un método por operación SOAP. Cada método: arma parámetros,
// invoca el SoapClient (Facade) y traduce el resultado con los Mappers a DTO.
// No contiene lógica de negocio (eso vive en la capa de aplicación). Lanza
// excepción ante cualquier fallo: el respaldo a mock lo decide la capa superior.
//
// Servicios consumidos:
//   InfoGeneral.asmx · InfoCarrera.asmx · Seguridad.asmx
// ============================================================================
import { asArray } from "./xml.mjs";
import * as M from "../domain/mappers.mjs";

// OASIS exige la cédula con guion (220023003-1). Convierte 10 dígitos al formato.
function formatearCedula(ced) {
  const digits = String(ced || "").replace(/\D/g, "");
  if (digits.length === 10) return digits.slice(0, 9) + "-" + digits.slice(9);
  return ced;
}

export class OasisGateway {
  constructor(soapClient) {
    this.soap = soapClient;
  }

  // ---- InfoGeneral.asmx ----
  async getPeriodoActual() {
    return M.mapPeriodo((await this.soap.call("InfoGeneral", "GetPeriodoActual")) || {});
  }

  async getFacultades() {
    const r = await this.soap.call("InfoGeneral", "GetTodasFacultades");
    return asArray(r?.Facultad).map(M.mapFacultad);
  }

  async getCarreras() {
    const r = await this.soap.call("InfoGeneral", "GetTodasCarreras");
    return asArray(r?.UnidadAcademica).map(M.mapCarrera).filter((c) => c.codigo);
  }

  // ---- InfoCarrera.asmx ----
  async getMalla(codCarrera) {
    const r = await this.soap.call("InfoCarrera", "GetMallaCurricularPensumVigenteSinDescripcion", { strCodCarrera: codCarrera });
    return asArray(r?.Materia_Pensum).map(M.mapMateriaPensum);
  }

  async getDictados(codCarrera, codMateria) {
    const r = await this.soap.call("InfoCarrera", "GetDictadosMateria", { CodCarrera: codCarrera, CodMateria: codMateria });
    return asArray(r?.Dictado_Materia).map(M.mapDictado);
  }

  async getAlumnosMateria({ codCarrera, codNivel, codParalelo, codPeriodo, codMateria }) {
    const r = await this.soap.call("InfoCarrera", "GetAlumnosMateria", {
      strCodCarrera: codCarrera,
      strCodNivel: codNivel,
      strCodParalelo: codParalelo,
      strCodPeriodo: codPeriodo,
      strCodMateria: codMateria,
    });
    return asArray(r?.Estudiante).map(M.mapAlumno);
  }

  // Matrícula de TODA la carrera en un período: incluye el CÓDIGO real del estudiante.
  async getTodasMatricula(codCarrera, codPeriodo) {
    const r = await this.soap.call("InfoCarrera", "GetTodasMatriculaEstudiantes", {
      strCodCarrera: codCarrera,
      strCodPeriodo: codPeriodo,
    });
    return asArray(r?.TodasMatriculaEstudiantes).map(M.mapMatricula);
  }

  async getMateriasDocente(codCarrera, cedula, codPeriodo) {
    const r = await this.soap.call("InfoCarrera", "GetMateriasDocente", {
      CodCarrera: codCarrera,
      Cedula: formatearCedula(cedula),
      CodPeriodo: codPeriodo,
    });
    return asArray(r?.Materia).map(M.mapMateriaDocente);
  }

  async getNotas(codCarrera, cedula) {
    const r = await this.soap.call("InfoCarrera", "GetUltimasNotasEstudianteCarrera", {
      strCodCarrera: codCarrera,
      strCedula: formatearCedula(cedula),
    });
    return asArray(r?.Notas).map(M.mapNota);
  }

  async getDatosEstudiante(cedula) {
    const r = await this.soap.call("InfoCarrera", "GetDatosCompletosEstudiante", { strCedula: formatearCedula(cedula) });
    return r ? M.mapEstudiante(r, cedula) : null;
  }

  async getMateriasEstudiante(codCarrera, cedula, codPeriodo) {
    const r = await this.soap.call("InfoCarrera", "GetMateriasEstudiante", {
      CodCarrera: codCarrera,
      Cedula: formatearCedula(cedula),
      CodPeriodo: codPeriodo,
    });
    return asArray(r?.Materia).map(M.mapMateriaEstudiante);
  }

  async getHorarioDocente(codCarrera, cedula, codPeriodo) {
    const r = await this.soap.call("InfoCarrera", "GetHorariosDocente", {
      strCodCarrera: codCarrera,
      strCedula: formatearCedula(cedula),
      strCodPeriodo: codPeriodo,
    });
    return asArray(r?.HorarioClase).map(M.mapHorarioClase);
  }

  // ---- Seguridad.asmx ----
  async getUsuarioFacultad(login, password) {
    return M.mapUsuarioFacultad((await this.soap.call("Seguridad", "GetUsuarioFacultad", { login, password })) || {});
  }

  async autenticarUsuarioCarrera(login, password) {
    const r = await this.soap.call("Seguridad", "AutenticarUsuarioCarrera", { login, password });
    return asArray(r?.RolCarrera).map(M.mapRolCarrera);
  }
}
