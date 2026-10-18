import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { pool } from '../src/storage/postgres.ts';
import {
  claimBackgroundJob, claimBackgroundJobs, completeBackgroundJob, enqueueBackgroundJob,
  failBackgroundJob, heartbeatBackgroundJob, retryBackgroundJob, settleInlineBackgroundJob,
  retryDelayWithJitterMs, StaleJobClaimError, CLAIMABLE_JOB_SQL, type BackgroundJob,
} from '../src/storage/job-repository.ts';
import { executeBackgroundJob } from '../src/storage/job-worker.ts';
import { insertRawEvent } from '../src/storage/event-repository.ts';

const jobTypes = ['retention'] as const;
const uniqueKey = (tag: string) => `${tag}:${randomUUID()}`;

async function enqueueRetention(overrides: Partial<{
  clientId: string | null; idempotencyKey: string; maxAttempts: number; priority: number; runAfter: string;
}> = {}) {
  return enqueueBackgroundJob(pool, {
    clientId: overrides.clientId ?? randomUUID(),
    jobType: 'retention',
    idempotencyKey: overrides.idempotencyKey ?? uniqueKey('retention'),
    payload: { marker: randomUUID() },
    maxAttempts: overrides.maxAttempts,
    priority: overrides.priority,
    runAfter: overrides.runAfter,
  });
}

async function loadJob(id: string) {
  const result = await pool.query<BackgroundJob>(`
    select id, status, attempt_count as "attemptCount", max_attempts as "maxAttempts",
      fence_token::int as "fenceToken", replay_generation as "replayGeneration",
      locked_by as "lockedBy", lease_id as "leaseId", lease_expires_at as "leaseExpiresAt",
      dead_lettered_at as "deadLetteredAt", last_error as "lastError", idempotency_key as "idempotencyKey"
    from background_jobs where id = $1
  `, [id]);
  return result.rows[0]!;
}

async function expireLease(id: string) {
  await pool.query(`update background_jobs set lease_expires_at = now() - interval '5 seconds' where id = $1`, [id]);
}

async function countJobsByKey(key: string) {
  const result = await pool.query<{ count: number }>(
    `select count(*)::int as count from background_jobs where idempotency_key = $1`, [key]);
  return result.rows[0]!.count;
}

async function cancelRetention(ids: string[]) {
  if (!ids.length) return;
  await pool.query(`update background_jobs set status = 'cancelled', lease_id = null,
    lease_expires_at = null, locked_at = null, locked_by = null where id = any($1::text[])
    and status in ('queued','retry_scheduled','running')`, [ids]);
}

test('B08/E07 expired lease is reclaimed within lease plus two polls and fences advance', async () => {
  const job = await enqueueRetention();
  const first = await claimBackgroundJob({ id: job.id, workerId: 'worker-a', leaseMs: 1_000 });
  assert.ok(first);
  assert.equal(first.id, job.id);
  assert.equal(first.fenceToken, 1);
  assert.ok(first.leaseExpiresAt);

  // Simulate a crash: the worker never heartbeats or completes.
  await expireLease(job.id);

  // Poll 1 after expiry must reclaim the job for a different worker.
  const second = await claimBackgroundJob({ id: job.id, workerId: 'worker-b', leaseMs: 1_000 });
  assert.ok(second, 'the first poll after lease expiry must reclaim the abandoned attempt');
  assert.equal(second.id, job.id);
  assert.equal(second.attemptCount, 2);
  assert.ok(second.fenceToken > first.fenceToken);

  // No duplicate claim while the reclaiming lease is live.
  const third = await claimBackgroundJob({ id: job.id, workerId: 'worker-c', leaseMs: 1_000 });
  assert.equal(third, null);

  const recovered = await completeBackgroundJob(second);
  assert.equal(recovered.status, 'succeeded');
  assert.equal((await loadJob(job.id)).status, 'succeeded');

  const attempts = await pool.query<{ attempt: number; status: string; fenceToken: number }>(`
    select attempt, status, fence_token::int as "fenceToken" from background_job_attempts
    where job_id = $1 order by attempt
  `, [job.id]);
  assert.deepEqual(attempts.rows.map((row) => [row.attempt, row.status]), [[1, 'abandoned'], [2, 'succeeded']]);
  assert.ok(attempts.rows[1]!.fenceToken > attempts.rows[0]!.fenceToken);

  const leases = await pool.query<{ count: number }>(`
    select count(*)::int as count from background_job_leases
    where job_id = $1 and release_reason is not null
  `, [job.id]);
  assert.equal(leases.rows[0]!.count, 2, 'expired and completed leases are retained as history');
});

