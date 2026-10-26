import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5432/brainia_test';
const { classifyEvent } = await import('../src/domain/classification.ts');
const { buildEntityDrafts } = await import('../src/domain/entities.ts');
const { buildFinancialTransactionCandidate } = await import('../src/domain/financial-transactions.ts');
const { createClassificationAssistant } = await import('../src/storage/classification-assistant.ts');
const { buildApp } = await import('../src/app.ts');
const { pool } = await import('../src/storage/postgres.ts');
const { withTransaction } = await import('../src/storage/postgres.ts');
const { recordCorrection } = await import('../src/storage/correction-memory.ts');
const { classifyCapturedEvent } = await import('../src/storage/event-store.ts');

const notice = (title: string, body: string) => ({ id: randomUUID(), source: 'safety-test', contractVersion: 1,
  kind: 'notification' as const, title, body, raw: {}, tags: [] });
const promotions = [
  notice('¡Burger Time a $279!🍔', 'Pedí la hamburguesa The Time a este súper precio. ¡Hacé tu pedido ahora!'),
  notice('¿Soñás con envíos gratis?', 'Suscribite ahora por $349 y accedé a descuentos exclusivos.'),
  notice('Llegó la Feria de Dólares', 'Hoy el precio de compra y venta se igualan. Aprovechá la oportunidad.'),
  notice('Compra con más seguridad', 'Crea un número de tarjeta virtual para Mastercard en unos pocos pasos.'),
  notice('Confirma si recibiste tu compra', 'El vendedor nos informó que te entregó el producto.'),
  notice('Saldo disponible', 'Tu saldo disponible es UYU 8.000,00.'),
];

test('a bare price without settlement evidence is not deterministically spending', () => {
  const event = notice('Burger Time', '$279');
  const classified = classifyEvent(event);
  assert.equal(classified.inferredKind, 'notification');
  assert.equal(buildFinancialTransactionCandidate({ event, classified, entityDrafts: buildEntityDrafts(classified) }), null);
});

test('offers and balance/status notices never produce financial candidates, including adversarial model upgrades', async () => {
  const assistant = createClassificationAssistant({ apiKey: 'offline-stub', model: 'offline-stub',
    generateCompletion: async () => JSON.stringify({ inferredKind: 'expense', confidence: 1,
      entities: [{ type: 'merchant', value: 'Invented purchase' }] }) });
  for (const event of promotions) {
    const base = classifyEvent(event);
    assert.equal(base.inferredKind, 'notification', event.title);
    const classified = await assistant({ event, base });
    assert.equal(classified.inferredKind, 'notification', event.title);
    assert.equal(classified.confidence, base.confidence, 'rejected expense confidence must not inflate notification confidence');
    assert.equal(classified.modelMetadata?.applied, false);
    assert.equal(buildFinancialTransactionCandidate({ event, classified, entityDrafts: buildEntityDrafts(classified) }), null);
  }
});

test('the assistant can correct a confident heuristic expense and preserves actual payment evidence', async () => {
  const assistant = createClassificationAssistant({ apiKey: 'offline-stub', model: 'offline-stub',
    generateCompletion: async () => JSON.stringify({ inferredKind: 'notification', confidence: 1, entities: [] }) });
  const ambiguous = notice('Novedades', 'Información sobre tu compra');
  const corrected = await assistant({ event: ambiguous, base: { ...classifyEvent(ambiguous), inferredKind: 'expense', confidence: 0.95 } });
  assert.equal(corrected.inferredKind, 'notification');
  assert.equal(corrected.confidence, 1);
  const equalConfidence = createClassificationAssistant({ apiKey: 'offline-stub', model: 'offline-stub',
    generateCompletion: async () => JSON.stringify({ inferredKind: 'notification', confidence: 0.95, entities: [] }) });
  const promotion = promotions[0];
  const equalCorrection = await equalConfidence({ event: promotion,
    base: { ...classifyEvent(promotion), inferredKind: 'expense', confidence: 0.95 } });
  assert.equal(equalCorrection.inferredKind, 'notification', 'the reviewed equal-confidence model correction must be accepted');
  assert.equal(equalCorrection.modelMetadata?.applied, true);
  for (const event of [
    notice('Pago realizado', 'Gastaste $ 254,92 en UBER RIDES. Aprovechá descuentos en tu próxima compra.'),
    notice('Cafe payment approved', 'Approved for USD 12.40'),
    notice('Aviso de tarjeta', 'Se realizó una transacción con tu tarjeta VISA por UYU 250,00 en CAFE. Ofertas disponibles.'),
    { ...notice('Oferta especial', 'Compra por USD 20'), kind: 'expense' as const, raw: { transactionType: 'expense' } },
  ]) {
    const base = classifyEvent(event);
    assert.equal(base.inferredKind, 'expense');
    const result = await assistant({ event, base });
    assert.equal(result.inferredKind, 'expense');
    assert.equal(result.confidence, base.confidence, 'a rejected model answer cannot change retained confidence');
    assert.ok(buildFinancialTransactionCandidate({ event, classified: result, entityDrafts: buildEntityDrafts(result) }));
  }
});

