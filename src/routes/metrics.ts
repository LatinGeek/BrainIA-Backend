import type { FastifyPluginAsync } from "fastify";
import { getMetrics } from "../storage/event-store.js";

export const registerMetricsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/metrics", async () => {
    const metrics = await getMetrics();
    return {
      rawEventsCount: Number(metrics.rawEventsCount),
      classifiedEventsCount: Number(metrics.classifiedEventsCount),
      entitiesCount: Number(metrics.entitiesCount),
      relationsCount: Number(metrics.relationsCount),
      eventEntitiesCount: Number(metrics.eventEntitiesCount),
      eventRelationsCount: Number(metrics.eventRelationsCount),
    };
  });
};
