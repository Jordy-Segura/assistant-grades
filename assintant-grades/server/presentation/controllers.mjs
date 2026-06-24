import { randomUUID } from "node:crypto";
import { HttpError } from "./httpServer.mjs";

const EXPORT_TTL_MS = 6 * 60 * 60 * 1000;
const exportCache = new Map();

function cleanupExportCache() {
  const now = Date.now();
  for (const [id, item] of exportCache.entries()) {
    if (!item || item.expiresAt <= now) exportCache.delete(id);
  }
}

function jsonForScript(value) {
  return JSON.stringify(value || {})
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function buildExportPage(payload) {
  const embedded = jsonForScript(payload);
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Descargar calificaciones</title>
  <style>
    body{font-family:Arial,Helvetica,sans-serif;margin:0;background:#f1f5f9;color:#1e293b}
    main{max-width:760px;margin:0 auto;padding:24px 16px}
    .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px;box-shadow:0 8px 24px rgba(15,23,42,.08)}
    h1{font-size:20px;margin:0 0 6px}.sub{color:#64748b;font-size:14px;margin-bottom:16px;line-height:1.45}
    .actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 0}
    button{border:0;border-radius:8px;padding:12px 14px;font-weight:700;font-size:15px;color:#fff;background:#cc0000}
    button.excel{background:#00994f}.meta{font-size:13px;color:#475569;line-height:1.6;background:#f8fafc;border-radius:8px;padding:12px}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-top:14px}th,td{border:1px solid #cbd5e1;padding:6px;text-align:left}th{background:#f8fafc}
    @media(max-width:520px){.actions{grid-template-columns:1fr}main{padding:14px 10px}}
  </style>
</head>
<body>
  <main>
    <div class="card">
      <h1>Calificaciones</h1>
      <div class="sub">Descargue el reporte generado desde ESPOCH Auxiliar de Calificaciones.</div>
      <div class="meta" id="meta"></div>
      <div class="actions">
        <button class="excel" onclick="downloadExcel()">Descargar Excel</button>
        <button onclick="downloadPdf()">Descargar PDF</button>
      </div>
      <div id="preview"></div>
    </div>
  </main>
  <script>
    const REPORT = ${embedded};
    const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[ch]));
    const slug = (v) => String(v || "reporte").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "reporte";
    const meta = REPORT.meta || {};
    const activities = REPORT.activities || [];
    const students = REPORT.students || [];
    const filenameBase = slug([meta.asignatura, meta.aporte, "calificaciones"].filter(Boolean).join("_"));
    document.getElementById("meta").innerHTML =
      "<strong>" + esc(meta.asignatura || "Asignatura") + "</strong><br>" +
      esc(meta.carrera || "") + " - PAO " + esc(meta.pao || "") + " - " + esc(meta.aporte || "") + "<br>" +
      esc(meta.periodoAcademico || "") + "<br>Estudiantes: " + students.length;
    document.getElementById("preview").innerHTML = "<table><thead><tr><th>#</th><th>Estudiante</th><th>Nota final</th></tr></thead><tbody>" +
      students.map((s, i) => "<tr><td>" + (i + 1) + "</td><td>" + esc([s.apellidos, s.nombres].filter(Boolean).join(" ")) + "</td><td>" + Number(s.total || 0).toFixed(2) + "</td></tr>").join("") +
      "</tbody></table>";
    function x(v){ return esc(v); }
    function cell(value, type, formula){
      const attrs = formula ? ' ss:Formula="' + formula + '"' : "";
      const numeric = type === "Number" && value !== "" && value != null && !Number.isNaN(Number(value));
      return '<Cell' + attrs + '><Data ss:Type="' + (numeric ? "Number" : "String") + '">' + x(numeric ? Number(value).toFixed(2) : value) + '</Data></Cell>';
    }
    function download(name, content, mime){
      const blob = new Blob([content], { type: mime });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(a.href);
      a.remove();
    }
    function buildExcelXml(){
      const headers = ["No.", "Codigo", "Cedula", "Apellidos", "Nombres"].concat(activities.map(a => a.name + " /" + a.maxScore), ["Sumatoria", "Nota final"]);
      let rows = '<Row>' + headers.map(h => cell(h, "String")).join("") + '</Row>';
      students.forEach((s, i) => {
        rows += '<Row>' +
          cell(i + 1, "Number") + cell(s.codigo || "", "String") + cell(s.cedula || "", "String") +
          cell(s.apellidos || "", "String") + cell(s.nombres || "", "String") +
          activities.map(a => {
            const g = (s.grades || []).find(x => x.activityId === a.id);
            return cell(g && g.score != null ? g.score : "", g && g.score != null ? "Number" : "String");
          }).join("") +
          cell(s.total || 0, "Number", "=SUM(RC[-" + activities.length + "]:RC[-1])") +
          cell(s.total || 0, "Number", "=RC[-1]") +
          '</Row>';
      });
      return '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>' +
        '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
        '<Worksheet ss:Name="Calificaciones"><Table>' + rows + '</Table></Worksheet></Workbook>';
    }
    function downloadExcel(){ download(filenameBase + ".xls", buildExcelXml(), "application/vnd.ms-excel;charset=utf-8"); }
    function loadScript(src){
      return new Promise((resolve, reject) => {
        const existing = document.querySelector('script[src="' + src + '"]');
        if (existing) return resolve();
        const s = document.createElement("script");
        s.src = src; s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
      });
    }
    async function downloadPdf(){
      try {
        await loadScript("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js");
        await loadScript("https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js");
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
        const head = [["No.", "Codigo", "Cedula", "Apellidos", "Nombres"].concat(activities.map(a => a.name), ["Nota"])];
        const body = students.map((s, i) => [i + 1, s.codigo || "", s.cedula || "", s.apellidos || "", s.nombres || ""].concat(
          activities.map(a => {
            const g = (s.grades || []).find(x => x.activityId === a.id);
            return g && g.score != null ? Number(g.score).toFixed(2) : "-";
          }), [Number(s.total || 0).toFixed(2)]));
        doc.setFontSize(13); doc.text("Registro de Calificaciones", 40, 34);
        doc.setFontSize(9); doc.text([meta.asignatura || "", meta.carrera || "", "PAO " + (meta.pao || ""), meta.aporte || ""].filter(Boolean).join(" - "), 40, 50);
        doc.autoTable({ head, body, startY: 64, styles: { fontSize: 7, cellPadding: 3 }, headStyles: { fillColor: [204,0,0] } });
        doc.save(filenameBase + ".pdf");
      } catch (e) {
        window.print();
      }
    }
  </script>
</body>
</html>`;
}

function devLogin(body) {
  const roleMap = { docente: "DOCENTE", coordinador: "COORDINADOR", admin: "ADMIN" };
  let roleLabel = "docente";
  if (body.login === "dev.coordinador") roleLabel = "coordinador";
  else if (body.login === "dev.admin") roleLabel = "admin";
  return {
    roles: [{ codigoCarrera: "001", nombreRol: roleMap[roleLabel] || "DOCENTE" }],
    perfil: { cedula: "9999999999", apellidos: "Desarrollo", nombres: "Usuario " + roleLabel, email: body.login + "@espoch.edu.ec" },
  };
}

function validatePasswordStrength(password) {
  const p = String(password || "");
  if (p.length < 8) return "La contrasena debe tener al menos 8 caracteres.";
  if (/\s/.test(p)) return "La contrasena no debe tener espacios.";
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return "La contrasena debe combinar letras y numeros.";
  return "";
}

export function buildRoutes({ service, db, config }) {
  return {
    "GET /api/health": async () => ({
      ok: true,
      base: config.oasis.base,
      hasCredentials: config.oasis.hasCredentials,
      mock: false,
      dbEnabled: db.enabled,
      warnings: config.warnings,
    }),

    "GET /api/periodo-actual": () => service.getPeriodoActual(),
    "GET /api/facultades": () => service.getFacultades(),
    "GET /api/carreras": async () => (await service.getCarreras()).filter((c) => c.estado === "ABI"),

    "POST /api/nomina": (body) => service.resolverNomina(body),
    "POST /api/docentes-carrera": (body) => service.getDocentesCarrera(body),
    "POST /api/horario-docente": (body) => service.getHorarioDocente(body),

    "POST /api/login": (body) => {
      if (!body.login || !body.password) throw new HttpError("Debe ingresar usuario y contrasena.", 400);
      return service.login(body.login, body.password);
    },

    "POST /api/materias-docente": (body) => service.getMateriasDocente(body.codCarrera, body.cedula, body.codPeriodo),
    "POST /api/alumnos-materia": (body) => service.getAlumnosMateria(body),
    "POST /api/notas": (body) => service.getNotas(body.codCarrera, body.cedula),
    "POST /api/estudiante": (body) => service.getDatosEstudiante(body.cedula),
    "POST /api/materias-estudiante": (body) => service.getMateriasEstudiante(body.codCarrera, body.cedula, body.codPeriodo),
    "POST /api/estudiante-full": (body) => service.getEstudianteFull(body.cedula),

    "GET /api/db/health": () => db.health(),
    "GET /api/store": (arg) => (db.enabled ? db.getStore({ email: arg.email, role: arg.role }) : { disabled: true }),
    "PUT /api/store": (body) => (db.enabled ? db.putStore(body) : { disabled: true }),
    "GET /api/catalogo-vectores": () => (db.enabled ? db.getVectorCatalog() : { disabled: true, carreras: {}, procedures: {} }),
    "PUT /api/catalogo-vectores": (body) => (db.enabled ? db.replaceVectorCatalog(body) : { disabled: true }),

    "POST /api/dev-login": async (body) => devLogin(body),

    "POST /api/db-login": async (body) => {
      if (!db.enabled) return { disabled: true };
      if (!body.login || !body.password) throw new HttpError("Debe ingresar usuario y contrasena.", 400);
      const u = await db.login(body.login, body.password);
      if (!u) throw new HttpError("Usuario o contrasena incorrectos.", 401);
      return u;
    },

    "POST /api/db-password": async (body) => {
      if (!db.enabled) return { disabled: true };
      if (!body.email || !body.currentPassword || !body.newPassword) {
        throw new HttpError("Debe ingresar clave actual y nueva clave.", 400);
      }
      const passwordError = validatePasswordStrength(body.newPassword);
      if (passwordError) throw new HttpError(passwordError, 400);
      const ok = await db.updatePassword(body.email, body.currentPassword, body.newPassword);
      if (!ok) throw new HttpError("La clave actual no es correcta.", 401);
      return { ok: true };
    },

    "POST /api/session/claim": async (body) => {
      if (!db.enabled) return { disabled: true, ok: true };
      if (!body.email || !body.sessionId) throw new HttpError("Sesion invalida.", 400);
      return db.claimSession(body.email, body.sessionId, body);
    },

    "POST /api/session/release": async (body) => {
      if (!db.enabled) return { disabled: true, ok: true };
      return db.releaseSession(body.email, body.sessionId);
    },

    "POST /api/export-cache": async (body) => {
      cleanupExportCache();
      if (!body || !body.payload) throw new HttpError("No se recibio informacion para exportar.", 400);
      const id = randomUUID();
      exportCache.set(id, {
        payload: body.payload,
        expiresAt: Date.now() + EXPORT_TTL_MS,
      });
      return { id, path: `/api/export-cache/${encodeURIComponent(id)}` };
    },

    "GET /api/export-cache/:id": async ({ id }) => {
      cleanupExportCache();
      const cached = exportCache.get(id);
      if (!cached) {
        return {
          status: 404,
          __raw: {
            contentType: "text/html; charset=utf-8",
            body: '<!doctype html><meta charset="utf-8"><title>Expirado</title><p>Este enlace de descarga expiro o no existe.</p>',
          },
        };
      }
      return {
        __raw: {
          contentType: "text/html; charset=utf-8",
          body: buildExportPage(cached.payload),
        },
      };
    },
  };
}
