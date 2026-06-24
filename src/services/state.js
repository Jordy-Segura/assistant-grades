// Capa de compatibilidad para el estado global (window.STATE)
// window.STATE es gestionado por legacyRuntime.js como fuente única de verdad.
// Este módulo solo expone acceso a window.STATE y constantes del sistema.

import * as oasis from "./oasisApi.js";

export const STORAGE_KEY = "espoch_state_v1";

export const COMPONENT_WEIGHTS = { ACD: 3.5, APEX: 3.5, AAUT: 3.0 };
export const COMPONENT_COLORS = { ACD: "#3b82f6", APEX: "#22c55e", AAUT: "#f59e0b" };
export const COMPONENT_LABELS = {
  ACD: "Aprendizaje en Contacto con el Docente",
  APEX: "Aprendizaje Práctico Experimental",
  AAUT: "Aprendizaje Autónomo",
};
export const COMPONENTS = ["ACD", "APEX", "AAUT"];

export const DEFAULT_STATE = {
  courseConfig: {
    periodoAcademico: "",
    facultad: "SEDE ORELLANA",
    carrera: "",
    asignatura: "",
    docente: "",
    pao: "",
    aporte: "FIN DE CICLO",
  },
  selectedRACIds: [],
  raauEntries: [],
  activities: [],
  configLocked: false,
  activeConfigId: "",
  editingConfigId: "",
  savedConfigs: [],
  studentsByConfig: {},
  gradesByConfig: {},
  teacherAssignments: [],
  docentes: [],
  students: [],
  grades: [],
  recentActivity: [],
  currentUser: null,
};

export function getState() {
  return window.STATE || {};
}

export function initState() {
  if (typeof window === "undefined") return;
  if (!window.STATE) window.STATE = {};
  window.getState = getState;
}
