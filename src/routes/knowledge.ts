import type { FastifyPluginAsync } from "fastify";
import { listEntities } from "../storage/entity-repository.js";
import { listRelations } from "../storage/relation-repository.js";

export const registerKnowledgeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/entities", async () => listEntities());
  app.get("/relations", async () => listRelations());
};