test('B08/E07 stale fence cannot complete, fail, heartbeat or publish effects', async () => {
  const job = await enqueueRetention();
  const stale = await claimBackgroundJob({ id: job.id, workerId: 'worker-a', leaseMs: 1_000 });
  assert.ok(stale);
  await expireLease(job.id);
  const current = await claimBackgroundJob({ id: job.id, workerId: 'worker-b', leaseMs: 5_000 });
  assert.ok(current);
  assert.ok(current.fenceToken > stale.fenceToken);

  let effectCalls = 0;
  const effectKey = uniqueKey('stale-effect');
  await assert.rejects(
    () => completeBackgroundJob(stale, async (db) => {
      effectCalls += 1;
      await enqueueBackgroundJob(db, {
        jobType: 'retention', idempotencyKey: effectKey, payload: { marker: 'stale' },
      });
    }),
    (error: unknown) => error instanceof StaleJobClaimError,
  );
  assert.equal(effectCalls, 0, 'stale completion must not invoke the effect callback');
  assert.equal(await countJobsByKey(effectKey), 0, 'stale completion must not enqueue downstream work');

  await assert.rejects(
    () => failBackgroundJob(stale, new Error('stale worker crash')),
    (error: unknown) => error instanceof StaleJobClaimError,
  );
  assert.equal(await heartbeatBackgroundJob(stale, { leaseMs: 5_000 }), null);

  const afterStale = await loadJob(job.id);
  assert.equal(afterStale.status, 'running');
  assert.equal(afterStale.lockedBy, 'worker-b');
  assert.notEqual(afterStale.fenceToken, stale.fenceToken);

  await completeBackgroundJob(current);
  assert.equal((await loadJob(job.id)).status, 'succeeded');
});

test('B08/E07 classification retry does not duplicate finance side effects', async () => {
  const clientId = randomUUID();
  const event = {
    id: randomUUID(), source: 'capture.wallet', contractVersion: 1, kind: 'expense' as const,
    title: `Retry Shop ${randomUUID()}`, body: 'Compra en Retry Shop por UYU 321',
    timestamp: '2026-10-16T10:00:00Z',
    raw: { amount: 321, currency: 'UYU', merchant: 'Retry Shop', transactionType: 'expense' }, tags: [],
  };
  await insertRawEvent(pool, event, clientId, `${clientId}:${event.id}`);
  const job = await enqueueBackgroundJob(pool, {
    clientId, eventId: event.id, jobType: 'classification',
    idempotencyKey: `classification:${event.id}:v1`, payload: { eventId: event.id }, priority: 10,
  });

  const crashed = await claimBackgroundJob({ id: job.id, workerId: 'worker-a', leaseMs: 1_000 });
  assert.ok(crashed);
  const firstExecution = await executeBackgroundJob(crashed);
  assert.ok(firstExecution.effects.length > 0);
  // Crash after the projection commit but before completion/effect publication.
  await expireLease(job.id);

  const retried = await claimBackgroundJob({ id: job.id, workerId: 'worker-b', leaseMs: 5_000 });
  assert.ok(retried);
  const secondExecution = await executeBackgroundJob(retried);
  await completeBackgroundJob(retried, async (db) => {
    for (const effect of secondExecution.effects) await effect(db);
  });

  const finance = await pool.query<{ count: number; transactionId: string }>(`
    select count(distinct t.id)::int as count, min(t.id) as "transactionId"
    from financial_transactions t
    join financial_transaction_events e on e.transaction_id = t.id
    where e.raw_event_id = $1
  `, [event.id]);
  assert.equal(finance.rows[0]!.count, 1, 'a retried classification must reference one canonical financial transaction');

  const evidence = await pool.query<{ count: number }>(`
    select count(*)::int as count from financial_transaction_events where raw_event_id = $1
  `, [event.id]);
  assert.equal(evidence.rows[0]!.count, 1);

  const semantic = await pool.query<{ count: number }>(`
    select count(*)::int as count from background_jobs where event_id = $1 and job_type = 'semantic_enrichment'
  `, [event.id]);
  assert.equal(semantic.rows[0]!.count, 1, 'completion publishes the downstream stage exactly once');
});

