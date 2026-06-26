// ============================================================================
// CAPA DE DOMINIO (utilidades puras) · Exportación a Excel (SpreadsheetML XML)
// ----------------------------------------------------------------------------
// Construye el XML de Excel a partir de un payload ya armado. Sin estado: solo
// depende de su argumento y del escape de HTML.
// ============================================================================
import { escapeHtml } from "./format.js";

function excelXmlCell(value, type, formula) {
  var numeric = type === 'Number' && value !== '' && value != null && !isNaN(Number(value));
  var attrs = formula ? ' ss:Formula="' + formula + '"' : '';
  return '<Cell' + attrs + '><Data ss:Type="' + (numeric ? 'Number' : 'String') + '">' +
    escapeHtml(numeric ? Number(value).toFixed(2) : value) + '</Data></Cell>';
}

export function buildGradesExcelXml(payload) {
  var activities = payload.activities || [];
  var headers = ['No.', 'Codigo', 'Cedula', 'Apellidos', 'Nombres']
    .concat(activities.map(function (a) { return a.component + ' - ' + a.name + ' /' + a.maxScore; }))
    .concat(['Sumatoria', 'Nota final']);
  var rows = '<Row>' + headers.map(function (h) { return excelXmlCell(h, 'String'); }).join('') + '</Row>';
  (payload.students || []).forEach(function (s, idx) {
    rows += '<Row>' +
      excelXmlCell(idx + 1, 'Number') +
      excelXmlCell(s.codigo || '', 'String') +
      excelXmlCell(s.cedula || '', 'String') +
      excelXmlCell(s.apellidos || '', 'String') +
      excelXmlCell(s.nombres || '', 'String') +
      activities.map(function (act) {
        var g = (s.grades || []).find(function (x) { return x.activityId === act.id; });
        return excelXmlCell(g && g.score != null ? g.score : '', g && g.score != null ? 'Number' : 'String');
      }).join('') +
      excelXmlCell(s.total || 0, 'Number', '=SUM(RC[-' + activities.length + ']:RC[-1])') +
      excelXmlCell(s.total || 0, 'Number', '=RC[-1]') +
      '</Row>';
  });
  return '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
    '<DocumentProperties xmlns="urn:schemas-microsoft-com:office:office"><Title>Calificaciones</Title></DocumentProperties>' +
    '<Worksheet ss:Name="Calificaciones"><Table>' + rows + '</Table></Worksheet></Workbook>';
}
