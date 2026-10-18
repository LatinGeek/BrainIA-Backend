import type { FastifyPluginAsync } from "fastify";
import { ownerScope } from "../auth.js";
import { listEntities } from "../storage/entity-repository.js";
import { withOwnerRead } from "../storage/postgres.js";
import { listRelations } from "../storage/relation-repository.js";

export const registerKnowledgeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/entities", async (request) => {
    const ownerId = ownerScope(request);
    return withOwnerRead(ownerId, (db) => listEntities(ownerId, db));
  });
  app.get("/relations", async (request) => {
    const ownerId = ownerScope(request);
    return withOwnerRead(ownerId, (db) => listRelations(ownerId, db));
  });
};
