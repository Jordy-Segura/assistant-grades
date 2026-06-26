// ============================================================================
// CAPA DE PRESENTACIÓN · Pantallas de Consultas (Sede / Información / Estudiante)
// ----------------------------------------------------------------------------
// Exploradores de solo lectura contra OASIS. Reciben el contexto `rt`:
//   - rt.STATE / rt.DB_ESPOCH  → estado compartido (vía getters, siempre vigente)
//   - rt.fns.*                 → funciones del núcleo (getCatalogCareer, showToast)
// Registran sus funciones públicas en rt.fns para que el núcleo las exponga en
// window.* y las despache desde renderPage.
// ============================================================================
import * as oasis from "../../services/oasisApi.js";

export function registerConsultas(rt) {
  // ================================================================
  // MÓDULO: Sede Orellana — Explorador académico con acordeones
  // ================================================================
  function renderConsultaSede() {
    var target = document.getElementById('consulta-sede-content');
    if (!target) return;
    target.innerHTML =
      '<div class="card"><div class="card-header"><div class="card-title">Explorar estructura académica</div></div><div class="card-body">' +
      '<div class="form-grid" style="margin-bottom:16px">' +
      '<div class="form-group"><label class="form-label">Carrera</label><select class="form-select" id="csede-carrera" onchange="csedeLoadSubjects()">' +
      '<option value="">Seleccione carrera</option>' +
      Object.keys(rt.DB_ESPOCH).map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="form-group" style="display:flex;align-items:flex-end"><button class="btn btn-primary" onclick="csedeRefresh()"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Consultar en OASIS</button></div>' +
      '</div>' +
      '<div id="csede-loading" style="display:none;font-size:.82rem;color:var(--gray-500);padding:12px">Consultando OASIS…</div>' +
      '<div id="csede-tree"></div>' +
      '</div></div>';
  }

  function csedeLoadSubjects() {
    var carrera = document.getElementById('csede-carrera').value;
    var tree = document.getElementById('csede-tree');
    if (!tree) return;
    if (!carrera) { tree.innerHTML = ''; return; }
    var carreraData = rt.fns.getCatalogCareer(carrera);
    var malla = carreraData && carreraData.malla;
    if (!malla) { tree.innerHTML = '<div style="color:var(--gray-500);padding:8px">Sin malla disponible para esta carrera.</div>'; return; }
    var paos = Object.keys(malla).sort(function (a, b) {
      if (a === 'NIVELACIÓN') return -1; if (b === 'NIVELACIÓN') return 1;
      return Number(a) - Number(b);
    });
    tree.innerHTML = paos.map(function (pao) {
      var materias = malla[pao] || [];
      return '<div class="csede-pao">' +
        '<div class="csede-pao-header" onclick="csedeTogglePao(this)">' +
        '<span class="csede-arrow">▶</span>' +
        '<span class="csede-pao-label">PAO ' + pao + '</span>' +
        '<span class="csede-pao-count">' + materias.length + ' materias</span>' +
        '</div>' +
        '<div class="csede-pao-body" style="display:none">' +
        (materias.length ? materias.map(function (mat) {
          return '<div class="csede-materia">' +
            '<div class="csede-mat-header" onclick="csedeLoadDictados(\'' + carrera + '\',\'' + pao + '\',\'' + mat.replace(/'/g, "\\'") + '\',this)">' +
            '<span class="csede-arrow">▶</span>' +
            '<span class="csede-mat-label">' + mat + '</span>' +
            '<span class="csede-mat-status">Cargar docentes</span>' +
            '</div>' +
            '<div class="csede-mat-body" style="display:none"></div>' +
            '</div>';
        }).join('') : '<div style="font-size:.78rem;color:var(--gray-400);padding:8px 12px">Sin materias</div>') +
        '</div></div>';
    }).join('');
  }

  function csedeTogglePao(header) {
    var arrow = header.querySelector('.csede-arrow');
    var body = header.nextElementSibling;
    if (!body) return;
    var isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    arrow.textContent = isOpen ? '▶' : '▼';
  }

  function csedeToggleMat(header) {
    var arrow = header.querySelector('.csede-arrow');
    var body = header.nextElementSibling;
    if (!body) return;
    var isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    arrow.textContent = isOpen ? '▶' : '▼';
  }

  async function csedeLoadDictados(carrera, pao, materia, headerEl) {
    var arrow = headerEl.querySelector('.csede-arrow');
    var body = headerEl.nextElementSibling;
    if (!body) return;
    var isOpen = body.style.display !== 'none';
    if (isOpen) {
      body.style.display = 'none';
      arrow.textContent = '▶';
      return;
    }
    if (body.hasAttribute('data-loaded')) {
      body.style.display = 'block';
      arrow.textContent = '▼';
      return;
    }
    var status = headerEl.querySelector('.csede-mat-status');
    if (status) status.textContent = 'Consultando…';
    try {
      var res = await oasis.getDocentesCarrera({ carrera: carrera, facultad: 'SEDE ORELLANA' });
      var codCarrera = (res && res.codCarrera) || '';
      var docs = (res && res.docentes) || [];
      var docentesDeMateria = [];
      docs.forEach(function (d) {
        (d.cargas || []).forEach(function (c) {
          if (c.materia === materia) {
            docentesDeMateria.push({ docente: d, carga: c });
          }
        });
      });
      if (docentesDeMateria.length === 0) {
        body.innerHTML = '<div style="font-size:.78rem;color:var(--gray-500);padding:8px 12px">Sin docentes asignados en OASIS para esta materia.</div>';
      } else {
        var rows = await Promise.all(docentesDeMateria.map(async function (dm) {
          var nombreDoc = ((dm.docente.nombres || '') + ' ' + (dm.docente.apellidos || '')).trim() || dm.docente.cedula;
          var estudiantesHtml;
          try {
            var periodo = await oasis.getPeriodoActual();
            var alumnos = await oasis.getAlumnosMateria({
              codCarrera: codCarrera,
              codNivel: dm.carga.codNivel,
              codParalelo: dm.carga.paralelo,
              codPeriodo: periodo.codigo,
              codMateria: dm.carga.codMateria
            });
            if (alumnos && alumnos.length) {
              estudiantesHtml = '<div class="csede-estudiantes">' +
                '<div style="font-size:.72rem;font-weight:600;color:var(--gray-600);margin-bottom:4px">Estudiantes (' + alumnos.length + '):</div>' +
                alumnos.map(function (e) {
                  return '<div class="csede-est-item">' + e.apellidos + ' ' + e.nombres + ' (' + e.cedula + ')</div>';
                }).join('') + '</div>';
            } else {
              estudiantesHtml = '<div style="font-size:.72rem;color:var(--gray-400);padding:4px 12px">Sin estudiantes registrados</div>';
            }
          } catch {
            estudiantesHtml = '<div style="font-size:.72rem;color:var(--red);padding:4px 12px">Error al consultar estudiantes</div>';
          }
          return '<div class="csede-docente">' +
            '<div class="csede-doc-header" onclick="csedeToggleMat(this)"><span class="csede-arrow">▶</span>' +
            '<span class="csede-doc-label">' + nombreDoc + '</span>' +
            '<span class="csede-doc-paralelo">Paralelo ' + (dm.carga.paralelo || '—') + ' · Nivel ' + (dm.carga.codNivel || '—') + '</span>' +
            '</div>' +
            '<div class="csede-mat-body" style="display:none">' + estudiantesHtml + '</div>' +
            '</div>';
        }));
        body.innerHTML = rows.join('');
      }
      body.setAttribute('data-loaded', 'true');
      body.style.display = 'block';
      arrow.textContent = '▼';
      if (status) status.textContent = '';
    } catch (err) {
      body.innerHTML = '<div style="font-size:.78rem;color:var(--red);padding:8px 12px">Error al consultar OASIS: ' + (err.message || '') + '</div>';
      body.style.display = 'block';
      arrow.textContent = '▼';
      if (status) status.textContent = 'Error';
    }
  }

  function csedeRefresh() {
    var tree = document.getElementById('csede-tree');
    if (tree) {
      tree.innerHTML = '';
    }
    csedeLoadSubjects();
  }

  // ================================================================
  // MÓDULO: Información General
  // ================================================================
  function renderConsultaInformacion() {
    var target = document.getElementById('consulta-info-content');
    if (!target) return;
    target.innerHTML =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">' +
      '<div class="card"><div class="card-header"><div class="card-title">Período Académico Actual</div></div><div class="card-body" id="cinfo-periodo"><div style="font-size:.82rem;color:var(--gray-500)">Cargando…</div></div></div>' +
      '<div class="card"><div class="card-header"><div class="card-title">Estado del Sistema</div></div><div class="card-body" id="cinfo-sistema"><div style="font-size:.82rem;color:var(--gray-500)">Cargando…</div></div></div>' +
      '</div>' +
      '<div class="card"><div class="card-header"><div class="card-title">Carreras Activas</div><div style="display:flex;gap:8px;align-items:center"><input class="form-input" id="cinfo-filtro" placeholder="Filtrar carreras…" oninput="cinfoFiltrar()" style="width:200px;padding:4px 8px;font-size:.78rem"><button class="btn btn-sm btn-edit" onclick="cinfoLoadCarreras()"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Recargar</button></div></div><div class="card-body" id="cinfo-carreras"><div style="font-size:.82rem;color:var(--gray-500)">Cargando…</div></div></div>';
    cinfoLoadPeriodo();
    cinfoLoadSistema();
    cinfoLoadCarreras();
  }

  async function cinfoLoadPeriodo() {
    var el = document.getElementById('cinfo-periodo');
    if (!el) return;
    try {
      var p = rt.STATE.oasisPeriodo || await oasis.getPeriodoActual();
      if (!p || !p.descripcion) {
        el.innerHTML = '<div style="font-size:.82rem;color:var(--red)">No se pudo obtener el período actual.</div>';
        return;
      }
      el.innerHTML =
        '<div style="display:grid;gap:8px;font-size:.82rem">' +
        '<div><strong>Código:</strong> ' + (p.codigo || '—') + '</div>' +
        '<div><strong>Descripción:</strong> ' + (p.descripcion || '—') + '</div>' +
        '<div><strong>Inicio:</strong> ' + (p.fechaInicio || '—') + '</div>' +
        '<div><strong>Fin:</strong> ' + (p.fechaFin || '—') + '</div>' +
        '</div>';
    } catch {
      el.innerHTML = '<div style="font-size:.82rem;color:var(--red)">Error al consultar período.</div>';
    }
  }

  async function cinfoLoadSistema() {
    var el = document.getElementById('cinfo-sistema');
    if (!el) return;
    try {
      var health = await oasis.checkHealth();
      if (!health) {
        el.innerHTML = '<div style="font-size:.82rem;color:var(--red)">BFF no disponible</div>';
        return;
      }
      el.innerHTML =
        '<div style="display:grid;gap:8px;font-size:.82rem">' +
        '<div><strong>BFF:</strong> <span style="color:var(--green)">✓ Operativo</span></div>' +
        '<div><strong>OASIS:</strong> ' + (health.hasCredentials ? '<span style="color:var(--green)">✓ Configurado</span>' : '<span style="color:var(--amber)">Sin credenciales</span>') + '</div>' +
        '<div><strong>Base OASIS:</strong> <span style="font-size:.72rem">' + (health.base || '—') + '</span></div>' +
        '</div>';
    } catch {
      el.innerHTML = '<div style="font-size:.82rem;color:var(--red)">Error al consultar sistema.</div>';
    }
  }

  var _cinfoCarreras = [];

  function cinfoLocalCarreras() {
    return Object.keys(rt.DB_ESPOCH || {}).map(function (name) {
      return { nombre: name, codigo: name.replace(/[^A-Z0-9]/gi, '').slice(0, 10).toUpperCase() || name };
    });
  }

  function cinfoRenderCarreras(filtro) {
    var el = document.getElementById('cinfo-carreras');
    if (!el) return;
    var f = (filtro || '').toLowerCase();
    var list = f ? _cinfoCarreras.filter(function (c) { return c.nombre.toLowerCase().includes(f) || c.codigo.toLowerCase().includes(f); }) : _cinfoCarreras;
    if (!list.length) {
      el.innerHTML = '<div style="font-size:.82rem;color:var(--gray-500);padding:12px;text-align:center">' + (f ? 'No hay carreras que coincidan con "' + f + '".' : 'Sin carreras activas.') + '</div>';
      return;
    }
    el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px">' +
      list.map(function (c) {
        return '<div style="padding:10px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:.8rem">' +
          '<div style="font-weight:600;color:var(--gray-800)">' + c.nombre + '</div>' +
          '<div style="font-size:.7rem;color:var(--gray-400);margin-top:2px">Código: ' + c.codigo + '</div>' +
          '</div>';
      }).join('') + '<div style="font-size:.72rem;color:var(--gray-400);padding:4px;text-align:right">' + list.length + ' carreras</div></div>';
  }

  function cinfoFiltrar() {
    var input = document.getElementById('cinfo-filtro');
    cinfoRenderCarreras(input ? input.value : '');
  }

  async function cinfoLoadCarreras() {
    var el = document.getElementById('cinfo-carreras');
    if (!el) return;
    el.innerHTML = '<div style="font-size:.82rem;color:var(--gray-500)">Consultando OASIS…</div>';
    try {
      _cinfoCarreras = await oasis.getCarreras();
      if (!_cinfoCarreras || !_cinfoCarreras.length) {
        _cinfoCarreras = [];
        el.innerHTML = '<div style="font-size:.82rem;color:var(--gray-500)">Sin carreras activas.</div>';
        return;
      }
      cinfoFiltrar();
    } catch (err) {
      _cinfoCarreras = cinfoLocalCarreras();
      cinfoFiltrar();
      var warn = document.createElement('div');
      warn.style.cssText = 'font-size:.75rem;color:var(--amber);padding:8px 0 0';
      warn.textContent = 'Mostrando catalogo local porque OASIS no respondio: ' + (err.message || 'error de conexion');
      el.appendChild(warn);
    }
  }

  // ================================================================
  // MÓDULO: Datos de Estudiante
  // ================================================================
  function renderConsultaEstudiante() {
    var target = document.getElementById('consulta-est-content');
    if (!target) return;
    target.innerHTML =
      '<div class="card" style="margin-bottom:16px"><div class="card-header"><div class="card-title">Buscar Estudiante</div></div><div class="card-body">' +
      '<div class="form-grid" style="grid-template-columns:1fr auto">' +
      '<div class="form-group"><label class="form-label">Cédula</label><input class="form-input" id="cest-cedula" placeholder="10 dígitos" maxlength="10" oninput="cestValidateCedula()"></div>' +
      '<div class="form-group" style="display:flex;align-items:flex-end"><button class="btn btn-primary" id="cest-search-btn" onclick="cestSearch()" disabled><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Consultar</button></div>' +
      '</div>' +
      '<div id="cest-validation" style="font-size:.75rem;min-height:20px"></div>' +
      '</div></div>' +
      '<div id="cest-results"></div>';
  }

  function cestValidateCedula() {
    var input = document.getElementById('cest-cedula');
    var btn = document.getElementById('cest-search-btn');
    var msg = document.getElementById('cest-validation');
    if (!input || !btn || !msg) return;
    var ced = input.value.replace(/\D/g, '');
    input.value = ced;
    if (!ced) { btn.disabled = true; msg.textContent = ''; return; }
    if (ced.length < 10) { btn.disabled = true; msg.textContent = 'Ingrese 10 dígitos'; msg.style.color = 'var(--gray-500)'; return; }
    if (ced.length > 10) { btn.disabled = true; msg.textContent = 'Máximo 10 dígitos'; msg.style.color = 'var(--red)'; return; }
    // Validación del dígito verificador (algoritmo módulo 10)
    var suma = 0;
    for (var i = 0; i < 9; i++) {
      var dig = parseInt(ced[i], 10);
      if (i % 2 === 0) { dig *= 2; if (dig > 9) dig -= 9; }
      suma += dig;
    }
    var digVer = (10 - (suma % 10)) % 10;
    if (digVer === parseInt(ced[9], 10)) {
      btn.disabled = false;
      msg.textContent = '✓ Cédula válida';
      msg.style.color = 'var(--green)';
    } else {
      btn.disabled = true;
      msg.textContent = '✗ Cédula inválida';
      msg.style.color = 'var(--red)';
    }
  }

  async function cestSearch() {
    var input = document.getElementById('cest-cedula');
    var btn = document.getElementById('cest-search-btn');
    var results = document.getElementById('cest-results');
    if (!input || !results) return;
    var cedula = input.value.trim();
    if (!cedula || cedula.length !== 10) { rt.fns.showToast('Ingrese una cédula válida de 10 dígitos.', 'error'); return; }
    btn.disabled = true;
    btn.textContent = 'Consultando…';
    results.innerHTML = '<div style="font-size:.82rem;color:var(--gray-500);padding:12px">Consultando información del estudiante…</div>';
    try {
      var data = await oasis.getEstudianteFull({ cedula: cedula });
      var estudiante = data.estudiante;
      var materias = data.materias || [];
      var horario = data.horario || [];
      var carrera = data.carrera;
      var periodo = data.periodo;
      var htmlResultados = '';

      // Datos personales del estudiante
      if (estudiante && estudiante.nombres) {
        htmlResultados += '<div class="card" style="margin-bottom:16px"><div class="card-header"><div class="card-title"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ' + estudiante.apellidos + ' ' + estudiante.nombres + '</div></div><div class="card-body">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:.82rem">' +
          '<div><strong>Cédula:</strong> ' + (estudiante.cedula || '—') + '</div>' +
          '<div><strong>Código:</strong> ' + (estudiante.codigo || '—') + '</div>' +
          '<div><strong>Email:</strong> ' + (estudiante.email || '—') + '</div>' +
          '<div><strong>Teléfono:</strong> ' + (estudiante.telefono || '—') + '</div>' +
          '<div><strong>Dirección:</strong> ' + (estudiante.direccion || '—') + '</div>' +
          '<div><strong>Sexo:</strong> ' + (estudiante.sexo || '—') + '</div>' +
          '<div><strong>Fecha Nacimiento:</strong> ' + (estudiante.fechaNacimiento || '—') + '</div>' +
          (carrera ? '<div><strong>Carrera:</strong> ' + carrera.nombre + '</div>' : '') +
          (periodo ? '<div><strong>Periodo:</strong> ' + periodo.descripcion + '</div>' : '') +
          '</div></div></div>';
      } else {
        htmlResultados += '<div class="card" style="margin-bottom:16px"><div class="card-header"><div class="card-title">Datos del Estudiante</div></div><div class="card-body" style="font-size:.82rem;color:var(--gray-500)">Estudiante no encontrado en OASIS.</div></div>';
      }

      // Materias actuales
      if (materias.length > 0) {
        htmlResultados += '<div class="card" style="margin-bottom:12px"><div class="card-header"><div class="card-title"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> Materias Actuales (' + periodo.descripcion + ')</div><div style="font-size:.78rem;color:var(--gray-500)">' + materias.length + ' materias</div></div><div class="card-body" style="padding:0;overflow-x:auto">' +
          '<table class="data" style="font-size:.78rem"><thead><tr><th>Materia</th><th>Código</th><th>Docente</th><th>Paralelo</th></tr></thead><tbody>' +
          materias.map(function (m) {
            var info = horario.find(function (h) { return h.codMateria === m.codMateria; });
            var docentesHtml = '—';
            var paralelosHtml = '—';
            if (info && info.dictados && info.dictados.length > 0) {
              var paraleloMateria = String(m.paralelo || '').trim();
              var dictadosMateria = info.dictados;
              if (paraleloMateria) {
                var filtrados = dictadosMateria.filter(function (d) { return String(d.paralelo || '').trim() === paraleloMateria; });
                if (filtrados.length > 0) dictadosMateria = filtrados;
              }
              docentesHtml = dictadosMateria.map(function (d) {
                var doc = d.docente || {};
                return ((doc.nombres || '') + ' ' + (doc.apellidos || '')).trim() || '—';
              }).join('<br>');
              var paralelos = [];
              dictadosMateria.forEach(function (d) {
                var p = String(d.paralelo || '').trim();
                if (p && paralelos.indexOf(p) === -1) paralelos.push(p);
              });
              paralelosHtml = paralelos.length ? paralelos.join(', ') : (paraleloMateria || '—');
            } else if (m.paralelo) {
              paralelosHtml = m.paralelo;
            }
            return '<tr><td>' + m.materia + '</td><td>' + m.codMateria + '</td><td style="font-size:.75rem">' + docentesHtml + '</td><td>' + paralelosHtml + '</td></tr>';
          }).join('') +
          '</tbody></table></div></div>';
      }

      if (!estudiante && materias.length === 0) {
        htmlResultados = '<div class="card"><div class="card-body" style="text-align:center;padding:24px">' +
          '<div style="font-size:.85rem;color:var(--gray-500)">No se encontraron datos para la cédula <strong>' + cedula + '</strong>.</div>' +
          '</div></div>';
      }
      results.innerHTML = htmlResultados;
    } catch (err) {
      results.innerHTML = '<div class="card"><div class="card-body" style="text-align:center;padding:24px">' +
        '<div style="font-size:.85rem;color:var(--red)">Error al consultar: ' + (err.message || 'Error de conexión') + '</div>' +
        '</div></div>';
    }
    btn.disabled = false;
    btn.textContent = 'Consultar';
  }

  Object.assign(rt.fns, {
    renderConsultaSede, csedeLoadSubjects, csedeTogglePao, csedeToggleMat,
    csedeLoadDictados, csedeRefresh,
    renderConsultaInformacion, cinfoLoadCarreras, cinfoFiltrar,
    renderConsultaEstudiante, cestValidateCedula, cestSearch
  });
}
