import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { buildApp } from '../src/app.ts';
import type { AuthConfig } from '../src/auth.ts';
import {
  deriveEventProgress,
  type EventProgressSnapshot,
  type ProgressJobSnapshot,
} from '../src/domain/event-progress.ts';
import { EMBEDDING_VERSION } from '../src/storage/embeddings.ts';
import { pool } from '../src/storage/postgres.ts';

const NOW = new Date('2026-10-24T12:00:00.000Z');
const future = '2026-10-24T12:05:00.000Z';
const past = '2026-10-24T11:00:00.000Z';

const job = (status: ProgressJobSnapshot['status'], extra: Partial<ProgressJobSnapshot> = {}): ProgressJobSnapshot => ({
  status, attemptCount: 1, maxAttempts: 5, runAfter: null, leaseExpiresAt: null, ...extra,
});

function snapshot(overrides: Partial<EventProgressSnapshot> = {}): EventProgressSnapshot {
  return {
    event: { kind: 'note', processingStatus: 'captured', processingAllowed: true, privacyStatus: 'standard' },
    classification: null,
    financialLinked: false,
    embedded: false,
    jobs: {},
    ...overrides,
  };
}

const classified = (inferredKind: string, interpretationStatus = 'pending') => ({ inferredKind, interpretationStatus });
const statuses = (s: EventProgressSnapshot) => {
  const { stages } = deriveEventProgress(s, NOW);
  return {
    classification: stages.classification.status,
    interpretation: stages.semanticInterpretation.status,
    financial: stages.financialProjection.status,
    search: stages.searchIndexing.status,
  };
};

test('a queued classification job is pending, never completed', () => {
  const s = snapshot({ jobs: { classification: job('queued') } });
  assert.deepEqual(statuses(s), {
    classification: 'pending', interpretation: 'pending', financial: 'pending', search: 'pending',
  });
  const progress = deriveEventProgress(s, NOW);
  assert.equal(progress.summary.status, 'pending');
  assert.equal(progress.summary.partial, false);
  assert.equal(progress.summary.message, 'Classification pending.');
  assert.equal(progress.stages.financialProjection.code, 'applicability_unknown');
});

test('expense recorded while interpretation is still pending is partial success', () => {
  const s = snapshot({
    event: { kind: 'expense', processingStatus: 'classified', processingAllowed: true, privacyStatus: 'standard' },
    classification: classified('expense'),
    financialLinked: true,
    jobs: { classification: job('succeeded'), semantic_enrichment: job('queued') },
  });
  const progress = deriveEventProgress(s, NOW);
  assert.equal(progress.stages.classification.status, 'completed');
  assert.equal(progress.stages.financialProjection.status, 'completed');
  assert.equal(progress.stages.semanticInterpretation.status, 'pending');
  assert.equal(progress.stages.searchIndexing.status, 'pending');
  assert.equal(progress.stages.searchIndexing.code, 'waiting_for_semanticInterpretation');
  assert.deepEqual(progress.summary, {
    status: 'pending', partial: true, message: 'Expense recorded; interpretation pending.',
  });
});

test('a running job with a live lease is running; an expired lease is pending again', () => {
  const base = { event: snapshot().event, classification: classified('note') };
  const live = deriveEventProgress(snapshot({ ...base, jobs: { semantic_enrichment: job('running', { leaseExpiresAt: future }) } }), NOW);
  assert.equal(live.stages.semanticInterpretation.status, 'running');
  assert.equal(live.summary.message, 'Interpretation in progress.');
  const stale = deriveEventProgress(snapshot({ ...base, jobs: { semantic_enrichment: job('running', { leaseExpiresAt: past }) } }), NOW);
  assert.equal(stale.stages.semanticInterpretation.status, 'pending');
  assert.equal(stale.stages.semanticInterpretation.code, 'lease_expired');
});

test('retry_scheduled is a recoverable failure that reports the attempt and next run', () => {
  const s = snapshot({
    classification: classified('note'),
    jobs: { semantic_enrichment: job('retry_scheduled', { attemptCount: 2, runAfter: future }) },
  });
  const stage = deriveEventProgress(s, NOW).stages.semanticInterpretation;
  assert.equal(stage.status, 'recoverable_failure');
  assert.equal(stage.code, 'retry_scheduled');
  assert.deepEqual(stage.job, { status: 'retry_scheduled', attempt: 2, maxAttempts: 5, nextAttemptAt: future });
  assert.match(stage.message, /attempt 2 of 5/);
});

