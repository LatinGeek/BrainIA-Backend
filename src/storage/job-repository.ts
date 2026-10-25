import { randomUUID } from "node:crypto";
import { pool, withTransaction } from "./postgres.js";

type Queryable = Pick<typeof pool, "query">;
export type JobEffect = (db: Queryable) => Promise<void>;

export const BACKGROUND_JOB_TYPES = [
  "classification", "semantic_enrichment", "embedding", "financial_correlation",
  "event_reprocess",
  "insight_detection", "semantic_reconciliation", "retention", "backup_verification", "intelligence_generation",
] as const;
export type BackgroundJobType = typeof BACKGROUND_JOB_TYPES[number];
export type BackgroundJobStatus = "queued" | "running" | "retry_scheduled" | "succeeded" | "dead_letter" | "cancelled";

export const DEFAULT_JOB_LEASE_MS = 90_000;
export const DEFAULT_JOB_HEARTBEAT_MS = 20_000;

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
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  leaseId: string | null;
  fenceToken: number;
  leaseExpiresAt: string | null;
  heartbeatAt: string | null;
  deadLetteredAt: string | null;
  lastAttemptFinishedAt: string | null;
  replayGeneration: number;
};

/** A job returned by a successful claim. Fence and lease are guaranteed. */
export type BackgroundJobClaim = BackgroundJob & {
  leaseId: string;
  fenceToken: number;
  leaseExpiresAt: string;
  lockedBy: string;
};

export type FencedJob = Pick<BackgroundJob, "id" | "attemptCount" | "maxAttempts" | "fenceToken"> &
  Partial<Pick<BackgroundJob, "lockedBy" | "leaseId">>;

export class StaleJobClaimError extends Error {
  readonly code = "stale_job_claim";
  constructor(readonly jobId: string, readonly fenceToken: number, operation: string) {
    super(`Job ${jobId} fence ${fenceToken} is no longer current during ${operation}`);
    this.name = "StaleJobClaimError";
  }
}

export type JobFence = Pick<BackgroundJob, "id" | "fenceToken"> &
  Partial<Pick<BackgroundJob, "lockedBy" | "leaseId">>;

/**
 * Fence a main-work projection inside the transaction that writes it. This is
 * deliberately checked after the caller has already opened its transaction and
 * acquired any business-row lock: a stale attempt that lost its fence can no
 * longer commit classification/financial main work before completion. The
 * `for share` row lock makes the fence atomic with the projection: a claim that
 * has not advanced the fence yet waits for this transaction instead of racing
 * it, and a claim that already advanced it makes this check fail.
 */
export async function assertJobFence(db: Queryable, job: JobFence, operation = "projection") {
  const result = await db.query(`
    select 1 from background_jobs
    where id = $1 and fence_token = $2 and status = 'running'
      and ($3::text is null or locked_by = $3)
      and lease_expires_at is not null and lease_expires_at > now()
    for share
  `, [job.id, job.fenceToken, job.lockedBy ?? null]);
  if (!result.rows[0]) throw new StaleJobClaimError(job.id, job.fenceToken, operation);
}

/**
 * Claimability predicate shared by every claim statement and by the guarded
 * outer UPDATE. Both inline and poller claims must use it in the UPDATE itself,
 * not only in the snapshot CTE: a row that another connection claimed after the
 * snapshot was taken is then rejected by the re-check (EvalPlanQual) instead of
 * being re-claimed while its lease is still live.
 */
export const CLAIMABLE_JOB_SQL = `(
  (job.status in ('queued','retry_scheduled') and job.run_after <= now())
  or (job.status = 'running' and (job.lease_expires_at is null or job.lease_expires_at <= now()))
)`;

/**
 * Attempt numbers are monotonic. A row revived by pre-r2 code can still have
 * `attempt_count = 0` while attempt 1 history exists; incrementing blindly would
 * insert a duplicate `(job_id, attempt)` and fail the claim with 23505. Clamp to
 * the highest historical attempt before incrementing so the next claim appends
 * a genuinely new attempt. This is a lazy repair, not a destructive backfill.
 */
