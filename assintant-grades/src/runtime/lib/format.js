// ============================================================================
// CAPA DE DOMINIO (utilidades puras) · Formato y normalización
// ----------------------------------------------------------------------------
// Funciones SIN estado: solo transforman sus argumentos. No tocan STATE ni el
// DOM, por lo que son reutilizables por cualquier capa del runtime.
// ============================================================================

export function fmt(n) { return Number(n || 0).toFixed(2); }

export function pct(a, b) { return b > 0 ? Math.round(a / b * 100) : 0; }

export function formatCedula(ced) {
  var c = String(ced || '').replace(/[^0-9]/g, '');
  if (c.length === 10) return c.slice(0, 9) + '-' + c.slice(9);
  return ced || '';
}

export function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function jsStringArg(value) {
  return escapeHtml(JSON.stringify(String(value == null ? '' : value)));
}

export function fileSlug(str) {
  return String(str || 'reporte')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'reporte';
}

export function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }

export function normalizeDocId(value) { return String(value || '').replace(/[^0-9kK]/g, '').toLowerCase(); }

export function clonePlain(value, fallback) {
  try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; }
}