test('an exhausted job is terminal, blocks dependents, and a replay returns it to pending', () => {
  const dead = snapshot({ jobs: { classification: job('dead_letter', { attemptCount: 5 }) } });
  const progress = deriveEventProgress(dead, NOW);
  assert.equal(progress.stages.classification.status, 'terminal_failure');
  assert.equal(progress.stages.classification.code, 'retries_exhausted');
  assert.equal(progress.stages.semanticInterpretation.code, 'blocked_by_classification');
  assert.equal(progress.stages.semanticInterpretation.status, 'terminal_failure');
  assert.equal(progress.stages.financialProjection.status, 'terminal_failure');
  assert.equal(progress.summary.status, 'terminal_failure');
  assert.equal(progress.summary.message, 'Classification failed.');

  // Operator replay re-queues the same row.
  const replayed = snapshot({ jobs: { classification: job('queued', { attemptCount: 5, maxAttempts: 10 }) } });
  assert.equal(deriveEventProgress(replayed, NOW).stages.classification.status, 'pending');
});

test('interpretation awaiting review is not a failure and still lets search be scheduled', () => {
  const s = snapshot({
    event: { kind: 'note', processingStatus: 'review', processingAllowed: true, privacyStatus: 'standard' },
    classification: classified('note', 'review'),
    jobs: { semantic_enrichment: job('succeeded') },
  });
  const progress = deriveEventProgress(s, NOW);
  assert.equal(progress.stages.semanticInterpretation.status, 'awaiting_review');
  assert.equal(progress.stages.financialProjection.status, 'not_applicable');
  assert.equal(progress.stages.searchIndexing.code, 'not_scheduled');
  assert.equal(progress.summary.status, 'awaiting_review');
  assert.equal(progress.summary.message, 'Interpretation awaiting review.');
});

test('retryable interpretation without a job is recoverable, not pending', () => {
  const s = snapshot({ classification: classified('note', 'retryable') });
  assert.equal(deriveEventProgress(s, NOW).stages.semanticInterpretation.status, 'recoverable_failure');
});

test('a fully processed financial event completes every applicable stage', () => {
  const s = snapshot({
    event: { kind: 'expense', processingStatus: 'semantically_resolved', processingAllowed: true, privacyStatus: 'standard' },
    classification: classified('expense', 'resolved'),
    financialLinked: true,
    embedded: true,
  });
  const progress = deriveEventProgress(s, NOW);
  assert.deepEqual(statuses(s), { classification: 'completed', interpretation: 'completed', financial: 'completed', search: 'completed' });
  assert.deepEqual(progress.summary, { status: 'completed', partial: false, message: 'Expense recorded; processing complete.' });
});

test('financial detection without a ledger row is surfaced, not hidden as not_applicable', () => {
  const s = snapshot({ classification: classified('expense', 'resolved') });
  const stage = deriveEventProgress(s, NOW).stages.financialProjection;
  assert.equal(stage.status, 'terminal_failure');
  assert.equal(stage.code, 'ledger_not_derived');
});

test('non-financial events mark the financial stage not applicable', () => {
  const s = snapshot({ classification: classified('note', 'resolved'), embedded: true });
  assert.equal(statuses(s).financial, 'not_applicable');
  assert.equal(deriveEventProgress(s, NOW).summary.message, 'Processing complete.');
});

test('hidden and policy-disabled events have no applicable stages', () => {
  for (const [event, code] of [
    [{ ...snapshot().event, privacyStatus: 'hidden' }, 'hidden_event'],
    [{ ...snapshot().event, processingAllowed: false, processingStatus: 'discarded' }, 'processing_disabled'],
  ] as const) {
    const progress = deriveEventProgress(snapshot({ event }), NOW);
    for (const stage of Object.values(progress.stages)) {
      assert.equal(stage.status, 'not_applicable');
      assert.equal(stage.code, code);
    }
    assert.equal(progress.summary.status, 'not_applicable');
  }
});

test('historical events are judged by their records, not by missing jobs', () => {
  const withRecords = snapshot({
    event: { kind: 'expense', processingStatus: 'semantically_resolved', processingAllowed: true, privacyStatus: 'standard' },
    classification: classified('expense', 'resolved'),
    financialLinked: true,
    embedded: true,
    jobs: {},
  });
  assert.deepEqual(statuses(withRecords), { classification: 'completed', interpretation: 'completed', financial: 'completed', search: 'completed' });

  // Resolved before interpretation_status existed (column default 'pending', never backfilled).
  const legacyResolved = snapshot({
    event: { kind: 'note', processingStatus: 'semantically_resolved', processingAllowed: true, privacyStatus: 'standard' },
    classification: classified('note', 'pending'),
  });
  assert.equal(deriveEventProgress(legacyResolved, NOW).stages.semanticInterpretation.status, 'completed');

  // Interpreted but never indexed and no job: honest pending, not completed.
  const unindexed = snapshot({ classification: classified('note', 'resolved') });
  const search = deriveEventProgress(unindexed, NOW).stages.searchIndexing;
  assert.equal(search.status, 'pending');
  assert.equal(search.code, 'not_scheduled');

  // Nothing at all: pending/not_scheduled, never completed.
  const empty = deriveEventProgress(snapshot(), NOW);
  assert.equal(empty.stages.classification.code, 'not_scheduled');
  assert.notEqual(empty.summary.status, 'completed');
});

