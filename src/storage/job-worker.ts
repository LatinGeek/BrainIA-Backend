import { randomUUID } from "node:crypto";
import { verifyConfiguredBackup } from "./backup-verification.js";
import { applyRetentionPolicies } from "./data-controls.js";
import { refreshEventEmbeddings } from "./embeddings.js";
import { classifyCapturedEvent, correlateFinancialEvent, reprocessEvent } from "./event-store.js";
import {
  claimBackgroundJobs, completeBackgroundJob, enqueueBackgroundJob, failBackgroundJob,
  heartbeatBackgroundJob, StaleJobClaimError,
  type BackgroundJob, type BackgroundJobClaim, type BackgroundJobType, type JobEffect,
} from "./job-repository.js";
import { pool } from "./postgres.js";
import { detectInsightCandidates } from "./proactive-insights.js";
import { reconcileSemanticGraph } from "./semantic-reconciler.js";
import { SEMANTIC_GOVERNANCE_VERSION } from "../domain/ontology.js";
import { runIntelligenceStep, scheduleIntelligence } from './intelligence.js';

const JOB_PRIORITY = {
  classification: 10,
  semanticEnrichment: 20,
  reconciliation: 30,
  insightDetection: 80,
  embedding: 90,
} as const;

export type BackgroundJobExecution = { value: unknown; effects: JobEffect[] };

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

function boundedEnvMs(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
}

export class StageDeadlineError extends Error {
  readonly code = "job_stage_deadline_exceeded";
  constructor(ms: number) {
    super(`Job stage exceeded its ${ms}ms deadline`);
    this.name = "StageDeadlineError";
  }
}

/**
 * Execute a job's expensive work and return the effects that must be published
 * inside the completion transaction. No downstream enqueue happens here: it is
 * deferred so a stale fence cannot publish it.
 */
