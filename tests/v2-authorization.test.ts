import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { buildApp } from '../src/app.ts';
import type { AuthConfig } from '../src/auth.ts';
import { pool, withOwnerTransaction } from '../src/storage/postgres.ts';
import { insertRawEvent } from '../src/storage/event-repository.ts';

const clientAuth: AuthConfig = { globalApiKey: null, clientKeys: new Map([['owner-a', 'key-a'], ['owner-b', 'key-b']]) };
const headersA = { 'x-brainia-client-id': 'owner-a', 'x-brainia-api-key': 'key-a' };
const headersB = { 'x-brainia-client-id': 'owner-b', 'x-brainia-api-key': 'key-b' };

async function captured(clientId: string, merchant: string) {
  const event = { id: randomUUID(), source: 'capture.wallet', contractVersion: 1 as const, kind: 'expense' as const,
    title: merchant, body: `Compra ${merchant}`, timestamp: '2026-10-17T12:00:00Z',
    raw: { amount: 10, currency: 'UYU', merchant }, tags: [] };
  await insertRawEvent(pool, event, clientId, `${clientId}:${event.id}`);
  await pool.query(`update raw_events set owner_id = $2 where id = $1`, [event.id, clientId]);
  return event.id;
}

test('B06 authentication fails closed when required and unconfigured', async () => {
  const previous = process.env.BRAINIA_REQUIRE_AUTH;
  process.env.BRAINIA_REQUIRE_AUTH = 'true';
  const app = await buildApp({ authConfig: { globalApiKey: null, clientKeys: new Map() } });
  try {
    const response = await app.inject({ method: 'GET', url: '/api/v1/events' });
    assert.equal(response.statusCode, 503);
    assert.equal((response.json() as { error: string }).error, 'auth_not_configured');
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.BRAINIA_REQUIRE_AUTH; else process.env.BRAINIA_REQUIRE_AUTH = previous;
  }
});

test('B06 rejects spoofed owner headers and ownerless global access', async () => {
  const app = await buildApp({ authConfig: clientAuth });
  try {
    const spoofed = await app.inject({ method: 'GET', url: '/api/v1/events', headers: { ...headersA, 'x-brainia-owner-id': 'owner-b' } });
    assert.equal(spoofed.statusCode, 403);
    assert.equal((spoofed.json() as { error: string }).error, 'owner_header_not_accepted');
  } finally { await app.close(); }

  const globalApp = await buildApp({ authConfig: { globalApiKey: 'global-secret', clientKeys: new Map() } });
  try {
    const response = await globalApp.inject({ method: 'GET', url: '/api/v1/events', headers: { 'x-brainia-api-key': 'global-secret' } });
    assert.equal(response.statusCode, 403);
    assert.equal((response.json() as { error: string }).error, 'owner_scope_required');
  } finally { await globalApp.close(); }
});

test('B06 two-owner matrix scopes events, search, and financial reads', async () => {
  const merchantA = `Alpha ${randomUUID()}`, merchantB = `Beta ${randomUUID()}`;
  const eventA = await captured('owner-a', merchantA);
  const eventB = await captured('owner-b', merchantB);
  const txnA = randomUUID(), txnB = randomUUID();
  for (const [txn, event] of [[txnA, eventA], [txnB, eventB]] as const) {
    await pool.query(`insert into financial_transactions(id,kind,amount,currency,merchant_label,normalized_merchant,
      observed_at,window_start,window_end,evidence_count,match_score,match_strategy,primary_source)
      values($1,'expense',10,'UYU','owner fixture','owner fixture',now(),now(),now(),1,1,'test','test')`, [txn]);
    await pool.query(`insert into financial_transaction_events(id,transaction_id,raw_event_id,source,kind,amount,currency,
      merchant_label,normalized_merchant,observed_at,match_score,match_reason)
      values($1,$2,$3,'capture.wallet','expense',10,'UYU','owner fixture','owner fixture',now(),1,'test')`,
      [randomUUID(), txn, event]);
  }

  const app = await buildApp({ authConfig: clientAuth });
  try {
    const listA = await app.inject({ method: 'GET', url: '/api/v1/events', headers: headersA });
    assert.equal(listA.statusCode, 200);
    const idsA = (listA.json() as Array<{ id: string }>).map((event) => event.id);
    assert.ok(idsA.includes(eventA));
    assert.ok(!idsA.includes(eventB));

    const ownA = await app.inject({ method: 'GET', url: `/api/v1/events/${eventA}`, headers: headersA });
    assert.equal(ownA.statusCode, 200);
    const foreignB = await app.inject({ method: 'GET', url: `/api/v1/events/${eventB}`, headers: headersA });
    assert.equal(foreignB.statusCode, 404);

    const searchA = await app.inject({ method: 'GET', url: `/api/v1/search?q=${encodeURIComponent(merchantB)}`, headers: headersA });
    assert.equal(searchA.statusCode, 200);
    assert.deepEqual((searchA.json() as { events: unknown[] }).events, []);

    const financeA = await app.inject({ method: 'GET', url: '/api/v1/financial/transactions?limit=50', headers: headersA });
    assert.equal(financeA.statusCode, 200);
    const financeIds = (financeA.json() as { items: Array<{ id: string }> }).items.map((item) => item.id);
    assert.ok(financeIds.includes(txnA));
    assert.ok(!financeIds.includes(txnB));

    const foreignTxn = await app.inject({ method: 'GET', url: `/api/v1/financial/transactions/${txnB}`, headers: headersA });
    assert.equal(foreignTxn.statusCode, 404);
  } finally { await app.close(); }
});