test('a succeeded job without its record is not reported as completed', () => {
  const noRecord = deriveEventProgress(snapshot({ jobs: { classification: job('succeeded') } }), NOW);
  assert.equal(noRecord.stages.classification.status, 'pending');
  assert.equal(noRecord.stages.classification.code, 'awaiting_record');
  // A succeeded embedding job that stored nothing means policy declined it.
  const declined = deriveEventProgress(snapshot({
    classification: classified('note', 'resolved'), jobs: { embedding: job('succeeded') },
  }), NOW);
  assert.equal(declined.stages.searchIndexing.status, 'not_applicable');
  assert.equal(declined.stages.searchIndexing.code, 'not_indexable');
});

test('the job payload never leaks raw error text', () => {
  const progress = deriveEventProgress(snapshot({
    jobs: { classification: { ...job('retry_scheduled'), lastError: 'secret provider text' } as ProgressJobSnapshot },
  }), NOW);
  assert.ok(!JSON.stringify(progress).includes('secret provider text'));
});

// ---- Integration through the real route and storage -----------------------------------------

const auth: AuthConfig = { globalApiKey: null, clientKeys: new Map([['prog-a', 'key-a'], ['prog-b', 'key-b']]) };
const headers = { 'x-brainia-client-id': 'prog-a', 'x-brainia-api-key': 'key-a' };

async function seedEvent(owner: string, kind: string, status = 'captured') {
  const id = `prog_${randomUUID()}`;
  await pool.query(
    `insert into raw_events (id, source, contract_version, client_id, owner_id, dedupe_key, kind, title, body, raw, tags, processing_status)
     values ($1,'test.src',1,$2,$2,$3,$4,'Title','Body','{}'::jsonb,'{}'::text[],$5)`,
    [id, owner, `${owner}:${id}`, kind, status],
  );
  return id;
}

async function seedJob(owner: string, eventId: string, jobType: string, status: string, extra: { attempts?: number; max?: number; leaseSeconds?: number } = {}) {
  await pool.query(
    `insert into background_jobs (id, client_id, owner_id, event_id, job_type, payload, status, idempotency_key,
       attempt_count, max_attempts, run_after, lease_expires_at, last_error)
     values ($1,$2,$2,$3,$4,'{}'::jsonb,$5,$6,$7,$8, now() + interval '5 minutes',
       case when $9::int is null then null else now() + ($9::int * interval '1 second') end, 'boom: secret detail')`,
    [`job_${randomUUID()}`, owner, eventId, jobType, status, `${jobType}:${eventId}`, extra.attempts ?? 1, extra.max ?? 5, extra.leaseSeconds ?? null],
  );
}

async function seedClassified(owner: string, eventId: string, inferredKind: string, interpretationStatus: string) {
  await pool.query(
    `insert into classified_events (id, raw_event_id, client_id, owner_id, contract_version, classification_version, inferred_kind, confidence, entities, interpretation_status)
     values ($1,$2,$3,$3,1,'v1',$4,0.9,'[]'::jsonb,$5)`,
    [`cls_${randomUUID()}`, eventId, owner, inferredKind, interpretationStatus],
  );
}

async function getProgress(app: Awaited<ReturnType<typeof buildApp>>, id: string, requestHeaders = headers) {
  const response = await app.inject({ method: 'GET', url: `/api/v1/events/${id}`, headers: requestHeaders });
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as Record<string, any>;
}

