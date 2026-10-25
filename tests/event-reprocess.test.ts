import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { buildApp } from '../src/app.ts';
import type { AuthConfig } from '../src/auth.ts';
import { applyCorrectionProjection } from '../src/storage/correction-projection.ts';
import { recordCorrection } from '../src/storage/correction-memory.ts';
import { REPROCESS_STAGES, ReprocessPrerequisiteError } from '../src/domain/event-reprocess.ts';
import {
  classifyCapturedEvent,
  getEvent,
  queueEventReprocess,
  reprocessEvent,
} from '../src/storage/event-store.ts';
import { insertRawEvent } from '../src/storage/event-repository.ts';
import {
  claimBackgroundJob, completeBackgroundJob, failBackgroundJob, listEventBackgroundJobs,
  StaleJobClaimError,
} from '../src/storage/job-repository.ts';
import { executeBackgroundJob } from '../src/storage/job-worker.ts';
import { pool } from '../src/storage/postgres.ts';

process.env.DEEPSEEK_API_KEY = '';
process.env.BRAINIA_LEARNING_ENABLED = 'false';

type Fixture = { eventId: string; clientId: string; authConfig: AuthConfig; headers: Record<string, string> };

async function capturedEvent(merchant = `Reprocess Shop ${randomUUID()}`): Promise<Fixture> {
  const clientId = `owner-${randomUUID()}`;
  const apiKey = `key-${randomUUID()}`;
  const event = {
    id: randomUUID(), source: 'capture.wallet', contractVersion: 1 as const, kind: 'expense' as const,
    title: merchant, body: `Compra en ${merchant} por UYU 321`,
    timestamp: '2026-10-24T10:00:00Z',
    raw: { amount: 321, currency: 'UYU', merchant, transactionType: 'expense' }, tags: [],
  };
  await insertRawEvent(pool, event, clientId, `${clientId}:${event.id}`);
  await pool.query('update raw_events set owner_id = $2 where id = $1', [event.id, clientId]);
  return {
    eventId: event.id,
    clientId,
    authConfig: { globalApiKey: null, clientKeys: new Map([[clientId, apiKey]]) },
    headers: { 'x-brainia-client-id': clientId, 'x-brainia-api-key': apiKey },
  };
}

async function claimJob(id: string, workerId: string, leaseMs = 5_000) {
  const claim = await claimBackgroundJob({ id, workerId, leaseMs });
  assert.ok(claim, `expected to claim job ${id}`);
  return claim;
}

async function eventJobCounts(eventId: string) {
  const result = await pool.query<{ job_type: string; count: number }>(`
    select job_type, count(*)::int as count from background_jobs
    where event_id = $1 group by job_type
  `, [eventId]);
  return Object.fromEntries(result.rows.map((row) => [row.job_type, row.count]));
  return Object.fromEntries(result.rows.map((row) => [row.job_type, row.count]));
}

async function classificationRow(eventId: string) {
  return (await pool.query(`select * from classified_events where raw_event_id = $1`, [eventId])).rows[0];
}

async function financeRow(eventId: string) {
  return (await pool.query(`
    select t.* from financial_transactions t
    join financial_transaction_events e on e.transaction_id = t.id
    where e.raw_event_id = $1
  `, [eventId])).rows[0];
}

