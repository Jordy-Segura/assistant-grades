import * as oasisApi from "./oasisApi";

/**
 * Servicio especializado en la gestión de estudiantes y sincronización de nóminas.
 */
export const StudentService = {
  /**
   * Normaliza una cédula eliminando caracteres no numéricos.
   */
  normalizeCedula: (ced) => String(ced || "").replace(/[^0-9]/g, ""),

  /**
   * Agrega estudiantes a la lista global STATE.students evitando duplicados.
   * @param {Array} alumnos - Lista de alumnos provenientes de OASIS.
   * @returns {number} Cantidad de estudiantes nuevos agregados.
   */
  mergeGlobalStudents: (alumnos) => {
    if (!window.STATE) return 0;
    const existing = (window.STATE.students || []).map(StudentService.normalizeCedula);
    const nuevos = (alumnos || [])
      .filter(a => {
        const ced = StudentService.normalizeCedula(a.cedula);
        return ced && existing.indexOf(ced) === -1;
      })
      .map(a => ({
        id: "s" + Date.now() + Math.random().toString(36).slice(2, 6),
        codigo: a.codigo || "",
        cedula: a.cedula,
        apellidos: (a.apellidos || "").toUpperCase(),
        nombres: (a.nombres || "").toUpperCase(),
      }));

    if (nuevos.length) {
      window.STATE.students = (window.STATE.students || []).concat(nuevos);
    }
    return nuevos.length;
  },

  /**
   * Sincroniza la nómina de una configuración específica con OASIS y persiste en Supabase.
   * @param {string} configId - ID de la configuración activa.
   * @param {Object} courseConfig - Configuración del curso (carrera, asignatura, etc).
   * @returns {Promise<{alumnos: Array, resuelto: Object, updateCount: number, toAddCount: number}>}
   */
  async syncStudentsWithOasis(configId, courseConfig) {
    const { carrera, asignatura, facultad, docente, codCarrera } = courseConfig;
    
    // 1. Resolver nómina desde OASIS
    const res = await oasisApi.importarNomina({ carrera, asignatura, facultad, docente, codCarrera });
    const alumnos = (res && res.estudiantes) || [];
    const resuelto = (res && res.resuelto) || {};

    if (alumnos.length === 0) {
      return { alumnos: [], resuelto, updateCount: 0, toAddCount: 0 };
    }

    // 2. Procesar Upsert en el estado local (STATE.studentsByConfig)
    const existingStudents = window.STATE.studentsByConfig[configId] || [];
    const cedToStudent = {};
    existingStudents.forEach(s => { 
      cedToStudent[this.normalizeCedula(s.cedula)] = s; 
    });

    const toAdd = [];
    let updateCount = 0;

    alumnos.forEach(a => {
      const ced = this.normalizeCedula(a.cedula);
      if (!ced) return;
      const match = cedToStudent[ced];
      if (match) {
        match.apellidos = (a.apellidos || "").toUpperCase();
        match.nombres = (a.nombres || "").toUpperCase();
        if (a.codigo) match.codigo = a.codigo;
        updateCount++;
      } else {
        toAdd.push({
          id: "s" + Date.now() + Math.random().toString(36).slice(2, 6),
          codigo: a.codigo || "",
          cedula: a.cedula,
          apellidos: (a.apellidos || "").toUpperCase(),
          nombres: (a.nombres || "").toUpperCase(),
        });
      }
    });

    const finalStudents = [...existingStudents, ...toAdd];
    window.STATE.studentsByConfig[configId] = finalStudents;
    window.STATE.students = JSON.parse(JSON.stringify(finalStudents));

    // 3. Guardar en Supabase usando la API granular (Fase 5)
    try {
      await oasisApi.putEstudiantes(configId, { estudiantes: finalStudents });
    } catch (e) {
      console.error("[StudentService] Error guardando estudiantes en Supabase:", e);
    }

    return {
      alumnos,
      resuelto,
      updateCount,
      toAddCount: toAdd.length,
      finalStudents
    };
  },

  /**
   * Actualiza los códigos de la configuración basándose en la respuesta de OASIS.
   */
  updateConfigCodes(src) {
    if (!src || !window.STATE || !window.STATE.courseConfig) return;
    const fields = ["codCarrera", "codMateria", "codNivel", "codParalelo", "codPeriodo"];
    fields.forEach(field => {
      if (src[field]) {
        window.STATE.courseConfig[field] = src[field];
        const foundCfg = window.STATE.savedConfigs?.find(cc => cc.id === window.STATE.activeConfigId);
        if (foundCfg && foundCfg.courseConfig) {
          foundCfg.courseConfig[field] = src[field];
        }
      }
    });
  }
};