test('B08/E07 claim capacity bounds global and per-owner concurrency (no serial overclaim)', async () => {
  const owners = [randomUUID(), randomUUID()];
  const created: string[] = [];
  for (const owner of owners) {
    for (let index = 0; index < 5; index += 1) {
      const job = await enqueueRetention({ clientId: owner, priority: index });
      created.push(job.id);
    }
  }

  const claimed = await claimBackgroundJobs({
    workerId: 'capacity-worker', limit: 25, jobTypes, globalCapacity: 4, perOwnerCapacity: 1, leaseMs: 5_000,
  });
  assert.equal(claimed.length, 2, 'one executable job per owner even when the batch asks for 25');
  assert.equal(new Set(claimed.map((job) => job.clientId)).size, 2);
  assert.equal(new Set(claimed.map((job) => job.id)).size, 2);

  const active = await pool.query<{ count: number }>(`
    select count(*)::int as count from background_jobs
    where job_type = 'retention' and status = 'running' and lease_expires_at > now()
  `);
  assert.ok(active.rows[0]!.count <= 4);

  // Parallel pollers while both owners are at capacity: zero additional claims.
  const whileBusy = await Promise.all([1, 2, 3].map((worker) => claimBackgroundJobs({
    workerId: `parallel-busy-${worker}`, limit: 10, jobTypes, globalCapacity: 4, perOwnerCapacity: 1, leaseMs: 5_000,
  })));
  assert.equal(whileBusy.flat().length, 0);

  for (const job of claimed) await completeBackgroundJob(job);

  // Parallel polls across multiple workers must still honor per-owner capacity.
  const parallel = await Promise.all([1, 2, 3, 4].map((worker) => claimBackgroundJobs({
    workerId: `parallel-${worker}`, limit: 10, jobTypes, globalCapacity: 4, perOwnerCapacity: 1, leaseMs: 5_000,
  })));
  const parallelClaims = parallel.flat();
  assert.ok(parallelClaims.length <= 2, 'parallel workers cannot overclaim beyond one job per owner');
  assert.equal(new Set(parallelClaims.map((job) => job.id)).size, parallelClaims.length);
  for (const job of parallelClaims) await completeBackgroundJob(job);

  const overflow = await claimBackgroundJobs({
    workerId: 'capacity-worker-2', limit: 25, jobTypes, globalCapacity: 1, perOwnerCapacity: 4, leaseMs: 5_000,
  });
  assert.equal(overflow.length, 1, 'global capacity wins over a larger per-owner allowance');
  for (const job of overflow) await completeBackgroundJob(job);

  await cancelRetention(created);
});

