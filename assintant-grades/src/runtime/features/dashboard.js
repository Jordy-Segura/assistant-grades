// ============================================================================
// CAPA DE PRESENTACIÓN · Pantalla de Panel Principal (Dashboard)
// ----------------------------------------------------------------------------
// Tarjetas de resumen, gráficos (Chart.js global) y actividad reciente del PAO
// activo. Recibe `rt`: lee rt.STATE y usa rt.fns.studentTotal (dominio de notas,
// vive en el núcleo). Registra renderDashboard en rt.fns (lo despacha renderPage
// y el flujo de login).
// ============================================================================
import { getIconSVG } from "../lib/dom.js";
import { fmt, pct, formatCedula } from "../lib/format.js";
import { COMPONENTS, COMPONENT_COLORS, COMPONENT_WEIGHTS } from "../constants.js";

export function registerDashboard(rt) {
  var chartDistribution = null;
  var chartStudents = null;
  var chartPie = null;

  function renderDashboard() {
    if (!rt.STATE.activeConfigId) {
      document.getElementById('dash-sub').textContent = 'Seleccione o configure un PAO para comenzar.';
      document.getElementById('dash-banner').innerHTML = '<div style="padding:30px;text-align:center;color:var(--gray-500);font-size:.9rem">Seleccione un PAO desde MIS PAOs para comenzar.</div>';
      document.getElementById('dash-stats').innerHTML = '';
      document.getElementById('dash-student-body').innerHTML = '';
      return;
    }
    var config = rt.STATE.courseConfig;
    var students = rt.STATE.students;
    var activities = rt.STATE.activities;
    document.getElementById('dash-sub').textContent = (config.asignatura || 'Sin Asignatura') + ' — ' + config.periodoAcademico;
    document.getElementById('dash-banner').innerHTML = '<div class="course-banner-fields"><div class="banner-field"><div class="lbl">Carrera</div><div class="val">' + (config.carrera || '—') + '</div></div><div class="banner-field"><div class="lbl">PAO</div><div class="val">' + (config.pao || '—') + '</div></div><div class="banner-field"><div class="lbl">Aporte</div><div class="val">' + (config.aporte || '—') + '</div></div><div class="banner-field"><div class="lbl">Docente</div><div class="val">' + (config.docente || '—') + '</div></div></div>';

    var allTotals = students.map(function (s) { return rt.fns.studentTotal(s.id); });
    var approvedCount = allTotals.filter(function (t) { return t >= 7; }).length;
    var failedCount = allTotals.filter(function (t) { return t > 0 && t < 7; }).length;
    var noGradeCount = allTotals.filter(function (t) { return t === 0; }).length;
    var classAverage = allTotals.length > 0 ? allTotals.reduce(function (a, b) { return a + b; }, 0) / allTotals.length : 0;
    var maxTotal = activities.reduce(function (s, a) { return s + a.maxScore; }, 0);
    var statItems = [
      { title: 'Estudiantes', value: students.length, sub: 'Matriculados', color: 'var(--espoch-red)', icon: 'users' },
      { title: 'Aprobados', value: approvedCount, sub: 'Nota ≥ 7.0', color: 'var(--green)', icon: 'check-circle' },
      { title: 'Reprobados', value: failedCount, sub: 'Nota < 7.0', color: 'var(--red)', icon: 'x-circle' },
      { title: 'Promedio', value: classAverage.toFixed(2), sub: 'de ' + maxTotal.toFixed(1) + ' pts', color: 'var(--amber)', icon: 'trending-up' }
    ];
    document.getElementById('dash-stats').innerHTML = statItems.map(function (item) {
      return '<div class="stat-card animate-in"><div class="stat-row"><div><div class="stat-label">' + item.title + '</div><div class="stat-val" style="color:' + item.color + '">' + item.value + '</div><div class="stat-sub">' + item.sub + '</div></div><div class="stat-icon" style="background:' + item.color + '18">' + getIconSVG(item.icon, item.color) + '</div></div></div>';
    }).join('');

    renderDistributionChart(allTotals);
    renderStudentsChart(students, allTotals);
    renderPieChart(approvedCount, failedCount, noGradeCount);
    renderComponentProgress();
    renderRecentActivity();

    var raSummaryHtml = '<div style="display:flex;flex-direction:column;gap:8px">';
    [['RAC seleccionados', rt.STATE.selectedRACIds.length, 'var(--blue)'], ['RAAU definidos', rt.STATE.raauEntries.length, 'var(--green)'], ['Actividades', activities.length, 'var(--amber)']].forEach(function (pair) {
      raSummaryHtml += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--gray-50);border-radius:var(--radius)"><span style="font-size:.78rem;color:var(--gray-600)">' + pair[0] + '</span><span style="font-size:1rem;font-weight:700;color:' + pair[2] + '">' + pair[1] + '</span></div>';
    });
    raSummaryHtml += '</div>';
    var raTarget = document.getElementById('dash-ra-summary');
    if (raTarget) raTarget.innerHTML = raSummaryHtml;

    var previewStudents = students.slice(0, 10);
    var tbodyHtml = previewStudents.map(function (student, idx) {
      var tot = rt.fns.studentTotal(student.id);
      var passed = tot >= 7;
      var studentPct = pct(tot, maxTotal);
      return '<tr><td style="color:var(--gray-400)">' + (idx + 1) + '</td><td><div style="font-weight:500;font-size:.83rem">' + student.apellidos + ' ' + student.nombres + '</div><div style="font-size:.72rem;color:var(--gray-400);font-family:var(--mono)">' + formatCedula(student.cedula) + '</div></td><td><div style="display:flex;align-items:center;gap:8px"><div class="progress-bar" style="width:60px"><div class="progress-fill" style="width:' + Math.min(studentPct, 100) + '%;background:' + (passed ? 'var(--green)' : 'var(--red)') + '"></div></div><span style="font-weight:700;color:' + (passed ? 'var(--green)' : 'var(--red)') + ';font-size:.83rem">' + fmt(tot) + '</span></div></td><td><span class="badge ' + (passed ? 'badge-green' : 'badge-red') + '">' + (passed ? '✓ Aprobado' : '✗ Reprobado') + '</span></td></tr>';
    }).join('');
    var dashBody = document.getElementById('dash-student-body');
    if (dashBody) dashBody.innerHTML = tbodyHtml;
  }

  function renderDistributionChart(totals) {
    if (typeof window.Chart === 'undefined') return;
    var ctx = document.getElementById('dash-chart-distribution');
    if (!ctx) return;
    if (chartDistribution) chartDistribution.destroy();
    var ranges = ['0-4', '5-6', '7-8', '9-10'];
    var counts = [0, 0, 0, 0];
    totals.forEach(function (t) { if (t < 5) counts[0]++; else if (t < 7) counts[1]++; else if (t < 9) counts[2]++; else counts[3]++; });
    chartDistribution = new window.Chart(ctx, { type: 'bar', data: { labels: ranges, datasets: [{ data: counts, backgroundColor: ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6'], borderRadius: 6 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } });
  }

  function renderStudentsChart(students, totals) {
    if (typeof window.Chart === 'undefined') return;
    var ctx = document.getElementById('dash-chart-students');
    if (!ctx) return;
    if (chartStudents) chartStudents.destroy();
    var shortNames = students.map(function (s) { var parts = s.apellidos.split(' '); return parts[0] + ' ' + (parts[1] ? parts[1][0] + '.' : ''); });
    chartStudents = new window.Chart(ctx, { type: 'bar', data: { labels: shortNames, datasets: [{ data: totals, backgroundColor: totals.map(function (t) { return t >= 7 ? '#22c55e' : '#ef4444'; }), borderRadius: 4 }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } });
  }

  function renderPieChart(approved, failed, noGrade) {
    if (typeof window.Chart === 'undefined') return;
    var ctx = document.getElementById('dash-chart-pie');
    if (!ctx) return;
    if (chartPie) chartPie.destroy();
    chartPie = new window.Chart(ctx, { type: 'doughnut', data: { labels: ['Aprobados', 'Reprobados', 'Sin nota'], datasets: [{ data: [approved, failed, noGrade], backgroundColor: ['#22c55e', '#ef4444', '#9ca3af'], borderWidth: 0 }] }, options: { responsive: false, cutout: '65%', plugins: { legend: { display: false } } } });
    var total = approved + failed + noGrade;
    document.getElementById('dash-pie-label').textContent = total + ' estudiantes evaluados';
  }

  function renderComponentProgress() {
    var activities = rt.STATE.activities;
    var container = document.getElementById('dash-comp-progress');
    if (!container) return;
    container.innerHTML = COMPONENTS.map(function (comp) {
      var compActs = activities.filter(function (a) { return a.component === comp; });
      var maxPts = compActs.reduce(function (s, a) { return s + a.maxScore; }, 0);
      var color = COMPONENT_COLORS[comp];
      var weight = COMPONENT_WEIGHTS[comp];
      var pctVal = (maxPts / weight * 100).toFixed(0);
      return '<div class="comp-progress-item">' +
        '<div class="comp-progress-header"><span class="comp-progress-label" style="color:' + color + '">' + comp + '</span><span class="comp-progress-value">' + maxPts.toFixed(1) + ' / ' + weight + ' pts (' + pctVal + '%)</span></div>' +
        '<div class="progress-bar"><div class="progress-fill" style="width:' + Math.min(pctVal, 100) + '%;background:' + color + '"></div></div>' +
        '<div style="font-size:.7rem;color:var(--gray-400);margin-top:3px">' + compActs.length + ' actividad' + (compActs.length !== 1 ? 'es' : '') + '</div>' +
      '</div>';
    }).join('');
  }

  function renderRecentActivity() {
    var container = document.getElementById('dash-recent-activity');
    if (!container) return;
    var activities = rt.STATE.recentActivity.slice(0, 8);
    if (activities.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-400);font-size:.82rem"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:32px;height:32px;margin:0 auto 8px;display:block;opacity:.3"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Aún no hay actividad reciente</div>';
      return;
    }
    var typeIcons = {
      grade: { color: 'var(--green)', bg: '#f0fdf4', icon: 'check-circle' },
      config: { color: 'var(--blue)', bg: '#eff6ff', icon: 'users' },
      student: { color: 'var(--purple)', bg: '#f5f3ff', icon: 'users' }
    };
    container.innerHTML = activities.map(function (act) {
      var style = typeIcons[act.type] || typeIcons.config;
      return '<div class="activity-item animate-in"><div class="activity-icon" style="background:' + style.bg + ';color:' + style.color + '">' + getIconSVG(style.icon, style.color) + '</div><div class="activity-text">' + act.text + '</div><div class="activity-time">' + act.time + '</div></div>';
    }).join('');
  }

  Object.assign(rt.fns, { renderDashboard });
}