test('notification revision identities coexist with legacy captures, retry safely, and preserve original evidence', async () => {
  const app = await buildApp({ authConfig: { globalApiKey: null, clientKeys: new Map() } });
  const slot = `slot-${randomUUID()}`;
  const legacy = { id: slot, externalId: slot, idempotencyKey: `notif:${slot}`, appName: 'Revision test',
    packageName: 'example.revision.test', title: 'Order status', body: 'Preparing', timestamp: '2026-10-25T12:00:00Z',
    raw: { notificationKey: slot, postTime: 1792929600000 } };
  const post = (payload: unknown) => app.inject({ method: 'POST', url: '/api/v1/capture/notification', payload });
  try {
    assert.equal((await post(legacy)).statusCode, 201);
    const snapshots = [legacy, { ...legacy, body: 'Delivered' }, { ...legacy, raw: { ...legacy.raw, bigText: 'Expanded status' } }];
    for (const snapshot of snapshots) {
      // Opaque revision IDs follow the native producer's identity shape. The
      // route must treat all three identities as revision-scoped, not slot-scoped.
      const id = `notif:v2:${createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')}`;
      const payload = { ...snapshot, id, externalId: id, idempotencyKey: id };
      const created = await post(payload);
      assert.equal(created.statusCode, 201, created.body);
      const retry = await post(payload);
      assert.equal(retry.json().ingestion.outcome, 'duplicate');
      assert.equal(retry.json().id, id);
      const changedUnderSameIdentity = await post({ ...payload, body: 'Tampered evidence' });
      assert.equal(changedUnderSameIdentity.statusCode, 409, 'immutable evidence remains protected');
    }
    const original = (await pool.query('select body,raw from raw_events where id=$1', [slot])).rows[0];
    assert.equal(original.body, legacy.body);
    assert.equal(original.raw.notificationKey, slot);
    assert.equal((await pool.query(`select count(*)::int as n from raw_events where raw->>'notificationKey'=$1`, [slot])).rows[0].n, 4);
  } finally { await app.close(); }
});

test('promotion ingestion stores the evidence without adding a ledger entry', async () => {
  const app = await buildApp({ authConfig: { globalApiKey: null, clientKeys: new Map() } });
  try {
    for (const event of promotions.slice(0, 2)) {
      const result = await app.inject({ method: 'POST', url: '/api/v1/events', payload: event });
      assert.equal(result.statusCode, 201, result.body);
      assert.equal(result.json().inferredKind, 'notification');
      assert.equal((await pool.query('select count(*)::int as n from financial_transaction_events where raw_event_id=$1', [event.id])).rows[0].n, 0);
    }
    // An explicit human decision remains authoritative even when the original
    // text looks promotional. Classification safety must not erase that choice.
    const event = promotions[0];
    await withTransaction(async db => {
      await recordCorrection(db, { eventId: event.id, clientId: null, field: 'inferredKind', value: 'expense', reusable: false });
      await recordCorrection(db, { eventId: event.id, clientId: null, field: 'merchant', value: 'Burger Time', reusable: false });
    });
    const corrected = await classifyCapturedEvent(event.id);
    assert.equal(corrected?.inferredKind, 'expense');
    assert.equal(corrected?.confidence, 1);
    assert.equal((await pool.query('select count(*)::int as n from financial_transaction_events where raw_event_id=$1', [event.id])).rows[0].n, 1);
  } finally { await app.close(); }
});
