// ============================================================================
// CAPA DE PRESENTACIÓN  ·  Patrón: Front Controller
// ----------------------------------------------------------------------------
// Transporte HTTP: CORS, parseo del cuerpo JSON, despacho a la tabla de rutas y
// traducción de errores a códigos HTTP. No contiene lógica de negocio: delega
// todo en los handlers de la tabla de rutas (controllers.mjs).
// ============================================================================
import http from "node:http";

// Error con código HTTP explícito (validaciones de entrada, etc.).
export class HttpError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function sendJson(res, status, payload, cors) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...cors });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) req.destroy(); // guarda básica contra cuerpos enormes
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

// Crea el servidor HTTP a partir de la tabla de rutas { "METHOD /path": handler }.
export function createHttpServer(routes, config) {
  const cors = corsHeaders(config.corsOrigin);
  return http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    const url = new URL(req.url, "http://localhost");
    const handler = routes[req.method + " " + url.pathname];
    if (!handler) {
      sendJson(res, 404, { error: "Recurso no encontrado: " + req.method + " " + url.pathname }, cors);
      return;
    }
    const hasBody = req.method === "POST" || req.method === "PUT";
    const arg = hasBody ? await readJsonBody(req) : Object.fromEntries(url.searchParams.entries());
    try {
      const data = await handler(arg);
      sendJson(res, 200, data, cors);
    } catch (err) {
      const status = err.soapFault ? 400 : err.statusCode || 502;
      console.error(`[BFF] Error ${status}: ${err.message}`);
      sendJson(res, status, { error: err.message || "Error interno del servidor" }, cors);
    }
  });
}
