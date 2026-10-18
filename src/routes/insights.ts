import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { createKnowledgeInsight } from "../storage/insights.js";
import { pool, withOwnerRead } from "../storage/postgres.js";
import { insertInsightRun, listInsightRuns, loadInsightRunById } from "../storage/insight-repository.js";
import { listEntities } from "../storage/entity-repository.js";
import { runDailyKnowledgeEvaluation } from "../storage/proactive-insights.js";
import { upsertEmbedding } from "../storage/embeddings.js";
import { ownerScope, principalFromRequest, requireScope } from "../auth.js";

const insightSchema = z
  .object({
    id: z.string().optional(),
    q: z.string().optional(),
    depth: z.string().optional(),
    maxNodes: z.string().optional(),
    maxRelations: z.string().optional(),
  })
  .refine((value) => value.id || value.q, {
    message: "Provide either id or q",
  });

const insightHistoryQuerySchema = z.object({
  limit: z.string().optional(),
});

const insightHistoryParamsSchema = z.object({
  id: z.string().min(1),
});

function normalizeInsightHistoryLimit(value: string | undefined) {
  const parsedLimit = Number(value ?? "25");
  return Number.isFinite(parsedLimit) ? Math.min(100, Math.max(1, Math.trunc(parsedLimit))) : 25;
}

const dailyInsightSchema = z.object({
  id: z.string().min(1).optional(),
  q: z.string().min(1).optional(),
}).refine((value) => value.id || value.q, { message: "Provide id or q when no entity is available" });

// Global job runs are intentionally ownerless. They are tagged so operators can
// distinguish them from legacy misfiled rows, and they stay outside every
// owner-scoped history read (those filter `owner_id is not distinct from the
// caller`). Only this explicit global writer sets the marker.
async function markGlobalDerivedRuns(writer: "cron" | "daily", result: {
  insight?: { id?: string | null } | null;
  digest?: { id?: string | null } | null;
}) {
  const targets: Array<{ table: "insight_runs" | "digest_runs"; id: string | null | undefined }> = [
    { table: "insight_runs", id: result.insight?.id },
    { table: "digest_runs", id: result.digest?.id },
  ];
  for (const target of targets) {
    if (!target.id) continue;
    await pool.query(
      `update ${target.table}
       set request = coalesce(request, '{}'::jsonb) || jsonb_build_object('scope', 'global', 'writer', $2)
       where id = $1 and owner_id is null`,
      [target.id, writer],
    );
  }
}

