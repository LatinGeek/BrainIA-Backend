import Fastify from "fastify";
import { createApiAuthHook, loadAuthConfig } from "./auth.js";
import { registerAgentRoutes } from "./routes/agent.js";
import { registerAgentInspectRoutes } from "./routes/agent-inspect.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerEntityResolveRoutes } from "./routes/entity-resolve.js";
import { registerEntityMergeRoutes } from "./routes/entity-merge.js";
import { registerGraphRoutes } from "./routes/graph.js";
import { registerKnowledgeRoutes } from "./routes/knowledge.js";
import { registerMetricsRoutes } from "./routes/metrics.js";
import { registerSearchRoutes } from "./routes/search.js";
import { config } from "./config.js";
import type { AuthConfig } from "./auth.js";

export async function buildApp(options: { authConfig?: AuthConfig } = {}) {
  const authConfig = options.authConfig ?? loadAuthConfig();
  const app = Fastify({
    logger: true,
  });

  app.get("/health", async () => ({ ok: true }));
  app.addHook("preHandler", createApiAuthHook(authConfig));
  await app.register(registerAgentRoutes, { prefix: config.apiPrefix });
  await app.register(registerAgentInspectRoutes, { prefix: config.apiPrefix });
  await app.register(registerEventRoutes({ authConfig }), { prefix: config.apiPrefix });
  await app.register(registerMetricsRoutes, { prefix: config.apiPrefix });
  await app.register(registerKnowledgeRoutes, { prefix: config.apiPrefix });
  await app.register(registerEntityResolveRoutes, { prefix: config.apiPrefix });
  await app.register(registerEntityMergeRoutes, { prefix: config.apiPrefix });
  await app.register(registerGraphRoutes, { prefix: config.apiPrefix });
  await app.register(registerSearchRoutes, { prefix: config.apiPrefix });

  return app;
}
