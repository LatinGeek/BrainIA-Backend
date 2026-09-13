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
import { SEMANTIC_GOVERNANCE_VERSION } from "../domain/ontology.js";

const JOB_PRIORITY = {
  classification: 10,
  semanticEnrichment: 20,
  reconciliation: 30,
  insightDetection: 80,
  embedding: 90,
} as const;

function insightWindowKey(now = new Date()) {
  // Insight detection is a client-wide analytical pass. Coalescing it into a
  // short window avoids creating one identical scan for every captured event.
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}T${String(now.getUTCHours()).padStart(2, "0")}`;
}

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
      // Financial projections use deterministic classification and must be
      // available independently of the optional semantic/LLM pipeline.
      await correlateFinancialEvent(eventId);
      await enqueueBackgroundJob(pool, {
        clientId: job.clientId, eventId, jobType: "semantic_enrichment",
        idempotencyKey: `semantic:${eventId}:${SEMANTIC_GOVERNANCE_VERSION}`, payload: { eventId }, provider: "deepseek",
        priority: JOB_PRIORITY.semanticEnrichment,
      });
      return classified;
    }
    case "semantic_enrichment": {
      const eventId = await requireEventId(job);
      const enriched = await reprocessEvent(eventId, { reuseClassification: true, skipFinancial: true });
      if (!enriched) throw new Error(`Event ${eventId} is unavailable for semantic enrichment`);
      await Promise.all([
        enqueueBackgroundJob(pool, {
          clientId: job.clientId, eventId, jobType: "embedding",
          idempotencyKey: `embedding:${eventId}:${process.env.EMBEDDING_VERSION ?? "embedding-v1"}`,
          payload: { eventId }, priority: JOB_PRIORITY.embedding,
        }),
        enqueueBackgroundJob(pool, {
          clientId: job.clientId, jobType: "insight_detection",
          idempotencyKey: `insight-detect:${job.clientId ?? "global"}:${insightWindowKey()}`,
          payload: { triggerEventId: eventId }, priority: JOB_PRIORITY.insightDetection,
        }),
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