test('B08/E07 replay preserves attempts and fence history, dead letters, and jittered backoff', async () => {
  const job = await enqueueRetention({ maxAttempts: 1 });
  const first = await claimBackgroundJob({ id: job.id, workerId: 'worker-a', leaseMs: 5_000 });
  assert.ok(first);
  const failed = await failBackgroundJob(first, new Error('deterministic failure'));
  assert.equal(failed.deadLetter, true);
  const dead = await loadJob(job.id);
  assert.equal(dead.status, 'dead_letter');
  assert.ok(dead.deadLetteredAt);

  const replayed = await retryBackgroundJob(job.id, { reason: 'test replay', requestedBy: 'test-operator' });
  assert.ok(replayed);
  assert.equal(replayed.status, 'queued');
  assert.equal(replayed.attemptCount, dead.attemptCount, 'replay preserves the historical attempt count');
  assert.equal(replayed.replayGeneration, dead.replayGeneration + 1);
  assert.equal(replayed.fenceToken, dead.fenceToken, 'replay never resets the historical fence');
  assert.ok(replayed.maxAttempts > dead.maxAttempts);

  const replayRows = await pool.query<{ previousFenceToken: number; reason: string }>(`
    select previous_fence_token::int as "previousFenceToken", reason
    from background_job_replays where job_id = $1
  `, [job.id]);
  assert.equal(replayRows.rows.length, 1);
  assert.equal(replayRows.rows[0]!.previousFenceToken, dead.fenceToken);

  const second = await claimBackgroundJob({ id: job.id, workerId: 'worker-b', leaseMs: 5_000 });
  assert.ok(second);
  assert.ok(second.fenceToken > dead.fenceToken);
  await completeBackgroundJob(second);

  const history = await pool.query<{ status: string }>(`
    select status from background_job_attempts where job_id = $1 order by attempt
  `, [job.id]);
  assert.deepEqual(history.rows.map((row) => row.status), ['dead_letter', 'succeeded']);

  assert.equal(retryDelayWithJitterMs(1, { random: () => 0 }), 1_000);
  assert.equal(retryDelayWithJitterMs(1, { random: () => 1 }), 2_000);
  assert.equal(retryDelayWithJitterMs(100, { random: () => 1 }), 30 * 60_000);
  assert.equal(retryDelayWithJitterMs(2, { random: () => 0, retryAfterMs: 3_600_000 }), 30 * 60_000);
});

test('B08/E07 effect publication and completion commit in one transaction', async () => {
  const job = await enqueueRetention();
  const claim = await claimBackgroundJob({ id: job.id, workerId: 'atomic-worker', leaseMs: 5_000 });
  assert.ok(claim);
  const effectKey = uniqueKey('rollback-effect');

  await assert.rejects(
    () => completeBackgroundJob(claim, async (db) => {
      await enqueueBackgroundJob(db, {
        jobType: 'retention', idempotencyKey: effectKey, payload: { marker: 'must-roll-back' },
      });
      throw new Error('effect publication failed');
    }),
    /effect publication failed/,
  );

  const afterFailure = await loadJob(job.id);
  assert.equal(afterFailure.status, 'running', 'a failed effect must roll back the completion status');
  assert.equal(afterFailure.leaseId, claim.leaseId);
  assert.equal(await countJobsByKey(effectKey), 0, 'the downstream enqueue is rolled back with completion');

  await completeBackgroundJob(claim);
  assert.equal((await loadJob(job.id)).status, 'succeeded');
});

test('B08/E07 inline settlement cannot settle another worker live attempt', async () => {
  const job = await enqueueRetention();
  const claimed = await claimBackgroundJob({ id: job.id, workerId: 'cron-worker', leaseMs: 5_000 });
  assert.ok(claimed);

  const settled = await settleInlineBackgroundJob({
    jobType: 'retention', idempotencyKey: job.idempotencyKey,
  });
  assert.ok(settled);
  assert.equal(settled.status, 'running');
  assert.equal(settled.lockedBy, 'cron-worker');
  assert.equal(settled.fenceToken, claimed.fenceToken);

  assert.equal(await heartbeatBackgroundJob(claimed, { leaseMs: 5_000 }), true);
  await completeBackgroundJob(claimed);
  assert.equal((await loadJob(job.id)).status, 'succeeded');
});

