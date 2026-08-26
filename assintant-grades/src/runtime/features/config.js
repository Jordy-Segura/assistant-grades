// ============================================================================
// CAPA DE PRESENTACIÓN · Pantalla de Configuración (asistente RAC/RAAU/Actividades)
// ----------------------------------------------------------------------------
// Asistente de 4 pasos (asignatura → RAC → RAAU → actividades), configs guardadas
// y edición gestionada. Recibe `rt`: lee/escribe rt.STATE/rt.DB_ESPOCH/... y llama
// al núcleo vía rt.fns. Registra sus funciones públicas en rt.fns.
// ============================================================================

import { COMPONENTS, COMPONENT_WEIGHTS, COMPONENT_COLORS, COMPONENT_LABELS } from "../constants.js";
import { escapeHtml } from "../lib/format.js";

export function registerConfig(rt) {
  function onCarreraChange() {
    var carreraValue = document.getElementById('cfg-carrera').value;
    var paoSelect = document.getElementById('cfg-pao');
    var asigSelect = document.getElementById('cfg-asignatura');
    paoSelect.innerHTML = '<option value="">-- Seleccione PAO --</option>';
    asigSelect.innerHTML = '<option value="">-- Seleccione primero Carrera y PAO --</option>';
    paoSelect.disabled = true;
    asigSelect.disabled = true;
    if (!carreraValue) return;
    var carreraData = rt.fns.getCatalogCareer(carreraValue);
    rt.CAREER_RACS = (carreraData && carreraData.racs) || [];
    if (rt.STATE.currentUser) {
      // Cada usuario solo puede elegir PAOs donde tiene asignaturas asignadas.
      var paos = [];
      rt.fns.myAssignments().filter(function (a) { return a.carrera === carreraValue; }).forEach(function (a) {
        if (paos.indexOf(String(a.pao)) === -1) paos.push(String(a.pao));
      });
      paos.sort();
      paos.forEach(function (p) { paoSelect.innerHTML += '<option value="' + p + '">PAO ' + p + '</option>'; });
    } else if (carreraData) {
      paoSelect.innerHTML += '<option value="NIVELACIÓN">NIVELACIÓN</option>';
      for (var p = 1; p <= carreraData.maxPao; p++) paoSelect.innerHTML += '<option value="' + p + '">PAO ' + p + '</option>';
    }
    paoSelect.disabled = false;
    // Solo reiniciamos RAC/RAAU/actividades cuando la carrera REALMENTE cambia
    // (no al re-renderizar el paso con la misma carrera).
    if (rt.STATE.courseConfig.carrera !== carreraValue) {
      rt.STATE.courseConfig.carrera = carreraValue;
      rt.STATE.selectedRACIds = [];
      rt.STATE.raauEntries = [];
      rt.STATE.activities = [];
      rt.fns.save();
    }
  }

  function onPaoChange() {
    var carreraValue = document.getElementById('cfg-carrera').value;
    var paoValue = document.getElementById('cfg-pao').value;
    var asigSelect = document.getElementById('cfg-asignatura');
    asigSelect.innerHTML = '<option value="">-- Seleccione Asignatura --</option>';
    if (!paoValue) { asigSelect.disabled = true; return; }
    var materias;
    if (rt.STATE.currentUser) {
      materias = rt.fns.myAssignments()
        .filter(function (a) { return a.carrera === carreraValue && String(a.pao) === String(paoValue); })
        .map(function (a) { return a.asignatura; });
      materias = materias.filter(function (m, i) { return materias.indexOf(m) === i; });
    } else {
      var carreraDataForPao = rt.fns.getCatalogCareer(carreraValue);
      materias = (carreraDataForPao && carreraDataForPao.malla[paoValue]) || [];
    }
    materias.forEach(function (mat) { asigSelect.innerHTML += '<option value="' + mat + '">' + mat + '</option>'; });
    asigSelect.disabled = false;
    rt.STATE.courseConfig.pao = paoValue;
    rt.fns.save();
  }

  // Si la asignatura proviene de una asignación (creada por el coordinador desde
  // OASIS), guardamos sus códigos exactos para importar la nómina sin re-resolver.
  function storeOasisCodesForSubject(carrera, asignatura) {
    var asg = rt.fns.myAssignments().find(function (a) { return a.carrera === carrera && a.asignatura === asignatura; });
    if (asg) {
      rt.STATE.courseConfig.codCarrera = asg.codCarrera || '';
      rt.STATE.courseConfig.codMateria = asg.codMateria || '';
      rt.STATE.courseConfig.codNivel = asg.codNivel || asg.pao || '';
      rt.STATE.courseConfig.codParalelo = asg.paralelo || '';
      rt.STATE.courseConfig.codPeriodo = asg.codPeriodo || (rt.STATE.oasisPeriodo && rt.STATE.oasisPeriodo.codigo) || '';
    } else {
      rt.STATE.courseConfig.codCarrera = '';
      rt.STATE.courseConfig.codMateria = '';
      rt.STATE.courseConfig.codNivel = '';
      rt.STATE.courseConfig.codParalelo = '';
    }
  }

  function onAsignaturaChange() {
    var carrera = document.getElementById('cfg-carrera').value;
    var asignatura = document.getElementById('cfg-asignatura').value;
    rt.STATE.courseConfig.asignatura = asignatura;
    storeOasisCodesForSubject(carrera, asignatura);
    if (!carrera || !asignatura) return;
    var carreraDataForSubject = rt.fns.getCatalogCareer(carrera);
    var asignaturaData = carreraDataForSubject && carreraDataForSubject.asignaturas[asignatura];
    if (asignaturaData && asignaturaData.raau && asignaturaData.raau.length > 0) {
      rt.STATE.raauEntries = asignaturaData.raau.map(function (r, index) {
        return { id: 'raau_auto_' + r.racId + '_' + (r.code || index), code: r.code, description: r.description, racId: r.racId };
      });
      rt.STATE.selectedRACIds = [];
      asignaturaData.raau.forEach(function (r) { if (rt.STATE.selectedRACIds.indexOf(r.racId) === -1) rt.STATE.selectedRACIds.push(r.racId); });
      rt.fns.showToast('RAC y RAAU identificados automáticamente para la asignatura seleccionada.', 'success');
    } else {
      rt.STATE.raauEntries = [];
      rt.STATE.selectedRACIds = [];
      rt.fns.showToast('Esta asignatura no tiene mapeo automático de RAC/RAAU.', 'error');
    }
    rt.STATE.activities = [];
    rt.fns.save();
    rt.fns.updateSidebar();
    syncActivitiesWithRAAU();
    renderRAAUList();
    renderSelectedSummary();
  }

  var cfgStep = 0;
  var CFG_STEPS = ['Información', 'RAC de la Carrera', 'RAAU de la Asignatura', 'Actividades'];

  function renderConfig() {
    cfgStep = 0;
    // Sólo limpiar datos si es una configuración nueva (sin PAO activo ni edición)
    if (!rt.STATE.configLocked && !rt.STATE.activeConfigId && !rt.STATE.editingConfigId) {
      rt.STATE.selectedRACIds = [];
      rt.STATE.raauEntries = [];
      rt.STATE.activities = [];
    }
    renderCfgStep();
    // El período académico se consume de OASIS al entrar a Configuración.
    rt.fns.autoLoadPeriodo();
  }

  function applyDefaultTemplateIfNeeded() {
    // El período académico vigente proviene de OASIS; nunca de un valor fijo.
    var oasisDesc = (rt.STATE.oasisPeriodo && rt.STATE.oasisPeriodo.descripcion) || '';
    if (!rt.STATE.courseConfig.periodoAcademico) {
      rt.STATE.courseConfig.periodoAcademico = oasisDesc || '';
    }
    if (!rt.STATE.courseConfig.codPeriodo && rt.STATE.oasisPeriodo && rt.STATE.oasisPeriodo.codigo) {
      rt.STATE.courseConfig.codPeriodo = rt.STATE.oasisPeriodo.codigo;
    }
    var template = (rt.STATE.savedConfigs && rt.STATE.savedConfigs.length > 0) ? rt.STATE.savedConfigs[0] : null;
    if (!rt.STATE.courseConfig.aporte) {
      rt.STATE.courseConfig.aporte = (template && template.courseConfig.aporte) || 'FIN DE CICLO';
    }
  }

  function renderManagedConfigSection() {
    var wizard = document.getElementById('cfg-wizard');
    var managed = document.getElementById('cfg-managed-section');
    if (!wizard || !managed) return;
    if (!rt.STATE.configLocked) {
      wizard.style.display = '';
      managed.style.display = 'none';
      return;
    }
    wizard.style.display = 'none';
    managed.style.display = 'block';
    var c = rt.STATE.courseConfig;
    var racHtml = rt.CAREER_RACS.map(function (rac) {
      var selected = rt.STATE.selectedRACIds.indexOf(rac.id) !== -1;
      return '<div class="item-row"><div style="flex:1"><div class="item-name">' + rac.code + '</div><div class="item-sub">' + rac.description + '</div></div><button class="btn btn-sm ' + (selected ? 'btn-danger' : 'btn-edit') + '" onclick="toggleManagedRAC(\'' + rac.id + '\')">' + (selected ? 'Quitar' : 'Agregar') + '</button></div>';
    }).join('');
    var raauRows = rt.STATE.raauEntries.map(function (r, i) {
      return '<div class="item-row"><div style="flex:1"><div class="item-name">' + r.code + '</div><div class="item-sub">' + r.description + '</div></div><button class="btn btn-edit btn-sm" onclick="editRAAU(' + i + ')">Editar</button><button class="btn btn-danger btn-sm" onclick="deleteRAAU(' + i + ')">Eliminar</button></div>';
    }).join('');
    var actsRows = rt.STATE.activities.map(function (a) {
      return activityItemHTML(a, a.component, COMPONENT_COLORS[a.component]);
    }).join('');
    managed.innerHTML =
      '<div class="card" style="margin-bottom:16px"><div class="card-header"><div class="card-title">Gestión de configuración confirmada</div>' +
      '<button class="btn btn-ghost btn-sm" onclick="unlockInitialConfig()">Editar configuración</button>' +
      '<button class="btn btn-primary btn-sm" onclick="unlockNewConfig();rt.fns.navigate(\'configuracion\')">+ Nueva configuración</button></div>' +
      '<div class="card-body"><div class="info-box"><p>Los datos base son de solo lectura. Aquí puede editar RAC, RAAU y actividades.</p></div>' +
      '<div class="form-grid"><div class="form-group"><label class="form-label">Período</label><input class="form-input" value="' + (c.periodoAcademico || '') + '" readonly></div>' +
      '<div class="form-group"><label class="form-label">Docente</label><input class="form-input" value="' + (c.docente || '') + '" readonly></div></div>' +
      '<div class="form-grid-3"><div class="form-group"><label class="form-label">Carrera</label><input class="form-input" value="' + (c.carrera || '') + '" readonly></div>' +
      '<div class="form-group"><label class="form-label">PAO</label><input class="form-input" value="' + (c.pao || '') + '" readonly></div>' +
      '<div class="form-group"><label class="form-label">Asignatura</label><input class="form-input" value="' + (c.asignatura || '') + '" readonly></div></div>' +
      '<div style="margin-top:10px"><div style="font-size:.78rem;font-weight:700;color:var(--gray-800);margin-bottom:6px">RAC (editar/agregar)</div><div>' + (racHtml || '<span style="font-size:.78rem;color:var(--gray-400)">Sin RAC disponibles</span>') + '</div></div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;margin-bottom:6px"><div style="font-size:.78rem;font-weight:700;color:var(--gray-800)">RAAU</div><button class="btn btn-sm btn-primary" onclick="addRAAU()">Agregar RAAU</button></div>' +
      (raauRows || '<div style="font-size:.78rem;color:var(--gray-400)">Sin RAAU definidos.</div>') +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;margin-bottom:6px"><div style="font-size:.78rem;font-weight:700;color:var(--gray-800)">Actividades</div><div style="display:flex;gap:6px"><button class="btn btn-sm" style="background:' + COMPONENT_COLORS.ACD + '15;color:' + COMPONENT_COLORS.ACD + '" onclick="addActivity(\'ACD\')">+ ACD</button><button class="btn btn-sm" style="background:' + COMPONENT_COLORS.APEX + '15;color:' + COMPONENT_COLORS.APEX + '" onclick="addActivity(\'APEX\')">+ APEX</button><button class="btn btn-sm" style="background:' + COMPONENT_COLORS.AAUT + '15;color:' + COMPONENT_COLORS.AAUT + '" onclick="addActivity(\'AAUT\')">+ AAUT</button></div></div>' +
      (actsRows || '<div style="font-size:.78rem;color:var(--gray-400)">Sin actividades registradas.</div>') +
      '</div></div>';
  }

  function onConfigConfirmContinue() {
    rt.fns.closeSuccessModal();
    rt.STATE.configLocked = true;
    // Asegurar que activeConfigId se establezca desde la config recién guardada
    if (!rt.STATE.activeConfigId && rt.STATE.savedConfigs.length > 0) {
      rt.STATE.activeConfigId = rt.STATE.savedConfigs[0].id;
    } else if (!rt.STATE.activeConfigId) {
      // Fallback: crear un ID temporal
      rt.STATE.activeConfigId = 'cfg_' + Date.now();
    }
    rt.fns.loadActiveConfigData();
    rt.fns.save();
    rt.fns.updateSidebar();
    renderCfgStep();
    rt.fns.renderPage(rt.STATE.currentPage || 'configuracion');
    rt.fns.showToast('Configuración guardada y activada correctamente.', 'success');
  }

  function renderStepper() {
    document.getElementById('cfg-stepper').innerHTML = CFG_STEPS.map(function (label, i) {
      var isDone = i < cfgStep;
      var isActive = i === cfgStep;
      var cssClass = isDone ? 'done' : isActive ? 'active' : 'pending';
      return '<div class="step-item"><div class="step-dot ' + cssClass + '">' + (isDone ? '✓' : (i + 1)) + '</div><span class="step-label ' + cssClass + '">' + label + '</span>' + (i < CFG_STEPS.length - 1 ? '<div class="step-line' + (isDone ? ' done' : '') + '"></div>' : '') + '</div>';
    }).join('');
  }

  function collectMappedRAAUs() {
    var carrera = rt.STATE.courseConfig.carrera;
    var asignatura = rt.STATE.courseConfig.asignatura;
    var carreraDataForRaau = rt.fns.getCatalogCareer(carrera);
    var asignaturaData = carreraDataForRaau && carreraDataForRaau.asignaturas[asignatura];
    return (asignaturaData && asignaturaData.raau) ? asignaturaData.raau : [];
  }

  function regenerateRAAUFromSelectedRACs() {
    var previousEntries = rt.STATE.raauEntries.slice();
    var mapped = collectMappedRAAUs();
    var generated = [];
    function findRAC(racKey) {
      return rt.CAREER_RACS.find(function (r) { return r.id === racKey || r.code === racKey; }) || null;
    }
    rt.STATE.selectedRACIds.forEach(function (racId, idx) {
      var mappedByRac = mapped.filter(function (m) { return m.racId === racId; });
      if (mappedByRac.length > 0) {
        mappedByRac.forEach(function (m, i) {
          generated.push({
            id: 'raau_auto_' + racId + '_' + (m.code || ('IDX' + i)),
            code: m.code || ('RAAU' + (generated.length + 1)),
            description: m.description,
            racId: racId
          });
        });
      } else {
        var rac = findRAC(racId);
        generated.push({
          id: 'raau_auto_' + racId + '_' + idx,
          code: 'RAAU' + (generated.length + 1),
          description: 'Resultado de aprendizaje asociado a ' + (rac ? rac.code : ('RAC ' + (idx + 1))),
          racId: racId
        });
      }
    });
    rt.STATE.raauEntries = generated;
    rt.STATE.activities.forEach(function (act) {
      var oldRaau = previousEntries.find(function (r) { return r.id === act.raauId; });
      if (!oldRaau) return;
      var replacement = generated.find(function (r) { return r.code === oldRaau.code && r.racId === oldRaau.racId; }) ||
        generated.find(function (r) { return r.racId === oldRaau.racId; });
      if (replacement) {
        act.raauId = replacement.id;
        act.racId = replacement.racId;
      }
    });
  }

  function syncActivitiesWithRAAU() {
    rt.STATE.activities.forEach(function (act) {
      var raau = rt.STATE.raauEntries.find(function (r) { return r.id === act.raauId; });
      if (raau) {
        act.racId = raau.racId;
        return;
      }
      var fallback = rt.STATE.raauEntries.find(function (r) { return r.racId === act.racId; });
      if (fallback) {
        act.raauId = fallback.id;
        act.racId = fallback.racId;
      }
    });
  }

  function renderSelectedSummary() {
    var target = document.getElementById('cfg-selected-summary');
    if (!target) return;
    if (rt.STATE.selectedRACIds.length === 0) {
      target.innerHTML = '<div class="selected-box muted">Seleccione RAC para generar RAAU automáticamente.</div>';
      return;
    }
    var racBadges = rt.STATE.selectedRACIds.map(function (racId) {
      var rac = rt.CAREER_RACS.find(function (r) { return r.id === racId; });
      return '<span class="sel-chip">' + (rac ? rac.code : racId) + '</span>';
    }).join('');
    var raauBadges = rt.STATE.raauEntries.map(function (entry) {
      return '<span class="sel-chip secondary">' + entry.code + '</span>';
    }).join('');
    target.innerHTML =
      '<div class="selected-box"><div><strong>RAC seleccionados:</strong> ' + racBadges + '</div>' +
      '<div style="margin-top:8px"><strong>RAAU generados:</strong> ' + (raauBadges || '<span style="color:var(--gray-400)">—</span>') + '</div></div>';
  }

  function renderRAAUList() {
    var target = document.getElementById('cfg-raau-list');
    if (!target) return;
    if (rt.STATE.raauEntries.length === 0) {
      target.innerHTML = '<p style="font-size:0.8rem;color:var(--gray-500);text-align:center;padding:20px;">No hay RAAU definidos. Seleccione la asignatura correcta en el Paso 1.</p>';
      return;
    }
    target.innerHTML = rt.STATE.raauEntries.map(function (entry, i) {
      var rac = rt.CAREER_RACS.find(function (c) { return c.id === entry.racId; });
      return '<div class="item-row"><div style="font-size:.72rem;font-weight:700;color:var(--gray-800);min-width:50px">' + entry.code + '</div><div style="flex:1"><div style="font-size:.82rem;font-weight:500;color:var(--gray-700)">' + entry.description + '</div><div style="font-size:.72rem;color:var(--gray-400);margin-top:2px">' + (rac ? rac.code : entry.racId) + '</div></div><button class="btn btn-danger btn-sm" onclick="deleteRAAU(' + i + ')" title="Eliminar">Eliminar</button></div>';
    }).join('');
    renderSelectedSummary();
  }

  function renderActivitiesPanels() {
    var panel = document.getElementById('cfg-activities-panels');
    var summaryDiv = document.getElementById('cfg-activities-summary');
    if (!panel || !summaryDiv) return;
    var hasAny = rt.STATE.activities.length > 0;
    summaryDiv.style.display = hasAny ? 'block' : 'none';
    panel.innerHTML = COMPONENTS.map(function (comp) {
      var acts = rt.STATE.activities.filter(function (a) { return a.component === comp; });
      var color = COMPONENT_COLORS[comp];
      var totalMax = acts.reduce(function (s, a) { return s + a.maxScore; }, 0);
      var maxWeight = COMPONENT_WEIGHTS[comp];
      var remaining = maxWeight - totalMax;
      var pctVal = maxWeight > 0 ? Math.min(100, Math.max(0, totalMax / maxWeight * 100)) : 0;
      var statusClass = remaining < -0.001 ? 'over' : remaining > 0.001 ? 'pending' : 'complete';
      var statusText = remaining < -0.001
        ? ('Excede ' + Math.abs(remaining).toFixed(1) + ' pts')
        : remaining > 0.001
          ? ('Faltan ' + remaining.toFixed(1) + ' pts')
          : 'Completo';
      var listHtml = acts.map(function (act) { return activityItemHTML(act, comp, color); }).join('');
      if (!listHtml) listHtml = '<div class="cfg-activity-empty">Sin actividades en este componente.</div>';
      return '<section class="cfg-activity-component ' + statusClass + '" style="--component-color:' + color + '">' +
        '<div class="cfg-activity-head"><div class="cfg-component-heading"><span class="cfg-component-code">' + comp + '</span><div><div class="cfg-component-name">' + COMPONENT_LABELS[comp] + '</div><div class="cfg-component-rule">Minimo 2 actividades - Peso ' + maxWeight.toFixed(1) + ' pts</div></div></div>' +
        '<div class="cfg-score-actions"><div class="cfg-score-pill">' + totalMax.toFixed(1) + ' / ' + maxWeight.toFixed(1) + ' pts</div><button class="btn btn-sm cfg-add-activity" onclick="addActivity(\'' + comp + '\')">Agregar</button></div></div>' +
        '<div class="cfg-activity-meter"><span style="width:' + pctVal.toFixed(0) + '%"></span></div>' +
        '<div class="cfg-activity-state"><span>' + acts.length + ' actividad' + (acts.length !== 1 ? 'es' : '') + '</span><strong>' + statusText + '</strong></div>' +
        '<div class="cfg-activity-list" id="acts-' + comp + '">' + listHtml + '</div>' +
      '</section>';
    }).join('');
    renderActivitiesSummary();
  }

  function renderActivitiesSummary() {
    var summaryContent = document.getElementById('cfg-activities-summary-content');
    if (!summaryContent) return;
    if (rt.STATE.activities.length === 0) {
      summaryContent.innerHTML = '<div style="font-size:.78rem;color:var(--gray-400)">Aún no hay actividades registradas.</div>';
      return;
    }
    var lines = COMPONENTS.map(function (comp) {
      var acts = rt.STATE.activities.filter(function (a) { return a.component === comp; });
      var total = acts.reduce(function (sum, a) { return sum + a.maxScore; }, 0);
      var expected = COMPONENT_WEIGHTS[comp];
      var pctComp = Math.round((total / expected) * 100);
      return '<div class="cfg-summary-row" style="--component-color:' + COMPONENT_COLORS[comp] + '">' +
        '<span>' + comp + ': ' + acts.length + ' actividades</span>' +
        '<strong>' + total.toFixed(1) + '/' + expected + ' pts (' + Math.min(pctComp, 100) + '%)</strong>' +
      '</div>';
    }).join('');
    summaryContent.innerHTML = lines;
  }

  function activityItemHTML(act, comp, color) {
    var raauEntry = rt.STATE.raauEntries.find(function (r) { return r.id === act.raauId; });
    var racIdToSearch = (raauEntry && raauEntry.racId) || act.racId;
    var rac = rt.CAREER_RACS.find(function (r) { return r.id === racIdToSearch; });
    var procedure = (rt.EVAL_PROCEDURES[comp] || []).find(function (p) { return p.id === act.procedureId; });
    return '<div class="cfg-activity-item" style="--component-color:' + color + '">' +
      '<div class="cfg-activity-main"><span class="comp-pill cfg-activity-pill" style="background:' + color + '15;color:' + color + '">' + comp + '</span>' +
      '<div class="cfg-activity-copy"><div class="cfg-activity-title">' + escapeHtml(act.name || 'Actividad sin nombre') + '</div>' +
      '<div class="cfg-activity-meta"><span>Max: ' + Number(act.maxScore || 0).toFixed(1) + ' pts</span><span>RAAU: ' + escapeHtml(raauEntry ? raauEntry.code : 'N/A') + '</span><span>RAC: ' + escapeHtml(rac ? rac.code : 'N/A') + '</span><span>Proc: ' + escapeHtml(procedure ? procedure.name : 'N/A') + '</span></div></div></div>' +
      '<div class="cfg-activity-actions"><button class="btn btn-edit btn-sm" onclick="editActivity(\'' + act.id + '\')" title="Editar">Editar</button>' +
      '<button class="btn btn-danger btn-sm" onclick="deleteActivity(\'' + act.id + '\')" title="Eliminar">Eliminar</button></div>' +
      '</div>';
  }

  // La carrera se limita a las carreras donde el usuario tiene asignaturas.
  function applyDocenteCarreraOptions(elCarrera) {
    if (!elCarrera || !rt.STATE.currentUser) return;
    var carreras;
    if (rt.STATE.currentUser.role === 'coordinador' || rt.STATE.currentUser.role === 'admin') {
      carreras = Object.keys(rt.DB_ESPOCH);
    } else {
      carreras = [];
      rt.fns.myAssignments().forEach(function (a) { if (a.carrera && carreras.indexOf(a.carrera) === -1) carreras.push(a.carrera); });
    }
    elCarrera.innerHTML = '<option value="">-- Seleccione la carrera --</option>' +
      carreras.map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
  }

  function renderCfgStep() {
    // Mostrar el wizard completo siempre (paso a paso)
    applyDefaultTemplateIfNeeded();
    renderStepper();
    for (var i = 0; i < 4; i++) {
      var stepEl = document.getElementById('cfg-step-' + i);
      if (stepEl) stepEl.style.display = 'none';
    }
    var current = document.getElementById('cfg-step-' + cfgStep);
    if (current) current.style.display = 'block';
    document.getElementById('cfg-prev').style.display = cfgStep > 0 ? '' : 'none';
    document.getElementById('cfg-next').style.display = cfgStep < 3 ? '' : 'none';
    var saveBtn = document.getElementById('cfg-save');
    if (saveBtn) {
      saveBtn.style.display = cfgStep === 3 ? '' : 'none';
      saveBtn.textContent = 'Guardar para finalizar';
    }

    var config = rt.STATE.courseConfig;
    if (cfgStep === 0) {
      var periodoActual = rt.STATE.oasisPeriodo || {};
      document.getElementById('cfg-periodo').value = periodoActual.descripcion || config.periodoAcademico || '';
      var periodoHelp = document.getElementById('cfg-periodo-help');
      if (periodoHelp) {
        periodoHelp.textContent = periodoActual.codigo
          ? 'Periodo vigente desde OASIS - Codigo ' + periodoActual.codigo
          : 'Se actualiza automaticamente al ingresar o al presionar Actualizar.';
      }
      var docenteDefault = config.docente || (rt.STATE.currentUser && rt.STATE.currentUser.name) || '';
      document.getElementById('cfg-docente').value = docenteDefault;
      document.getElementById('cfg-aporte').value = config.aporte || 'FIN DE CICLO';
      var elCarrera = document.getElementById('cfg-carrera');
      applyDocenteCarreraOptions(elCarrera);
      if (config.carrera) {
        elCarrera.value = config.carrera;
        onCarreraChange();
        var elPao = document.getElementById('cfg-pao');
        if (config.pao) {
          elPao.value = config.pao;
          onPaoChange();
          var elAsig = document.getElementById('cfg-asignatura');
          if (config.asignatura) elAsig.value = config.asignatura;
        }
      }
    }
    if (cfgStep === 1) {
      document.getElementById('cfg-rac-title').textContent = 'RAC disponibles — Carrera: ' + (rt.STATE.courseConfig.carrera || '—');
      if (rt.CAREER_RACS.length === 0) {
        document.getElementById('cfg-rac-list').innerHTML = '<div class="info-box" style="background:#fee2e2;border-color:#fca5a5"><p style="color:#991b1b">No hay RACs configurados para la carrera seleccionada.</p></div>';
      } else {
        document.getElementById('cfg-rac-list').innerHTML = rt.CAREER_RACS.map(function (rac) {
          var isSelected = rt.STATE.selectedRACIds.indexOf(rac.id) !== -1;
          return '<div class="rac-card ' + (isSelected ? 'selected' : '') + '" onclick="toggleRAC(\'' + rac.id + '\',this)"><div class="rac-checkbox"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div><div><div class="rac-code">' + rac.code + '</div><div class="rac-desc">' + rac.description + '</div></div></div>';
        }).join('');
      }
    }
    if (cfgStep === 2) { renderRAAUList(); renderSelectedSummary(); }
    if (cfgStep === 3) renderActivitiesPanels();
    renderSavedConfigs();
  }

  // Una configuración es única por carrera + PAO + asignatura + aporte + período.
  // Distintos aportes (MEDIO/FIN/RECUPERACIÓN) o períodos SÍ son válidos por separado.
  function configKey(cc) {
    cc = cc || {};
    // Normaliza quitando tildes y colapsando espacios: así "TECNOLOGÍAS DE LA
    // INFORMACIÓN" (configs viejas) y "TECNOLOGIAS DE LA INFORMACION" (catálogo)
    // cuentan como la MISMA carrera. Sin esto, un duplicado de medio ciclo guardado
    // con tildes no se detectaba (el de fin de ciclo sí, por estar sin tildes).
    var n = function (v) {
      return String(v == null ? '' : v)
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ').trim().toUpperCase();
    };
    return [n(cc.carrera), n(cc.pao), n(cc.asignatura), n(cc.aporte), n(cc.periodoAcademico)].join('||');
  }

  function findDuplicateConfig(courseConfig, excludeId) {
    var key = configKey(courseConfig);
    var email = rt.STATE.currentUser && rt.STATE.currentUser.email;
    return (rt.STATE.savedConfigs || []).find(function (cfg) {
      if (excludeId && cfg.id === excludeId) return false;
      if (email && (cfg.ownerEmail || '') !== email) return false;
      return configKey(cfg.courseConfig) === key;
    }) || null;
  }

  function notifyDuplicateConfig(dup) {
    var cc = dup.courseConfig || {};
    rt.fns.openModal('Configuración duplicada',
      '<p style="font-size:.85rem;color:var(--gray-700);margin-bottom:8px">Ya existe una configuración para esta misma asignatura, PAO, aporte y período. No tiene sentido configurarla otra vez.</p>' +
      '<div style="font-size:.8rem;color:var(--gray-600);background:var(--gray-100);border-radius:8px;padding:10px 12px;line-height:1.7">' +
      '<strong>' + escapeHtml(cc.asignatura || '—') + '</strong><br>' +
      escapeHtml(cc.carrera || '—') + ' · PAO ' + escapeHtml(String(cc.pao || '—')) + '<br>' +
      escapeHtml(cc.aporte || '—') + ' · ' + escapeHtml(cc.periodoAcademico || '—') +
      '</div>',
      [
        { label: 'Editar la existente', cls: 'btn-edit', action: function () { rt.fns.closeModal(); editSavedConfigName(dup.id); } },
        { label: 'Entendido', cls: 'btn-primary', action: 'close' }
      ]);
  }

  function cfgPrev() { if (cfgStep > 0) { cfgStep--; renderCfgStep(); } }
  function cfgNext() {
    if (cfgStep === 0) {
      var periodoActual = rt.STATE.oasisPeriodo || {};
      var periodoVal = periodoActual.descripcion || document.getElementById('cfg-periodo').value;
      var carreraVal = document.getElementById('cfg-carrera').value;
      var asignaturaVal = document.getElementById('cfg-asignatura').value;
      var docenteVal = document.getElementById('cfg-docente').value;
      if (!carreraVal || !asignaturaVal) { rt.fns.showToast('Seleccione carrera y asignatura antes de continuar.', 'error'); return; }
      if (!periodoVal) { rt.fns.showToast('Ingrese el período académico.', 'error'); return; }
      var tentativa = {
        carrera: carreraVal,
        pao: document.getElementById('cfg-pao').value,
        asignatura: asignaturaVal,
        aporte: document.getElementById('cfg-aporte').value,
        periodoAcademico: periodoVal
      };
      var duplicate = findDuplicateConfig(tentativa, rt.STATE.editingConfigId || rt.STATE.activeConfigId);
      if (duplicate) { notifyDuplicateConfig(duplicate); return; }
      rt.STATE.courseConfig.periodoAcademico = periodoVal;
      rt.STATE.courseConfig.codPeriodo = periodoActual.codigo || rt.STATE.courseConfig.codPeriodo || '';
      rt.STATE.courseConfig.facultad = document.getElementById('cfg-facultad').value;
      rt.STATE.courseConfig.carrera = carreraVal;
      rt.STATE.courseConfig.asignatura = asignaturaVal;
      rt.STATE.courseConfig.docente = docenteVal;
      rt.STATE.courseConfig.pao = document.getElementById('cfg-pao').value;
      rt.STATE.courseConfig.aporte = document.getElementById('cfg-aporte').value;
      rt.fns.addRecentActivity('Configuración: ' + carreraVal + ' — ' + asignaturaVal, 'config');
    }
    if (cfgStep < 3) { cfgStep++; renderCfgStep(); }
  }
  async function cfgSave() {
    var issues = [];
    if (rt.STATE.selectedRACIds.length === 0) issues.push('Debe seleccionar al menos un RAC de la carrera.');
    if (rt.STATE.raauEntries.length === 0) issues.push('Debe configurar al menos un RAAU de la asignatura.');
    COMPONENTS.forEach(function (comp) {
      var acts = rt.STATE.activities.filter(function (a) { return a.component === comp; });
      var total = acts.reduce(function (s, a) { return s + (Number(a.maxScore) || 0); }, 0);
      var weight = COMPONENT_WEIGHTS[comp];
      var faltan = weight - total;
      if (acts.length < 2) {
        issues.push(comp + ' (' + COMPONENT_LABELS[comp] + '): requiere ≥2 actividades (tiene ' + acts.length + ')');
      }
      if (Math.abs(faltan) > 0.001) {
        if (faltan > 0) {
          issues.push(comp + ': debe completar los puntos — suma ' + total.toFixed(1) + '/' + weight.toFixed(1) + ' (faltan ' + faltan.toFixed(1) + ' pts)');
        } else {
          issues.push(comp + ': excede el puntaje — suma ' + total.toFixed(1) + '/' + weight.toFixed(1) + ' (sobran ' + Math.abs(faltan).toFixed(1) + ' pts)');
        }
      }
    });
    if (issues.length > 0) {
      var issuesHtml = issues.map(function (i) {
        return '<li style="padding:6px 10px;background:var(--red-bg);border-radius:var(--radius);font-size:.8rem;color:#991b1b;margin-bottom:4px;display:flex;align-items:center;gap:6px">' + i + '</li>';
      }).join('');
      rt.fns.openModal('Configuración Incompleta',
        '<p style="color:var(--gray-600);font-size:.85rem;margin-bottom:12px">Complete todos los requisitos antes de guardar:</p>' +
        '<ul style="list-style:none;padding:0">' + issuesHtml + '</ul>',
        [{ label: 'Entendido', cls: 'btn-primary', action: 'close' }]
      );
      return;
    }
    var targetId = rt.STATE.editingConfigId || rt.STATE.activeConfigId;
    var existingIdx = -1;
    if (targetId) {
      existingIdx = rt.STATE.savedConfigs.findIndex(function (c) { return c.id === targetId; });
    }
    var wasUpdate = existingIdx >= 0;
    // Guarda final: nunca crear un PAO duplicado (misma carrera/PAO/asignatura/aporte/período).
    if (!wasUpdate) {
      var dupSave = findDuplicateConfig(rt.STATE.courseConfig, '');
      if (dupSave) { notifyDuplicateConfig(dupSave); return; }
    }
    if (wasUpdate) {
      var existing = rt.STATE.savedConfigs[existingIdx];
      existing.savedAt = new Date().toLocaleString();
      existing.courseConfig = JSON.parse(JSON.stringify(rt.STATE.courseConfig));
      existing.selectedRACIds = rt.STATE.selectedRACIds.slice();
      existing.raauEntries = JSON.parse(JSON.stringify(rt.STATE.raauEntries));
      existing.activities = JSON.parse(JSON.stringify(rt.STATE.activities));
      rt.fns.enrichConfigVectors(existing);
    } else {
      var snapshot = {
        id: 'cfg_' + Date.now(),
        savedAt: new Date().toLocaleString(),
        ownerEmail: (rt.STATE.currentUser && rt.STATE.currentUser.email) || '',
        courseConfig: JSON.parse(JSON.stringify(rt.STATE.courseConfig)),
        selectedRACIds: rt.STATE.selectedRACIds.slice(),
        raauEntries: JSON.parse(JSON.stringify(rt.STATE.raauEntries)),
        activities: JSON.parse(JSON.stringify(rt.STATE.activities))
      };
      rt.fns.enrichConfigVectors(snapshot);
      rt.STATE.savedConfigs.unshift(snapshot);
      if (rt.STATE.savedConfigs.length > 8) rt.STATE.savedConfigs = rt.STATE.savedConfigs.slice(0, 8);
    }
    // NO activar automáticamente — el PAO solo se activa desde el dropdown "MIS PAOs"
    rt.STATE.editingConfigId = '';
    // Si hay un PAO activo, recargar sus datos (puede ser el que se editó, u otro)
    if (rt.STATE.activeConfigId) {
      rt.fns.cargarPaoActivo();
    }
    rt.STATE.configLocked = !!rt.STATE.activeConfigId;
    cfgStep = 0;
    rt.fns.save();
    rt.fns.updateSidebar();
    rt.fns.renderPaoSidebarList();
    // Sincronizar con OASIS solo si hay PAO activo
    if (rt.STATE.activeConfigId) {
      try {
        var synced = await rt.fns.syncStudentsFromOasis(rt.STATE.activeConfigId);
        if (synced && (synced.added > 0 || synced.updated > 0)) {
          var parts = [];
          if (synced.added > 0) parts.push(synced.added + ' nuevos');
          if (synced.updated > 0) parts.push(synced.updated + ' actualizados');
          rt.fns.addRecentActivity('OASIS: ' + parts.join(', '), 'student');
          rt.fns.showToast(parts.join(', ') + ' desde OASIS', 'success');
        }
      } catch {
        rt.fns.showToast('Guardado. No se pudo conectar con OASIS para cargar estudiantes.', 'error');
      }
    }
    rt.fns.addRecentActivity('Configuración guardada exitosamente', 'config');
    renderCfgStep();
    var msg = wasUpdate ? 'Configuración actualizada correctamente.' : 'Nuevo PAO guardado. Selecciónelo desde MIS PAOs para trabajar con él.';
    rt.fns.showToast(msg, 'success');
  }

  function applySavedConfig(configId) {
    if (!rt.fns.setPaoActivo(configId)) return;
    rt.fns.sincronizarPaoActivoConUI();
    rt.fns.showToast('Configuración aplicada correctamente.', 'success');
  }

  function editSavedConfigName(configId) {
    var found = rt.STATE.savedConfigs.find(function (cfg) { return cfg.id === configId; });
    if (!found) return;
    // Guardar el id del PAO que se está editando (SIN cambiar el PAO activo)
    rt.STATE.editingConfigId = configId;
    rt.STATE.courseConfig = JSON.parse(JSON.stringify(found.courseConfig));
    rt.STATE.selectedRACIds = found.selectedRACIds.slice();
    rt.STATE.raauEntries = JSON.parse(JSON.stringify(found.raauEntries));
    rt.STATE.activities = JSON.parse(JSON.stringify(found.activities));
    rt.STATE.configLocked = false;
    cfgStep = 0;
    if (rt.STATE.courseConfig.carrera && rt.fns.getCatalogCareer(rt.STATE.courseConfig.carrera)) {
      rt.CAREER_RACS = rt.fns.getCatalogCareer(rt.STATE.courseConfig.carrera).racs || [];
    }
    rt.fns.save();
    rt.fns.navigate('configuracion');
    rt.fns.showToast('Editando configuración completa del PAO. Guarde al finalizar.', 'success');
  }

  function renderSavedConfigs() {
    var target = document.getElementById('cfg-saved-configs');
    if (!target) return;
    var visibleConfigs = (rt.STATE.savedConfigs || []).filter(function (cfg) {
      if (!rt.STATE.currentUser) return false;
      return (cfg.ownerEmail || '') === rt.STATE.currentUser.email;
    });
    if (!visibleConfigs || visibleConfigs.length === 0) {
      target.innerHTML = '<div style="font-size:.8rem;color:var(--gray-500)">Aún no existen configuraciones guardadas.</div>';
      return;
    }
    target.innerHTML = visibleConfigs.map(function (cfg) {
      var acts = cfg.activities ? cfg.activities.length : 0;
      var raau = cfg.raauEntries ? cfg.raauEntries.length : 0;
      var isActive = cfg.id === rt.STATE.activeConfigId;
      return '<div class="saved-config-item' + (isActive ? ' active' : '') + '">' +
        '<div style="flex:1"><div class="saved-config-title">' + (cfg.courseConfig.asignatura || 'Sin asignatura') + (isActive ? ' <span style="font-size:.7rem;color:var(--espoch-green);font-weight:600">(Activo)</span>' : '') + '</div>' +
        '<div class="saved-config-sub">' + (cfg.courseConfig.carrera || '—') + ' · PAO ' + (cfg.courseConfig.pao || '—') + ' · ' + (cfg.courseConfig.aporte || '—') + ' · ' + acts + ' actividades · ' + raau + ' RAAU · ' + cfg.savedAt + '</div></div>' +
        '<div style="display:flex;gap:6px"><button class="btn btn-sm btn-edit" onclick="editSavedConfigName(\'' + cfg.id + '\')">Editar</button><button class="btn btn-sm btn-danger" onclick="deleteSavedConfig(\'' + cfg.id + '\')">Eliminar</button></div>' +
      '</div>';
    }).join('');
  }

  function deleteSavedConfig(configId) {
    var cfg = rt.STATE.savedConfigs.find(function (item) { return item.id === configId; });
    if (!cfg) return;
    rt.fns.openModal('Eliminar configuración',
      '<p style="font-size:.85rem;color:var(--gray-600)">¿Eliminar la configuración <strong>' + (cfg.courseConfig.asignatura || 'sin nombre') + '</strong>?</p>',
      [
        { label: 'Cancelar', cls: 'btn-ghost', action: 'close' },
        { label: 'Eliminar', cls: 'btn-danger', action: function () {
          rt.STATE.savedConfigs = rt.STATE.savedConfigs.filter(function (item) { return item.id !== configId; });
          delete rt.STATE.studentsByConfig[configId];
          delete rt.STATE.gradesByConfig[configId];
          if (rt.STATE.activeConfigId === configId) {
            rt.STATE.activeConfigId = '';
            rt.STATE.students = [];
            rt.STATE.grades = [];
            rt.STATE.configLocked = false;
          }
          rt.fns.save();
          rt.fns.updateSidebar();
          rt.fns.renderPaoSidebarList();
          renderSavedConfigs();
          rt.fns.closeModal();
          rt.fns.showToast('Configuración eliminada.', 'success');
        } }
      ]);
  }

  function unlockInitialConfig() {
    rt.STATE.configLocked = false;
    rt.fns.save();
    rt.fns.updateSidebar();
    renderCfgStep();
    rt.fns.showToast('Configuración reabierta para edición.', 'success');
  }

  function unlockNewConfig() {
    rt.STATE.configLocked = false;
    rt.STATE.activeConfigId = '';
    rt.STATE.editingConfigId = '';
    rt.STATE.courseConfig.periodoAcademico = (rt.STATE.oasisPeriodo && rt.STATE.oasisPeriodo.descripcion) || '';
    rt.STATE.courseConfig.codPeriodo = (rt.STATE.oasisPeriodo && rt.STATE.oasisPeriodo.codigo) || '';
    rt.STATE.courseConfig.carrera = '';
    rt.STATE.courseConfig.pao = '';
    rt.STATE.courseConfig.asignatura = '';
    rt.STATE.courseConfig.docente = '';
    rt.STATE.courseConfig.aporte = 'FIN DE CICLO';
    rt.STATE.selectedRACIds = [];
    rt.STATE.raauEntries = [];
    rt.STATE.activities = [];
    cfgStep = 0;
    rt.fns.save();
    rt.fns.updateSidebar();
    renderCfgStep();
    rt.fns.showToast('Nuevo PAO: complete los datos y guarde.', 'success');
  }

  function saveManagedConfigEdits() {
    rt.STATE.courseConfig.periodoAcademico = document.getElementById('managed-periodo').value;
    rt.STATE.courseConfig.docente = document.getElementById('managed-docente').value;
    rt.STATE.courseConfig.asignatura = document.getElementById('managed-asignatura').value;
    rt.fns.save();
    rt.fns.updateSidebar();
    renderManagedConfigSection();
    rt.fns.showToast('Cambios generales guardados', 'success');
  }

  function openManagedRAAUEditor() {
    rt.STATE.configLocked = false;
    cfgStep = 1;
    renderCfgStep();
    rt.fns.showToast('Puede editar RAC/RAAU. Al guardar volverá a gestión.', 'success');
  }

  function openManagedActivities() {
    rt.STATE.configLocked = false;
    cfgStep = 3;
    renderCfgStep();
    rt.fns.showToast('Puede editar actividades. Al guardar volverá a gestión.', 'success');
  }

  function toggleRAC(id, el) {
    if (rt.STATE.selectedRACIds.indexOf(id) !== -1) {
      rt.STATE.selectedRACIds = rt.STATE.selectedRACIds.filter(function (r) { return r !== id; });
      el.classList.remove('selected');
    } else {
      rt.STATE.selectedRACIds.push(id);
      el.classList.add('selected');
    }
    regenerateRAAUFromSelectedRACs();
    syncActivitiesWithRAAU();
    renderRAAUList();
    renderSelectedSummary();
    rt.fns.save();
  }

  function toggleManagedRAC(id) {
    var current = rt.STATE.selectedRACIds.indexOf(id);
    if (current >= 0) rt.STATE.selectedRACIds.splice(current, 1);
    else rt.STATE.selectedRACIds.push(id);
    regenerateRAAUFromSelectedRACs();
    syncActivitiesWithRAAU();
    rt.fns.save();
    renderManagedConfigSection();
  }

  function deleteRAAU(i) {
    rt.STATE.raauEntries.splice(i, 1);
    syncActivitiesWithRAAU();
    if (rt.STATE.configLocked) renderManagedConfigSection();
    else renderRAAUList();
    rt.fns.save();
  }
  function editRAAU(i) {
    var entry = rt.STATE.raauEntries[i];
    if (!entry) return;
    var racOptions = rt.CAREER_RACS.map(function (r) {
      return '<option value="' + r.id + '"' + (r.id === entry.racId ? ' selected' : '') + '>' + r.code + '</option>';
    }).join('');
    rt.fns.openModal('Editar RAAU',
      '<div class="form-group"><label class="form-label">Código</label><input class="form-input" id="m-raau-code" value="' + entry.code + '"></div>' +
      '<div class="form-group"><label class="form-label">Descripción</label><textarea class="form-input" id="m-raau-desc" rows="3">' + entry.description + '</textarea></div>' +
      '<div class="form-group"><label class="form-label">RAC asociado</label><select class="form-select" id="m-raau-rac">' + racOptions + '</select></div>',
      [
        { label: 'Cancelar', cls: 'btn-ghost', action: 'close' },
        { label: 'Guardar', cls: 'btn-success', action: function () {
          entry.code = document.getElementById('m-raau-code').value;
          entry.description = document.getElementById('m-raau-desc').value;
          entry.racId = document.getElementById('m-raau-rac').value;
          syncActivitiesWithRAAU();
          rt.fns.save();
          if (rt.STATE.configLocked) renderManagedConfigSection();
          else renderRAAUList();
          rt.fns.closeModal();
        } }
      ]);
  }
  function addRAAU() {
    var selectedRacs = rt.STATE.selectedRACIds;
    if (selectedRacs.length === 0) { rt.fns.showToast('Primero seleccione al menos un RAC.', 'error'); return; }
    var newCode = 'RAAU' + (rt.STATE.raauEntries.length + 1);
    var racOptions = rt.CAREER_RACS.filter(function (r) { return selectedRacs.indexOf(r.id) !== -1; }).map(function (r) {
      return '<option value="' + r.id + '">' + r.code + ' — ' + r.description.slice(0, 60) + '…</option>';
    }).join('');
    rt.fns.openModal('Nuevo RAAU',
      '<div class="form-group"><label class="form-label">Código</label><input class="form-input" id="m-code" value="' + newCode + '"></div>' +
      '<div class="form-group"><label class="form-label">Descripción</label><textarea class="form-input" id="m-desc" rows="3" style="resize:vertical"></textarea></div>' +
      '<div class="form-group"><label class="form-label">RAC asociado</label><select class="form-select" id="m-rac">' + racOptions + '</select></div>',
      [
        { label: 'Cancelar', cls: 'btn-ghost', action: 'close' },
        { label: 'Agregar', cls: 'btn-primary', action: function () {
          var codeValue = document.getElementById('m-code').value;
          var descValue = document.getElementById('m-desc').value;
          var racIdValue = document.getElementById('m-rac').value;
          if (!codeValue || !descValue) return;
          rt.STATE.raauEntries.push({ id: 'raau' + Date.now(), code: codeValue, description: descValue, racId: racIdValue });
          syncActivitiesWithRAAU();
          if (rt.STATE.configLocked) renderManagedConfigSection();
          else renderRAAUList();
          rt.fns.save();
          rt.fns.closeModal();
        } }
      ]);
  }

  function deleteActivity(id) {
    rt.STATE.activities = rt.STATE.activities.filter(function (a) { return a.id !== id; });
    if (rt.STATE.configLocked) renderManagedConfigSection();
    else renderActivitiesPanels();
    rt.fns.save();
  }

  function editActivity(actId) {
    var act = rt.STATE.activities.find(function (a) { return a.id === actId; });
    if (!act) return;
    var comp = act.component;
    var raauOptions = rt.STATE.raauEntries.map(function (r) {
      return '<option value="' + r.id + '"' + (r.id === act.raauId ? ' selected' : '') + '>' + r.code + ' — ' + r.description.slice(0, 50) + '…</option>';
    }).join('');
    var procOptions = (rt.EVAL_PROCEDURES[comp] || []).map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === act.procedureId ? ' selected' : '') + '>' + p.name + '</option>';
    }).join('');
    var racOptions = rt.CAREER_RACS.filter(function (r) { return rt.STATE.selectedRACIds.indexOf(r.id) !== -1; }).map(function (r) {
      return '<option value="' + r.id + '"' + (r.id === act.racId ? ' selected' : '') + '>' + r.code + '</option>';
    }).join('');
    var otherTotal = rt.STATE.activities.filter(function (a) { return a.component === comp && a.id !== actId; }).reduce(function (sum, a) { return sum + a.maxScore; }, 0);
    var pesoMaximo = COMPONENT_WEIGHTS[comp];
    rt.fns.openModal('Editar Actividad — ' + act.name,
      '<div class="form-group"><label class="form-label">Nombre</label><input class="form-input" id="m-aname" value="' + act.name + '"></div>' +
      '<div class="form-group"><label class="form-label">Puntaje Máximo</label><input class="form-input" type="number" id="m-amax" step="0.5" min="0.1" max="' + pesoMaximo + '" value="' + act.maxScore + '"></div>' +
      '<div class="info-box" style="margin:8px 0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg><p>Otras: ' + otherTotal.toFixed(1) + ' pts. Disponible: ' + (pesoMaximo - otherTotal).toFixed(1) + ' pts</p></div>' +
      '<div class="form-group"><label class="form-label">RAC asociado</label><select class="form-select" id="m-arac">' + racOptions + '</select></div>' +
      '<div class="form-group"><label class="form-label">RAAU asociado</label><select class="form-select" id="m-araau">' + raauOptions + '</select></div>' +
      '<div class="form-group"><label class="form-label">Procedimiento evaluativo</label><select class="form-select" id="m-aproc">' + procOptions + '</select></div>',
      [
        { label: 'Cancelar', cls: 'btn-ghost', action: 'close' },
        { label: 'Guardar Cambios', cls: 'btn-success', action: function () {
          var nameValue = document.getElementById('m-aname').value;
          var maxValue = parseFloat(document.getElementById('m-amax').value);
          if (!nameValue || isNaN(maxValue)) return;
          var newTotal = otherTotal + maxValue;
          if (newTotal > pesoMaximo) { rt.fns.showToast('Error: ' + comp + ' no puede exceder ' + pesoMaximo + ' pts.', 'error'); return; }
          var raauSelectedId = document.getElementById('m-araau').value;
          var raauEntry = rt.STATE.raauEntries.find(function (r) { return r.id === raauSelectedId; });
          if (!raauEntry || rt.STATE.selectedRACIds.indexOf(raauEntry.racId) === -1) {
            rt.fns.showToast('El RAAU seleccionado no corresponde a los RAC activos.', 'error');
            return;
          }
          act.name = nameValue;
          act.maxScore = maxValue;
          act.racId = raauEntry.racId;
          act.raauId = raauSelectedId;
          act.procedureId = document.getElementById('m-aproc').value;
          if (rt.STATE.configLocked) renderManagedConfigSection();
          else renderActivitiesPanels();
          rt.fns.save();
          rt.fns.closeModal();
          rt.fns.showToast('Actividad "' + nameValue + '" actualizada', 'success');
        } }
      ]);
  }

  function addActivity(comp) {
    if (rt.STATE.raauEntries.length === 0) { rt.fns.showToast('Debe tener al menos un RAAU antes de crear actividades', 'error'); return; }
    if (rt.STATE.selectedRACIds.length === 0) { rt.fns.showToast('Debe seleccionar al menos un RAC antes de crear actividades', 'error'); return; }
    var raauOptions = rt.STATE.raauEntries.map(function (r) {
      return '<option value="' + r.id + '">' + r.code + ' — ' + r.description.slice(0, 50) + '…</option>';
    }).join('');
    var procOptions = (rt.EVAL_PROCEDURES[comp] || []).map(function (p) {
      return '<option value="' + p.id + '">' + p.name + '</option>';
    }).join('');
    var racOptions = rt.CAREER_RACS.filter(function (r) { return rt.STATE.selectedRACIds.indexOf(r.id) !== -1; }).map(function (r) {
      return '<option value="' + r.id + '">' + r.code + '</option>';
    }).join('');
    var currentTotal = rt.STATE.activities.filter(function (a) { return a.component === comp; }).reduce(function (sum, a) { return sum + a.maxScore; }, 0);
    var pesoMaximo = COMPONENT_WEIGHTS[comp];

    rt.fns.openModal('Nueva Actividad — ' + comp,
      '<div class="form-group"><label class="form-label">Nombre</label><input class="form-input" id="m-aname" placeholder="Ej: Tareas en Equipo"></div>' +
      '<div class="form-group"><label class="form-label">Puntaje Máximo</label><input class="form-input" type="number" id="m-amax" step="0.5" min="0.1" max="' + pesoMaximo + '" value="1.0"></div>' +
      '<div class="info-box" style="margin:8px 0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg><p>Asignados: ' + currentTotal.toFixed(1) + ' / ' + pesoMaximo + ' pts. Disponible: ' + (pesoMaximo - currentTotal).toFixed(1) + ' pts</p></div>' +
      '<div class="form-group"><label class="form-label">RAC asociado</label><select class="form-select" id="m-arac">' + racOptions + '</select></div>' +
      '<div class="form-group"><label class="form-label">RAAU asociado</label><select class="form-select" id="m-araau">' + raauOptions + '</select></div>' +
      '<div class="form-group"><label class="form-label">Procedimiento evaluativo</label><select class="form-select" id="m-aproc">' + procOptions + '</select></div>',
      [
        { label: 'Cancelar', cls: 'btn-ghost', action: 'close' },
        { label: 'Agregar', cls: 'btn-primary', action: function () {
          var nameValue = document.getElementById('m-aname').value;
          var maxValue = parseFloat(document.getElementById('m-amax').value);
          if (!nameValue || isNaN(maxValue)) return;
          var newCurrentTotal = currentTotal + maxValue;
          if (newCurrentTotal > pesoMaximo) { rt.fns.showToast('Error: ' + comp + ' no puede exceder ' + pesoMaximo + ' pts.', 'error'); return; }
          var raauChosenId = document.getElementById('m-araau').value;
          var raauChosen = rt.STATE.raauEntries.find(function (r) { return r.id === raauChosenId; });
          if (!raauChosen || rt.STATE.selectedRACIds.indexOf(raauChosen.racId) === -1) {
            rt.fns.showToast('El RAAU seleccionado no corresponde a los RAC activos.', 'error');
            return;
          }
          var newAct = {
            id: 'act' + Date.now(), name: nameValue, component: comp, maxScore: maxValue,
            racId: raauChosen.racId,
            raauId: raauChosenId,
            procedureId: document.getElementById('m-aproc').value
          };
          rt.STATE.activities.push(newAct);
          rt.fns.addRecentActivity('Actividad "' + nameValue + '" agregada a ' + comp, 'config');
          if (rt.STATE.configLocked) renderManagedConfigSection();
          else renderActivitiesPanels();
          rt.fns.save();
          rt.fns.closeModal();
        } }
      ]);
  }


  function cfgConfirmEnter() {
    if (rt.STATE.configLocked) return;
    if (cfgStep < 3) cfgNext(); else cfgSave();
  }

  Object.assign(rt.fns, {
    renderConfig, renderSavedConfigs, onCarreraChange, onPaoChange, onAsignaturaChange, onConfigConfirmContinue,
    cfgPrev, cfgNext, cfgSave, cfgConfirmEnter, syncActivitiesWithRAAU,
    applySavedConfig, editSavedConfigName, deleteSavedConfig, unlockInitialConfig, unlockNewConfig,
    saveManagedConfigEdits, openManagedRAAUEditor, openManagedActivities,
    toggleRAC, toggleManagedRAC, addRAAU, deleteRAAU, editRAAU, addActivity, deleteActivity, editActivity
  });
}
