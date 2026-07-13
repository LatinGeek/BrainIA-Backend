import Fastify from "fastify";
import { registerAgentRoutes } from "./routes/agent.js";
import { registerAgentInspectRoutes } from "./routes/agent-inspect.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerEntityResolveRoutes } from "./routes/entity-resolve.js";
import { registerGraphRoutes } from "./routes/graph.js";
import { registerKnowledgeRoutes } from "./routes/knowledge.js";
import { registerSearchRoutes } from "./routes/search.js";
import { config } from "./config.js";

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.get("/health", async () => ({ ok: true }));
  await app.register(registerAgentRoutes, { prefix: config.apiPrefix });
  await app.register(registerAgentInspectRoutes, { prefix: config.apiPrefix });
  await app.register(registerEventRoutes, { prefix: config.apiPrefix });
  await app.register(registerKnowledgeRoutes, { prefix: config.apiPrefix });
  await app.register(registerEntityResolveRoutes, { prefix: config.apiPrefix });
  await app.register(registerGraphRoutes, { prefix: config.apiPrefix });
  await app.register(registerSearchRoutes, { prefix: config.apiPrefix });

  return app;
}
