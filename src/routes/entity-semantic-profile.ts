import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { CLIENT_ID_HEADER } from "../auth.js";
import {
  ENTITY_ROLES, REVIEW_RELATION_TYPES, loadEntitySemanticProfile, saveEntitySemanticProfile,
} from "../storage/entity-semantic-profile.js";
import { pool } from "../storage/postgres.js";

function clientId(request: { headers: Record<string, string | string[] | undefined> }) {
  const value = request.headers[CLIENT_ID_HEADER];
  return (Array.isArray(value) ? value[0] : value)?.trim() || null;
}

const paramsSchema = z.object({ id: z.string().min(1) });
const profileSchema = z.object({
  taxonomyKeys: z.array(z.string().min(1).max(160)).max(12).default([]),
  roles: z.array(z.enum(ENTITY_ROLES)).max(8).default([]),
  notes: z.string().max(2_000).nullable().optional(),
  relations: z.array(z.object({
    relationType: z.enum(REVIEW_RELATION_TYPES),
    targetEntityId: z.string().min(1),
  })).max(12).default([]),
});

export const registerEntitySemanticProfileRoutes: FastifyPluginAsync = async (app) => {
  app.get("/entities/:id/profile", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "invalid_entity_id" });
    const profile = await loadEntitySemanticProfile(pool, params.data.id);
    return profile ?? reply.status(404).send({ error: "entity_not_found" });
  });

  app.put("/entities/:id/profile", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = profileSchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) return reply.status(400).send({
      error: "invalid_entity_profile",
      issues: { params: params.success ? undefined : params.error.flatten(), body: body.success ? undefined : body.error.flatten() },
    });
    try {
      const profile = await saveEntitySemanticProfile({ ...body.data, entityId: params.data.id, clientId: clientId(request) });
      return profile ?? reply.status(404).send({ error: "entity_not_found" });
    } catch (error) {
      return reply.status(409).send({ error: "invalid_entity_profile", message: error instanceof Error ? error.message : String(error) });
    }
  });
};
