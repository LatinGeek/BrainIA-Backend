import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, fingerprint, fingerprintInput, sha256 } from './canonical.mjs';
const dir = path.dirname(fileURLToPath(import.meta.url));
const fixtures = { synthetic: true, revision: 'B02-r3', schemaCases: [], canonicalCases: [], acknowledgementCases: [], identitySequences: [], policyCases: [], groundingCases: [], moneyCases: [], deferredCases: [], callbackCases: [] };
const clone = value => structuredClone(value);
const uuid = i => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const hash = 'a'.repeat(64);
const envelope = {
  contractVersion: 2,
  deliveryId: uuid(1),
  sourceInstanceId: 'src_device_notifications',
  sourceObservationKey: 'instance:generation-1',
  producerRevisionId: uuid(2),
  producerSequence: '1',
  changeKind: 'posted',
  canonicalizationVersion: 'jcs-sha256-v1',
  sourceOccurredAt: '2026-10-15T12:00:00-03:00',
  sourceUpdatedAt: null,
  deviceObservedAt: '2026-10-15T15:01:01Z',
  content: {
    type: 'notification',
    packageName: 'example.bank',
    title: 'Compra - caf\u00e9 \ud83d\ude80',
    body: 'Pagaste UYU 125,50 en Pe\u00f1arol \ud83d\uded2',
    raw: { packageName: 'example.bank', title: 'Compra', body: 'UYU 125,50' }
  }
};
const sign = e => ({ ...e, contentFingerprint: fingerprint(e) });
const base = sign(envelope);
const receipt = { contractVersion: 2, deliveryId: base.deliveryId, receiptId: 'receipt_1', observationId: 'obs_1', revisionId: 'rev_1', revisionNumber: 1, producerRevisionId: base.producerRevisionId, contentFingerprint: base.contentFingerprint, disposition: 'stored', receivedAt: '2026-10-15T15:01:02Z', processing: 'queued', policyVersion: 1 };
const sc = (name, schema, value, valid, reason = '') => fixtures.schemaCases.push({ name, schema, value, valid, reason });
sc('new-notification', 'Envelope', base, true);
for (const [name, content] of [
  ['note', { type: 'note', title: null, body: '\u00e9 \ud83d\ude00 a', raw: {} }],
  ['receipt', { type: 'receipt', title: null, body: 'UYU 125.50', merchantText: 'Comercio', reference: null, attachmentRefs: [], raw: { amount: '125.50', currency: 'UYU', merchant: 'Comercio', transactionType: 'purchase' } }],
  ['location', { type: 'location', title: null, body: null, raw: {}, latitude: '-34.9011', longitude: '-56.1645', accuracyMeters: '12.5', intervalStart: '2026-10-15T15:00:00Z', intervalEnd: '2026-10-15T15:01:00Z', provider: 'synthetic' }],
  ['activity', { type: 'activity', title: null, body: null, raw: {}, activityMarker: 'observed', signalTypes: ['walking', 'transit'], interval: { start: '2026-10-15T15:00:00Z', end: '2026-10-15T15:20:00Z' }, confidence: 0.82 }],
  ['email', { type: 'email', title: 'Hola', body: 'Cuerpo', raw: {}, providerMessageId: 'msg_1', providerThreadId: null, sender: { address: 'sender@example.com', displayName: 'Remitente' }, recipients: [{ address: 'owner@example.com' }], attachmentRefs: [] }]
]) sc(name, 'Envelope', sign({ ...base, content }), true);
sc('receipt', 'Receipt', receipt, true);
sc('batch-request', 'BatchRequest', { contractVersion: 2, items: [base] }, true);
sc('batch-empty', 'BatchRequest', { contractVersion: 2, items: [] }, false);
sc('batch-count-max', 'BatchRequest', { contractVersion: 2, items: Array.from({ length: 100 }, () => base) }, true);
sc('batch-count-limit', 'BatchRequest', { contractVersion: 2, items: Array.from({ length: 101 }, () => base) }, false);
const large = sign({ ...base, content: { ...base.content, body: 'x'.repeat(25000) } });
sc('batch-byte-limit', 'BatchRequest', { contractVersion: 2, items: Array.from({ length: 50 }, () => large) }, false);
sc('duplicate-receipt', 'Receipt', { ...receipt, disposition: 'duplicate' }, true);
function bad(name, mutate, reason) { const e = clone(base); mutate(e); sc(name, 'Envelope', e, false, reason); }
bad('unknown-owner', e => e.owner_id = 'other', 'additional field');
bad('legacy-contract', e => e.contractVersion = 1, 'v1 is not v2');
bad('numeric-sequence', e => e.producerSequence = 1, 'must be string');
bad('int64-overflow', e => e.producerSequence = '9223372036854775808', 'semantic int64 bound');
bad('zero-sequence', e => e.producerSequence = '0', 'positive only');
bad('fingerprint-mismatch', e => e.content.body = 'tampered', 'recomputed hash');
bad('timezone-missing', e => e.deviceObservedAt = '2026-10-15T15:00:00', 'offset required');
bad('invalid-date', e => e.deviceObservedAt = '2026-02-30T15:00:00Z', 'calendar date');
bad('missing-source-time', e => delete e.sourceUpdatedAt, 'required nullable field');
bad('unknown-content-field', e => e.content.amount = '125.50', 'strict variant');
bad('wrong-variant-field', e => { e.content.type = 'note'; e.contentFingerprint = fingerprint(e); }, 'notification field not note');
bad('invalid-email', e => { e.content = { type: 'email', title: null, body: null, raw: {}, providerMessageId: 'p', providerThreadId: null, sender: { address: 'not-an-email' }, recipients: [], attachmentRefs: [] }; e.contentFingerprint = fingerprint(e); }, 'RFC 5322 address');
bad('invalid-activity-marker', e => { e.content = { type: 'activity', title: null, body: null, raw: {}, activityMarker: 'guessed', signalTypes: ['walking'], interval: { start: '2026-10-15T15:00:00Z', end: '2026-10-15T15:01:00Z' }, confidence: 0.5 }; e.contentFingerprint = fingerprint(e); }, 'marker enum');
bad('unknown-signal-type', e => { e.content = { type: 'activity', title: null, body: null, raw: {}, activityMarker: 'inferred', signalTypes: ['teleporting'], interval: { start: '2026-10-15T15:00:00Z', end: '2026-10-15T15:01:00Z' }, confidence: 0.5 }; e.contentFingerprint = fingerprint(e); }, 'closed signal allowlist');
bad('activity-interval-order', e => { e.content = { type: 'activity', title: null, body: null, raw: {}, activityMarker: 'observed', signalTypes: ['walking'], interval: { start: '2026-10-15T15:01:00Z', end: '2026-10-15T15:00:00Z' }, confidence: 0.5 }; e.contentFingerprint = fingerprint(e); }, 'interval end before start');
bad('raw-credential-key', e => { e.content.raw = { token: 'secret' }; e.contentFingerprint = fingerprint(e); }, 'raw allowlist');
bad('raw-not-allowed-for-note', e => { e.content = { type: 'note', title: null, body: null, raw: { anything: 'x' } }; e.contentFingerprint = fingerprint(e); }, 'raw empty for note');
bad('attachment-receipt-nonempty', e => { e.content = { type: 'receipt', title: null, body: null, raw: {}, merchantText: null, reference: null, attachmentRefs: [{ refId: 'att_1' }] }; e.contentFingerprint = fingerprint(e); }, 'receipt attachments must be empty until connector approval');
bad('attachment-email-nonempty', e => { e.content = { type: 'email', title: null, body: null, raw: {}, providerMessageId: 'p', providerThreadId: null, sender: { address: 'sender@example.com' }, recipients: [], attachmentRefs: [{ refId: 'att_1' }] }; e.contentFingerprint = fingerprint(e); }, 'email attachments must be empty until connector approval');
bad('utf8-title-limit', e => { e.content.title = '\ud83d\ude00'.repeat(257); e.contentFingerprint = fingerprint(e); }, '1028 UTF-8 bytes');
bad('utf8-body-limit', e => { e.content.body = '\u00f1'.repeat(24577); e.contentFingerprint = fingerprint(e); }, '49154 UTF-8 bytes');
bad('item-byte-limit', e => { e.content.raw = { body: 'x'.repeat(65536) }; e.contentFingerprint = fingerprint(e); }, 'full envelope exceeds 64KiB');
bad('location-range', e => { e.content = { type: 'location', title: null, body: null, raw: {}, latitude: '91', longitude: '0', accuracyMeters: '0', intervalStart: '2026-10-15T15:00:00Z', intervalEnd: '2026-10-15T15:01:00Z', provider: 'synthetic' }; e.contentFingerprint = fingerprint(e); }, 'latitude beyond physical range');
for (const value of ['125.50', '0', '-25.50', '999999999999999999.999999']) sc('decimal-' + value, 'Decimal', value, true);
for (const value of [125.5, '01.5', '1e2', 'NaN', 'Infinity', '1.1234567', '+1', '.5', '1,25', '1234567890123456789']) sc('invalid-decimal-' + value, 'Decimal', value, false);
sc('conversion-rate-precision', 'ConversionRate', '123456789012.123456789012', true);
sc('conversion-rate-too-precise', 'ConversionRate', '1.1234567890123', false);
const summary = { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z', asOf: '2026-10-15T15:01:02Z', totals: [{ currency: 'UYU', income: '0.00', expense: '125.50', refunds: '25.50', net: '-100.00', transactionCount: 1 }, { currency: 'USD', income: '10.00', expense: '0.00', refunds: '0.00', net: '10.00', transactionCount: 1 }], excluded: { ambiguous: 1, unsupported: 1, pending: 1 }, conversion: null };
sc('original-currency-refund-summary', 'FinancialSummary', summary, true);
sc('numeric-money', 'FinancialSummary', { ...summary, totals: [{ ...summary.totals[0], expense: 125.5 }] }, false);
const summaryQuery = { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' };
sc('summary-query-range', 'FinancialSummaryQuery', summaryQuery, true);
sc('summary-query-max-range', 'FinancialSummaryQuery', { from: '2026-01-01T00:00:00Z', to: '2027-01-02T00:00:00Z' }, true);
sc('summary-query-reversed-range', 'FinancialSummaryQuery', { from: '2026-11-01T00:00:00Z', to: '2026-10-01T00:00:00Z' }, false, 'from after to');
sc('summary-query-too-long', 'FinancialSummaryQuery', { from: '2026-01-01T00:00:00Z', to: '2027-01-03T00:00:00Z' }, false, 'range exceeds 366 days');
sc('summary-query-conversion', 'FinancialSummaryQuery', { ...summaryQuery, conversionTo: 'USD', fxRateId: 'fx_1' }, true);
sc('summary-query-conversion-without-rate', 'FinancialSummaryQuery', { ...summaryQuery, conversionTo: 'USD' }, false, 'conversionTo requires fxRateId');
sc('summary-query-unsupported-currency', 'FinancialSummaryQuery', { ...summaryQuery, conversionTo: 'ZZZ', fxRateId: 'fx_1' }, false, 'currency outside approved registry');
sc('summary-query-owner-field', 'FinancialSummaryQuery', { ...summaryQuery, ownerId: 'other' }, false, 'strict query object');
sc('negative-base-magnitude', 'Magnitude', '-1.00', false);
sc('partial-batch', 'BatchResponse', { results: [{ index: 0, deliveryId: base.deliveryId, status: 201, receipt }, { index: 1, deliveryId: null, status: 503, error: { code: 'unavailable', message: 'Retry later', requestId: 'req_1', retryable: true } }] }, true);
sc('batch-malformed-identity', 'BatchResponse', { results: [{ index: 0, deliveryId: null, status: 400, error: { code: 'invalid_request', message: 'Malformed identity', requestId: 'req_2', retryable: false } }, { index: 1, deliveryId: uuid(3), status: 201, receipt: { ...receipt, deliveryId: uuid(3) } }] }, true);
sc('malformed-2xx', 'Receipt', {}, false);
sc('wrong-receipt-version', 'Receipt', { ...receipt, contractVersion: 1 }, false);
sc('batch-success-with-error', 'BatchItem', { index: 0, deliveryId: base.deliveryId, status: 201, error: { code: 'unavailable', message: 'Retry', requestId: 'r', retryable: true } }, false);
for (const [code, status, retryable] of [['identity_conflict', 409, false], ['version_conflict', 409, false], ['rate_limited', 429, true], ['unavailable', 503, true], ['source_disabled', 403, false], ['not_found', 404, false], ['unsupported_currency', 422, false], ['oauth_state_invalid', 400, false]]) {
  sc('error-' + code, 'Error', { error: { code, message: 'Synthetic contract error', requestId: 'req_' + status, retryable } }, true);
}
sc('error-details-field-errors', 'Error', { error: { code: 'invalid_request', message: 'Validation failed', requestId: 'req_400', retryable: false, details: { kind: 'field_errors', fieldErrors: [{ field: 'content.title', code: 'too_long', expected: '1024 bytes', actual: '1028 bytes' }] } } }, true);
sc('error-details-retry', 'Error', { error: { code: 'rate_limited', message: 'Slow down', requestId: 'req_429', retryable: true, details: { kind: 'retry', retryAfterSeconds: 30 } } }, true);
sc('error-details-conflict', 'Error', { error: { code: 'version_conflict', message: 'Stale', requestId: 'req_409', retryable: false, details: { kind: 'conflict', conflictId: 'conflict_1' } } }, true);
sc('error-details-blocked', 'Error', { error: { code: 'forbidden', message: 'Blocked', requestId: 'req_403', retryable: false, details: { kind: 'blocked_category', blockedCategory: 'connectors' } } }, true);
sc('error-details-free-form', 'Error', { error: { code: 'invalid_request', message: 'Bad', requestId: 'req_400', retryable: false, details: { anything: 'goes' } } }, false);
sc('policy-private', 'PolicyRequest', { expectedVersion: 1, enabled: true, externalModelsAllowed: false, externalEmbeddingsAllowed: false, retentionDays: null }, true);
sc('policy-inconsistent', 'PolicyRequest', { expectedVersion: 1, enabled: true, externalModelsAllowed: false, externalEmbeddingsAllowed: true, retentionDays: null }, false);
sc('deletion-all', 'DeletionRequest', { idempotencyKey: 'delete_1', scope: { all: true }, mode: 'all', expectedPolicyVersion: 1 }, true);
sc('deletion-mixed-scope', 'DeletionRequest', { idempotencyKey: 'delete_1', scope: { all: true, observationId: 'obs_1' }, mode: 'all', expectedPolicyVersion: 1 }, false);
sc('deletion-creation', 'DeletionCreationResponse', { deletionId: 'del_1', state: 'queued', createdAt: '2026-10-15T15:01:02Z', remainingCategories: [] }, true);
sc('deletion-state-blocked', 'DeletionState', { id: 'del_1', state: 'running', blockedAt: '2026-10-15T15:01:02Z', remainingCategories: ['raw_events', 'backups'] }, true);
sc('deletion-state-not-blocked', 'DeletionState', { id: 'del_1', state: 'completed', blockedAt: null, remainingCategories: [], completedAt: '2026-10-15T15:02:02Z', backupExpiryAt: '2026-11-14T15:02:02Z' }, true);
sc('deletion-state-bad-category', 'DeletionState', { id: 'del_1', state: 'running', blockedAt: null, remainingCategories: ['everything'] }, false);
sc('capabilities-resolved', 'Capabilities', { apiVersion: '2.0.0', captureVersions: [1, 2], maxBatchItems: 100, maxItemBytes: 65536, maxBatchBytes: 1048576, currencyRegistryVersion: 'ISO4217-CLDR-45', features: { observationRevisions: true, decimalFinance: true, email: false, activity: false, location: false, episodes: false, connectors: false }, policyVersion: 3 }, true);
sc('capabilities-email-enabled', 'Capabilities', { apiVersion: '2.0.0', captureVersions: [1, 2], maxBatchItems: 100, maxItemBytes: 65536, maxBatchBytes: 1048576, currencyRegistryVersion: 'ISO4217-CLDR-45', features: { observationRevisions: true, decimalFinance: true, email: true, activity: false, location: false, episodes: false, connectors: false }, policyVersion: 3 }, false);
sc('capabilities-old-batch-limit', 'Capabilities', { apiVersion: '2.0.0', captureVersions: [1, 2], maxBatchItems: 50, maxItemBytes: 65536, maxBatchBytes: 1048576, currencyRegistryVersion: 'ISO4217-CLDR-45', features: { observationRevisions: true, decimalFinance: true, email: false, activity: false, location: false, episodes: false, connectors: false }, policyVersion: 3 }, false);
// Observation detail and revision history.
const observationDetail = { observationId: 'obs_1', sourceInstanceId: 'src_device_notifications', sourceObservationKey: 'instance:generation-1', latestRevisionNumber: 2, latestRevisionId: 'rev_2', revisionCount: 2, contentType: 'notification', stage: 'succeeded', stageUpdatedAt: '2026-10-15T15:02:02Z', createdAt: '2026-10-15T15:01:02Z', updatedAt: '2026-10-15T15:02:02Z', deleted: false, revisionsCursor: 'cursor_rev_1' };
sc('observation-detail', 'ObservationDetail', observationDetail, true);
sc('observation-detail-owner', 'ObservationDetail', { ...observationDetail, ownerId: 'other' }, false);
const revision = { revisionId: 'rev_2', observationId: 'obs_1', revisionNumber: 2, producerRevisionId: base.producerRevisionId, producerSequence: '2', changeKind: 'updated', contentFingerprint: base.contentFingerprint, sourceOccurredAt: '2026-10-15T12:00:00-03:00', sourceUpdatedAt: null, deviceObservedAt: '2026-10-15T15:01:01Z', receivedAt: '2026-10-15T15:01:02Z', content: base.content, evidenceIds: ['ev_1'] };
sc('observation-revision', 'ObservationRevision', revision, true);
sc('observation-revision-extra-content', 'ObservationRevision', { ...revision, content: { ...base.content, token: 'x' } }, false);
sc('observation-revision-page', 'ObservationRevisionPage', { observationId: 'obs_1', items: [revision], nextCursor: null }, true);
sc('observation-revision-page-missing-id', 'ObservationRevisionPage', { items: [revision], nextCursor: null }, false);
const event = { eventId: 'evt_1', eventType: 'purchase', lifecycle: 'posted', version: 3, occurredStart: '2026-10-15T15:00:00Z', occurredEnd: null, timeUncertaintyMs: 60000, mergedIntoId: null, evidence: [{ observationId: 'obs_1', revisionId: 'rev_2', factId: 'fact_1', role: 'primary', strength: 'strong', active: true }], uncertainty: null, interpretations: [{ artifactId: 'art_1', revision: 1, kind: 'summary', text: 'Compra', confidence: 0.9, citationIds: ['ev_1'] }], reviewReasons: [], createdAt: '2026-10-15T15:01:02Z', updatedAt: '2026-10-15T15:02:02Z' };
sc('event', 'Event', event, true);
sc('event-invalid-lifecycle', 'Event', { ...event, lifecycle: 'settled' }, false);
const episode = { id: 'ep_1', type: 'purchase_delivery', version: 2, status: 'active', startAt: '2026-10-15T14:00:00Z', endAt: '2026-10-16T14:00:00Z', timeUncertaintyMs: 3600000, confidence: 0.8, members: [{ canonicalEventId: 'evt_1', revisionId: 'rev_2', role: 'primary', confidence: 0.9, evidenceIds: ['ev_1'] }], summary: { artifactId: 'art_1', revision: 1, text: 'Compra y entrega', citationIds: ['ev_1'] }, reviewReasons: [] };
sc('episode', 'Episode', episode, true);
sc('episode-bad-role', 'Episode', { ...episode, members: [{ ...episode.members[0], role: 'causal' }] }, false);
sc('episode-bad-interval', 'Episode', { ...episode, endAt: '2026-10-14T14:00:00Z' }, false, 'endAt before startAt');
sc('episode-detail', 'EpisodeDetail', { ...episode, priorRevisionIds: ['ep_0'], activeCorrectionIds: ['corr_1'] }, true);
sc('episode-detail-missing-history', 'EpisodeDetail', { ...episode }, false);
sc('episode-page', 'EpisodePage', { items: [episode], nextCursor: null }, true);
sc('episode-page-missing-cursor', 'EpisodePage', { items: [episode] }, false);
// Financial transactions.
const transaction = { id: 'txn_1', canonicalEventId: 'evt_1', version: 4, kind: 'expense', lifecycle: 'posted', amount: '125.50', currency: 'UYU', currencyStatus: 'confirmed', occurredAt: '2026-10-15T15:00:00Z', postedAt: '2026-10-15T15:05:00Z', merchant: { id: 'merchant_1', label: 'Comercio', verified: true }, accountId: 'acct_1', evidenceCount: 2, revisionCount: 2, evidence: [{ observationId: 'obs_1', revisionId: 'rev_2', factIds: ['fact_1'], role: 'charge', strength: 'strong' }], adjustments: [{ id: 'adj_1', kind: 'refund', amount: '25.50', currency: 'UYU', postedAt: '2026-10-16T15:00:00Z', reference: 'refund_1', lifecycle: 'posted' }], reviewReasons: [] };
sc('financial-transaction', 'FinancialTransaction', transaction, true);
sc('financial-transaction-negative-amount', 'FinancialTransaction', { ...transaction, amount: '-125.50' }, false);
sc('financial-transaction-page', 'FinancialTransactionPage', { asOf: '2026-10-15T15:01:02Z', items: [transaction], nextCursor: 'cursor_txn_2' }, true);
sc('financial-transaction-page-missing-asof', 'FinancialTransactionPage', { items: [transaction], nextCursor: null }, false);
// Corrections.
const correctionBase = { idempotencyKey: 'corr_1', target: { type: 'fact', id: 'fact_1', expectedVersion: 2 }, field: 'fact_value', value: { factType: 'decimal', value: '130.00' }, scope: 'once', ruleMatch: null };
sc('correction-fact', 'CorrectionRequest', correctionBase, true);
sc('correction-event', 'CorrectionRequest', { ...correctionBase, target: { type: 'event', id: 'evt_1', expectedVersion: 3 }, field: 'lifecycle', value: 'review' }, true);
sc('correction-transaction', 'CorrectionRequest', { ...correctionBase, target: { type: 'transaction', id: 'txn_1', expectedVersion: 4 }, field: 'merchant_label', value: 'Comercio Nuevo' }, true);
sc('correction-episode', 'CorrectionRequest', { ...correctionBase, target: { type: 'episode', id: 'ep_1', expectedVersion: 2 }, field: 'membership_include', value: { eventIds: ['evt_1'] } }, true);
sc('correction-rule', 'CorrectionRequest', { ...correctionBase, scope: 'rule', ruleMatch: { sourceInstanceId: 'src_device_notifications', exactDescriptor: 'Comercio' } }, true);
sc('correction-rule-missing-match', 'CorrectionRequest', { ...correctionBase, scope: 'rule', ruleMatch: null }, false);
sc('correction-unknown-field', 'CorrectionRequest', { ...correctionBase, field: 'any_sql' }, false);
sc('correction-response', 'CorrectionResponse', { correctionId: 'corr_1', version: 2, status: 'applied', reprocessing: 'queued', affectedCount: 1, reviewReasons: [] }, true);
sc('correction-response-bad-status', 'CorrectionResponse', { correctionId: 'corr_1', version: 2, status: 'maybe', reprocessing: 'queued', affectedCount: 1, reviewReasons: [] }, false);
// Export.
const exportResponse = { snapshotId: 'snap_1', items: [{ type: 'observation', id: 'obs_1', record: observationDetail }, { type: 'transaction', id: 'txn_1', record: transaction }, { type: 'artifact', id: 'art_1', record: { artifactId: 'art_1', kind: 'episode_summary', revision: 1, text: 'Compra y entrega', citationIds: ['ev_1'], createdAt: '2026-10-15T15:02:02Z' } }], nextCursor: null, expiresAt: '2026-10-15T16:01:02Z' };
sc('export-response', 'ExportResponse', exportResponse, true);
sc('export-unknown-type', 'ExportResponse', { ...exportResponse, items: [{ ...exportResponse.items[0], type: 'everything' }] }, false);
sc('export-extra-field', 'ExportResponse', { ...exportResponse, ownerId: 'other' }, false);
// Queries.
sc('query-request', 'QueryRequest', { query: 'Cuanto gasté en octubre?', maxEvidence: 30, externalSynthesisAllowed: false, filters: { sourceInstanceIds: ['src_device_notifications'], from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z', types: ['transaction', 'event'] } }, true);
sc('query-request-too-much-evidence', 'QueryRequest', { query: 'x', maxEvidence: 31, externalSynthesisAllowed: false, filters: {} }, false);
sc('query-request-bad-range', 'QueryRequest', { query: 'x', maxEvidence: 10, externalSynthesisAllowed: false, filters: { from: '2026-11-01T00:00:00Z', to: '2026-10-01T00:00:00Z' } }, false, 'from after to');
const queryBase = { queryId: 'qry_1', modelCalls: 2, elapsedMs: 1200 };
sc('query-pending', 'QueryResult', { ...queryBase, status: 'running', answer: null, structuredTotals: null, evidence: [], claims: [], limitations: [], coverage: null, failure: null }, true);
sc('query-completed', 'QueryResult', { ...queryBase, status: 'completed', answer: 'Gastaste UYU 100,00.', structuredTotals: [{ currency: 'UYU', total: '100.00', transactionCount: 1, from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' }], evidence: [{ id: 'ev_1', observationId: 'obs_1', revisionId: 'rev_2', factId: 'fact_1', pointer: '/content/body', permittedExcerpt: 'Pagaste UYU 125,50' }], claims: [{ text: 'Gastaste UYU 100,00.', citationIds: ['ev_1'], verification: 'supported' }], limitations: [], coverage: { exhaustive: true, retrievalStrategies: ['sql', 'fts'], timeRange: { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' } }, failure: null }, true);
sc('query-review', 'QueryResult', { ...queryBase, status: 'review', answer: null, structuredTotals: null, evidence: [], claims: [{ text: 'Posible compra', citationIds: ['ev_1'], verification: 'uncertain' }], limitations: ['Ambiguous merchant'], coverage: { exhaustive: false, retrievalStrategies: ['fts'], timeRange: { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' } }, failure: null }, true);
sc('query-failed', 'QueryResult', { ...queryBase, status: 'failed', answer: null, structuredTotals: null, evidence: [], claims: [], limitations: [], coverage: null, failure: { code: 'unavailable', message: 'Retry later', retryable: true } }, true);
sc('query-completed-null-answer', 'QueryResult', { ...queryBase, status: 'completed', answer: null, structuredTotals: null, evidence: [], claims: [], limitations: [], coverage: null, failure: null }, false);
sc('query-accepted', 'QueryAccepted', { queryId: 'qry_1', status: 'queued' }, true);
sc('query-accepted-bad-status', 'QueryAccepted', { queryId: 'qry_1', status: 'completed' }, false);
// Email connector.
sc('email-authorize-request', 'EmailAuthorizeRequest', { provider: 'gmail', returnRoute: 'brainia://connectors/email/callback', historyDays: 30 }, true);
sc('email-authorize-request-bad-history', 'EmailAuthorizeRequest', { provider: 'gmail', returnRoute: 'brainia://connectors/email/callback', historyDays: 0 }, false);
sc('email-authorize-response', 'EmailAuthorizeResponse', { provider: 'gmail', authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=synthetic', stateExpiresAt: '2026-10-15T15:11:02Z', scopes: ['https://www.googleapis.com/auth/gmail.readonly'], returnRoute: 'brainia://connectors/email/callback' }, true);
sc('email-authorize-response-insecure', 'EmailAuthorizeResponse', { provider: 'gmail', authorizationUrl: 'http://accounts.google.com/o/oauth2/v2/auth', stateExpiresAt: '2026-10-15T15:11:02Z', scopes: ['https://www.googleapis.com/auth/gmail.readonly'], returnRoute: 'brainia://connectors/email/callback' }, false);
sc('connector-revoke-request', 'ConnectorRevokeRequest', { expectedVersion: 2, deleteCapturedData: true }, true);
sc('connector-revoke-request-missing-version', 'ConnectorRevokeRequest', { deleteCapturedData: true }, false);
sc('connector-revoke-response', 'ConnectorRevokeResponse', { connectorId: 'conn_1', status: 'revoked', version: 3, revokedAt: '2026-10-15T15:01:02Z', deleteCapturedData: true, deletionId: 'del_1' }, true);
sc('connector-revoke-response-bad-status', 'ConnectorRevokeResponse', { connectorId: 'conn_1', status: 'active', version: 3, revokedAt: '2026-10-15T15:01:02Z', deleteCapturedData: true, deletionId: null }, false);
// Callback query shape and 302 redirect outcomes.
sc('email-callback-code', 'EmailCallbackQuery', { code: 'oauth_code_1', state: 'state_1' }, true);
sc('email-callback-provider-error', 'EmailCallbackQuery', { error: 'access_denied', state: 'state_1' }, true);
sc('email-callback-missing-state', 'EmailCallbackQuery', { code: 'oauth_code_1' }, false);
sc('email-callback-missing-code-and-error', 'EmailCallbackQuery', { state: 'state_1' }, false, 'exactly one of code or error');
sc('email-callback-code-and-error', 'EmailCallbackQuery', { code: 'oauth_code_1', error: 'access_denied', state: 'state_1' }, false, 'code and error are exclusive');
fixtures.callbackCases = [
  { name: 'success-redirect', status: 302, query: { code: 'oauth_code_1', state: 'state_1' }, location: 'brainia://connectors/email/callback?connectorId=conn_1&status=success', valid: true },
  { name: 'provider-error-redirect', status: 302, query: { error: 'access_denied', state: 'state_1' }, location: 'brainia://connectors/email/callback?status=error', valid: true },
  { name: 'missing-state', status: 400, query: { code: 'oauth_code_1' }, location: null, valid: false },
  { name: 'missing-code-and-error', status: 400, query: { state: 'state_1' }, location: null, valid: false },
  { name: 'code-and-error', status: 400, query: { code: 'oauth_code_1', error: 'access_denied', state: 'state_1' }, location: null, valid: false },
  { name: 'insecure-location', status: 302, query: { code: 'oauth_code_1', state: 'state_1' }, location: 'https://evil.example/callback', valid: false }
];
// Facts.
const factBase = { id: 'fact_1', field: 'amount', revisionId: 'rev_2', evidence: { pointer: '/content/body', start: 8, end: 18, excerptHash: hash }, method: 'deterministic', extractorVersion: 'extractor_1', modelRevision: null, confidence: 0.95, uncertainty: null, validationStatus: 'validated', userCorrectionStatus: 'none', visibility: 'visible' };
sc('fact-decimal', 'Fact', { ...factBase, factType: 'decimal', value: '125.50' }, true);
sc('fact-entity-ref', 'Fact', { ...factBase, factType: 'entity_ref', value: { entityId: 'ent_1', entityType: 'merchant', label: 'Comercio' } }, true);
sc('fact-span-unpaired', 'Fact', { ...factBase, evidence: { ...factBase.evidence, end: null }, factType: 'string', value: 'x' }, false);
sc('fact-free-form-value', 'Fact', { ...factBase, factType: 'string', value: { any: 'x' } }, false);
sc('fact-bad-confidence', 'Fact', { ...factBase, factType: 'string', value: 'x', confidence: 1.5 }, false);
sc('fact-bad-visibility', 'Fact', { ...factBase, factType: 'string', value: 'x', visibility: 'public' }, false);
// Exact bytes and hashes are stored, never regenerated by verify.
for (const [name, input] of [
  ['fingerprint-unicode', fingerprintInput(base)],
  ['jcs-order-and-numbers', { '\u20ac': 'euro', '\r': 'CR', '\u05d0': 'Hebrew', '1': 'one', '\ud83d\ude00': 'astral', '\u00f1': 'n', '\u0080': 'control', numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 1e-27, -0] }],
  ['composed', { text: '\u00e9' }],
  ['decomposed', { text: 'e\u0301' }]
]) {
  const bytes = canonical(input);
  fixtures.canonicalCases.push({ name, input, canonical: bytes, utf8Hex: Buffer.from(bytes).toString('hex'), sha256: sha256(bytes) });
}
fixtures.canonicalCases.push({ name: 'lone-surrogate', input: '\ud800', invalid: true });
for (const [name, r, status, accepted] of [['matched', receipt, 201, true], ['replay', receipt, 200, true], ['arbitrary-2xx', {}, 204, false], ['wrong-delivery', { ...receipt, deliveryId: uuid(90) }, 200, false], ['wrong-revision', { ...receipt, producerRevisionId: uuid(90) }, 200, false], ['wrong-hash', { ...receipt, contentFingerprint: '0'.repeat(64) }, 200, false], ['conflict', receipt, 409, false]]) fixtures.acknowledgementCases.push({ name, envelope: base, receipt: r, status, accepted });
const b = sign({ ...base, deliveryId: uuid(3), producerRevisionId: uuid(4), producerSequence: '2', changeKind: 'updated', content: { ...base.content, body: 'B' } });
const a = sign({ ...base, deliveryId: uuid(5), producerRevisionId: uuid(6), producerSequence: '3', changeKind: 'updated' });
const removed = sign({ ...a, deliveryId: uuid(7), producerRevisionId: uuid(8), producerSequence: '4', changeKind: 'removed' });
fixtures.identitySequences = [
  { name: 'exact-replay', items: [base, base], expected: { revisionCount: 1, observationCount: 1, latestSequence: '1', statuses: [201, 200] } },
  { name: 'new-delivery-duplicate', items: [base, { ...base, deliveryId: uuid(9) }], expected: { revisionCount: 1, observationCount: 1, latestSequence: '1', statuses: [201, 200] } },
  { name: 'update-A-B-A-removed', items: [base, b, a, removed], expected: { revisionCount: 4, observationCount: 1, latestSequence: '4', statuses: [201, 201, 201, 201] } },
  { name: 'reordered', items: [b, base], expected: { revisionCount: 2, observationCount: 1, latestSequence: '2', statuses: [201, 201] } },
  { name: 'reused-key-new-generation', items: [base, sign({ ...base, sourceObservationKey: 'instance:generation-2', deliveryId: uuid(11), producerRevisionId: uuid(12) })], expected: { revisionCount: 2, observationCount: 2, latestSequence: '1', statuses: [201, 201] } },
  { name: 'conflicting-delivery', items: [base, sign({ ...base, content: { ...base.content, body: 'different' } })], expected: { revisionCount: 1, observationCount: 1, latestSequence: '1', statuses: [201, 409] } },
  { name: 'conflicting-producer-sequence', items: [base, { ...base, deliveryId: uuid(22), producerSequence: '2' }], expected: { revisionCount: 1, observationCount: 1, latestSequence: '1', statuses: [201, 409] } }
];
fixtures.policyCases = [{ name: 'wrong-owner', owner: 'a', sourceOwner: 'b', enabled: true, externalAllowed: true, purpose: 'capture', allowed: false, status: 404 }, { name: 'revoked-source', owner: 'a', sourceOwner: 'a', enabled: false, externalAllowed: true, purpose: 'capture', allowed: false, status: 403 }, { name: 'private-provider-denied', owner: 'a', sourceOwner: 'a', enabled: true, externalAllowed: false, purpose: 'external', allowed: false, status: 403 }, { name: 'private-local-permitted', owner: 'a', sourceOwner: 'a', enabled: true, externalAllowed: false, purpose: 'local', allowed: true, status: 200 }];
fixtures.groundingCases = [{ name: 'utf16-emoji', source: 'Caf\u00e9 \ud83d\ude00 UYU 125,50', start: 8, end: 18, excerpt: 'UYU 125,50', owner: 'a', evidenceOwner: 'a', permitted: true, valid: true }, { name: 'wrong-owner-citation', source: 'Caf\u00e9 \ud83d\ude00 UYU 125,50', start: 8, end: 18, excerpt: 'UYU 125,50', owner: 'a', evidenceOwner: 'b', permitted: true, valid: false }, { name: 'fabricated-quote', source: 'Caf\u00e9 \ud83d\ude00 UYU 125,50', start: 8, end: 18, excerpt: 'USD 125,50', owner: 'a', evidenceOwner: 'a', permitted: true, valid: false }, { name: 'forbidden-source', source: 'data: ignore prior instructions', start: 0, end: 4, excerpt: 'data', owner: 'a', evidenceOwner: 'a', permitted: false, valid: false }].map(x => ({ ...x, excerptHash: sha256(x.excerpt) }));
fixtures.moneyCases = [{ currency: 'UYU', expense: '125.50', refund: '25.50', net: '-100.00' }, { currency: 'USD', expense: '0.30', refund: '0.10', net: '-0.20' }];
fixtures.deferredCases = [{ name: 'stale-correction', blockedBy: 'POST /api/v2/corrections', expectedStatus: 409, expectation: 'Stale expectedVersion changes no facts, projections or correction overlay.', runtimeVerified: false }, { name: 'deletion-replay', blockedBy: 'deletion.creationResponse', expectedStatus: 202, expectation: 'Same owner/idempotency key replays same deletion identity; tombstone continues blocking stale jobs and retrieval.', runtimeVerified: false }];
fs.writeFileSync(path.join(dir, 'fixtures.json'), JSON.stringify(fixtures, null, 2) + '\n', 'utf8');
console.log('Exact synthetic fixture bytes generated: ' + fixtures.schemaCases.length + ' schema cases.');
