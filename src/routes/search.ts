import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { searchKnowledge } from "../storage/search-repository.js";

const searchQuerySchema = z.object({
  q: z.string().min(1),
  source: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const registerSearchRoutes: FastifyPluginAsync = async (app) => {
  app.get("/search", async (request, reply) => {
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_search_query",
        issues: parsed.error.flatten(),
      });
    }

    return searchKnowledge(parsed.data.q, {
      source: parsed.data.source,
      kind: parsed.data.kind,
      from: parsed.data.from,
      to: parsed.data.to,
    });
  });
};
