// ============================================================================
// CAPA DE PRESENTACIÓN · Estudiantes, Calificaciones, Reporte y Exportaciones
// ----------------------------------------------------------------------------
// Flujo de evaluación del PAO activo: nómina (import OASIS), captura de notas,
// reporte final y exportaciones (Excel/PDF/QR). Recibe `rt`: lee/escribe
// rt.STATE/... y llama al núcleo vía rt.fns. Registra sus funciones públicas.
// ============================================================================

import * as oasis from "../../services/oasisApi.js";
import { COMPONENTS, COMPONENT_WEIGHTS, COMPONENT_COLORS } from "../constants.js";
import { fmt, pct, formatCedula, escapeHtml, fileSlug } from "../lib/format.js";
import { downloadTextFile } from "../lib/dom.js";
import { buildGradesExcelXml } from "../lib/excel.js";

export function registerGradesScreens(rt) {
  function renderEstudiantes() {
    if (!rt.STATE.activeConfigId) {
      document.getElementById('est-sub').textContent = 'Seleccione un PAO desde MIS PAOs para cargar estudiantes.';
      document.getElementById('est-stats').innerHTML = '';
      document.getElementById('est-body').innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--gray-500);padding:20px">Seleccione o configure un PAO desde MIS PAOs o Configuración.</td></tr>';
      document.getElementById('est-table-title').textContent = 'Nómina (0)';
      setImportStatus('', false);
      return;
    }
    var students = rt.STATE.students;
    var hasActivities = rt.STATE.activities && rt.STATE.activities.length > 0;
    updateOasisButtonText();
    document.getElementById('est-sub').textContent = students.length > 0
      ? students.length + ' estudiantes matriculados' +
        (rt.STATE.courseConfig.asignatura ? ' en ' + rt.STATE.courseConfig.asignatura : '')
      : 'Sin estudiantes — presione "Actualizar" para cargar la nómina desde OASIS.';
    var allTotals = students.map(function (s) { return rt.fns.studentTotal(s.id); });
    var approvedCount = allTotals.filter(function (t) { return t >= 7; }).length;
    var classAverage = allTotals.length > 0 ? allTotals.reduce(function (a, b) { return a + b; }, 0) / allTotals.length : 0;
    document.getElementById('est-stats').innerHTML = [
      { label: 'Total', val: students.length, color: 'var(--gray-800)' },
      { label: 'Aprobados', val: hasActivities ? approvedCount : '—', color: hasActivities ? 'var(--green)' : 'var(--gray-400)' },
      { label: 'Promedio', val: hasActivities ? classAverage.toFixed(2) : '—', color: hasActivities ? 'var(--amber)' : 'var(--gray-400)' }
    ].map(function (s) {
      return '<div class="card" style="padding:14px 18px"><div style="font-size:.75rem;color:var(--gray-400)">' + s.label + '</div><div style="font-size:1.4rem;font-weight:700;color:' + s.color + ';margin-top:3px">' + s.val + '</div></div>';
    }).join('');
    renderStudentTable();
  }

  function renderStudentTable() {
    var query = (document.getElementById('est-search') ? document.getElementById('est-search').value : '').toLowerCase();
    var queryClean = query.replace(/-/g, '');
    var filtered = rt.STATE.students.filter(function (s) {
      var cedClean = (s.cedula || '').replace(/-/g, '');
      var searchStr = (s.apellidos + ' ' + s.nombres + ' ' + s.cedula + ' ' + (s.codigo || '') + ' ' + cedClean).toLowerCase();
      return searchStr.indexOf(query) !== -1 || searchStr.indexOf(queryClean) !== -1;
    });
    document.getElementById('est-table-title').textContent = 'Nómina (' + filtered.length + ')';
    if (filtered.length === 0) {
      document.getElementById('est-body').innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--gray-400);padding:28px;font-size:.82rem">' +
        (rt.STATE.students.length === 0
          ? 'No hay estudiantes registrados. Presione "Actualizar" para cargar la nómina desde OASIS.'
          : 'No se encontraron estudiantes que coincidan con "' + query + '".') +
        '</td></tr>';
      return;
    }
    document.getElementById('est-body').innerHTML = filtered.map(function (s, i) {
      var tot = rt.fns.studentTotal(s.id);
      var passed = tot >= 7;
      return '<tr><td style="color:var(--gray-400)">' + (i + 1) + '</td><td style="font-family:var(--mono);font-size:.78rem">' + (s.codigo || '—') + '</td><td style="font-family:var(--mono);font-size:.78rem">' + formatCedula(s.cedula) + '</td><td style="font-weight:500">' + s.apellidos + '</td><td>' + s.nombres + '</td><td style="text-align:center;font-weight:700;font-family:var(--mono);color:' + (passed ? 'var(--green)' : 'var(--red)') + '">' + fmt(tot) + '</td><td style="text-align:center"><span class="badge ' + (passed ? 'badge-green' : 'badge-red') + '">' + (passed ? 'Aprobado' : 'Reprobado') + '</span></td><td style="text-align:center"><div style="display:flex;gap:5px;justify-content:center"><button class="btn btn-ghost btn-sm" onclick="editStudent(\'' + s.id + '\')" title="Editar">Editar</button><button class="btn btn-danger btn-sm" onclick="confirmDelete(\'' + s.id + '\')" title="Eliminar">Eliminar</button></div></td></tr>';
    }).join('');
  }

  function exportStudentsPDF() {
    if (!rt.STATE.activeConfigId) {
      rt.fns.showToast('Seleccione un PAO desde MIS PAOs.', 'error');
      return;
    }
    if (!rt.STATE.students || rt.STATE.students.length === 0) {
      rt.fns.showToast('No hay estudiantes registrados para exportar.', 'error');
      return;
    }
    var c = rt.STATE.courseConfig || {};
    var rows = rt.STATE.students.map(function (s) {
      var grades = rt.STATE.grades.filter(function (g) { return g.studentId === s.id; });
      var total = grades.reduce(function (sum, g) { return sum + (Number(g.score) || 0); }, 0);
      var pct = rt.STATE.activities.length ? ((total / rt.STATE.activities.reduce(function (s2, a) { return s2 + (Number(a.maxScore) || 0); }, 0)) * 100).toFixed(1) : '—';
      return '<tr><td>' + escapeHtml(s.codigo || '') + '</td><td>' + escapeHtml(formatCedula(s.cedula)) + '</td><td>' + escapeHtml(s.apellidos) + '</td><td>' + escapeHtml(s.nombres) + '</td><td>' + total.toFixed(2) + '</td><td>' + pct + '%</td></tr>';
    }).join('');
    var w = window.open('', '_blank', 'width=1200,height=800');
    if (!w) { rt.fns.showToast('Permita ventanas emergentes para exportar.', 'error'); return; }
    w.document.write('<html><head><title>Nómina - ' + escapeHtml(c.asignatura || 'Estudiantes') + '</title>' +
      '<style>body{font-family:Inter,Arial,sans-serif;margin:14px;color:#111}h1{font-size:16px;margin:0 0 4px}.sub{font-size:12px;color:#666;margin-bottom:10px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #ddd;padding:5px 6px;text-align:left}th{background:#f5f5f5;font-weight:600}.right{text-align:right}</style></head><body>' +
      '<h1>Nómina de Estudiantes</h1>' +
      '<div class="sub">' + escapeHtml(c.carrera || '') + ' · ' + escapeHtml(c.asignatura || '') + ' · ' + escapeHtml(c.periodoAcademico || '') + ' · Total: ' + rt.STATE.students.length + ' estudiantes</div>' +
      '<table><thead><tr><th>Código</th><th>Cédula</th><th>Apellidos</th><th>Nombres</th><th class="right">Total</th><th class="right">%</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '</body></html>');
    w.document.close();
    w.focus();
    w.print();
  }

  function exportGradesPDF() {
    if (!rt.STATE.activeConfigId) {
      rt.fns.showToast('Seleccione un PAO desde MIS PAOs.', 'error');
      return;
    }
    if (!rt.STATE.students || rt.STATE.students.length === 0) {
      rt.fns.showToast('No hay estudiantes registrados.', 'error');
      return;
    }
    if (!rt.STATE.activities || rt.STATE.activities.length === 0) {
      rt.fns.showToast('No hay actividades configuradas.', 'error');
      return;
    }
    var c = rt.STATE.courseConfig || {};
    var grouped = COMPONENTS.map(function (comp) {
      return { comp: comp, acts: rt.STATE.activities.filter(function (a) { return a.component === comp; }) };
    });
    var headerRow = '<tr><th rowspan="2">No.</th><th rowspan="2">Codigo</th><th rowspan="2">Cedula</th><th rowspan="2">Apellidos</th><th rowspan="2">Nombres</th>';
    grouped.forEach(function (grp) {
      grp.acts.forEach(function () { headerRow += '<th rowspan="2" style="font-size:9px">' + grp.comp + '</th>'; });
    });
    headerRow += '<th rowspan="2">Nota</th></tr>';
    var totalMax = rt.STATE.activities.reduce(function (s, a) { return s + (Number(a.maxScore) || 0); }, 0);
    var rows = rt.STATE.students.map(function (s, idx) {
      var tot = rt.fns.studentTotal(s.id);
      var cols = '<td>' + (idx + 1) + '</td><td>' + escapeHtml(s.codigo || '') + '</td><td>' + escapeHtml(formatCedula(s.cedula)) + '</td><td>' + escapeHtml(s.apellidos) + '</td><td>' + escapeHtml(s.nombres) + '</td>';
      grouped.forEach(function (grp) {
        grp.acts.forEach(function (act) {
          var g = rt.fns.getGrade(s.id, act.id);
          cols += '<td style="text-align:center">' + (g != null ? g.toFixed(2) : '—') + '</td>';
        });
      });
      cols += '<td style="text-align:center;font-weight:700">' + tot.toFixed(2) + '</td>';
      return '<tr>' + cols + '</tr>';
    }).join('');
    var w = window.open('', '_blank', 'width=1400,height=800');
    if (!w) { rt.fns.showToast('Permita ventanas emergentes para exportar.', 'error'); return; }
    w.document.write('<html><head><title>Calificaciones - ' + escapeHtml(c.asignatura || '') + '</title>' +
      '<style>body{font-family:Inter,Arial,sans-serif;margin:14px;color:#111;font-size:11px}h1{font-size:16px;margin:0 0 4px}.sub{font-size:12px;color:#666;margin-bottom:10px}table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #bbb;padding:4px 5px;text-align:left}th{background:#f0f0f0;font-weight:600}</style></head><body>' +
      '<h1>Registro de Calificaciones</h1>' +
      '<div class="sub">' + escapeHtml(c.carrera || '') + ' · ' + escapeHtml(c.asignatura || '') + ' · ' + escapeHtml(c.aporte || '') + ' · PAO ' + (c.pao || '') + ' · Total estudiantes: ' + rt.STATE.students.length + '</div>' +
      '<table><thead>' + headerRow + '</thead><tbody>' + rows + '</tbody></table>' +
      '<p style="margin-top:12px;font-size:10px;color:#999">Total maximo: ' + totalMax.toFixed(1) + ' pts · Fecha: ' + new Date().toLocaleString() + '</p>' +
      '</body></html>');
    w.document.close();
    w.focus();
    w.print();
  }

  function showGradesQR() {
    if (!rt.STATE.activeConfigId) {
      rt.fns.showToast('Seleccione un PAO desde MIS PAOs.', 'error');
      return;
    }
    if (!rt.STATE.students || rt.STATE.students.length === 0) {
      rt.fns.showToast('No hay estudiantes registrados.', 'error');
      return;
    }
    var c = rt.STATE.courseConfig || {};
    var totalMax = rt.STATE.activities.reduce(function (s, a) { return s + (Number(a.maxScore) || 0); }, 0);
    var totalExpected = rt.STATE.students.length * rt.STATE.activities.length;
    var totalEntered = 0;
    var allTotals = rt.STATE.students.map(function (s) {
      var tot = rt.fns.studentTotal(s.id);
      rt.STATE.activities.forEach(function (act) { if (rt.fns.getGrade(s.id, act.id) != null) totalEntered++; });
      return tot;
    });
    var avg = allTotals.length > 0 ? (allTotals.reduce(function (a, b) { return a + b; }, 0) / allTotals.length).toFixed(2) : '—';
    var pct = totalExpected > 0 ? Math.round(totalEntered / totalExpected * 100) : 0;

    // Versión imprimible completa (se abre con el botón del modal / Exportar PDF).
    var compHeaders = '';
    COMPONENTS.forEach(function (comp) {
      var acts = rt.STATE.activities.filter(function (a) { return a.component === comp; });
      if (acts.length === 0) return;
      var colSpan = acts.length;
      compHeaders += '<th colspan="' + colSpan + '" style="background:#e8f5e9;font-size:10px">' + comp + '</th>';
    });
    var actHeaders = rt.STATE.activities.map(function (a) { return '<th style="font-size:9px">' + escapeHtml(a.name) + '<br><span style="font-weight:400;color:#888">/' + a.maxScore + '</span></th>'; }).join('');

    var tbodyRows = rt.STATE.students.map(function (s, idx) {
      var tot = rt.fns.studentTotal(s.id);
      var pass = tot >= 7;
      var grades = rt.STATE.activities.map(function (act) {
        var g = rt.fns.getGrade(s.id, act.id);
        return '<td style="text-align:center;font-size:10px;padding:3px 4px;' + (g != null ? '' : 'color:#ccc') + '">' + (g != null ? g.toFixed(1) : '-') + '</td>';
      }).join('');
      return '<tr><td style="text-align:center;font-size:10px;padding:3px 4px">' + (idx + 1) + '</td>' +
        '<td style="font-size:10px;padding:3px 4px">' + escapeHtml(s.codigo || '') + '</td>' +
        '<td style="font-size:10px;padding:3px 4px">' + escapeHtml(s.apellidos + ' ' + s.nombres) + '</td>' +
        grades +
        '<td style="text-align:center;font-size:10px;font-weight:700;padding:3px 4px;color:' + (pass ? '#166534' : '#991b1b') + '">' + tot.toFixed(1) + '</td></tr>';
    }).join('\n');

    var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Calificaciones</title>' +
      '<style>body{font-family:Arial,Helvetica,sans-serif;margin:10px;color:#222}h2{margin:0 0 2px;font-size:15px}.sub{margin:0 0 10px;font-size:11px;color:#666}table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #ccc;padding:4px 5px;text-align:left}th{background:#f5f5f5;font-weight:600}td{vertical-align:top}@media print{body{margin:6px}}' +
      '</style></head><body>' +
      '<h2>Registro de Calificaciones</h2>' +
      '<div class="sub">' + escapeHtml(c.asignatura || '') + ' · ' + escapeHtml(c.carrera || '') + ' · ' + escapeHtml(c.aporte || '') + ' · PAO ' + (c.pao || '') + ' · ' + escapeHtml(c.periodoAcademico || '') + '<br>Fecha: ' + new Date().toLocaleString() + ' · ' + rt.STATE.students.length + ' estudiantes</div>' +
      '<table><thead><tr><th rowspan="2" style="min-width:28px">#</th><th rowspan="2">Cod</th><th rowspan="2" style="min-width:120px">Estudiante</th>' + compHeaders + '<th rowspan="2" style="min-width:40px">Nota</th></tr><tr>' + actHeaders + '</tr></thead><tbody>' + tbodyRows + '</tbody></table>' +
      '<p style="margin-top:8px;font-size:10px;color:#888;text-align:center">Promedio: ' + avg + '/' + totalMax.toFixed(1) + ' | Notas: ' + totalEntered + '/' + totalExpected + ' (' + pct + '%)</p>' +
      '</body></html>';

    // El QR NO puede contener toda la página HTML (excede su capacidad y no se genera).
    // Codificamos un resumen compacto de notas que sí cabe y es escaneable; el detalle
    // completo se abre con "Abrir versión imprimible" o con Exportar PDF.
    function buildQrPayload() {
      var aprob = allTotals.filter(function (t) { return t >= 7; }).length;
      var lines = [];
      lines.push('CALIFICACIONES - ' + (c.asignatura || ''));
      lines.push((c.carrera || '') + ' | ' + (c.aporte || '') + ' | PAO ' + (c.pao || ''));
      lines.push('Periodo: ' + (c.periodoAcademico || '') + ' | ' + new Date().toLocaleDateString());
      lines.push('');
      rt.STATE.students.forEach(function (s, idx) {
        var tot = rt.fns.studentTotal(s.id);
        lines.push((idx + 1) + '. ' + (s.codigo ? s.codigo + ' ' : '') + s.apellidos + ' ' + s.nombres + ' = ' + tot.toFixed(2) + (tot >= 7 ? ' (A)' : ' (R)'));
      });
      lines.push('');
      lines.push('Promedio ' + avg + '/' + totalMax.toFixed(1) + ' | Aprobados ' + aprob + '/' + rt.STATE.students.length);
      var full = lines.join('\n');
      // Tope de seguridad: por encima de esto el QR deja de ser escaneable desde un móvil.
      if (full.length <= 1800) return full;
      return lines.slice(0, 4).join('\n') + '\n' + rt.STATE.students.length + ' estudiantes\n' +
        'Promedio ' + avg + '/' + totalMax.toFixed(1) + ' | Aprobados ' + aprob + '/' + rt.STATE.students.length +
        '\n(Detalle completo en Exportar PDF)';
    }
    var qrPayload = buildQrPayload();

    // Abre la versión imprimible completa para guardar/imprimir PDF desde el navegador.
    function abrirImprimible() {
      var w = window.open('', '_blank');
      if (!w) { rt.fns.showToast('Permita ventanas emergentes para abrir la versión imprimible.', 'error'); return; }
      w.document.write(html);
      w.document.close();
      w.focus();
    }

    var expandedLines = [];
    expandedLines.push('========================================');
    expandedLines.push('REGISTRO DE CALIFICACIONES');
    expandedLines.push('========================================');
    expandedLines.push('Asignatura: ' + (c.asignatura || 'N/A') + ' | Carrera: ' + (c.carrera || 'N/A'));
    expandedLines.push('Aporte: ' + (c.aporte || 'N/A') + ' | PAO: ' + (c.pao || 'N/A') + ' | Periodo: ' + (c.periodoAcademico || 'N/A'));
    expandedLines.push('Fecha: ' + new Date().toLocaleString());
    expandedLines.push('');
    var hdr = 'No. Codigo  Cedula       Apellidos          Nombres           ';
    rt.STATE.activities.forEach(function (a) { hdr += ' ' + a.name.slice(0, 6).padEnd(6); });
    hdr += '  Total';
    expandedLines.push(hdr);
    expandedLines.push(new Array(hdr.length + 1).join('-'));
    rt.STATE.students.forEach(function (s, idx) {
      var r = String(idx + 1).padEnd(3) + (s.codigo || '').padEnd(7) + formatCedula(s.cedula).padEnd(13) + s.apellidos.slice(0, 16).padEnd(17) + s.nombres.slice(0, 16).padEnd(15);
      rt.STATE.activities.forEach(function (act) {
        var g = rt.fns.getGrade(s.id, act.id);
        r += (g != null ? g.toFixed(1) : '-').padStart(7);
      });
      r += rt.fns.studentTotal(s.id).toFixed(1).padStart(7);
      expandedLines.push(r);
    });
    expandedLines.push('');
    expandedLines.push('Promedio: ' + avg + '/' + totalMax.toFixed(1) + ' | Notas: ' + totalEntered + '/' + totalExpected + ' (' + pct + '%) | Estudiantes: ' + rt.STATE.students.length);
    expandedLines.push('========================================');
    var expanded = expandedLines.join('\n');

    var modalBody =
      '<div style="text-align:center;padding:10px">' +
      '<div id="qr-code-container" style="display:inline-block;background:#fff;padding:10px;border-radius:8px;margin-bottom:10px;border:1px solid var(--gray-200)">' +
      '<div id="qr-spinner" style="padding:40px;color:var(--gray-400)">Generando QR...</div>' +
      '</div>' +
      '<p style="font-size:.78rem;color:var(--gray-500);margin:0">Escanee el QR para ver el resumen de calificaciones en el teléfono. Para el detalle completo use "Abrir versión imprimible" o Exportar PDF.</p>' +
      '<p style="font-size:.7rem;color:var(--gray-400);margin-top:6px">' + escapeHtml(c.asignatura || '') + ' · ' + escapeHtml(c.carrera || '') + ' · ' + new Date().toLocaleString() + '</p>' +
      '<div style="margin-top:8px;max-height:140px;overflow:auto;text-align:left;font-family:monospace;font-size:.6rem;background:var(--gray-100);padding:8px;border-radius:6px;white-space:pre;color:var(--gray-600)">' + escapeHtml(expanded) + '</div>' +
      '</div>';

    rt.fns.openModal('Codigo QR - ' + (c.asignatura || 'Calificaciones'), modalBody,
      [
        { label: 'Abrir versión imprimible', cls: 'btn-edit', action: abrirImprimible },
        { label: 'Cerrar', cls: 'btn-primary', action: 'close' }
      ]
    );

    // Carga la librería QR y genera el código a partir del resumen compacto.
    if (window.QRCode) {
      generateQRInline(qrPayload);
    } else {
      var script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
      script.onload = function () { generateQRInline(qrPayload); };
      script.onerror = function () {
        var sp = document.getElementById('qr-spinner');
        if (sp) sp.parentNode.innerHTML = '<img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(qrPayload) + '" alt="QR" style="max-width:250px;border-radius:8px" />';
      };
      document.head.appendChild(script);
    }

    function generateQRInline(text) {
      try {
        var container = document.getElementById('qr-spinner');
        if (!container) return;
        container.innerHTML = '';
        var canvas = document.createElement('canvas');
        canvas.style.width = '240px';
        canvas.style.height = '240px';
        container.parentNode.appendChild(canvas);
        container.remove();
        window.QRCode.toCanvas(canvas, text, { width: 240, margin: 1, errorCorrectionLevel: 'L', color: { dark: '#1a1a2e', light: '#ffffff' } }, function (err) {
          if (err) {
            canvas.parentNode.innerHTML = '<img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(text) + '" alt="QR" style="max-width:250px;border-radius:8px" />';
          }
        });
      } catch {
        var c2 = document.getElementById('qr-code-container');
        if (c2) c2.innerHTML = '<img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(text) + '" alt="QR" style="max-width:250px;border-radius:8px" />';
      }
    }
  }

  function setImportStatus(msg, isError) {
    var status = document.getElementById('est-import-status');
    if (!status) return;
    status.textContent = msg || '';
    status.style.color = isError ? 'var(--red)' : 'var(--gray-500)';
  }

  function requireExportData() {
    if (!rt.STATE.activeConfigId) {
      rt.fns.showToast('Seleccione un PAO desde MIS PAOs.', 'error');
      return false;
    }
    if (!rt.STATE.students || rt.STATE.students.length === 0) {
      rt.fns.showToast('No hay estudiantes registrados.', 'error');
      return false;
    }
    if (!rt.STATE.activities || rt.STATE.activities.length === 0) {
      rt.fns.showToast('No hay actividades configuradas.', 'error');
      return false;
    }
    return true;
  }

  function buildGradesExportPayload(kind) {
    rt.fns.syncActivitiesWithRAAU();
    var c = rt.STATE.courseConfig || {};
    var activities = (rt.STATE.activities || []).map(function (a) {
      return {
        id: a.id,
        component: a.component,
        name: a.name,
        maxScore: Number(a.maxScore) || 0,
        procedure: a.procedure || '',
        racId: a.racId || '',
        raauId: a.raauId || ''
      };
    });
    var totalMax = activities.reduce(function (sum, a) { return sum + (Number(a.maxScore) || 0); }, 0);
    var students = (rt.STATE.students || []).map(function (s, idx) {
      var grades = activities.map(function (act) {
        var score = rt.fns.getGrade(s.id, act.id);
        return { activityId: act.id, score: score };
      });
      var total = rt.fns.studentTotal(s.id);
      return {
        index: idx + 1,
        id: s.id,
        codigo: s.codigo || '',
        cedula: formatCedula(s.cedula),
        apellidos: s.apellidos || '',
        nombres: s.nombres || '',
        grades: grades,
        total: total,
        estado: total >= 7 ? 'APROBADO' : 'REPROBADO'
      };
    });
    return {
      kind: kind || 'grades',
      generatedAt: new Date().toISOString(),
      meta: {
        periodoAcademico: c.periodoAcademico || '',
        facultad: c.facultad || 'SEDE ORELLANA',
        carrera: c.carrera || '',
        asignatura: c.asignatura || '',
        docente: c.docente || ((rt.STATE.currentUser && rt.STATE.currentUser.name) || ''),
        pao: c.pao || '',
        aporte: c.aporte || '',
        totalMax: totalMax
      },
      activities: activities,
      students: students
    };
  }

  function exportPayloadExcel(kind) {
    if (!requireExportData()) return;
    var payload = buildGradesExportPayload(kind || 'grades');
    var name = fileSlug([payload.meta.asignatura, payload.meta.aporte, 'calificaciones'].filter(Boolean).join('_'));
    downloadTextFile(name + '.xls', buildGradesExcelXml(payload), 'application/vnd.ms-excel;charset=utf-8');
    rt.fns.showToast('Excel generado con formulas.', 'success');
  }

  function loadScriptOnce(src) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[src="' + src + '"]');
      if (existing) return resolve();
      var script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function ensurePdfLibraries() {
    if (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API && window.jspdf.jsPDF.API.autoTable) return;
    await loadScriptOnce('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
    await loadScriptOnce('https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js');
  }

  async function exportPayloadPDF(kind) {
    if (!requireExportData()) return;
    var payload = buildGradesExportPayload(kind || 'grades');
    try {
      await ensurePdfLibraries();
      var jsPDF = window.jspdf.jsPDF;
      var doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      var meta = payload.meta || {};
      var activities = payload.activities || [];
      var head = [['No.', 'Codigo', 'Cedula', 'Apellidos', 'Nombres'].concat(activities.map(function (a) { return a.name; }), ['Nota'])];
      var body = (payload.students || []).map(function (s, idx) {
        return [idx + 1, s.codigo || '', s.cedula || '', s.apellidos || '', s.nombres || '']
          .concat(activities.map(function (act) {
            var g = (s.grades || []).find(function (x) { return x.activityId === act.id; });
            return g && g.score != null ? Number(g.score).toFixed(2) : '-';
          }), [Number(s.total || 0).toFixed(2)]);
      });
      doc.setFontSize(13);
      doc.text(kind === 'report' ? 'Reporte Final de Calificaciones' : 'Registro de Calificaciones', 40, 34);
      doc.setFontSize(9);
      doc.text([meta.asignatura, meta.carrera, 'PAO ' + (meta.pao || ''), meta.aporte, meta.periodoAcademico].filter(Boolean).join(' - '), 40, 50);
      doc.text('Docente: ' + (meta.docente || '-') + ' | Estudiantes: ' + body.length, 40, 64);
      doc.autoTable({
        head: head,
        body: body,
        startY: 78,
        styles: { fontSize: 7, cellPadding: 3, overflow: 'linebreak' },
        headStyles: { fillColor: [204, 0, 0] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 24, right: 24 }
      });
      var name = fileSlug([meta.asignatura, meta.aporte, kind || 'calificaciones'].filter(Boolean).join('_'));
      doc.rt.fns.save(name + '.pdf');
      rt.fns.showToast('PDF generado.', 'success');
    } catch {
      rt.fns.showToast('No se pudo generar PDF automatico. Revise la conexion a internet para cargar la libreria PDF.', 'error');
    }
  }

  function renderQrCanvas(text) {
    var container = document.getElementById('qr-spinner');
    if (!container) return;
    container.innerHTML = '';
    var canvas = document.createElement('canvas');
    canvas.style.width = '240px';
    canvas.style.height = '240px';
    container.parentNode.appendChild(canvas);
    container.remove();
    window.QRCode.toCanvas(canvas, text, {
      width: 240,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#1a1a2e', light: '#ffffff' }
    }, function (err) {
      if (err) {
        canvas.parentNode.innerHTML = '<img src="https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=' +
          encodeURIComponent(text) + '" alt="QR" style="max-width:260px;border-radius:8px" />';
      }
    });
  }

  async function showExportQR(kind) {
    if (!requireExportData()) return;
    var payload = buildGradesExportPayload(kind || 'grades');
    var exportUrl = '';
    var modalBody =
      '<div style="text-align:center;padding:10px">' +
      '<div id="qr-code-container" style="display:inline-block;background:#fff;padding:10px;border-radius:8px;margin-bottom:10px;border:1px solid var(--gray-200)">' +
      '<div id="qr-spinner" style="padding:40px;color:var(--gray-400)">Preparando enlace de descarga...</div>' +
      '</div>' +
      '<p style="font-size:.78rem;color:var(--gray-600);margin:0">Escanee el QR para abrir una pagina de descarga con Excel con formulas y PDF.</p>' +
      '<p style="font-size:.7rem;color:var(--gray-400);margin-top:6px">' + escapeHtml(payload.meta.asignatura || '') + ' - ' + escapeHtml(payload.meta.carrera || '') + ' - ' + new Date().toLocaleString() + '</p>' +
      '<div id="qr-link-info" style="font-size:.7rem;color:var(--gray-500);margin-top:8px;word-break:break-all"></div>' +
      '</div>';
    window.__openQrExport = function () {
      if (exportUrl) window.open(exportUrl, '_blank', 'noopener');
      else rt.fns.showToast('El enlace de descarga aun no esta listo.', 'error');
    };
    rt.fns.openModal((kind === 'report' ? 'QR Reporte Final' : 'QR Calificaciones'), modalBody, [
      { label: 'Abrir descarga', cls: 'btn-edit', action: function () { window.__openQrExport(); } },
      { label: 'Cerrar', cls: 'btn-primary', action: 'close' }
    ]);
    try {
      var res = await oasis.createExportPage(payload);
      exportUrl = (res && res.pageUrl) || '';
      if (!exportUrl) throw new Error('Sin URL de descarga.');
      var info = document.getElementById('qr-link-info');
      if (info) info.textContent = exportUrl;
      if (window.QRCode) renderQrCanvas(exportUrl);
      else {
        var script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
        script.onload = function () { renderQrCanvas(exportUrl); };
        script.onerror = function () {
          var sp = document.getElementById('qr-spinner');
          if (sp) sp.parentNode.innerHTML = '<img src="https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=' + encodeURIComponent(exportUrl) + '" alt="QR" style="max-width:260px;border-radius:8px" />';
        };
        document.head.appendChild(script);
      }
    } catch {
      var sp = document.getElementById('qr-spinner');
      if (sp) sp.textContent = 'No se pudo crear el enlace QR. Verifique que el BFF este ejecutandose.';
      rt.fns.showToast('No se pudo crear el enlace QR de descarga.', 'error');
    }
  }

  function exportGradesExcel() { exportPayloadExcel('grades'); }
  function exportReportExcel() { exportPayloadExcel('report'); }
  function exportReportPDF() { exportPayloadPDF('report'); }
  function showReportQR() { showExportQR('report'); }

  // Sincronización con OASIS: agrega nuevos, actualiza datos existentes, conserva calificaciones.
  async function showOasisImport() {
    if (!rt.STATE.activeConfigId) {
      rt.fns.showToast('Primero seleccione un PAO desde MIS PAOs.', 'error');
      return;
    }
    var c = rt.STATE.courseConfig || {};
    if (!c.carrera || !c.asignatura) {
      rt.fns.showToast('La configuración activa no tiene carrera/asignatura.', 'error');
      return;
    }
    var importBtn = document.getElementById('est-oasis-btn');
    if (importBtn) { importBtn.disabled = true; importBtn.textContent = 'Sincronizando…'; }

    setImportStatus('Sincronizando nómina de "' + c.asignatura + '" con OASIS…', false);

    try {
      var alumnos, r;
      var foundCfg = rt.STATE.savedConfigs.find(function (cc) { return cc.id === rt.STATE.activeConfigId; });
      var saveCodesToConfigs = function (src) {
        if (!src) return;
        if (src.codCarrera) {
          rt.STATE.courseConfig.codCarrera = src.codCarrera;
          if (foundCfg) foundCfg.courseConfig.codCarrera = src.codCarrera;
        }
        if (src.codMateria) {
          rt.STATE.courseConfig.codMateria = src.codMateria;
          if (foundCfg) foundCfg.courseConfig.codMateria = src.codMateria;
        }
        if (src.codNivel) {
          rt.STATE.courseConfig.codNivel = src.codNivel;
          if (foundCfg) foundCfg.courseConfig.codNivel = src.codNivel;
        }
        if (src.paralelo) {
          rt.STATE.courseConfig.codParalelo = src.paralelo;
          if (foundCfg) foundCfg.courseConfig.codParalelo = src.paralelo;
        }
        if (src.codPeriodo) {
          rt.STATE.courseConfig.codPeriodo = src.codPeriodo;
          if (foundCfg) foundCfg.courseConfig.codPeriodo = src.codPeriodo;
        }
        rt.fns.save();
      };
      if (c.codCarrera && c.codMateria && c.codNivel && c.codParalelo) {
        var codPeriodo = c.codPeriodo || (rt.STATE.oasisPeriodo && rt.STATE.oasisPeriodo.codigo) || '';
        if (!codPeriodo) {
          var periodoActual = await oasis.getPeriodoActual();
          codPeriodo = (periodoActual && periodoActual.codigo) || '';
          if (codPeriodo) {
            rt.STATE.oasisPeriodo = periodoActual;
            c.codPeriodo = codPeriodo;
            saveCodesToConfigs({ codPeriodo: codPeriodo });
          }
        }
        if (!codPeriodo) {
          setImportStatus('No hay código de período disponible. Intente importar manualmente.', true);
          showOasisImportManual();
          return;
        }
        alumnos = await oasis.getAlumnosMateria({
          codCarrera: c.codCarrera, codNivel: c.codNivel, codParalelo: c.codParalelo,
          codPeriodo: codPeriodo, codMateria: c.codMateria
        });
        r = { materia: c.asignatura, nivel: c.codNivel, paralelo: c.codParalelo, periodo: c.periodoAcademico || codPeriodo };
      } else {
        var res = await oasis.importarNomina({ carrera: c.carrera, asignatura: c.asignatura, facultad: c.facultad, docente: c.docente, codCarrera: c.codCarrera || '', paralelo: c.codParalelo || c.paralelo || '' });
        alumnos = (res && res.estudiantes) || [];
        r = (res && res.resuelto) || {};
        saveCodesToConfigs(r);
      }
      if (!alumnos || alumnos.length === 0) {
        setImportStatus('OASIS no registra estudiantes matriculados en "' + c.asignatura + '" para el período actual.', true);
        rt.fns.showToast('Sin estudiantes matriculados en OASIS', 'error');
        return;
      }
      // Upsert: agregar nuevos, actualizar existentes, conservar calificaciones
      var paoKey = rt.STATE.activeConfigId;
      var normalizeCed = function (v) { return String(v || '').replace(/[^0-9]/g, ''); };
      var existingStudents = rt.STATE.studentsByConfig[paoKey] || [];
      var cedToStudent = {};
      existingStudents.forEach(function (s) { cedToStudent[normalizeCed(s.cedula)] = s; });
      var toAdd = [];
      var updateCount = 0;
      alumnos.forEach(function (a) {
        var ced = normalizeCed(a.cedula);
        if (!ced) return;
        var match = cedToStudent[ced];
        if (match) {
          match.apellidos = (a.apellidos || '').toUpperCase();
          match.nombres = (a.nombres || '').toUpperCase();
          if (a.codigo) match.codigo = a.codigo;
          updateCount++;
        } else {
          toAdd.push({
            id: 's' + Date.now() + Math.random().toString(36).slice(2, 6),
            codigo: a.codigo || '',
            cedula: a.cedula,
            apellidos: (a.apellidos || '').toUpperCase(),
            nombres: (a.nombres || '').toUpperCase()
          });
        }
      });
      if (toAdd.length > 0) existingStudents = existingStudents.concat(toAdd);
      if (toAdd.length > 0 || updateCount > 0) {
        rt.STATE.studentsByConfig[paoKey] = existingStudents;
        rt.STATE.students = JSON.parse(JSON.stringify(existingStudents));
        rt.fns.save();
      }
      var detalle = (r.materia || c.asignatura) + ' · Nivel ' + (r.nivel || r.codNivel || '?') + ' · Paralelo ' + (r.paralelo || '?') + ' · ' + (r.periodo || '');
      if (toAdd.length === 0 && updateCount === 0) {
        setImportStatus('Nómina de OASIS sin cambios (' + alumnos.length + ' estudiantes). ' + detalle, false);
        rt.fns.showToast('Nómina actualizada — sin cambios', 'success');
      } else {
        var msgParts = [];
        if (toAdd.length > 0) msgParts.push(toAdd.length + ' agregados');
        if (updateCount > 0) msgParts.push(updateCount + ' actualizados');
        setImportStatus(msgParts.join(', ') + ' — ' + detalle, false);
        rt.fns.addRecentActivity('OASIS: ' + msgParts.join(', '), 'student');
        rt.fns.showToast(msgParts.join(', ') + ' desde OASIS', 'success');
      }
      renderEstudiantes();
    } catch (err) {
      var errorMsg = err && err.message ? err.message : 'Error desconocido al sincronizar.';
      if (err && err.offline) errorMsg = 'OASIS/BFF no disponible.';
      setImportStatus(errorMsg, true);
      rt.fns.showToast(errorMsg, 'error');
      var statusBar = document.getElementById('est-import-status');
      if (statusBar) {
        statusBar.innerHTML = '<span style="color:var(--red)">' + escapeHtml(errorMsg) + '</span>' +
          '<button class="btn btn-ghost btn-sm" style="margin-left:8px;vertical-align:middle" onclick="showOasisImportManual()">Ingreso manual</button>';
      }
    } finally {
      if (importBtn) { importBtn.disabled = false; updateOasisButtonText(); }
    }
  }

  function updateOasisButtonText() {
    var btn = document.getElementById('est-oasis-btn');
    if (!btn) return;
    btn.textContent = 'Actualizar';
  }

  // Respaldo manual (offline o cuando la resolución automática falla).
  function showOasisImportManual() {
    if (!rt.STATE.configLocked || !rt.STATE.activeConfigId) return;
    var c = rt.STATE.courseConfig || {};
    var periodo = (rt.STATE.oasisPeriodo && rt.STATE.oasisPeriodo.codigo) || '';
    var prefillCarrera = c.codCarrera || '';
    var prefillPeriodo = c.codPeriodo || periodo || '';
    var prefillNivel = c.codNivel || '';
    var prefillParalelo = c.codParalelo || '';
    var prefillMateria = c.codMateria || '';
    var prefillInfo = '';
    if (prefillCarrera || prefillNivel || prefillParalelo || prefillMateria) {
      prefillInfo = '<div style="background:var(--gray-100);border-radius:8px;padding:8px 12px;margin-bottom:12px;font-size:.75rem;color:var(--gray-600)">' +
        '<strong>Datos conocidos del sistema:</strong><br>' +
        (prefillCarrera ? 'Carrera: ' + c.carrera + ' (' + prefillCarrera + ')<br>' : '') +
        (prefillPeriodo ? 'Período: ' + (c.periodoAcademico || '') + ' (' + prefillPeriodo + ')<br>' : '') +
        (prefillNivel ? 'Nivel: ' + prefillNivel + '<br>' : '') +
        (prefillParalelo ? 'Paralelo: ' + prefillParalelo + '<br>' : '') +
        (prefillMateria ? 'Código materia: ' + prefillMateria : '') +
        '</div>';
    }
    rt.fns.openModal('Importar nómina desde OASIS',
      '<p style="color:var(--gray-600);font-size:.8rem;margin-bottom:12px">Ingrese los códigos OASIS para importar la nómina de estudiantes.</p>' +
      prefillInfo +
      '<div class="form-grid"><div class="form-group"><label class="form-label">Código carrera</label><input class="form-input" id="oas-carrera" value="' + prefillCarrera + '" placeholder="Ej: ITIO"></div>' +
      '<div class="form-group"><label class="form-label">Código período</label><input class="form-input" id="oas-periodo" value="' + prefillPeriodo + '" placeholder="Ej: P0045"></div></div>' +
      '<div class="form-grid-3"><div class="form-group"><label class="form-label">Nivel</label><input class="form-input" id="oas-nivel" value="' + prefillNivel + '" placeholder="Ej: 1"></div>' +
      '<div class="form-group"><label class="form-label">Paralelo</label><input class="form-input" id="oas-paralelo" value="' + prefillParalelo + '" placeholder="Ej: 1"></div>' +
      '<div class="form-group"><label class="form-label">Código materia</label><input class="form-input" id="oas-materia" value="' + prefillMateria + '" placeholder="Ej: TEI1TB02"></div></div>' +
      '<div id="oas-import-msg" style="font-size:.78rem;color:var(--gray-500);min-height:18px;margin-top:8px"></div>',
      [
        { label: 'Cancelar', cls: 'btn-ghost', action: 'close' },
        { label: 'Importar', cls: 'btn-primary', action: doOasisImport }
      ]);
  }

  async function doOasisImport() {
    var get = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
    var params = {
      codCarrera: get('oas-carrera'),
      codNivel: get('oas-nivel'),
      codParalelo: get('oas-paralelo'),
      codPeriodo: get('oas-periodo'),
      codMateria: get('oas-materia')
    };
    var msg = document.getElementById('oas-import-msg');
    var setMsg = function (text, error) {
      if (msg) { msg.textContent = text; msg.style.color = error ? 'var(--red)' : 'var(--gray-500)'; }
    };
    var importBtn = document.querySelector('.modal-actions .btn-primary');
    if (importBtn) { importBtn.disabled = true; importBtn.textContent = 'Importando…'; }
    if (!params.codCarrera || !params.codPeriodo || !params.codMateria) {
      setMsg('Carrera, período y materia son obligatorios.', true);
      if (importBtn) { importBtn.disabled = false; importBtn.textContent = 'Importar'; }
      return;
    }
    if (!/^P\d{4}$/i.test(params.codPeriodo)) {
      setMsg('El código de período debe tener formato P seguido de 4 dígitos (ej: P0045).', true);
      if (importBtn) { importBtn.disabled = false; importBtn.textContent = 'Importar'; }
      return;
    }
    if (params.codNivel && !/^\d+$/.test(params.codNivel)) {
      setMsg('El nivel debe ser numérico.', true);
      if (importBtn) { importBtn.disabled = false; importBtn.textContent = 'Importar'; }
      return;
    }
    if (params.codParalelo && !/^\d+$/.test(params.codParalelo)) {
      setMsg('El paralelo debe ser numérico.', true);
      if (importBtn) { importBtn.disabled = false; importBtn.textContent = 'Importar'; }
      return;
    }
    setMsg('Consultando OASIS…', false);
    try {
      var alumnos = await oasis.getAlumnosMateria(params);
      if (!alumnos || alumnos.length === 0) {
        setMsg('No se encontraron estudiantes para esos parámetros.', true);
        return;
      }
      // Upsert: agregar nuevos, actualizar existentes, conservar calificaciones
      var paoKey = rt.STATE.activeConfigId || '';
      var existingStudents = (rt.STATE.studentsByConfig[paoKey] || []).slice();
      var normalizeCed = function (v) { return String(v || '').replace(/[^0-9]/g, ''); };
      var cedMap = {};
      existingStudents.forEach(function (s) { cedMap[normalizeCed(s.cedula)] = s; });
      var addCount = 0, updateCount = 0;
      alumnos.forEach(function (a) {
        var ced = normalizeCed(a.cedula);
        if (!ced) return;
        var match = cedMap[ced];
        if (match) {
          match.apellidos = (a.apellidos || '').toUpperCase();
          match.nombres = (a.nombres || '').toUpperCase();
          if (a.codigo) match.codigo = a.codigo;
          updateCount++;
        } else {
          existingStudents.push({
            id: 's' + Date.now() + Math.random().toString(36).slice(2, 6),
            codigo: a.codigo || '',
            cedula: a.cedula,
            apellidos: (a.apellidos || '').toUpperCase(),
            nombres: (a.nombres || '').toUpperCase()
          });
          addCount++;
        }
      });
      if (addCount > 0 || updateCount > 0) {
        rt.STATE.studentsByConfig[paoKey] = existingStudents;
        rt.STATE.students = JSON.parse(JSON.stringify(existingStudents));
        rt.fns.persistActiveConfigData();
        rt.fns.save();
        renderEstudiantes();
      }
      // Persistir códigos usados para próximas sincronizaciones automáticas
      var foundCfg = rt.STATE.savedConfigs.find(function (cc) { return cc.id === paoKey; });
      if (foundCfg) {
        if (params.codCarrera) { rt.STATE.courseConfig.codCarrera = params.codCarrera; foundCfg.courseConfig.codCarrera = params.codCarrera; }
        if (params.codMateria) { rt.STATE.courseConfig.codMateria = params.codMateria; foundCfg.courseConfig.codMateria = params.codMateria; }
        if (params.codNivel)   { rt.STATE.courseConfig.codNivel   = params.codNivel;   foundCfg.courseConfig.codNivel   = params.codNivel; }
        if (params.codParalelo) { rt.STATE.courseConfig.codParalelo = params.codParalelo; foundCfg.courseConfig.codParalelo = params.codParalelo; }
        if (params.codPeriodo) { rt.STATE.courseConfig.codPeriodo = params.codPeriodo; foundCfg.courseConfig.codPeriodo = params.codPeriodo; }
        rt.fns.save();
      }
      rt.fns.addRecentActivity('OASIS: ' + (addCount > 0 ? addCount + ' agregados' : '') + (addCount > 0 && updateCount > 0 ? ', ' : '') + (updateCount > 0 ? updateCount + ' actualizados' : ''), 'student');
      rt.fns.closeModal();
      rt.fns.showToast(addCount > 0 || updateCount > 0 ? (addCount + ' agregados, ' + updateCount + ' actualizados') : 'Sin cambios', 'success');
    } catch (err) {
      setMsg(err && err.offline ? 'Servicio OASIS/BFF no disponible.' : (err.message || 'Error al importar.'), true);
    } finally {
      if (importBtn) { importBtn.disabled = false; importBtn.textContent = 'Importar'; }
    }
  }

  async function syncStudentsFromOasis(paoId) {
    if (!paoId) return null;
    var found = rt.STATE.savedConfigs.find(function (c) { return c.id === paoId; });
    if (!found) return null;
    var c = found.courseConfig || {};
    if (!c.carrera || !c.asignatura) return { added: 0, updated: 0, unchanged: 0, errors: 0 };
    var result = { added: 0, updated: 0, unchanged: 0, errors: 0 };
    try {
      var alumnos, r;
      if (c.codCarrera && c.codMateria && c.codNivel && c.codParalelo) {
        var codPeriodo = c.codPeriodo || (rt.STATE.oasisPeriodo && rt.STATE.oasisPeriodo.codigo) || '';
        if (!codPeriodo) {
          var periodoActual = await oasis.getPeriodoActual();
          codPeriodo = (periodoActual && periodoActual.codigo) || '';
          if (codPeriodo) {
            rt.STATE.oasisPeriodo = periodoActual;
            c.codPeriodo = codPeriodo;
            if (paoId === rt.STATE.activeConfigId) rt.STATE.courseConfig.codPeriodo = codPeriodo;
            rt.fns.save();
          }
        }
        if (!codPeriodo) return result;
        alumnos = await oasis.getAlumnosMateria({
          codCarrera: c.codCarrera, codNivel: c.codNivel, codParalelo: c.codParalelo,
          codPeriodo: codPeriodo, codMateria: c.codMateria
        });
      } else {
        var res = await oasis.importarNomina({ carrera: c.carrera, asignatura: c.asignatura, facultad: c.facultad, docente: c.docente, codCarrera: c.codCarrera || '', paralelo: c.codParalelo || c.paralelo || '' });
        alumnos = (res && res.estudiantes) || [];
        r = (res && res.resuelto) || {};
        if (r.codCarrera) { c.codCarrera = r.codCarrera; if (paoId === rt.STATE.activeConfigId) rt.STATE.courseConfig.codCarrera = r.codCarrera; }
        if (r.codMateria) { c.codMateria = r.codMateria; if (paoId === rt.STATE.activeConfigId) rt.STATE.courseConfig.codMateria = r.codMateria; }
        if (r.codNivel)   { c.codNivel   = r.codNivel;   if (paoId === rt.STATE.activeConfigId) rt.STATE.courseConfig.codNivel = r.codNivel; }
        if (r.paralelo)   { c.codParalelo = r.paralelo;   if (paoId === rt.STATE.activeConfigId) rt.STATE.courseConfig.codParalelo = r.paralelo; }
        if (r.codPeriodo) { c.codPeriodo = r.codPeriodo; if (paoId === rt.STATE.activeConfigId) rt.STATE.courseConfig.codPeriodo = r.codPeriodo; }
        rt.fns.save();
      }
      if (!alumnos || alumnos.length === 0) return result;
      var normalizeCed = function (v) { return String(v || '').replace(/[^0-9]/g, ''); };
      var existingStudents = rt.STATE.studentsByConfig[paoId] || [];
      var cedToStudent = {};
      existingStudents.forEach(function (s) { cedToStudent[normalizeCed(s.cedula)] = s; });
      var toAdd = [];
      var updateCount = 0;
      alumnos.forEach(function (a) {
        var ced = normalizeCed(a.cedula);
        if (!ced) return;
        var match = cedToStudent[ced];
        if (match) {
          match.apellidos = (a.apellidos || '').toUpperCase();
          match.nombres = (a.nombres || '').toUpperCase();
          if (a.codigo) match.codigo = a.codigo;
          updateCount++;
        } else {
          toAdd.push({
            id: 's' + Date.now() + Math.random().toString(36).slice(2, 6),
            codigo: a.codigo || '',
            cedula: a.cedula,
            apellidos: (a.apellidos || '').toUpperCase(),
            nombres: (a.nombres || '').toUpperCase()
          });
        }
      });
      if (toAdd.length > 0) existingStudents = existingStudents.concat(toAdd);
      if (toAdd.length > 0 || updateCount > 0) {
        rt.STATE.studentsByConfig[paoId] = existingStudents;
        if (paoId === rt.STATE.activeConfigId) {
          rt.STATE.students = JSON.parse(JSON.stringify(existingStudents));
        }
        rt.fns.save();
      }
      result = { added: toAdd.length, updated: updateCount, unchanged: existingStudents.length - toAdd.length, errors: 0 };
    } catch (err) {
      result.errors = 1;
      throw err;
    }
    return result;
  }





  function editStudent(id) {
    var student = rt.STATE.students.find(function (x) { return x.id === id; });
    if (!student) return;
    rt.fns.openModal('Editar Estudiante',
      '<div class="form-group"><label class="form-label">Cédula</label><input class="form-input" id="m-ced" value="' + formatCedula(student.cedula) + '"></div>' +
      '<div class="form-group"><label class="form-label">Apellidos</label><input class="form-input" id="m-ape" value="' + student.apellidos + '"></div>' +
      '<div class="form-group"><label class="form-label">Nombres</label><input class="form-input" id="m-nom" value="' + student.nombres + '"></div>',
      [
        { label: 'Cancelar', cls: 'btn-ghost', action: 'close' },
        { label: 'Guardar', cls: 'btn-success', action: function () {
          student.cedula = document.getElementById('m-ced').value.replace(/[^0-9]/g, '');
          student.apellidos = document.getElementById('m-ape').value.toUpperCase();
          student.nombres = document.getElementById('m-nom').value.toUpperCase();
          rt.fns.persistActiveConfigData();
          rt.fns.save(); renderEstudiantes(); rt.fns.closeModal();
          rt.fns.showToast('Estudiante actualizado', 'success');
        } }
      ]);
  }

  function confirmDelete(id) {
    var student = rt.STATE.students.find(function (x) { return x.id === id; });
    rt.fns.openModal('Eliminar Estudiante',
      '<p style="color:var(--gray-600);font-size:.85rem">¿Desea eliminar a <strong>' + student.apellidos + ' ' + student.nombres + '</strong>? Se eliminarán sus calificaciones.</p>',
      [
        { label: 'Cancelar', cls: 'btn-ghost', action: 'close' },
        { label: 'Eliminar', cls: 'btn-danger', action: function () {
          rt.STATE.students = rt.STATE.students.filter(function (x) { return x.id !== id; });
          rt.STATE.grades = rt.STATE.grades.filter(function (g) { return g.studentId !== id; });
          rt.fns.persistActiveConfigData();
          rt.fns.save(); renderEstudiantes(); rt.fns.closeModal();
          rt.fns.showToast('Estudiante eliminado', 'success');
        } }
      ]);
  }

  function renderCalificaciones() {
    if (!rt.STATE.activeConfigId) {
      document.getElementById('cal-sub').textContent = 'Seleccione un PAO desde MIS PAOs para registrar calificaciones.';
      document.getElementById('cal-legend').innerHTML = '';
      updateReportAvailability();
      document.getElementById('cal-table-wrap').innerHTML = '<div style="padding:24px;text-align:center;color:var(--gray-500);font-size:.85rem">Seleccione un PAO desde MIS PAOs para registrar calificaciones.</div>';
      document.getElementById('cal-progress-label').textContent = '0/0 notas';
      document.getElementById('cal-progress-fill').style.width = '0%';
      document.getElementById('cal-progress-pct').textContent = '0%';
      return;
    }
    if (rt.STATE.students.length === 0) {
      document.getElementById('cal-sub').textContent = 'No hay estudiantes registrados para el PAO activo.';
      document.getElementById('cal-legend').innerHTML = '';
      updateReportAvailability();
      document.getElementById('cal-table-wrap').innerHTML = '<div style="padding:24px;text-align:center;color:var(--gray-500);font-size:.85rem">No hay estudiantes registrados para este PAO. Vaya a Estudiantes y presione "Actualizar".</div>';
      document.getElementById('cal-progress-label').textContent = '0/0 notas';
      document.getElementById('cal-progress-fill').style.width = '0%';
      document.getElementById('cal-progress-pct').textContent = '0%';
      return;
    }
    var config = rt.STATE.courseConfig;
    document.getElementById('cal-sub').textContent = (config.asignatura || 'Sin Asignatura') + ' — ' + config.aporte + ' — PAO ' + config.pao;
    document.getElementById('cal-legend').innerHTML = COMPONENTS.map(function (comp) {
      return '<div class="comp-legend"><div class="comp-dot" style="background:' + COMPONENT_COLORS[comp] + '"></div>' + comp + ' (' + COMPONENT_WEIGHTS[comp] + ' pts)</div>';
    }).join('') + '<div class="comp-legend" style="margin-left:12px"><div style="width:11px;height:11px;border-radius:3px;background:#f0fdf4;border:1px solid #bbf7d0"></div> Con nota</div><div class="comp-legend"><div style="width:11px;height:11px;border-radius:3px;background:var(--gray-100);border:1px solid var(--gray-200)"></div> Sin nota</div>';
    updateReportAvailability();
    renderGradeTable();
  }

  function isGradesComplete() {
    var totalExpected = rt.STATE.students.length * rt.STATE.activities.length;
    if (totalExpected === 0) return false;
    var totalEntered = 0;
    rt.STATE.students.forEach(function (student) {
      rt.STATE.activities.forEach(function (act) {
        var grade = rt.fns.getGrade(student.id, act.id);
        if (grade != null) totalEntered++;
      });
    });
    return totalEntered === totalExpected;
  }

  function updateReportAvailability() {
    var reportNav = document.querySelector('.nav-item[data-page="reporte"]');
    if (!reportNav) return;
    reportNav.style.opacity = '1';
    reportNav.style.pointerEvents = 'auto';
    reportNav.dataset.locked = '0';
  }

  function updateGradeProgress() {
    var activities = rt.STATE.activities || [];
    var totalExpected = (rt.STATE.students || []).length * activities.length;
    var totalEntered = 0;
    (rt.STATE.students || []).forEach(function (student) {
      activities.forEach(function (act) {
        var grade = rt.fns.getGrade(student.id, act.id);
        if (grade != null) totalEntered++;
      });
    });
    var progressPct = pct(totalEntered, totalExpected);
    var label = document.getElementById('cal-progress-label');
    var fill = document.getElementById('cal-progress-fill');
    var pctEl = document.getElementById('cal-progress-pct');
    if (label) label.textContent = totalEntered + '/' + totalExpected + ' notas';
    if (fill) {
      fill.style.width = Math.min(progressPct, 100) + '%';
      fill.style.background = progressPct < 40 ? 'var(--red)' : (progressPct < 80 ? 'var(--amber)' : 'var(--green)');
    }
    if (pctEl) pctEl.textContent = Math.min(progressPct, 100) + '%';
  }

  function refreshGradeRowTotals(sid) {
    var tot = rt.fns.studentTotal(sid);
    document.querySelectorAll('[data-total-sid]').forEach(function (el) {
      if (el.dataset.totalSid === sid) el.value = fmt(tot);
    });
    document.querySelectorAll('[data-final-sid]').forEach(function (el) {
      if (el.dataset.finalSid !== sid) return;
      el.value = fmt(tot);
      el.classList.toggle('pass', tot >= 7);
      el.classList.toggle('fail', tot < 7);
    });
    updateGradeProgress();
    updateReportAvailability();
  }

  function renderGradeTable() {
    rt.fns.syncActivitiesWithRAAU();
    var query = (document.getElementById('cal-search') ? document.getElementById('cal-search').value : '').toLowerCase();
    var queryClean = query.replace(/-/g, '');
    var filtered = rt.STATE.students.filter(function (s) {
      var cedClean = (s.cedula || '').replace(/-/g, '');
      var searchStr = (s.apellidos + ' ' + s.nombres + ' ' + s.cedula + ' ' + (s.codigo || '') + ' ' + cedClean).toLowerCase();
      return searchStr.indexOf(query) !== -1 || searchStr.indexOf(queryClean) !== -1;
    });
    var activities = rt.STATE.activities;
    if (activities.length === 0) {
      document.getElementById('cal-progress-label').textContent = '0/0 notas';
      document.getElementById('cal-progress-fill').style.width = '0%';
      document.getElementById('cal-progress-pct').textContent = '0%';
      document.getElementById('cal-table-wrap').innerHTML =
        '<div style="padding:18px;color:var(--gray-600);font-size:.85rem">No hay actividades configuradas todavía. Vaya a Configuración y registre actividades por componente para habilitar la tabla completa de calificaciones.</div>';
      updateReportAvailability();
      return;
    }
    updateGradeProgress();

    var grouped = COMPONENTS.map(function (comp) {
      return { comp: comp, acts: activities.filter(function (a) { return a.component === comp; }) };
    });

    var html = '<table class="grade-table results-table"><thead>';
    html += '<tr><th colspan="5" style="text-align:left">Resultado de aprendizaje de la carrera alcanzado</th>';
    grouped.forEach(function (grp) {
      if (grp.acts.length === 0) html += '<th style="font-size:.62rem">—</th>';
      grp.acts.forEach(function (act) {
        var linkedRaau = rt.STATE.raauEntries.find(function (r) { return r.id === act.raauId; });
        var rac = rt.CAREER_RACS.find(function (r) { return r.id === (linkedRaau ? linkedRaau.racId : act.racId); });
        html += '<th style="font-size:.62rem">' + (rac ? rac.code : 'RAC') + '</th>';
      });
    });
    html += '<th rowspan="4">SUMA</th><th rowspan="4">NOTA<br>FINAL</th></tr>';

    html += '<tr><th colspan="5" style="text-align:left">Resultado de aprendizaje de la asignatura alcanzado</th>';
    grouped.forEach(function (grp) {
      if (grp.acts.length === 0) html += '<th style="font-size:.62rem">—</th>';
      grp.acts.forEach(function (act) {
        var raau = rt.STATE.raauEntries.find(function (r) { return r.id === act.raauId; });
        html += '<th style="font-size:.62rem">' + (raau ? raau.code : 'RAAU') + '</th>';
      });
    });
    html += '</tr>';

    html += '<tr><th rowspan="2" style="min-width:35px">No.</th><th rowspan="2">Código</th><th rowspan="2">Cédula</th><th rowspan="2">Apellidos</th><th rowspan="2">Nombres</th>';
    grouped.forEach(function (grp) {
      var bg = grp.comp === 'ACD' ? '#8bc34a' : grp.comp === 'APEX' ? '#7cb342' : '#689f38';
      var colSpan = Math.max(grp.acts.length, 1);
      html += '<th colspan="' + colSpan + '" style="background:' + bg + ';color:#111">' + grp.comp + ' (' + COMPONENT_WEIGHTS[grp.comp] + ')</th>';
    });
    html += '</tr><tr>';
    grouped.forEach(function (grp) {
      if (grp.acts.length === 0) html += '<th style="font-size:.62rem;color:var(--gray-400)">Sin actividades</th>';
      else grp.acts.forEach(function (act) { html += '<th style="font-size:.62rem">' + act.name + '<br><span style="font-size:.6rem;color:var(--gray-400)">/' + act.maxScore + '</span></th>'; });
    });
    html += '</tr></thead><tbody>';

    filtered.forEach(function (student, idx) {
      var tot = rt.fns.studentTotal(student.id);
      var passed = tot >= 7;
      html += '<tr><td>' + (idx + 1) + '</td><td style="font-family:var(--mono);font-size:.7rem">' + (student.codigo || '') + '</td><td style="font-family:var(--mono)">' + formatCedula(student.cedula) + '</td><td class="cell-name">' + student.apellidos + '</td><td class="cell-name">' + student.nombres + '</td>';

      grouped.forEach(function (grp) {
        if (grp.acts.length === 0) { html += '<td style="text-align:center;color:var(--gray-400)">—</td>'; return; }
        grp.acts.forEach(function (act) {
          var gradeVal = rt.fns.getGrade(student.id, act.id);
          var hasValue = gradeVal != null;
          var isOver = hasValue && gradeVal > act.maxScore;
          html += '<td><input class="grade-input ' + (hasValue ? 'has-val' : '') + (isOver ? ' over' : '') + '" type="number" step="0.01" min="0" max="' + act.maxScore + '" data-sid="' + student.id + '" data-aid="' + act.id + '" data-max="' + act.maxScore + '" value="' + (hasValue ? gradeVal : '') + '" oninput="onGradeInput(this)" onchange="onGradeChange(this)" placeholder="—"></td>';
        });
      });

      html += '<td><input class="grade-readonly" data-total-sid="' + student.id + '" type="text" readonly value="' + fmt(tot) + '" title="Suma total"></td>';
      html += '<td><input class="grade-total-input ' + (passed ? 'pass' : 'fail') + '" data-final-sid="' + student.id + '" type="text" readonly value="' + fmt(tot) + '" title="Nota Final"></td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    document.getElementById('cal-table-wrap').innerHTML = html;
    updateReportAvailability();
  }

  function onGradeInput(el) {
    var maxVal = parseFloat(el.dataset.max);
    var currentVal = parseFloat(el.value);
    el.classList.remove('has-val', 'over');
    if (!isNaN(currentVal)) el.classList.add(currentVal > maxVal ? 'over' : 'has-val');
  }

  function onGradeChange(el) {
    var sid = el.dataset.sid;
    var aid = el.dataset.aid;
    var maxVal = parseFloat(el.dataset.max);
    var raw = parseFloat(el.value);
    var score = null;
    if (!isNaN(raw)) score = Math.round(Math.max(0, Math.min(maxVal, raw)) * 100) / 100;
    rt.fns.setGrade(sid, aid, score);
    if (score != null) el.value = score;
    if (score != null) {
      el.classList.remove('has-val', 'over');
      el.classList.add(score > maxVal ? 'over' : 'has-val');
    } else el.classList.remove('has-val', 'over');
    refreshGradeRowTotals(sid);
  }

  function calSave() {
    rt.fns.persistActiveConfigData();
    rt.fns.save();
    rt.fns.addRecentActivity('Calificaciones guardadas manualmente', 'grade');
    var btn = document.getElementById('cal-save-btn');
    if (btn) {
      btn.style.background = 'var(--green)';
      btn.innerHTML = '✓ Guardado';
      setTimeout(function () { btn.style.background = ''; btn.innerHTML = 'Guardar'; }, 2000);
    }
    rt.fns.showToast('Calificaciones guardadas', 'success');
  }

  function renderReporte(confirmed) {
    if (!rt.STATE.activeConfigId || rt.STATE.students.length === 0 || rt.STATE.activities.length === 0) {
      document.getElementById('rep-stats').innerHTML = '';
      document.getElementById('rep-dist').innerHTML = '';
      document.getElementById('rep-printable').innerHTML = '<div style="padding:40px;text-align:center;color:var(--gray-500);font-size:.9rem">' +
        (!rt.STATE.activeConfigId ? 'Seleccione un PAO desde MIS PAOs para generar el reporte.' :
        rt.STATE.students.length === 0 ? 'No hay estudiantes registrados para este PAO.' :
        'No hay actividades configuradas.') +
        '</div>';
      return;
    }
    var gradesComplete = isGradesComplete();
    var totalExpected = rt.STATE.students.length * rt.STATE.activities.length;
    var totalEntered = 0;
    rt.STATE.students.forEach(function (s) { rt.STATE.activities.forEach(function (a) { if (rt.fns.getGrade(s.id, a.id) != null) totalEntered++; }); });
    if (!confirmed && !gradesComplete) {
      var pct = Math.round(totalEntered / totalExpected * 100);
      rt.fns.openModal('Calificaciones Incompletas',
        '<div style="font-size:.85rem;color:var(--gray-700)">' +
        '<p>Ha ingresado <strong>' + totalEntered + '/' + totalExpected + ' (' + pct + '%)</strong> de las calificaciones.</p>' +
        '<p>El reporte se generara con las notas actuales. Los estudiantes sin nota registrada apareceran con 0.</p>' +
        '<p style="font-weight:600;margin-top:12px">¿Esta de acuerdo con generar el reporte con las calificaciones actuales?</p>' +
        '</div>',
        [
          { label: 'Cancelar', cls: 'btn-ghost', action: 'close' },
          { label: 'Si, generar reporte', cls: 'btn-primary', action: function () { rt.fns.closeModal(); renderReporte(true); } }
        ]
      );
      return;
    }
    rt.fns.syncActivitiesWithRAAU();
    var config = rt.STATE.courseConfig;
    var activities = rt.STATE.activities;
    var students = rt.STATE.students;
    var allTotals = students.map(function (s) { return rt.fns.studentTotal(s.id); });
    var classAverage = allTotals.length > 0 ? allTotals.reduce(function (a, b) { return a + b; }, 0) / allTotals.length : 0;
    var maxNote = allTotals.length > 0 ? Math.max.apply(null, allTotals) : 0;
    var minNote = allTotals.filter(function (t) { return t > 0; }).length > 0 ? Math.min.apply(null, allTotals.filter(function (t) { return t > 0; })) : 0;
    var approvedCount = allTotals.filter(function (t) { return t >= 7; }).length;
    document.getElementById('rep-stats').innerHTML = [
      { label: 'Promedio', val: classAverage.toFixed(2), color: 'var(--gray-800)' },
      { label: 'Aprobados', val: approvedCount + '/' + students.length, color: 'var(--green)' },
      { label: 'Nota Máx.', val: maxNote.toFixed(2), color: 'var(--purple)' },
      { label: 'Nota Mín.', val: minNote.toFixed(2), color: 'var(--amber)' }
    ].map(function (s) {
      return '<div class="stat-card"><div class="stat-row"><div><div class="stat-label">' + s.label + '</div><div class="stat-val" style="color:' + s.color + '">' + s.val + '</div></div></div></div>';
    }).join('');

    var distribution = [
      { label: '9-10', min: 9, max: 10.01, color: 'var(--green)' },
      { label: '8-9', min: 8, max: 9, color: 'var(--blue)' },
      { label: '7-8', min: 7, max: 8, color: 'var(--amber)' },
      { label: '6-7', min: 6, max: 7, color: '#f97316' },
      { label: '<6', min: 0, max: 6, color: 'var(--red)' }
    ].map(function (d) {
      return { label: d.label, min: d.min, max: d.max, color: d.color, count: allTotals.filter(function (t) { return t >= d.min && t < d.max; }).length };
    });
    var maxDist = Math.max.apply(null, distribution.map(function (d) { return d.count; }).concat([1]));
    document.getElementById('rep-dist').innerHTML = distribution.map(function (d) {
      return '<div class="dist-bar-wrap"><span class="dist-count" style="color:' + d.color + '">' + d.count + '</span><div class="dist-bar" style="height:' + (d.count / maxDist * 100) + '%;background:' + d.color + '"></div><span class="dist-label">' + d.label + '</span></div>';
    }).join('');

    var grouped = COMPONENTS.map(function (comp) {
      return { comp: comp, acts: activities.filter(function (a) { return a.component === comp; }) };
    });
    var reportHtml = '<div class="report-header"><div class="report-institution">ESCUELA SUPERIOR POLITÉCNICA DE CHIMBORAZO</div><div class="report-subtitle">Sede Orellana — Evaluación formativa y sumativa para alcanzar los resultados de aprendizaje</div></div>' +
      '<div class="report-info-grid">' +
      '<div class="report-info-cell"><span class="report-info-label">Período académico: </span><span class="report-info-val">' + config.periodoAcademico + '</span></div>' +
      '<div class="report-info-cell"><span class="report-info-label">Asignatura: </span><span class="report-info-val">' + config.asignatura + '</span></div>' +
      '<div class="report-info-cell"><span class="report-info-label">Facultad: </span><span class="report-info-val">' + config.facultad + '</span></div>' +
      '<div class="report-info-cell"><span class="report-info-label">PAO: </span><span class="report-info-val">' + (config.pao || '—') + '</span></div>' +
      '<div class="report-info-cell"><span class="report-info-label">Carrera: </span><span class="report-info-val">' + config.carrera + '</span></div>' +
      '<div class="report-info-cell"><span class="report-info-label">Aporte: </span><span class="report-info-val">' + config.aporte + '</span></div>' +
      '<div class="report-info-cell"><span class="report-info-label">Docente: </span><span class="report-info-val">' + (config.docente || '—') + '</span></div>' +
      '<div class="report-info-cell"><span class="report-info-label">Total estudiantes: </span><span class="report-info-val">' + students.length + '</span></div>' +
      '</div>';
    if (!gradesComplete) {
      reportHtml += '<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:.75rem;color:#92400e">' +
        'Reporte generado con calificaciones incompletas (' + totalEntered + '/' + totalExpected + ' notas ingresadas). Aceptado por el docente responsable.</div>';
    }
    reportHtml += '<div class="report-table-wrap"><table class="report-table results-table"><thead><tr>' +
      '<th colspan="4" style="text-align:left">Resultado de aprendizaje de la carrera alcanzado</th>';
    grouped.forEach(function (grp) {
      grp.acts.forEach(function (act) {
        var linkedRaau = rt.STATE.raauEntries.find(function (r) { return r.id === act.raauId; });
        var rac = rt.CAREER_RACS.find(function (r) { return r.id === (linkedRaau ? linkedRaau.racId : act.racId); });
        reportHtml += '<th style="font-size:.62rem">' + (rac ? rac.code : 'RAC') + '</th>';
      });
    });
    reportHtml += '<th rowspan="4">Sumatoria</th><th rowspan="4">Nota final</th></tr>';
    reportHtml += '<tr><th colspan="4" style="text-align:left">Resultado de aprendizaje de la asignatura alcanzado</th>';
    grouped.forEach(function (grp) {
      grp.acts.forEach(function (act) {
        var raauEntry = rt.STATE.raauEntries.find(function (r) { return r.id === act.raauId; });
        reportHtml += '<th style="font-size:.62rem">' + (raauEntry ? raauEntry.code : 'RAAU') + '</th>';
      });
    });
    reportHtml += '</tr>';
    reportHtml += '<tr><th rowspan="2" style="min-width:35px">No.</th><th rowspan="2">Cédula</th><th rowspan="2">Apellidos</th><th rowspan="2">Nombres</th>';
    grouped.forEach(function (grp) {
      var bg = grp.comp === 'ACD' ? '#8bc34a' : grp.comp === 'APEX' ? '#7cb342' : '#689f38';
      reportHtml += '<th colspan="' + grp.acts.length + '" style="background:' + bg + ';color:#111">' + grp.comp + ' (' + COMPONENT_WEIGHTS[grp.comp] + ')</th>';
    });
    reportHtml += '</tr>';
    reportHtml += '<tr>';
    grouped.forEach(function (grp) {
      grp.acts.forEach(function (act) {
        reportHtml += '<th style="font-size:.62rem">' + act.name + '</th>';
      });
    });
    reportHtml += '</tr></thead><tbody>';
    students.forEach(function (s, idx) {
      var tot = rt.fns.studentTotal(s.id);
      reportHtml += '<tr><td>' + (idx + 1) + '</td><td style="font-family:var(--mono)">' + formatCedula(s.cedula) + '</td><td class="cell-name">' + s.apellidos + '</td><td class="cell-name">' + s.nombres + '</td>';
      grouped.forEach(function (grp) {
        grp.acts.forEach(function (act) {
          var grade = rt.fns.getGrade(s.id, act.id);
          reportHtml += '<td>' + (grade != null ? fmt(grade) : '—') + '</td>';
        });
      });
      reportHtml += '<td class="cell-grade">' + fmt(tot) + '</td><td class="cell-grade cell-nota ' + (tot >= 7 ? 'pass' : 'fail') + '">' + fmt(tot) + '</td></tr>';
    });
    reportHtml += '</tbody></table></div>';
    document.getElementById('rep-printable').innerHTML = reportHtml;
  }

  function printDetailedReport() {
    var printable = document.getElementById('rep-printable');
    if (!printable || !printable.innerHTML.trim()) {
      rt.fns.showToast('No hay contenido del reporte detallado para imprimir.', 'error');
      return;
    }
    var w = window.open('', '_blank', 'width=1200,height=800');
    if (!w) {
      rt.fns.showToast('Permita ventanas emergentes para imprimir el reporte.', 'error');
      return;
    }
    w.document.write('<html><head><title>Reporte Detallado</title><style>body{font-family:Inter,Arial,sans-serif;margin:14px;color:#111}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #ddd;padding:6px;vertical-align:top}h1{font-size:16px;margin:0 0 10px} .report-info-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:10px} .signatures-container{margin-top:20px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}</style></head><body><h1>Reporte Detallado</h1>' + printable.innerHTML + '</body></html>');
    w.document.close();
    setTimeout(function () { w.focus(); w.print(); }, 120);
  }

  Object.assign(rt.fns, {
    renderEstudiantes, renderStudentTable, editStudent, confirmDelete,
    exportStudentsPDF, exportGradesExcel, exportGradesPDF, showGradesQR,
    showOasisImport, syncStudentsFromOasis,
    renderCalificaciones, renderGradeTable, onGradeInput, onGradeChange, calSave, updateReportAvailability,
    renderReporte, printDetailedReport, exportReportExcel, exportReportPDF, showReportQR,
    exportPayloadPDF, showExportQR
  });
}
