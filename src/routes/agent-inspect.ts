import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { inspectKnowledge } from "../storage/agent-inspect.js";
import { parseGraphOptions } from "../storage/graph-repository.js";

const inspectSchema = z.object({
  id: z.string().optional(),
  q: z.string().optional(),
  depth: z.string().optional(),
  maxNodes: z.string().optional(),
  maxRelations: z.string().optional(),
}).refine((value) => value.id || value.q, {
  message: "Provide either id or q",
});

export const registerAgentInspectRoutes: FastifyPluginAsync = async (app) => {
  app.get("/agent/inspect", async (request, reply) => {
    const parsed = inspectSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_inspect_query",
        issues: parsed.error.flatten(),
      });
    }

    const options = parseGraphOptions({
      depth: parsed.data.depth,
      maxNodes: parsed.data.maxNodes,
      maxRelations: parsed.data.maxRelations,
    });

    return inspectKnowledge({
      id: parsed.data.id,
      q: parsed.data.q,
      depth: options.depth,
      maxNodes: options.maxNodes,
      maxRelations: options.maxRelations,
    });
  });
};
