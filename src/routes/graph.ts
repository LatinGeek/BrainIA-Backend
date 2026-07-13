import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getEntityGraph, parseGraphOptions } from "../storage/graph-repository.js";

const graphParamsSchema = z.object({
  id: z.string().min(1),
});

export const registerGraphRoutes: FastifyPluginAsync = async (app) => {
  app.get("/entities/:id/graph", async (request, reply) => {
    const params = graphParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: "invalid_entity_id",
        issues: params.error.flatten(),
      });
    }

    const options = parseGraphOptions(request.query as Record<string, string | undefined>);
    const graph = await getEntityGraph(params.data.id, options.depth, options.maxNodes, options.maxRelations);

    if (!graph) {
      return reply.status(404).send({
        error: "entity_not_found",
      });
    }

    return graph;
  });
};
