import {
  deriveEventProgress,
  PROGRESS_JOB_TYPES,
  type EventProgress,
  type ProgressJobSnapshot,
  type ProgressJobType,
} from "../domain/event-progress.js";
import { EMBEDDING_VERSION } from "./embeddings.js";
import type { StoredEventRecord } from "./event-repository.js";
import type { pool } from "./postgres.js";

type Queryable = Pick<typeof pool, "query">;

/**
 * Reads the facts the progress projection needs and derives it. Read-only and
 * deliberately separate from loadStoredEventById, which also runs inside the
 * classification and reprocessing write transactions.
 */
export async function loadEventProgress(
  db: Queryable,
  event: StoredEventRecord,
  now: Date = new Date(),
): Promise<EventProgress> {
  const jobs = await db.query<ProgressJobSnapshot & { jobType: ProgressJobType }>(`
    select distinct on (job_type) job_type as "jobType", status, attempt_count as "attemptCount",
      max_attempts as "maxAttempts", run_after as "runAfter", lease_expires_at as "leaseExpiresAt"
    from background_jobs
    where event_id = $1 and job_type = any($2::text[])
    order by job_type, updated_at desc, created_at desc
  `, [event.id, [...PROGRESS_JOB_TYPES]]);
  const facts = await db.query<{ linked: boolean; embedded: boolean }>(`
    select
      exists(select 1 from financial_transaction_events where raw_event_id = $1) as linked,
      exists(select 1 from knowledge_embeddings
        where object_type = 'event' and object_id = $1 and embedding_version = $2) as embedded
  `, [event.id, EMBEDDING_VERSION]);

  const iso = (value: unknown) => (value == null ? null : new Date(value as string).toISOString());
  const byType: Partial<Record<ProgressJobType, ProgressJobSnapshot>> = {};
  for (const row of jobs.rows) {
    byType[row.jobType] = {
      status: row.status, attemptCount: Number(row.attemptCount), maxAttempts: Number(row.maxAttempts),
      runAfter: iso(row.runAfter), leaseExpiresAt: iso(row.leaseExpiresAt),
    };
  }

  return deriveEventProgress({
    event: {
      kind: event.kind,
      processingStatus: event.processingStatus,
      processingAllowed: event.processingAllowed,
      privacyStatus: event.privacyStatus,
    },
    classification: event.classificationVersion
      ? { inferredKind: event.inferredKind, interpretationStatus: event.interpretationStatus }
      : null,
    financialLinked: facts.rows[0]?.linked === true,
    embedded: facts.rows[0]?.embedded === true,
    jobs: byType,
  }, now);
}

export async function withEventProgress<T extends StoredEventRecord>(db: Queryable, event: T) {
  return { ...event, progress: await loadEventProgress(db, event) };
}
