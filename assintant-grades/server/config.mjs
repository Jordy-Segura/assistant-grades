// ============================================================================
// CAPA DE CONFIGURACIÓN  ·  Patrón: Singleton
// ----------------------------------------------------------------------------
// Centraliza la lectura y validación de variables de entorno. Se construye UNA
// sola vez y se comparte (importa) en toda la aplicación. Ninguna otra capa lee
// process.env directamente: todas dependen de este objeto `config`.
// ============================================================================
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(here, ".env"));
} catch {
  /* .env es opcional: en su ausencia se usan datos de demostración (mock). */
}

function buildConfig() {
  const warnings = [];
  const OASIS_USER = process.env.OASIS_USER || "";
  const OASIS_PASS = process.env.OASIS_PASS || "";
  if (!OASIS_USER) warnings.push("Falta OASIS_USER — las operaciones autenticadas usarán datos de demostración (mock).");
  if (!OASIS_PASS) warnings.push("Falta OASIS_PASS — las operaciones autenticadas usarán datos de demostración (mock).");

  const OASIS_BASE = (process.env.OASIS_BASE || "http://swoasis.espoch.edu.ec/OASis/OAS_Interop").replace(/\/+$/, "");
  if (!process.env.OASIS_BASE) warnings.push(`Falta OASIS_BASE — se usará ${OASIS_BASE}`);

  return {
    port: Number(process.env.PORT || 3001),
    corsOrigin: process.env.CORS_ORIGIN || "*",
    oasis: {
      base: OASIS_BASE,
      user: OASIS_USER,
      pass: OASIS_PASS,
      namespace: "http://academico.espoch.edu.ec/",
      timeout: Number(process.env.OASIS_TIMEOUT || 20000),
      // Si no hay usuario de servicio, las operaciones autenticadas caen a mock.
      hasCredentials: Boolean(OASIS_USER),
    },
    databaseUrl: process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || "",
    warnings,
  };
}

// Instancia única compartida por toda la app (Singleton).
export const config = buildConfig();
