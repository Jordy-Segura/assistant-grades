// ============================================================================
// CAPA DE INFRAESTRUCTURA  ·  Patrón: Facade
// ----------------------------------------------------------------------------
// Oculta toda la complejidad del transporte SOAP (armado del sobre, cabecera de
// credenciales, POST HTTP/HTTPS, parseo y manejo de SOAP Fault). Las capas
// superiores solo invocan `call(servicio, operacion, params)` y reciben el
// objeto `…Result` ya parseado a JSON. Las credenciales viven aquí (servidor) y
// nunca llegan al navegador.
// ============================================================================
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { parseXml } from "./xml.mjs";

// Error de negocio devuelto por OASIS (SOAP Fault) — se traduce a HTTP 400.
export class SoapFaultError extends Error {
  constructor(message) {
    super(message);
    this.name = "SoapFaultError";
    this.soapFault = true;
  }
}

function escapeXml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export class SoapClient {
  // `oasis` proviene del Singleton config: { base, user, pass, namespace, timeout }.
  constructor(oasis) {
    this.base = oasis.base;
    this.user = oasis.user;
    this.pass = oasis.pass;
    this.ns = oasis.namespace;
    this.timeout = oasis.timeout;
  }

  #buildEnvelope(innerBody) {
    return (
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"' +
      ' xmlns:xsd="http://www.w3.org/2001/XMLSchema"' +
      ' xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
      "<soap:Header>" +
      '<credentials xmlns="' + this.ns + '">' +
      "<username>" + escapeXml(this.user) + "</username>" +
      "<password>" + escapeXml(this.pass) + "</password>" +
      "</credentials>" +
      "</soap:Header>" +
      "<soap:Body>" + innerBody + "</soap:Body>" +
      "</soap:Envelope>"
    );
  }

  #httpPost(serviceUrl, action, envelope) {
    return new Promise((resolve, reject) => {
      const url = new URL(serviceUrl);
      const lib = url.protocol === "https:" ? https : http;
      const payload = Buffer.from(envelope, "utf8");
      const req = lib.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: url.pathname + url.search,
          method: "POST",
          headers: {
            "Content-Type": "text/xml; charset=utf-8",
            "Content-Length": payload.length,
            SOAPAction: '"' + this.ns + action + '"',
          },
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => resolve({ status: res.statusCode, body }));
        }
      );
      req.on("error", reject);
      req.setTimeout(this.timeout, () => req.destroy(new Error("Tiempo de espera agotado con el servicio OASIS")));
      req.write(payload);
      req.end();
    });
  }

  // Invoca una operación y devuelve el objeto `<Op>Result` (ya parseado a JSON).
  async call(service, op, params = {}) {
    const inner =
      "<" + op + ' xmlns="' + this.ns + '">' +
      Object.entries(params)
        .map(([key, value]) => "<" + key + ">" + escapeXml(value) + "</" + key + ">")
        .join("") +
      "</" + op + ">";

    const { status, body } = await this.#httpPost(this.base + "/" + service + ".asmx", op, this.#buildEnvelope(inner));
    const parsed = parseXml(body);
    const soapBody = parsed?.Envelope?.Body;

    if (soapBody?.Fault) {
      const message = soapBody.Fault.faultstring || "Error en el servicio OASIS";
      throw new SoapFaultError(String(message).split("--->").pop().trim());
    }
    if (status >= 400) {
      throw new Error("El servicio OASIS respondió con estado " + status);
    }
    return soapBody?.[op + "Response"]?.[op + "Result"] ?? null;
  }
}
