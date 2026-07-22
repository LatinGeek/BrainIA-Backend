import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getEntityGraph, getExploreGraph, parseExploreGraphOptions, parseGraphOptions } from "../storage/graph-repository.js";

const graphParamsSchema = z.object({
  id: z.string().min(1),
});

export const registerGraphRoutes: FastifyPluginAsync = async (app) => {
  app.get("/graph", async (request) => {
    const options = parseExploreGraphOptions(request.query as Record<string, string | undefined>);
    return getExploreGraph(options);
  });

  app.get("/entities/:id/graph", async (request, reply) => {
    const params = graphParamsSchema.safeParse(request.params);
    if (!params.success) {
      request.log.warn({ path: "/entities/:id/graph", issues: params.error.flatten() }, "invalid graph entity id");
      return reply.status(400).send({
        error: "invalid_entity_id",
        issues: params.error.flatten(),
      });
    }

    const options = parseGraphOptions(request.query as Record<string, string | undefined>);
    const graph = await getEntityGraph(params.data.id, options.depth, options.maxNodes, options.maxRelations);

    if (!graph) {
      request.log.warn({ path: "/entities/:id/graph", entityId: params.data.id }, "entity not found");
      return reply.status(404).send({
        error: "entity_not_found",
      });
    }

    request.log.info(
      {
        entityId: params.data.id,
        depth: options.depth,
        nodesCount: graph.stats.nodesCount,
        relationsCount: graph.stats.relationsCount,
        truncated: graph.stats.truncated,
      },
      "graph expanded",
    );

    return graph;
  });
};
