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
    autoLoadPeriodo();
    rt.fns.hydrateFromDb(); // trae datos persistidos (configs, notas, asignaciones)
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
    // 1) Cuentas locales en memoria (coordinador / docentes de esta sesión). Offline-proof.
    var local = findLocalUser(email, pass);
    if (local) {
      setAuthLoading(true);
      try {
        await completeLogin(local);
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
      try {
        var dbUser = await oasis.loginDb(email, pass);
        if (dbUser && !dbUser.disabled) { await completeLogin(dbUser); return; }
      } catch (dbErr) {
        if (email.toLowerCase() === COORDINADOR.email || (dbErr && dbErr.status >= 500)) {
          throw new Error('No se pudo validar la cuenta interna en Neon. Intente nuevamente en unos segundos.', { cause: dbErr });
        }
        /* credenciales no válidas en BD: probamos OASIS */
      }
      // 4) Autenticación real contra OASIS.
      var result = await oasis.login(email, pass);
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

  async function autoLoadPeriodo() {
    try {
      // Reutiliza el período ya consultado a OASIS; si no hay, lo pide al BFF.
      var p = (rt.STATE.oasisPeriodo && rt.STATE.oasisPeriodo.descripcion) ? rt.STATE.oasisPeriodo : await oasis.getPeriodoActual();
      if (p && p.descripcion) {
        rt.STATE.oasisPeriodo = p;
        if (!rt.STATE.courseConfig.periodoAcademico) rt.STATE.courseConfig.periodoAcademico = p.descripcion;
        rt.fns.save();
        var el = document.getElementById('cfg-periodo');
        if (el && !el.value) el.value = rt.STATE.courseConfig.periodoAcademico || p.descripcion;
      }
    } catch { /* sin conexión: el período se ingresa manualmente */ }
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
    try {
      await claimLoginSession(user);
      await rt.fns.loadVectorCatalog();
      startLoginSessionHeartbeat(user);
      rt.fns.renderDashboard();
      autoLoadPeriodo();
      rt.fns.hydrateFromDb();
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