test('GET /events/:id keeps processingStatus and adds stage progress derived from jobs and records', async () => {
  const app = await buildApp({ authConfig: auth });
  try {
    // Wallet expense: classified, ledger-linked, semantic job only queued.
    const expense = await seedEvent('prog-a', 'expense', 'classified');
    await seedClassified('prog-a', expense, 'expense', 'pending');
    await seedJob('prog-a', expense, 'classification', 'succeeded');
    await seedJob('prog-a', expense, 'semantic_enrichment', 'queued');
    await pool.query(
      `insert into financial_transactions (id, owner_id, kind, amount, currency, merchant_label, normalized_merchant,
         observed_at, window_start, window_end, primary_source, anchor_event_id)
       values ($1,'prog-a','expense',12.5,'USD','Cafe','cafe', now(), now(), now(), 'test.src', $2)`,
      [`txn_${expense}`, expense],
    );
    await pool.query(
      `insert into financial_transaction_events (id, owner_id, transaction_id, raw_event_id, source, kind, amount, merchant_label, normalized_merchant, observed_at, match_reason)
       values ($1,'prog-a',$2,$3,'test.src','expense',12.5,'Cafe','cafe', now(),'test')`,
      [`fte_${expense}`, `txn_${expense}`, expense],
    );
    const body = await getProgress(app, expense);
    assert.equal(body.processingStatus, 'classified', 'overall status preserved');
    assert.equal(body.progress.version, 1);
    assert.equal(body.progress.stages.classification.status, 'completed');
    assert.equal(body.progress.stages.financialProjection.status, 'completed');
    assert.equal(body.progress.stages.semanticInterpretation.status, 'pending');
    assert.equal(body.progress.summary.message, 'Expense recorded; interpretation pending.');
    assert.ok(!JSON.stringify(body.progress).includes('secret detail'));

    // Same event once the semantic job is exhausted.
    await pool.query(`update background_jobs set status='dead_letter', attempt_count=5 where event_id=$1 and job_type='semantic_enrichment'`, [expense]);
    const failed = await getProgress(app, expense);
    assert.equal(failed.progress.stages.semanticInterpretation.status, 'terminal_failure');
    assert.equal(failed.progress.stages.financialProjection.status, 'completed');
    assert.equal(failed.progress.summary.message, 'Expense recorded; interpretation failed.');

    // Embedding at the current version completes search once interpretation resolves.
    await pool.query(`update classified_events set interpretation_status='resolved' where raw_event_id=$1`, [expense]);
    await pool.query(
      `insert into knowledge_embeddings (id, client_id, owner_id, object_type, object_id, embedding, dimensions, model, embedding_version, content_hash, content)
       values ($1,'prog-a','prog-a','event',$2,'{0}',1,'m',$3,'h','c')`,
      [`emb_${expense}`, expense, EMBEDDING_VERSION],
    );
    const done = await getProgress(app, expense);
    assert.equal(done.progress.stages.semanticInterpretation.status, 'completed');
    assert.equal(done.progress.stages.searchIndexing.status, 'completed');
    assert.equal(done.progress.summary.message, 'Expense recorded; processing complete.');
  } finally {
    await app.close();
  }
});

test('GET /events/:id derives retry, exhausted and inapplicable stages and stays owner scoped', async () => {
  const app = await buildApp({ authConfig: auth });
  try {
    const retrying = await seedEvent('prog-a', 'note');
    await seedJob('prog-a', retrying, 'classification', 'retry_scheduled', { attempts: 2 });
    const retry = (await getProgress(app, retrying)).progress.stages.classification;
    assert.equal(retry.status, 'recoverable_failure');
    assert.equal(retry.job.attempt, 2);
    assert.ok(retry.job.nextAttemptAt);

    const hidden = await seedEvent('prog-a', 'note', 'discarded');
    await pool.query(`update raw_events set privacy_status='hidden' where id=$1`, [hidden]);
    const hiddenBody = await getProgress(app, hidden);
    assert.equal(hiddenBody.progress.summary.status, 'not_applicable');

    const running = await seedEvent('prog-a', 'note');
    await seedJob('prog-a', running, 'classification', 'running', { leaseSeconds: 60 });
    assert.equal((await getProgress(app, running)).progress.stages.classification.status, 'running');
    await pool.query(`update background_jobs set lease_expires_at = now() - interval '1 minute' where event_id=$1`, [running]);
    assert.equal((await getProgress(app, running)).progress.stages.classification.code, 'lease_expired');

    const other = await app.inject({
      method: 'GET', url: `/api/v1/events/${retrying}`,
      headers: { 'x-brainia-client-id': 'prog-b', 'x-brainia-api-key': 'key-b' },
    });
    assert.equal(other.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('POST /events returns progress that does not report enqueued work as finished', async () => {
  const app = await buildApp({ authConfig: auth });
  try {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/events', headers,
      payload: { id: `prog_${randomUUID()}`, source: 'test.capture', kind: 'note', title: 'Hello', body: 'World', contractVersion: 1 },
    });
    assert.equal(response.statusCode, 201, response.body);
    const body = response.json() as Record<string, any>;
    assert.ok(body.processingStatus);
    assert.ok(body.progress, 'progress present on capture response');
    // Whatever the processing mode, enqueued work must never read as finished.
    for (const stageName of ['semanticInterpretation', 'searchIndexing']) {
      assert.notEqual(body.progress.stages[stageName].status, 'completed', stageName);
    }
  } finally {
    await app.close();
  }
});
