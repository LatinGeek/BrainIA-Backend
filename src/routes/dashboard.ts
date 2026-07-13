import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";

const webRoot = path.resolve(process.cwd(), "web");

async function readAsset(fileName: string) {
  return readFile(path.join(webRoot, fileName), "utf8");
}

export const registerDashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get("/dashboard", async (_request, reply) => {
    const html = await readAsset("index.html");
    return reply.type("text/html; charset=utf-8").send(html);
  });

  app.get("/dashboard/styles.css", async (_request, reply) => {
    const css = await readAsset("styles.css");
    return reply.type("text/css; charset=utf-8").send(css);
  });

  app.get("/dashboard/app.js", async (_request, reply) => {
    const js = await readAsset("app.js");
    return reply.type("application/javascript; charset=utf-8").send(js);
  });
};
