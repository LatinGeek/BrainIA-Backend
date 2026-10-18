import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { resolveEntityMatches } from "../storage/entity-repository.js";
import { pool } from "../storage/postgres.js";
import { ownerScope } from "../auth.js";

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

    const ownerId = ownerScope(request);
    const matches = await resolveEntityMatches(pool, {
      id: parsed.data.id,
      q: parsed.data.q,
      ownerId,
    });

    if (!ownerId) return { matches };
    const ids = [...new Set(matches.map((match) => match.canonicalEntityId ?? match.id))];
    if (ids.length === 0) return { matches };
    const allowed = await pool.query<{ id: string }>(
      `select id from entities where id = any($1::text[]) and (owner_id = $2 or (owner_id is null and type in ('domain','concept')))`,
      [ids, ownerId],
    );
    const visible = new Set(allowed.rows.map((row) => row.id));
    return { matches: matches.filter((match) => visible.has(match.canonicalEntityId ?? match.id)) };
  });
};
