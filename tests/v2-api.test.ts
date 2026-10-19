import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { buildApp } from '../src/app.ts';
import { loadAuthConfig } from '../src/auth.ts';
import { pool } from '../src/storage/postgres.ts';
import { classifyCapturedEvent } from '../src/storage/event-store.ts';

// Run with the isolated preload; never allow this suite to use a configured DB.
assert.equal(process.env.DATABASE_URL, 'postgres://isolated-test.invalid/brainia',
  'Run with --import ./tests/pglite-setup.mjs');

const timestamp = '2026-10-17T12:00:00.000Z';
const financePath = '/api/v2/financial/transactions?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z';
const validators = createRequire(import.meta.url)('../contracts/brain-ai/2.0.0/validators.cjs');
function contract(name: string, value: any) {
  assert.equal(validators[name](value), true, `${name}: ${JSON.stringify(validators[name].errors)}`);
  return value;
}
const note = (body = 'Una nota con acentos: café y reunión.') => ({ type: 'note', title: 'Recordatorio', body, raw: {} });
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function fingerprint(envelope: Record<string, any>) {
  const { changeKind, content, sourceOccurredAt, sourceUpdatedAt } = envelope;
  return createHash('sha256').update(canonical({ changeKind, content, sourceOccurredAt, sourceUpdatedAt }), 'utf8').digest('hex');
}
function envelope(sourceInstanceId: string, overrides: Record<string, any> = {}) {
  const result = { contractVersion: 2, deliveryId: randomUUID(), sourceInstanceId,
    sourceObservationKey: randomUUID(), producerRevisionId: randomUUID(), producerSequence: '1',
    changeKind: 'posted', canonicalizationVersion: 'jcs-sha256-v1', sourceOccurredAt: timestamp,
    sourceUpdatedAt: null, deviceObservedAt: timestamp, content: note(), ...overrides };
  return { ...result, contentFingerprint: fingerprint(result) };
}
type Response = { statusCode: number; body: string; headers: Record<string, any>; json(): any };
function error(response: Response, status: number, code?: string) {
  assert.equal(response.statusCode, status, response.body);
  const body = response.json();
  contract('Error', body);
  assert.equal(typeof body.error, 'object', response.body);
  if (code) assert.equal(body.error.code, code, response.body);
  assert.equal(typeof body.error.message, 'string');
  assert.equal(body.error.requestId, response.headers['x-request-id']);
  assert.equal(typeof body.error.retryable, 'boolean');
  assert.equal(response.headers['cache-control'], 'no-store');
  return body.error;
}
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const ownerA = `api-a-${randomUUID()}`, ownerB = `api-b-${randomUUID()}`;
  const tokenA = randomUUID(), tokenB = randomUUID();
  const previous = process.env.BRAINIA_DEVICE_TOKENS;
  process.env.BRAINIA_DEVICE_TOKENS = `${ownerA}:${tokenA},${ownerB}:${tokenB}`;
  const app = await buildApp({ authConfig: loadAuthConfig({
    BRAINIA_API_KEY: 'global-api-secret', BRAINIA_DEVICE_TOKENS: process.env.BRAINIA_DEVICE_TOKENS,
  }) });
  t.after(async () => {
    await app.close();
    if (previous === undefined) delete process.env.BRAINIA_DEVICE_TOKENS;
    else process.env.BRAINIA_DEVICE_TOKENS = previous;
  });
  const headersA = { authorization: `Bearer ${tokenA}` }, headersB = { authorization: `Bearer ${tokenB}` };
  const sourceA = `source-${randomUUID()}`, sourceB = `source-${randomUUID()}`;
  for (const [owner, id] of [[ownerA, sourceA], [ownerB, sourceB]]) {
    await pool.query(`insert into v2_source_instances(id,owner_id,content_type,source,enabled)
      values($1,$2,'note','capture.note',true)`, [id, owner]);
  }
  const post = (payload: unknown, headers = headersA) => app.inject({ method: 'POST', url: '/api/v2/observations', headers, payload });
  const capture = async (payload = envelope(sourceA), headers = headersA) => {
    const response = await post(payload, headers);
    assert.equal(response.statusCode, 201, response.body);
    return contract('Receipt', response.json());
  };
  const get = (url: string, headers = headersA) => app.inject({ method: 'GET', url, headers });
  return { app, ownerA, ownerB, tokenA, tokenB, sourceA, sourceB, headersA, headersB, post, capture, get };
}

