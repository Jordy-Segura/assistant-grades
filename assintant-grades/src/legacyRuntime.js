import * as oasis from "./services/oasisApi.js";
import { normalizeEmail, normalizeDocId, clonePlain } from "./runtime/lib/format.js";
import { COMPONENT_WEIGHTS, COORDINADOR, ROLE_LABEL } from "./runtime/constants.js";
import { registerConsultas } from "./runtime/features/consultas.js";
import { registerDashboard } from "./runtime/features/dashboard.js";
import { registerAuth } from "./runtime/features/auth.js";
import { registerConfig } from "./runtime/features/config.js";
import { registerCoordinacion } from "./runtime/features/coordinacion.js";
import { registerGradesScreens } from "./runtime/features/gradesScreens.js";

// Acceso al correo institucional (Microsoft 365 del dominio espoch.edu.ec).
const WEBMAIL_URL = "https://login.microsoftonline.com/?whr=espoch.edu.ec";

export function initLegacyRuntime() {
  if (window.__espochLegacyInit) return;
  window.__espochLegacyInit = true;

  var DB_ESPOCH = {};
  var EVAL_PROCEDURES = { ACD: [], APEX: [], AAUT: [] };
  var catalogReady = false;
  var catalogLoadPromise = null;
  var catalogSaveTimer = null;

  function normalizeCatalogKey(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase();
  }

  function findCatalogCareerName(carrera) {
    var exact = String(carrera || '').trim();
    if (exact && DB_ESPOCH[exact]) return exact;
    var key = normalizeCatalogKey(exact);
    return Object.keys(DB_ESPOCH).find(function (name) { return normalizeCatalogKey(name) === key; }) || '';
  }

  function getCatalogCareer(carrera) {
    var name = findCatalogCareerName(carrera);
    return name ? DB_ESPOCH[name] : null;
  }

  function ensureCatalogCareer(carrera) {
    var name = String(carrera || '').trim();
    if (!name) return null;
    var existingName = findCatalogCareerName(name);
    if (existingName) name = existingName;
    if (!DB_ESPOCH[name]) DB_ESPOCH[name] = { maxPao: 0, racs: [], malla: {}, asignaturas: {} };
    if (!DB_ESPOCH[name].malla) DB_ESPOCH[name].malla = {};
    if (!DB_ESPOCH[name].asignaturas) DB_ESPOCH[name].asignaturas = {};
    if (!Array.isArray(DB_ESPOCH[name].racs)) DB_ESPOCH[name].racs = [];
    return DB_ESPOCH[name];
  }

  function mergeAssignmentsIntoCatalog() {
    (STATE.teacherAssignments || []).forEach(function (a) {
      if (!a || !a.carrera || !a.asignatura) return;
      var career = ensureCatalogCareer(a.carrera);
      if (!career) return;
      var pao = String(a.pao || a.codNivel || '').trim();
      if (pao) {
        if (!career.malla[pao]) career.malla[pao] = [];
        if (career.malla[pao].indexOf(a.asignatura) === -1) career.malla[pao].push(a.asignatura);
        var paoNum = Number(pao);
        if (!isNaN(paoNum)) career.maxPao = Math.max(career.maxPao || 0, paoNum);
      }
      if (!career.asignaturas[a.asignatura]) {
        career.asignaturas[a.asignatura] = { raau: Array.isArray(a.raau) ? clonePlain(a.raau, []) : [] };
      }
    });
  }

  function applyVectorCatalog(catalog) {
    if (!catalog || catalog.disabled) return false;
    DB_ESPOCH = catalog.carreras && typeof catalog.carreras === 'object' ? catalog.carreras : {};
    EVAL_PROCEDURES = Object.assign({ ACD: [], APEX: [], AAUT: [] }, catalog.procedures || {});
    mergeAssignmentsIntoCatalog();
    if (STATE.courseConfig && STATE.courseConfig.carrera && getCatalogCareer(STATE.courseConfig.carrera)) {
      CAREER_RACS = getCatalogCareer(STATE.courseConfig.carrera).racs || [];
    }
    catalogReady = true;
    return true;
  }

  async function loadVectorCatalog() {
    if (catalogReady) return true;
    if (catalogLoadPromise) return catalogLoadPromise;
    catalogLoadPromise = oasis.getVectorCatalog().then(function (catalog) {
      return applyVectorCatalog(catalog);
    }).catch(function () {
      return false;
    }).finally(function () {
      catalogLoadPromise = null;
    });
    return catalogLoadPromise;
  }

  function saveVectorCatalogSoon() {
    clearTimeout(catalogSaveTimer);
    catalogSaveTimer = setTimeout(function () {
      oasis.putVectorCatalog({ carreras: DB_ESPOCH, procedures: EVAL_PROCEDURES }).catch(function () {
        showToast('No se pudo sincronizar el catalogo RAC/RAAU con Neon.', 'error');
      });
    }, 700);
  }

  function getExcludedDocentes() { return Array.isArray(STATE.excludedDocentes) ? STATE.excludedDocentes : []; }
  function docenteMatchesExclusion(email, cedula, ex) {
    if (!ex) return false;
    var e = normalizeEmail(email);
    var c = normalizeDocId(cedula);
    var exEmail = normalizeEmail(ex.email);
    var exCedula = normalizeDocId(ex.cedula);
    if (e && exEmail && e === exEmail) return true;
    return !!(c && exCedula && c === exCedula);
  }
  function isDocenteExcluded(email, cedula) {
    if (normalizeEmail(email) === normalizeEmail(COORDINADOR.email)) return false;
    return getExcludedDocentes().some(function (ex) { return docenteMatchesExclusion(email, cedula, ex); });
  }
  function exclusionIdFor(email, cedula) {
    return ('omit_' + (normalizeEmail(email) || normalizeDocId(cedula) || Date.now())).replace(/[^a-zA-Z0-9_.:@-]/g, '_');
  }
  function getDocentes() {
    return (STATE.docentes || []).filter(function (d) { return !isDocenteExcluded(d.email, d.cedula); });
  }
  function allUsers() { return [COORDINADOR].concat(getDocentes()); }
  function findUserByEmail(email) {
    var lower = String(email || '').toLowerCase();
    return allUsers().find(function (u) { return u.email.toLowerCase() === lower; }) || null;
  }
  // Asignaturas del usuario actual. TODOS (incluido el coordinador, que también
  // es docente) configuran únicamente sus propias asignaturas asignadas.
  function myAssignments() {
    var email = STATE.currentUser && STATE.currentUser.email;
    return (STATE.teacherAssignments || []).filter(function (a) { return a.docenteEmail === email; });
  }

  var DEFAULT_STATE = {
    courseConfig: { periodoAcademico: '', facultad: 'SEDE ORELLANA', carrera: '', asignatura: '', docente: '', pao: '', aporte: 'FIN DE CICLO' },
    selectedRACIds: [], raauEntries: [], activities: [],
    configLocked: false, activeConfigId: '', editingConfigId: '',
    savedConfigs: [],
    studentsByConfig: {},
    gradesByConfig: {},
    teacherAssignments: [],
    docentes: [],
    excludedDocentes: [],
    students: [],
    grades: [],
    recentActivity: [],
    currentUser: null
  };

  var STATE = {};
  var CAREER_RACS = [];
  // Contexto compartido del runtime: estado reasignable expuesto vía
  // getters/setters (siempre la versión vigente, incluso tras reasignar en
  // load()) + un registro de funciones (rt.fns) para que los módulos de cada
  // pantalla llamen al núcleo. Ver src/runtime/features/*.
  var rt = {
    get STATE() { return STATE; }, set STATE(v) { STATE = v; },
    get DB_ESPOCH() { return DB_ESPOCH; }, set DB_ESPOCH(v) { DB_ESPOCH = v; },
    get EVAL_PROCEDURES() { return EVAL_PROCEDURES; }, set EVAL_PROCEDURES(v) { EVAL_PROCEDURES = v; },
    get CAREER_RACS() { return CAREER_RACS; }, set CAREER_RACS(v) { CAREER_RACS = v; },
    fns: {}
  };
  var STORAGE_KEY = 'espoch_state_v1';
  var dbPushTimer = null;
  // No se empuja a la BD hasta haber HIDRATADO primero. Evita que un guardado
  // temprano (con el estado aún vacío) sobrescriba/borre datos en la BD.
  var dbReady = false;
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE)); } catch { /* almacenamiento no disponible */ }
    pushToDb();
  }

  function getRacsCatalogForConfig(config) {
    var c = (config && config.courseConfig) || STATE.courseConfig || {};
    var carreraData = getCatalogCareer(c.carrera);
    var racs = (carreraData && carreraData.racs) || CAREER_RACS || [];
    return clonePlain(racs, []);
  }

  function getRaauCatalogForConfig(config) {
    var c = (config && config.courseConfig) || STATE.courseConfig || {};
    var carreraData = getCatalogCareer(c.carrera);
    var asignaturaData = carreraData && carreraData.asignaturas && carreraData.asignaturas[c.asignatura];
    return clonePlain((asignaturaData && asignaturaData.raau) || [], []);
  }

  function enrichConfigVectors(config) {
    if (!config) return config;
    config.racsCatalog = getRacsCatalogForConfig(config);
    config.raauCatalog = getRaauCatalogForConfig(config);
    return config;
  }

  // Empuja (con "debounce") los datos propios del usuario a PostgreSQL vía BFF.
  function pushToDb() {
    if (!STATE.currentUser) return;
    clearTimeout(dbPushTimer);
    dbPushTimer = setTimeout(doPushToDb, 800);
  }
  async function doPushToDb() {
    var u = STATE.currentUser;
    if (!u || !dbReady) return; // aún no hidratado: no escribir (evita borrar datos)
    // Mantén sincronizado el config activo antes de enviar.
    persistActiveConfigData();
    var misConfigs = (STATE.savedConfigs || []).filter(function (c) {
      return u.role === 'coordinador' || u.role === 'admin' || (c.ownerEmail || '') === u.email;
    });
    misConfigs.forEach(enrichConfigVectors);
    var ids = {};
    misConfigs.forEach(function (c) { ids[c.id] = true; });
    if (STATE.activeConfigId) ids[STATE.activeConfigId] = true;
    var students = {}, grades = {};
    Object.keys(ids).forEach(function (id) {
      if (STATE.studentsByConfig[id]) students[id] = STATE.studentsByConfig[id];
      if (STATE.gradesByConfig[id]) grades[id] = STATE.gradesByConfig[id];
    });
    var payload = {
      email: u.email,
      role: u.role,
      savedConfigs: misConfigs,
      studentsByConfig: students,
      gradesByConfig: grades
    };
    if (u.role === 'coordinador') {
      payload.docentes = (STATE.docentes || []).filter(function (d) { return !isDocenteExcluded(d.email, d.cedula); });
      payload.teacherAssignments = (STATE.teacherAssignments || []).filter(function (a) { return !isDocenteExcluded(a.docenteEmail, a.cedula); });
      payload.excludedDocentes = STATE.excludedDocentes || [];
    }
    try { await oasis.putStore(payload); } catch { /* sin BD: queda el respaldo en localStorage */ }
  }

  // Trae los datos persistidos y los fusiona en el estado local.
  async function hydrateFromDb() {
    var u = STATE.currentUser;
    if (!u) return;
    var store;
    try { store = await oasis.getStore({ email: u.email, role: u.role }); } catch { return; }
    if (store && Array.isArray(store.excludedDocentes)) {
      STATE.excludedDocentes = store.excludedDocentes.map(function (d) {
        return {
          id: d.id || d.email || d.cedula || ('omit_' + Date.now()),
          email: normalizeEmail(d.email),
          cedula: normalizeDocId(d.cedula),
          name: d.name || d.nombre || d.nombres || '',
          nombre: d.nombre || d.name || d.nombres || '',
          motivo: d.motivo || ''
        };
      });
    }
    if (!store) return;
    if (store.disabled) { dbReady = true; return; } // sin BD: los push harán no-op igualmente
    // Docentes (global). Conservamos contraseñas locales de esta sesión si existen.
    if (Array.isArray(store.docentes)) {
      var byEmail = {};
      (STATE.docentes || []).forEach(function (d) { byEmail[d.email] = d; });
      STATE.docentes = store.docentes.map(function (d) {
        var local = byEmail[d.email];
        return {
          email: d.email, nombre: d.nombre, name: d.nombre, cedula: d.cedula || '',
          role: d.rol || 'docente', rol: d.rol || 'docente',
          password: (local && local.password) || '',
          // El backend indica si ya tiene password_hash (la clave en claro no se envía).
          hasPassword: Boolean(d.has_password) || Boolean(local && local.password)
        };
      });
    }
    if (Array.isArray(store.teacherAssignments)) {
      STATE.teacherAssignments = store.teacherAssignments;
      mergeAssignmentsIntoCatalog();
    }
    if (Array.isArray(store.savedConfigs)) {
      // Fusiona configs de la BD con las locales: las de la BD son autoritativas,
      // pero conservamos las locales que aún no están en la BD (nunca se borran).
      var dbById = {};
      store.savedConfigs.forEach(function (c) { dbById[c.id] = c; });
      var merged = store.savedConfigs.slice();
      (STATE.savedConfigs || []).forEach(function (c) {
        if (!dbById[c.id]) merged.push(c); // local no está en BD → se conserva
      });
      STATE.savedConfigs = merged;
    }
    if (store.studentsByConfig) STATE.studentsByConfig = Object.assign({}, STATE.studentsByConfig, store.studentsByConfig);
    if (store.gradesByConfig) STATE.gradesByConfig = Object.assign({}, STATE.gradesByConfig, store.gradesByConfig);
  if (STATE.activeConfigId) {
    cargarPaoActivo();
  }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE)); } catch { /* noop */ }
    rerenderActive();
    dbReady = true;
  }

  function rerenderActive() {
    updateSidebar();
    var active = document.querySelector('.page.active');
    if (!active) return;
    var id = active.id.replace('page-', '');
    if (id.indexOf('coord-') === 0 || id === 'coordinacion') renderPage(id === 'coordinacion' ? 'coordinacion' : id);
    else renderPage(id);
  }
  function load() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      STATE = stored ? JSON.parse(stored) : JSON.parse(JSON.stringify(DEFAULT_STATE));
      if (!Array.isArray(STATE.savedConfigs)) STATE.savedConfigs = [];
      if (typeof STATE.configLocked !== 'boolean') STATE.configLocked = false;
      if (!STATE.activeConfigId) STATE.activeConfigId = '';
      if (typeof STATE.editingConfigId === 'undefined') STATE.editingConfigId = '';
      if (!STATE.studentsByConfig) STATE.studentsByConfig = {};
      if (!STATE.gradesByConfig) STATE.gradesByConfig = {};
      if (!Array.isArray(STATE.teacherAssignments)) STATE.teacherAssignments = [];
      if (!Array.isArray(STATE.docentes)) STATE.docentes = [];
      if (!Array.isArray(STATE.excludedDocentes)) STATE.excludedDocentes = [];
      if (!Array.isArray(STATE.students)) STATE.students = [];
      if (!Array.isArray(STATE.grades)) STATE.grades = [];
      if (!Array.isArray(STATE.recentActivity)) STATE.recentActivity = [];
      if (!STATE.currentUser) STATE.currentUser = null;
      if (STATE.courseConfig && STATE.courseConfig.carrera && getCatalogCareer(STATE.courseConfig.carrera)) CAREER_RACS = getCatalogCareer(STATE.courseConfig.carrera).racs || [];
    } catch { STATE = JSON.parse(JSON.stringify(DEFAULT_STATE)); }
  }
  load();
  loadVectorCatalog();

  function getActiveConfigKey() {
    return STATE.activeConfigId || '';
  }

  function loadActiveConfigData() {
    var key = getActiveConfigKey();
    if (!key) return;
    if (!STATE.studentsByConfig[key]) STATE.studentsByConfig[key] = [];
    if (!STATE.gradesByConfig[key]) STATE.gradesByConfig[key] = [];
    STATE.students = JSON.parse(JSON.stringify(STATE.studentsByConfig[key]));
    STATE.grades = JSON.parse(JSON.stringify(STATE.gradesByConfig[key]));
  }

  function persistActiveConfigData() {
    var key = getActiveConfigKey();
    if (!key) return;
    STATE.studentsByConfig[key] = JSON.parse(JSON.stringify(STATE.students));
    STATE.gradesByConfig[key] = JSON.parse(JSON.stringify(STATE.grades));
  }
  // Solo cargar datos si hay un PAO activo previamente seleccionado (persistido en localStorage)
  if (STATE.activeConfigId) loadActiveConfigData();

  // ================================================================
  // SISTEMA DE PAO ACTIVO — fuente única de verdad
  // ================================================================

  function getPaoActivo() {
    if (!STATE.activeConfigId) return null;
    var found = STATE.savedConfigs.find(function (c) { return c.id === STATE.activeConfigId; });
    return found || null;
  }

  function setPaoActivo(configId) {
    if (STATE.currentUser && STATE.currentUser.role === 'docente') {
      var found = STATE.savedConfigs.find(function (c) { return c.id === configId; });
      if (found && (found.ownerEmail || '') !== STATE.currentUser.email) {
        showToast('No puede abrir configuraciones de otros docentes.', 'error');
        return false;
      }
    }
    STATE.activeConfigId = configId;
    save();
    return cargarPaoActivo();
  }

  function cargarPaoActivo() {
    if (!STATE.activeConfigId) return false;
    var found = STATE.savedConfigs.find(function (c) { return c.id === STATE.activeConfigId; });
    if (!found) {
      STATE.activeConfigId = '';
      save();
      return false;
    }
    STATE.courseConfig = JSON.parse(JSON.stringify(found.courseConfig));
    STATE.selectedRACIds = found.selectedRACIds.slice();
    STATE.raauEntries = JSON.parse(JSON.stringify(found.raauEntries));
    STATE.activities = JSON.parse(JSON.stringify(found.activities));
    STATE.configLocked = true;
    if (STATE.courseConfig.carrera && getCatalogCareer(STATE.courseConfig.carrera)) {
      CAREER_RACS = getCatalogCareer(STATE.courseConfig.carrera).racs || [];
    }
    loadActiveConfigData();
    save();
    return true;
  }

  function sincronizarPaoActivoConUI() {
    updateSidebar();
    renderPaoSidebarList();
    rt.fns.renderSavedConfigs();
    var active = document.querySelector('.page.active');
    if (active) {
      var id = active.id.replace('page-', '');
      if (id.indexOf('coord-') === 0 || id === 'coordinacion') id = id === 'coordinacion' ? 'coordinacion' : id;
      renderPage(id);
    }
  }

  function cargarDatosDelPao(configId) {
    if (!setPaoActivo(configId)) return false;
    sincronizarPaoActivoConUI();
    showToast('PAO seleccionado correctamente.', 'success');
    return true;
  }

  function showToast(msg, type) {
    var toastEl = document.getElementById('toast');
    var text = document.getElementById('toast-text');
    if (!toastEl || !text) return;
    text.textContent = msg;
    toastEl.style.background = type === 'error' ? 'var(--espoch-red)' : 'var(--espoch-green)';
    toastEl.classList.add('show');
    setTimeout(function () { toastEl.classList.remove('show'); }, 2800);
  }

  function closeModal(e) {
    if (e && e.target !== document.getElementById('modal-overlay')) return;
    var overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.classList.remove('open');
  }

  function showSuccessModal() {
    launchConfetti();
    var totalActs = STATE.activities.length;
    var asig = STATE.courseConfig.asignatura || 'la asignatura';
    var el = document.getElementById('success-modal-content');
    if (!el) return;
    el.innerHTML =
      '<div class="success-checkmark"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
      '<div class="success-title">¡Configuración Guardada!</div>' +
      '<div class="success-text">Se han registrado <strong>' + totalActs + ' actividades</strong> de evaluación para <strong>' + asig + '</strong>.<br><br>Los componentes ACD (' + COMPONENT_WEIGHTS.ACD + ' pts), APEX (' + COMPONENT_WEIGHTS.APEX + ' pts) y AAUT (' + COMPONENT_WEIGHTS.AAUT + ' pts) están configurados correctamente.</div>' +
      '<div style="margin-top:20px"><button class="btn btn-success" onclick="onConfigConfirmContinue()" style="margin:0 auto">Confirmar y Gestionar</button></div>';
    document.getElementById('success-modal-overlay').classList.add('open');
  }

  function closeSuccessModal(e) {
    if (e && e.target !== document.getElementById('success-modal-overlay')) return;
    var overlay = document.getElementById('success-modal-overlay');
    if (overlay) overlay.classList.remove('open');
  }

  function launchConfetti() {
    var canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    canvas.style.display = 'block';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    var particles = [];
    var colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#7c3aed', '#003366'];
    for (var i = 0; i < 150; i++) {
      particles.push({
        x: canvas.width / 2, y: canvas.height / 2,
        vx: (Math.random() - 0.5) * 16, vy: (Math.random() - 0.5) * 16 - 5,
        w: Math.random() * 8 + 3, h: Math.random() * 6 + 2,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360, rotSpeed: (Math.random() - 0.5) * 10,
        gravity: 0.15, opacity: 1
      });
    }
    var frame = 0;
    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var alive = false;
      particles.forEach(function (p) {
        p.x += p.vx; p.vy += p.gravity; p.y += p.vy;
        p.rotation += p.rotSpeed; p.vx *= 0.99;
        if (frame > 60) p.opacity -= 0.01;
        if (p.opacity <= 0) return;
        alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation * Math.PI / 180);
        ctx.globalAlpha = Math.max(0, p.opacity);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      frame++;
      if (alive && frame < 200) requestAnimationFrame(animate);
      else canvas.style.display = 'none';
    }
    animate();
  }

  function openModal(title, bodyHtml, actions) {
    var modalEl = document.querySelector('#modal-overlay .modal');
    if (modalEl) modalEl.style.maxWidth = ''; // ancho por defecto (lo amplía quien lo necesite)
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-actions').innerHTML = actions.map(function (a, i) {
      return '<button class="btn ' + a.cls + '" onclick="_modalAction(' + i + ')">' + a.label + '</button>';
    }).join('');
    window._modalActions = actions;
    document.getElementById('modal-overlay').classList.add('open');
  }

  window._modalAction = function (i) {
    var a = window._modalActions[i];
    if (typeof a.action === 'function') a.action();
    else if (a.action === 'close') closeModal();
  };

  function updateSidebar() {
    var set = function (id, val) { var el = document.getElementById(id); if (el) el.textContent = val; };
    if (!STATE.activeConfigId) {
      set('sb-asignatura', 'Seleccione un PAO');
      set('sb-pao', 'PAO —');
      set('sb-aporte', '—');
      set('sb-docente', (STATE.currentUser && STATE.currentUser.name) || '—');
      var inactiveRoleEl = document.getElementById('sb-role');
      if (inactiveRoleEl) {
        var inactiveRoleTxt = ROLE_LABEL[(STATE.currentUser && STATE.currentUser.role) || ''] || 'Invitado';
        inactiveRoleEl.textContent = inactiveRoleTxt;
      }
      renderPaoSidebarList();
      return;
    }
    var c = STATE.courseConfig;
    set('sb-asignatura', c.asignatura || '—');
    set('sb-pao', 'PAO ' + (c.pao || '—'));
    set('sb-aporte', c.aporte || '—');
    set('sb-docente', c.docente || ((STATE.currentUser && STATE.currentUser.name) || '—'));
    var roleEl = document.getElementById('sb-role');
    if (roleEl) {
      var roleTxt = ROLE_LABEL[(STATE.currentUser && STATE.currentUser.role) || ''] || 'Invitado';
      var email = STATE.currentUser && STATE.currentUser.email;
      if (email) {
        roleEl.innerHTML = roleTxt + ' · <a href="' + WEBMAIL_URL + '" target="_blank" rel="noopener" ' +
          'title="' + email + '" style="color:rgba(255,255,255,.6);text-decoration:underline">WebMail</a>';
      } else {
        roleEl.textContent = roleTxt;
      }
    }
    renderPaoSidebarList();
  }

  var _paoDropdownOpen = false;

  function renderPaoSidebarList() {
    var container = document.getElementById('sidebar-pao-list');
    if (!container) return;
    var email = STATE.currentUser && STATE.currentUser.email;
    if (!email) {
      container.innerHTML = '';
      return;
    }
    var configs = (STATE.savedConfigs || []).filter(function (c) {
      return (c.ownerEmail || '') === email;
    });
    if (configs.length === 0) {
      container.innerHTML = '<div class="pao-sidebar-empty">No existen PAOs configurados.<br>Cree uno desde Configuración.</div>';
      return;
    }
    var sorted = configs.slice().sort(function (a, b) {
      return (b.savedAt || '').localeCompare(a.savedAt || '');
    });
    var activeId = STATE.activeConfigId;
    var activeCfg = activeId ? sorted.find(function (c) { return c.id === activeId; }) : null;
    var selectText = activeCfg
      ? 'PAO ' + (activeCfg.courseConfig.pao || '—') + ' — ' + (activeCfg.courseConfig.asignatura || 'Sin asignatura')
      : 'Seleccionar PAO';

    var html = '<div class="pao-dropdown' + (activeCfg ? ' has-active' : '') + '">';
    html += '<div class="pao-dropdown-toggle" onclick="togglePaoDropdown(event)">';
    html += '<span class="pao-dropdown-text">' + selectText + '</span>';
    html += '<svg class="pao-dropdown-arrow" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';
    html += '</div>';
    html += '<div class="pao-dropdown-menu' + (_paoDropdownOpen ? ' open' : '') + '" id="pao-dropdown-menu">';
    html += sorted.map(function (cfg) {
      var isActive = cfg.id === activeId;
      var pao = cfg.courseConfig.pao || '—';
      var asig = cfg.courseConfig.asignatura || 'Sin asignatura';
      var aporte = cfg.courseConfig.aporte || '—';
      return '<div class="pao-dropdown-item' + (isActive ? ' active' : '') + '" onclick="selectPaoFromDropdown(\'' + cfg.id + '\', event)">' +
        (isActive ? '<svg class="pao-dropdown-check" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--espoch-red)" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : '') +
        '<div class="pao-dropdown-item-content"><span class="pao-dropdown-item-pao">PAO ' + pao + '</span><span class="pao-dropdown-item-asig">' + asig + '</span></div>' +
        '<span class="pao-dropdown-item-aporte">' + aporte + '</span>' +
        '</div>';
    }).join('');
    html += '</div></div>';
    container.innerHTML = html;
  }

  function togglePaoDropdown(event) {
    if (event) event.stopPropagation();
    _paoDropdownOpen = !_paoDropdownOpen;
    var menu = document.getElementById('pao-dropdown-menu');
    if (menu) menu.classList.toggle('open', _paoDropdownOpen);
    var toggle = document.querySelector('.pao-dropdown-toggle');
    if (toggle) toggle.classList.toggle('open', _paoDropdownOpen);
  }

  function closePaoDropdown() {
    _paoDropdownOpen = false;
    var menu = document.getElementById('pao-dropdown-menu');
    if (menu) menu.classList.remove('open');
    var toggle = document.querySelector('.pao-dropdown-toggle');
    if (toggle) toggle.classList.remove('open');
  }

  function selectPaoFromDropdown(configId, event) {
    if (typeof window.__closeSidebar === 'function') window.__closeSidebar();
    if (event) event.stopPropagation();
    closePaoDropdown();
    if (configId === STATE.activeConfigId) return;
    if (STATE.currentUser && STATE.currentUser.role === 'docente') {
      var found = STATE.savedConfigs.find(function (c) { return c.id === configId; });
      if (found && (found.ownerEmail || '') !== STATE.currentUser.email) {
        showToast('No puede abrir configuraciones de otros docentes.', 'error');
        return;
      }
    }
    if (!setPaoActivo(configId)) return;
    sincronizarPaoActivoConUI();
    showToast('PAO seleccionado correctamente.', 'success');
    rt.fns.syncStudentsFromOasis(configId).then(function () { rt.fns.renderEstudiantes(); }).catch(function () {});
  }

  function navigateToNewConfig() {
    rt.fns.unlockNewConfig();
    navigate('configuracion');
  }

  function cfgStartNew() {
    rt.fns.unlockNewConfig();
    navigate('configuracion');
  }

  function roleCanAccess(page) {
    var role = STATE.currentUser && STATE.currentUser.role;
    if (!role) return false;
    if (page.indexOf('coord-') === 0) return role === 'coordinador' || role === 'admin';
    if (page.indexOf('consulta-') === 0) return true;
    if (role === 'docente') return page !== 'coordinacion';
    return true;
  }

  function applyRoleUI() {
    var role = STATE.currentUser && STATE.currentUser.role;
    var appShell = document.getElementById('app-shell');
    var auth = document.getElementById('auth-screen');
    if (!role) {
      if (auth) auth.style.display = 'flex';
      if (appShell) appShell.style.display = 'none';
      return;
    }
    if (auth) auth.style.display = 'none';
    if (appShell) appShell.style.display = 'flex';
    var navCoord = document.getElementById('nav-coordinacion');
    if (navCoord) navCoord.style.display = role === 'docente' ? 'none' : '';
    var coordItems = ['nav-coord-asig', 'nav-coord-rac', 'nav-coord-raau', 'nav-coord-docentes'];
    coordItems.forEach(function (id) {
      var item = document.getElementById(id);
      if (item) item.style.display = role === 'docente' ? 'none' : '';
    });
    var consultaItems = ['nav-consulta-divider', 'nav-consulta-section',
      'nav-consulta-sede', 'nav-consulta-info', 'nav-consulta-est'];
    consultaItems.forEach(function (id) {
      var item = document.getElementById(id);
      if (item) item.style.display = '';
    });
  }

  function getGrade(sid, aid) {
    var g = STATE.grades.find(function (x) { return x.studentId === sid && x.activityId === aid; });
    return g ? g.score : null;
  }
  function setGrade(sid, aid, score) {
    var idx = STATE.grades.findIndex(function (x) { return x.studentId === sid && x.activityId === aid; });
    if (idx >= 0) STATE.grades[idx].score = score;
    else STATE.grades.push({ studentId: sid, activityId: aid, score: score });
    persistActiveConfigData();
  }
  function studentTotal(sid) {
    return STATE.activities.reduce(function (sum, act) {
      var g = getGrade(sid, act.id);
      return sum + (g != null ? g : 0);
    }, 0);
  }
  function addRecentActivity(text, type) {
    var now = new Date();
    var timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    STATE.recentActivity.unshift({ text: text, type: type, time: timeStr, date: now.toLocaleDateString(), email: STATE.currentUser && STATE.currentUser.email });
    if (STATE.recentActivity.length > 20) STATE.recentActivity.pop();
  }

  // ---- Registro de módulos de pantalla extraídos (src/runtime/features/*) ----
  rt.fns.getCatalogCareer = getCatalogCareer;
  rt.fns.showToast = showToast;
  rt.fns.studentTotal = studentTotal;
  rt.fns.save = save;
  rt.fns.applyRoleUI = applyRoleUI;
  rt.fns.updateSidebar = updateSidebar;
  rt.fns.loadVectorCatalog = loadVectorCatalog;
  rt.fns.navigate = navigate;
  rt.fns.hydrateFromDb = hydrateFromDb;
  rt.fns.loadActiveConfigData = loadActiveConfigData;
  rt.fns.findUserByEmail = findUserByEmail;
  rt.fns.isDocenteExcluded = isDocenteExcluded;
  rt.fns.myAssignments = myAssignments;
  rt.fns.openModal = openModal;
  rt.fns.closeModal = closeModal;
  rt.fns.addRecentActivity = addRecentActivity;
  rt.fns.cargarPaoActivo = cargarPaoActivo;
  rt.fns.closeSuccessModal = closeSuccessModal;
  rt.fns.enrichConfigVectors = enrichConfigVectors;
  rt.fns.renderPage = renderPage;
  rt.fns.renderPaoSidebarList = renderPaoSidebarList;
  rt.fns.setPaoActivo = setPaoActivo;
  rt.fns.sincronizarPaoActivoConUI = sincronizarPaoActivoConUI;
  rt.fns.getGrade = getGrade;
  rt.fns.setGrade = setGrade;
  rt.fns.persistActiveConfigData = persistActiveConfigData;
  rt.fns.docenteMatchesExclusion = docenteMatchesExclusion;
  rt.fns.exclusionIdFor = exclusionIdFor;
  rt.fns.getDocentes = getDocentes;
  rt.fns.getExcludedDocentes = getExcludedDocentes;
  rt.fns.saveVectorCatalogSoon = saveVectorCatalogSoon;
  registerConsultas(rt);
  registerDashboard(rt);
  registerAuth(rt);
  registerConfig(rt);
  registerCoordinacion(rt);
  registerGradesScreens(rt);
  window.csedeLoadSubjects = rt.fns.csedeLoadSubjects;
  window.csedeTogglePao = rt.fns.csedeTogglePao;
  window.csedeToggleMat = rt.fns.csedeToggleMat;
  window.csedeLoadDictados = rt.fns.csedeLoadDictados;
  window.csedeRefresh = rt.fns.csedeRefresh;
  window.cestValidateCedula = rt.fns.cestValidateCedula;
  window.cestSearch = rt.fns.cestSearch;
  window.cinfoLoadCarreras = rt.fns.cinfoLoadCarreras;
  window.cinfoFiltrar = rt.fns.cinfoFiltrar;

  function renderPage(page) {
    if (page === 'dashboard') rt.fns.renderDashboard();
    else if (page === 'configuracion') rt.fns.renderConfig();
    else if (page === 'estudiantes') rt.fns.renderEstudiantes();
    else if (page === 'calificaciones') rt.fns.renderCalificaciones();
    else if (page === 'reporte') rt.fns.renderReporte();
    else if (page === 'coordinacion') rt.fns.renderCoordinacion();
    else if (page === 'coord-asignaturas') rt.fns.renderCoordinacion('asignaturas');
    else if (page === 'coord-rac') rt.fns.renderCoordinacion('rac');
    else if (page === 'coord-raau') rt.fns.renderCoordinacion('raau');
    else if (page === 'coord-docentes') rt.fns.renderCoordinacion('docentes');
    else if (page === 'consulta-sede') rt.fns.renderConsultaSede();
    else if (page === 'consulta-informacion') rt.fns.renderConsultaInformacion();
    else if (page === 'consulta-estudiante') rt.fns.renderConsultaEstudiante();


    rt.fns.updateReportAvailability();
  }

  function navigate(page) {
    if (!roleCanAccess(page)) {
      showToast('No tiene permisos para esta sección.', 'error');
      return;
    }
    STATE.currentPage = page;
    // Al salir de configuración sin guardar, limpiar modo edición
    if (page !== 'configuracion' && STATE.editingConfigId) {
      STATE.editingConfigId = '';
      if (STATE.activeConfigId) cargarPaoActivo();
      else { var d = JSON.parse(JSON.stringify(DEFAULT_STATE.courseConfig)); STATE.courseConfig = d; STATE.selectedRACIds = []; STATE.raauEntries = []; STATE.activities = []; STATE.configLocked = false; }
      save();
    }
    // Si hay PAO activo y NO estamos editando, asegurar que sus datos estén cargados
    if (STATE.activeConfigId && !STATE.editingConfigId) {
      cargarPaoActivo();
    } else if (!STATE.activeConfigId && !STATE.editingConfigId) {
      STATE.courseConfig = JSON.parse(JSON.stringify(DEFAULT_STATE.courseConfig));
      STATE.selectedRACIds = [];
      STATE.raauEntries = [];
      STATE.activities = [];
      STATE.configLocked = false;
    }
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.remove('active'); });
    var normalizedPage = page;
    if (page.indexOf('coord-') === 0) normalizedPage = 'coordinacion';
    var pageEl = document.getElementById('page-' + normalizedPage);
    if (pageEl) pageEl.classList.add('active');
    var navEl = document.querySelector('.nav-item[data-page="' + page + '"]');
    if (navEl) navEl.classList.add('active');
    renderPage(page);
  }

  // ---- Anomalías (asistente proactivo local) ----

  window.__mostrarAnomalias = function (anomalias) {
    if (!anomalias || anomalias.length === 0) return;

    // Mostrar badge en el dashboard
    const badge = document.getElementById("dash-anomaly-badge");
    if (badge) {
      badge.textContent = anomalias.length + " alerta(s)";
      badge.style.display = "";
    }

    // Mostrar alertas en la página de calificaciones
    const alertsContainer = document.getElementById("cal-anomaly-alerts");
    if (!alertsContainer) return;

    function severityIcon(color) {
      return '<svg viewBox="0 0 10 10" width="10" height="10" style="vertical-align:middle"><circle cx="5" cy="5" r="5" fill="' + color + '"/></svg>';
    }
    const severityConfig = {
      alta: { bg: "#fef2f2", border: "#fca5a5", icon: severityIcon("#ef4444") },
      media: { bg: "#fffbeb", border: "#fcd34d", icon: severityIcon("#f59e0b") },
      baja: { bg: "#f0fdf4", border: "#86efac", icon: severityIcon("#22c55e") },
    };

    alertsContainer.style.display = "block";
    alertsContainer.innerHTML =
      '<div style="font-size:.78rem;font-weight:700;color:var(--gray-700);margin-bottom:8px"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--gray-600)" stroke-width="2" style="vertical-align:middle;margin-right:4px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Asistente de Anomalías</div>' +
      anomalias
        .map(function (a) {
          var cfg = severityConfig[a.severidad] || severityConfig.media;
          return (
            '<div style="display:flex;align-items:flex-start;gap:8px;padding:8px 12px;margin-bottom:6px;background:' +
            cfg.bg +
            ";border:1px solid " +
            cfg.border +
            ';border-radius:var(--radius);font-size:.78rem">' +
            '<span style="font-size:.9rem">' +
            cfg.icon +
            '</span>' +
            '<div><div style="font-weight:600;color:var(--gray-800)">' +
            a.tipo.replace("_", " ") +
            "</div>" +
            '<div style="color:var(--gray-600)">' +
            a.mensaje +
            "</div></div></div>"
          );
        })
        .join("") +
      '<button class="btn btn-ghost btn-sm" onclick="document.getElementById(\'cal-anomaly-alerts\').style.display=\'none\'" style="margin-top:4px">Descartar</button>';

    // Mostrar toast de resumen
    var altaCount = anomalias.filter(function (a) { return a.severidad === "alta"; }).length;
    if (altaCount > 0) {
      showToast(altaCount + " anomalía(s) crítica(s) detectada(s)", "error");
    }
  };

  window.closeModal = closeModal;
  window.closeSuccessModal = closeSuccessModal;
  window.getPaoActivo = getPaoActivo;
  window.cargarDatosDelPao = cargarDatosDelPao;
  window.showSuccessModal = showSuccessModal;
  window.navigateToNewConfig = navigateToNewConfig;
  window.onCarreraChange = rt.fns.onCarreraChange;
  window.onPaoChange = rt.fns.onPaoChange;
  window.onAsignaturaChange = rt.fns.onAsignaturaChange;
  window.cfgPrev = rt.fns.cfgPrev;
  window.cfgNext = rt.fns.cfgNext;
  window.cfgSave = rt.fns.cfgSave;
  window.toggleRAC = rt.fns.toggleRAC;
  window.toggleManagedRAC = rt.fns.toggleManagedRAC;
  window.addRAAU = rt.fns.addRAAU;
  window.deleteRAAU = rt.fns.deleteRAAU;
  window.editRAAU = rt.fns.editRAAU;
  window.addActivity = rt.fns.addActivity;
  window.deleteActivity = rt.fns.deleteActivity;
  window.editActivity = rt.fns.editActivity;
  window.renderStudentTable = rt.fns.renderStudentTable;
  window.renderGradeTable = rt.fns.renderGradeTable;
  window.persistActiveConfigData = persistActiveConfigData;
  window.exportStudentsPDF = rt.fns.exportStudentsPDF;
  window.exportGradesExcel = rt.fns.exportGradesExcel;
  window.exportGradesPDF = function () { rt.fns.exportPayloadPDF('grades'); };
  window.showGradesQR = function () { rt.fns.showExportQR('grades'); };
  window.__legacyExportGradesPDF = rt.fns.exportGradesPDF;
  window.__legacyShowGradesQR = rt.fns.showGradesQR;
  window.editStudent = rt.fns.editStudent;
  window.confirmDelete = rt.fns.confirmDelete;
  window.onGradeInput = rt.fns.onGradeInput;
  window.onGradeChange = rt.fns.onGradeChange;
  window.calSave = rt.fns.calSave;
  window.applySavedConfig = rt.fns.applySavedConfig;
  window.editSavedConfigName = rt.fns.editSavedConfigName;
  window.deleteSavedConfig = rt.fns.deleteSavedConfig;
  window.onConfigConfirmContinue = rt.fns.onConfigConfirmContinue;
  window.unlockInitialConfig = rt.fns.unlockInitialConfig;
  window.unlockNewConfig = rt.fns.unlockNewConfig;
  window.cfgStartNew = cfgStartNew;
  window.saveManagedConfigEdits = rt.fns.saveManagedConfigEdits;
  window.openManagedRAAUEditor = rt.fns.openManagedRAAUEditor;
  window.openManagedActivities = rt.fns.openManagedActivities;
  window.showOasisImport = rt.fns.showOasisImport;
  window.syncStudentsFromOasis = rt.fns.syncStudentsFromOasis;
  window.togglePaoDropdown = togglePaoDropdown;
  window.selectPaoFromDropdown = selectPaoFromDropdown;
  window.doLogin = rt.fns.doLogin;
  window.doLogout = rt.fns.doLogout;
  window.openProfile = rt.fns.openProfile;
  window.coordSetDocentePassword = rt.fns.coordSetDocentePassword;
  window.coordLoadSubjects = rt.fns.coordLoadSubjects;
  window.coordEditMapping = rt.fns.coordEditMapping;
  window.coordAddMapRow = rt.fns.coordAddMapRow;
  window.coordSaveMapping = rt.fns.coordSaveMapping;
  window.coordOpenConfig = rt.fns.coordOpenConfig;
  window.coordCreateConfig = rt.fns.coordCreateConfig;
  window.coordGoConfig = rt.fns.coordGoConfig;
  window.coordLoadSubjectsAssignment = rt.fns.coordLoadSubjectsAssignment;
  window.coordCreateAssignment = rt.fns.coordCreateAssignment;
  window.coordAddDocente = rt.fns.coordAddDocente;
  window.coordImportDocentes = rt.fns.coordImportDocentes;
  window.coordOmitDocente = rt.fns.coordOmitDocente;
  window.coordRestoreDocente = rt.fns.coordRestoreDocente;
  window.coordVerHorario = rt.fns.coordVerHorario;
  window.coordAddAsignatura = rt.fns.coordAddAsignatura;
  window.coordManualRAC = rt.fns.coordManualRAC;
  window.coordRenderRACList = rt.fns.coordRenderRACList;
  window.coordEditRAC = rt.fns.coordEditRAC;
  window.coordDeleteRAC = rt.fns.coordDeleteRAC;
  window.coordManualRAAU = rt.fns.coordManualRAAU;
  window.coordRenderRAAUList = rt.fns.coordRenderRAAUList;
  window.coordEditRAAUItem = rt.fns.coordEditRAAUItem;
  window.coordDeleteRAAUItem = rt.fns.coordDeleteRAAUItem;
  window.coordTriggerExcel = rt.fns.coordTriggerExcel;
  window.coordImportExcel = rt.fns.coordImportExcel;
  window.printDetailedReport = rt.fns.printDetailedReport;
  window.exportReportExcel = rt.fns.exportReportExcel;
  window.exportReportPDF = rt.fns.exportReportPDF;
  window.showReportQR = rt.fns.showReportQR;
  window.expandChart = rt.fns.expandChart;
  window.expandCoordChart = rt.fns.expandCoordChart;
  window.navigate = navigate;

  var carrera = document.getElementById('cfg-carrera');
  var pao = document.getElementById('cfg-pao');
  var asig = document.getElementById('cfg-asignatura');
  if (carrera) carrera.addEventListener('change', rt.fns.onCarreraChange);
  if (pao) pao.addEventListener('change', rt.fns.onPaoChange);
  if (asig) asig.addEventListener('change', rt.fns.onAsignaturaChange);

  // Los botones del wizard ya están conectados desde React (App.jsx) para evitar doble ejecución.

  function activePageId() { var p = document.querySelector('.page.active'); return p ? p.id : ''; }

  // ENTER = confirmar: en Configuración avanza/guarda; en Calificaciones guarda.
  function confirmActivePage() {
    var id = activePageId();
    if (id === 'page-configuracion') {
      rt.fns.cfgConfirmEnter();
    } else if (id === 'page-calificaciones') {
      rt.fns.calSave();
    }
  }

  // Mueve el foco entre celdas de notas. dir: 'up'|'down'|'left'|'right'|'next'|'prev'.
  function moveGradeFocus(target, dir) {
    var rows = [];
    document.querySelectorAll('#cal-table-wrap tr').forEach(function (tr) {
      var ins = Array.prototype.slice.call(tr.querySelectorAll('.grade-input'));
      if (ins.length) rows.push(ins);
    });
    var rowI = -1, colI = -1;
    for (var ri = 0; ri < rows.length; ri++) { var ci = rows[ri].indexOf(target); if (ci !== -1) { rowI = ri; colI = ci; break; } }
    if (rowI === -1) return false;
    var dest = null;
    if (dir === 'up' && rows[rowI - 1]) dest = rows[rowI - 1][Math.min(colI, rows[rowI - 1].length - 1)];
    else if (dir === 'down' && rows[rowI + 1]) dest = rows[rowI + 1][Math.min(colI, rows[rowI + 1].length - 1)];
    else if (dir === 'left') dest = colI > 0 ? rows[rowI][colI - 1] : (rows[rowI - 1] ? rows[rowI - 1][rows[rowI - 1].length - 1] : null);
    else if (dir === 'right' || dir === 'next') dest = colI < rows[rowI].length - 1 ? rows[rowI][colI + 1] : (rows[rowI + 1] ? rows[rowI + 1][0] : null);
    else if (dir === 'prev') dest = colI > 0 ? rows[rowI][colI - 1] : (rows[rowI - 1] ? rows[rowI - 1][rows[rowI - 1].length - 1] : null);
    if (dest) { dest.focus(); if (dest.select) dest.select(); return true; }
    return false;
  }

  // Cerrar dropdown al hacer clic fuera
  document.addEventListener('click', function (event) {
    if (!_paoDropdownOpen) return;
    var toggle = document.querySelector('.pao-dropdown-toggle');
    if (toggle && !toggle.contains(event.target)) closePaoDropdown();
  });

  document.addEventListener('keydown', function (event) {
    // Atajos globales Alt+1..6 para cambiar de sección.
    if (event.altKey && !event.shiftKey && !event.ctrlKey) {
      var hotMap = { '1': 'dashboard', '2': 'configuracion', '3': 'estudiantes', '4': 'calificaciones', '5': 'reporte', '6': 'coordinacion' };
      if (hotMap[event.key]) { event.preventDefault(); navigate(hotMap[event.key]); return; }
    }
    // Ctrl/Cmd+Enter siempre confirma la página activa.
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); confirmActivePage(); return; }

    // Si hay un modal abierto, Enter confirma su acción principal (la última: Guardar/
    // Crear/Confirmar/Eliminar/Cerrar). Se omite dentro de <textarea> para permitir saltos.
    var modalOpen = document.getElementById('modal-overlay');
    if (event.key === 'Enter' && modalOpen && modalOpen.classList.contains('open')) {
      var modalActs = window._modalActions || [];
      var inTextarea = (event.target && event.target.tagName || '').toLowerCase() === 'textarea';
      if (modalActs.length && !inTextarea) { event.preventDefault(); window._modalAction(modalActs.length - 1); }
      return;
    }

    var isGradeCell = event.target && event.target.classList && event.target.classList.contains('grade-input');

    if (isGradeCell) {
      // Flechas: celda a celda en cualquier dirección.
      if (event.key === 'ArrowUp') { rt.fns.onGradeChange(event.target); if (moveGradeFocus(event.target, 'up')) event.preventDefault(); return; }
      if (event.key === 'ArrowDown') { rt.fns.onGradeChange(event.target); if (moveGradeFocus(event.target, 'down')) event.preventDefault(); return; }
      if (event.key === 'ArrowLeft') { rt.fns.onGradeChange(event.target); if (moveGradeFocus(event.target, 'left')) event.preventDefault(); return; }
      if (event.key === 'ArrowRight') { rt.fns.onGradeChange(event.target); if (moveGradeFocus(event.target, 'right')) event.preventDefault(); return; }
      // Tab: avanza/retrocede entre celdas (secciones de notas).
      if (event.key === 'Tab') { event.preventDefault(); rt.fns.onGradeChange(event.target); moveGradeFocus(event.target, event.shiftKey ? 'prev' : 'next'); return; }
      // Enter: registra la nota actual y baja a la siguiente fila; Ctrl+Enter guarda todo.
      if (event.key === 'Enter') { event.preventDefault(); rt.fns.onGradeChange(event.target); if (!moveGradeFocus(event.target, event.shiftKey ? 'up' : 'down')) moveGradeFocus(event.target, event.shiftKey ? 'prev' : 'next'); return; }
      return;
    }

    // Fuera de las celdas: Enter confirma/avanza (salvo en áreas de texto).
    if (event.key === 'Enter' && (event.target && event.target.tagName || '').toLowerCase() !== 'textarea') {
      var id = activePageId();
      if (id === 'page-configuracion' || id === 'page-calificaciones') { event.preventDefault(); confirmActivePage(); }
    }
  });

  ['auth-email', 'auth-pass'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') rt.fns.doLogin();
    });
  });

  window.addEventListener('beforeunload', function () {
    rt.fns.releaseLoginSession(STATE.currentUser, true);
  });

  applyRoleUI();
  updateSidebar();
  if (STATE.currentUser) rt.fns.resumeStoredSession();
}
