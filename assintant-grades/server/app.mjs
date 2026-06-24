// Composition root compartido por el servidor local y la funcion de Vercel.
import { config } from "./config.mjs";
import { SoapClient } from "./infrastructure/soapClient.mjs";
import { OasisGateway } from "./infrastructure/oasisGateway.mjs";
import { MockOasisGateway } from "./infrastructure/mockOasisGateway.mjs";
import { Database } from "./infrastructure/database.mjs";
import { OasisService } from "./application/oasisService.mjs";
import { buildRoutes } from "./presentation/controllers.mjs";

let appPromise = null;

async function buildApp() {
  const soapClient = new SoapClient(config.oasis);
  const oasisGateway = new OasisGateway(soapClient);
  const mockGateway = new MockOasisGateway();
  const database = new Database(config.databaseUrl);
  const oasisService = new OasisService({ gateway: oasisGateway, mock: mockGateway, config });
  const routes = buildRoutes({ service: oasisService, db: database, config });

  if (database.enabled) {
    await database.ensureSchema();
  }

  return { config, database, routes };
}

export function getApp() {
  if (!appPromise) appPromise = buildApp();
  return appPromise;
}