export async function executeBackgroundJob(job: BackgroundJob): Promise<BackgroundJobExecution> {
  switch (job.jobType) {
    case 'intelligence_generation':
      return { value: await runIntelligenceStep(String(job.payload.artifactId), Number(job.payload.revision)), effects: [] };
    case "classification": {
      const eventId = await requireEventId(job);
      const classified = await classifyCapturedEvent(eventId, { fence: job });
      if (!classified) throw new Error(`Event ${eventId} is unavailable for classification`);
      // classifyCapturedEvent atomically materializes a financial projection
      // whenever the final classification is financial.
      return {
        value: classified,
        effects: [async (db) => {
          await enqueueBackgroundJob(db, {
            clientId: job.clientId, eventId, jobType: "semantic_enrichment",
            idempotencyKey: `semantic:${eventId}:${SEMANTIC_GOVERNANCE_VERSION}`, payload: { eventId }, provider: "deepseek",
            priority: JOB_PRIORITY.semanticEnrichment,
          });
        }],
      };
    }
    case "semantic_enrichment": {
      const eventId = await requireEventId(job);
      const enriched = await reprocessEvent(eventId, { reuseClassification: true, skipFinancial: true });
      if (!enriched) throw new Error(`Event ${eventId} is unavailable for semantic enrichment`);
      return {
        value: enriched,
        effects: [async (db) => {
          await enqueueBackgroundJob(db, {
            clientId: job.clientId, eventId, jobType: "embedding",
            idempotencyKey: `embedding:${eventId}:${process.env.EMBEDDING_VERSION ?? "embedding-v1"}`,
            payload: { eventId }, priority: JOB_PRIORITY.embedding,
          });
          await enqueueBackgroundJob(db, {
            clientId: job.clientId, jobType: "insight_detection",
            idempotencyKey: `insight-detect:${job.clientId ?? "global"}:${insightWindowKey()}`,
            payload: { triggerEventId: eventId }, priority: JOB_PRIORITY.insightDetection,
          });
        }],
      };
    }
    case "embedding":
      return { value: await refreshEventEmbeddings(pool, await requireEventId(job)), effects: [] };
    case "financial_correlation":
      return { value: await correlateFinancialEvent(await requireEventId(job), { fence: job }), effects: [] };
    case "insight_detection":
      return { value: await detectInsightCandidates({ clientId: job.clientId }), effects: [] };
    case "semantic_reconciliation":
      return { value: await reconcileSemanticGraph(), effects: [] };
    case "retention":
      return { value: await applyRetentionPolicies(), effects: [] };
    case "backup_verification":
      return { value: await verifyConfiguredBackup(), effects: [] };
    default:
      throw new Error(`Unsupported background job type: ${(job as BackgroundJob).jobType}`);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StageDeadlineError(ms)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function executeWithHeartbeat(job: BackgroundJobClaim, input: {
  leaseMs: number; heartbeatMs: number; stageDeadlineMs: number;
}) {
  let lostLease = false;
  const timer = setInterval(() => {
    void heartbeatBackgroundJob(job, { leaseMs: input.leaseMs }).then((owned) => {
      if (!owned) lostLease = true;
    }).catch(() => { lostLease = true; });
  }, input.heartbeatMs);
  timer.unref?.();
  try {
    const execution = await withTimeout(executeBackgroundJob(job), input.stageDeadlineMs);
    if (lostLease) throw new StaleJobClaimError(job.id, job.fenceToken, "heartbeat");
    return execution;
  } finally {
    clearInterval(timer);
  }
}

export type ProcessBackgroundJobsOptions = {
  workerId?: string;
  limit?: number;
  leaseMs?: number;
  heartbeatMs?: number;
  deadlineMs?: number;
  stageDeadlineMs?: number;
  globalCapacity?: number;
  perOwnerCapacity?: number;
  jobTypes?: readonly BackgroundJobType[];
};

export type ProcessedJobResult = {
  id: string;
  status: "succeeded" | "retry_scheduled" | "dead_letter" | "stale";
  error?: string;
};

/**
 * Bounded worker loop shared by the cron route, the operations route and the
 * standalone script. It never claims more than executable capacity and stops
 * claiming before the host deadline. Cron invocations may overlap: leases and
 * the global/per-owner active-claim bounds make the overlap safe.
 */
export async function processBackgroundJobs(input: ProcessBackgroundJobsOptions = {}) {
  await scheduleIntelligence();
  const workerId = input.workerId ?? `worker_${randomUUID()}`;
  const deadlineMs = input.deadlineMs ?? boundedEnvMs("BRAINIA_JOB_HOST_DEADLINE_MS", 45_000, 1_000, 5 * 60_000);
  const stageDeadlineMs = input.stageDeadlineMs ?? boundedEnvMs("BRAINIA_JOB_STAGE_DEADLINE_MS", 40_000, 500, 5 * 60_000);
  const leaseMs = input.leaseMs ?? boundedEnvMs("BRAINIA_JOB_LEASE_MS", 90_000, 1_000, 10 * 60_000);
  const heartbeatMs = Math.max(250, Math.min(
    input.heartbeatMs ?? boundedEnvMs("BRAINIA_JOB_HEARTBEAT_MS", 20_000, 250, 5 * 60_000),
    Math.max(250, Math.floor(leaseMs / 2)),
  ));
  const startedAt = Date.now();
  const results: ProcessedJobResult[] = [];
  let claimed = 0;
  let deadlineExceeded = false;

  while (Date.now() - startedAt < deadlineMs) {
    const jobs = await claimBackgroundJobs({
      workerId,
      limit: input.limit,
      leaseMs,
      globalCapacity: input.globalCapacity,
      perOwnerCapacity: input.perOwnerCapacity,
      jobTypes: input.jobTypes,
    });
    if (!jobs.length) break;
    for (const job of jobs) {
      claimed += 1;
      const remaining = deadlineMs - (Date.now() - startedAt);
      if (remaining <= 0) {
        deadlineExceeded = true;
        try {
          await failBackgroundJob(job, new Error("host_deadline_exceeded"));
          results.push({ id: job.id, status: "retry_scheduled", error: "host_deadline_exceeded" });
        } catch (error) {
          results.push({ id: job.id, status: "stale", error: error instanceof Error ? error.message : String(error) });
        }
        break;
      }
      try {
        const execution = await executeWithHeartbeat(job, {
          leaseMs, heartbeatMs,
          stageDeadlineMs: Math.min(stageDeadlineMs, Math.max(1, remaining)),
        });
        await completeBackgroundJob(job, async (db) => {
          for (const effect of execution.effects) await effect(db);
        });
        results.push({ id: job.id, status: "succeeded" });
      } catch (error) {
        if (error instanceof StaleJobClaimError) {
          // Another attempt owns the job now. Its output and effects are
          // discarded; this worker reports a stale attempt, not a success.
          results.push({ id: job.id, status: "stale", error: error.message });
          continue;
        }
        try {
          const failed = await failBackgroundJob(job, error);
          if (failed.deadLetter && job.jobType === 'intelligence_generation') await pool.query(
            "update intelligence_artifacts set status='failed',failure_reason='generation_failed',updated_at=now() where id=$1 and revision=$2 and status='running'",
            [job.payload.artifactId, job.payload.revision]);
          results.push({
            id: job.id,
            status: failed.deadLetter ? "dead_letter" : "retry_scheduled",
            error: failed.error,
          });
        } catch (failureError) {
          results.push({
            id: job.id,
            status: "stale",
            error: failureError instanceof Error ? failureError.message : String(failureError),
          });
        }
        if (error instanceof StageDeadlineError && Date.now() - startedAt >= deadlineMs) {
          deadlineExceeded = true;
          break;
        }
      }
    }
    if (deadlineExceeded) break;
  }
  return { workerId, claimed, results, deadlineExceeded, elapsedMs: Date.now() - startedAt };
}
