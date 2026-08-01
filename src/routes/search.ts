import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { searchKnowledge } from "../storage/search-repository.js";
import { hybridRetrieve } from "../storage/hybrid-retrieval.js";
import { CLIENT_ID_HEADER } from "../auth.js";

const searchQuerySchema = z.object({
  q: z.string().min(1),
  source: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const hybridQuerySchema = searchQuerySchema.extend({
  currency: z.string().min(1).optional(),
  account: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(10).max(30).default(20),
  includeGraph: z.coerce.boolean().default(true),
});

export const registerSearchRoutes: FastifyPluginAsync = async (app) => {
  app.get("/retrieval/hybrid", async (request, reply) => {
    const parsed = hybridQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_hybrid_retrieval_query", issues: parsed.error.flatten() });
    const header = request.headers[CLIENT_ID_HEADER];
    const clientId = (Array.isArray(header) ? header[0] : header)?.trim() || null;
    return hybridRetrieve(parsed.data.q, {
      clientId, source: parsed.data.source, kind: parsed.data.kind,
      from: parsed.data.from, to: parsed.data.to, currency: parsed.data.currency,
      account: parsed.data.account, category: parsed.data.category,
      limit: parsed.data.limit, includeGraph: parsed.data.includeGraph,
    });
  });

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