export const NEXT_ATTEMPT_COUNT_SQL = `greatest(
  job.attempt_count,
  coalesce((select max(history.attempt) from background_job_attempts history where history.job_id = job.id), 0)
) + 1`;


function jobProjection(alias?: string) {
  const prefix = alias ? `${alias}.` : "";
  return `
    ${prefix}id, ${prefix}client_id as "clientId", ${prefix}event_id as "eventId", ${prefix}job_type as "jobType",
    ${prefix}payload, ${prefix}status, ${prefix}idempotency_key as "idempotencyKey",
    ${prefix}attempt_count as "attemptCount", ${prefix}max_attempts as "maxAttempts",
    ${prefix}run_after as "runAfter", ${prefix}locked_at as "lockedAt", ${prefix}locked_by as "lockedBy",
    ${prefix}last_error as "lastError", ${prefix}cursor_value as "cursorValue", ${prefix}provider,
    ${prefix}priority, ${prefix}owner_id as "ownerId", ${prefix}created_at as "createdAt",
    ${prefix}updated_at as "updatedAt", ${prefix}completed_at as "completedAt",
    ${prefix}lease_id as "leaseId", ${prefix}fence_token::int as "fenceToken",
    ${prefix}lease_expires_at as "leaseExpiresAt", ${prefix}heartbeat_at as "heartbeatAt",
    ${prefix}dead_lettered_at as "deadLetteredAt",
    ${prefix}last_attempt_finished_at as "lastAttemptFinishedAt",
    ${prefix}replay_generation as "replayGeneration"
  `;
}

export function retryDelayMs(attempt: number, baseMs = 2_000, maxMs = 30 * 60_000) {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

/**
 * Exponential backoff with equal jitter. A bounded Retry-After can only push
 * the delay out, never beyond the maximum. Tests can pass a deterministic
 * `random` source; production uses Math.random.
 */
export function retryDelayWithJitterMs(
  attempt: number,
  options: { baseMs?: number; maxMs?: number; retryAfterMs?: number | null; random?: () => number } = {},
) {
  const maxMs = options.maxMs ?? 30 * 60_000;
  const cap = retryDelayMs(attempt, options.baseMs, maxMs);
  const random = options.random ?? Math.random;
  const jittered = Math.round(cap / 2 + random() * (cap / 2));
  const retryAfter = Math.max(0, Math.min(maxMs, Math.trunc(options.retryAfterMs ?? 0)));
  return Math.min(maxMs, Math.max(jittered, retryAfter));
}

function boundedRetryAfterMs(error: unknown, maxMs = 30 * 60_000) {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  const direct = record.retryAfterMs;
  if (typeof direct === "number" && Number.isFinite(direct)) return Math.max(0, Math.min(maxMs, Math.trunc(direct)));
  const header = (record.headers as Record<string, unknown> | undefined)?.["retry-after"];
  const value = header ?? record.retryAfter;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(maxMs, Math.trunc(value > 1_000 ? value : value * 1_000)));
  }
  if (typeof value === "string" && value.trim()) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, Math.min(maxMs, Math.trunc(seconds * 1_000)));
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, Math.min(maxMs, date - Date.now()));
  }
  return null;
}

function leaseSeconds(leaseMs: number | undefined) {
  return Math.ceil(Math.min(10 * 60_000, Math.max(1_000, leaseMs ?? DEFAULT_JOB_LEASE_MS)) / 1_000);
}

function boundedCapacity(value: number | undefined, fallback: number) {
  return Math.min(25, Math.max(0, Math.trunc(value ?? fallback)));
}

