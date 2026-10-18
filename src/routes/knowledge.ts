import type { FastifyPluginAsync } from "fastify";
import { ownerScope } from "../auth.js";
import { listEntities } from "../storage/entity-repository.js";
import { listRelations } from "../storage/relation-repository.js";

export const registerKnowledgeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/entities", async (request) => listEntities(ownerScope(request)));
  app.get("/relations", async (request) => listRelations(ownerScope(request)));
};