test('v2 API bearer authentication, owner bootstrap, cache policy and closed scopes', async t => {
  const f = await fixture(t);
  error(await f.app.inject({ method: 'GET', url: '/api/v2/capabilities' }), 401, 'unauthenticated');
  error(await f.get('/api/v2/capabilities', { authorization: 'Bearer unknown' }), 401, 'unauthenticated');
  const capabilities = await f.get('/api/v2/capabilities');
  assert.equal(capabilities.statusCode, 200, capabilities.body);
  contract('Capabilities', capabilities.json());
  assert.equal(capabilities.headers['cache-control'], 'no-store');
  assert.ok(capabilities.headers['x-request-id']);
  assert.deepEqual(capabilities.json().captureVersions, [1, 2]);
  assert.deepEqual(capabilities.json().features, { observationRevisions: true, decimalFinance: true,
    email: false, activity: false, location: false, episodes: false, connectors: false });
  assert.equal(capabilities.json().maxItemBytes, 65536);
  assert.equal(capabilities.json().maxBatchBytes, 1048576);
  const global = await f.get('/api/v2/capabilities', { authorization: 'Bearer global-api-secret' });
  assert.match(error(global, 403, 'forbidden').message, /owner|scope/i);
  const spoof = await f.app.inject({ method: 'GET', url: '/api/v2/capabilities',
    headers: { ...f.headersA, 'x-owner-id': f.ownerB } });
  error(spoof, 403);

  const bootstrap = await buildApp({ authConfig: { globalApiKey: null, clientKeys: new Map([[f.ownerA, 'bootstrap-key']]) } });
  try {
    const accepted = await bootstrap.inject({ method: 'POST', url: '/api/v2/observations',
      headers: { authorization: 'Bearer bootstrap-key' }, payload: envelope(f.sourceA) });
    assert.equal(accepted.statusCode, 201, accepted.body);
    const observation = await pool.query('select owner_id from v2_observations where id=$1', [accepted.json().observationId]);
    assert.equal(observation.rows[0].owner_id, f.ownerA);
    const v1 = await bootstrap.inject({ method: 'GET', url: '/api/v1/events',
      headers: { 'x-brainia-client-id': f.ownerA, 'x-brainia-api-key': 'bootstrap-key' } });
    assert.equal(v1.statusCode, 200, v1.body);
  } finally { await bootstrap.close(); }
  const multi = await buildApp({ authConfig: { globalApiKey: null, clientKeys: new Map([[f.ownerA, 'a-key'], [f.ownerB, 'b-key']]) } });
  try {
    error(await multi.inject({ method: 'GET', url: '/api/v2/capabilities', headers: { authorization: 'Bearer a-key' } }), 401, 'unauthenticated');
  } finally { await multi.close(); }
});

test('v2 API immutable capture receipts replay, duplicate producer revisions and conflicting identities', async t => {
  const f = await fixture(t);
  const input = envelope(f.sourceA);
  const first = await f.capture(input);
  assert.equal(first.contentFingerprint, input.contentFingerprint);
  assert.equal(first.disposition, 'stored');
  assert.equal(first.processing, 'queued');
  const replay = await f.post(input);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.deepEqual(replay.json(), first);
  const duplicateInput = { ...input, deliveryId: randomUUID() };
  const duplicate = await f.post(duplicateInput);
  assert.equal(duplicate.statusCode, 200, duplicate.body);
  assert.equal(duplicate.json().disposition, 'duplicate');
  assert.equal(duplicate.json().revisionId, first.revisionId);
  assert.equal(duplicate.json().deliveryId, duplicateInput.deliveryId);
  assert.deepEqual((await f.post(duplicateInput)).json(), duplicate.json());
  const changed = envelope(f.sourceA, { ...input, content: note('Different content') });
  error(await f.post(changed), 409, 'identity_conflict');
  error(await f.post({ ...changed, deliveryId: randomUUID() }), 409, 'identity_conflict');
  error(await f.post({ ...input, deliveryId: randomUUID(), contentFingerprint: '0'.repeat(64) }), 422, 'fingerprint_mismatch');
  const revision2 = envelope(f.sourceA, { sourceObservationKey: input.sourceObservationKey,
    producerSequence: '3', changeKind: 'updated', content: note('Latest content') });
  const second = await f.capture(revision2);
  assert.equal(second.observationId, first.observationId);
  assert.equal(second.revisionNumber, 2);
  const late = await f.capture(envelope(f.sourceA, { sourceObservationKey: input.sourceObservationKey,
    producerSequence: '2', changeKind: 'updated', content: note('Late older sequence') }));
  assert.equal(late.revisionNumber, 3);
  const detail = await f.get(`/api/v2/observations/${first.observationId}`);
  assert.equal(detail.statusCode, 200, detail.body);
  contract('ObservationDetail', detail.json());
  assert.equal(detail.json().latestRevisionId, second.revisionId);
  assert.equal(detail.json().revisionCount, 3);
  const page1 = (await f.get(`/api/v2/observations/${first.observationId}/revisions?limit=1`)).json();
  assert.deepEqual(page1.items[0].content, input.content);
  contract('ObservationRevisionPage', page1);
  assert.equal(page1.items[0].contentFingerprint, input.contentFingerprint);
  assert.ok(page1.nextCursor);
  const page2 = (await f.get(`/api/v2/observations/${first.observationId}/revisions?limit=1&cursor=${encodeURIComponent(page1.nextCursor)}`)).json();
  assert.equal(page2.items[0].revisionId, second.revisionId);
  assert.notEqual(page2.items[0].revisionId, page1.items[0].revisionId);
  const stored = await pool.query(`select r.raw_event_id, j.job_type from v2_observation_revisions r
    join background_jobs j on j.event_id=r.raw_event_id where r.observation_id=$1`, [first.observationId]);
  assert.equal(stored.rows.length, 3, 'one classification job per stored revision; replay adds none');
  assert.ok(stored.rows.every(row => row.job_type === 'classification'));
  const event = await f.get(`/api/v2/events/${stored.rows[0].raw_event_id}`);
  assert.equal(event.statusCode, 200, event.body);
  contract('Event', event.json());
  for (const path of [`observations/${first.observationId}`, `observations/${first.observationId}/revisions`, `events/${stored.rows[0].raw_event_id}`]) {
    error(await f.get(`/api/v2/${path}`, f.headersB), 404, 'not_found');
  }
});

