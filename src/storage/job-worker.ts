import { randomUUID } from "node:crypto";
import { verifyConfiguredBackup } from "./backup-verification.js";
import { applyRetentionPolicies } from "./data-controls.js";
import { refreshEventEmbeddings } from "./embeddings.js";
import { classifyCapturedEvent, correlateFinancialEvent, reprocessEvent } from "./event-store.js";
import {
  claimBackgroundJobs, completeBackgroundJob, enqueueBackgroundJob,
  failBackgroundJob, type BackgroundJob,
} from "./job-repository.js";
import { pool } from "./postgres.js";
import { detectInsightCandidates } from "./proactive-insights.js";
import { reconcileSemanticGraph } from "./semantic-reconciler.js";

async function requireEventId(job: BackgroundJob) {
  const eventId = job.eventId ?? (typeof job.payload.eventId === "string" ? job.payload.eventId : null);
  if (!eventId) throw new Error(`${job.jobType} job requires an eventId`);
  return eventId;
}

export async function executeBackgroundJob(job: BackgroundJob) {
  switch (job.jobType) {
    case "classification": {
      const eventId = await requireEventId(job);
      const classified = await classifyCapturedEvent(eventId);
      if (!classified) throw new Error(`Event ${eventId} is unavailable for classification`);
      await enqueueBackgroundJob(pool, {
        clientId: job.clientId, eventId, jobType: "semantic_enrichment",
        idempotencyKey: `semantic:${eventId}:semantic-governance-v2`, payload: { eventId }, provider: "deepseek",
      });
      return classified;
    }
    case "semantic_enrichment": {
      const eventId = await requireEventId(job);
      const enriched = await reprocessEvent(eventId, { reuseClassification: true, skipFinancial: true });
      if (!enriched) throw new Error(`Event ${eventId} is unavailable for semantic enrichment`);
      await Promise.all([
        enqueueBackgroundJob(pool, { clientId: job.clientId, eventId, jobType: "financial_correlation", idempotencyKey: `finance:${eventId}:v1`, payload: { eventId } }),
        enqueueBackgroundJob(pool, { clientId: job.clientId, eventId, jobType: "embedding", idempotencyKey: `embedding:${eventId}:${process.env.EMBEDDING_VERSION ?? "embedding-v1"}`, payload: { eventId } }),
        enqueueBackgroundJob(pool, { clientId: job.clientId, eventId, jobType: "insight_detection", idempotencyKey: `insight-detect:${eventId}:v1`, payload: { eventId } }),
      ]);
      return enriched;
    }
    case "embedding":
      return refreshEventEmbeddings(pool, await requireEventId(job));
    case "financial_correlation":
      return correlateFinancialEvent(await requireEventId(job));
    case "insight_detection":
      return detectInsightCandidates({ clientId: job.clientId });
    case "semantic_reconciliation":
      return reconcileSemanticGraph();
    case "retention":
      return applyRetentionPolicies();
    case "backup_verification":
      return verifyConfiguredBackup();
  }
}

export async function processBackgroundJobs(input: { workerId?: string; limit?: number } = {}) {
  const workerId = input.workerId ?? `worker_${randomUUID()}`;
  const jobs = await claimBackgroundJobs({ workerId, limit: input.limit });
  const results: Array<{ id: string; status: "succeeded" | "retry_scheduled" | "dead_letter"; error?: string }> = [];
  for (const job of jobs) {
    try {
      await executeBackgroundJob(job);
      await completeBackgroundJob(job);
      results.push({ id: job.id, status: "succeeded" });
    } catch (error) {
      const failed = await failBackgroundJob(job, error);
      results.push({ id: job.id, status: failed.deadLetter ? "dead_letter" : "retry_scheduled", error: failed.error });
    }
  }
  return { workerId, claimed: jobs.length, results };
}

