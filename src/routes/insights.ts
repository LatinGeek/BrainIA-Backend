import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { createKnowledgeInsight } from "../storage/insights.js";
import { pool } from "../storage/postgres.js";
import { insertInsightRun, listInsightRuns, loadInsightRunById } from "../storage/insight-repository.js";
import { listEntities } from "../storage/entity-repository.js";

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

const dailyInsightSchema = z.object({
  id: z.string().min(1).optional(),
  q: z.string().min(1).optional(),
}).refine((value) => value.id || value.q, { message: "Provide id or q when no entity is available" });

export const registerInsightsRoutes: FastifyPluginAsync = async (app) => {
  app.post("/insights/daily", async (request, reply) => {
    const token = process.env.BRAINIA_DAILY_INSIGHTS_TOKEN?.trim();
    if (!token || request.headers["x-brainia-daily-insights-token"] !== token) {
      return reply.status(401).send({ error: "unauthorized_daily_insight", message: "A valid daily-insights token is required" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const requested = dailyInsightSchema.safeParse(body);
    const latestEntity = requested.success ? null : (await listEntities()).at(-1);
    if (!requested.success && !latestEntity) {
      return reply.status(400).send({ error: "invalid_daily_insight_request", issues: requested.error.flatten() });
    }

    const input = requested.success ? requested.data : { id: latestEntity!.id };
    const insight = await createKnowledgeInsight({ id: input.id, q: input.q, depth: 2, maxNodes: 100, maxRelations: 100 });
    const storedRun = await insertInsightRun(pool, {
      toolName: "generate_daily_insight",
      query: insight.query,
      request: { ...input, schedule: "daily" },
      response: insight,
      summary: insight.summary,
      model: insight.model,
    });

    return { ...insight, audit: storedRun ? { id: storedRun.id, createdAt: storedRun.createdAt, model: storedRun.model, toolName: storedRun.toolName } : null };
  });

  app.get("/insights", async (request, reply) => {
    const parsed = insightSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_insight_query",
        issues: parsed.error.flatten(),
      });
    }

    const insight = await createKnowledgeInsight({
      id: parsed.data.id,
      q: parsed.data.q,
      depth: parsed.data.depth ? Number(parsed.data.depth) : undefined,
      maxNodes: parsed.data.maxNodes ? Number(parsed.data.maxNodes) : undefined,
      maxRelations: parsed.data.maxRelations ? Number(parsed.data.maxRelations) : undefined,
    });

    const storedRun = await insertInsightRun(pool, {
      toolName: "generate_insight",
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

    const parsedLimit = Number(parsed.data.limit ?? "25");
    const limit = Number.isFinite(parsedLimit) ? Math.min(100, Math.max(1, Math.trunc(parsedLimit))) : 25;
    const runs = await listInsightRuns(limit);

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

    const run = await loadInsightRunById(params.data.id);
    if (!run) {
      return reply.status(404).send({
        error: "insight_run_not_found",
        message: "No stored insight run matches the provided id",
      });
    }

    return run;
  });
};