test('v2 API capture uses canonical object order and enforces strict content, UTF-8 limits and source authorization', async t => {
  const f = await fixture(t);
  const input = envelope(f.sourceA);
  await f.capture({ ...input, content: { raw: {}, body: input.content.body, title: input.content.title, type: 'note' } });
  for (const override of [{ ownerId: f.ownerB }, { content: { ...note(), unexpected: true } },
    { content: { ...note(), raw: { secret: 'not allowlisted' } } }, { producerSequence: '0' },
    { sourceOccurredAt: 'not-a-date' }]) {
    error(await f.post(envelope(f.sourceA, override)), 400, 'invalid_request');
  }
  error(await f.post({ ...envelope(f.sourceA), contractVersion: 3 }), 422, 'unsupported_contract');
  error(await f.post({ ...envelope(f.sourceA), canonicalizationVersion: 'unknown' }), 422, 'unsupported_contract');
  error(await f.post(envelope(f.sourceB)), 404, 'not_found');
  error(await f.post(envelope(`unknown-${randomUUID()}`)), 404, 'not_found');
  error(await f.post(envelope(f.sourceA, { content: { type: 'notification', title: null, body: 'Hi', raw: {}, packageName: 'app.example' } })), 403);
  // These lengths are under the character limits but over the UTF-8 byte limits.
  for (const content of [{ ...note(), title: 'é'.repeat(513) }, { ...note(), body: 'é'.repeat(24577) }]) {
    error(await f.post(envelope(f.sourceA, { content })), 413, 'payload_too_large');
  }
  error(await f.post(envelope(f.sourceA, { sourceObservationKey: 'x'.repeat(66000) })), 413, 'payload_too_large');
  for (const [contentType, source, content] of [
    ['notification', 'capture.notification', { type: 'notification', title: 'Hi', body: 'Notification', raw: {}, packageName: 'app.example' }],
    ['receipt', 'capture.wallet', { type: 'receipt', title: 'Receipt', body: 'Purchase', raw: { amount: '10.25', currency: 'UYU' }, merchantText: 'Shop', reference: null, attachmentRefs: [] }],
  ] as const) {
    const id = randomUUID();
    await pool.query('insert into v2_source_instances(id,owner_id,content_type,source,enabled) values($1,$2,$3,$4,true)', [id, f.ownerA, contentType, source]);
    await f.capture(envelope(id, { content }));
  }
  await f.capture(envelope(f.sourceA, { content: { ...note(), title: 'é'.repeat(512), body: 'é'.repeat(24576) } }));
  await pool.query('update v2_source_instances set enabled=false where owner_id=$1 and id=$2', [f.ownerA, f.sourceA]);
  error(await f.post(envelope(f.sourceA)), 403, 'source_disabled');
});

test('v2 API batch commits independent items and preserves input order', async t => {
  const f = await fixture(t);
  const good1 = envelope(f.sourceA), good2 = envelope(f.sourceA);
  const bad = { ...envelope(f.sourceA), contentFingerprint: '0'.repeat(64) };
  const response = await f.app.inject({ method: 'POST', url: '/api/v2/observations/batch', headers: f.headersA,
    payload: { contractVersion: 2, items: [good1, bad, good2, good1] } });
  assert.equal(response.statusCode, 200, response.body);
  contract('BatchResponse', response.json());
  const results = response.json().results;
  assert.deepEqual(results.map((item: any) => item.index), [0, 1, 2, 3]);
  assert.deepEqual(results.map((item: any) => item.deliveryId), [good1.deliveryId, bad.deliveryId, good2.deliveryId, good1.deliveryId]);
  assert.deepEqual(results.map((item: any) => item.status), [201, 422, 201, 200]);
  assert.equal(results[1].error.code, 'fingerprint_mismatch');
  assert.deepEqual(results[3].receipt, results[0].receipt);
  const rows = await pool.query('select id from v2_observations where owner_id=$1', [f.ownerA]);
  assert.equal(rows.rows.length, 2);
  for (const items of [[], Array.from({ length: 101 }, () => envelope(f.sourceA))]) {
    error(await f.app.inject({ method: 'POST', url: '/api/v2/observations/batch', headers: f.headersA,
      payload: { contractVersion: 2, items } }), 400, 'invalid_request');
  }
  error(await f.app.inject({ method: 'POST', url: '/api/v2/observations/batch', headers: f.headersA,
    payload: { contractVersion: 2, items: Array.from({ length: 24 }, () => envelope(f.sourceA, { content: note('x'.repeat(48000)) })) } }), 413, 'payload_too_large');
});

