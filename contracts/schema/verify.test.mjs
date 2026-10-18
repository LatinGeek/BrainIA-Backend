import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { isolated } from './isolated.mjs';
import { applyConcurrentIndex, migrate, schemaContract, reconcileObjects, verifySchema } from '../../src/scripts/migrate.ts';
const contract = await schemaContract();
const migrationCount = Object.keys(contract.migrations).length;
const target = 'PGlite 0.5.8, in-memory per case, no TCP transport';
const { engine, db } = await isolated();
try {
  assert.deepEqual(await verifySchema(db), []);
  console.log(`PASS baseline ${migrationCount} applied checksummed migrations / ${Object.keys(contract.objects).length} catalog objects`);
  process.env.DATABASE_URL = 'postgres://isolated-test.invalid/brainia_b09_runtime';
  const originalQuery = pg.Pool.prototype.query;
  pg.Pool.prototype.query = async function(sql, args) {
    assert.match(sql.trim(), /^select\b/i, 'Runtime readiness must be read-only');
    return db.query(sql,args);
  };
  try {
    const { ensureIntelligenceSchema } = await import('../../src/storage/intelligence-schema.ts');
    const { ensurePendingFinancialTransactionsSchema } = await import('../../src/storage/pending-financial-schema.ts');
    assert.deepEqual(await ensureIntelligenceSchema(), { repaired: false, verified: true });
    assert.deepEqual(await ensurePendingFinancialTransactionsSchema(), { repaired: false, verified: true });
    await engine.exec('begin; drop trigger intelligence_new_evidence on raw_events; drop index pending_financial_transactions_active_due_idx;');
    await assert.rejects(ensureIntelligenceSchema(), /schema_not_ready/);
    await assert.rejects(ensurePendingFinancialTransactionsSchema(), /schema_not_ready/);
    await engine.exec('rollback');
    console.log('PASS runtime helpers SELECT only; missing trigger/index rejected without repair');
  } finally { pg.Pool.prototype.query = originalQuery; }
  const snapshot = (await db.query(await readFile(new URL('./catalog.sql', import.meta.url), 'utf8'))).rows;
  // Each expected identity must independently produce a missing-object finding.
  for (const omitted of snapshot) {
    const fake = { query: async () => ({ rows: snapshot.filter(row => row.key !== omitted.key) }) };
    assert((await reconcileObjects(fake, contract)).includes(`missing object: ${omitted.key}`), omitted.key);
  }
  console.log(`PASS exhaustive reconciliation: ${snapshot.length} independent omitted identities`);
  for (const [sql, expected] of [
    ['drop table intelligence_feedback', 'missing object: relation:intelligence_feedback'],
    ['drop index intelligence_schedule_unique', 'missing object: index:intelligence_schedule_unique'],
    ['drop function invalidate_intelligence_event() cascade', 'missing object: function:invalidate_intelligence_event()'],
    ['drop trigger intelligence_new_evidence on raw_events', 'missing object: trigger:raw_events.intelligence_new_evidence'],
    ['alter table intelligence_artifacts disable row level security', 'object drift: relation:intelligence_artifacts'],
    ['grant select on intelligence_artifacts to authenticated', 'unexpected object: acl:relation:intelligence_artifacts:authenticated:SELECT'],
    ['grant select (content) on intelligence_artifacts to authenticated', 'unexpected object: acl:column:intelligence_artifacts.content:authenticated:SELECT'],
    ['grant execute on function rls_auto_enable() to public', 'unexpected object: acl:function:rls_auto_enable():PUBLIC:EXECUTE'],
    ["update schema_migrations set checksum='tampered' where version='0001_create_events.sql'", 'ledger checksum missing or mismatched: 0001_create_events.sql'],
  ]) {
    await engine.exec('begin');
    try {
      await engine.exec(sql);
      const problems = await verifySchema(db);
      assert(problems.includes(expected), JSON.stringify(problems));
      assert.equal((await db.query('select count(*)::int as n from schema_migrations')).rows[0].n, migrationCount);
      console.log(`PASS applied-ledger mutation: ${sql} => ${expected}`);
    } finally { await engine.exec('rollback'); }
  }
  // No policies are defined by current migrations. Exercise policy/grant omission
  // on a local expected-contract extension rather than inventing production policy.
  await engine.exec("begin; create policy b09_probe on intelligence_artifacts for select using (true); grant select on intelligence_artifacts to authenticated;");
  const withAccess = (await db.query(await readFile(new URL('./catalog.sql', import.meta.url), 'utf8'))).rows;
  const accessContract = { ...contract, objects: Object.fromEntries(withAccess.map(row => [row.key, row.definition])) };
  await engine.exec('drop policy b09_probe on intelligence_artifacts; revoke select on intelligence_artifacts from authenticated;');
  const omissions = await reconcileObjects(db, accessContract);
  assert(omissions.includes('missing object: policy:intelligence_artifacts.b09_probe'));
  assert(omissions.includes('missing object: acl:relation:intelligence_artifacts:authenticated:SELECT'));
  await engine.exec('rollback');
  console.log('PASS omitted policy and omitted grant detected independently');
  await engine.exec(`create role b09_runtime nosuperuser nocreatedb nocreaterole noinherit;
    revoke create on schema public from public;
    grant usage on schema public to b09_runtime;
    grant select,insert,update,delete on all tables in schema public to b09_runtime;
    set role b09_runtime;`);
  for (const sql of ['create table public.b09_forbidden(id text)', 'alter table public.intelligence_artifacts add column forbidden text']) {
    await assert.rejects(engine.exec(sql), /permission denied|must be owner/);
  }
  await engine.exec('reset role');
  console.log('PASS isolated nonowner runtime role cannot CREATE or ALTER');
} finally { await engine.close(); }