async function snapshotClaimableIds(ids: string[]) {
  // The poller's candidate snapshot, evaluated before any claim happens.
  const result = await pool.query<{ id: string }>(`
    select job.id from background_jobs job
    where job.id = any($1::text[]) and ${CLAIMABLE_JOB_SQL}
  `, [ids]);
  return result.rows.map((row) => row.id);
}

/**
 * Reproduce the poller's outer UPDATE after its candidate snapshot was taken.
 * `guarded` mirrors the production statement; `!guarded` is the pre-fix SQL
 * that re-checked only the id and is kept as the discriminating control.
 */
async function runPollerOuterUpdate(id: string, guarded: boolean) {
  const result = await pool.query<{ id: string; fenceToken: number }>(`
    update background_jobs job set status = 'running', locked_at = now(),
      locked_by = 'poller-racer', attempt_count = job.attempt_count + 1,
      lease_id = 'lease_' || substr(md5(random()::text || clock_timestamp()::text || job.id), 1, 32),
      fence_token = job.fence_token + 1,
      lease_expires_at = now() + interval '5 seconds',
      heartbeat_at = now(), completed_at = null, updated_at = now()
    from (select $1::text as id) selected
    where job.id = selected.id
      ${guarded ? `and ${CLAIMABLE_JOB_SQL}` : ''}
    returning job.id, job.fence_token::int as "fenceToken"
  `, [id]);
  return result;
}

test('B08/E07 poller re-checks the live row and cannot re-claim an inline live attempt', async () => {
  const job = await enqueueRetention();
  // Poller snapshot sees a claimable queued job.
  assert.deepEqual(await snapshotClaimableIds([job.id]), [job.id]);

  // The inline path wins between the poller's snapshot and its outer UPDATE.
  const inline = await claimBackgroundJob({ id: job.id, workerId: 'inline-racer', leaseMs: 60_000 });
  assert.ok(inline);
  assert.equal(inline.fenceToken, 1);

  // Guarded outer UPDATE (production SQL) re-checks status/lease, not just id.
  const guarded = await runPollerOuterUpdate(job.id, true);
  assert.equal(guarded.rowCount, 0, 'a live inline attempt must not be re-claimed by a stale poller snapshot');
  const afterGuard = await loadJob(job.id);
  assert.equal(afterGuard.status, 'running');
  assert.equal(afterGuard.lockedBy, 'inline-racer');
  assert.equal(afterGuard.fenceToken, inline.fenceToken);
  assert.equal(afterGuard.attemptCount, inline.attemptCount);

  // Control: the pre-fix id-only predicate would have re-claimed the live row.
  const controlJob = await enqueueRetention();
  assert.deepEqual(await snapshotClaimableIds([controlJob.id]), [controlJob.id]);
  const controlInline = await claimBackgroundJob({ id: controlJob.id, workerId: 'inline-control', leaseMs: 60_000 });
  assert.ok(controlInline);
  const unguarded = await runPollerOuterUpdate(controlJob.id, false);
  assert.equal(unguarded.rowCount, 1, 'without the guard the live lease is overclaimed (regression control)');
  assert.ok(unguarded.rows[0]!.fenceToken > controlInline.fenceToken);

  await completeBackgroundJob(inline);
  await cancelRetention([controlJob.id]);
});

test('B08/E07 concurrent inline and poller claims produce exactly one live attempt', async () => {
  for (let round = 0; round < 5; round += 1) {
    const job = await enqueueRetention();
    const [polled, inline] = await Promise.all([
      claimBackgroundJobs({
        workerId: `poller-${round}`, limit: 1, jobTypes, globalCapacity: 4, perOwnerCapacity: 1, leaseMs: 5_000,
      }),
      claimBackgroundJob({ id: job.id, workerId: `inline-${round}`, leaseMs: 5_000 }),
    ]);
    const winners = [...polled, ...(inline ? [inline] : [])];
    assert.equal(winners.length, 1, 'exactly one of the two claim paths may win');
    assert.equal(winners[0]!.id, job.id);

    const state = await loadJob(job.id);
    assert.equal(state.attemptCount, 1);
    assert.equal(state.fenceToken, 1);
    const attempts = await pool.query<{ count: number }>(`
      select count(*)::int as count from background_job_attempts where job_id = $1
    `, [job.id]);
    assert.equal(attempts.rows[0]!.count, 1, 'a double claim would create a second attempt/fence');

    await completeBackgroundJob(winners[0]!);
  }
});

