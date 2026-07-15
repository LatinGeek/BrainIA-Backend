import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  ignoreEntityReview,
  listEntityAliases,
  listEntityReviewQueue,
  resolveEntityReview,
} from "../storage/entity-alias-repository.js";
import { pool } from "../storage/postgres.js";

const aliasListQuerySchema = z.object({
  entityId: z.string().min(1).optional(),
});

const reviewListQuerySchema = z.object({
  status: z.enum(["pending", "resolved", "ignored"]).optional(),
});

const resolveReviewSchema = z.object({
  alias: z.string().min(1),
  categoryPath: z.array(z.string().min(1)).default([]),
  notes: z.string().optional(),
  reason: z.string().optional(),
  targetEntityId: z.string().min(1).optional(),
});

const ignoreReviewSchema = z.object({
  notes: z.string().optional(),
});

export const registerEntityAliasRoutes: FastifyPluginAsync = async (app) => {
  app.get("/aliases", async (request, reply) => {
    const parsed = aliasListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_alias_query",
        issues: parsed.error.flatten(),
      });
    }

    const aliases = await listEntityAliases(pool, parsed.data.entityId);
    return { aliases };
  });

  app.get("/review/aliases", async (request, reply) => {
    const parsed = reviewListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_review_query",
        issues: parsed.error.flatten(),
      });
    }

    const items = await listEntityReviewQueue(pool, parsed.data.status);
    return { items };
  });

  app.post("/review/aliases/:id/resolve", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = resolveReviewSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({
        error: "invalid_review_resolution",
        issues: {
          params: params.success ? undefined : params.error.flatten(),
          body: body.success ? undefined : body.error.flatten(),
        },
      });
    }

    try {
      const result = await resolveEntityReview(pool, params.data.id, {
        alias: body.data.alias,
        categoryPath: body.data.categoryPath,
        notes: body.data.notes,
        reason: body.data.reason,
        targetEntityId: body.data.targetEntityId,
      });

      if (!result) {
        return reply.status(404).send({
          error: "review_not_found",
          message: "No review queue item matches the provided id",
        });
      }

      return result;
    } catch (error) {
      return reply.status(409).send({
        error: "alias_conflict",
        message: error instanceof Error ? error.message : "Alias could not be resolved",
      });
    }
  });

  app.post("/review/aliases/:id/ignore", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = ignoreReviewSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({
        error: "invalid_review_ignore",
        issues: {
          params: params.success ? undefined : params.error.flatten(),
          body: body.success ? undefined : body.error.flatten(),
        },
      });
    }

    const ignored = await ignoreEntityReview(pool, params.data.id, body.data.notes);
    if (!ignored) {
      return reply.status(404).send({
        error: "review_not_found",
        message: "No review queue item matches the provided id",
      });
    }

    return ignored;
  });
};
