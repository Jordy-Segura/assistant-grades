import { getApp } from "../server/app.mjs";
import { handleHttpRequest } from "../server/presentation/httpServer.mjs";

export default async function handler(req, res) {
  const { config, routes } = await getApp();
  return handleHttpRequest(req, res, routes, config);
}

export const config = {
  runtime: "nodejs",
  maxDuration: 30,
};