test('B06/N1 digest generation only summarizes caller-owned evidence', async () => {
  const markerA = `DigestAlpha ${randomUUID()}`, markerB = `DigestBravo ${randomUUID()}`;
  await captured('owner-a', markerA);
  await captured('owner-b', markerB);
  const insightA = `insight_a_${randomUUID()}`, insightB = `insight_b_${randomUUID()}`;
  await pool.query(
    `insert into insight_runs(id,tool_name,query,request,response,summary,owner_id,created_at)
     values($1,'test',$2,'{}','{}',$3,'owner-a','2026-10-17T12:00:00Z'),
           ($4,'test',$5,'{}','{}',$6,'owner-b','2026-10-17T12:00:00Z')`,
    [insightA, `Query ${markerA}`, `Summary ${markerA}`, insightB, `Query ${markerB}`, `Summary ${markerB}`],
  );

  const app = await buildApp({ authConfig: clientAuth });
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/digests?from=2026-10-01T00:00:00.000Z&to=2026-10-31T23:59:59.000Z',
      headers: headersA,
    });
    assert.equal(response.statusCode, 200);
    const body = response.body;
    assert.ok(body.includes(markerA));
    assert.ok(!body.includes(markerB));
    assert.ok(!body.includes(insightB));
  } finally { await app.close(); }
});

