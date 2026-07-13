import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { searchKnowledge } from "../storage/search-repository.js";

const searchQuerySchema = z.object({
  q: z.string().min(1),
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

    return searchKnowledge(parsed.data.q);
  });
};
