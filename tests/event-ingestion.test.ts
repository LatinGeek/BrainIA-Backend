import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { buildApp } from '../src/app.ts';
import { pool, withTransaction } from '../src/storage/postgres.ts';
import { eventSchema } from '../src/domain/event.ts';
import { captureContent, captureDedupeKey } from '../src/domain/event-ingestion.ts';
import { insertRawEvent } from '../src/storage/event-repository.ts';

const authConfig = { globalApiKey: null, clientKeys: new Map([['owner-a', 'key-a'], ['owner-b', 'key-b']]) };
const headers = (owner = 'a') => ({ 'x-brainia-client-id': `owner-${owner}`, 'x-brainia-api-key': `key-${owner}` });
const event = () => eventSchema.parse({ id: randomUUID(), source: `retry-${randomUUID()}`, kind: 'note',
  title: 'Original evidence', body: 'Captured body', externalId: randomUUID(), idempotencyKey: randomUUID(),
  timestamp: '2026-10-20T12:00:00Z', raw: { nested: { a: 1, b: 2 } }, tags: ['a', 'b'] });

test('meaningful comparison is stable for nested JSON objects, defaults and instants', () => {
  const original = event();
  assert.equal(captureContent(original), captureContent({ ...original, raw: { nested: { b: 2, a: 1 } }, timestamp: '2026-10-20T12:00:00.000Z' }));
  assert.notEqual(captureContent(original), captureContent({ ...original, tags: ['b', 'a'] }));
  for (const field of ['kind', 'title', 'body', 'timestamp', 'raw', 'tags', 'contractVersion', 'externalId', 'idempotencyKey'] as const) {
    const changed = { ...original, [field]: field === 'timestamp' ? '2026-10-21T00:00:00Z' : null };
    assert.notEqual(captureContent(original), captureContent(changed as any), field);
  }
  assert.notEqual(captureDedupeKey(original, null), captureDedupeKey(original, 'anonymous'));
  assert.notEqual(captureDedupeKey({ ...original, source: 'a:b' }, 'c'), captureDedupeKey({ ...original, source: 'b' }, 'c:a'));
});

test('POST /events distinguishes creation, retries and conflicts without extra jobs or evidence writes', async () => {
  const app = await buildApp({ authConfig });
  const original = event();
  const post = (payload: unknown, owner = 'a') => app.inject({ method: 'POST', url: '/api/v1/events', headers: headers(owner), payload });
  try {
    const created = await post(original);
    assert.equal(created.statusCode, 201, created.body);
    assert.deepEqual(created.json().ingestion, { outcome: 'created', duplicate: false });
    const snapshot = await pool.query('select * from raw_events where id=$1', [original.id]);
    const jobs = await pool.query('select * from background_jobs where event_id=$1', [original.id]);
    for (const retry of [original, { ...original, id: randomUUID(), raw: { nested: { b: 2, a: 1 } } }]) {
      const duplicate = await post(retry);
      assert.equal(duplicate.statusCode, 200, duplicate.body);
      assert.equal(duplicate.json().id, original.id);
      assert.deepEqual(duplicate.json().ingestion, { outcome: 'duplicate', duplicate: true });
    }
    for (const conflict of [
      { ...original, title: 'Altered evidence' },
      { ...original, id: randomUUID(), idempotencyKey: randomUUID() }, // external ID still collides
      { ...original, id: randomUUID(), externalId: randomUUID() }, // idempotency key still collides
      { ...original, id: randomUUID(), contractVersion: 2 },
      { ...original, source: 'another-source' },
    ]) {
      const response = await post(conflict);
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(response.json().error, 'event_identity_conflict');
      assert.equal(response.body.includes(original.title!), false);
    }
    const foreign = await post(original, 'b');
    assert.equal(foreign.statusCode, 409, foreign.body);
    assert.equal(foreign.body.includes(original.id), false);
    assert.deepEqual((await pool.query('select * from raw_events where id=$1', [original.id])).rows, snapshot.rows);
    assert.deepEqual((await pool.query('select * from background_jobs where event_id=$1', [original.id])).rows, jobs.rows);
    // Same external/key values are independent across owners and sources.
    assert.equal((await post({ ...original, id: randomUUID() }, 'b')).statusCode, 201);
    assert.equal((await post({ ...original, id: randomUUID(), source: 'other-source' })).statusCode, 201);
    const second = event();
    assert.equal((await post({ ...second, source: original.source })).statusCode, 201);
    const ambiguous = await post({ ...original, id: second.id });
    assert.equal(ambiguous.statusCode, 409);
    const idOnly = eventSchema.parse({ id: randomUUID(), source: original.source, raw: {} });
    assert.equal((await post(idOnly)).statusCode, 201);
    assert.equal((await post(idOnly)).statusCode, 200);
    assert.equal((await post({ ...idOnly, body: 'new content' })).statusCode, 409);
    // Legacy keys are resolved using stored identity columns, never their old encoding.
    const legacy = event();
    await pool.query(`insert into raw_events(id,source,contract_version,client_id,idempotency_key,dedupe_key,kind,title,body,timestamp,external_id,raw,tags)
      values($1,$2,1,'owner-a',$3,'legacy-colon-key',$4,$5,$6,$7,$8,$9::jsonb,$10::text[])`,
      [legacy.id, legacy.source, legacy.idempotencyKey, legacy.kind, legacy.title, legacy.body, legacy.timestamp, legacy.externalId, JSON.stringify(legacy.raw), legacy.tags]);
    assert.equal((await post({ ...legacy, id: randomUUID() })).statusCode, 200);
    assert.equal((await post({ ...legacy, contractVersion: 2 })).statusCode, 409);

  } finally { await app.close(); }
});