async function transaction(f: Awaited<ReturnType<typeof fixture>>, amount: string, owner = f.ownerA) {
  const capture = await f.capture(envelope(owner === f.ownerA ? f.sourceA : f.sourceB), owner === f.ownerA ? f.headersA : f.headersB);
  const event = (await pool.query('select raw_event_id from v2_observation_revisions where id=$1', [capture.revisionId])).rows[0].raw_event_id;
  const id = randomUUID();
  await pool.query(`insert into financial_transactions(id,owner_id,kind,amount,currency,merchant_label,normalized_merchant,
    observed_at,window_start,window_end,evidence_count,match_score,match_strategy,primary_source,anchor_event_id,
    currency_status,amount_confirmed,amount_role,excluded_from_reports)
    values($1,$2,'expense',$3,'UYU','Fixture merchant','fixture merchant',$4,$4,$4,1,1,'test','capture.wallet',$5,
    'explicit',true,'posted',false)`, [id, owner, amount, timestamp, event]);
  await pool.query(`insert into financial_transaction_events(id,owner_id,transaction_id,raw_event_id,source,kind,amount,currency,
    merchant_label,normalized_merchant,observed_at,match_score,match_reason)
    values($1,$2,$3,$4,'capture.wallet','expense',$5,'UYU','Fixture merchant','fixture merchant',$6,1,'test')`, [randomUUID(), owner, id, event, amount, timestamp]);
  return id;
}

test('v2 API finance returns decimal strings, exact summary and owner-bound exclusive pages', async t => {
  const f = await fixture(t);
  const own = [await transaction(f, '0.10'), await transaction(f, '0.20')];
  const foreign = await transaction(f, '900.00', f.ownerB);
  const first = await f.get(`${financePath}&limit=1`);
  assert.equal(first.statusCode, 200, first.body);
  const page = first.json();
  contract('FinancialTransactionPage', page);
  assert.equal(page.items.length, 1);
  assert.ok(own.includes(page.items[0].id));
  assert.equal(typeof page.items[0].amount, 'string');
  assert.equal(page.items[0].currencyStatus, 'confirmed');
  assert.ok(page.nextCursor);
  const next = await f.get(`${financePath}&limit=1&cursor=${encodeURIComponent(page.nextCursor)}`);
  assert.equal(next.statusCode, 200, next.body);
  assert.notEqual(next.json().items[0].id, page.items[0].id);
  assert.equal(next.json().nextCursor, null);
  assert.ok(!first.body.includes(foreign) && !next.body.includes(foreign));
  error(await f.get(`${financePath}&limit=1&cursor=${encodeURIComponent(page.nextCursor)}`, f.headersB), 400, 'invalid_request');
  error(await f.get(`${financePath}&limit=101`), 400, 'invalid_request');
  const summary = await f.get('/api/v2/financial/summary?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z');
  assert.equal(summary.statusCode, 200, summary.body);
  contract('FinancialSummary', summary.json());
  const total = summary.json().totals.find((row: any) => row.currency === 'UYU');
  assert.ok(total, summary.body);
  assert.match(total.expense, /^0\.30*$/);
  assert.match(total.net, /^-0\.30*$/);
  assert.equal(total.transactionCount, 2);
  for (const name of ['income', 'expense', 'refunds', 'net']) assert.equal(typeof total[name], 'string');
});

test('v2 API corrections enforce expected version, allowlist, idempotency and broad-rule review', async t => {
  const f = await fixture(t);
  const id = await transaction(f, '10.00');
  const submit = (payload: unknown, headers = f.headersA) => f.app.inject({ method: 'POST', url: '/api/v2/corrections', headers, payload });
  const request = { idempotencyKey: randomUUID(), target: { type: 'transaction', id, expectedVersion: 1 },
    field: 'merchant_label', value: 'Corrected café', scope: 'once', ruleMatch: null };
  error(await submit(request, f.headersB), 404, 'not_found');
  const applied = await submit(request);
  assert.equal(applied.statusCode, 201, applied.body);
  contract('CorrectionResponse', applied.json());
  assert.equal(applied.json().status, 'applied');
  assert.equal(applied.json().affectedCount, 1);
  assert.equal(applied.json().version, 2);
  const replay = await submit(request);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.deepEqual(replay.json(), applied.json());
  error(await submit({ ...request, value: 'Different' }), 409, 'identity_conflict');
  error(await submit({ ...request, idempotencyKey: randomUUID() }), 409);
  error(await submit({ ...request, idempotencyKey: randomUUID(), field: 'owner_id', value: f.ownerB }), 400, 'invalid_request');
  error(await submit({ ...request, idempotencyKey: randomUUID(), field: 'amount', value: 1.5 }), 400, 'invalid_request');
  const list = await f.get(financePath);
  const updated = list.json().items.find((row: any) => row.id === id);
  assert.equal(updated.version, 2);
  assert.ok(JSON.stringify(updated.merchant).includes('Corrected café'));
  const review = await submit({ ...request, idempotencyKey: randomUUID(), target: { ...request.target, expectedVersion: 2 },
    scope: 'rule', ruleMatch: { sourceInstanceId: f.sourceA, exactDescriptor: 'Fixture merchant' } });
  assert.equal(review.statusCode, 201, review.body);
  assert.equal(review.json().status, 'review');
  assert.ok(review.json().reviewReasons.length > 0);
});

