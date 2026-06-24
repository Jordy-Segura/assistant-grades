// ============================================================================
// Servidor local del BFF OASIS/PostgreSQL.
// En Vercel se reutiliza la misma composicion desde api/[...path].mjs.
// ============================================================================
import { getApp } from "./app.mjs";
import { createHttpServer } from "./presentation/httpServer.mjs";

const { config, database, routes } = await getApp();
const server = createHttpServer(routes, config);

if (database.enabled) {
  console.log("[BFF] PostgreSQL: conectado y esquema listo.");
} else {
  console.log("[BFF] PostgreSQL: NO configurado (defina DATABASE_URL). El frontend usara sessionStorage como respaldo.");
}

server.listen(config.port, () => {
  console.log(`[OASIS BFF] escuchando en http://localhost:${config.port}`);
  console.log(`[OASIS BFF] servicios SOAP: ${config.oasis.base}`);
  console.log(`[OASIS BFF] credenciales de servicio: ${config.oasis.hasCredentials ? "configuradas" : "NO configuradas (defina OASIS_USER / OASIS_PASS)"}`);
  config.warnings.forEach((w) => console.warn("[BFF] " + w));
});
