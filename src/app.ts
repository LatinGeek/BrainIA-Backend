import crypto from "node:crypto";
import Fastify from "fastify";
import { createApiAuthHook, loadAuthConfig } from "./auth.js";
import { registerAgentRoutes } from "./routes/agent.js";
import { registerAgentInspectRoutes } from "./routes/agent-inspect.js";
import { registerCaptureRoutes } from "./routes/capture.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerEntityResolveRoutes } from "./routes/entity-resolve.js";
import { registerEntityMergeRoutes } from "./routes/entity-merge.js";
import { registerDigestRoutes } from "./routes/digests.js";
import { registerEntityAliasRoutes } from "./routes/entity-aliases.js";
import { registerFinancialTransactionRoutes } from "./routes/financial-transactions.js";
import { registerGraphRoutes } from "./routes/graph.js";
import { registerInsightsRoutes } from "./routes/insights.js";
import { registerKnowledgeRoutes } from "./routes/knowledge.js";
import { registerMetricsRoutes } from "./routes/metrics.js";
import { registerSearchRoutes } from "./routes/search.js";
import { config } from "./config.js";
import type { AuthConfig } from "./auth.js";

export async function buildApp(options: { authConfig?: AuthConfig } = {}) {
  const authConfig = options.authConfig ?? loadAuthConfig();
  const app = Fastify({
    logger: true,
    genReqId: (request) => {
      const headerRequestId = request.headers["x-request-id"];
      if (typeof headerRequestId === "string" && headerRequestId.trim()) {
        return headerRequestId.trim();
      }

      return crypto.randomUUID();
    },
  });

  app.addHook("onRequest", async (request, reply) => {
    reply
      .header("access-control-allow-origin", "*")
      .header("access-control-allow-methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS")
      .header("access-control-allow-headers", "content-type, authorization, x-api-key, x-client-id, x-request-id");

    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }

    reply.header("x-request-id", request.id);
  });

  app.addHook("onResponse", async (request, reply) => {
    const responseTime = reply.elapsedTime;
    if (responseTime >= 1000) {
      request.log.warn(
        {
          requestId: request.id,
          method: request.method,
          url: request.url,
          statusCode: reply.statusCode,
          responseTimeMs: Math.round(responseTime),
        },
        "slow request",
      );
    }
  });

  app.get("/health", async () => ({ ok: true }));
  await app.register(registerDashboardRoutes, {});
  app.addHook("preHandler", createApiAuthHook(authConfig));
  await app.register(registerAgentRoutes, { prefix: config.apiPrefix });
  await app.register(registerAgentInspectRoutes, { prefix: config.apiPrefix });
  await app.register(registerCaptureRoutes({ authConfig }), { prefix: config.apiPrefix });
  await app.register(registerEventRoutes({ authConfig }), { prefix: config.apiPrefix });
  await app.register(registerMetricsRoutes, { prefix: config.apiPrefix });
  await app.register(registerKnowledgeRoutes, { prefix: config.apiPrefix });
  await app.register(registerInsightsRoutes, { prefix: config.apiPrefix });
  await app.register(registerDigestRoutes, { prefix: config.apiPrefix });
  await app.register(registerFinancialTransactionRoutes, { prefix: config.apiPrefix });
  await app.register(registerEntityResolveRoutes, { prefix: config.apiPrefix });
  await app.register(registerEntityMergeRoutes, { prefix: config.apiPrefix });
  await app.register(registerEntityAliasRoutes, { prefix: config.apiPrefix });
  await app.register(registerGraphRoutes, { prefix: config.apiPrefix });
  await app.register(registerSearchRoutes, { prefix: config.apiPrefix });

  return app;
}
