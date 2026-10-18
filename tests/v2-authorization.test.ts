import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { buildApp } from '../src/app.ts';
import type { AuthConfig } from '../src/auth.ts';
import { pool, withOwnerTransaction } from '../src/storage/postgres.ts';
import { insertRawEvent } from '../src/storage/event-repository.ts';
import { repairLegacyNullOwnerFinance } from '../src/storage/data-controls.ts';

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

  const role = await withOwnerTransaction(ownerA, async (db) => (
    await db.query<{ role: string }>('select current_user as role')
  ).rows[0]?.role, { enforceRls: true });
  assert.equal(role, 'brainia_runtime');

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

test('B06 routed reads switch to the restricted role and hide legacy null-owner rows', async () => {
  const ownedA = await captured('owner-a', `Routed RLS owned ${randomUUID()}`);
  const ownedB = await captured('owner-b', `Routed RLS foreign ${randomUUID()}`);
  // Pre-fix row: the surviving client scope is owner-a but owner_id was never
  // backfilled. The legacy owner filter would return it; RLS must not.
  const legacy = { id: randomUUID(), source: 'capture.wallet', contractVersion: 1 as const, kind: 'expense' as const,
    title: `Routed RLS legacy ${randomUUID()}`, body: 'legacy null owner', timestamp: '2026-10-17T12:00:00Z',
    raw: { amount: 1, currency: 'UYU', merchant: 'legacy' }, tags: [] };
  await insertRawEvent(pool, legacy, 'owner-a', `owner-a:${legacy.id}`);

  const app = await buildApp({ authConfig: clientAuth });
  try {
    const legacyVisible = await app.inject({ method: 'GET', url: '/api/v1/events', headers: headersA });
    assert.equal(legacyVisible.statusCode, 200);
    const beforeIds = (legacyVisible.json() as Array<{ id: string }>).map((event) => event.id);
    assert.ok(beforeIds.includes(legacy.id));

    const previous = process.env.BRAINIA_DB_ENFORCE_RLS;
    process.env.BRAINIA_DB_ENFORCE_RLS = 'true';
    try {
      const scoped = await app.inject({ method: 'GET', url: '/api/v1/events', headers: headersA });
      assert.equal(scoped.statusCode, 200);
      const ids = (scoped.json() as Array<{ id: string }>).map((event) => event.id);
      assert.ok(ids.includes(ownedA));
      assert.ok(!ids.includes(legacy.id));
      assert.ok(!ids.includes(ownedB));

      const detail = await app.inject({ method: 'GET', url: `/api/v1/events/${legacy.id}`, headers: headersA });
      assert.equal(detail.statusCode, 404);

      const foreign = await app.inject({ method: 'GET', url: `/api/v1/events/${ownedB}`, headers: headersA });
      assert.equal(foreign.statusCode, 404);
    } finally {
      if (previous === undefined) delete process.env.BRAINIA_DB_ENFORCE_RLS;
      else process.env.BRAINIA_DB_ENFORCE_RLS = previous;
    }
  } finally { await app.close(); }
});