test('selective reprocessing API queues identifiers, validates stages/dependencies, and coalesces repeats', async () => {
  const fixture = await capturedEvent();
  const app = await buildApp({ authConfig: fixture.authConfig });
  try {
    const semanticBeforeClassify = await app.inject({
      method: 'POST', url: `/api/v1/events/${fixture.eventId}/reprocess`,
      headers: fixture.headers, payload: { stages: ['semanticInterpretation'] },
    });
    assert.equal(semanticBeforeClassify.statusCode, 409);
    const missing = semanticBeforeClassify.json() as {
      error: string; missing: Array<{ stage: string; requires: string[] }>;
    };
    assert.equal(missing.error, 'reprocess_prerequisites_missing');
    assert.deepEqual(missing.missing, [{
      stage: 'semanticInterpretation', requires: ['classification'],
      reason: 'classification_record_missing',
    }]);

    const invalid = await app.inject({
      method: 'POST', url: `/api/v1/events/${fixture.eventId}/reprocess`,
      headers: fixture.headers, payload: { stages: ['not_a_stage'] },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal((invalid.json() as { error: string }).error, 'invalid_reprocess_selection');

    const first = await app.inject({
      method: 'POST', url: `/api/v1/events/${fixture.eventId}/reprocess`,
      headers: fixture.headers, payload: { stages: ['classification'] },
    });
    assert.equal(first.statusCode, 202);
    const accepted = first.json() as {
      accepted: boolean; disposition: string; created: boolean; requestedStages: string[];
      executionStages: string[]; job: { id: string; status: string; jobType: string };
      jobIds: string[]; links: { jobs: string };
      stages: Array<{ stage: string; jobId: string }>;
    };
    assert.equal(accepted.accepted, true);
    assert.equal(accepted.disposition, 'queued');
    assert.equal(accepted.created, true);
    assert.deepEqual(accepted.requestedStages, ['classification']);
    assert.deepEqual(accepted.executionStages, ['classification']);
    assert.equal(accepted.job.jobType, 'event_reprocess');
    assert.equal(accepted.job.status, 'queued');
    assert.deepEqual(accepted.jobIds, [accepted.job.id]);
    assert.deepEqual(accepted.stages, [{
      stage: 'classification', jobId: accepted.job.id, status: 'queued', prerequisites: [],
    }]);
    assert.equal(accepted.links.jobs, `/api/v1/events/${fixture.eventId}/jobs`);

    const repeated = await app.inject({
      method: 'POST', url: `/api/v1/events/${fixture.eventId}/reprocess`,
      headers: fixture.headers, payload: { stages: ['classification'] },
    });
    assert.equal(repeated.statusCode, 202);
    const coalesced = repeated.json() as { job: { id: string }; disposition: string; created: boolean; coalesced: boolean };
    assert.equal(coalesced.job.id, accepted.job.id);
    assert.equal(coalesced.disposition, 'coalesced');
    assert.equal(coalesced.created, false);
    assert.equal(coalesced.coalesced, true);
    assert.equal((await eventJobCounts(fixture.eventId))['event_reprocess'], 1);

    const jobsResponse = await app.inject({
      method: 'GET', url: `/api/v1/events/${fixture.eventId}/jobs`, headers: fixture.headers,
    });
    assert.equal(jobsResponse.statusCode, 200);
    const jobs = jobsResponse.json() as {
      count: number; jobs: Array<{ id: string; stages: string[]; status: string }>;
    };
    assert.equal(jobs.count, 1);
    assert.equal(jobs.jobs[0]!.id, accepted.job.id);
    assert.deepEqual(jobs.jobs[0]!.stages, ['classification']);

    // Another owner can neither read the jobs nor queue work for this event.
    const other = await capturedEvent();
    const otherApp = await buildApp({ authConfig: other.authConfig });
    try {
      const foreignRead = await otherApp.inject({
        method: 'GET', url: `/api/v1/events/${fixture.eventId}/jobs`, headers: other.headers,
      });
      assert.equal(foreignRead.statusCode, 404);
      const foreignWrite = await otherApp.inject({
        method: 'POST', url: `/api/v1/events/${fixture.eventId}/reprocess`,
        headers: other.headers, payload: { stages: ['classification'] },
      });
      assert.equal(foreignWrite.statusCode, 404);
    } finally {
      await otherApp.close();
    }

    // Execute the accepted job, then prove a repeat after completion does not
    // execute it again while an explicit new execution does create a new job.
    const claim = await claimJob(accepted.job.id, 'api-worker');
    const execution = await executeBackgroundJob(claim);
    await completeBackgroundJob(claim, async (db) => {
      for (const effect of execution.effects) await effect(db);
    });

    const afterCompletion = await app.inject({
      method: 'POST', url: `/api/v1/events/${fixture.eventId}/reprocess`,
      headers: fixture.headers, payload: { stages: ['classification'] },
    });
    assert.equal(afterCompletion.statusCode, 202);
    const same = afterCompletion.json() as { job: { id: string }; disposition: string; created: boolean };
    assert.equal(same.job.id, accepted.job.id);
    assert.equal(same.disposition, 'already_completed');
    assert.equal(same.created, false);

    const intentional = await app.inject({
      method: 'POST', url: `/api/v1/events/${fixture.eventId}/reprocess`,
      headers: fixture.headers, payload: { stages: ['classification'], execution: 'new' },
    });
    assert.equal(intentional.statusCode, 202);
    const fresh = intentional.json() as { job: { id: string }; disposition: string; created: boolean };
    assert.notEqual(fresh.job.id, accepted.job.id);
    assert.equal(fresh.disposition, 'queued');
    assert.equal(fresh.created, true);
  } finally {
    await app.close();
  }
});

test('legacy bodyless reprocess stays synchronous and does not create a queue job', async () => {
  const fixture = await capturedEvent();
  const app = await buildApp({ authConfig: fixture.authConfig });
  try {
    const response = await app.inject({
      method: 'POST', url: `/api/v1/events/${fixture.eventId}/reprocess`,
      headers: fixture.headers, payload: {},
    });
    assert.equal(response.statusCode, 200);
    assert.equal((response.json() as { id: string }).id, fixture.eventId);
    const counts = await eventJobCounts(fixture.eventId);
    assert.equal(counts['event_reprocess'] ?? 0, 0);
    assert.ok((await classificationRow(fixture.eventId))?.classification_version);
  } finally {
    await app.close();
  }
});

test('embedding-only recovery does not rerun classification, semantics, or financial work', async () => {
  const fixture = await capturedEvent();
  await classifyCapturedEvent(fixture.eventId);
  const beforeClassification = await classificationRow(fixture.eventId);
  const beforeFinance = await financeRow(fixture.eventId);
  assert.ok(beforeClassification);
  assert.ok(beforeFinance);

  const acceptance = await queueEventReprocess({
    eventId: fixture.eventId, clientId: fixture.clientId, stages: ['embeddings'],
  });
  assert.deepEqual(acceptance.requestedStages, ['embeddings']);
  const claim = await claimJob(acceptance.job.id, 'embedding-selective-worker');
  const execution = await executeBackgroundJob(claim);
  await completeBackgroundJob(claim);

  assert.deepEqual(execution.value, {
    eventId: fixture.eventId, executedStages: ['embeddings'], skippedStages: [],
  });
  assert.deepEqual(await classificationRow(fixture.eventId), beforeClassification);
  assert.deepEqual(await financeRow(fixture.eventId), beforeFinance);
  const counts = await eventJobCounts(fixture.eventId);
  assert.equal(counts.semantic_enrichment ?? 0, 0);
  assert.equal(counts.financial_correlation ?? 0, 0);
  assert.equal(counts.classification ?? 0, 0);
  const embedding = await pool.query<{ count: number }>(`
    select count(*)::int as count from knowledge_embeddings
    where object_type = 'event' and object_id = $1
  `, [fixture.eventId]);
  assert.equal(embedding.rows[0]!.count, 1);
});

test('classification + semantics reprocessing preserves corrections and canonical financial identity', async () => {
  const fixture = await capturedEvent(`Correction Shop ${randomUUID()}`);
  await classifyCapturedEvent(fixture.eventId);
  const beforeFinance = await financeRow(fixture.eventId);
  assert.ok(beforeFinance?.id);

  const account = randomUUID();
  await pool.query(`insert into financial_accounts(id,name,type,currency) values ($1,'Correction Account','bank','UYU')`, [account]);
  const corrections = {
    merchant: 'User Merchant', financialCategory: 'User Category',
    eventCategory: 'User Event', humanExplanation: 'User explanation',
  };
  for (const [field, value] of Object.entries(corrections)) {
    await recordCorrection(pool, {
      clientId: fixture.clientId, eventId: fixture.eventId, field, value, reusable: false,
    });
    await applyCorrectionProjection(pool, fixture.eventId, field, value);
  }
  await pool.query(`
    update financial_transactions set amount = 999, currency = 'USD', account_id = $2,
      excluded_from_reports = true where id = $1
  `, [beforeFinance.id, account]);
  const correctedFinance = await financeRow(fixture.eventId);
  const correctedClassification = await classificationRow(fixture.eventId);

  const acceptance = await queueEventReprocess({
    eventId: fixture.eventId, clientId: fixture.clientId,
    stages: ['classification', 'semanticInterpretation', 'financialCorrelation'],
  });
  const claim = await claimJob(acceptance.job.id, 'correction-worker');
  const execution = await executeBackgroundJob(claim);
  await completeBackgroundJob(claim);

  const value = execution.value as {
    executedStages: string[]; skippedStages: Array<{ stage: string; reason: string }>;
  };
  assert.deepEqual(value.executedStages, ['classification', 'semanticInterpretation']);
  assert.deepEqual(value.skippedStages, [{
    stage: 'financialCorrelation', reason: 'satisfied_by_classification',
  }]);

  const afterFinance = await financeRow(fixture.eventId);
  assert.equal(afterFinance.id, correctedFinance.id, 'reprocessing must keep the canonical transaction id');
  assert.equal(afterFinance.amount, correctedFinance.amount);
  assert.equal(afterFinance.currency, correctedFinance.currency);
  assert.equal(afterFinance.account_id, correctedFinance.account_id);
  assert.equal(afterFinance.excluded_from_reports, correctedFinance.excluded_from_reports);

  const afterClassification = await classificationRow(fixture.eventId);
  assert.equal(afterClassification.inferred_kind, correctedClassification.inferred_kind);
  assert.equal(afterClassification.model_metadata.merchant, undefined);
  assert.equal(afterClassification.model_metadata.eventCategory, corrections.eventCategory);
  assert.equal(afterClassification.model_metadata.humanExplanation, corrections.humanExplanation);
  assert.ok(afterClassification.entities.some(
    (entity: { type: string; value: string }) => entity.type === 'merchant' && entity.value === corrections.merchant,
  ));
  assert.equal(afterClassification.model_metadata.financialCategory, corrections.financialCategory);

  const evidence = await pool.query<{ count: number }>(
    'select count(*)::int as count from financial_transaction_events where raw_event_id = $1',
    [fixture.eventId],
  );
  assert.equal(evidence.rows[0]!.count, 1, 'reprocessing must not duplicate financial evidence');
});

test('an expired semantic worker cannot overwrite a newer execution or user corrections', async () => {
  const fixture = await capturedEvent(`Stale Semantic ${randomUUID()}`);
  await classifyCapturedEvent(fixture.eventId);
  await recordCorrection(pool, {
    clientId: fixture.clientId, eventId: fixture.eventId, field: 'merchant',
    value: 'Stale Protected Merchant', reusable: false,
  });
  await applyCorrectionProjection(pool, fixture.eventId, 'merchant', 'Stale Protected Merchant');
  await reprocessEvent(fixture.eventId, { reuseClassification: true, skipFinancial: true, ensureOntology: false });

  const acceptance = await queueEventReprocess({
    eventId: fixture.eventId, clientId: fixture.clientId, stages: ['semanticInterpretation'],
  });
  const stale = await claimJob(acceptance.job.id, 'stale-semantic-worker', 1_000);
  await pool.query(`update background_jobs set lease_expires_at = now() - interval '5 seconds' where id = $1`, [acceptance.job.id]);
  const current = await claimJob(acceptance.job.id, 'current-semantic-worker', 5_000);
  assert.ok(current.fenceToken > stale.fenceToken);

  const currentExecution = await executeBackgroundJob(current);
  await completeBackgroundJob(current, async (db) => {
    for (const effect of currentExecution.effects) await effect(db);
  });
  // Snapshot after the newer execution settles. The stale attempt below must
  // leave every one of these values untouched.
  const classificationAfterCurrent = await classificationRow(fixture.eventId);
  const financeAfterCurrent = await financeRow(fixture.eventId);
  const semanticAfterCurrent = await pool.query(`select * from semantic_event_decisions where event_id = $1`, [fixture.eventId]);
  const embeddingsAfterCurrent = await pool.query(`
    select id, content_hash, updated_at from knowledge_embeddings
    where object_type = 'event' and object_id = $1 order by id
  `, [fixture.eventId]);

  await assert.rejects(
    () => executeBackgroundJob(stale),
    (error: unknown) => error instanceof StaleJobClaimError,
  );

  assert.deepEqual(await classificationRow(fixture.eventId), classificationAfterCurrent);
  assert.deepEqual(
    await pool.query(`select * from semantic_event_decisions where event_id = $1`, [fixture.eventId]),
    semanticAfterCurrent,
  );
  assert.deepEqual(
    await pool.query(`select id, content_hash, updated_at from knowledge_embeddings
      where object_type = 'event' and object_id = $1 order by id`, [fixture.eventId]),
    embeddingsAfterCurrent,
  );
  assert.deepEqual(await financeRow(fixture.eventId), financeAfterCurrent);
  const stored = await getEvent(fixture.eventId);
  assert.ok(stored?.classificationVersion);
  const correctedMerchant = (stored?.classifiedEntities ?? []).find(
    (entity: { type: string; value: string }) => entity.type === 'merchant',
  );
  assert.equal(correctedMerchant?.value, 'Stale Protected Merchant');
});

test('an expired embedding worker cannot overwrite newer vectors', async () => {
  const fixture = await capturedEvent(`Stale Embedding ${randomUUID()}`);
  await classifyCapturedEvent(fixture.eventId);
  const acceptance = await queueEventReprocess({
    eventId: fixture.eventId, clientId: fixture.clientId, stages: ['embeddings'],
  });
  const stale = await claimJob(acceptance.job.id, 'stale-embedding-worker', 1_000);
  await pool.query(`update background_jobs set lease_expires_at = now() - interval '5 seconds' where id = $1`, [acceptance.job.id]);
  const current = await claimJob(acceptance.job.id, 'current-embedding-worker', 5_000);

  const currentExecution = await executeBackgroundJob(current);
  await completeBackgroundJob(current);
  const afterCurrent = await pool.query<{ id: string; content_hash: string; updated_at: string }>(`
    select id, content_hash, updated_at from knowledge_embeddings
    where object_type = 'event' and object_id = $1 order by id
  `, [fixture.eventId]);
  assert.equal(afterCurrent.rows.length, 1);

  await assert.rejects(
    () => executeBackgroundJob(stale),
    (error: unknown) => error instanceof StaleJobClaimError,
  );
  assert.deepEqual(await pool.query(`
    select id, content_hash, updated_at from knowledge_embeddings
    where object_type = 'event' and object_id = $1 order by id
  `, [fixture.eventId]), afterCurrent);
  assert.equal(currentExecution.effects.length, 0);
});

test('a dependency lost after acceptance dead-letters instead of running an implicit stage', async () => {
  const fixture = await capturedEvent(`Lost Dependency ${randomUUID()}`);
  await classifyCapturedEvent(fixture.eventId);
  const acceptance = await queueEventReprocess({
    eventId: fixture.eventId, clientId: fixture.clientId, stages: ['semanticInterpretation'],
  });
  const claim = await claimJob(acceptance.job.id, 'lost-dependency-worker', 5_000);
  await pool.query('delete from classified_events where raw_event_id = $1', [fixture.eventId]);

  await assert.rejects(
    () => executeBackgroundJob(claim),
    (error: unknown) => error instanceof ReprocessPrerequisiteError,
  );
  const failed = await failBackgroundJob(claim, new ReprocessPrerequisiteError('semanticInterpretation', ['classification']));
  assert.equal(failed.deadLetter, true, 'a permanent prerequisite failure must not consume retry attempts');
  const jobs = await listEventBackgroundJobs(pool, fixture.eventId);
  assert.equal(jobs.find((job) => job.id === acceptance.job.id)?.status, 'dead_letter');

  // Explicitly requesting classification with the dependent stage is allowed:
  // the same job runs classification first and satisfies the dependency.
  const recovered = await queueEventReprocess({
    eventId: fixture.eventId, clientId: fixture.clientId,
    stages: ['classification', 'semanticInterpretation'],
  });
  assert.deepEqual(recovered.requestedStages, ['classification', 'semanticInterpretation']);
});

test('active executions with overlapping stages are rejected instead of duplicated', async () => {
  const fixture = await capturedEvent(`Active Conflict ${randomUUID()}`);
  await classifyCapturedEvent(fixture.eventId);
  const active = await queueEventReprocess({
    eventId: fixture.eventId, clientId: fixture.clientId, stages: ['embeddings'],
  });
  await assert.rejects(
    () => queueEventReprocess({
      eventId: fixture.eventId, clientId: fixture.clientId, stages: ['financialCorrelation'],
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as { code?: string }).code, 'reprocess_in_progress');
      assert.equal((error as { details?: { activeJob?: { id?: string } } }).details?.activeJob?.id, active.job.id);
      return true;
    },
  );
  const reused = await queueEventReprocess({
    eventId: fixture.eventId, clientId: fixture.clientId, stages: ['embeddings'],
  });
  assert.equal(reused.job.id, active.job.id);
  assert.equal(reused.disposition, 'coalesced');
  assert.ok(REPROCESS_STAGES.includes('embeddings'));
});
