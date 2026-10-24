import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { buildApp } from '../src/app.ts';
import type { AuthConfig } from '../src/auth.ts';
import { pool } from '../src/storage/postgres.ts';
import { decodeEventHistoryCursor, eventHistoryFilters, eventHistoryQuerySchema } from '../src/domain/event-history.ts';

const auth: AuthConfig = { globalApiKey: null, clientKeys: new Map([['hist-a', 'key-a'], ['hist-b', 'key-b']]) };
const headersA = { 'x-brainia-client-id': 'hist-a', 'x-brainia-api-key': 'key-a' };
const headersB = { 'x-brainia-client-id': 'hist-b', 'x-brainia-api-key': 'key-b' };

type Seed = { id: string; source: string; status: string; occurred: string | null; ingested: string; category?: string };

async function seed(owner: string, row: Omit<Seed, 'id'> & { id?: string }) {
  const id = row.id ?? randomUUID();
  await pool.query(
    `insert into raw_events (id, source, contract_version, client_id, owner_id, dedupe_key, kind, title, body, timestamp, raw, tags, processing_status, created_at)
     values ($1,$2,1,$3,$3,$4,'note',$5,$6,$7,$8::jsonb,'{}'::text[],$9,$10)`,
    [id, row.source, owner, `${owner}:${id}`, `Title ${id}`, 'x'.repeat(2000), row.occurred, JSON.stringify({ big: 'payload' }), row.status, row.ingested],
  );
  if (row.category) {
    await pool.query(
      `insert into semantic_event_decisions (event_id, status, primary_category_key) values ($1, 'resolved', $2)`,
      [id, row.category],
    );
  }
  return id;
}

async function pageAll(app: Awaited<ReturnType<typeof buildApp>>, headers: Record<string, string>, query: string) {
  const ids: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const url: string = `/api/v1/events?${query}${cursor ? `&cursor=${cursor}` : ''}`;
    const response = await app.inject({ method: 'GET', url, headers });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json() as { items: { id: string }[]; page: { hasMore: boolean; nextCursor: string | null } };
    ids.push(...body.items.map((item) => item.id));
    cursor = body.page.nextCursor;
    assert.equal(body.page.hasMore, cursor !== null);
    assert.ok(++pages < 50, 'pagination did not terminate');
  } while (cursor);
  return ids;
}

test('event history pages a stable dataset without duplicates or gaps, including timestamp ties', async () => {
  const app = await buildApp({ authConfig: auth });
  try {
    const tie = '2026-03-01T10:00:00.000Z';
    const expected: string[] = [];
    for (let i = 0; i < 17; i += 1) {
      // 12 rows share one timestamp so only the id tie-breaker separates them.
      const occurred = i < 12 ? tie : `2026-03-01T10:${String(i).padStart(2, '0')}:00.000Z`;
      expected.push(await seed('hist-a', { source: 'tie.src', status: 'captured', occurred, ingested: '2026-03-02T00:00:00Z' }));
    }
    const desc = await pageAll(app, headersA, 'source=tie.src&limit=5');
    assert.equal(desc.length, 17);
    assert.equal(new Set(desc).size, 17, 'no duplicates');
    assert.deepEqual([...desc].sort(), [...expected].sort(), 'no missing entries');

    const asc = await pageAll(app, headersA, 'source=tie.src&limit=4&order=asc');
    assert.deepEqual(asc, [...desc].reverse(), 'asc is the exact reverse of desc');

    const single = await pageAll(app, headersA, 'source=tie.src&limit=1');
    assert.deepEqual(single, desc, 'page size does not change ordering');
  } finally { await app.close(); }
});

test('event history cursor keeps microsecond precision of the sort key', async () => {
  const app = await buildApp({ authConfig: auth });
  try {
    const ids: string[] = [];
    for (const micros of ['100001', '100002', '100003']) {
      ids.push(await seed('hist-a', { source: 'micro.src', status: 'captured', occurred: `2026-04-01T00:00:00.${micros}Z`, ingested: '2026-04-02T00:00:00Z' }));
    }
    const paged = await pageAll(app, headersA, 'source=micro.src&limit=1');
    assert.deepEqual(paged, [...ids].reverse());
  } finally { await app.close(); }
});

