import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { insertDigestRun, listDigestRuns, loadDigestRunById } from "../storage/digest-repository.js";
import { createKnowledgeDigest } from "../storage/digests.js";
import { config } from "../config.js";
import { pool } from "../storage/postgres.js";
import { upsertEmbedding } from "../storage/embeddings.js";
import { ownerScope } from "../auth.js";

const digestQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  days: z.string().optional(),
  source: z.string().optional(),
  kind: z.string().optional(),
  eventLimit: z.string().optional(),
});

const digestHistoryQuerySchema = z.object({
  limit: z.string().optional(),
});

const digestHistoryParamsSchema = z.object({
  id: z.string().min(1),
});

function parsePositiveInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export const registerDigestRoutes: FastifyPluginAsync = async (app) => {
  app.get("/digests", async (request, reply) => {
    const parsed = digestQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_digest_query",
        issues: parsed.error.flatten(),
      });
    }

    const days = parsePositiveInteger(parsed.data.days, 7, 1, 365);
    const eventLimit = parsePositiveInteger(parsed.data.eventLimit, 100, 1, 500);
    const to = parsed.data.to ?? new Date().toISOString();
    const from = parsed.data.from ?? new Date(Date.parse(to) - days * 24 * 60 * 60 * 1000).toISOString();

    if (Date.parse(from) > Date.parse(to)) {
      return reply.status(400).send({
        error: "invalid_digest_window",
        message: "The from timestamp must be before or equal to the to timestamp",
      });
    }

    const ownerId = ownerScope(request);
    const { lineage, ...digest } = await createKnowledgeDigest({
      from,
      to,
      days,
      source: parsed.data.source,
      kind: parsed.data.kind,
      eventLimit,
      apiKey: config.deepseekApiKey,
      model: config.deepseekModel,
      ownerId,
    });

    const storedRun = await insertDigestRun(pool, {
      toolName: "generate_digest",
      ownerId,
      scope: digest.scope,
      windowFrom: digest.window.from,
      windowTo: digest.window.to,
      request: {
        from,
        to,
        days,
        source: parsed.data.source ?? null,
        kind: parsed.data.kind ?? null,
        eventLimit,
        // Exact evidence lineage: deletion can match these ids without relying
        // on summary text or a missing window reference.
        eventIds: lineage?.eventIds ?? [],
        sources: lineage?.sources ?? [],
      },
      response: digest,
      summary: digest.summary,
      model: digest.model,
    });
    if (storedRun && digest.summary) await upsertEmbedding(pool, {
      objectType: "digest", objectId: storedRun.id, content: digest.summary,
      metadata: { title: digest.scope, events: digest.metrics.totalEvents },
    });

    request.log.info(
      {
        runId: storedRun?.id ?? null,
        scope: digest.scope,
        eventsCount: digest.metrics.totalEvents,
        summaryAvailable: digest.summaryAvailable,
      },
      "digest generated",
    );

    return {
      ...digest,
      audit: storedRun
        ? {
            id: storedRun.id,
            createdAt: storedRun.createdAt,
            model: storedRun.model,
            toolName: storedRun.toolName,
          }
        : null,
    };
  });

  app.get("/digests/history", async (request, reply) => {
    const parsed = digestHistoryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_digest_history_query",
        issues: parsed.error.flatten(),
      });
    }

    const limit = parsePositiveInteger(parsed.data.limit, 25, 1, 100);
    const runs = (await listDigestRuns(limit, ownerScope(request)))
      .filter((run) => run.summary !== null);

    return {
      limit,
      count: runs.length,
      runs,
    };
  });

  app.get("/digests/history/:id", async (request, reply) => {
    const params = digestHistoryParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: "invalid_digest_run_id",
        issues: params.error.flatten(),
      });
    }

    const run = await loadDigestRunById(params.data.id, ownerScope(request));
    if (!run || run.summary === null) {
      return reply.status(404).send({
        error: "digest_run_not_found",
        message: "No stored digest run matches the provided id",
      });
    }

    return run;
  });
};
