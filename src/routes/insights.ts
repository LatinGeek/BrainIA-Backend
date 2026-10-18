import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { createKnowledgeInsight } from "../storage/insights.js";
import { pool } from "../storage/postgres.js";
import { insertInsightRun, listInsightRuns, loadInsightRunById } from "../storage/insight-repository.js";
import { listEntities } from "../storage/entity-repository.js";
import { runDailyKnowledgeEvaluation } from "../storage/proactive-insights.js";
import { upsertEmbedding } from "../storage/embeddings.js";
import { ownerScope } from "../auth.js";

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

export const registerInsightsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/cron/daily-insights", async (request, reply) => {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret || request.headers.authorization !== `Bearer ${secret}`) {
      return reply.status(401).send({ error: "unauthorized_cron" });
    }
    const result = await runDailyKnowledgeEvaluation();
    request.log.info({ candidatesDetected: result.candidatesDetected, insightId: result.insight?.id ?? null, digestId: result.digest?.id ?? null }, "daily knowledge evaluation completed");
    return { ok: true, ...result };
  });

  app.post("/insights/daily", async (request, reply) => {
    const token = process.env.BRAINIA_DAILY_INSIGHTS_TOKEN?.trim();
    if (!token || request.headers["x-brainia-daily-insights-token"] !== token) {
      return reply.status(401).send({ error: "unauthorized_daily_insight", message: "A valid daily-insights token is required" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    if (Object.keys(body).length === 0) {
      return { ok: true, ...await runDailyKnowledgeEvaluation() };
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
      const runs = (await listInsightRuns(limit, ownerScope(request)))
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
    const runs = (await listInsightRuns(limit, ownerScope(request)))
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

    const run = await loadInsightRunById(params.data.id, ownerScope(request));
    if (!run || (run.summary === null && run.query === null)) {
      return reply.status(404).send({
        error: "insight_run_not_found",
        message: "No stored insight run matches the provided id",
      });
    }

    return run;
  });
};
