import type { FastifyPluginAsync } from "fastify";
import { getMetrics } from "../storage/event-store.js";
import { getKnowledgeQualityMetrics } from "../storage/quality-metrics.js";
import { requireScope } from "../auth.js";

export const registerMetricsRoutes: FastifyPluginAsync = async (app) => {
  // Aggregate counts span every owner; only administrative scopes may read them.
  app.get("/metrics/quality", async (request) => {
    requireScope(request, "admin");
    return getKnowledgeQualityMetrics();
  });
  app.get("/metrics", async (request) => {
    requireScope(request, "admin");
    const metrics = await getMetrics();
    return {
      rawEventsCount: Number(metrics.rawEventsCount),
      classifiedEventsCount: Number(metrics.classifiedEventsCount),
      entitiesCount: Number(metrics.entitiesCount),
      relationsCount: Number(metrics.relationsCount),
      eventEntitiesCount: Number(metrics.eventEntitiesCount),
      eventRelationsCount: Number(metrics.eventRelationsCount),
      financialTransactionsCount: Number(metrics.financialTransactionsCount),
      financialTransactionEventsCount: Number(metrics.financialTransactionEventsCount),
    };
  });
};
