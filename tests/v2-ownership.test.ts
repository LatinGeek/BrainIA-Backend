import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { pool } from '../src/storage/postgres.ts';
import { insertRawEvent } from '../src/storage/event-repository.ts';
import {
  backfillOwnership, isOwnerRowVisible, ownerInventory, ownerVisiblePredicate,
  quarantineRow, recordOwnerMapping, releaseQuarantinedRow,
} from '../src/storage/ownership.ts';

async function event(clientId: string, source = 'capture.wallet') {
  const item = { id: randomUUID(), source, contractVersion: 1 as const, kind: 'expense' as const,
    title: `Ownership ${randomUUID()}`, body: 'Ownership backfill fixture', timestamp: '2026-10-17T10:00:00Z',
    raw: { amount: 10, currency: 'UYU' }, tags: [] };
  await insertRawEvent(pool, item, clientId, `${clientId}:${item.id}`);
  return item.id;
}
async function entity(type: string, value: string, ownerId: string | null = null) {
  const id = randomUUID();
  await pool.query(`insert into entities(id,type,value,normalized_value,owner_id) values($1,$2,$3,$4,$5)`,
    [id, type, value, value.toLowerCase(), ownerId]);
  return id;
}
async function transaction(ownerId: string | null = null) {
  const id = randomUUID();
  await pool.query(`insert into financial_transactions(id,kind,amount,currency,merchant_label,normalized_merchant,
    observed_at,window_start,window_end,evidence_count,match_score,match_strategy,primary_source,owner_id)
    values($1,'expense',10,'UYU','Owner fixture','owner fixture',now(),now(),now(),1,1,'test','test',$2)`, [id, ownerId]);
  return id;
}

test('B05 owner inventory covers every personal table with an owner key', async () => {
  const inventory = await ownerInventory(pool);
  const personal = inventory.filter((entry) => entry.personal);
  assert.ok(personal.length >= 30);
  assert.deepEqual(personal.filter((entry) => !entry.ownerKey).map((entry) => entry.table), []);
  const entities = personal.find((entry) => entry.table === 'entities');
  assert.equal(entities?.ownerKey, 'owner_id');
});

test('B05 idempotent backfill maps owners and preserves evidence and transaction ids', async () => {
  const legacyA = `legacy-${randomUUID()}`, legacyB = `legacy-${randomUUID()}`;
  const ownerA = `owner-${randomUUID()}`;
  const eventA = await event(legacyA), eventB = await event(legacyB);
  const merchant = await entity('merchant', `Merchant ${randomUUID()}`);
  await pool.query(`insert into event_entities(id,event_id,entity_id,role,confidence) values($1,$2,$3,'merchant',1)`, [randomUUID(), eventA, merchant]);
  await pool.query(`insert into event_entities(id,event_id,entity_id,role,confidence) values($1,$2,$3,'merchant',1)`, [randomUUID(), eventB, merchant]);
  const txnA = await transaction(), txnB = await transaction();
  for (const [txn, ev] of [[txnA, eventA], [txnB, eventB]] as const) {
    await pool.query(`insert into financial_transaction_events(id,transaction_id,raw_event_id,source,kind,amount,currency,
      merchant_label,normalized_merchant,observed_at,match_score,match_reason)
      values($1,$2,$3,'capture.wallet','expense',10,'UYU','Owner fixture','owner fixture',now(),1,'test')`,
      [randomUUID(), txn, ev]);
  }
  await pool.query(`insert into knowledge_facts(id,client_id,event_id,fact_type,value,normalized_value,confidence,evidence,extractor_version)
    values($1,$2,$3,'event_classification','{}','owner-fact',1,'{}','test')`, [randomUUID(), legacyA, eventA]);
  const beforeTxn = (await pool.query(`select id,evidence_count,amount,currency from financial_transactions where id=any($1::text[]) order by id`, [[txnA, txnB]])).rows;

  const first = await backfillOwnership(pool, { mapping: { [legacyA]: ownerA }, approvedBy: 'test-owner' });
  assert.ok(first.ownersAssigned.raw_events >= 2);
  assert.ok(first.splitEntities >= 1);
  assert.ok(first.ownersAssigned.financial_transactions >= 2);
  assert.deepEqual((await pool.query(`select id,evidence_count,amount,currency from financial_transactions where id=any($1::text[]) order by id`, [[txnA, txnB]])).rows, beforeTxn);

  assert.equal((await pool.query(`select owner_id from raw_events where id=$1`, [eventA])).rows[0].owner_id, ownerA);
  assert.equal((await pool.query(`select owner_id from raw_events where id=$1`, [eventB])).rows[0].owner_id, legacyB);
  assert.equal((await pool.query(`select owner_id from knowledge_facts where event_id=$1`, [eventA])).rows[0].owner_id, ownerA);
  assert.equal((await pool.query(`select owner_id from financial_transactions where id=$1`, [txnA])).rows[0].owner_id, ownerA);
  assert.equal((await pool.query(`select owner_id from financial_transaction_events where transaction_id=$1`, [txnA])).rows[0].owner_id, ownerA);
  assert.equal((await pool.query(`select owner_id from client_owner_mappings where legacy_client_id=$1`, [legacyA])).rows[0].owner_id, ownerA);
  // Shared entity was split per owner; each event now points at its own copy.
  const links = (await pool.query(`select event_id, entity_id from event_entities where event_id=any($1::text[]) order by event_id`, [[eventA, eventB]])).rows;
  assert.equal(links.length, 2);
  assert.notEqual(links[0].entity_id, links[1].entity_id);
  assert.equal((await pool.query(`select count(*)::int as count from entity_owner_splits`)).rows[0].count, 1);

  const second = await backfillOwnership(pool, { mapping: { [legacyA]: ownerA }, approvedBy: 'test-owner' });
  assert.equal(second.splitEntities, 0);
  assert.deepEqual((await pool.query(`select id,evidence_count,amount,currency from financial_transactions where id=any($1::text[]) order by id`, [[txnA, txnB]])).rows, beforeTxn);
  assert.equal((await pool.query(`select count(*)::int as count from entity_owner_splits`)).rows[0].count, 1);
});