test('B08/E07 service lease and replay ledgers are RLS default-deny with no public grants', async () => {
  const tables = ['background_job_leases', 'background_job_replays'];
  const rls = await pool.query<{ relname: string; rls: boolean }>(`
    select c.relname, c.relrowsecurity as rls from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = any($1::text[])
  `, [tables]);
  assert.deepEqual(rls.rows.map((row) => [row.relname, row.rls]), [
    ['background_job_leases', true],
    ['background_job_replays', true],
  ]);

  const policies = await pool.query<{ count: number }>(`
    select count(*)::int as count from pg_policies
    where schemaname = 'public' and tablename = any($1::text[])
  `, [tables]);
  assert.equal(policies.rows[0]!.count, 0, 'service tables are default-deny, not owner-scoped');

  const grants = await pool.query<{ relname: string; grantee: string; privilege: string }>(`
    select c.relname, coalesce(r.rolname, 'PUBLIC') as grantee, x.privilege_type as privilege
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
    left join pg_roles r on r.oid = x.grantee
    where n.nspname = 'public' and c.relname = any($1::text[]) and x.grantee <> c.relowner
  `, [tables]);
  assert.deepEqual(grants.rows, [], 'anon, authenticated, PUBLIC and brainia_runtime have no privileges');
});

test('B08/E07 reviveFailed preserves attempt/fence history instead of resetting it', async () => {
  const clientId = randomUUID();
  const idempotencyKey = uniqueKey('revive');
  const job = await enqueueBackgroundJob(pool, {
    clientId, jobType: 'retention', idempotencyKey, payload: { marker: 'revive' }, maxAttempts: 1,
  });
  const first = await claimBackgroundJob({ id: job.id, workerId: 'revive-a', leaseMs: 5_000 });
  assert.ok(first);
  const failed = await failBackgroundJob(first, new Error('deterministic dead letter'));
  assert.equal(failed.deadLetter, true);
  const dead = await loadJob(job.id);
  assert.equal(dead.status, 'dead_letter');

  const revived = await enqueueBackgroundJob(pool, {
    clientId, jobType: 'retention', idempotencyKey, payload: { marker: 'revive' },
    reviveFailed: true,
  });
  assert.equal(revived.status, 'queued');
  assert.equal(revived.attemptCount, dead.attemptCount, 'revive must not rewind attempt_count');
  assert.equal(revived.fenceToken, dead.fenceToken, 'revive must not reset the fence');
  assert.ok(revived.maxAttempts > dead.maxAttempts, 'revive grants exactly the preserved attempt a budget');

  const second = await claimBackgroundJob({ id: job.id, workerId: 'revive-b', leaseMs: 5_000 });
  assert.ok(second);
  assert.equal(second.attemptCount, dead.attemptCount + 1);
  assert.ok(second.fenceToken > dead.fenceToken);
  await completeBackgroundJob(second);

  const history = await pool.query<{ attempt: number; status: string; fenceToken: number }>(`
    select attempt, status, fence_token::int as "fenceToken" from background_job_attempts
    where job_id = $1 order by attempt
  `, [job.id]);
  assert.deepEqual(history.rows.map((row) => [row.attempt, row.status]), [[1, 'dead_letter'], [2, 'succeeded']]);
  assert.equal(history.rows[0]!.fenceToken, dead.fenceToken, 'the historical attempt row keeps its fence');
  assert.equal(history.rows[1]!.fenceToken, second.fenceToken);
});