// Run this file against a disposable PostgreSQL database (without pglite-setup)
// for real multi-connection concurrency; PGlite has one connection and cannot
// model competing transactions or advisory lock waits.
test('concurrent identity overlap admits one insert and no changed-content retry', {
  skip: process.env.BRAINIA_TEST_POSTGRES_CONCURRENCY !== 'true' || process.env.DATABASE_URL?.includes('isolated-test.invalid') ? 'requires explicit opt-in and disposable PostgreSQL database' : false,
}, async () => {
  const original = event();
  const submit = (input: typeof original) => withTransaction(db => insertRawEvent(db, input, 'owner-a', captureDedupeKey(input, 'owner-a')));
  try {
    const identical = await Promise.all(Array.from({ length: 8 }, () => submit({ ...original, id: randomUUID() })));
    assert.equal(identical.filter(Boolean).length, 1);
    const changed = await Promise.allSettled(Array.from({ length: 4 }, () => submit({ ...original, id: randomUUID(), title: 'Changed' })));
    assert.ok(changed.every(result => result.status === 'rejected' && result.reason.code === 'event_identity_conflict'));
    // Different preferred keys still compete on their shared external identity.
    const externalRace = { ...event(), source: original.source };
    const collisions = await Promise.allSettled(Array.from({ length: 8 }, () => submit({
      ...externalRace, id: randomUUID(), idempotencyKey: randomUUID(),
    })));
    assert.equal(collisions.filter(result => result.status === 'fulfilled' && result.value).length, 1);
    assert.equal(collisions.filter(result => result.status === 'rejected' && result.reason.code === 'event_identity_conflict').length, 7);
    const globalId = { ...event(), source: original.source };
    const owners = await Promise.allSettled(['owner-a', 'owner-b'].map(owner => withTransaction(db =>
      insertRawEvent(db, globalId, owner, captureDedupeKey(globalId, owner)))));
    assert.equal(owners.filter(result => result.status === 'fulfilled' && result.value).length, 1);
    assert.equal(owners.filter(result => result.status === 'rejected' && result.reason.code === 'event_identity_conflict').length, 1);

  } finally {
    await pool.query('delete from raw_events where source=$1', [original.source]);
  }
});
