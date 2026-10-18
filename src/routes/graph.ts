import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getEntityGraph, getExploreGraph, getTaxonomyGraph, parseExploreGraphOptions, parseGraphOptions } from "../storage/graph-repository.js";
import { pool } from "../storage/postgres.js";
import { ownerScope, requireScope } from "../auth.js";

const graphParamsSchema = z.object({
  id: z.string().min(1),
});

export const registerGraphRoutes: FastifyPluginAsync = async (app) => {
  app.get("/graph", async (request) => {
    const options = parseExploreGraphOptions(request.query as Record<string, string | undefined>);
    if (options.projection === "taxonomy") return getTaxonomyGraph(options);
    // Explore combines personal identities and evidence. Until traversal is
    // owner-filtered end to end, only administrative scopes may read it.
    requireScope(request, "admin");
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
    const ownerId = ownerScope(request);
    const graph = await getEntityGraph(params.data.id, options.depth, options.maxNodes, options.maxRelations);

    if (!graph) {
      request.log.warn({ path: "/entities/:id/graph", entityId: params.data.id }, "entity not found");
      return reply.status(404).send({
        error: "entity_not_found",
      });
    }

    if (ownerId) {
      const nodeIds = [...new Set([graph.rootEntity.id, ...graph.nodes.map((node) => node.id)])];
      const owners = await pool.query<{ id: string; owner_id: string | null }>(
        `select id, owner_id from entities where id = any($1::text[])`,
        [nodeIds],
      );
      const foreign = new Set(owners.rows.filter((row) => row.owner_id && row.owner_id !== ownerId).map((row) => row.id));
      if (foreign.has(graph.rootEntity.id)) {
        return reply.status(404).send({ error: "entity_not_found" });
      }
      if (foreign.size > 0) {
        graph.nodes = graph.nodes.filter((node) => !foreign.has(node.id));
        const kept = new Set([graph.rootEntity.id, ...graph.nodes.map((node) => node.id)]);
        graph.relations = graph.relations.filter((relation) => kept.has(relation.sourceEntityId) && kept.has(relation.targetEntityId));
        graph.paths = graph.paths.filter((path) => path.nodeIds.every((id) => kept.has(id)));
        graph.stats.nodesCount = graph.nodes.length;
        graph.stats.relationsCount = graph.relations.length;
      }
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
