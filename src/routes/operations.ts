import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { backgroundJobMetrics, listBackgroundJobs, retryBackgroundJob } from "../storage/job-repository.js";
import { getKnowledgeQualityMetrics } from "../storage/quality-metrics.js";
import { processBackgroundJobs } from "../storage/job-worker.js";
import { verifyConfiguredBackup } from "../storage/backup-verification.js";
import { applyRetentionPolicies } from "../storage/data-controls.js";
import { listClientDiagnostics } from "../storage/client-diagnostic-repository.js";
import { config } from "../config.js";

function operationsAuthorized(headers: Record<string, string | string[] | undefined>) {
  const configured = process.env.BRAINIA_OPERATIONS_TOKEN?.trim();
  if (!configured) return false;
  const supplied = headers["x-brainia-operations-token"];
  return (Array.isArray(supplied) ? supplied[0] : supplied) === configured;
}

function cronAuthorized(headers: Record<string, string | string[] | undefined>) {
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = headers.authorization;
  return Boolean(secret && authorization === `Bearer ${secret}`);
}

export const registerOperationsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/cron/process-jobs", async (request, reply) => {
    if (!cronAuthorized(request.headers)) return reply.status(401).send({ error: "unauthorized_cron" });
    // Keep live captures moving ahead of derived work while still draining a
    // bounded batch on every invocation. The batch is capped in config so this
    // endpoint remains safe for the serverless runtime.
    const result = await processBackgroundJobs({ limit: config.workerBatchSize });
    request.log.info({ claimed: result.claimed, results: result.results }, "background jobs processed");
    return { ok: true, ...result };
  });

  app.get("/operations/client-diagnostics", async (request, reply) => {
    if (!operationsAuthorized(request.headers)) return reply.status(401).send({ error: "unauthorized_operations" });
    const parsed = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_client_diagnostic_query" });
    const items = await listClientDiagnostics(parsed.data.limit);
    return { count: items.length, items };
  });

  app.get("/operations/jobs", async (request, reply) => {
    if (!operationsAuthorized(request.headers)) return reply.status(401).send({ error: "unauthorized_operations" });
    const parsed = z.object({
      status: z.enum(["queued", "running", "retry_scheduled", "succeeded", "dead_letter", "cancelled"]).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }).safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_job_query", issues: parsed.error.flatten() });
    const [metrics, jobs, quality] = await Promise.all([
      backgroundJobMetrics(), listBackgroundJobs(parsed.data), getKnowledgeQualityMetrics(),
    ]);
    return { metrics, quality: quality.gates, count: jobs.length, jobs };
  });

  app.post("/operations/jobs/:id/retry", async (request, reply) => {
    if (!operationsAuthorized(request.headers)) return reply.status(401).send({ error: "unauthorized_operations" });
    const parsed = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_job_id" });
    const job = await retryBackgroundJob(parsed.data.id);
    return job ?? reply.status(404).send({ error: "retryable_job_not_found" });
  });

  app.post("/operations/worker/run", async (request, reply) => {
    if (!operationsAuthorized(request.headers)) return reply.status(401).send({ error: "unauthorized_operations" });
    const parsed = z.object({ limit: z.coerce.number().int().min(1).max(25).default(10) }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: "invalid_worker_request" });
    return processBackgroundJobs({ limit: parsed.data.limit });
  });

  app.post("/operations/retention/run", async (request, reply) => {
    if (!operationsAuthorized(request.headers)) return reply.status(401).send({ error: "unauthorized_operations" });
    return applyRetentionPolicies();
  });

  app.post("/operations/backups/verify", async (request, reply) => {
    if (!operationsAuthorized(request.headers)) return reply.status(401).send({ error: "unauthorized_operations" });
    const result = await verifyConfiguredBackup();
    return result.status === "verified" ? result : reply.status(503).send(result);
  });
};
