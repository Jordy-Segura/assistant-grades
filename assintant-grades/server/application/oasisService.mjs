// ============================================================================
// CAPA DE APLICACIÓN  ·  Servicios de caso de uso (lógica de negocio)
// ----------------------------------------------------------------------------
// Orquesta los gateways (real + mock) y los mappers para resolver los casos de
// uso del sistema: nómina con código real, datos completos del estudiante, etc.
// Patrones: Facade (expone una API simple a los controladores), Strategy
// (alterna entre gateway real y mock como respaldo) y reglas de dominio
// (fusión del código de matrícula). No conoce HTTP ni SOAP.
// ============================================================================
import { norm, mergeCodigos } from "../domain/mappers.mjs";

const MATRICULA_TTL_MS = 5 * 60 * 1000;

export class OasisService {
  constructor({ gateway, mock, config }) {
    this.gateway = gateway; // OasisGateway (real)
    this.mock = mock;       // MockOasisGateway (respaldo)
    this.config = config;
    this.matriculaCache = new Map(); // "R|carrera|periodo" -> { at, data }
  }

  // Ejecuta la operación real; ante cualquier fallo, usa el respaldo mock.
  async #withFallback(realFn, mockFn) {
    try {
      return await realFn();
    } catch {
      return await mockFn();
    }
  }

  // ---- Primitivas resilientes (real -> mock) ----
  getPeriodoActual() {
    return this.#withFallback(() => this.gateway.getPeriodoActual(), () => this.mock.getPeriodoActual());
  }
  getFacultades() {
    return this.#withFallback(() => this.gateway.getFacultades(), () => this.mock.getFacultades());
  }
  getCarreras() {
    return this.#withFallback(() => this.gateway.getCarreras(), () => this.mock.getCarreras());
  }
  getMalla(codCarrera) {
    return this.#withFallback(() => this.gateway.getMalla(codCarrera), () => this.mock.getMalla(codCarrera));
  }
  getDictados(codCarrera, codMateria) {
    return this.#withFallback(() => this.gateway.getDictados(codCarrera, codMateria), () => this.mock.getDictados(codCarrera, codMateria));
  }
  getMateriasDocente(codCarrera, cedula, codPeriodo) {
    return this.#withFallback(
      () => this.gateway.getMateriasDocente(codCarrera, cedula, codPeriodo),
      () => this.mock.getMateriasDocente(codCarrera, cedula, codPeriodo)
    );
  }
  getNotas(codCarrera, cedula) {
    return this.#withFallback(() => this.gateway.getNotas(codCarrera, cedula), () => this.mock.getNotas(codCarrera, cedula));
  }
  getDatosEstudiante(cedula) {
    return this.#withFallback(() => this.gateway.getDatosEstudiante(cedula), () => this.mock.getDatosEstudiante(cedula));
  }
  getMateriasEstudiante(codCarrera, cedula, codPeriodo) {
    return this.#withFallback(
      () => this.gateway.getMateriasEstudiante(codCarrera, cedula, codPeriodo),
      () => this.mock.getMateriasEstudiante(codCarrera, cedula, codPeriodo)
    );
  }

  // Matrícula de la carrera (con código real) — cacheada por carrera+período.
  async #getMatriculas(gateway, codCarrera, codPeriodo) {
    if (!codCarrera || !codPeriodo) return [];
    const key = (gateway === this.gateway ? "R|" : "M|") + codCarrera + "|" + codPeriodo;
    const hit = this.matriculaCache.get(key);
    if (hit && Date.now() - hit.at < MATRICULA_TTL_MS) return hit.data;
    let data = [];
    try {
      data = await gateway.getTodasMatricula(codCarrera, codPeriodo);
    } catch {
      data = [];
    }
    this.matriculaCache.set(key, { at: Date.now(), data });
    return data;
  }

  // Nómina + código REAL: GetAlumnosMateria no trae código, así que lo cruzamos
  // por cédula con GetTodasMatriculaEstudiantes.
  async #nominaConCodigos(gateway, params) {
    const alumnos = await gateway.getAlumnosMateria(params);
    const matriculas = await this.#getMatriculas(gateway, params.codCarrera, params.codPeriodo);
    return mergeCodigos(alumnos, matriculas);
  }

  // Nómina directa (ruta /api/alumnos-materia).
  getAlumnosMateria(params) {
    return this.#withFallback(
      () => this.#nominaConCodigos(this.gateway, params),
      () => this.#nominaConCodigos(this.mock, params)
    );
  }

  // ---- Resolución (nombre -> códigos) ----
  async #resolverCarrera(gateway, nombre, facultad) {
    const carreras = (await gateway.getCarreras()).filter((c) => c.estado === "ABI");
    const target = norm(nombre);
    if (!target) return null;
    const wantOrellana = /ORELLANA/.test(norm(facultad));
    const baseName = (n) => norm(n).replace(/ SEDE.*$/, "").replace(/ MORONA.*$/, "").trim();
    const matches = carreras.filter((c) => {
      const cn = baseName(c.nombre);
      return cn === target || cn.includes(target) || target.includes(cn);
    });
    if (!matches.length) return null;
    if (wantOrellana) {
      const orellana = matches.find((c) => /ORELLANA/.test(norm(c.nombre)));
      if (orellana) return orellana;
    }
    const plain = matches.find((c) => !/SEDE|MORONA|\(/.test(c.nombre));
    return plain || matches[0];
  }

  async #resolverNominaWith(gateway, body) {
    const carreraOasis = body.codCarrera
      ? { codigo: body.codCarrera, nombre: body.carrera || body.codCarrera }
      : await this.#resolverCarrera(gateway, body.carrera, body.facultad);
    if (!carreraOasis) throw new Error(`No se encontró la carrera "${body.carrera || body.codCarrera}" en OASIS.`);

    const malla = await gateway.getMalla(carreraOasis.codigo);
    const objetivo = norm(body.asignatura);
    const materia =
      malla.find((m) => norm(m.materia) === objetivo) ||
      malla.find((m) => norm(m.materia).includes(objetivo) || objetivo.includes(norm(m.materia)));
    if (!materia) throw new Error(`La asignatura "${body.asignatura}" no se encontró en la malla de ${carreraOasis.nombre}.`);

    const dictados = await gateway.getDictados(carreraOasis.codigo, materia.codMateria);
    if (!dictados.length) throw new Error(`"${materia.materia}" (${materia.codMateria}) no tiene paralelos activos este período en ${carreraOasis.nombre}.`);

    const docNorm = norm(body.docente);
    const elegido =
      (docNorm && dictados.find((d) => norm(d.docente.apellidos + " " + d.docente.nombres).includes(docNorm))) ||
      dictados[0];

    const periodo = await gateway.getPeriodoActual();
    if (!periodo || !periodo.codigo) throw new Error("No se pudo obtener el período académico actual desde OASIS.");

    const estudiantes = await this.#nominaConCodigos(gateway, {
      codCarrera: carreraOasis.codigo,
      codNivel: elegido.codNivel || materia.codNivel,
      codParalelo: elegido.paralelo,
      codPeriodo: periodo.codigo,
      codMateria: materia.codMateria,
    });

    return {
      resuelto: {
        codCarrera: carreraOasis.codigo,
        carrera: carreraOasis.nombre,
        codMateria: materia.codMateria,
        materia: materia.materia,
        codNivel: elegido.codNivel || materia.codNivel,
        nivel: elegido.nivel || materia.nivel,
        paralelo: elegido.paralelo,
        codPeriodo: periodo.codigo,
        periodo: periodo.descripcion,
        docente: elegido.docente,
        paralelosDisponibles: dictados.map((d) => d.paralelo),
      },
      estudiantes,
    };
  }

  resolverNomina(body) {
    return this.#withFallback(() => this.#resolverNominaWith(this.gateway, body), () => this.#resolverNominaWith(this.mock, body));
  }

  async #docentesCarreraWith(gateway, body) {
    const carreraOasis = body.codCarrera
      ? { codigo: body.codCarrera, nombre: body.carrera || body.codCarrera }
      : await this.#resolverCarrera(gateway, body.carrera, body.facultad);
    if (!carreraOasis) throw new Error(`No se encontró la carrera "${body.carrera}" en OASIS.`);

    const malla = await gateway.getMalla(carreraOasis.codigo);
    const porDocente = new Map();
    let index = 0;
    const worker = async () => {
      while (index < malla.length) {
        const m = malla[index++];
        let dictados = [];
        try {
          dictados = await gateway.getDictados(carreraOasis.codigo, m.codMateria);
        } catch {
          dictados = [];
        }
        for (const d of dictados) {
          const ced = d.docente.cedula;
          if (!ced) continue;
          if (!porDocente.has(ced)) {
            porDocente.set(ced, { cedula: ced, apellidos: d.docente.apellidos, nombres: d.docente.nombres, email: d.docente.email, cargas: [] });
          }
          porDocente.get(ced).cargas.push({
            codMateria: m.codMateria, materia: m.materia,
            codNivel: d.codNivel || m.codNivel, nivel: d.nivel || m.nivel, paralelo: d.paralelo,
          });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, malla.length || 1) }, worker));

    const docentes = Array.from(porDocente.values()).sort((a, b) =>
      (a.apellidos + a.nombres).localeCompare(b.apellidos + b.nombres)
    );
    return { carrera: carreraOasis.nombre, codCarrera: carreraOasis.codigo, docentes };
  }

  getDocentesCarrera(body) {
    return this.#withFallback(() => this.#docentesCarreraWith(this.gateway, body), () => this.#docentesCarreraWith(this.mock, body));
  }

  async #horarioDocenteWith(gateway, body) {
    let cod = body.codCarrera;
    if (!cod) {
      const c = await this.#resolverCarrera(gateway, body.carrera, body.facultad);
      if (!c) throw new Error(`No se encontró la carrera "${body.carrera}" en OASIS.`);
      cod = c.codigo;
    }
    const periodo = body.codPeriodo || (await gateway.getPeriodoActual()).codigo;
    const clases = await gateway.getHorarioDocente(cod, body.cedula, periodo);
    return { codCarrera: cod, codPeriodo: periodo, clases };
  }

  getHorarioDocente(body) {
    return this.#withFallback(() => this.#horarioDocenteWith(this.gateway, body), () => this.#horarioDocenteWith(this.mock, body));
  }

  // Datos completos + materias actuales + horario, con código real del estudiante.
  async getEstudianteFull(cedula) {
    const [estudiante, periodo, carreras] = await Promise.all([
      this.getDatosEstudiante(cedula),
      this.getPeriodoActual(),
      this.getCarreras(),
    ]);
    const codPeriodo = periodo?.codigo || "";
    if (!codPeriodo || !estudiante) return { estudiante, materias: [], horario: [] };

    // Busca la carrera del estudiante (prioriza Sede Orellana).
    const orellana = carreras.filter((c) => c.nombre.toUpperCase().includes("ORELLANA"));
    const otras = carreras.filter((c) => !c.nombre.toUpperCase().includes("ORELLANA"));
    const priorizadas = [...orellana, ...otras].slice(0, 30);

    const results = await Promise.allSettled(
      priorizadas.map((c) => this.getMateriasEstudiante(c.codigo, cedula, codPeriodo).then((ms) => ({ carrera: c, materias: ms })))
    );
    let carreraEst = null;
    let materias = [];
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.materias?.length > 0) {
        carreraEst = r.value.carrera;
        materias = r.value.materias;
        break;
      }
    }

    // Completa el código real del estudiante desde la matrícula de su carrera.
    if (carreraEst && !estudiante.codigo) {
      const matriculas = await this.#getMatriculas(this.gateway, carreraEst.codigo, codPeriodo);
      const ced = String(cedula).replace(/\D/g, "");
      const mat = matriculas.find((m) => String(m.cedula).replace(/\D/g, "") === ced);
      if (mat && mat.codigo) estudiante.codigo = mat.codigo;
    }

    const horario = materias.length > 0
      ? await Promise.all(materias.map((m) =>
          this.getDictados(carreraEst.codigo, m.codMateria).then((d) => ({ codMateria: m.codMateria, materia: m.materia, dictados: d }))
        ))
      : [];

    return { estudiante, periodo, carrera: carreraEst, materias, horario };
  }

  // ---- Seguridad ----
  async login(usuario, password) {
    if (!this.config.oasis.hasCredentials) {
      const roles = await this.mock.autenticarUsuarioCarrera(usuario);
      const perfil = await this.mock.getUsuarioFacultad(usuario);
      return { roles, perfil };
    }
    let roles;
    try {
      roles = await this.gateway.autenticarUsuarioCarrera(usuario, password);
    } catch (err) {
      if (/referencia a objeto/i.test(err.message)) {
        const e = new Error("Usuario o contraseña incorrectos.");
        e.soapFault = true;
        throw e;
      }
      throw err;
    }
    let perfil = { cedula: "", apellidos: "", nombres: "", email: "" };
    try {
      perfil = await this.gateway.getUsuarioFacultad(usuario, password);
    } catch {
      /* el perfil es opcional */
    }
    return { roles, perfil };
  }
}
