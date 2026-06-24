// Gestión centralizada de estado (STATE)
// Reemplaza gradualmente la gestión de estado en legacyRuntime.js
// Mantiene compatibilidad total con el sistema actual (window.STATE, window.save, etc.)

import * as oasis from "./oasisApi.js";

const STORAGE_KEY = "espoch_state_v1";

// Estado global (se mantiene en window para compatibilidad con legacyRuntime.js)
let _state = {};

// Timer para debounce de push a BD
let _dbPushTimer = null;
let _dbReady = false;

// ========== CONSTANTES DEL SISTEMA (extraídas de legacyRuntime.js) ==========

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

// ========== ESTADO ==========

export function getState() {
  return _state;
}

export function setState(newState) {
  _state = newState;
  if (typeof window !== "undefined") {
    window.STATE = _state;
  }
}

export function getDbReady() {
  return _dbReady;
}

export function setDbReady(v) {
  _dbReady = v;
}

// ========== PERSISTENCIA LOCAL ==========

export function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
  } catch {
    /* almacenamiento no disponible */
  }
  pushToDb();
}

export function load() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    _state = stored ? JSON.parse(stored) : JSON.parse(JSON.stringify(DEFAULT_STATE));
    // Normalizar estado
    if (!Array.isArray(_state.savedConfigs)) _state.savedConfigs = [];
    if (typeof _state.configLocked !== "boolean") _state.configLocked = false;
    if (!_state.activeConfigId) _state.activeConfigId = "";
    if (typeof _state.editingConfigId === "undefined") _state.editingConfigId = "";
    if (!_state.studentsByConfig) _state.studentsByConfig = {};
    if (!_state.gradesByConfig) _state.gradesByConfig = {};
    if (!Array.isArray(_state.teacherAssignments)) _state.teacherAssignments = [];
    if (!Array.isArray(_state.docentes)) _state.docentes = [];
    if (!Array.isArray(_state.students)) _state.students = [];
    if (!Array.isArray(_state.grades)) _state.grades = [];
    if (!Array.isArray(_state.recentActivity)) _state.recentActivity = [];
    if (!_state.currentUser) _state.currentUser = null;
  } catch {
    _state = JSON.parse(JSON.stringify(DEFAULT_STATE));
  }
  // Sincronizar con window para compatibilidad
  if (typeof window !== "undefined") {
    window.STATE = _state;
  }
  return _state;
}

// ========== SINCRONIZACIÓN CON BD ==========

export function pushToDb() {
  if (!_state.currentUser) return;
  clearTimeout(_dbPushTimer);
  _dbPushTimer = setTimeout(doPushToDb, 800);
}

async function doPushToDb() {
  const u = _state.currentUser;
  if (!u || !_dbReady) return;

  // Llamar persistActiveConfigData (definida en legacyRuntime) si existe
  if (typeof window.persistActiveConfigData === "function") {
    window.persistActiveConfigData();
  }

  const misConfigs = (_state.savedConfigs || []).filter(
    (c) => (c.ownerEmail || "") === u.email
  );
  const ids = {};
  misConfigs.forEach((c) => {
    ids[c.id] = true;
  });
  if (_state.activeConfigId) ids[_state.activeConfigId] = true;

  const students = {};
  const grades = {};
  Object.keys(ids).forEach((id) => {
    if (_state.studentsByConfig[id]) students[id] = _state.studentsByConfig[id];
    if (_state.gradesByConfig[id]) grades[id] = _state.gradesByConfig[id];
  });

  const payload = {
    email: u.email,
    role: u.role,
    savedConfigs: misConfigs,
    studentsByConfig: students,
    gradesByConfig: grades,
  };
  if (u.role === "coordinador") {
    payload.docentes = _state.docentes;
    payload.teacherAssignments = _state.teacherAssignments;
  }

  try {
    await oasis.putStore(payload);
  } catch {
    /* sin BD: queda el respaldo en localStorage */
  }
}

export async function hydrateFromDb() {
  const u = _state.currentUser;
  if (!u) return;

  let store;
  try {
    store = await oasis.getStore({ email: u.email, role: u.role });
  } catch {
    return;
  }
  if (!store) return;
  if (store.disabled) {
    _dbReady = true;
    return;
  }

  // REEMPLAZAR estado local con datos de Supabase (fuente de verdad)
  // Docentes: preservar contraseñas locales
  if (Array.isArray(store.docentes)) {
    const localPasswords = {};
    (_state.docentes || []).forEach((d) => {
      if (d.password) localPasswords[d.email] = d.password;
    });
    _state.docentes = store.docentes.map((d) => ({
      email: d.email,
      nombre: d.nombre,
      name: d.nombre,
      cedula: d.cedula || "",
      role: d.rol || "docente",
      rol: d.rol || "docente",
      password: localPasswords[d.email] || "",
    }));
  }

  if (Array.isArray(store.teacherAssignments))
    _state.teacherAssignments = store.teacherAssignments;

  // Reemplazar configuraciones, estudiantes y notas (no merge)
  _state.savedConfigs = Array.isArray(store.savedConfigs) ? store.savedConfigs : _state.savedConfigs;
  _state.studentsByConfig = store.studentsByConfig || {};
  _state.gradesByConfig = store.gradesByConfig || {};

  // Si no hay activeConfigId pero hay configuraciones, activar la primera
  if (!_state.activeConfigId && Array.isArray(_state.savedConfigs) && _state.savedConfigs.length > 0) {
    _state.activeConfigId = _state.savedConfigs[0].id;
  }

  if (_state.activeConfigId && typeof window.cargarPaoActivo === "function") {
    window.cargarPaoActivo();
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
  } catch {
    /* noop */
  }

  if (typeof window.rerenderActive === "function") {
    window.rerenderActive();
  }
  _dbReady = true;
}

// ========== INICIALIZACIÓN ==========

export function initState() {
  load();
  // Sincronizar referencias globales
  if (typeof window !== "undefined") {
    window.STATE = _state;
    window.save = save;
    window.pushToDb = pushToDb;
    window.hydrateFromDb = hydrateFromDb;
    window.getState = getState;
  }
}