async function recordClaim(db: Queryable, rows: BackgroundJobClaim[]) {
  if (!rows.length) return;
  const ids = rows.map((row) => row.id);
  // At claim time any still-open lease row for these jobs belongs to the
  // previous attempt: either its lease expired or the job was replayed. Release
  // it before inserting the new lease so the history can never have two open
  // leases for one job.
  await db.query(`
    update background_job_leases set released_at = now(),
      release_reason = case when expires_at <= now() then 'expired' else 'abandoned' end
    where released_at is null and job_id = any($1::text[])
  `, [ids]);
  await db.query(`
    update background_job_attempts set status = 'abandoned', completed_at = now()
    where job_id = any($1::text[]) and status = 'running'
  `, [ids]);
  for (const job of rows) {
    // Attempt numbers are monotonic and never reused: attempt_count is preserved
    // across revives/replays, so this insert must be a new row. No upsert here —
    // silently overwriting a historical attempt (the reviveFailed regression)
    // is worse than failing the claim loudly.
    await db.query(`
      insert into background_job_attempts (
        id, job_id, attempt, status, worker_id, lease_id, fence_token, replay_generation, heartbeat_at
      ) values ($1,$2,$3,'running',$4,$5,$6,$7,now())
    `, [randomUUID(), job.id, job.attemptCount, job.lockedBy, job.leaseId, job.fenceToken, job.replayGeneration]);
    await db.query(`
      insert into background_job_leases (
        id, job_id, worker_id, fence_token, attempt, replay_generation, expires_at, heartbeat_at
      ) values ($1,$2,$3,$4,$5,$6,$7,now())
      on conflict (job_id, fence_token) do update set worker_id = excluded.worker_id,
        attempt = excluded.attempt, replay_generation = excluded.replay_generation,
        acquired_at = now(), expires_at = excluded.expires_at, heartbeat_at = now(),
        released_at = null, release_reason = null
    `, [job.leaseId, job.id, job.lockedBy, job.fenceToken, job.attemptCount, job.replayGeneration, job.leaseExpiresAt]);
  }
}