test('event history filters compose and the date field is explicit', async () => {
  const app = await buildApp({ authConfig: auth });
  try {
    const hit = await seed('hist-a', { source: 'f.mail', status: 'classified', occurred: '2026-05-10T12:00:00Z', ingested: '2026-06-01T00:00:00Z', category: 'finance' });
    await seed('hist-a', { source: 'f.mail', status: 'classified', occurred: '2026-05-10T12:00:00Z', ingested: '2026-06-01T00:00:00Z', category: 'health' });
    await seed('hist-a', { source: 'f.other', status: 'classified', occurred: '2026-05-10T12:00:00Z', ingested: '2026-06-01T00:00:00Z', category: 'finance' });
    await seed('hist-a', { source: 'f.mail', status: 'review', occurred: '2026-05-10T12:00:00Z', ingested: '2026-06-01T00:00:00Z', category: 'finance' });
    await seed('hist-a', { source: 'f.mail', status: 'classified', occurred: '2026-01-10T12:00:00Z', ingested: '2026-06-01T00:00:00Z', category: 'finance' });

    const combined = 'source=f.mail&category=finance&status=classified&from=2026-05-01T00:00:00Z&to=2026-06-01T00:00:00Z';
    assert.deepEqual(await pageAll(app, headersA, combined), [hit]);

    // Same window by ingestion time: the January-occurred row matches, the May rows do not.
    const ingestedWindow = await app.inject({
      method: 'GET',
      url: '/api/v1/events?source=f.mail&category=finance&status=classified&dateField=ingestedAt&from=2026-05-30T00:00:00Z&to=2026-06-02T00:00:00Z',
      headers: headersA,
    });
    assert.equal((ingestedWindow.json() as { items: unknown[] }).items.length, 2);
    const occurredWindow = await app.inject({
      method: 'GET',
      url: '/api/v1/events?source=f.mail&category=finance&status=classified&from=2026-05-30T00:00:00Z&to=2026-06-02T00:00:00Z',
      headers: headersA,
    });
    assert.equal((occurredWindow.json() as { items: unknown[] }).items.length, 0);

    // `to` is exclusive, `from` inclusive.
    const edge = await app.inject({ method: 'GET', url: '/api/v1/events?source=f.mail&category=finance&status=classified&from=2026-05-10T12:00:00Z&to=2026-05-10T12:00:00.001Z', headers: headersA });
    assert.deepEqual((edge.json() as { items: { id: string }[] }).items.map((item) => item.id), [hit]);

    // Multi-value filters.
    const multi = await pageAll(app, headersA, 'source=f.mail,f.other&status=classified,review&category=finance&from=2026-05-01T00:00:00Z');
    assert.equal(multi.length, 3);
  } finally { await app.close(); }
});

test('event history list entries are summaries without detail data', async () => {
  const app = await buildApp({ authConfig: auth });
  try {
    await seed('hist-a', { source: 'sum.src', status: 'captured', occurred: '2026-07-01T00:00:00Z', ingested: '2026-07-01T00:00:00Z' });
    const response = await app.inject({ method: 'GET', url: '/api/v1/events?source=sum.src', headers: headersA });
    const body = response.json() as { items: Record<string, unknown>[]; query: Record<string, unknown> };
    assert.equal(body.items.length, 1);
    for (const forbidden of ['raw', 'body', 'entities', 'relations', 'classifiedEntities', 'facets', 'tags']) {
      assert.equal(forbidden in body.items[0], false, `${forbidden} must not be in list entries`);
    }
    assert.equal((body.items[0].bodyPreview as string).length, 200, 'body is truncated to a preview');
    assert.equal(body.items[0].occurredAt, '2026-07-01T00:00:00.000Z');
    assert.equal(body.query.dateField, 'occurredAt');
  } finally { await app.close(); }
});

