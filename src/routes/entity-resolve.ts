import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { resolveEntityMatches } from "../storage/entity-repository.js";
import { pool } from "../storage/postgres.js";

const resolveQuerySchema = z
  .object({
    id: z.string().optional(),
    q: z.string().optional(),
  })
  .refine((value) => value.id || value.q, {
    message: "Provide either id or q",
  });

export const registerEntityResolveRoutes: FastifyPluginAsync = async (app) => {
  app.get("/entities/resolve", async (request, reply) => {
    const parsed = resolveQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_entity_query",
        issues: parsed.error.flatten(),
      });
    }

    const matches = await resolveEntityMatches(pool, {
      id: parsed.data.id,
      q: parsed.data.q,
    });

    return {
      matches,
    };
  });
};