test('v2 API policy versions reject stale updates and disabled policy prevents new capture', async t => {
  const f = await fixture(t);
  const request = { expectedVersion: 1, enabled: false, externalModelsAllowed: false,
    externalEmbeddingsAllowed: false, retentionDays: 30 };
  const put = (payload: unknown, headers = f.headersA) => f.app.inject({ method: 'PUT',
    url: `/api/v2/sources/${f.sourceA}/policy`, headers, payload });
  error(await put(request, f.headersB), 404, 'not_found');
  const response = await put(request);
  assert.equal(response.statusCode, 200, response.body);
  contract('PolicyResponse', response.json());
  assert.equal(response.json().policyVersion, 2);
  assert.equal(response.json().enabled, false);
  error(await put(request), 409);
  error(await f.post(envelope(f.sourceA)), 403, 'source_disabled');
  const enabled = await put({ ...request, expectedVersion: 2, enabled: true });
  assert.equal(enabled.statusCode, 200, enabled.body);
  const receipt = await f.capture();
  assert.equal(receipt.policyVersion, enabled.json().policyVersion);
});

test('v2 API export cursors bind owner and filters, preserve snapshots and expire explicitly', async t => {
  const f = await fixture(t);
  const first = await f.capture(), second = await f.capture();
  await f.capture(envelope(f.sourceB, { content: note('Foreign private text') }), f.headersB);
  const initial = await f.get('/api/v2/export?types=observation&limit=1');
  assert.equal(initial.statusCode, 200, initial.body);
  contract('ExportResponse', initial.json());
  const page = initial.json();
  assert.equal(page.items.length, 1);
  assert.ok(page.nextCursor);
  const late = await f.capture();
  const cursor = encodeURIComponent(page.nextCursor);
  error(await f.get(`/api/v2/export?types=observation&limit=1&cursor=${cursor}`, f.headersB), 400, 'invalid_request');
  error(await f.get(`/api/v2/export?types=revision&limit=1&cursor=${cursor}`), 400, 'invalid_request');
  const tampered = `${page.nextCursor[0] === 'A' ? 'B' : 'A'}${page.nextCursor.slice(1)}`;
  error(await f.get(`/api/v2/export?types=observation&cursor=${encodeURIComponent(tampered)}`), 400, 'invalid_request');
  const next = await f.get(`/api/v2/export?types=observation&limit=1&cursor=${cursor}`);
  assert.equal(next.statusCode, 200, next.body);
  assert.equal(next.json().snapshotId, page.snapshotId);
  assert.equal(next.json().nextCursor, null);
  assert.deepEqual(new Set([...page.items, ...next.json().items].map((row: any) => row.id)), new Set([first.observationId, second.observationId]));
  assert.ok(!next.body.includes(late.observationId));
  const audit = await pool.query('select * from v2_export_audit where owner_id=$1 and snapshot_id=$2', [f.ownerA, page.snapshotId]);
  assert.ok(audit.rows.length > 0, 'export is audit logged');
  await pool.query(`update v2_export_snapshots set created_at=now()-interval '2 days', expires_at=now()-interval '1 day' where id=$1`, [page.snapshotId]);
  error(await f.get(`/api/v2/export?types=observation&limit=1&cursor=${cursor}`), 409, 'export_snapshot_expired');
});

test('v2 API grounded queries use only owner evidence and never synthesize without a provider', async t => {
  const f = await fixture(t);
  const keyword = `evidence${randomUUID()}`;
  const own = await f.capture(envelope(f.sourceA, { content: note(`${keyword} owner evidence`) }));
  const foreign = await f.capture(envelope(f.sourceB, { content: note(`${keyword} FOREIGN_SECRET`) }), f.headersB);
  const response = await f.app.inject({ method: 'POST', url: '/api/v2/queries', headers: f.headersA,
    payload: { query: keyword, maxEvidence: 10, externalSynthesisAllowed: false, filters: {} } });
  assert.equal(response.statusCode, 200, response.body);
  const result = response.json();
  contract('QueryResult', result);
  assert.equal(result.modelCalls, 0);
  assert.ok(result.evidence.length > 0, response.body);
  assert.ok(result.evidence.every((item: any) => item.observationId === own.observationId && item.revisionId === own.revisionId));
  assert.ok(!response.body.includes(foreign.observationId) && !response.body.includes('FOREIGN_SECRET'));
  for (const claim of result.claims) {
    assert.ok(claim.citationIds.length > 0);
    assert.ok(claim.citationIds.every((id: string) => result.evidence.some((item: any) => item.id === id)));
  }
  const read = await f.get(`/api/v2/queries/${result.queryId}`);
  assert.equal(read.statusCode, 200, read.body);
  assert.deepEqual(read.json(), result);
  error(await f.get(`/api/v2/queries/${result.queryId}`, f.headersB), 404, 'not_found');
  const empty = await f.app.inject({ method: 'POST', url: '/api/v2/queries', headers: f.headersA,
    payload: { query: randomUUID(), maxEvidence: 10, externalSynthesisAllowed: true, filters: {} } });
  assert.equal(empty.statusCode, 200, empty.body);
  assert.equal(empty.json().modelCalls, 0);
  assert.deepEqual(empty.json().evidence, []);
  assert.deepEqual(empty.json().claims, []);
});