test('event history rejects invalid queries and cursors', async () => {
  const app = await buildApp({ authConfig: auth });
  try {
    for (const query of [
      'limit=0', 'limit=101', 'limit=abc', 'status=bogus', 'from=yesterday', 'from=2026-05-01', 'dateField=updatedAt',
      'order=sideways', 'unknown=1', 'from=2026-06-01T00:00:00Z&to=2026-05-01T00:00:00Z', 'source=',
    ]) {
      const response = await app.inject({ method: 'GET', url: `/api/v1/events?${query}`, headers: headersA });
      assert.equal(response.statusCode, 400, `${query} -> ${response.statusCode}`);
      assert.equal((response.json() as { error: string }).error, 'invalid_event_query');
    }

    await seed('hist-a', { source: 'cur.src', status: 'captured', occurred: '2026-08-01T00:00:00Z', ingested: '2026-08-01T00:00:00Z' });
    await seed('hist-a', { source: 'cur.src', status: 'captured', occurred: '2026-08-02T00:00:00Z', ingested: '2026-08-02T00:00:00Z' });
    const first = await app.inject({ method: 'GET', url: '/api/v1/events?source=cur.src&limit=1', headers: headersA });
    const cursor = (first.json() as { page: { nextCursor: string } }).page.nextCursor;
    assert.ok(cursor);

    const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(cursor, 'base64url').toString()), k: "x'; drop table raw_events;--" })).toString('base64url');
    const badCursors = [
      'not-a-cursor', '%%%', Buffer.from('{}').toString('base64url'), Buffer.from('plain text').toString('base64url'),
      tampered, cursor + 'A'.repeat(600),
    ];
    for (const bad of badCursors) {
      const response = await app.inject({ method: 'GET', url: `/api/v1/events?source=cur.src&limit=1&cursor=${encodeURIComponent(bad)}`, headers: headersA });
      assert.equal(response.statusCode, 400, `cursor ${bad.slice(0, 20)}`);
      assert.equal((response.json() as { error: string }).error, 'invalid_cursor');
    }

    // A cursor is bound to its filters and ordering.
    for (const other of ['source=cur.src&limit=1&order=asc', 'source=other&limit=1', 'source=cur.src&limit=1&dateField=ingestedAt', 'source=cur.src&limit=1&status=review']) {
      const response = await app.inject({ method: 'GET', url: `/api/v1/events?${other}&cursor=${cursor}`, headers: headersA });
      assert.equal(response.statusCode, 400, other);
      assert.equal((response.json() as { error: string }).error, 'invalid_cursor');
    }
    // ...but not to the page size.
    const resized = await app.inject({ method: 'GET', url: `/api/v1/events?source=cur.src&limit=10&cursor=${cursor}`, headers: headersA });
    assert.equal(resized.statusCode, 200);
  } finally { await app.close(); }
});

test('event history enforces owner isolation for rows and cursors', async () => {
  const app = await buildApp({ authConfig: auth });
  try {
    const mine = [] as string[];
    for (let i = 0; i < 3; i += 1) {
      mine.push(await seed('hist-a', { source: 'iso.src', status: 'captured', occurred: `2026-09-0${i + 1}T00:00:00Z`, ingested: '2026-09-10T00:00:00Z' }));
    }
    const theirs = await seed('hist-b', { source: 'iso.src', status: 'captured', occurred: '2026-09-02T12:00:00Z', ingested: '2026-09-10T00:00:00Z' });

    const a = await pageAll(app, headersA, 'source=iso.src&limit=2');
    assert.deepEqual([...a].sort(), [...mine].sort());
    assert.equal(a.includes(theirs), false);
    assert.deepEqual(await pageAll(app, headersB, 'source=iso.src&limit=2'), [theirs]);

    // Owner A's cursor is rejected for owner B, even with identical filters.
    const first = await app.inject({ method: 'GET', url: '/api/v1/events?source=iso.src&limit=1', headers: headersA });
    const cursor = (first.json() as { page: { nextCursor: string } }).page.nextCursor;
    const replay = await app.inject({ method: 'GET', url: `/api/v1/events?source=iso.src&limit=1&cursor=${cursor}`, headers: headersB });
    assert.equal(replay.statusCode, 400);
    assert.equal((replay.json() as { error: string }).error, 'invalid_cursor');

    // Unauthenticated callers never reach the query.
    const anon = await app.inject({ method: 'GET', url: '/api/v1/events?limit=5' });
    assert.ok([401, 403].includes(anon.statusCode), `anon -> ${anon.statusCode}`);
  } finally { await app.close(); }
});

test('GET /events without query params keeps the legacy full-record array', async () => {
  const app = await buildApp({ authConfig: auth });
  try {
    const id = await seed('hist-a', { source: 'legacy.src', status: 'captured', occurred: '2026-10-01T00:00:00Z', ingested: '2026-10-01T00:00:00Z' });
    const response = await app.inject({ method: 'GET', url: '/api/v1/events', headers: headersA });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers.deprecation, 'true');
    const body = response.json() as Record<string, unknown>[];
    assert.ok(Array.isArray(body));
    const record = body.find((event) => event.id === id);
    assert.ok(record);
    for (const field of ['raw', 'body', 'entities', 'relations', 'processingStatus']) assert.ok(field in record, field);
    // Detail endpoint is the documented way to hydrate a summary.
    const detail = await app.inject({ method: 'GET', url: `/api/v1/events/${id}`, headers: headersA });
    assert.equal(detail.statusCode, 200);
  } finally { await app.close(); }
});

test('cursor codec rejects replay across owners and filters at the domain level', () => {
  const filters = eventHistoryFilters(eventHistoryQuerySchema.parse({ source: 'b,a,a' }));
  assert.deepEqual(filters.source, ['a', 'b'], 'list filters are normalized so equivalent requests share cursors');
  assert.throws(() => decodeEventHistoryCursor('???', 'x', filters));
});