export async function enqueueBackgroundJob(db: Queryable, input: {
  clientId?: string | null;
  ownerId?: string | null;
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
      id, client_id, owner_id, event_id, job_type, payload, idempotency_key,
      max_attempts, run_after, provider, priority
    ) values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11)
    on conflict (job_type, idempotency_key) do update set
      payload = excluded.payload,
      owner_id = coalesce(excluded.owner_id, background_jobs.owner_id),
      status = case when $12::boolean and background_jobs.status in ('dead_letter','cancelled') then 'queued' else background_jobs.status end,
      -- A revive must never rewind attempt history: the next claim appends
      -- attempt_count + 1 and must not collide with an existing attempt row.
      -- It only extends the budget so the preserved attempt count can still run.
      attempt_count = background_jobs.attempt_count,
      max_attempts = case when $12::boolean and background_jobs.status in ('dead_letter','cancelled')
        then greatest(background_jobs.max_attempts, background_jobs.attempt_count + 1)
        else background_jobs.max_attempts end,
      run_after = case when $12::boolean and background_jobs.status in ('dead_letter','cancelled') then excluded.run_after else background_jobs.run_after end,
      last_error = case when $12::boolean and background_jobs.status in ('dead_letter','cancelled') then null else background_jobs.last_error end,
      -- A revived row keeps its historical fence but must not keep a lease that
      -- belonged to the dead lettered attempt.
      lease_id = case when $12::boolean and background_jobs.status in ('dead_letter','cancelled') then null else background_jobs.lease_id end,
      lease_expires_at = case when $12::boolean and background_jobs.status in ('dead_letter','cancelled') then null else background_jobs.lease_expires_at end,
      heartbeat_at = case when $12::boolean and background_jobs.status in ('dead_letter','cancelled') then null else background_jobs.heartbeat_at end,
      dead_lettered_at = case when $12::boolean and background_jobs.status in ('dead_letter','cancelled') then null else background_jobs.dead_lettered_at end,
      completed_at = case when $12::boolean and background_jobs.status in ('dead_letter','cancelled') then null else background_jobs.completed_at end,
      updated_at = now()
    returning ${jobProjection()}
  `, [
    `job_${randomUUID()}`, input.clientId ?? null, input.ownerId ?? null,
    input.eventId ?? null, input.jobType, JSON.stringify(input.payload ?? {}),
    input.idempotencyKey, input.maxAttempts ?? 5,
    input.runAfter ?? new Date().toISOString(), input.provider ?? null,
    input.priority ?? 100, input.reviveFailed ?? false,
  ]);
  return result.rows[0]!;
}

/**
 * Active reprocess executions for one event. A running row is included even
 * when its lease expired: it is claimable again, and allowing a second queued
 * execution would race the reclaim for the same event.
 */
export async function listActiveEventReprocessJobs(db: Queryable, eventId: string, clientId?: string | null) {
  const result = await db.query<BackgroundJob>(`
    select ${jobProjection()} from background_jobs
    where event_id = $1 and job_type = 'event_reprocess'
      and status in ('queued','running','retry_scheduled')
      and ($2::text is null or client_id is not distinct from $2)
    order by created_at desc
  `, [eventId, clientId ?? null]);
  return result.rows;
}

export async function findEventReprocessJobByKey(db: Queryable, idempotencyKey: string) {
  const result = await db.query<BackgroundJob>(`
    select ${jobProjection()} from background_jobs
    where job_type = 'event_reprocess' and idempotency_key = $1
    limit 1
  `, [idempotencyKey]);
  return result.rows[0] ?? null;
}

export type EventBackgroundJobSummary = {
  id: string;
  jobType: BackgroundJobType;
  status: BackgroundJobStatus;
  attemptCount: number;
  maxAttempts: number;
  runAfter: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  idempotencyKey: string;
  stages: string[] | null;
};

/** Owner-queryable job list used by GET /events/:id/jobs. */
export async function listEventBackgroundJobs(
  db: Queryable,
  eventId: string,
  limit = 50,
): Promise<EventBackgroundJobSummary[]> {
  const result = await db.query<BackgroundJob>(`
    select ${jobProjection()} from background_jobs
    where event_id = $1
    order by created_at desc
    limit $2
  `, [eventId, Math.min(100, Math.max(1, Math.trunc(limit)))]);
  return result.rows.map((job) => {
    const stages = Array.isArray(job.payload?.stages)
      ? job.payload.stages.filter((stage): stage is string => typeof stage === "string")
      : null;
    return {
      id: job.id,
      jobType: job.jobType,
      status: job.status,
      attemptCount: job.attemptCount,
      maxAttempts: job.maxAttempts,
      runAfter: job.runAfter,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
      idempotencyKey: job.idempotencyKey,
      stages,
    };
  });
}

/**
 * Atomically claim ready or lease-expired jobs, bounded by global and per-owner
 * execution capacity. The claim is one statement inside one transaction; the
 * fence increment is the authority that invalidates older attempts.
 */
export async function claimBackgroundJobs(input: {
  workerId: string;
  limit?: number;
  leaseMs?: number;
  globalCapacity?: number;
  perOwnerCapacity?: number;
  jobTypes?: readonly BackgroundJobType[];
}) {
  const requested = Math.min(25, Math.max(1, Math.trunc(input.limit ?? 10)));
  const globalCapacity = boundedCapacity(input.globalCapacity, 1);
  const perOwnerCapacity = boundedCapacity(input.perOwnerCapacity, 1);
  const jobTypes = input.jobTypes?.length ? [...input.jobTypes] : null;
  return withTransaction(async (db) => {
    // Serialize the short capacity calculation/claim statement across workers.
    // Row locks already prevent double-claiming one job; this transaction-scoped
    // advisory lock also prevents two workers from both observing a free global
    // slot and exceeding capacity. It is released automatically at commit.
    await db.query("select pg_advisory_xact_lock(hashtextextended('brainia:job-claim', 0))");
    const result = await db.query<BackgroundJob>(`
      with active as (
        select coalesce(job.owner_id, job.client_id, '<global>') as scope_key,
          count(*)::int as active_count
        from background_jobs job
        where job.status = 'running'
          and job.lease_expires_at is not null and job.lease_expires_at > now()
          and ($6::text[] is null or job.job_type = any($6::text[]))
        group by 1
      ),
      candidates as (
        select job.id,
          coalesce(job.owner_id, job.client_id, '<global>') as scope_key,
          job.priority, job.run_after, job.created_at,
          row_number() over (
            partition by coalesce(job.owner_id, job.client_id, '<global>')
            order by job.priority asc, job.run_after asc, job.created_at asc, job.id asc
          ) as scope_rank
        from background_jobs job
        where ${CLAIMABLE_JOB_SQL}
          and ($6::text[] is null or job.job_type = any($6::text[]))
      ),
      ranked as (
        select candidate.id, candidate.scope_key,
          row_number() over (order by candidate.priority asc, candidate.run_after asc,
            candidate.created_at asc, candidate.id asc) as global_rank
        from candidates candidate
        left join active on active.scope_key = candidate.scope_key
        where candidate.scope_rank + coalesce(active.active_count, 0) <= $5::int
      ),
      slots as (
        select greatest(0, least($2::int, $4::int) - coalesce((select sum(active_count) from active), 0))::int as slots
      ),
      selected as (
        select ranked.id from ranked cross join slots
        where ranked.global_rank <= slots.slots
        order by ranked.global_rank
      ),
      expired as (
        update background_job_leases lease set released_at = now(), release_reason = 'expired'
        where lease.released_at is null and lease.expires_at <= now()
          and lease.job_id in (select id from selected)
        returning lease.job_id
      )
      update background_jobs job set status = 'running', locked_at = now(),
        locked_by = $1, attempt_count = ${NEXT_ATTEMPT_COUNT_SQL},
        lease_id = 'lease_' || substr(md5(random()::text || clock_timestamp()::text || job.id || $1), 1, 32),
        fence_token = job.fence_token + 1,
        lease_expires_at = now() + ($3::int * interval '1 second'),
        heartbeat_at = now(), completed_at = null, updated_at = now()
      from selected
      where job.id = selected.id
        -- Re-check the live row, not just the selected id: a concurrent claim
        -- may have committed after the candidate snapshot was taken.
        and ${CLAIMABLE_JOB_SQL}
      returning ${jobProjection("job")}
    `, [input.workerId, requested, leaseSeconds(input.leaseMs), globalCapacity, perOwnerCapacity, jobTypes]);
    const rows = result.rows as BackgroundJobClaim[];
    await recordClaim(db, rows);
    return rows;
  });
}

/**
 * Claim one specific job by id or (job_type,idempotency_key). Used by inline
 * request-path work. It uses the same fence/lease rules as the cron claim but
 * ignores worker capacity because request-path work is not a poller.
 */
export async function claimBackgroundJob(input: {
  id?: string;
  jobType?: BackgroundJobType;
  idempotencyKey?: string;
  workerId: string;
  leaseMs?: number;
}) {
  if (!input.id && !(input.jobType && input.idempotencyKey)) {
    throw new Error("claimBackgroundJob requires an id or a jobType/idempotencyKey pair");
  }
  return withTransaction(async (db) => {
    // Same transaction-scoped lock as the poller. The row lock alone is not
    // enough when two statements snapshot the same queued row; serializing the
    // claim makes the inline/poller decision single-writer.
    await db.query("select pg_advisory_xact_lock(hashtextextended('brainia:job-claim', 0))");
    const result = await db.query<BackgroundJob>(`
      with target as (
        select job.id from background_jobs job
        where ($1::text is null or job.id = $1)
          and ($2::text is null or job.job_type = $2)
          and ($3::text is null or job.idempotency_key = $3)
          and ${CLAIMABLE_JOB_SQL}
        order by job.priority asc, job.run_after asc, job.created_at asc, job.id asc
        for update skip locked
        limit 1
      ),
      expired as (
        update background_job_leases lease set released_at = now(), release_reason = 'expired'
        where lease.released_at is null and lease.expires_at <= now()
          and lease.job_id in (select id from target)
        returning lease.job_id
      )
      update background_jobs job set status = 'running', locked_at = now(),
        locked_by = $4, attempt_count = ${NEXT_ATTEMPT_COUNT_SQL},
        lease_id = 'lease_' || substr(md5(random()::text || clock_timestamp()::text || job.id || $4), 1, 32),
        fence_token = job.fence_token + 1,
        lease_expires_at = now() + ($5::int * interval '1 second'),
        heartbeat_at = now(), completed_at = null, updated_at = now()
      from target
      where job.id = target.id
        and ${CLAIMABLE_JOB_SQL}
      returning ${jobProjection("job")}
    `, [
      input.id ?? null, input.jobType ?? null, input.idempotencyKey ?? null,
      input.workerId, leaseSeconds(input.leaseMs),
    ]);
    const rows = result.rows as BackgroundJobClaim[];
    await recordClaim(db, rows);
    return rows[0] ?? null;
  });
}

/** Extend a live lease only when the caller still owns the current fence. */
export async function heartbeatBackgroundJob(job: FencedJob, input: { leaseMs?: number } = {}) {
  const seconds = leaseSeconds(input.leaseMs);
  return withTransaction(async (db) => {
    const result = await db.query<{ leaseId: string | null; attemptCount: number; replayGeneration: number }>(`
      update background_jobs job set heartbeat_at = now(),
        lease_expires_at = now() + ($4::int * interval '1 second'), updated_at = now()
      where job.id = $1 and job.status = 'running' and job.fence_token = $2
        and ($3::text is null or job.locked_by = $3)
        and job.lease_expires_at is not null and job.lease_expires_at > now()
      returning job.lease_id as "leaseId", job.attempt_count as "attemptCount",
        job.replay_generation as "replayGeneration"
    `, [job.id, job.fenceToken, job.lockedBy ?? null, seconds]);
    const row = result.rows[0];
    if (!row) return null;
    await db.query(`
      update background_job_attempts set heartbeat_at = now()
      where job_id = $1 and attempt = $2 and fence_token = $3 and status = 'running'
    `, [job.id, row.attemptCount, job.fenceToken]);
    if (row.leaseId) {
      await db.query(`
        update background_job_leases set heartbeat_at = now(),
          expires_at = now() + ($3::int * interval '1 second')
        where id = $1 and fence_token = $2 and released_at is null
      `, [row.leaseId, job.fenceToken, seconds]);
    }
    return true;
  });
}

/**
 * Complete a fenced attempt. Effect publication runs inside the same
 * transaction as the status update and downstream enqueue. If the fence moved,
 * the update returns zero rows and the effect callback never runs.
 */
export async function completeBackgroundJob(job: FencedJob, effect?: JobEffect) {
  return withTransaction(async (db) => {
    const result = await db.query<BackgroundJob>(`
      update background_jobs job set status = 'succeeded', locked_at = null,
        locked_by = null, lease_id = null, lease_expires_at = null,
        heartbeat_at = now(), last_error = null, completed_at = now(),
        last_attempt_finished_at = now(), updated_at = now()
      where job.id = $1 and job.fence_token = $2 and job.status = 'running'
        and ($3::text is null or job.locked_by = $3)
        and job.lease_expires_at is not null and job.lease_expires_at > now()
      returning ${jobProjection("job")}
    `, [job.id, job.fenceToken, job.lockedBy ?? null]);
    const completed = result.rows[0];
    if (!completed) throw new StaleJobClaimError(job.id, job.fenceToken, "complete");
    if (effect) await effect(db);
    await db.query(`
      update background_job_attempts set status = 'succeeded', completed_at = now(),
        heartbeat_at = now()
      where job_id = $1 and attempt = $2 and fence_token = $3 and status = 'running'
    `, [job.id, job.attemptCount, job.fenceToken]);
    await db.query(`
      update background_job_leases set released_at = now(), release_reason = 'completed'
      where job_id = $1 and fence_token = $2 and released_at is null
    `, [job.id, job.fenceToken]);
    return completed;
  });
}

/**
 * Fail a fenced attempt. Dead letters terminate the job; other failures schedule
 * a jittered retry. A stale fence updates zero rows and publishes nothing.
 */
export async function failBackgroundJob(job: FencedJob, error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 4000);
  // A caller (for example a missing reprocessing prerequisite discovered only
  // at execution time) can mark the error permanent. Repeating the identical
  // attempt cannot repair it, so dead-letter immediately instead of retrying.
  const permanent = Boolean(error && typeof error === "object" && (error as { retryable?: unknown }).retryable === false);
  const deadLetter = permanent || job.attemptCount >= job.maxAttempts;
  const retryAfterMs = boundedRetryAfterMs(error);
  const runAfter = new Date(Date.now() + retryDelayWithJitterMs(job.attemptCount, { retryAfterMs })).toISOString();
  return withTransaction(async (db) => {
    const result = await db.query<BackgroundJob>(`
      update background_jobs job set status = $4, run_after = $5, locked_at = null,
        locked_by = null, lease_id = null, lease_expires_at = null,
        heartbeat_at = now(), last_error = $6,
        dead_lettered_at = case when $4 = 'dead_letter' then now() else null end,
        last_attempt_finished_at = now(),
        completed_at = case when $4 = 'dead_letter' then now() else null end,
        updated_at = now()
      where job.id = $1 and job.fence_token = $2 and job.status = 'running'
        and ($3::text is null or job.locked_by = $3)
        and job.lease_expires_at is not null and job.lease_expires_at > now()
      returning ${jobProjection("job")}
    `, [job.id, job.fenceToken, job.lockedBy ?? null,
      deadLetter ? "dead_letter" : "retry_scheduled", runAfter, message]);
    if (!result.rows[0]) throw new StaleJobClaimError(job.id, job.fenceToken, "fail");
    const attemptStatus = deadLetter ? "dead_letter" : "failed";
    await db.query(`
      update background_job_attempts set status = $4, error = $5, completed_at = now(),
        heartbeat_at = now()
      where job_id = $1 and attempt = $2 and fence_token = $3 and status = 'running'
    `, [job.id, job.attemptCount, job.fenceToken, attemptStatus, message]);
    await db.query(`
      update background_job_leases set released_at = now(), release_reason = $3
      where job_id = $1 and fence_token = $2 and released_at is null
    `, [job.id, job.fenceToken, deadLetter ? "dead_letter" : "retry_scheduled"]);
    return { deadLetter, runAfter, error: message };
  });
}

/**
 * v1 inline compatibility. It acquires the same lease/fence as a worker before
 * settling, so it can never settle another worker's live attempt.
 */
export async function settleInlineBackgroundJob(input: {
  jobType: BackgroundJobType;
  idempotencyKey: string;
  error?: unknown;
}) {
  const load = async () => {
    const result = await pool.query<BackgroundJob>(`
      select ${jobProjection()} from background_jobs where job_type = $1 and idempotency_key = $2 limit 1
    `, [input.jobType, input.idempotencyKey]);
    return result.rows[0] ?? null;
  };
  const current = await load();
  if (!current || current.status === "succeeded") return current;
  const claim = await claimBackgroundJob({
    jobType: input.jobType, idempotencyKey: input.idempotencyKey,
    workerId: `inline_${randomUUID()}`,
  });
  // Another live worker owns the attempt; do not touch it.
  if (!claim) return load();
  if (input.error !== undefined) await failBackgroundJob(claim, input.error);
  else await completeBackgroundJob(claim);
  return load();
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

/**
 * Operator replay. Historical attempts, the current fence and the attempt count
 * are preserved; replay_generation increments and the operator gets a fresh
 * max_attempts window. The next claim increments the fence again.
 */
export async function retryBackgroundJob(id: string, input: { reason?: string; requestedBy?: string } = {}) {
  return withTransaction(async (db) => {
    const current = await db.query<BackgroundJob>(`
      select ${jobProjection()} from background_jobs
      where id = $1 and status in ('dead_letter','retry_scheduled','cancelled')
      for update
    `, [id]);
    const job = current.rows[0];
    if (!job) return null;
    await db.query(`
      insert into background_job_replays (
        id, job_id, previous_replay_generation, replay_generation, previous_status,
        previous_attempt_count, previous_fence_token, previous_max_attempts, reason, requested_by
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `, [randomUUID(), job.id, job.replayGeneration, job.replayGeneration + 1, job.status,
      job.attemptCount, job.fenceToken, job.maxAttempts, input.reason ?? null, input.requestedBy ?? null]);
    const result = await db.query<BackgroundJob>(`
      update background_jobs set status = 'queued', run_after = now(),
        max_attempts = greatest(max_attempts, attempt_count + max_attempts),
        locked_at = null, locked_by = null, lease_id = null, lease_expires_at = null,
        heartbeat_at = null, last_error = null, completed_at = null, dead_lettered_at = null,
        replay_generation = replay_generation + 1, updated_at = now()
      where id = $1
      returning ${jobProjection()}
    `, [id]);
    await db.query(`
      update background_job_leases set released_at = now(), release_reason = 'replayed'
      where job_id = $1 and released_at is null
    `, [id]);
    return result.rows[0] ?? null;
  });
}

export async function listBackgroundJobReplays(id: string, limit = 20) {
  const result = await pool.query<{
    id: string; previousReplayGeneration: number; replayGeneration: number;
    previousStatus: string; previousAttemptCount: number; previousFenceToken: number;
    reason: string | null; requestedBy: string | null; createdAt: string;
  }>(`
    select id, previous_replay_generation as "previousReplayGeneration",
      replay_generation as "replayGeneration", previous_status as "previousStatus",
      previous_attempt_count as "previousAttemptCount", previous_fence_token::int as "previousFenceToken",
      reason, requested_by as "requestedBy", created_at as "createdAt"
    from background_job_replays where job_id = $1 order by created_at desc limit $2
  `, [id, Math.min(100, Math.max(1, Math.trunc(limit)))]);
  return result.rows;
}

export async function backgroundJobMetrics() {
  const result = await pool.query<{ status: BackgroundJobStatus; count: number }>(`
    select status, count(*)::int as count from background_jobs group by status
  `);
  return Object.fromEntries(result.rows.map((row) => [row.status, Number(row.count)]));
}

export async function backgroundJobLeaseMetrics() {
  const result = await pool.query<{
    running: number; activeLeases: number; expiredLeases: number; deadLetters: number; replays: number;
  }>(`
    select
      (select count(*)::int from background_jobs where status = 'running') as running,
      (select count(*)::int from background_jobs where status = 'running'
        and lease_expires_at is not null and lease_expires_at > now()) as "activeLeases",
      (select count(*)::int from background_jobs where status = 'running'
        and (lease_expires_at is null or lease_expires_at <= now())) as "expiredLeases",
      (select count(*)::int from background_jobs where status = 'dead_letter') as "deadLetters",
      (select count(*)::int from background_job_replays) as replays
  `);
  return result.rows[0]!;
}