test('B06 legacy null-owner finance repair is dry-run first, evidence-only and idempotent', async () => {
  const account = `account_legacy_${randomUUID()}`;
  const pending = `pending_legacy_${randomUUID()}`;
  const ambiguousAccount = `account_ambiguous_${randomUUID()}`;
  const txn = `financial_legacy_${randomUUID()}`;
  const caseA = await captured('owner-a', `Legacy repair A ${randomUUID()}`);

  await pool.query(`insert into financial_accounts(id,name,type,currency,owner_id) values($1,'Legacy Account','bank','UYU',null)`, [account]);
  await pool.query(`insert into pending_financial_transactions(id,title,kind,amount,currency,account_id,estimated_execution_date,owner_id)
    values($1,'Legacy Pending','expense',5,'UYU',$2,current_date + 5,null)`, [pending, account]);
  await pool.query(`insert into financial_transactions(id,kind,amount,currency,merchant_label,normalized_merchant,
    observed_at,window_start,window_end,evidence_count,match_score,match_strategy,primary_source,account_id,owner_id)
    values($1,'expense',5,'UYU','legacy','legacy',now(),now(),now(),1,1,'test','test',$2,'owner-a')`, [txn, account]);
  await pool.query(`insert into financial_transaction_events(id,transaction_id,raw_event_id,source,kind,amount,currency,
    merchant_label,normalized_merchant,observed_at,match_score,match_reason,owner_id)
    values($1,$2,$3,'capture.wallet','expense',5,'UYU','legacy','legacy',now(),1,'test','owner-a')`,
    [randomUUID(), txn, caseA]);

  // An account referenced by two owners must never be guessed.
  const ambiguousA = await captured('owner-a', `Legacy ambiguous A ${randomUUID()}`);
  const ambiguousB = await captured('owner-b', `Legacy ambiguous B ${randomUUID()}`);
  await pool.query(`insert into financial_accounts(id,name,type,currency,owner_id) values($1,'Ambiguous Account','bank','UYU',null)`, [ambiguousAccount]);
  for (const [owner, event] of [['owner-a', ambiguousA], ['owner-b', ambiguousB]] as const) {
    const id = `financial_ambiguous_${randomUUID()}`;
    await pool.query(`insert into financial_transactions(id,kind,amount,currency,merchant_label,normalized_merchant,
      observed_at,window_start,window_end,evidence_count,match_score,match_strategy,primary_source,account_id,owner_id)
      values($1,'expense',2,'UYU','ambiguous','ambiguous',now(),now(),now(),1,1,'test','test',$2,$3)`,
      [id, ambiguousAccount, owner]);
    await pool.query(`insert into financial_transaction_events(id,transaction_id,raw_event_id,source,kind,amount,currency,
      merchant_label,normalized_merchant,observed_at,match_score,match_reason,owner_id)
      values($1,$2,$3,'capture.wallet','expense',2,'UYU','ambiguous','ambiguous',now(),1,'test',$4)`,
      [randomUUID(), id, event, owner]);
  }

  const dryRun = await repairLegacyNullOwnerFinance(pool, { tables: ['financial_accounts', 'pending_financial_transactions'] });
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.tables.financial_accounts.applied, 0);
  assert.equal(dryRun.tables.financial_accounts.ambiguous, 1);
  assert.ok(dryRun.tables.financial_accounts.assignments.some((row) => row.id === account && row.ownerId === 'owner-a'));
  assert.equal((await pool.query<{ ownerId: string | null }>('select owner_id as "ownerId" from financial_accounts where id=$1', [account])).rows[0].ownerId, null);

  const applied = await repairLegacyNullOwnerFinance(pool, {
    dryRun: false,
    approvedBy: 'b06-r4-test',
    tables: ['financial_accounts', 'pending_financial_transactions'],
  });
  assert.ok(applied.tables.financial_accounts.applied >= 1);
  assert.equal((await pool.query<{ ownerId: string | null }>('select owner_id as "ownerId" from financial_accounts where id=$1', [account])).rows[0].ownerId, 'owner-a');
  assert.equal((await pool.query<{ ownerId: string | null }>('select owner_id as "ownerId" from pending_financial_transactions where id=$1', [pending])).rows[0].ownerId, 'owner-a');
  assert.equal((await pool.query<{ ownerId: string | null }>('select owner_id as "ownerId" from financial_accounts where id=$1', [ambiguousAccount])).rows[0].ownerId, null);

  const quarantine = await pool.query<{ reason: string }>(
    `select reason from owner_quarantine where table_name='financial_accounts' and row_id=$1`, [ambiguousAccount],
  );
  assert.equal(quarantine.rows[0]?.reason, 'legacy_null_owner_requires_review');

  // The repaired account is now reachable by its scoped owner, and only them.
  const app = await buildApp({ authConfig: clientAuth });
  try {
    const accountsA = await app.inject({ method: 'GET', url: '/api/v1/financial/accounts', headers: headersA });
    const idsA = (accountsA.json() as { accounts: Array<{ id: string }> }).accounts.map((row) => row.id);
    assert.ok(idsA.includes(account));
    assert.ok(!idsA.includes(ambiguousAccount));
    const accountsB = await app.inject({ method: 'GET', url: '/api/v1/financial/accounts', headers: headersB });
    assert.ok(!(accountsB.json() as { accounts: Array<{ id: string }> }).accounts.some((row) => row.id === account));
  } finally { await app.close(); }
});