test('B06/N2 insight query resolution cannot match a foreign entity', async () => {
  const markerB = `BravoQueryEntity ${randomUUID()}`;
  const entityB = `entity_b_${randomUUID()}`;
  await pool.query(
    `insert into entities(id,type,value,normalized_value,owner_id) values($1,'merchant',$2,$3,'owner-b')`,
    [entityB, markerB, markerB.toLowerCase()],
  );

  const app = await buildApp({ authConfig: clientAuth });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/insights?q=${encodeURIComponent(markerB)}&depth=1&maxNodes=10&maxRelations=10`,
      headers: headersA,
    });
    assert.equal(response.statusCode, 200);
    const payload = response.json() as {
      resolution: { matchedEntityId: string | null; canonicalEntityId: string | null };
      supportingEntities: Array<{ id: string }>;
    };
    assert.equal(payload.resolution.matchedEntityId, null);
    assert.equal(payload.resolution.canonicalEntityId, null);
    assert.deepEqual(payload.supportingEntities, []);
    assert.ok(!response.body.includes(entityB));
  } finally { await app.close(); }
});

test('B06/N3 knowledge feedback cannot mutate foreign entities or insights', async () => {
  const entityB = `entity_b_${randomUUID()}`;
  const insightB = `insight_b_${randomUUID()}`;
  await pool.query(
    `insert into entities(id,type,value,normalized_value,owner_id) values($1,'merchant','Owned by B',$2,'owner-b')`,
    [entityB, `owned by b ${entityB}`],
  );
  await pool.query(
    `insert into insight_runs(id,tool_name,request,response,summary,owner_id) values($1,'test','{}','{}','Owned insight','owner-b')`,
    [insightB],
  );

  const app = await buildApp({ authConfig: clientAuth });
  try {
    const rename = await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge/feedback',
      headers: headersA,
      payload: { action: 'rename', targetType: 'entity', targetId: entityB, payload: { value: 'RenamedByA', description: 'hacked' } },
    });
    assert.equal(rename.statusCode, 404);
    const entity = (await pool.query<{ value: string; description: string | null }>(
      'select value, description from entities where id = $1', [entityB],
    )).rows[0];
    assert.equal(entity.value, 'Owned by B');
    assert.notEqual(entity.description, 'hacked');

    const reject = await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge/feedback',
      headers: headersA,
      payload: { action: 'reject', targetType: 'insight', targetId: insightB },
    });
    assert.equal(reject.statusCode, 404);
    const insight = (await pool.query<{ feedbackStatus: string | null }>(
      'select feedback_status as "feedbackStatus" from insight_runs where id = $1', [insightB],
    )).rows[0];
    assert.equal(insight.feedbackStatus, null);

    const feedback = await pool.query<{ count: number }>(
      'select count(*)::int as count from knowledge_feedback where target_id = any($1::text[])', [[entityB, insightB]],
    );
    assert.equal(feedback.rows[0].count, 0);
  } finally { await app.close(); }
});

test('B06/N4 financial creation rejects a foreign account and leaves balances untouched', async () => {
  const accountB = `account_b_${randomUUID()}`;
  await pool.query(
    `insert into financial_accounts(id,name,type,currency,owner_id) values($1,'Bravo Account','bank','UYU','owner-b')`,
    [accountB],
  );

  const app = await buildApp({ authConfig: clientAuth });
  try {
    const manual = await app.inject({
      method: 'POST',
      url: '/api/v1/financial/transactions',
      headers: headersA,
      payload: {
        title: `CrossLinkedA ${randomUUID()}`,
        kind: 'expense',
        amount: 3,
        currency: 'UYU',
        accountId: accountB,
        observedAt: '2026-10-17T12:00:00Z',
      },
    });
    assert.equal(manual.statusCode, 404);
    assert.equal((manual.json() as { error: string }).error, 'financial_account_not_found');

    const pending = await app.inject({
      method: 'POST',
      url: '/api/v1/financial/pending-transactions',
      headers: headersA,
      payload: {
        title: `CrossLinkedPendingA ${randomUUID()}`,
        kind: 'expense',
        amount: 4,
        currency: 'UYU',
        accountId: accountB,
        estimatedExecutionDate: '2026-10-20',
      },
    });
    assert.equal(pending.statusCode, 404);
    assert.equal((pending.json() as { error: string }).error, 'financial_account_not_found');

    const movements = await pool.query<{ count: number }>(
      `select count(*)::int as count from financial_transactions where account_id = $1`, [accountB],
    );
    assert.equal(movements.rows[0].count, 0);
    const pendingRows = await pool.query<{ count: number }>(
      `select count(*)::int as count from pending_financial_transactions where account_id = $1`, [accountB],
    );
    assert.equal(pendingRows.rows[0].count, 0);

    const accountsB = await app.inject({ method: 'GET', url: '/api/v1/financial/accounts', headers: headersB });
    assert.equal(accountsB.statusCode, 200);
    const account = (accountsB.json() as { accounts: Array<{ id: string; balance: string }> }).accounts.find((row) => row.id === accountB);
    assert.equal(Number(account?.balance), 0);
  } finally { await app.close(); }
});

test('B06 restricted runtime role enforces owner isolation transaction-locally', async () => {
  const ownerA = `rls-a-${randomUUID()}`, ownerB = `rls-b-${randomUUID()}`;
  const eventA = await captured(ownerA, `RLS A ${randomUUID()}`);
  const eventB = await captured(ownerB, `RLS B ${randomUUID()}`);

  const visibleToA = await withOwnerTransaction(ownerA, async (db) => (
    await db.query<{ id: string }>('select id from raw_events order by id')
  ).rows.map((row) => row.id), { enforceRls: true });
  assert.ok(visibleToA.includes(eventA));
  assert.ok(!visibleToA.includes(eventB));

  await assert.rejects(
    () => withOwnerTransaction(ownerA, async (db) => db.query(
      `insert into raw_events(id,source,kind,title,body,timestamp,raw,tags,contract_version,client_id,owner_id,idempotency_key,dedupe_key)
       values($1,'capture.wallet','expense','Foreign','body',now(),'{}','{}',1,$2,$2,$1,$1)`,
      [randomUUID(), ownerB],
    ), { enforceRls: true }),
    /row-level security|violates/,
  );
  // The owner setting must not leak into the next pooled transaction.
  const after = await withOwnerTransaction(ownerB, async (db) => (
    await db.query<{ id: string }>('select id from raw_events order by id')
  ).rows.map((row) => row.id), { enforceRls: true });
  assert.ok(after.includes(eventB));
  assert.ok(!after.includes(eventA));
});
