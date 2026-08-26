// ============================================================================
// CAPA DE APLICACIÓN/PRESENTACIÓN · Autenticación, sesión única y perfil
// ----------------------------------------------------------------------------
// Login (local / dev / Neon / OASIS), control de sesión única (heartbeat contra
// el BFF), logout, reanudación de sesión guardada y modal de perfil + cambio de
// contraseña. Recibe `rt`: lee/escribe rt.STATE y llama al núcleo vía rt.fns
// (save, applyRoleUI, updateSidebar, showToast, navigate, hydrateFromDb,
// loadVectorCatalog, loadActiveConfigData, findUserByEmail, isDocenteExcluded,
// myAssignments, openModal, closeModal, verHorario, renderDashboard).
// Expone en rt.fns: doLogin, doLogout, openProfile, autoLoadPeriodo,
// resumeStoredSession.
// ============================================================================
import * as oasis from "../../services/oasisApi.js";
import { COORDINADOR, ROLE_LABEL } from "../constants.js";

export function registerAuth(rt) {
  function setAuthLoading(loading) {
    var btn = document.querySelector('.auth-main-btn');
    if (btn) { btn.disabled = loading; btn.textContent = loading ? 'Verificando…' : 'Ingresar'; }
  }

  var loginSessionHeartbeat = null;

  function getLoginSessionId() {
    var key = 'espoch_active_session_id';
    try {
      var existing = sessionStorage.getItem(key);
      if (existing) return existing;
      var id = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : ('sess_' + Date.now() + '_' + Math.random().toString(36).slice(2));
      sessionStorage.setItem(key, id);
      return id;
    } catch {
      return 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    }
  }

  function getSessionApiUrl(path) {
    var base = oasis.apiBaseUrl || '';
    if (base.endsWith('/api') && path.indexOf('/api/') === 0) return base + path.slice(4);
    return base + path;
  }

  function sessionPayload(user) {
    return {
      email: user && user.email,
      sessionId: getLoginSessionId(),
      userAgent: (navigator && navigator.userAgent) || '',
      name: user && user.name,
      role: user && user.role,
      cedula: user && user.cedula
    };
  }

  async function claimLoginSession(user) {
    if (!user || !user.email) return;
    var res = await oasis.claimSession(sessionPayload(user));
    if (res && res.disabled) return;
    if (res && res.reason === 'excluded_docente') {
      throw new Error('Esta cuenta fue omitida por coordinacion. Contacte al coordinador para restaurarla.');
    }
    if (!res || res.ok === false) {
      throw new Error('Esta cuenta ya tiene una sesion activa. Cierre la otra sesion o espere unos minutos.');
    }
  }

  function stopLoginSessionHeartbeat() {
    if (loginSessionHeartbeat) clearInterval(loginSessionHeartbeat);
    loginSessionHeartbeat = null;
  }

  function forceLogoutBySession() {
    stopLoginSessionHeartbeat();
    rt.STATE.currentUser = null;
    rt.fns.save();
    rt.fns.applyRoleUI();
    rt.fns.updateSidebar();
    var msgEl = document.getElementById('auth-msg');
    if (msgEl) msgEl.textContent = 'La sesion se cerro porque la cuenta se abrio en otro lugar.';
    rt.fns.showToast('Sesion cerrada por ingreso en otro dispositivo.', 'error');
  }

  function startLoginSessionHeartbeat(user) {
    stopLoginSessionHeartbeat();
    loginSessionHeartbeat = setInterval(function () {
      if (!rt.STATE.currentUser || !user || rt.STATE.currentUser.email !== user.email) return;
      oasis.claimSession(sessionPayload(user)).then(function (res) {
        if (res && !res.disabled && res.ok === false) forceLogoutBySession();
      }).catch(function () {
        /* el siguiente latido reintenta */
      });
    }, 60000);
  }

  function releaseLoginSession(user, useBeacon) {
    if (!user || !user.email) return;
    var payload = sessionPayload(user);
    if (useBeacon && navigator && navigator.sendBeacon && window.Blob) {
      try {
        navigator.sendBeacon(getSessionApiUrl('/api/session/release'), new Blob([JSON.stringify(payload)], { type: 'application/json' }));
        return;
      } catch {
        /* usa fetch normal abajo */
      }
    }
    oasis.releaseSession(payload).catch(function () {});
  }

  async function completeLogin(user) {
    await claimLoginSession(user);
    await rt.fns.loadVectorCatalog();
    finishLogin(user);
    startLoginSessionHeartbeat(user);
  }

  function validatePasswordForm(password, confirm) {
    var p = String(password || '');
    if (p !== String(confirm || '')) return 'La confirmacion no coincide.';
    if (p.length < 8) return 'La contrasena debe tener al menos 8 caracteres.';
    if (/\s/.test(p)) return 'La contrasena no debe tener espacios.';
    if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Use letras y numeros en la contrasena.';
    return '';
  }

  function passwordHelpHtml() {
    return '<div style="font-size:.72rem;color:var(--gray-500);margin-top:4px">Minimo 8 caracteres, con letras y numeros, sin espacios.</div>';
  }

  // --- Clave por defecto = cédula + cambio obligatorio en el primer ingreso ---
  var FORCE_PWD_KEY = 'espoch_force_pwd';
  function cedulaDigits(v) { return String(v == null ? '' : v).replace(/[^0-9kK]/g, '').toLowerCase(); } // == cleanDocId del servidor
  // ¿Ingresó con su contraseña por defecto (la cédula)? => debe cambiarla.
  function isDefaultCedulaLogin(pass, user) {
    var ced = cedulaDigits(user && user.cedula);
    return Boolean(ced) && cedulaDigits(pass) === ced;
  }

  // Modal OBLIGATORIO (no se puede cerrar) para que el docente cree su nueva contraseña.
  function forcePasswordChange(user) {
    if (!user || !user.email) return;
    try { localStorage.setItem(FORCE_PWD_KEY, user.email); } catch { /* ignore */ }
    window.__lockModal = true;
    var body = '<p style="font-size:.82rem;color:var(--gray-700);line-height:1.5;margin-bottom:12px">Por seguridad, su contraseña inicial es su <strong>cédula</strong>. Cree una nueva contraseña para continuar.</p>' +
      '<div class="form-group"><label class="form-label">Nueva contraseña</label><input class="form-input" id="fpc-new" type="password" autocomplete="new-password"></div>' +
      '<div class="form-group"><label class="form-label">Confirmar contraseña</label><input class="form-input" id="fpc-confirm" type="password" autocomplete="new-password"></div>' +
      passwordHelpHtml() +
      '<div id="fpc-msg" style="color:var(--red);font-size:.78rem;margin-top:8px"></div>';
    rt.fns.openModal('Cree su nueva contraseña', body,
      [
        // Escape seguro: si no puede cambiarla ahora (p. ej. servidor caído), puede salir;
        // no entra a la app hasta cambiarla, así que el requisito sigue vigente.
        { label: 'Salir', cls: 'btn-ghost', action: function () { window.__lockModal = false; rt.fns.closeModal(); doLogout(); } },
        { label: 'Guardar contraseña', cls: 'btn-success', action: function () { submitForcedPassword(user); } }
      ]);
    setTimeout(function () { var el = document.getElementById('fpc-new'); if (el) el.focus(); }, 60);
  }

  async function submitForcedPassword(user) {
    var nv = (document.getElementById('fpc-new') || {}).value || '';
    var cf = (document.getElementById('fpc-confirm') || {}).value || '';
    var msg = document.getElementById('fpc-msg');
    var err = validatePasswordForm(nv, cf);
    if (!err && user.cedula && cedulaDigits(nv) === cedulaDigits(user.cedula)) err = 'La nueva contraseña no puede ser su cédula.';
    if (err) { if (msg) msg.textContent = err; return; }
    if (msg) { msg.style.color = 'var(--gray-500)'; msg.textContent = 'Guardando...'; }
    try {
      await oasis.updateDbPassword({ email: user.email, currentPassword: cedulaDigits(user.cedula), newPassword: nv });
    } catch (e) {
      if (msg) { msg.style.color = 'var(--red)'; msg.textContent = (e && e.message) || 'No se pudo actualizar. Intente de nuevo.'; }
      return;
    }
    var local = rt.fns.findUserByEmail(user.email);
    if (local && typeof local.password !== 'undefined') { local.password = nv; rt.fns.save(); }
    try { localStorage.removeItem(FORCE_PWD_KEY); } catch { /* ignore */ }
    window.__lockModal = false;
    rt.fns.closeModal();
    rt.fns.showToast('Contraseña actualizada. ¡Bienvenido!', 'success');
  }

  function deriveRole(roles) {
    var names = (roles || []).map(function (r) { return (r.nombreRol || '').toUpperCase(); });
    if (names.some(function (n) { return n.indexOf('COORDINADOR') !== -1; })) return 'coordinador';
    if (names.some(function (n) { return n.indexOf('DECANO') !== -1 || n.indexOf('ADMIN') !== -1; })) return 'admin';
    return 'docente';
  }

  function buildUserFromOasis(loginValue, result) {
    var perfil = (result && result.perfil) || {};
    var roles = (result && result.roles) || [];
    var name = ((perfil.nombres || '') + ' ' + (perfil.apellidos || '')).trim() || loginValue;
    return {
      email: perfil.email || loginValue,
      role: deriveRole(roles),
      name: name,
      cedula: perfil.cedula || '',
      roles: roles,
      source: 'oasis'
    };
  }

  // Cada usuario tiene su propio borrador de configuración y sus propios datos.
  // Si la configuración activa no le pertenece, la reiniciamos al ingresar.
  function resetDraftIfNotMine() {
    var email = rt.STATE.currentUser && rt.STATE.currentUser.email;
    var active = (rt.STATE.savedConfigs || []).find(function (c) { return c.id === rt.STATE.activeConfigId; });
    var mineActive = active && (active.ownerEmail || '') === email;
    if (mineActive) { rt.fns.loadActiveConfigData(); return; }
    rt.STATE.configLocked = false;
    rt.STATE.activeConfigId = '';
    rt.STATE.courseConfig = {
      periodoAcademico: (rt.STATE.oasisPeriodo && rt.STATE.oasisPeriodo.descripcion) || '',
      codPeriodo: (rt.STATE.oasisPeriodo && rt.STATE.oasisPeriodo.codigo) || '',
      facultad: 'SEDE ORELLANA', carrera: '', asignatura: '',
      docente: (rt.STATE.currentUser && rt.STATE.currentUser.name) || '', pao: '', aporte: 'FIN DE CICLO'
    };
    rt.STATE.selectedRACIds = [];
    rt.STATE.raauEntries = [];
    rt.STATE.activities = [];
    rt.STATE.students = [];
    rt.STATE.grades = [];
    rt.fns.save();
  }

  function finishLogin(user) {
    rt.STATE.currentUser = user;
    resetDraftIfNotMine();
    rt.fns.save();
    var msgEl = document.getElementById('auth-msg');
    if (msgEl) msgEl.textContent = '';
    rt.fns.applyRoleUI();
    rt.fns.updateSidebar();
    rt.fns.navigate(user.role === 'coordinador' ? 'coord-docentes' : 'dashboard');
    rt.fns.showToast('Bienvenido, ' + user.name, 'success');
    rt.fns.hydrateFromDb().then(function () {
      return autoLoadPeriodo();
    }).catch(function () {
      return autoLoadPeriodo();
    });
  }

  // Cuenta local (coordinador o docente creado por el coordinador).
  function findLocalUser(email, pass) {
    var u = rt.fns.findUserByEmail(email);
    if (u && u.password === pass && !rt.fns.isDocenteExcluded(u.email, u.cedula)) {
      return { email: u.email, role: u.role, name: u.name, cedula: u.cedula || '', source: 'local' };
    }
    return null;
  }

  async function doLogin() {
    var emailEl = document.getElementById('auth-email');
    var passEl = document.getElementById('auth-pass');
    var msgEl = document.getElementById('auth-msg');
    var email = (emailEl && emailEl.value || '').trim();
    var pass = (passEl && passEl.value || '').trim();
    if (!email || !pass) {
      if (msgEl) msgEl.textContent = 'Ingrese su correo institucional y contraseña.';
      return;
    }
    // "Recuérdame": guarda la preferencia + el correo (para pre-rellenar) y marca esta
    // sesión de navegador. Si NO está marcado, al reabrir el navegador se exige login.
    try {
      var rememberEl = document.getElementById('auth-remember');
      var remember = rememberEl ? rememberEl.checked : true;
      localStorage.setItem('espoch_remember', remember ? '1' : '0');
      localStorage.setItem('espoch_last_email', email);
      sessionStorage.setItem('espoch_session_alive', '1');
    } catch { /* ignore */ }
    // 1) Cuentas locales en memoria (coordinador / docentes de esta sesión). Offline-proof.
    var local = findLocalUser(email, pass);
    if (local) {
      setAuthLoading(true);
      try {
        await completeLogin(local);
        if (isDefaultCedulaLogin(pass, local)) forcePasswordChange(local);
      } catch (err) {
        if (msgEl) msgEl.textContent = err.message || 'No se pudo iniciar sesion.';
      } finally {
        setAuthLoading(false);
      }
      return;
    }
    setAuthLoading(true);
    try {
      // 2) Dev/test login (cuentas empiezan con "dev." - bypass OASIS).
      if (email.indexOf('dev.') === 0) {
        var devResult = await oasis.devLogin(email, pass);
        if (devResult) { await completeLogin(buildUserFromOasis(email, devResult)); return; }
      }
      // 3) Login contra la base de datos (docentes creados por el coordinador, otra PC).
      //    Solo la VALIDACIÓN va dentro del try; completeLogin() se ejecuta fuera para que
      //    sus errores (p. ej. "sesión activa en otro dispositivo") NO se disfracen del
      //    mensaje transitorio de Neon.
      var dbUser = null;
      try {
        dbUser = await oasis.loginDb(email, pass);
      } catch (dbErr) {
        var isCoord = email.toLowerCase() === COORDINADOR.email;
        var wrongCreds = dbErr && dbErr.status >= 400 && dbErr.status < 500; // 401/400 en Neon
        if (wrongCreds) {
          // La contraseña no coincide en Neon. El coordinador es una cuenta INTERNA
          // (no se valida contra OASIS): hay que decirle claramente que la clave es
          // incorrecta, NO "reintente en unos segundos" (que parecía un fallo del servidor).
          if (isCoord) throw new Error('Correo o contraseña incorrectos.', { cause: dbErr });
          /* docente: puede existir en OASIS -> continuamos al paso 4 */
        } else if (isCoord || (dbErr && dbErr.status >= 500)) {
          // Error del servidor/Neon (5xx) o coordinador sin conexión: fallo transitorio.
          var neonErr = new Error('No se pudo validar la cuenta interna en Neon. Intente nuevamente en unos segundos.', { cause: dbErr });
          if (dbErr && dbErr.offline) neonErr.offline = true;
          throw neonErr;
        }
        /* docente con error leve: probamos OASIS */
      }
      // Validación OK -> completar sesión FUERA del try (sus errores se reportan tal cual).
      if (dbUser && !dbUser.disabled) {
        await completeLogin(dbUser);
        if (isDefaultCedulaLogin(pass, dbUser)) forcePasswordChange(dbUser);
        return;
      }
      // 4) Autenticación real contra OASIS.
      var result = await oasis.login(email, pass);
      // OASIS sin credenciales de servicio devuelve un usuario MOCK ("MODO DEV /
      // USUARIO DE PRUEBA", cédula 0600000000). NO se debe crear una cuenta con ese
      // mock: solo ingresan cuentas reales (Neon/coordinación u OASIS con credenciales).
      var perfilOasis = (result && result.perfil) || {};
      var oasisMock = perfilOasis.cedula === '0600000000' ||
        /MODO\s*DEV|USUARIO\s*DE\s*PRUEBA/i.test((perfilOasis.nombres || '') + ' ' + (perfilOasis.apellidos || ''));
      if (oasisMock) {
        throw new Error('No se pudo validar contra OASIS. Ingrese con la clave asignada por coordinación.');
      }
      await completeLogin(buildUserFromOasis(email, result));
    } catch (err) {
      if (msgEl) {
        msgEl.textContent = err && err.offline
          ? 'No se pudo contactar el servidor. Verifique su conexión.'
          : (err.message || 'Usuario o contraseña incorrectos.');
      }
    } finally {
      setAuthLoading(false);
    }
  }

  function syncPeriodoInputs(periodo, message) {
    var el = document.getElementById('cfg-periodo');
    if (el && periodo && periodo.descripcion) el.value = periodo.descripcion;
    var help = document.getElementById('cfg-periodo-help');
    if (help) {
      var code = periodo && periodo.codigo ? ' - Codigo ' + periodo.codigo : '';
      help.textContent = message || ('Periodo vigente sincronizado con OASIS' + code);
    }
  }

  function applyPeriodoToActiveConfig(periodo) {
    if (!periodo) return;
    if (!rt.STATE.courseConfig) rt.STATE.courseConfig = {};
    if (periodo.descripcion) rt.STATE.courseConfig.periodoAcademico = periodo.descripcion;
    if (periodo.codigo) rt.STATE.courseConfig.codPeriodo = periodo.codigo;
    if (rt.STATE.activeConfigId) {
      var active = (rt.STATE.savedConfigs || []).find(function (cfg) { return cfg.id === rt.STATE.activeConfigId; });
      if (active && active.courseConfig) {
        if (periodo.descripcion) active.courseConfig.periodoAcademico = periodo.descripcion;
        if (periodo.codigo) active.courseConfig.codPeriodo = periodo.codigo;
      }
    }
  }

  async function autoLoadPeriodo() {
    var cached = rt.STATE.oasisPeriodo || null;
    try {
      var p = await oasis.getPeriodoActual();
      if (p && (p.descripcion || p.codigo)) {
        rt.STATE.oasisPeriodo = p;
        applyPeriodoToActiveConfig(p);
        rt.fns.save();
        syncPeriodoInputs(p, 'Periodo vigente consultado desde OASIS' + (p.codigo ? ' - Codigo ' + p.codigo : ''));
        if (rt.fns.updateSidebar) rt.fns.updateSidebar();
        if (rt.STATE.currentPage === 'dashboard' && rt.fns.renderDashboard) rt.fns.renderDashboard();
        return p;
      }
    } catch {
      if (cached && (cached.descripcion || cached.codigo)) {
        syncPeriodoInputs(cached, 'Sin conexion con OASIS; usando ultimo periodo guardado' + (cached.codigo ? ' - Codigo ' + cached.codigo : ''));
        return cached;
      }
    }
    syncPeriodoInputs(null, 'No se pudo consultar el periodo vigente.');
    return null;
  }

  function doLogout() {
    var previousUser = rt.STATE.currentUser;
    releaseLoginSession(previousUser, true);
    stopLoginSessionHeartbeat();
    rt.STATE.currentUser = null;
    rt.fns.save();
    rt.fns.applyRoleUI();
    rt.fns.updateSidebar();
    var msgEl = document.getElementById('auth-msg');
    if (msgEl) msgEl.textContent = '';
    var passEl = document.getElementById('auth-pass');
    if (passEl) passEl.value = '';
  }

  async function resumeStoredSession() {
    var user = rt.STATE.currentUser;
    if (!user) return;
    // "Recuérdame" desactivado: la sesión solo vive mientras el navegador esté abierto.
    // Al reabrirlo (sessionStorage vacío) se cierra y se exige login. (Por defecto SÍ recuerda.)
    var remember, sessionAlive;
    try { remember = localStorage.getItem('espoch_remember') !== '0'; } catch { remember = true; }
    try { sessionAlive = sessionStorage.getItem('espoch_session_alive') === '1'; } catch { sessionAlive = false; }
    if (!remember && !sessionAlive) {
      rt.STATE.currentUser = null;
      rt.fns.save();
      rt.fns.applyRoleUI();
      rt.fns.updateSidebar();
      return;
    }
    try { sessionStorage.setItem('espoch_session_alive', '1'); } catch { /* ignore */ }
    try {
      await claimLoginSession(user);
      await rt.fns.loadVectorCatalog();
      startLoginSessionHeartbeat(user);
      rt.fns.renderDashboard();
      rt.fns.hydrateFromDb().then(function () {
        return autoLoadPeriodo();
      }).catch(function () {
        return autoLoadPeriodo();
      });
      var mustChange = false;
      try { mustChange = localStorage.getItem(FORCE_PWD_KEY) === user.email; } catch { mustChange = false; }
      if (mustChange) forcePasswordChange(user);
    } catch (err) {
      stopLoginSessionHeartbeat();
      rt.STATE.currentUser = null;
      rt.fns.save();
      rt.fns.applyRoleUI();
      rt.fns.updateSidebar();
      var msgEl = document.getElementById('auth-msg');
      if (msgEl) msgEl.textContent = err.message || 'Sesion cerrada.';
    }
  }

  // Configuración de perfil del usuario actual (datos + cambio de contraseña).
  function openProfile() {
    var u = rt.STATE.currentUser;
    if (!u) return;
    var local = rt.fns.findUserByEmail(u.email);
    var canChangePassword = Boolean(local) || u.source === 'db' || u.source === 'local';
    var body = '<div style="font-size:.82rem;color:var(--gray-700);line-height:1.8">' +
      '<div><strong>Nombre:</strong> ' + (u.name || '—') + '</div>' +
      '<div><strong>Correo:</strong> ' + (u.email || '—') + '</div>' +
      (u.cedula ? '<div><strong>Cédula:</strong> ' + u.cedula + '</div>' : '') +
      '<div><strong>Rol:</strong> ' + (ROLE_LABEL[u.role] || u.role) + '</div>' +
      '<div><strong>Origen:</strong> ' + (u.source === 'oasis' ? 'OASIS (institucional)' : 'Local') + '</div></div>';
    if (canChangePassword) {
      body += '<div style="margin-top:14px;border-top:1px solid var(--gray-200);padding-top:12px">' +
        '<div style="font-weight:600;font-size:.82rem;margin-bottom:8px">Cambiar mi contraseña</div>' +
        '<div class="form-group"><input class="form-input" id="prof-pass" type="text" placeholder="Nueva contraseña"></div></div>';
    } else {
      body += '<div class="info-box" style="margin-top:12px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg><p>La contraseña de cuentas OASIS se gestiona en el sistema institucional.</p></div>';
    }
    var actions = [{ label: 'Cerrar', cls: 'btn-ghost', action: 'close' }];
    var misAsig = rt.fns.myAssignments();
    if (u.cedula && misAsig.length) {
      actions.push({ label: 'Ver mi horario', cls: 'btn-edit', action: function () { rt.fns.closeModal(); rt.fns.verHorario(u.name, u.cedula, misAsig); } });
    }
    if (canChangePassword) {
      actions.push({ label: 'Guardar contraseña', cls: 'btn-success', action: function () {
        var p = document.getElementById('prof-pass').value.trim();
        if (!p) { rt.fns.showToast('Ingrese una contraseña.', 'error'); return; }
        local.password = p;
        rt.fns.save();
        rt.fns.closeModal();
        rt.fns.showToast('Contraseña actualizada.', 'success');
      } });
    }
    rt.fns.openModal('Mi perfil', body, actions);
    if (canChangePassword) {
      var passInput = document.getElementById('prof-pass');
      if (passInput) {
        passInput.outerHTML =
          '<label class="form-label">Contrasena actual</label><input class="form-input" id="prof-current-pass" type="password" autocomplete="current-password" style="margin-bottom:8px">' +
          '<label class="form-label">Nueva contrasena</label><input class="form-input" id="prof-pass" type="password" autocomplete="new-password" style="margin-bottom:8px">' +
          '<label class="form-label">Confirmar nueva contrasena</label><input class="form-input" id="prof-pass-confirm" type="password" autocomplete="new-password">' +
          passwordHelpHtml();
      }
      (window._modalActions || []).forEach(function (action) {
        if (!action || String(action.label || '').indexOf('Guardar') !== 0 || action.cls !== 'btn-success') return;
        action.label = 'Guardar contrasena';
        action.action = async function () {
          var current = document.getElementById('prof-current-pass').value.trim();
          var p = document.getElementById('prof-pass').value.trim();
          var confirm = document.getElementById('prof-pass-confirm').value.trim();
          if (!current || !p || !confirm) { rt.fns.showToast('Complete clave actual, nueva clave y confirmacion.', 'error'); return; }
          var validation = validatePasswordForm(p, confirm);
          if (validation) { rt.fns.showToast(validation, 'error'); return; }
          try {
            var res = await oasis.updateDbPassword({ email: u.email, currentPassword: current, newPassword: p });
            if (res && res.disabled) {
              if (!local || local.password !== current) { rt.fns.showToast('La clave actual no es correcta.', 'error'); return; }
            }
            if (local) local.password = p;
            if (COORDINADOR.email === u.email) COORDINADOR.password = p;
            rt.fns.save();
            rt.fns.closeModal();
            rt.fns.showToast('Contrasena actualizada.', 'success');
          } catch (err) {
            rt.fns.showToast((err && err.message) || 'No se pudo actualizar la contrasena.', 'error');
          }
        };
      });
      var saveBtn = document.querySelector('#modal-actions .btn-success');
      if (saveBtn) saveBtn.textContent = 'Guardar contrasena';
    }
  }

  Object.assign(rt.fns, { doLogin, doLogout, openProfile, autoLoadPeriodo, resumeStoredSession, releaseLoginSession, validatePasswordForm, passwordHelpHtml });
}