test('B06 legacy null-owner derived runs are repaired only with single-owner evidence', async () => {
  const caseA = await captured('owner-a', `Legacy run A ${randomUUID()}`);
  const caseB = await captured('owner-b', `Legacy run B ${randomUUID()}`);
  const insightA = `insight_legacy_${randomUUID()}`;
  const insightMixed = `insight_legacy_mixed_${randomUUID()}`;
  const digestA = `digest_legacy_${randomUUID()}`;

  await pool.query(`insert into insight_runs(id,tool_name,request,response,summary,evidence,owner_id)
    values($1,'test','{}','{}','legacy insight',$2::jsonb,null)`, [insightA, JSON.stringify([{ eventIds: [caseA] }])]);
  await pool.query(`insert into insight_runs(id,tool_name,request,response,summary,evidence,owner_id)
    values($1,'test','{}','{}','mixed insight',$2::jsonb,null)`, [insightMixed, JSON.stringify([{ eventIds: [caseA] }, { eventIds: [caseB] }])]);
  await pool.query(`insert into digest_runs(id,tool_name,request,response,summary,window_from,window_to,owner_id)
    values($1,'test','{}','{}','legacy digest','2026-01-01T00:00:00Z','2026-12-31T23:59:59Z',null)`, [digestA]);

  const dryRun = await repairLegacyNullOwnerFinance(pool, { tables: ['insight_runs', 'digest_runs'] });
  assert.equal(dryRun.tables.insight_runs.applied, 0);
  assert.ok(dryRun.tables.insight_runs.assignments.some((row) => row.id === insightA && row.ownerId === 'owner-a'));
  // The digest window covers both owners, so it must stay ambiguous.
  assert.ok(dryRun.tables.digest_runs.ambiguous >= 1);

  const applied = await repairLegacyNullOwnerFinance(pool, { dryRun: false, tables: ['insight_runs', 'digest_runs'] });
  assert.ok(applied.tables.insight_runs.applied >= 1);
  assert.equal((await pool.query<{ ownerId: string | null }>('select owner_id as "ownerId" from insight_runs where id=$1', [insightA])).rows[0].ownerId, 'owner-a');
  assert.equal((await pool.query<{ ownerId: string | null }>('select owner_id as "ownerId" from insight_runs where id=$1', [insightMixed])).rows[0].ownerId, null);
  assert.equal((await pool.query<{ ownerId: string | null }>('select owner_id as "ownerId" from digest_runs where id=$1', [digestA])).rows[0].ownerId, null);
});

test('B06 cron and empty daily evaluation stay global and never appear in owner history', async () => {
  const insightId = `insight_global_${randomUUID()}`;
  const digestId = `digest_global_${randomUUID()}`;
  await pool.query(`insert into insight_runs(id,tool_name,request,response,summary,owner_id)
    values($1,'test','{"scope":"global","writer":"cron"}','{}','global cron insight',null)`, [insightId]);
  await pool.query(`insert into digest_runs(id,tool_name,request,response,summary,owner_id)
    values($1,'test','{"scope":"global","writer":"cron"}','{}','global cron digest',null)`, [digestId]);

  const app = await buildApp({ authConfig: clientAuth });
  const previousSecret = process.env.CRON_SECRET;
  const previousToken = process.env.BRAINIA_DAILY_INSIGHTS_TOKEN;
  process.env.CRON_SECRET = `cron-${randomUUID()}`;
  process.env.BRAINIA_DAILY_INSIGHTS_TOKEN = `daily-${randomUUID()}`;
  try {
    const insightHistory = await app.inject({ method: 'GET', url: '/api/v1/insights/history?limit=100', headers: headersA });
    assert.equal(insightHistory.statusCode, 200);
    assert.ok(!insightHistory.body.includes(insightId));

    const digestHistory = await app.inject({ method: 'GET', url: '/api/v1/digests/history?limit=100', headers: headersA });
    assert.equal(digestHistory.statusCode, 200);
    assert.ok(!digestHistory.body.includes(digestId));

    const nullRunsBefore = (await pool.query<{ count: number }>(
      'select count(*)::int as count from insight_runs where owner_id is null',
    )).rows[0].count;
    const emptyDaily = await app.inject({
      method: 'POST', url: '/api/v1/insights/daily',
      headers: { ...headersA, 'x-brainia-daily-insights-token': process.env.BRAINIA_DAILY_INSIGHTS_TOKEN! },
      payload: {},
    });
    assert.equal(emptyDaily.statusCode, 400);
    assert.equal((emptyDaily.json() as { error: string }).error, 'owner_scoped_daily_insight_required');
    const nullRunsAfter = (await pool.query<{ count: number }>(
      'select count(*)::int as count from insight_runs where owner_id is null',
    )).rows[0].count;
    assert.equal(nullRunsAfter, nullRunsBefore);

    const cron = await app.inject({
      method: 'GET', url: '/api/v1/cron/daily-insights',
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    assert.equal(cron.statusCode, 200);
    const payload = cron.json() as { scope: string; writer: string; digest?: { id?: string } | null };
    assert.equal(payload.scope, 'global');
    assert.equal(payload.writer, 'cron');
    if (payload.digest?.id) {
      const run = (await pool.query<{ ownerId: string | null; scope: string | null }>(
        `select owner_id as "ownerId", request->>'scope' as scope from digest_runs where id=$1`, [payload.digest.id],
      )).rows[0];
      assert.equal(run?.ownerId, null);
      assert.equal(run?.scope, 'global');
      const afterCron = await app.inject({ method: 'GET', url: '/api/v1/digests/history?limit=100', headers: headersA });
      assert.ok(!afterCron.body.includes(payload.digest.id));
    }
  } finally {
    await app.close();
    if (previousSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previousSecret;
    if (previousToken === undefined) delete process.env.BRAINIA_DAILY_INSIGHTS_TOKEN; else process.env.BRAINIA_DAILY_INSIGHTS_TOKEN = previousToken;
  }
});