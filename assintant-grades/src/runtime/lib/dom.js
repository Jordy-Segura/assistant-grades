// ============================================================================
// CAPA DE DOMINIO (utilidades puras) · DOM / navegador
// ----------------------------------------------------------------------------
// Helpers de navegador sin estado de la app: descarga de archivos e íconos SVG.
// ============================================================================

export function downloadTextFile(filename, content, mime) {
  var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(a.href);
  a.remove();
}

export function getIconSVG(name, color) {
  var icons = {
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    'check-circle': '<svg viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    'x-circle': '<svg viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    'trending-up': '<svg viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>'
  };
  return icons[name] || icons.users;
}