export const registerInsightsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/cron/daily-insights", async (request, reply) => {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret || request.headers.authorization !== `Bearer ${secret}`) {
      return reply.status(401).send({ error: "unauthorized_cron" });
    }
    // Cron is a global/jobs writer, never an owner. Requiring the jobs scope
    // here keeps an owner credential from silently producing owner-null runs.
    requireScope(request, "jobs");
    const result = await runDailyKnowledgeEvaluation();
    await markGlobalDerivedRuns("cron", result);
    request.log.info({ candidatesDetected: result.candidatesDetected, insightId: result.insight?.id ?? null, digestId: result.digest?.id ?? null }, "daily knowledge evaluation completed");
    return { ok: true, scope: "global", writer: "cron", ...result };
  });

  app.post("/insights/daily", async (request, reply) => {
    const token = process.env.BRAINIA_DAILY_INSIGHTS_TOKEN?.trim();
    if (!token || request.headers["x-brainia-daily-insights-token"] !== token) {
      return reply.status(401).send({ error: "unauthorized_daily_insight", message: "A valid daily-insights token is required" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    if (Object.keys(body).length === 0) {
      // An empty body asks for the global daily evaluation. A scoped owner must
      // name the id/q it wants instead, so this request never creates an
      // owner-null run on behalf of an owner. Cron/global/legacy-unscoped
      // principals are explicit global writers and keep working.
      const principal = principalFromRequest(request);
      if (principal.mode === "client") {
        return reply.status(400).send({
          error: "owner_scoped_daily_insight_required",
          message: "Provide id or q; the global daily evaluation is reserved for the jobs token",
        });
      }
      const result = await runDailyKnowledgeEvaluation();
      await markGlobalDerivedRuns("daily", result);
      return { ok: true, scope: "global", writer: "daily", ...result };
    }
    const requested = dailyInsightSchema.safeParse(body);
    const latestEntity = requested.success ? null : (await listEntities(ownerScope(request))).at(-1);
    if (!requested.success && !latestEntity) {
      return reply.status(400).send({ error: "invalid_daily_insight_request", issues: requested.error.flatten() });
    }

    const input = requested.success ? requested.data : { id: latestEntity!.id };
    const { lineage, ...insight } = await createKnowledgeInsight({ id: input.id, q: input.q, clientId: ownerScope(request), depth: 2, maxNodes: 100, maxRelations: 100 });
    const storedRun = await insertInsightRun(pool, {
      toolName: "generate_daily_insight",
      ownerId: ownerScope(request),
      query: insight.query,
      request: { ...input, schedule: "daily" },
      response: insight,
      summary: insight.summary,
      model: insight.model,
      evidence: lineage ? [{ eventIds: lineage.eventIds, sources: lineage.sources }] : [],
    });
    if (storedRun && insight.summary) await upsertEmbedding(pool, {
      objectType: "insight", objectId: storedRun.id, content: insight.summary,
      metadata: { title: insight.query ?? "Insight", confidence: 0.7 },
    });

    return { ...insight, audit: storedRun ? { id: storedRun.id, createdAt: storedRun.createdAt, model: storedRun.model, toolName: storedRun.toolName } : null };
  });

  app.get("/insights", async (request, reply) => {
    // Older mobile builds used this path to list saved insights. Keep that
    // contract working while reserving id/q requests for insight generation.
    const query = request.query as Record<string, unknown>;
    if (typeof query.limit === "string" && !query.id && !query.q) {
      const history = insightHistoryQuerySchema.safeParse(request.query);
      if (!history.success) {
        return reply.status(400).send({
          error: "invalid_insight_history_query",
          issues: history.error.flatten(),
        });
      }

      const limit = normalizeInsightHistoryLimit(history.data.limit);
      const ownerId = ownerScope(request);
      const runs = (await withOwnerRead(ownerId, (db) => listInsightRuns(limit, ownerId, db)))
        .filter((run) => run.summary !== null || run.query !== null);
      return { limit, count: runs.length, runs };
    }

    const parsed = insightSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_insight_query",
        issues: parsed.error.flatten(),
      });
    }

    const { lineage, ...insight } = await createKnowledgeInsight({
      id: parsed.data.id,
      q: parsed.data.q,
      clientId: ownerScope(request),
      depth: parsed.data.depth ? Number(parsed.data.depth) : undefined,
      maxNodes: parsed.data.maxNodes ? Number(parsed.data.maxNodes) : undefined,
      maxRelations: parsed.data.maxRelations ? Number(parsed.data.maxRelations) : undefined,
    });

    const storedRun = await insertInsightRun(pool, {
      toolName: "generate_insight",
      ownerId: ownerScope(request),
      query: insight.query,
      request: {
        id: parsed.data.id ?? null,
        q: parsed.data.q ?? null,
        depth: parsed.data.depth ? Number(parsed.data.depth) : 2,
        maxNodes: parsed.data.maxNodes ? Number(parsed.data.maxNodes) : 100,
        maxRelations: parsed.data.maxRelations ? Number(parsed.data.maxRelations) : 100,
      },
      response: insight,
      summary: insight.summary,
      model: insight.model,
      evidence: lineage ? [{ eventIds: lineage.eventIds, sources: lineage.sources }] : [],
    });
    if (storedRun && insight.summary) await upsertEmbedding(pool, {
      objectType: "insight", objectId: storedRun.id, content: insight.summary,
      metadata: { title: insight.query ?? "Insight", confidence: 0.7 },
    });

    request.log.info(
      {
        runId: storedRun?.id ?? null,
        query: insight.query,
        model: storedRun?.model ?? null,
        summaryAvailable: insight.summaryAvailable,
      },
      "insight generated",
    );

    return {
      ...insight,
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

  app.get("/insights/history", async (request, reply) => {
    const parsed = insightHistoryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_insight_history_query",
        issues: parsed.error.flatten(),
      });
    }

    const limit = normalizeInsightHistoryLimit(parsed.data.limit);
    const ownerId = ownerScope(request);
    const runs = (await withOwnerRead(ownerId, (db) => listInsightRuns(limit, ownerId, db)))
      .filter((run) => run.summary !== null || run.query !== null);

    return {
      limit,
      count: runs.length,
      runs,
    };
  });

  app.get("/insights/history/:id", async (request, reply) => {
    const params = insightHistoryParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: "invalid_insight_run_id",
        issues: params.error.flatten(),
      });
    }

    const ownerId = ownerScope(request);
    const run = await withOwnerRead(ownerId, (db) => loadInsightRunById(params.data.id, ownerId, db));
    if (!run || (run.summary === null && run.query === null)) {
      return reply.status(404).send({
        error: "insight_run_not_found",
        message: "No stored insight run matches the provided id",
      });
    }

    return run;
  });
};
