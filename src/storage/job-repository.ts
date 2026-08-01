import { randomUUID } from "node:crypto";
import { pool, withTransaction } from "./postgres.js";

type Queryable = Pick<typeof pool, "query">;

export const BACKGROUND_JOB_TYPES = [
  "classification", "semantic_enrichment", "embedding", "financial_correlation",
  "insight_detection", "semantic_reconciliation", "retention", "backup_verification",
] as const;
export type BackgroundJobType = typeof BACKGROUND_JOB_TYPES[number];
export type BackgroundJobStatus = "queued" | "running" | "retry_scheduled" | "succeeded" | "dead_letter" | "cancelled";

export type BackgroundJob = {
  id: string;
  clientId: string | null;
  eventId: string | null;
  jobType: BackgroundJobType;
  payload: Record<string, unknown>;
  status: BackgroundJobStatus;
  idempotencyKey: string;
  attemptCount: number;
  maxAttempts: number;
  runAfter: string;
  lockedAt: string | null;
  lockedBy: string | null;
  lastError: string | null;
  cursorValue: string | null;
  provider: string | null;
  priority: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

function jobProjection(alias?: string) {
  const prefix = alias ? `${alias}.` : "";
  return `
    ${prefix}id, ${prefix}client_id as "clientId", ${prefix}event_id as "eventId", ${prefix}job_type as "jobType",
    ${prefix}payload, ${prefix}status, ${prefix}idempotency_key as "idempotencyKey",
    ${prefix}attempt_count as "attemptCount", ${prefix}max_attempts as "maxAttempts",
    ${prefix}run_after as "runAfter", ${prefix}locked_at as "lockedAt", ${prefix}locked_by as "lockedBy",
    ${prefix}last_error as "lastError", ${prefix}cursor_value as "cursorValue", ${prefix}provider,
    ${prefix}priority, ${prefix}created_at as "createdAt", ${prefix}updated_at as "updatedAt",
    ${prefix}completed_at as "completedAt"
  `;
}

export function retryDelayMs(attempt: number, baseMs = 2_000, maxMs = 30 * 60_000) {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

export async function enqueueBackgroundJob(db: Queryable, input: {
  clientId?: string | null;
  eventId?: string | null;
  jobType: BackgroundJobType;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
  maxAttempts?: number;
  runAfter?: string;
  provider?: string | null;
  priority?: number;
  reviveFailed?: boolean;
}) {
  const result = await db.query<BackgroundJob>(`
    insert into background_jobs (
      id, client_id, event_id, job_type, payload, idempotency_key,
      max_attempts, run_after, provider, priority
    ) values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)
    on conflict (job_type, idempotency_key) do update set
      payload = excluded.payload,
      status = case when $11::boolean and background_jobs.status in ('dead_letter','cancelled') then 'queued' else background_jobs.status end,
      attempt_count = case when $11::boolean and background_jobs.status in ('dead_letter','cancelled') then 0 else background_jobs.attempt_count end,
      run_after = case when $11::boolean and background_jobs.status in ('dead_letter','cancelled') then excluded.run_after else background_jobs.run_after end,
      last_error = case when $11::boolean and background_jobs.status in ('dead_letter','cancelled') then null else background_jobs.last_error end,
      updated_at = now()
    returning ${jobProjection()}
  `, [
    `job_${randomUUID()}`, input.clientId ?? null, input.eventId ?? null,
    input.jobType, JSON.stringify(input.payload ?? {}), input.idempotencyKey,
    input.maxAttempts ?? 5, input.runAfter ?? new Date().toISOString(),
    input.provider ?? null, input.priority ?? 100, input.reviveFailed ?? false,
  ]);
  return result.rows[0]!;
}

export async function claimBackgroundJobs(input: { workerId: string; limit?: number }) {
  const limit = Math.min(25, Math.max(1, Math.trunc(input.limit ?? 10)));
  return withTransaction(async (db) => {
    const result = await db.query<BackgroundJob>(`
      with claimable as (
        select id from background_jobs
        where status in ('queued','retry_scheduled') and run_after <= now()
        order by priority asc, run_after asc, created_at asc
        for update skip locked limit $1
      )
      update background_jobs job set status = 'running', locked_at = now(),
        locked_by = $2, attempt_count = job.attempt_count + 1, updated_at = now()
      from claimable where job.id = claimable.id
      returning ${jobProjection("job")}
    `, [limit, input.workerId]);
    for (const job of result.rows) {
      await db.query(`
        insert into background_job_attempts (id, job_id, attempt, status, worker_id)
        values ($1,$2,$3,'running',$4)
        on conflict (job_id, attempt) do update set status = 'running', worker_id = excluded.worker_id,
          error = null, started_at = now(), completed_at = null
      `, [randomUUID(), job.id, job.attemptCount, input.workerId]);
    }
    return result.rows;
  });
}

export async function completeBackgroundJob(job: Pick<BackgroundJob, "id" | "attemptCount">) {
  await withTransaction(async (db) => {
    await db.query(`
      update background_jobs set status = 'succeeded', locked_at = null,
        locked_by = null, last_error = null, completed_at = now(), updated_at = now()
      where id = $1
    `, [job.id]);
    await db.query(`
      update background_job_attempts set status = 'succeeded', completed_at = now()
      where job_id = $1 and attempt = $2
    `, [job.id, job.attemptCount]);
  });
}

export async function failBackgroundJob(job: Pick<BackgroundJob, "id" | "attemptCount" | "maxAttempts">, error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 4000);
  const deadLetter = job.attemptCount >= job.maxAttempts;
  const runAfter = new Date(Date.now() + retryDelayMs(job.attemptCount)).toISOString();
  await withTransaction(async (db) => {
    await db.query(`
      update background_jobs set status = $2, run_after = $3, locked_at = null,
        locked_by = null, last_error = $4, completed_at = case when $2 = 'dead_letter' then now() else null end,
        updated_at = now() where id = $1
    `, [job.id, deadLetter ? "dead_letter" : "retry_scheduled", runAfter, message]);
    await db.query(`
      update background_job_attempts set status = $3, error = $4, completed_at = now()
      where job_id = $1 and attempt = $2
    `, [job.id, job.attemptCount, deadLetter ? "dead_letter" : "failed", message]);
  });
  return { deadLetter, runAfter, error: message };
}

export async function settleInlineBackgroundJob(input: { jobType: BackgroundJobType; idempotencyKey: string; error?: unknown }) {
  const result = await pool.query<BackgroundJob>(`
    select ${jobProjection()} from background_jobs where job_type = $1 and idempotency_key = $2 limit 1
  `, [input.jobType, input.idempotencyKey]);
  const job = result.rows[0];
  if (!job || job.status === "succeeded") return job ?? null;
  if (input.error !== undefined) {
    const syntheticAttempt = { ...job, attemptCount: Math.max(1, job.attemptCount) };
    await failBackgroundJob(syntheticAttempt, input.error);
  } else {
    await pool.query(`
      update background_jobs set status = 'succeeded', completed_at = now(),
        updated_at = now(), last_error = null where id = $1
    `, [job.id]);
  }
  return job;
}

export async function listBackgroundJobs(input: { status?: BackgroundJobStatus; limit?: number } = {}) {
  const limit = Math.min(200, Math.max(1, Math.trunc(input.limit ?? 50)));
  const result = await pool.query<BackgroundJob>(`
    select ${jobProjection()} from background_jobs
    where ($1::text is null or status = $1)
    order by case status when 'dead_letter' then 0 when 'retry_scheduled' then 1 when 'running' then 2 else 3 end,
      created_at desc limit $2
  `, [input.status ?? null, limit]);
  return result.rows;
}

export async function retryBackgroundJob(id: string) {
  const result = await pool.query<BackgroundJob>(`
    update background_jobs set status = 'queued', attempt_count = 0,
      run_after = now(), locked_at = null, locked_by = null, last_error = null,
      completed_at = null, updated_at = now()
    where id = $1 and status in ('dead_letter','retry_scheduled','cancelled')
    returning ${jobProjection()}
  `, [id]);
  return result.rows[0] ?? null;
}

export async function backgroundJobMetrics() {
  const result = await pool.query<{ status: BackgroundJobStatus; count: number }>(`
    select status, count(*)::int as count from background_jobs group by status
  `);
  return Object.fromEntries(result.rows.map((row) => [row.status, Number(row.count)]));
}
