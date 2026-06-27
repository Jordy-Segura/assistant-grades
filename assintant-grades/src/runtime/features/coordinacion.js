// ============================================================================
// CAPA DE PRESENTACIÓN · Panel de Coordinación (docentes, RAC/RAAU, horarios, mapeo)
// ----------------------------------------------------------------------------
// Asignación docente, gestión global de RAC/RAAU, importación OASIS/Excel,
// horarios y matriz docente. Recibe `rt`: lee/escribe rt.STATE/rt.DB_ESPOCH/... y
// llama al núcleo vía rt.fns. Registra sus funciones públicas en rt.fns.
// ============================================================================

import * as oasis from "../../services/oasisApi.js";
import { COORDINADOR } from "../constants.js";
import { escapeHtml, jsStringArg, normalizeEmail, normalizeDocId } from "../lib/format.js";

export function registerCoordinacion(rt) {
  var chartCoordDocentes = null;
  var chartCoordConfigs = null;
  var expandedCoordChart = null;
  // Últimos datos calculados, para reconstruir el gráfico en grande al ampliar.
  var lastCoordDoc = { labels: ['Sin datos'], datasets: [{ label: 'Sin datos', data: [0], backgroundColor: '#cbd5e1' }] };
  var lastCoordCfg = { labels: ['Sin datos'], data: [0] };
  var EXPAND_ICO = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

  function renderCoordinacion(section) {
    var target = document.getElementById('coord-content');
    if (!target) return;
    var titleEl = document.querySelector('#page-coordinacion .page-title');
    var subEl = document.querySelector('#page-coordinacion .page-sub');
    var labels = {
      overview: ['Panel de Coordinación', 'Monitoreo de aplicación RAC/RAAU y mapeo curricular'],
      asignaturas: ['Asignaturas', 'Asignación docente y seguimiento por asignatura'],
      rac: ['RAC', 'Gestión de resultados de aprendizaje de carrera'],
      raau: ['RAAU', 'Gestión de resultados de aprendizaje de asignatura'],
      docentes: ['Docentes por Asignatura', 'Monitoreo y matriz docente/asignaturas']
    };
    var selected = labels[section || 'overview'] || labels.overview;
    if (titleEl) titleEl.textContent = selected[0];
    if (subEl) subEl.textContent = selected[1];
    var totalConfigs = rt.STATE.savedConfigs.length;
    var totalStudents = Object.keys(rt.STATE.studentsByConfig || {}).reduce(function (sum, key) { return sum + (rt.STATE.studentsByConfig[key] || []).length; }, 0);
    var completion = rt.STATE.savedConfigs.map(function (cfg) {
      var sid = cfg.id;
      var students = (rt.STATE.studentsByConfig[sid] || []);
      var grades = (rt.STATE.gradesByConfig[sid] || []);
      var acts = (cfg.activities || []);
      var expected = students.length * acts.length;
      var entered = grades.filter(function (g) { return g.score != null; }).length;
      return { cfg: cfg, pct: expected > 0 ? Math.round(entered / expected * 100) : 0 };
    });
    var avgCompletion = completion.length ? Math.round(completion.reduce(function (s, c) { return s + c.pct; }, 0) / completion.length) : 0;
    var docentes = {};
    completion.forEach(function (item) {
      var doc = (item.cfg.courseConfig && item.cfg.courseConfig.docente) || 'Sin docente';
      if (!docentes[doc]) docentes[doc] = { count: 0, total: 0 };
      docentes[doc].count++;
      docentes[doc].total += item.pct;
    });
    var docenteRows = Object.keys(docentes).map(function (doc) {
      var d = docentes[doc];
      return '<tr><td>' + doc + '</td><td>' + d.count + '</td><td>' + Math.round(d.total / d.count) + '%</td></tr>';
    }).join('');
    var meEmail = rt.STATE.currentUser && rt.STATE.currentUser.email;
    var cfgRows = completion.map(function (item) {
      var cfg = item.cfg.courseConfig || {};
      var mine = (item.cfg.ownerEmail || '') === meEmail;
      var gestBtn = mine
        ? '<button class="btn btn-edit btn-sm" onclick="coordOpenConfig(\'' + item.cfg.id + '\')">Gestionar</button>'
        : '<span style="font-size:.7rem;color:var(--gray-400)">Solo su docente</span>';
      return '<tr><td>' + (cfg.asignatura || '—') + '</td><td>' + (cfg.docente || '—') + '</td><td>' + (cfg.pao || '—') + '</td><td>' + (cfg.aporte || '—') + '</td><td>' + item.pct + '%</td><td>' + gestBtn + '</td></tr>';
    }).join('');
    var careerOptions = Object.keys(rt.DB_ESPOCH).map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
    // El coordinador también es docente: puede asignarse asignaturas a sí mismo.
    var assignablePeople = [COORDINADOR].concat(rt.fns.getDocentes());
    var docenteOptions = assignablePeople.map(function (u) {
      return '<option value="' + u.email + '">' + u.name + (u.role === 'coordinador' ? ' (coordinador)' : '') + '</option>';
    }).join('');
    section = section || 'overview';
    var showOverview = section === 'overview';
    var showAsignaturas = section === 'asignaturas';
    var showDocentes = section === 'docentes';
    var showRAC = section === 'rac';
    var showRAAU = section === 'raau';
    target.innerHTML =
      '<div class="coord-layout">' +
      '<div class="stat-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:0"><div class="stat-card"><div class="stat-label">Configuraciones activas</div><div class="stat-val" style="color:var(--gray-800)">' + totalConfigs + '</div><div class="stat-sub">Histórico guardado</div></div><div class="stat-card"><div class="stat-label">Estudiantes monitoreados</div><div class="stat-val" style="color:var(--green)">' + totalStudents + '</div><div class="stat-sub">Suma de todas las configuraciones</div></div><div class="stat-card"><div class="stat-label">Avance promedio</div><div class="stat-val" style="color:var(--amber)">' + avgCompletion + '%</div><div class="stat-sub">Carga global de notas</div></div></div>' +
      ((showOverview || showDocentes) ? '<div class="coord-chart-grid"><div class="card chart-card" onclick="window.expandCoordChart(\'docentes\')" title="Click para ampliar"><span class="chart-expand-ico">' + EXPAND_ICO + '</span><div class="card-header"><div class="card-title">Aporte por asignatura a cada RAC</div></div><div class="card-body"><canvas id="coord-chart-docentes" height="200"></canvas></div></div><div class="card chart-card" onclick="window.expandCoordChart(\'configs\')" title="Click para ampliar"><span class="chart-expand-ico">' + EXPAND_ICO + '</span><div class="card-header"><div class="card-title">Top asignaturas que más aportan RAC</div></div><div class="card-body"><canvas id="coord-chart-configs" height="200"></canvas></div></div></div>' : '') +
      (showDocentes ? '<div class="card" style="margin-bottom:16px"><div class="card-header"><div class="card-title">Monitoreo docente</div></div><div class="card-body"><table class="data"><thead><tr><th>Docente</th><th>Asignaturas</th><th>Avance</th></tr></thead><tbody>' + (docenteRows || '<tr><td colspan="3">Sin datos</td></tr>') + '</tbody></table></div></div>' : '') +
      (showAsignaturas ? '<div class="card"><div class="card-header"><div class="card-title">Docentes y sus asignaturas</div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-success btn-sm" onclick="coordImportDocentes()">⬇ Importar de OASIS</button><button class="btn btn-primary btn-sm" onclick="coordAddDocente()">+ Docente</button></div></div><div class="card-body"><p style="font-size:.78rem;color:var(--gray-500);margin-bottom:6px">Importa docentes con sus cargas (materia · nivel · paralelo) desde OASIS y asígnales una contraseña. Cada docente solo verá y calificará sus propias asignaturas.</p><div id="coord-docentes-list"></div></div></div>' : '') +
      (showAsignaturas ? '<div class="card"><div class="card-header"><div class="card-title">Asignar una asignatura manualmente</div></div><div class="card-body"><div class="form-grid"><div class="form-group"><label class="form-label">Docente</label><select class="form-select" id="coord-doc-email"><option value="">Seleccione docente</option>' + docenteOptions + '</select></div><div class="form-group"><label class="form-label">Carrera</label><select class="form-select" id="coord-career-assignment" onchange="coordLoadSubjectsAssignment()"><option value="">Seleccione carrera</option>' + careerOptions + '</select></div></div><div class="form-grid"><div class="form-group"><label class="form-label">PAO</label><select class="form-select" id="coord-pao-assignment"><option value="">Seleccione PAO</option></select></div><div class="form-group"><label class="form-label">Asignatura</label><select class="form-select" id="coord-subject-assignment"><option value="">Seleccione asignatura</option></select></div></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" onclick="coordCreateAssignment()">Asignar asignatura</button><button class="btn btn-ghost btn-sm" onclick="coordAddAsignatura()">+ Crear asignatura en malla</button></div></div></div>' : '') +
      (showAsignaturas ? '<div class="card"><div class="card-header"><div class="card-title">Configuraciones guardadas (todas)</div><button class="btn btn-primary btn-sm" onclick="coordCreateConfig()">Nueva configuración</button></div><div class="card-body" style="overflow-x:auto"><table class="data"><thead><tr><th>Asignatura</th><th>Docente</th><th>PAO</th><th>Ciclo</th><th>Progreso</th><th></th></tr></thead><tbody>' + (cfgRows || '<tr><td colspan="6" style="text-align:center;color:var(--gray-500);padding:16px">Sin configuraciones guardadas</td></tr>') + '</tbody></table></div></div>' : '') +
      (showRAC ? '<div class="card"><div class="card-header"><div class="card-title">Gestión de RAC</div></div><div class="card-body"><div class="form-grid"><div class="form-group"><label class="form-label">Carrera</label><select class="form-select" id="coord-career-rac" onchange="coordRenderRACList()"><option value="">Seleccione carrera</option>' + careerOptions + '</select></div><div class="form-group" style="display:flex;align-items:flex-end"><button class="btn btn-edit btn-sm" onclick="coordManualRAC()">Agregar RAC manual</button></div></div><div id="coord-rac-list" style="margin-top:10px;font-size:.8rem;color:var(--gray-600)">Seleccione carrera para listar RAC.</div></div></div>' : '') +
      (showRAAU ? '<div class="card"><div class="card-header"><div class="card-title">Gestión global RAAU por asignatura</div></div><div class="card-body"><div class="form-grid"><div class="form-group"><label class="form-label">Carrera</label><select class="form-select" id="coord-career" onchange="coordLoadSubjects()"><option value="">Seleccione carrera</option>' + careerOptions + '</select></div><div class="form-group"><label class="form-label">Asignatura</label><select class="form-select" id="coord-subject" onchange="coordRenderRAAUList()"><option value="">Seleccione asignatura</option></select></div></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-edit btn-sm" onclick="coordEditMapping()">Editar mapeo RAC/RAAU</button><button class="btn btn-edit btn-sm" onclick="coordManualRAAU()">Agregar RAAU manual</button><button class="btn btn-ghost btn-sm" onclick="coordTriggerExcel()">Importar Excel RAC/RAAU</button><input type="file" id="coord-excel-input" accept=".xlsx,.xls,.csv" style="display:none" onchange="coordImportExcel(this.files)"></div><div id="coord-raau-list" style="margin-top:10px"></div></div></div>' : '') +
      (showDocentes ? '<div class="card"><div class="card-header"><div class="card-title">Docentes por Asignatura (Matriz)</div></div><div class="card-body"><table class="data"><thead><tr><th>Docente</th><th>Asignaturas asignadas</th><th>Total</th></tr></thead><tbody>' + coordDocenteMatrixRows() + '</tbody></table></div></div>' : '') +
      '</div>';
    if (showOverview || showDocentes) renderCoordCharts(docentes, completion);
    if (showRAC) coordRenderRACList();
    if (showRAAU) coordRenderRAAUList();
    if (showAsignaturas) coordRenderDocentesList();
  }

  function coordDocenteMatrixRows() {
    var grouped = {};
    (rt.STATE.teacherAssignments || []).forEach(function (a) {
      if (!grouped[a.docenteNombre]) grouped[a.docenteNombre] = [];
      grouped[a.docenteNombre].push(a.asignatura + ' (PAO ' + a.pao + ')');
    });
    var names = Object.keys(grouped);
    if (names.length === 0) return '<tr><td colspan="3">Sin asignaciones</td></tr>';
    return names.map(function (name) {
      return '<tr><td>' + name + '</td><td>' + grouped[name].join(', ') + '</td><td>' + grouped[name].length + '</td></tr>';
    }).join('');
  }

  function renderCoordCharts(docentesMap, completion) {
    if (typeof window.Chart === 'undefined') return;
    var racCodes = ['RAC1', 'RAC2', 'RAC3', 'RAC4', 'RAC5', 'RAC6', 'RAC7', 'RAC8'];
    var subjectRacCounter = {};
    var subjectCounter = {};
    // Una asignatura puede tener varias configuraciones (p. ej. MEDIO y FIN de ciclo).
    // El aporte a RAC es de la ASIGNATURA en general: se unen los RAAU de TODAS sus
    // configuraciones y se cuenta cada RAAU una sola vez (por su id), de modo que la
    // misma RAAU repetida en dos ciclos NO se cuente doble.
    var raauBySubject = {};
    completion.forEach(function (item) {
      var cfg = item.cfg || {};
      var subject = (cfg.courseConfig && cfg.courseConfig.asignatura) || 'Sin asignatura';
      if (!raauBySubject[subject]) raauBySubject[subject] = {};
      (cfg.raauEntries || []).forEach(function (r) {
        var raauKey = r.id || (String(r.code || '') + '|' + String(r.racId || ''));
        raauBySubject[subject][raauKey] = r.racId;
      });
    });
    Object.keys(raauBySubject).forEach(function (subject) {
      Object.keys(raauBySubject[subject]).forEach(function (raauKey) {
        var racId = raauBySubject[subject][raauKey];
        var racObj = rt.CAREER_RACS.find(function (rac) { return rac.id === racId || rac.code === racId; });
        var racCode = racObj ? racObj.code : (String(racId || '').toUpperCase());
        if (racCodes.indexOf(racCode) === -1) racCodes.push(racCode);
        if (!subjectRacCounter[subject]) subjectRacCounter[subject] = {};
        if (subjectRacCounter[subject][racCode] == null) subjectRacCounter[subject][racCode] = 0;
        subjectRacCounter[subject][racCode]++;
        if (!subjectCounter[subject]) subjectCounter[subject] = 0;
        subjectCounter[subject]++;
      });
    });
    var topSubjects = Object.keys(subjectCounter).sort(function (a, b) { return subjectCounter[b] - subjectCounter[a]; }).slice(0, 6);
    var palette = ['#1d4ed8', '#2563eb', '#0284c7', '#0891b2', '#0d9488', '#16a34a', '#f59e0b', '#f97316'];
    var racDatasets = racCodes.map(function (racCode, index) {
      return {
        label: racCode,
        data: topSubjects.map(function (subject) {
          return (subjectRacCounter[subject] && subjectRacCounter[subject][racCode]) || 0;
        }),
        backgroundColor: palette[index % palette.length],
        borderRadius: 4
      };
    }).filter(function (dataset) {
      return dataset.data.some(function (v) { return v > 0; });
    });
    lastCoordDoc = {
      labels: topSubjects.length ? topSubjects.slice() : ['Sin datos'],
      datasets: topSubjects.length
        ? racDatasets.map(function (d) { return { label: d.label, data: d.data.slice(), backgroundColor: d.backgroundColor, borderRadius: d.borderRadius }; })
        : [{ label: 'Sin datos', data: [0], backgroundColor: '#cbd5e1' }]
    };
    var ctxDoc = document.getElementById('coord-chart-docentes');
    if (ctxDoc) {
      if (chartCoordDocentes) chartCoordDocentes.destroy();
      chartCoordDocentes = new window.Chart(ctxDoc, {
        type: 'bar',
        data: { labels: topSubjects.length ? topSubjects : ['Sin datos'], datasets: topSubjects.length ? racDatasets : [{ label: 'Sin datos', data: [0], backgroundColor: '#cbd5e1' }] },
        options: {
          plugins: { legend: { position: 'bottom' } },
          responsive: true,
          scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }
        }
      });
    }
    var overallTopSubjects = Object.keys(subjectCounter).sort(function (a, b) { return subjectCounter[b] - subjectCounter[a]; }).slice(0, 7);
    lastCoordCfg = {
      labels: overallTopSubjects.length ? overallTopSubjects.slice() : ['Sin datos'],
      data: overallTopSubjects.length ? overallTopSubjects.map(function (s) { return subjectCounter[s]; }) : [0]
    };
    var ctxCfg = document.getElementById('coord-chart-configs');
    if (ctxCfg) {
      if (chartCoordConfigs) chartCoordConfigs.destroy();
      chartCoordConfigs = new window.Chart(ctxCfg, {
        type: 'bar',
        data: {
          labels: overallTopSubjects.length ? overallTopSubjects : ['Sin datos'],
          datasets: [{
            label: 'Total de RAAU vinculados a RAC',
            data: overallTopSubjects.length ? overallTopSubjects.map(function (s) { return subjectCounter[s]; }) : [0],
            backgroundColor: '#22c55e',
            borderRadius: 8
          }]
        },
        options: {
          indexAxis: 'y',
          plugins: { legend: { display: false } },
          responsive: true,
          scales: { x: { beginAtZero: true } }
        }
      });
    }
  }
  // Configuración del gráfico de Coordinación en versión GRANDE (modal).
  function buildCoordBigConfig(key) {
    if (key === 'docentes') {
      return {
        type: 'bar',
        data: { labels: lastCoordDoc.labels, datasets: lastCoordDoc.datasets.map(function (d) { return { label: d.label, data: d.data.slice(), backgroundColor: d.backgroundColor, borderRadius: d.borderRadius }; }) },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } } }
      };
    }
    return {
      type: 'bar',
      data: { labels: lastCoordCfg.labels, datasets: [{ label: 'Total de RAAU vinculados a RAC', data: lastCoordCfg.data.slice(), backgroundColor: '#22c55e', borderRadius: 8 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }
    };
  }

  // Amplía un gráfico del Panel de Coordinación en el modal para verlo mejor.
  function expandCoordChart(key) {
    if (typeof window.Chart === 'undefined') return;
    var titles = { docentes: 'Aporte por asignatura a cada RAC', configs: 'Top asignaturas que más aportan RAC' };
    rt.fns.openModal(
      titles[key] || 'Gráfico',
      '<div class="chart-modal-body"><canvas id="coord-chart-expanded"></canvas></div>',
      [{ cls: 'btn-secondary', label: 'Cerrar', action: 'close' }]
    );
    if (expandedCoordChart) { expandedCoordChart.destroy(); expandedCoordChart = null; }
    var ctx = document.getElementById('coord-chart-expanded');
    if (ctx) expandedCoordChart = new window.Chart(ctx, buildCoordBigConfig(key));
  }

  function coordLoadSubjects() {
    var career = document.getElementById('coord-career').value;
    var subject = document.getElementById('coord-subject');
    if (!subject) return;
    subject.innerHTML = '<option value="">Seleccione asignatura</option>';
    if (!career || !rt.DB_ESPOCH[career]) return;
    Object.keys(rt.DB_ESPOCH[career].malla || {}).forEach(function (paoKey) {
      (rt.DB_ESPOCH[career].malla[paoKey] || []).forEach(function (mat) {
        subject.innerHTML += '<option value="' + mat + '">' + paoKey + ' · ' + mat + '</option>';
      });
    });
  }

  function coordLoadSubjectsAssignment() {
    var career = document.getElementById('coord-career-assignment').value;
    var paoSelect = document.getElementById('coord-pao-assignment');
    var subject = document.getElementById('coord-subject-assignment');
    if (!paoSelect || !subject) return;
    paoSelect.innerHTML = '<option value="">Seleccione PAO</option>';
    subject.innerHTML = '<option value="">Seleccione asignatura</option>';
    if (!career || !rt.DB_ESPOCH[career]) return;
    Object.keys(rt.DB_ESPOCH[career].malla || {}).forEach(function (paoKey) {
      paoSelect.innerHTML += '<option value="' + paoKey + '">' + paoKey + '</option>';
    });
    paoSelect.onchange = function () {
      subject.innerHTML = '<option value="">Seleccione asignatura</option>';
      (rt.DB_ESPOCH[career].malla[paoSelect.value] || []).forEach(function (mat) {
        subject.innerHTML += '<option value="' + mat + '">' + mat + '</option>';
      });
    };
  }

  function coordCreateAssignment() {
    var docEmail = document.getElementById('coord-doc-email').value;
    var career = document.getElementById('coord-career-assignment').value;
    var pao = document.getElementById('coord-pao-assignment').value;
    var subject = document.getElementById('coord-subject-assignment').value;
    if (!docEmail || !career || !pao || !subject) {
      rt.fns.showToast('Complete docente, carrera, PAO y asignatura.', 'error');
      return;
    }
    var docente = rt.fns.findUserByEmail(docEmail);
    var mapped = (rt.DB_ESPOCH[career].asignaturas[subject] && rt.DB_ESPOCH[career].asignaturas[subject].raau) || [];
    var racIds = [];
    mapped.forEach(function (m) { if (racIds.indexOf(m.racId) === -1) racIds.push(m.racId); });
    rt.STATE.teacherAssignments.unshift({
      id: 'asg_' + Date.now(),
      docenteEmail: docEmail,
      docenteNombre: docente ? docente.name : docEmail,
      carrera: career,
      pao: pao,
      asignatura: subject,
      racs: racIds.slice(),
      raau: JSON.parse(JSON.stringify(mapped))
    });
    var snapshot = {
      id: 'cfg_' + Date.now(),
      savedAt: new Date().toLocaleString(),
      ownerEmail: docEmail,
      courseConfig: { periodoAcademico: '', facultad: 'SEDE ORELLANA', carrera: career, asignatura: subject, docente: docente ? docente.name : docEmail, pao: pao, aporte: 'FIN DE CICLO' },
      selectedRACIds: racIds.slice(),
      raauEntries: mapped.map(function (r, i) { return { id: 'raau_auto_' + i + '_' + Date.now(), code: r.code, description: r.description, racId: r.racId }; }),
      activities: []
    };
    rt.fns.enrichConfigVectors(snapshot);
    rt.STATE.savedConfigs.unshift(snapshot);
    rt.fns.save();
    renderCoordinacion();
    rt.fns.showToast('Docente asignado con configuración propia.', 'success');
  }

  function coordAddDocente() {
    rt.fns.openModal('Nuevo Docente', '<div class="form-grid"><div class="form-group"><label class="form-label">Nombre</label><input class="form-input" id="coord-new-doc-name" placeholder="Ej: Prof. Luis Ramos"></div><div class="form-group"><label class="form-label">Correo</label><input class="form-input" id="coord-new-doc-email" placeholder="lramos@espoch.edu.ec"></div></div><div class="form-group"><label class="form-label">Contraseña (la asigna el coordinador)</label><input class="form-input" id="coord-new-doc-pass" placeholder="Clave para el docente"></div>',
      [{ label: 'Cancelar', cls: 'btn-ghost', action: 'close' }, { label: 'Crear', cls: 'btn-success', action: function () {
        var name = document.getElementById('coord-new-doc-name').value.trim();
        var email = document.getElementById('coord-new-doc-email').value.trim().toLowerCase();
        var pass = document.getElementById('coord-new-doc-pass').value.trim();
        if (!name || !email || !pass) { rt.fns.showToast('Complete nombre, correo y contraseña.', 'error'); return; }
        if (rt.fns.findUserByEmail(email)) { rt.fns.showToast('Ya existe un usuario con ese correo.', 'error'); return; }
        rt.STATE.docentes.push({ email: email, password: pass, role: 'docente', name: name, cedula: '' });
        rt.fns.save();
        rt.fns.closeModal();
        renderCoordinacion('asignaturas');
        rt.fns.showToast('Docente creado correctamente.', 'success');
      }}]);
    var newPassInput = document.getElementById('coord-new-doc-pass');
    if (newPassInput) {
      newPassInput.outerHTML =
        '<input class="form-input" id="coord-new-doc-pass" type="password" autocomplete="new-password" placeholder="Clave para el docente" style="margin-bottom:8px">' +
        '<label class="form-label">Confirmar contrasena</label><input class="form-input" id="coord-new-doc-pass-confirm" type="password" autocomplete="new-password">' +
        rt.fns.passwordHelpHtml();
    }
    (window._modalActions || []).forEach(function (action) {
      if (!action || action.label !== 'Crear' || action.cls !== 'btn-success') return;
      action.action = function () {
        var name = document.getElementById('coord-new-doc-name').value.trim();
        var email = document.getElementById('coord-new-doc-email').value.trim().toLowerCase();
        var pass = document.getElementById('coord-new-doc-pass').value.trim();
        var confirm = document.getElementById('coord-new-doc-pass-confirm').value.trim();
        if (!name || !email || !pass || !confirm) { rt.fns.showToast('Complete nombre, correo, clave y confirmacion.', 'error'); return; }
        var validation = rt.fns.validatePasswordForm(pass, confirm);
        if (validation) { rt.fns.showToast(validation, 'error'); return; }
        if (rt.fns.findUserByEmail(email)) { rt.fns.showToast('Ya existe un usuario con ese correo.', 'error'); return; }
        rt.STATE.docentes.push({ email: email, password: pass, role: 'docente', name: name, cedula: '' });
        rt.fns.save();
        rt.fns.closeModal();
        renderCoordinacion('asignaturas');
        rt.fns.showToast('Docente creado correctamente.', 'success');
      };
    });
  }

  function coordAddAsignatura() {
    var careerOptions = Object.keys(rt.DB_ESPOCH).map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
    rt.fns.openModal('Nueva Asignatura', '<div class="form-grid"><div class="form-group"><label class="form-label">Carrera</label><select class="form-select" id="coord-new-sub-career"><option value="">Seleccione carrera</option>' + careerOptions + '</select></div><div class="form-group"><label class="form-label">PAO</label><input class="form-input" id="coord-new-sub-pao" placeholder="Ej: 5 o NIVELACIÓN"></div></div><div class="form-group"><label class="form-label">Nombre Asignatura</label><input class="form-input" id="coord-new-sub-name" placeholder="Ej: ARQUITECTURA DE SOFTWARE"></div>',
      [{ label: 'Cancelar', cls: 'btn-ghost', action: 'close' }, { label: 'Crear', cls: 'btn-success', action: function () {
        var career = document.getElementById('coord-new-sub-career').value;
        var pao = document.getElementById('coord-new-sub-pao').value.trim();
        var name = document.getElementById('coord-new-sub-name').value.trim();
        if (!career || !pao || !name) return;
        if (!rt.DB_ESPOCH[career].malla[pao]) rt.DB_ESPOCH[career].malla[pao] = [];
        if (rt.DB_ESPOCH[career].malla[pao].indexOf(name) === -1) rt.DB_ESPOCH[career].malla[pao].push(name);
        if (!rt.DB_ESPOCH[career].asignaturas[name]) rt.DB_ESPOCH[career].asignaturas[name] = { raau: [] };
        rt.fns.saveVectorCatalogSoon();
        rt.fns.closeModal();
        renderCoordinacion('asignaturas');
        rt.fns.showToast('Asignatura creada en la malla.', 'success');
      }}]);
  }

  function coordImportDocentes() {
    var careerOptions = Object.keys(rt.DB_ESPOCH).map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
    rt.fns.openModal('Importar docentes desde OASIS',
      '<p style="color:var(--gray-600);font-size:.8rem;margin-bottom:12px">Trae los docentes que dictan en la carrera con sus <strong>cargas horarias</strong> (materia · nivel · paralelo) desde OASIS y les crea un perfil de acceso.</p>' +
      '<div class="form-group"><label class="form-label">Carrera</label><select class="form-select" id="coord-import-career"><option value="">Seleccione carrera</option>' + careerOptions + '</select></div>' +
      '<div id="coord-import-msg" style="font-size:.78rem;color:var(--gray-500);min-height:18px"></div>',
      [
        { label: 'Cancelar', cls: 'btn-ghost', action: 'close' },
        { label: 'Importar', cls: 'btn-success', action: doCoordImportDocentes }
      ]);
  }

  async function doCoordImportDocentes() {
    var sel = document.getElementById('coord-import-career');
    var career = sel ? sel.value : '';
    var msg = document.getElementById('coord-import-msg');
    var setMsg = function (t, e) { if (msg) { msg.textContent = t; msg.style.color = e ? 'var(--red)' : 'var(--gray-500)'; } };
    if (!career) { setMsg('Seleccione una carrera.', true); return; }
    setMsg('Consultando docentes y cargas horarias en OASIS… (puede tardar unos segundos)', false);
    try {
      var res = await oasis.getDocentesCarrera({ carrera: career, facultad: 'SEDE ORELLANA' });
      var docentes = (res && res.docentes) || [];
      var codCarrera = (res && res.codCarrera) || '';
      var codPeriodo = (rt.STATE.oasisPeriodo && rt.STATE.oasisPeriodo.codigo) || '';
      if (!docentes.length) { setMsg('OASIS no devolvió docentes para esta carrera.', true); return; }
      var nuevosDoc = 0, nuevasCargas = 0, actualizadas = 0, omitidos = 0;
      // Clave normalizada (sin tildes/espacios extra/mayúsculas) para identificar
      // la MISMA carga aunque OASIS o el catálogo varíen acentos o capitalización.
      // Así re-importar ACTUALIZA en lugar de duplicar.
      var normKey = function (parts) {
        return parts.map(function (v) {
          return String(v == null ? '' : v)
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/\s+/g, ' ').trim().toUpperCase();
        }).join('|');
      };
      // Índice por clave; de paso descarta duplicados que ya estuvieran guardados.
      var byKey = {};
      rt.STATE.teacherAssignments = (rt.STATE.teacherAssignments || []).filter(function (a) {
        var k = normKey([a.docenteEmail, a.carrera, a.asignatura, a.pao, a.paralelo]);
        if (byKey[k]) return false;
        byKey[k] = a;
        return true;
      });
      docentes.forEach(function (d) {
        var nombre = ((d.nombres || '') + ' ' + (d.apellidos || '')).trim() || d.cedula;
        var cedNum = String(d.cedula || '').replace(/[^0-9kK]/g, '');
        var email = (d.email && /@/.test(d.email) && !/^null$/i.test(d.email)) ? d.email.toLowerCase() : (cedNum + '@espoch.edu.ec');
        if (rt.fns.isDocenteExcluded(email, d.cedula)) {
          omitidos++;
          return;
        }
        var existente = rt.fns.findUserByEmail(email);
        if (!existente) {
          // Sin contraseña: el coordinador debe asignarla antes de que el docente ingrese.
          rt.STATE.docentes.push({ email: email, password: '', role: 'docente', name: nombre, cedula: d.cedula });
          nuevosDoc++;
        }
        (d.cargas || []).forEach(function (carga) {
          var k = normKey([email, career, carga.materia, carga.codNivel, carga.paralelo]);
          var prev = byKey[k];
          if (prev) {
            // Misma carga: actualiza códigos/nombre OASIS sin crear otra fila.
            prev.docenteNombre = nombre;
            prev.cedula = d.cedula;
            prev.codCarrera = codCarrera;
            prev.codMateria = carga.codMateria;
            prev.codNivel = carga.codNivel;
            prev.codPeriodo = codPeriodo;
            prev.source = 'oasis';
            actualizadas++;
            return;
          }
          var nueva = {
            id: 'asg_' + Date.now() + Math.random().toString(36).slice(2, 6),
            docenteEmail: email,
            docenteNombre: nombre,
            cedula: d.cedula,
            carrera: career,
            pao: carga.codNivel,
            paralelo: carga.paralelo,
            asignatura: carga.materia,
            // Códigos OASIS para importar la nómina exacta sin re-resolver.
            codCarrera: codCarrera,
            codMateria: carga.codMateria,
            codNivel: carga.codNivel,
            codPeriodo: codPeriodo,
            racs: [],
            raau: [],
            source: 'oasis'
          };
          byKey[k] = nueva;
          rt.STATE.teacherAssignments.unshift(nueva);
          nuevasCargas++;
        });
      });
      rt.fns.save();
      rt.fns.closeModal();
      renderCoordinacion('asignaturas');
      if (omitidos) rt.fns.showToast(omitidos + ' docentes omitidos por lista de exclusion.', 'success');
      rt.fns.showToast(nuevosDoc + ' docentes nuevos · ' + nuevasCargas + ' cargas nuevas · ' + actualizadas + ' actualizadas', 'success');
    } catch (err) {
      setMsg((err && err.offline) ? 'OASIS/BFF no disponible.' : ((err && err.message) || 'Error al importar docentes.'), true);
    }
  }

  function coordRenderDocentesList() {
    var target = document.getElementById('coord-docentes-list');
    if (!target) return;
    // El coordinador también es docente: aparece en la lista (marcado).
    var docentes = [COORDINADOR].concat(rt.fns.getDocentes());
    var omitted = rt.fns.getExcludedDocentes();
    target.innerHTML = '<div style="font-size:.78rem;font-weight:700;color:var(--gray-800);margin:8px 0">Docentes registrados (' + docentes.length + ')</div>' +
      (docentes.map(function (d) {
        var asigs = (rt.STATE.teacherAssignments || []).filter(function (a) { return a.docenteEmail === d.email; });
        var asigHtml = asigs.length
          ? asigs.map(function (a) { return '<span class="tag-pao" style="background:var(--blue);margin:2px 4px 2px 0;display:inline-block">' + a.asignatura + ' · N' + a.pao + ' P' + a.paralelo + '</span>'; }).join('')
          : '<span style="font-size:.7rem;color:var(--gray-400)">Sin asignaturas</span>';
        var esCoord = d.role === 'coordinador' || d.rol === 'coordinador';
        var rolTag = esCoord ? '<span class="badge badge-blue">Coordinador</span> ' : '';
        // El coordinador siempre tiene clave (sembrada en Neon). Para docentes,
        // d.hasPassword viene del backend (existe password_hash) aunque la clave
        // en claro no se envíe al cliente.
        var tieneClave = Boolean(d.password) || Boolean(d.hasPassword) || esCoord;
        var claveBadge = tieneClave
          ? '<span class="badge badge-green">Con clave</span>'
          : '<span class="badge badge-amber">Sin clave</span>';
        var omitButton = esCoord ? '' : '<button class="btn btn-danger btn-sm" onclick="coordOmitDocente(' + jsStringArg(d.email) + ')">Omitir</button>';
        return '<div class="item-row" style="align-items:flex-start;flex-wrap:wrap">' +
          '<div style="font-size:.8rem;flex:1;min-width:220px"><strong>' + d.name + '</strong> ' + rolTag + claveBadge +
          '<div style="font-size:.7rem;color:var(--gray-500)">' + d.email + (d.cedula ? ' · ' + d.cedula : '') + '</div>' +
          '<div style="margin-top:6px">' + asigHtml + '</div></div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
          omitButton +
          '<button class="btn btn-ghost btn-sm" onclick="coordVerHorario(\'' + d.email + '\')">Ver horario</button>' +
          '<button class="btn btn-edit btn-sm" onclick="coordSetDocentePassword(\'' + d.email + '\')">Asignar contraseña</button>' +
          '</div></div>';
      }).join(''));
    if (omitted.length) {
      target.innerHTML += '<div style="font-size:.78rem;font-weight:700;color:var(--gray-800);margin:14px 0 8px">Docentes omitidos (' + omitted.length + ')</div>' +
        omitted.map(function (d) {
          var nombre = d.name || d.nombre || d.nombres || d.email || d.cedula || 'Docente';
          var detalle = [d.email, d.cedula, d.motivo ? ('Motivo: ' + d.motivo) : ''].filter(Boolean).join(' - ');
          return '<div class="item-row" style="align-items:flex-start;flex-wrap:wrap;background:var(--red-bg)">' +
            '<div style="font-size:.8rem;flex:1;min-width:220px"><strong>' + escapeHtml(nombre) + '</strong> <span class="badge badge-red">Omitido</span>' +
            '<div style="font-size:.7rem;color:var(--gray-500)">' + escapeHtml(detalle) + '</div>' +
            '<div style="font-size:.68rem;color:var(--gray-500);margin-top:4px">No se importara desde OASIS ni podra iniciar sesion mientras este omitido.</div></div>' +
            '<button class="btn btn-edit btn-sm" onclick="coordRestoreDocente(' + jsStringArg(d.id) + ')">Restaurar</button>' +
            '</div>';
        }).join('');
    }
  }

  // ---- Horario de clases del docente ----
  function renderHorarioGrid(clases) {
    if (Array.isArray(clases)) return renderHorarioGridV2(clases);
    if (!clases || !clases.length) {
      return '<div style="font-size:.82rem;color:var(--gray-500)">Sin horario registrado en OASIS para este período.</div>';
    }
    var diasDef = [['LUN', 'Lunes'], ['MAR', 'Martes'], ['MIE', 'Miércoles'], ['JUE', 'Jueves'], ['VIE', 'Viernes'], ['SAB', 'Sábado'], ['DOM', 'Domingo']];
    var present = {};
    clases.forEach(function (c) { present[c.codDia] = true; });
    var cols = diasDef.filter(function (d) { return present[d[0]]; });
    if (!cols.length) cols = diasDef.slice(0, 5);
    var toMin = function (t) { var p = String(t || '').split(':'); return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0); };
    var slots = [];
    clases.forEach(function (c) { var k = c.inicio + ' - ' + c.fin; if (slots.indexOf(k) === -1) slots.push(k); });
    slots.sort(function (a, b) { return toMin(a.split(' - ')[0]) - toMin(b.split(' - ')[0]); });
    var byKey = {};
    clases.forEach(function (c) { byKey[(c.inicio + ' - ' + c.fin) + '|' + c.codDia] = c.materia; });
    var head = '<tr><th>Hora</th>' + cols.map(function (d) { return '<th>' + d[1] + '</th>'; }).join('') + '</tr>';
    var body = slots.map(function (s) {
      return '<tr><td style="font-family:var(--mono);white-space:nowrap;font-weight:600">' + s + '</td>' +
        cols.map(function (d) {
          var m = byKey[s + '|' + d[0]];
          return '<td style="text-align:center">' + (m ? '<span class="comp-pill" style="background:var(--blue-bg);color:#1d4ed8;white-space:normal">' + m + '</span>' : '') + '</td>';
        }).join('') + '</tr>';
    }).join('');
    return '<div style="overflow-x:auto"><table class="data" style="font-size:.74rem;min-width:520px"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
  }

  function renderHorarioGridV2(clases) {
    if (!clases || !clases.length) {
      return '<div class="horario-empty">Sin horario registrado en OASIS para este periodo.</div>';
    }
    var diasDef = [['LUN', 'Lunes'], ['MAR', 'Martes'], ['MIE', 'Miercoles'], ['JUE', 'Jueves'], ['VIE', 'Viernes'], ['SAB', 'Sabado'], ['DOM', 'Domingo']];
    var dayKey = function (c) { return String((c && (c.codDia || c.dia)) || '').trim().slice(0, 3).toUpperCase(); };
    var fmtHour = function (t) { return String(t || '').trim().slice(0, 5); };
    var toMin = function (t) { var p = String(t || '').split(':'); return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0); };
    var present = {};
    var subjects = {};
    clases.forEach(function (c) {
      var dk = dayKey(c);
      if (dk) present[dk] = true;
      if (c && c.materia) subjects[c.materia] = true;
    });
    var cols = diasDef.filter(function (d) { return present[d[0]]; });
    if (!cols.length) cols = diasDef.slice(0, 5);
    var slots = [];
    clases.forEach(function (c) {
      var k = fmtHour(c.inicio) + ' - ' + fmtHour(c.fin);
      if (k.trim() !== '-' && slots.indexOf(k) === -1) slots.push(k);
    });
    slots.sort(function (a, b) { return toMin(a.split(' - ')[0]) - toMin(b.split(' - ')[0]); });
    var byKey = {};
    clases.forEach(function (c) {
      var k = fmtHour(c.inicio) + ' - ' + fmtHour(c.fin) + '|' + dayKey(c);
      if (!byKey[k]) byKey[k] = [];
      byKey[k].push(c);
    });
    var firstHour = slots.length ? slots[0].split(' - ')[0] : '';
    var lastHour = slots.length ? slots[slots.length - 1].split(' - ')[1] : '';
    var summary =
      '<div class="horario-summary">' +
      '<div><strong>' + clases.length + '</strong><span>clases</span></div>' +
      '<div><strong>' + cols.length + '</strong><span>dias</span></div>' +
      '<div><strong>' + Object.keys(subjects).length + '</strong><span>materias</span></div>' +
      '<div><strong>' + escapeHtml(firstHour + (lastHour ? ' - ' + lastHour : '')) + '</strong><span>rango</span></div>' +
      '</div>';
    var head = '<tr><th class="horario-hour-head">Hora</th>' + cols.map(function (d) { return '<th>' + d[1] + '</th>'; }).join('') + '</tr>';
    var body = slots.map(function (s) {
      return '<tr><td class="horario-hour">' + escapeHtml(s) + '</td>' +
        cols.map(function (d) {
          var items = byKey[s + '|' + d[0]] || [];
          if (!items.length) return '<td class="horario-empty-cell"></td>';
          return '<td>' + items.map(function (item) {
            var materia = item.materia || 'Clase';
            var detalle = [item.aula || item.paralelo || '', item.docente || ''].filter(Boolean).join(' - ');
            return '<div class="horario-class-chip"><div>' + escapeHtml(materia) + '</div>' +
              (detalle ? '<small>' + escapeHtml(detalle) + '</small>' : '') + '</div>';
          }).join('') + '</td>';
        }).join('') + '</tr>';
    }).join('');
    return '<div class="horario-shell">' + summary +
      '<div class="horario-table-wrap"><table class="horario-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
      '<div class="horario-note">Horario consultado desde OASIS. Las celdas vacias indican que no hay clase registrada en ese bloque.</div>' +
      '</div>';
  }

  function showHorarioModal(nombre, clases) {
    rt.fns.openModal('Horario de clases — ' + nombre, renderHorarioGrid(clases), [{ label: 'Cerrar', cls: 'btn-ghost', action: 'close' }]);
    var m = document.querySelector('#modal-overlay .modal');
    if (m) m.style.maxWidth = '780px';
  }

  async function verHorario(nombre, cedula, asgList) {
    if (!cedula) { rt.fns.showToast('Este docente no tiene cédula registrada para consultar el horario.', 'error'); return; }
    var a0 = (asgList && asgList[0]) || {};
    if (!a0.codCarrera && !a0.carrera) { rt.fns.showToast('Sin asignaturas para determinar la carrera del horario.', 'error'); return; }
    rt.fns.showToast('Consultando horario en OASIS…', 'success');
    try {
      var res = await oasis.getHorarioDocente({
        codCarrera: a0.codCarrera || '', carrera: a0.carrera || '', facultad: 'SEDE ORELLANA',
        cedula: cedula, codPeriodo: (rt.STATE.oasisPeriodo && rt.STATE.oasisPeriodo.codigo) || a0.codPeriodo || ''
      });
      showHorarioModal(nombre, res.clases);
    } catch (err) {
      rt.fns.showToast((err && err.offline) ? 'OASIS/BFF no disponible.' : ((err && err.message) || 'No se pudo obtener el horario.'), 'error');
    }
  }

  function coordVerHorario(email) {
    var d = rt.fns.findUserByEmail(email);
    if (!d) return;
    var asg = (rt.STATE.teacherAssignments || []).filter(function (a) { return a.docenteEmail === email; });
    verHorario(d.name, d.cedula || (asg[0] && asg[0].cedula) || '', asg);
  }

  function coordOmitDocente(email) {
    var normalized = normalizeEmail(email);
    if (!normalized || normalized === normalizeEmail(COORDINADOR.email)) {
      rt.fns.showToast('No se puede omitir al coordinador.', 'error');
      return;
    }
    var d = (rt.STATE.docentes || []).find(function (item) { return normalizeEmail(item.email) === normalized; });
    var asg = (rt.STATE.teacherAssignments || []).filter(function (a) { return normalizeEmail(a.docenteEmail) === normalized; });
    if (!d && !asg.length) { rt.fns.showToast('No se encontro el docente.', 'error'); return; }
    var cedula = (d && d.cedula) || (asg[0] && asg[0].cedula) || '';
    var nombre = (d && (d.name || d.nombre)) || (asg[0] && asg[0].docenteNombre) || normalized;
    rt.fns.openModal('Omitir docente',
      '<p style="font-size:.82rem;color:var(--gray-600);margin-bottom:10px">El docente <strong>' + escapeHtml(nombre) + '</strong> se quitara de las cargas activas y se ignorara en futuras importaciones desde OASIS.</p>' +
      '<div class="form-group"><label class="form-label">Motivo (opcional)</label><input class="form-input" id="coord-omit-reason" placeholder="Ej. ya no labora en la institucion"></div>',
      [
        { label: 'Cancelar', cls: 'btn-ghost', action: 'close' },
        { label: 'Omitir', cls: 'btn-danger', action: function () {
          var reasonEl = document.getElementById('coord-omit-reason');
          var motivo = reasonEl ? reasonEl.value.trim() : '';
          var ex = { id: rt.fns.exclusionIdFor(normalized, cedula), email: normalized, cedula: normalizeDocId(cedula), name: nombre, nombre: nombre, motivo: motivo };
          var found = false;
          rt.STATE.excludedDocentes = rt.fns.getExcludedDocentes().map(function (item) {
            if (rt.fns.docenteMatchesExclusion(normalized, cedula, item)) {
              found = true;
              return Object.assign({}, item, ex);
            }
            return item;
          });
          if (!found) rt.STATE.excludedDocentes.push(ex);
          rt.STATE.docentes = (rt.STATE.docentes || []).filter(function (item) { return !rt.fns.docenteMatchesExclusion(item.email, item.cedula, ex); });
          rt.STATE.teacherAssignments = (rt.STATE.teacherAssignments || []).filter(function (item) { return !rt.fns.docenteMatchesExclusion(item.docenteEmail, item.cedula, ex); });
          rt.fns.save();
          rt.fns.closeModal();
          renderCoordinacion('asignaturas');
          rt.fns.showToast('Docente omitido. No se volvera a importar desde OASIS.', 'success');
        } }
      ]);
  }

  function coordRestoreDocente(id) {
    var targetId = String(id || '');
    var before = rt.fns.getExcludedDocentes().length;
    rt.STATE.excludedDocentes = rt.fns.getExcludedDocentes().filter(function (item) { return String(item.id || '') !== targetId; });
    if (rt.STATE.excludedDocentes.length === before) { rt.fns.showToast('No se encontro el registro omitido.', 'error'); return; }
    rt.fns.save();
    renderCoordinacion('asignaturas');
    rt.fns.showToast('Docente restaurado. Use Importar de OASIS para traer sus cargas nuevamente.', 'success');
  }

  function coordSetDocentePassword(email) {
    var d = rt.fns.findUserByEmail(email);
    if (!d) return;
    rt.fns.openModal('Asignar contraseña — ' + d.name,
      '<p style="color:var(--gray-600);font-size:.8rem;margin-bottom:10px">El docente ingresará con <strong>' + d.email + '</strong> y esta contraseña.</p>' +
      '<div class="form-group"><label class="form-label">Nueva contraseña</label><input class="form-input" id="coord-set-pass" type="text" placeholder="Contraseña para el docente"></div>',
      [{ label: 'Cancelar', cls: 'btn-ghost', action: 'close' }, { label: 'Guardar', cls: 'btn-success', action: function () {
        var pass = document.getElementById('coord-set-pass').value.trim();
        if (!pass) { rt.fns.showToast('Ingrese una contraseña.', 'error'); return; }
        d.password = pass;
        rt.fns.save();
        rt.fns.closeModal();
        renderCoordinacion('asignaturas');
        rt.fns.showToast('Contraseña asignada a ' + d.name, 'success');
      }}]);
    var setPassInput = document.getElementById('coord-set-pass');
    if (setPassInput) {
      setPassInput.outerHTML =
        '<input class="form-input" id="coord-set-pass" type="password" autocomplete="new-password" placeholder="Contrasena para el docente" style="margin-bottom:8px">' +
        '<label class="form-label">Confirmar contrasena</label><input class="form-input" id="coord-set-pass-confirm" type="password" autocomplete="new-password">' +
        rt.fns.passwordHelpHtml();
    }
    (window._modalActions || []).forEach(function (action) {
      if (!action || action.label !== 'Guardar' || action.cls !== 'btn-success') return;
      action.action = function () {
        var pass = document.getElementById('coord-set-pass').value.trim();
        var confirm = document.getElementById('coord-set-pass-confirm').value.trim();
        if (!pass || !confirm) { rt.fns.showToast('Ingrese y confirme la contrasena.', 'error'); return; }
        var validation = rt.fns.validatePasswordForm(pass, confirm);
        if (validation) { rt.fns.showToast(validation, 'error'); return; }
        d.password = pass;
        rt.fns.save();
        rt.fns.closeModal();
        renderCoordinacion('asignaturas');
        rt.fns.showToast('Contrasena asignada a ' + d.name, 'success');
      };
    });
  }

  function coordManualRAC() {
    var careerEl = document.getElementById('coord-career-assignment') || document.getElementById('coord-career-rac');
    var career = careerEl ? careerEl.value : '';
    if (!career) { rt.fns.showToast('Seleccione carrera.', 'error'); return; }
    rt.fns.openModal('Agregar RAC manual', '<div class="form-grid"><div class="form-group"><label class="form-label">Código</label><input class="form-input" id="coord-rac-code" placeholder="RAC6"></div><div class="form-group"><label class="form-label">Descripción</label><input class="form-input" id="coord-rac-desc" placeholder="Descripción del RAC"></div></div>',
      [{ label: 'Cancelar', cls: 'btn-ghost', action: 'close' }, { label: 'Agregar', cls: 'btn-success', action: function () {
        var code = document.getElementById('coord-rac-code').value.trim();
        var desc = document.getElementById('coord-rac-desc').value.trim();
        if (!code || !desc) return;
        rt.DB_ESPOCH[career].racs.push({ id: 'rac_manual_' + Date.now(), code: code, description: desc });
        rt.fns.saveVectorCatalogSoon();
        coordRenderRACList();
        rt.fns.closeModal(); rt.fns.showToast('RAC agregado.', 'success');
      }}]);
  }

  function coordRenderRACList() {
    var careerEl = document.getElementById('coord-career-rac');
    var target = document.getElementById('coord-rac-list');
    if (!careerEl || !target) return;
    var career = careerEl.value;
    if (!career || !rt.DB_ESPOCH[career]) {
      target.innerHTML = 'Seleccione carrera para listar RAC.';
      return;
    }
    var racs = rt.DB_ESPOCH[career].racs || [];
    if (racs.length === 0) {
      target.innerHTML = 'No existen RAC para esta carrera.';
      return;
    }
    target.innerHTML = racs.map(function (r) {
      return '<div class="item-row"><div style="min-width:70px;font-weight:700;color:var(--gray-800)">' + r.code + '</div><div style="font-size:.8rem;color:var(--gray-600);flex:1">' + r.description + '</div><button class="btn btn-sm btn-ghost" onclick="coordEditRAC(\'' + career + '\',\'' + r.id + '\')">Editar</button><button class="btn btn-sm btn-danger" onclick="coordDeleteRAC(\'' + career + '\',\'' + r.id + '\')">Eliminar</button></div>';
    }).join('');
  }

  function coordEditRAC(career, racId) {
    var rac = (rt.DB_ESPOCH[career].racs || []).find(function (r) { return r.id === racId; });
    if (!rac) return;
    rt.fns.openModal('Editar RAC', '<div class="form-grid"><div class="form-group"><label class="form-label">Código</label><input class="form-input" id="coord-edit-rac-code" value="' + rac.code + '"></div><div class="form-group"><label class="form-label">Descripción</label><input class="form-input" id="coord-edit-rac-desc" value="' + rac.description + '"></div></div>',
      [{ label: 'Cancelar', cls: 'btn-ghost', action: 'close' }, { label: 'Guardar', cls: 'btn-success', action: function () {
        rac.code = document.getElementById('coord-edit-rac-code').value.trim();
        rac.description = document.getElementById('coord-edit-rac-desc').value.trim();
        rt.fns.saveVectorCatalogSoon();
        coordRenderRACList(); rt.fns.closeModal();
      }}]);
  }

  function coordDeleteRAC(career, racId) {
    rt.DB_ESPOCH[career].racs = (rt.DB_ESPOCH[career].racs || []).filter(function (r) { return r.id !== racId; });
    Object.keys(rt.DB_ESPOCH[career].asignaturas || {}).forEach(function (subject) {
      var arr = rt.DB_ESPOCH[career].asignaturas[subject].raau || [];
      rt.DB_ESPOCH[career].asignaturas[subject].raau = arr.filter(function (r) { return r.racId !== racId; });
    });
    rt.fns.saveVectorCatalogSoon();
    coordRenderRACList();
  }

  function coordManualRAAU() {
    var careerEl = document.getElementById('coord-career-assignment') || document.getElementById('coord-career');
    var subjectEl = document.getElementById('coord-subject-assignment') || document.getElementById('coord-subject');
    var career = careerEl ? careerEl.value : '';
    var subject = subjectEl ? subjectEl.value : '';
    if (!career || !subject) { rt.fns.showToast('Seleccione carrera y asignatura.', 'error'); return; }
    var racOptions = (rt.DB_ESPOCH[career].racs || []).map(function (r) { return '<option value="' + r.id + '">' + r.code + '</option>'; }).join('');
    rt.fns.openModal('Agregar RAAU manual', '<div class="form-grid"><div class="form-group"><label class="form-label">Código</label><input class="form-input" id="coord-raau-code" placeholder="RAAU1"></div><div class="form-group"><label class="form-label">RAC</label><select class="form-select" id="coord-raau-rac">' + racOptions + '</select></div></div><div class="form-group"><label class="form-label">Descripción</label><textarea class="form-input" id="coord-raau-desc"></textarea></div>',
      [{ label: 'Cancelar', cls: 'btn-ghost', action: 'close' }, { label: 'Agregar', cls: 'btn-success', action: function () {
        var code = document.getElementById('coord-raau-code').value.trim();
        var desc = document.getElementById('coord-raau-desc').value.trim();
        var racId = document.getElementById('coord-raau-rac').value;
        if (!code || !desc || !racId) return;
        if (!rt.DB_ESPOCH[career].asignaturas[subject]) rt.DB_ESPOCH[career].asignaturas[subject] = { raau: [] };
        rt.DB_ESPOCH[career].asignaturas[subject].raau.push({ code: code, description: desc, racId: racId });
        rt.fns.saveVectorCatalogSoon();
        coordRenderRAAUList();
        rt.fns.closeModal(); rt.fns.showToast('RAAU agregado.', 'success');
      }}]);
  }

  function coordRenderRAAUList() {
    var careerEl = document.getElementById('coord-career');
    var subjectEl = document.getElementById('coord-subject');
    var target = document.getElementById('coord-raau-list');
    if (!careerEl || !subjectEl || !target) return;
    var career = careerEl.value;
    var subject = subjectEl.value;
    if (!career || !subject || !rt.DB_ESPOCH[career] || !rt.DB_ESPOCH[career].asignaturas[subject]) {
      target.innerHTML = '<div style="font-size:.8rem;color:var(--gray-500)">Seleccione carrera y asignatura.</div>';
      return;
    }
    var raauArr = rt.DB_ESPOCH[career].asignaturas[subject].raau || [];
    if (raauArr.length === 0) {
      target.innerHTML = '<div style="font-size:.8rem;color:var(--gray-500)">No hay RAAU cargados.</div>';
      return;
    }
    target.innerHTML = raauArr.map(function (r, idx) {
      var rac = (rt.DB_ESPOCH[career].racs || []).find(function (x) { return x.id === r.racId; });
      return '<div class="item-row"><div style="min-width:70px;font-weight:700;color:var(--gray-800)">' + r.code + '</div><div style="flex:1"><div style="font-size:.8rem;color:var(--gray-700)">' + r.description + '</div><div style="font-size:.68rem;color:var(--gray-400)">' + (rac ? rac.code : r.racId) + '</div></div><button class="btn btn-sm btn-ghost" onclick="coordEditRAAUItem(\'' + career + '\',\'' + subject + '\',' + idx + ')">Editar</button><button class="btn btn-sm btn-danger" onclick="coordDeleteRAAUItem(\'' + career + '\',\'' + subject + '\',' + idx + ')">Eliminar</button></div>';
    }).join('');
  }

  function coordEditRAAUItem(career, subject, index) {
    var item = (rt.DB_ESPOCH[career].asignaturas[subject].raau || [])[index];
    if (!item) return;
    var racOptions = (rt.DB_ESPOCH[career].racs || []).map(function (r) { return '<option value="' + r.id + '"' + (r.id === item.racId ? ' selected' : '') + '>' + r.code + '</option>'; }).join('');
    rt.fns.openModal('Editar RAAU', '<div class="form-grid"><div class="form-group"><label class="form-label">Código</label><input class="form-input" id="coord-edit-raau-code" value="' + item.code + '"></div><div class="form-group"><label class="form-label">RAC</label><select class="form-select" id="coord-edit-raau-rac">' + racOptions + '</select></div></div><div class="form-group"><label class="form-label">Descripción</label><textarea class="form-input" id="coord-edit-raau-desc">' + item.description + '</textarea></div>',
      [{ label: 'Cancelar', cls: 'btn-ghost', action: 'close' }, { label: 'Guardar', cls: 'btn-success', action: function () {
        item.code = document.getElementById('coord-edit-raau-code').value.trim();
        item.description = document.getElementById('coord-edit-raau-desc').value.trim();
        item.racId = document.getElementById('coord-edit-raau-rac').value;
        rt.fns.saveVectorCatalogSoon();
        coordRenderRAAUList();
        rt.fns.closeModal();
      }}]);
  }

  function coordDeleteRAAUItem(career, subject, index) {
    rt.DB_ESPOCH[career].asignaturas[subject].raau.splice(index, 1);
    rt.fns.saveVectorCatalogSoon();
    coordRenderRAAUList();
  }

  function coordTriggerExcel() {
    var input = document.getElementById('coord-excel-input');
    if (input) input.click();
  }

  async function coordImportExcel(files) {
    var file = files && files[0];
    var careerEl = document.getElementById('coord-career-assignment') || document.getElementById('coord-career');
    var subjectEl = document.getElementById('coord-subject-assignment') || document.getElementById('coord-subject');
    var career = careerEl ? careerEl.value : '';
    var subject = subjectEl ? subjectEl.value : '';
    if (!file || !career || !subject) { rt.fns.showToast('Seleccione carrera/asignatura y archivo.', 'error'); return; }
    try {
      var XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
      var data = await file.arrayBuffer();
      var workbook = XLSX.read(data, { type: 'array' });
      var firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
      var racByCode = {};
      (rt.DB_ESPOCH[career].racs || []).forEach(function (r) { racByCode[String(r.code).trim().toUpperCase()] = r; });
      var importedRaaus = [];
      rows.forEach(function (row) {
        var racCode = String(row.RAC_CODE || row.RAC || '').trim().toUpperCase();
        var racDesc = String(row.RAC_DESC || row.RAC_DESCRIPCION || '').trim();
        var raauCode = String(row.RAAU_CODE || row.RAAU || '').trim();
        var raauDesc = String(row.RAAU_DESC || row.RAAU_DESCRIPCION || '').trim();
        if (!racCode || !raauCode || !raauDesc) return;
        if (!racByCode[racCode]) {
          var newRac = { id: 'rac_excel_' + Date.now() + '_' + racCode, code: racCode, description: racDesc || ('RAC ' + racCode) };
          rt.DB_ESPOCH[career].racs.push(newRac);
          racByCode[racCode] = newRac;
        }
        importedRaaus.push({ code: raauCode, description: raauDesc, racId: racByCode[racCode].id });
      });
      if (!rt.DB_ESPOCH[career].asignaturas[subject]) rt.DB_ESPOCH[career].asignaturas[subject] = { raau: [] };
      rt.DB_ESPOCH[career].asignaturas[subject].raau = importedRaaus;
      rt.fns.saveVectorCatalogSoon();
      rt.fns.save();
      coordRenderRAAUList();
      rt.fns.showToast('Importación Excel completada: ' + importedRaaus.length + ' RAAU.', 'success');
    } catch {
      rt.fns.showToast('No se pudo procesar el Excel.', 'error');
    }
  }

  function coordEditMapping() {
    var career = document.getElementById('coord-career').value;
    var subject = document.getElementById('coord-subject').value;
    if (!career || !subject) { rt.fns.showToast('Seleccione carrera y asignatura.', 'error'); return; }
    var racs = rt.DB_ESPOCH[career].racs || [];
    var existing = (rt.DB_ESPOCH[career].asignaturas[subject] && rt.DB_ESPOCH[career].asignaturas[subject].raau) || [];
    var options = racs.map(function (r) { return '<option value="' + r.id + '">' + r.code + '</option>'; }).join('');
    var rows = existing.map(function (r) {
      return '<div class="item-row"><input class="form-input" value="' + (r.code || 'RAAU') + '" data-k="code"><input class="form-input" value="' + (r.description || '') + '" data-k="desc"><select class="form-select" data-k="rac">' + options.replace('value="' + r.racId + '"', 'value="' + r.racId + '" selected') + '</select></div>';
    }).join('');
    rt.fns.openModal('Editar mapeo de ' + subject, '<div id="coord-map-rows">' + (rows || '<div class="item-row"><input class="form-input" value="RAAU1" data-k="code"><input class="form-input" placeholder="Descripción" data-k="desc"><select class="form-select" data-k="rac">' + options + '</select></div>') + '</div><button class="btn btn-ghost btn-sm" onclick="coordAddMapRow()">+ Fila</button>',
      [{ label: 'Cancelar', cls: 'btn-ghost', action: 'close' }, { label: 'Guardar', cls: 'btn-success', action: function () { coordSaveMapping(career, subject); } }]);
  }

  function coordAddMapRow() {
    var holder = document.getElementById('coord-map-rows');
    if (!holder) return;
    var career = document.getElementById('coord-career').value;
    var options = ((rt.DB_ESPOCH[career] && rt.DB_ESPOCH[career].racs) || []).map(function (r) { return '<option value="' + r.id + '">' + r.code + '</option>'; }).join('');
    holder.innerHTML += '<div class="item-row"><input class="form-input" value="RAAU' + (holder.children.length + 1) + '" data-k="code"><input class="form-input" placeholder="Descripción" data-k="desc"><select class="form-select" data-k="rac">' + options + '</select></div>';
  }

  function coordSaveMapping(career, subject) {
    var rows = Array.prototype.slice.call(document.querySelectorAll('#coord-map-rows .item-row'));
    var mapped = rows.map(function (row) {
      return {
        code: row.querySelector('[data-k="code"]').value.trim(),
        description: row.querySelector('[data-k="desc"]').value.trim(),
        racId: row.querySelector('[data-k="rac"]').value
      };
    }).filter(function (x) { return x.code && x.description && x.racId; });
    if (!rt.DB_ESPOCH[career].asignaturas[subject]) rt.DB_ESPOCH[career].asignaturas[subject] = { raau: [] };
    rt.DB_ESPOCH[career].asignaturas[subject].raau = mapped;
    rt.fns.saveVectorCatalogSoon();
    rt.fns.closeModal();
    rt.fns.showToast('Mapeo RAC/RAAU actualizado para ' + subject, 'success');
  }

  function coordOpenConfig(configId) { rt.fns.setPaoActivo(configId); rt.fns.navigate('configuracion'); }
  function coordCreateConfig() { rt.fns.unlockNewConfig(); rt.fns.navigate('configuracion'); }
  function coordGoConfig() { rt.fns.navigate('configuracion'); }

  Object.assign(rt.fns, {
    renderCoordinacion, verHorario, expandCoordChart,
    coordSetDocentePassword, coordLoadSubjects, coordEditMapping, coordAddMapRow, coordSaveMapping,
    coordOpenConfig, coordCreateConfig, coordGoConfig, coordLoadSubjectsAssignment, coordCreateAssignment,
    coordAddDocente, coordImportDocentes, coordOmitDocente, coordRestoreDocente, coordVerHorario,
    coordAddAsignatura, coordManualRAC, coordRenderRACList, coordEditRAC, coordDeleteRAC,
    coordManualRAAU, coordRenderRAAUList, coordEditRAAUItem, coordDeleteRAAUItem, coordTriggerExcel, coordImportExcel
  });
}