test('v2 API disabled connectors, safe OAuth redirect, empty episodes and excluded deletion creation', async t => {
  const f = await fixture(t);
  const authorize = await f.app.inject({ method: 'POST', url: '/api/v2/connectors/email/authorize', headers: f.headersA,
    payload: { provider: 'gmail', returnRoute: 'brainia://connectors/email/callback', historyDays: 7 } });
  assert.match(error(authorize, 403, 'forbidden').message, /disabled/i);
  assert.match(error(await f.app.inject({ method: 'POST', url: `/api/v2/connectors/${randomUUID()}/revoke`, headers: f.headersA,
    payload: { expectedVersion: 1, deleteCapturedData: false } }), 403, 'forbidden').message, /disabled/i);
  for (const query of ['state=opaque-state&error=provider-secret', 'state=https%3A%2F%2Fevil.example&code=secret-code']) {
    const callback = await f.app.inject({ method: 'GET', url: `/api/v2/connectors/email/callback?${query}` });
    assert.equal(callback.statusCode, 302, callback.body);
    const location = String(callback.headers.location);
    assert.equal(new URL(location).protocol, 'brainia:');
    assert.ok(!/secret|evil\.example|opaque-state|token=/i.test(location), location);
    assert.ok(new URL(location).searchParams.has('error'), location);
  }
  const episodes = await f.get('/api/v2/episodes');
  assert.equal(episodes.statusCode, 200, episodes.body);
  contract('EpisodePage', episodes.json());
  assert.deepEqual(episodes.json(), { items: [], nextCursor: null });
  error(await f.get(`/api/v2/episodes/${randomUUID()}`), 404, 'not_found');
  error(await f.get(`/api/v2/deletions/${randomUUID()}`), 404, 'not_found');
  const deleted = await f.app.inject({ method: 'POST', url: '/api/v2/deletions', headers: f.headersA, payload: {} });
  assert.equal(deleted.statusCode, 404, deleted.body);
});

test('v2 API persisted query results recheck privacy and deletion state', async t => {
  const f = await fixture(t);
  const marker = `privacy${randomUUID()}`;
  const receipt = await f.capture(envelope(f.sourceA, { content: note(`${marker} PRIVATE_BODY`) }));
  const query = await f.app.inject({ method: 'POST', url: '/api/v2/queries', headers: f.headersA,
    payload: { query: marker, maxEvidence: 10, externalSynthesisAllowed: false, filters: {} } });
  assert.equal(query.statusCode, 200, query.body);
  assert.equal(query.json().evidence.length, 1);
  const rawId = (await pool.query('select raw_event_id from v2_observation_revisions where id=$1', [receipt.revisionId])).rows[0].raw_event_id;
  await pool.query("update raw_events set privacy_status='hidden' where id=$1", [rawId]);
  const read = await f.get(`/api/v2/queries/${query.json().queryId}`);
  assert.equal(read.statusCode, 200, read.body);
  contract('QueryResult', read.json());
  assert.deepEqual(read.json().evidence, []);
  assert.ok(!read.body.includes('PRIVATE_BODY'));
  const deletionId = randomUUID();
  await pool.query(`insert into deletion_tombstones(id,owner_id,target_type,target_id,mode)
    values($1,$2,'event',$3,'delete_all')`, [deletionId, f.ownerA, rawId]);
  const state = await f.get(`/api/v2/deletions/${deletionId}`);
  assert.equal(state.statusCode, 200, state.body);
  contract('DeletionState', state.json());
  error(await f.get(`/api/v2/deletions/${deletionId}`, f.headersB), 404, 'not_found');
  error(await f.get(`/api/v2/events/${rawId}`), 404, 'not_found');
});

test('v2 API export snapshot rechecks each older revision privacy before returning source text', async t => {
  const f = await fixture(t);
  const original = envelope(f.sourceA, { content: note('Revision 1 source content') });
  const first = await f.capture(original);
  await f.capture(envelope(f.sourceA, { sourceObservationKey: original.sourceObservationKey,
    producerSequence: '2', changeKind: 'updated', content: note('Revision 2 source content') }));
  const latest = await f.capture(envelope(f.sourceA, { sourceObservationKey: original.sourceObservationKey,
    producerSequence: '3', changeKind: 'updated', content: note('Revision 3 source content') }));
  const response = await f.get('/api/v2/export?types=revision&limit=1');
  assert.equal(response.statusCode, 200, response.body);
  contract('ExportResponse', response.json());
  const snapshot = (await pool.query('select items from v2_export_snapshots where id=$1', [response.json().snapshotId])).rows[0];
  const hidden = snapshot.items.slice(1).find((item: any) => item.id !== latest.revisionId);
  assert.ok(hidden, 'one older revision must remain on a later snapshot page');
  const rawId = (await pool.query('select raw_event_id from v2_observation_revisions where id=$1', [hidden.id])).rows[0].raw_event_id;
  await pool.query("update raw_events set privacy_status='hidden' where id=$1", [rawId]);
  const detail = await f.get(`/api/v2/observations/${first.observationId}`);
  assert.equal(detail.statusCode, 200, detail.body);
  const replay = await f.get(`/api/v2/export?types=revision&limit=100&cursor=${encodeURIComponent(response.json().nextCursor)}`);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.ok(!replay.json().items.some((item: any) => item.id === hidden.id));
  assert.ok(!replay.body.includes(hidden.record.content.body));
  const revisions = await f.get(`/api/v2/observations/${first.observationId}/revisions`);
  assert.ok(!revisions.json().items.some((item: any) => item.revisionId === hidden.id));
});