const upgrade = await isolated({ beforeRollForward: true });
try {
  // Reproduce the exact runtime-sentinel omissions with historical filename applied.
  await upgrade.engine.exec(`drop function invalidate_intelligence_event() cascade;
    drop function invalidate_intelligence_scope() cascade;
    drop function invalidate_intelligence_finance() cascade;
    drop function mark_knowledge_pages_stale() cascade;
    drop index pending_financial_transactions_active_due_idx;
    alter table intelligence_artifacts disable row level security;
    grant select on intelligence_artifacts to authenticated;`);
  const before = await verifySchema(upgrade.db);
  assert(before.some(x => x.includes('missing object: function:invalidate_intelligence_event')));
  console.log('PASS partial historical ledger detected:', JSON.stringify(before));
  await migrate(upgrade.db);
  assert.deepEqual(await verifySchema(upgrade.db), []);
  console.log('PASS partial-ledger roll-forward and checksum reconciliation');
  await migrate(upgrade.db);
  assert.deepEqual(await verifySchema(upgrade.db), []);
  console.log('PASS repeat migration idempotency');
} finally { await upgrade.engine.close(); }

const fresh = new PGlite();
try {
  await fresh.exec(`create role anon; create role authenticated; create function public.rls_auto_enable() returns event_trigger language plpgsql as $$ begin end $$;`);
  const freshDb = { query: async (sql, args) => !args && sql.includes(';') ? (await fresh.exec(sql)).at(-1) : fresh.query(sql,args) };
  await migrate(freshDb);
  assert.deepEqual(await verifySchema(freshDb), []);
  console.log('PASS fresh migration and read-only reconciliation');
} finally { await fresh.close(); }
console.log(JSON.stringify({ target, realPostgresConcurrency: 'BLOCKED: no server/binaries or Docker daemon', isolatedPgDumpRestore: 'BLOCKED: no pg_dump/psql/server' }));

// Control-flow tests only: do not mistake these for real PostgreSQL concurrent
// index/crash semantics, which remain blocked on a disposable server.
for (const scenario of ['success', 'existing-invalid', 'created-invalid', 'create-failed']) {
  const calls = [];
  const fake = { query: async (sql, args) => {
    calls.push({ sql, args });
    if (sql.startsWith('select i.indisvalid,')) return { rows: scenario === 'existing-invalid' ? [{ indisvalid: false, indisready: false }] : [] };
    if (sql.startsWith('create index concurrently') && scenario === 'create-failed') throw new Error('simulated failed CREATE');
    if (sql.startsWith('select i.indisvalid and')) return { rows: [{ valid: scenario !== 'created-invalid' }] };
    return { rows: [] };
  }};
  const work = applyConcurrentIndex(fake, 'fixture.sql', 'fixture-checksum', '-- brainia:nontransactional-index\ncreate index concurrently b09_probe on raw_events(id);');
  if (scenario === 'success') await work;
  else await assert.rejects(work);
  const ledger = calls.findIndex(call => call.sql.startsWith('insert into public.schema_migrations'));
  if (scenario === 'success') {
    assert(ledger > calls.findIndex(call => call.sql.startsWith('select i.indisvalid and')));
    assert(calls.findIndex(call => call.sql === 'begin') > calls.findIndex(call => call.sql.startsWith('create index concurrently')));
  } else {
    assert.equal(ledger, -1);
    assert(calls.some(call => call.sql.includes("status='failed'")));
  }
  console.log(`PASS nontransactional index control flow: ${scenario}`);
}