test('B05 quarantined rows are invisible to ordinary owner-scoped queries until released', async () => {
  const account = randomUUID();
  await pool.query(`insert into financial_accounts(id,name,type,currency) values($1,'Legacy account','bank','UYU')`, [account]);
  await backfillOwnership(pool);
  assert.equal((await pool.query(`select count(*)::int as count from owner_quarantine where table_name='financial_accounts' and row_id=$1 and status='quarantined'`, [account])).rows[0].count, 1);
  assert.equal(await isOwnerRowVisible(pool, { table: 'financial_accounts', rowId: account }), false);
  const visible = await pool.query(`select account.id from financial_accounts account where account.id=$1 and ${ownerVisiblePredicate('financial_accounts', 'account.id')}`, [account]);
  assert.equal(visible.rows.length, 0);
  assert.equal(await releaseQuarantinedRow(pool, { table: 'financial_accounts', rowId: account }), 1);
  assert.equal(await isOwnerRowVisible(pool, { table: 'financial_accounts', rowId: account }), true);
  // A released decision is durable: a later backfill must not silently hide it again.
  await backfillOwnership(pool);
  assert.equal(await isOwnerRowVisible(pool, { table: 'financial_accounts', rowId: account }), true);
});

test('B05 public taxonomy cannot carry an owner and personal edges cannot cross owners', async () => {
  const domain = randomUUID();
  await assert.rejects(
    () => pool.query(`insert into entities(id,type,value,normalized_value,owner_id) values($1,'domain','Owned domain','owned domain',$2)`, [domain, 'owner-x']),
    /public_taxonomy_cannot_be_owned/,
  );
  const legacy = `legacy-${randomUUID()}`;
  const eventId = await event(legacy);
  await backfillOwnership(pool);
  const foreign = await entity('merchant', `Foreign ${randomUUID()}`, `other-owner-${randomUUID()}`);
  await assert.rejects(
    () => pool.query(`insert into event_entities(id,event_id,entity_id,role,confidence,owner_id) values($1,$2,$3,'merchant',1,$4)`,
      [randomUUID(), eventId, foreign, 'other-owner-mismatch']),
    /event_entity_(entity_)?owner_mismatch/,
  );
  // Even when the edge claims the event's own owner, an entity owned by another
  // owner must be rejected (the original defect).
  const eventOwner = (await pool.query(`select owner_id from raw_events where id=$1`, [eventId])).rows[0].owner_id;
  await assert.rejects(
    () => pool.query(`insert into event_entities(id,event_id,entity_id,role,confidence,owner_id) values($1,$2,$3,'merchant',1,$4)`,
      [randomUUID(), eventId, foreign, eventOwner]),
    /event_entity_entity_owner_mismatch/,
  );
  // Relations cannot bridge two personal identities from different owners.
  const ownA = await entity('merchant', `OwnA ${randomUUID()}`, `owner-a-${randomUUID()}`);
  const ownB = await entity('merchant', `OwnB ${randomUUID()}`, `owner-b-${randomUUID()}`);
  await assert.rejects(
    () => pool.query(`insert into relations(id,source_entity_id,target_entity_id,relation_type,confidence) values($1,$2,$3,'related_to',1)`,
      [randomUUID(), ownA, ownB]),
    /relation_owner_mismatch/,
  );
});

test('B05 unresolved personal rows are quarantined instead of staying visible', async () => {
  const anonymousEvent = randomUUID();
  await pool.query(`insert into raw_events(id,source,kind,title,body,timestamp,raw,tags,contract_version,idempotency_key,dedupe_key)
    values($1,'capture.wallet','expense','Anonymous','body',now(),'{}','{}',1,$1,$1)`, [anonymousEvent]);
  await backfillOwnership(pool);
  assert.equal((await pool.query(`select count(*)::int as count from owner_quarantine where table_name='raw_events' and row_id=$1 and status='quarantined'`, [anonymousEvent])).rows[0].count, 1);
  assert.equal(await isOwnerRowVisible(pool, { table: 'raw_events', rowId: anonymousEvent }), false);
});

test('B05 quarantine helper is idempotent and owner visibility stays closed while quarantined', async () => {
  const txn = await transaction();
  await quarantineRow(pool, { table: 'financial_transactions', rowId: txn, reason: 'test_quarantine' });
  await quarantineRow(pool, { table: 'financial_transactions', rowId: txn, reason: 'test_quarantine' });
  assert.equal((await pool.query(`select count(*)::int as count from owner_quarantine where table_name='financial_transactions' and row_id=$1`, [txn])).rows[0].count, 1);
  assert.equal(await isOwnerRowVisible(pool, { table: 'financial_transactions', rowId: txn }), false);
  assert.throws(() => ownerVisiblePredicate('financial_transactions' as any, "id; drop table x"), /unsupported/);
  assert.throws(() => ownerVisiblePredicate('financial_transactions' as any, "id"), /unsupported/);
});
