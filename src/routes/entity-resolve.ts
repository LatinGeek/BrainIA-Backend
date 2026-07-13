import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { pool } from "../storage/postgres.js";

const resolveQuerySchema = z.object({
  id: z.string().optional(),
  q: z.string().optional(),
}).refine((value) => value.id || value.q, {
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

    const { id, q } = parsed.data;
    const result = id
      ? await pool.query(
          `
            select
              id,
              type,
              value,
              normalized_value as "normalizedValue",
              metadata,
              created_at as "createdAt"
            from entities
            where id = $1
            limit 10
          `,
          [id],
        )
      : await pool.query(
          `
            select
              id,
              type,
              value,
              normalized_value as "normalizedValue",
              metadata,
              created_at as "createdAt"
            from entities
            where lower(id) like $1
               or lower(type) like $1
               or lower(value) like $1
               or lower(normalized_value) like $1
            order by created_at desc
            limit 10
          `,
          [`%${q!.trim().toLowerCase()}%`],
        );

    return {
      matches: result.rows,
    };
  });
};