test('v2 API receipt capture enters the existing classifier and produces owner-scoped finance', async t => {
  const f = await fixture(t);
  const source = randomUUID();
  await pool.query(`insert into v2_source_instances(id,owner_id,content_type,source,enabled)
    values($1,$2,'receipt','capture.wallet',true)`, [source, f.ownerA]);
  const receipt = await f.capture(envelope(source, { content: { type: 'receipt', title: 'Compra Café', body: 'Compra en Café por UYU 10.25',
    raw: { amount: '10.25', currency: 'UYU', merchant: 'Café', transactionType: 'expense' }, merchantText: 'Café', reference: null, attachmentRefs: [] } }));
  const rawId = (await pool.query('select raw_event_id from v2_observation_revisions where id=$1', [receipt.revisionId])).rows[0].raw_event_id;
  const classified = await classifyCapturedEvent(rawId);
  assert.ok(classified, 'classification must consume the captured raw event');
  assert.equal(classified.inferredKind, 'expense');
  const finance = await f.get(financePath);
  assert.equal(finance.statusCode, 200, finance.body);
  contract('FinancialTransactionPage', finance.json());
  const item = finance.json().items.find((item: any) => item.canonicalEventId === rawId);
  assert.ok(item, finance.body);
  assert.equal(typeof item.amount, 'string');
  assert.equal(Number(item.amount), 10.25);
  const foreign = await f.get(financePath, f.headersB);
  assert.equal(foreign.statusCode, 200, foreign.body);
  assert.deepEqual(foreign.json().items, []);
});

test('v2 API capture, policy, queries and exports work with restricted-role owner RLS enforced', async t => {
  const f = await fixture(t);
  const previous = process.env.BRAINIA_DB_ENFORCE_RLS;
  process.env.BRAINIA_DB_ENFORCE_RLS = 'true';
  try {
    const receipt = await f.capture(envelope(f.sourceA));
    const observation = await f.get(`/api/v2/observations/${receipt.observationId}`);
    assert.equal(observation.statusCode, 200, observation.body);
    error(await f.get(`/api/v2/observations/${receipt.observationId}`, f.headersB), 404);
    const query = await f.app.inject({ method: 'POST', url: '/api/v2/queries', headers: f.headersA,
      payload: { query: 'café', maxEvidence: 10, externalSynthesisAllowed: false, filters: {} } });
    assert.equal(query.statusCode, 200, query.body);
    const exported = await f.get('/api/v2/export?types=revision');
    assert.equal(exported.statusCode, 200, exported.body);
    contract('ExportResponse', exported.json());
    const policy = await f.app.inject({ method: 'PUT', url: `/api/v2/sources/${f.sourceA}/policy`, headers: f.headersA,
      payload: { expectedVersion: 1, enabled: false, externalModelsAllowed: false, externalEmbeddingsAllowed: false, retentionDays: 30 } });
    assert.equal(policy.statusCode, 200, policy.body);
    assert.equal(policy.json().cancelledPendingWorkCount, 1);
  } finally {
    if (previous === undefined) delete process.env.BRAINIA_DB_ENFORCE_RLS;
    else process.env.BRAINIA_DB_ENFORCE_RLS = previous;
  }
});

test('v2 API financial corrections govern decimal aggregation and currency/time filters', async t => {
  const f = await fixture(t);
  const id = await transaction(f, '10.00');
  let version = 1;
  for (const [field,value] of [['amount','0.123456'],['currency','USD'],['occurred_at','2026-12-01T00:00:00Z']]) {
    const response = await f.app.inject({ method:'POST',url:'/api/v2/corrections',headers:f.headersA,
      payload:{idempotencyKey:randomUUID(),target:{type:'transaction',id,expectedVersion:version},field,value,scope:'once',ruleMatch:null} });
    assert.equal(response.statusCode,201,response.body);
    version = response.json().version;
  }
  const oldWindow = await f.get(financePath);
  assert.deepEqual(oldWindow.json().items,[]);
  const list = await f.get('/api/v2/financial/transactions?from=2026-12-01T00:00:00Z&to=2026-12-02T00:00:00Z&currency=USD');
  assert.equal(list.statusCode,200,list.body);
  assert.equal(list.json().items[0].amount,'0.123456');
  assert.equal(list.json().items[0].currency,'USD');
  contract('FinancialTransactionPage',list.json());
  const summary = await f.get('/api/v2/financial/summary?from=2026-12-01T00:00:00Z&to=2026-12-02T00:00:00Z');
  assert.equal(summary.statusCode,200,summary.body);
  assert.equal(summary.json().totals[0].expense,'0.123456');
  contract('FinancialSummary',summary.json());
});

