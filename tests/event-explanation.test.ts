import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.ts';
import { pool } from '../src/storage/postgres.ts';

const headers = { 'x-brainia-client-id': 'explain-a', 'x-brainia-api-key': 'key-a' };
const authConfig = { globalApiKey: null, clientKeys: new Map([['explain-a', 'key-a'], ['explain-b', 'key-b']]) };

test('explanation is owner scoped, handles pending and historical events, and never exposes model internals', async () => {
  const app = await buildApp({ authConfig });
  const id = `explain_${randomUUID()}`;
  try {
    await pool.query(`insert into raw_events (id,source,client_id,owner_id,dedupe_key,kind,title,body,timestamp,raw,tags)
      values ($1,'test.src','explain-a','explain-a',$1,'notification','Original','Evidencia original','2026-10-23T14:00:00Z','{}','{}')`, [id]);
    const get = () => app.inject({ method: 'GET', url: `/api/v1/events/${id}/explanation`, headers });
    const pending = await get();
    assert.equal(pending.statusCode, 200, pending.body);
    assert.equal(pending.headers['cache-control'], 'no-store');
    assert.equal(pending.json().classification.version, null);
    assert.deepEqual(pending.json().fields, []);
    assert.equal(pending.json().evidence.body, 'Evidencia original');
    assert.notEqual(pending.json().occurredAt, pending.json().ingestedAt);

    const other = await app.inject({ method: 'GET', url: `/api/v1/events/${id}/explanation`, headers: { 'x-brainia-client-id': 'explain-b', 'x-brainia-api-key': 'key-b' } });
    assert.equal(other.statusCode, 404);
    const anonymous = await app.inject({ method: 'GET', url: `/api/v1/events/${id}/explanation` });
    assert.equal(anonymous.statusCode, 401);

    await pool.query(`insert into classified_events (id,raw_event_id,client_id,owner_id,classification_version,inferred_kind,confidence,entities,model_metadata)
      values ($1,$2,'explain-a','explain-a','v1','expense',0.9,'[{"type":"merchant","value":"Café"}]',$3)`,
    [`cls_${id}`, id, JSON.stringify({ model: 'test-model', applied: false, reason: 'privacy_policy', prompt: { body: 'SECRET_PROMPT' }, response: { rationale: 'SECRET_REASONING' }, arbitrary: 'SECRET_METADATA' })]);
    const correctionId = `correction_${randomUUID()}`;
    await pool.query(`insert into classification_corrections(id,client_id,owner_id,event_id,source,descriptor,field,value)
      values ($1,'explain-a','explain-a',$2,'test.src','original','inferredKind','expense')`, [correctionId, id]);
    const complete = (await get()).json();
    assert.equal(complete.classification.version, 'v1');
    assert.match(complete.classification.reason, /privacidad/);
    assert.equal(complete.corrections[0].field, 'inferredKind');
    assert.equal(complete.corrections[0].reused, false);
    assert.equal(complete.fields[0].value, 'Café');
    assert.equal(complete.fields[0].origin, 'inferred');
    assert.ok(!JSON.stringify(complete).includes('SECRET_'));

    // Links come from this event, including older ledger records; removed
    // transactions and protected entities must not be offered as destinations.
    await pool.query(`insert into financial_transactions (id,owner_id,kind,amount,currency,merchant_label,normalized_merchant,observed_at,window_start,window_end,primary_source,anchor_event_id)
      values ($1,'explain-a','expense',250,'UYU','Café','cafe',now(),now(),now(),'test.src',$2)`, [`tx_${id}`, id]);
    await pool.query(`insert into financial_transaction_events (id,owner_id,transaction_id,raw_event_id,source,kind,amount,merchant_label,normalized_merchant,observed_at,match_reason)
      values ($1,'explain-a',$2,$3,'test.src','expense',250,'Café','cafe',now(),'test')`, [`link_${id}`, `tx_${id}`, id]);
    assert.deepEqual((await get()).json().links, [{ id: `tx_${id}`, kind: 'transaction', label: 'Movimiento vinculado' }]);
    await pool.query('update financial_transactions set hidden_at=now() where id=$1', [`tx_${id}`]);
    assert.deepEqual((await get()).json().links, []);

    await pool.query(`update classified_events set model_metadata=$2 where raw_event_id=$1`, [id, JSON.stringify({ reason: '__proto__', rationale: 'SECRET_REASONING' })]);
    assert.equal((await get()).json().classification.reason, null);

    const merchantCorrection = `correction_${randomUUID()}`;
    await pool.query(`insert into classification_corrections(id,client_id,owner_id,event_id,source,descriptor,field,value)
      values ($1,'explain-a','explain-a',$2,'test.src','original','merchant','Café')`, [merchantCorrection, id]);
    assert.equal((await get()).json().fields[0].origin, 'human');
    await pool.query('update classification_corrections set revoked_at=now() where id=$1', [merchantCorrection]);

    // Historical rows have no model metadata or occurrence timestamp.
    await pool.query('update classified_events set model_metadata=null where raw_event_id=$1', [id]);
    await pool.query('update raw_events set timestamp=null where id=$1', [id]);
    const historical = (await get()).json();
    assert.equal(historical.occurredAt, null);
    assert.equal(historical.classification.reason, null);
    assert.equal(historical.classification.model, null);

    await pool.query('update classification_corrections set revoked_at=now() where id=$1', [correctionId]);
    assert.deepEqual((await get()).json().corrections, []);
    for (const privacy of ['private', 'hidden']) {
      await pool.query('update raw_events set privacy_status=$2 where id=$1', [id, privacy]);
      const protectedEvent = (await get()).json();
      assert.equal(protectedEvent.contentAvailable, false);
      assert.equal(protectedEvent.evidence, null);
      assert.deepEqual(protectedEvent.fields, []);
      assert.deepEqual(protectedEvent.links, []);
      assert.deepEqual(protectedEvent.corrections, []);
      assert.ok(!JSON.stringify(protectedEvent).includes('Evidencia original'));
    }
  } finally {
    await app.close();
  }
});
