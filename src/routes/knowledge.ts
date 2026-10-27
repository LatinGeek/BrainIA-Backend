import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ownerScope } from "../auth.js";
import { listEntities } from "../storage/entity-repository.js";
import { withOwnerRead } from "../storage/postgres.js";
import { listRelations } from "../storage/relation-repository.js";

// Optional paging for clients that only render a slice; no params keeps the full list.
const entityPageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(2000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const registerKnowledgeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/entities", async (request, reply) => {
    const ownerId = ownerScope(request);
    const page = entityPageSchema.safeParse(request.query ?? {});
    if (!page.success) {
      return reply.status(400).send({ error: "invalid_entity_page", issues: page.error.flatten() });
    }
    return withOwnerRead(ownerId, (db) => listEntities(ownerId, db, page.data));
  });
  app.get("/relations", async (request) => {
    const ownerId = ownerScope(request);
    return withOwnerRead(ownerId, (db) => listRelations(ownerId, db));
  });
};
