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

function sendRaw(res, status, payload, cors) {
  res.writeHead(status, { "Content-Type": payload.contentType || "text/plain; charset=utf-8", ...cors, ...(payload.headers || {}) });
  res.end(payload.body || "");
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
  return http.createServer((req, res) => handleHttpRequest(req, res, routes, config));
}

export async function handleHttpRequest(req, res, routes, config) {
  const cors = corsHeaders(config.corsOrigin);
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  const url = new URL(req.url, "http://localhost");
  let handler = routes[req.method + " " + url.pathname];
  let routeArg = null;
  if (!handler && req.method === "GET" && url.pathname.startsWith("/api/export-cache/")) {
    handler = routes["GET /api/export-cache/:id"];
    routeArg = { id: decodeURIComponent(url.pathname.split("/").pop() || "") };
  }

  if (!handler) {
    sendJson(res, 404, { error: "Recurso no encontrado: " + req.method + " " + url.pathname }, cors);
    return;
  }

  const hasBody = req.method === "POST" || req.method === "PUT";
  const arg = routeArg || (hasBody ? await readJsonBody(req) : Object.fromEntries(url.searchParams.entries()));
  try {
    const data = await handler(arg);
    if (data && data.__raw) {
      sendRaw(res, data.status || 200, data.__raw, cors);
      return;
    }
    sendJson(res, 200, data, cors);
  } catch (err) {
    const status = err.soapFault ? 400 : err.statusCode || 502;
    console.error(`[BFF] Error ${status}: ${err.message}`);
    sendJson(res, status, { error: err.message || "Error interno del servidor" }, cors);
  }
}
