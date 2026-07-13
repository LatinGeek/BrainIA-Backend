import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { mergeEntities } from "../storage/entity-repository.js";
import { pool } from "../storage/postgres.js";

const mergeParamsSchema = z.object({
  id: z.string().min(1),
});

const mergeBodySchema = z.object({
  canonicalEntityId: z.string().min(1),
  reason: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const registerEntityMergeRoutes: FastifyPluginAsync = async (app) => {
  app.post("/entities/:id/merge", async (request, reply) => {
    const params = mergeParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: "invalid_entity_id",
        issues: params.error.flatten(),
      });
    }

    const body = mergeBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: "invalid_entity_merge",
        issues: body.error.flatten(),
      });
    }

    try {
      const merge = await mergeEntities(pool, params.data.id, body.data.canonicalEntityId, {
        reason: body.data.reason,
        confidence: body.data.confidence,
      });

      return reply.status(200).send(merge);
    } catch (error) {
      request.log.error({ error, entityId: params.data.id }, "entity merge failed");
      return reply.status(404).send({
        error: "entity_not_found",
        message: "Both entities must exist before they can be merged",
      });
    }
  });
};
