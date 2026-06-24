// ============================================================================
// COMPOSITION ROOT  ·  Patrón: Inyección de dependencias
// ----------------------------------------------------------------------------
// Único punto donde se construyen y enlazan TODAS las capas. Aquí se decide qué
// implementación concreta usa cada abstracción. El flujo de una petición es:
//
//   HTTP (presentation) -> Controllers -> OasisService (application)
//        -> OasisGateway / MockOasisGateway (infrastructure) -> SoapClient -> OASIS
//        -> Database (infrastructure) -> PostgreSQL
//        -> Mappers (domain) para traducir SOAP -> DTO
//
// El BFF es el único punto de contacto entre el frontend, OASIS SOAP y Postgres.
// Las credenciales de servicio NUNCA salen del servidor.
// ============================================================================
import { config } from "./config.mjs";
import { SoapClient } from "./infrastructure/soapClient.mjs";
import { OasisGateway } from "./infrastructure/oasisGateway.mjs";
import { MockOasisGateway } from "./infrastructure/mockOasisGateway.mjs";
import { Database } from "./infrastructure/database.mjs";
import { OasisService } from "./application/oasisService.mjs";
import { buildRoutes } from "./presentation/controllers.mjs";
import { createHttpServer } from "./presentation/httpServer.mjs";

// --- Infraestructura ---
const soapClient = new SoapClient(config.oasis);
const oasisGateway = new OasisGateway(soapClient);
const mockGateway = new MockOasisGateway();
const database = new Database(config.databaseUrl);

// --- Aplicación ---
const oasisService = new OasisService({ gateway: oasisGateway, mock: mockGateway, config });

// --- Presentación ---
const routes = buildRoutes({ service: oasisService, db: database, config });
const server = createHttpServer(routes, config);

// Inicializa el esquema de la BD si hay DATABASE_URL configurada.
if (database.enabled) {
  try {
    await database.ensureSchema();
    console.log("[BFF] PostgreSQL: conectado y esquema listo.");
  } catch (err) {
    console.error("[BFF] PostgreSQL: no se pudo inicializar:", err.message);
  }
} else {
  console.log("[BFF] PostgreSQL: NO configurado (defina DATABASE_URL). El frontend usará sessionStorage como respaldo.");
}

server.listen(config.port, () => {
  console.log(`[OASIS BFF] escuchando en http://localhost:${config.port}`);
  console.log(`[OASIS BFF] servicios SOAP: ${config.oasis.base}`);
  console.log(`[OASIS BFF] credenciales de servicio: ${config.oasis.hasCredentials ? "configuradas" : "NO configuradas (defina OASIS_USER / OASIS_PASS)"}`);
  config.warnings.forEach((w) => console.warn("[BFF] " + w));
});