test('v2 API legacy backfill is idempotent, preserves Unicode/raw/times and exposes one imported revision', async t => {
  const f = await fixture(t);
  const rawId = `legacy-${randomUUID()}`;
  await pool.query(`insert into raw_events(id,owner_id,client_id,source,kind,title,body,timestamp,raw,tags,dedupe_key)
    values($1,$2,$2,'capture.note','note','Reunión','Café — 東京',$3,$4::jsonb,'{}',$1)`,
    [rawId,f.ownerA,timestamp,JSON.stringify({legacyOnly:'áé🙂',nested:{preserved:true}})]);
  const migration = readFileSync(new URL('../migrations/20261019120000_v2_api.sql',import.meta.url),'utf8');
  const backfill = [...migration.matchAll(/insert into v2_(?:observations|observation_revisions) \([\s\S]*?on conflict do nothing;/g)].map(match=>match[0]);
  assert.equal(backfill.length,2);
  for(let replay=0;replay<2;replay++) for(const statement of backfill) await pool.query(statement);
  const imported = (await pool.query(`select rev.*,rev.legacy_payload=to_jsonb(r) as preserved
    from v2_observation_revisions rev join raw_events r on r.id=rev.raw_event_id where r.id=$1`,[rawId])).rows;
  assert.equal(imported.length,1);
  assert.equal(imported[0].preserved,true);
  assert.equal(imported[0].producer_revision_id,null,'historical producer metadata must remain absent');
  assert.equal(new Date(imported[0].source_occurred_at).toISOString(),timestamp);
  const response = await f.get(`/api/v2/observations/${encodeURIComponent(imported[0].observation_id)}/revisions`);
  assert.equal(response.statusCode,200,response.body);
  contract('ObservationRevisionPage',response.json());
  assert.equal(response.json().items[0].changeKind,'imported');
  assert.equal(response.json().items[0].content.body,'Café — 東京');
  await assert.rejects(pool.query('update v2_observation_revisions set content=$2 where id=$1',[imported[0].id,'{}']),/v2_revision_immutable/);
});

test('v2 API approved FX and quarantine are enforced under the restricted runtime role', async t => {
  const f = await fixture(t);
  const id = await transaction(f,'1.25');
  const rateId = randomUUID();
  await pool.query(`insert into fx_rates(id,base_currency,quote_currency,rate,as_of,provider,approved,approved_by)
    values($1,'UYU','USD','0.025',$2,'isolated-fixture',true,'test')`,[rateId,timestamp]);
  const previous = process.env.BRAINIA_DB_ENFORCE_RLS;
  process.env.BRAINIA_DB_ENFORCE_RLS='true';
  try {
    const summary = await f.get(`/api/v2/financial/summary?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z&conversionTo=USD&fxRateId=${rateId}`);
    assert.equal(summary.statusCode,200,summary.body);
    contract('FinancialSummary',summary.json());
    assert.equal(summary.json().conversion.amount,'-0.031250');
    await pool.query(`insert into owner_quarantine(id,table_name,row_id,reason) values($1,'financial_transactions',$2,'isolated test')`,[randomUUID(),id]);
    const page=await f.get(financePath);
    assert.equal(page.statusCode,200,page.body);
    assert.deepEqual(page.json().items,[]);
  } finally {
    if(previous===undefined) delete process.env.BRAINIA_DB_ENFORCE_RLS;
    else process.env.BRAINIA_DB_ENFORCE_RLS=previous;
  }
});

test('v2 API missing, unsupported and empty request media types are non-retryable invalid requests', async t => {
  const f = await fixture(t);
  const body = JSON.stringify(envelope(f.sourceA));
  const routes = [
    ['POST', '/api/v2/observations'], ['POST', '/api/v2/observations/batch'], ['POST', '/api/v2/corrections'],
    ['POST', '/api/v2/queries'], ['PUT', `/api/v2/sources/${f.sourceA}/policy`],
  ] as const;
  for (const [method, url] of routes) {
    for (const [label, headers, payload] of [
      ['missing content type', { ...f.headersA }, body],
      ['application/xml', { ...f.headersA, 'content-type': 'application/xml' }, '<observation/>'],
      ['empty JSON body', { ...f.headersA, 'content-type': 'application/json' }, ''],
    ] as const) {
      const response = await f.app.inject({ method, url, headers, payload });
      const failure = error(response, 400, 'invalid_request');
      assert.equal(failure.retryable, false, `${method} ${url} ${label}`);
      assert.equal(response.headers['retry-after'], undefined, `${method} ${url} ${label}`);
    }
  }
  const stored = await pool.query('select count(*)::int as count from v2_observations where owner_id=$1', [f.ownerA]);
  assert.equal(stored.rows[0].count, 0);
});
