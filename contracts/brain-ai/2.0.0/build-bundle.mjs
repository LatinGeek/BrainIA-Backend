// Maintainer-only regeneration; requires Ajv 8.20.0, ajv-formats 3.0.1 and esbuild.
// Verification itself uses only Node built-ins and the checked-in standalone validators.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standalone from 'ajv/dist/standalone/index.js';
import { build } from 'esbuild';
const dir = path.dirname(fileURLToPath(import.meta.url));
const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2) + '\n', 'utf8');
const ref = name => ({ $ref: `#/$defs/${name}` });
const str = { type: 'string' }, bool = { type: 'boolean' };
const nullable = s => ({ anyOf: [s, { type: 'null' }] });
const en = (...values) => ({ enum: values });
const arr = items => ({ type: 'array', items });
const obj = (properties, optional = []) => ({ type: 'object', properties, required: Object.keys(properties).filter(k => !optional.includes(k)), additionalProperties: false });
const int = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const emptyRaw = { type: 'object', properties: {}, additionalProperties: false };
const defs = {
  Id: { type: 'string', minLength: 1, maxLength: 160 },
  UUID: { type: 'string', format: 'uuid' },
  Timestamp: { type: 'string', format: 'date-time', pattern: '(Z|[+-][0-9]{2}:[0-9]{2})$' },
  UTC: { type: 'string', format: 'date-time', pattern: 'Z$' },
  // Owner-approved decimal bounds: at most 18 integer digits and 6 fractional digits.
  Decimal: { type: 'string', pattern: '^-?(0|[1-9][0-9]{0,17})(\\.[0-9]{1,6})?$' },
  Magnitude: { type: 'string', pattern: '^(0|[1-9][0-9]{0,17})(\\.[0-9]{1,6})?$' },
  // Separate FX rate DTO: at most 12 fractional digits (storage NUMERIC(24,12)).
  ConversionRate: { type: 'string', pattern: '^-?(0|[1-9][0-9]{0,11})(\\.[0-9]{1,12})?$' },
  Currency: { type: 'string', pattern: '^[A-Z]{3}$' },
  // Confirmed subset of the approved ISO 4217/CLDR registry. Only UYU and USD
  // have confirmed summary semantics; unsupported/other codes are rejected.
  CurrencyRegistry: en('USD', 'UYU'),
  Hash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
  Version: { type: 'integer', minimum: 1, maximum: 2147483647 },
  Count: { type: 'integer', minimum: 0, maximum: 2147483647 },
  Cursor: { type: 'string', minLength: 1, maxLength: 512 },
  ContentType: en('notification', 'email', 'receipt', 'note', 'activity', 'location'),
  Stage: en('captured', 'queued', 'running', 'succeeded', 'review', 'retry_scheduled', 'dead_letter', 'cancelled'),
  EventType: en('purchase', 'payment', 'income', 'transfer', 'refund', 'adjustment', 'delivery', 'appointment', 'communication', 'other'),
  EventLifecycle: en('observed', 'authorized', 'pending', 'declined', 'posted', 'review', 'reversed', 'expired', 'cancelled'),
  TransactionKind: en('expense', 'income', 'transfer'),
  TransactionLifecycle: en('observed', 'authorized', 'pending', 'declined', 'posted', 'review', 'reversed', 'expired', 'cancelled'),
  CurrencyStatus: en('confirmed', 'ambiguous', 'unsupported', 'pending', 'unknown'),
  EpisodeType: en('shopping', 'work', 'research', 'travel', 'purchase_delivery', 'appointment'),
  EpisodeStatus: en('proposed', 'active', 'closed', 'review', 'retired'),
  MembershipRole: en('primary', 'supporting', 'context'),
  EvidenceRole: en('charge', 'refund', 'reversal', 'authorization', 'settlement', 'context'),
  EvidenceStrength: en('strong', 'medium', 'weak'),
  ExportType: en('observation', 'revision', 'fact', 'correction', 'event', 'transaction', 'episode', 'artifact'),
  DeletionCategory: en('raw_events', 'derived_knowledge', 'embeddings', 'financial_records', 'connectors', 'backups'),
  QueryStatus: en('queued', 'running', 'completed', 'review', 'failed'),
  QueryEvidenceType: en('observation', 'event', 'fact', 'transaction', 'episode'),
  RetrievalStrategy: en('sql', 'fts', 'vector', 'graph'),
  FactField: en('merchant', 'amount', 'currency', 'occurred_at', 'posted_at', 'description', 'account', 'category', 'reference', 'title', 'sender', 'recipient', 'location', 'activity', 'entity', 'quantity', 'unit', 'status'),
  CorrectionField: en('fact_value', 'event_type', 'lifecycle', 'occurred_start', 'occurred_end', 'merchant_label', 'category', 'account_id', 'amount', 'currency', 'occurred_at', 'posted_at', 'kind', 'membership_include', 'membership_exclude', 'split', 'merge'),
  AuthorizationScope: en('https://www.googleapis.com/auth/gmail.readonly'),
  EmailReturnRoute: en('brainia://connectors/email/callback')
};
// Raw payloads are limited to the two owner-approved source allowlists.
const rawNotification = obj({ packageName: str, title: str, body: str }, ['packageName', 'title', 'body']);
const rawWallet = obj({ amount: str, currency: str, merchant: str, transactionType: str }, ['amount', 'currency', 'merchant', 'transactionType']);
const common = { type: str, title: nullable(str), body: nullable(str), raw: emptyRaw };
defs.Notification = obj({ ...common, type: { const: 'notification' }, raw: rawNotification, packageName: { type: 'string', minLength: 1 } });
defs.Note = obj({ ...common, type: { const: 'note' } });
defs.AttachmentRef = obj({ refId: ref('Id'), provider: ref('Id'), mimeType: str, sizeBytes: { type: 'integer', minimum: 0, maximum: 1000000000000 }, sha256: ref('Hash'), expiresAt: ref('UTC') }, ['provider', 'mimeType', 'sizeBytes', 'sha256', 'expiresAt']);
defs.ReceiptContent = obj({ ...common, type: { const: 'receipt' }, raw: rawWallet, merchantText: nullable(str), reference: nullable(str), attachmentRefs: { type: 'array', maxItems: 0, items: ref('AttachmentRef') } });
defs.EmailAddress = obj({ address: { type: 'string', format: 'email', maxLength: 320 }, displayName: { type: 'string', maxLength: 256 } }, ['displayName']);
defs.Email = obj({ ...common, type: { const: 'email' }, providerMessageId: ref('Id'), providerThreadId: nullable(ref('Id')), sender: ref('EmailAddress'), recipients: { type: 'array', maxItems: 100, items: ref('EmailAddress') }, attachmentRefs: { type: 'array', maxItems: 0, items: ref('AttachmentRef') } });
defs.ActivitySignalType = en('still', 'walking', 'running', 'cycling', 'driving', 'transit', 'unknown');
defs.ActivityInterval = obj({ start: ref('Timestamp'), end: ref('Timestamp') });
defs.Activity = obj({ ...common, type: { const: 'activity' }, activityMarker: en('observed', 'inferred'), signalTypes: { type: 'array', minItems: 1, maxItems: 8, uniqueItems: true, items: ref('ActivitySignalType') }, interval: ref('ActivityInterval'), confidence: { type: 'number', minimum: 0, maximum: 1 } });
defs.Location = obj({ ...common, type: { const: 'location' }, latitude: ref('Decimal'), longitude: ref('Decimal'), accuracyMeters: ref('Magnitude'), intervalStart: ref('Timestamp'), intervalEnd: ref('Timestamp'), provider: ref('Id') });
defs.Content = { oneOf: ['Notification', 'Note', 'ReceiptContent', 'Email', 'Activity', 'Location'].map(ref) };
defs.Envelope = obj({ contractVersion: { const: 2 }, deliveryId: ref('UUID'), sourceInstanceId: ref('Id'), sourceObservationKey: { type: 'string', minLength: 1, maxLength: 512 }, producerRevisionId: ref('UUID'), producerSequence: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' }, changeKind: en('posted', 'updated', 'removed', 'imported'), canonicalizationVersion: { const: 'jcs-sha256-v1' }, contentFingerprint: ref('Hash'), sourceOccurredAt: nullable(ref('Timestamp')), sourceUpdatedAt: nullable(ref('Timestamp')), deviceObservedAt: ref('Timestamp'), content: ref('Content') });
defs.Receipt = obj({ contractVersion: { const: 2 }, deliveryId: ref('UUID'), receiptId: ref('Id'), observationId: ref('Id'), revisionId: ref('Id'), revisionNumber: ref('Version'), producerRevisionId: ref('UUID'), contentFingerprint: ref('Hash'), disposition: en('stored', 'duplicate'), receivedAt: ref('UTC'), processing: { const: 'queued' }, policyVersion: ref('Version') });
// Error details are a strict discriminated union; no free-form object is accepted.
defs.ErrorFieldError = obj({ field: { type: 'string', minLength: 1, maxLength: 512 }, code: en('required', 'invalid', 'unknown', 'too_long', 'unsupported'), expected: nullable(str), actual: nullable(str) });
defs.ErrorDetails = { oneOf: [
  obj({ kind: { const: 'field_errors' }, fieldErrors: { type: 'array', minItems: 1, maxItems: 100, items: ref('ErrorFieldError') } }),
  obj({ kind: { const: 'retry' }, retryAfterSeconds: int(1, 86400) }),
  obj({ kind: { const: 'conflict' }, conflictId: ref('Id') }),
  obj({ kind: { const: 'blocked_category' }, blockedCategory: ref('DeletionCategory') })
] };
defs.ErrorObject = obj({ code: en('invalid_request', 'unauthenticated', 'forbidden', 'not_found', 'identity_conflict', 'version_conflict', 'payload_too_large', 'unsupported_contract', 'fingerprint_mismatch', 'rate_limited', 'unavailable', 'source_disabled', 'export_snapshot_expired', 'unsupported_currency', 'oauth_state_invalid'), message: str, requestId: ref('Id'), retryable: bool, details: ref('ErrorDetails') }, ['details']);
defs.Error = obj({ error: ref('ErrorObject') });
defs.BatchRequest = obj({ contractVersion: { const: 2 }, items: { type: 'array', minItems: 1, maxItems: 100, items: ref('Envelope') } });
defs.BatchItem = { oneOf: [
  obj({ index: int(0, 99), deliveryId: ref('UUID'), status: en(200, 201), receipt: ref('Receipt') }),
  obj({ index: int(0, 99), deliveryId: nullable(ref('UUID')), status: en(400, 403, 409, 422, 503), error: ref('ErrorObject') })
] };
defs.BatchResponse = obj({ results: { type: 'array', minItems: 1, maxItems: 100, items: ref('BatchItem') } });
defs.Capabilities = obj({ apiVersion: { const: '2.0.0' }, captureVersions: { const: [1, 2] }, maxBatchItems: { const: 100 }, maxItemBytes: { const: 65536 }, maxBatchBytes: { const: 1048576 }, currencyRegistryVersion: { const: 'ISO4217-CLDR-45' }, features: obj({ observationRevisions: { const: true }, decimalFinance: { const: true }, email: { const: false }, activity: { const: false }, location: { const: false }, episodes: { const: false }, connectors: { const: false } }), policyVersion: ref('Version') });
defs.PolicyRequest = obj({ expectedVersion: ref('Version'), enabled: bool, externalModelsAllowed: bool, externalEmbeddingsAllowed: bool, retentionDays: nullable({ type: 'integer', minimum: 1, maximum: 3650 }) });
defs.PolicyResponse = obj({ sourceInstanceId: ref('Id'), policyVersion: ref('Version'), enabled: bool, externalModelsAllowed: bool, externalEmbeddingsAllowed: bool, retentionDays: nullable({ type: 'integer', minimum: 1, maximum: 3650 }), effectiveAt: ref('UTC'), cancelledPendingWorkCount: ref('Count') });
defs.DeletionRequest = obj({ idempotencyKey: ref('Id'), scope: { oneOf: [obj({ sourceInstanceId: ref('Id') }), obj({ observationId: ref('Id') }), obj({ all: { const: true } })] }, mode: en('evidence', 'derived', 'all'), expectedPolicyVersion: ref('Version') });
defs.DeletionState = obj({ id: ref('Id'), state: en('queued', 'running', 'completed', 'failed'), blockedAt: nullable(ref('UTC')), completedAt: ref('UTC'), remainingCategories: arr(ref('DeletionCategory')), backupExpiryAt: ref('UTC') }, ['completedAt', 'backupExpiryAt']);
defs.DeletionCreationResponse = obj({ deletionId: ref('Id'), state: { const: 'queued' }, createdAt: ref('UTC'), remainingCategories: { type: 'array', maxItems: 0, items: false } });
defs.Conversion = obj({ rateId: ref('Id'), rate: ref('ConversionRate'), asOf: ref('UTC'), provider: ref('Id'), toCurrency: ref('Currency'), amount: ref('Decimal') });
defs.FinancialSummary = obj({ from: ref('Timestamp'), to: ref('Timestamp'), asOf: ref('UTC'), totals: arr(obj({ currency: ref('Currency'), income: ref('Magnitude'), expense: ref('Magnitude'), refunds: ref('Magnitude'), net: ref('Decimal'), transactionCount: ref('Count') })), excluded: obj({ ambiguous: ref('Count'), unsupported: ref('Count'), pending: ref('Count') }), conversion: nullable(ref('Conversion')) });
// Structural query contract for GET /api/v2/financial/summary. JSON Schema
// expresses required bounds, typed parameters and conversionTo => fxRateId;
// ordering and the 366-day maximum are enforced by the verifier predicate.
const summaryQuery = obj({ from: ref('Timestamp'), to: ref('Timestamp'), accountId: ref('Id'), conversionTo: ref('CurrencyRegistry'), fxRateId: ref('Id') }, ['accountId', 'conversionTo', 'fxRateId']);
summaryQuery.dependentRequired = { conversionTo: ['fxRateId'] };
defs.FinancialSummaryQuery = summaryQuery;
// Observation detail and revision history.
defs.ObservationRevision = obj({ revisionId: ref('Id'), observationId: ref('Id'), revisionNumber: ref('Version'), producerRevisionId: ref('UUID'), producerSequence: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' }, changeKind: en('posted', 'updated', 'removed', 'imported'), contentFingerprint: ref('Hash'), sourceOccurredAt: nullable(ref('Timestamp')), sourceUpdatedAt: nullable(ref('Timestamp')), deviceObservedAt: ref('Timestamp'), receivedAt: ref('UTC'), content: ref('Content'), evidenceIds: arr(ref('Id')) });
defs.ObservationDetail = obj({ observationId: ref('Id'), sourceInstanceId: ref('Id'), sourceObservationKey: { type: 'string', minLength: 1, maxLength: 512 }, latestRevisionNumber: ref('Version'), latestRevisionId: nullable(ref('Id')), revisionCount: ref('Count'), contentType: nullable(ref('ContentType')), stage: ref('Stage'), stageUpdatedAt: ref('UTC'), createdAt: ref('UTC'), updatedAt: ref('UTC'), deleted: bool, revisionsCursor: ref('Cursor') });
defs.ObservationRevisionPage = obj({ observationId: ref('Id'), items: arr(ref('ObservationRevision')), nextCursor: nullable(ref('Cursor')) });
// Canonical events.
defs.EventEvidence = obj({ observationId: ref('Id'), revisionId: ref('Id'), factId: nullable(ref('Id')), role: en('primary', 'supporting', 'contradicting', 'context'), strength: ref('EvidenceStrength'), active: bool });
defs.EventUncertainty = obj({ reason: en('ambiguous_identity', 'conflicting_evidence', 'incomplete_time', 'low_confidence'), candidates: { type: 'array', maxItems: 20, items: obj({ eventId: ref('Id'), score: { type: 'number', minimum: 0, maximum: 1 } }) } });
defs.EventInterpretation = obj({ artifactId: ref('Id'), revision: ref('Version'), kind: en('summary', 'categorization', 'entity_resolution', 'financial_match'), text: str, confidence: { type: 'number', minimum: 0, maximum: 1 }, citationIds: arr(ref('Id')) });
defs.Event = obj({ eventId: ref('Id'), eventType: ref('EventType'), lifecycle: ref('EventLifecycle'), version: ref('Version'), occurredStart: ref('Timestamp'), occurredEnd: nullable(ref('Timestamp')), timeUncertaintyMs: ref('Count'), mergedIntoId: nullable(ref('Id')), evidence: arr(ref('EventEvidence')), uncertainty: nullable(ref('EventUncertainty')), interpretations: arr(ref('EventInterpretation')), reviewReasons: arr(str), createdAt: ref('UTC'), updatedAt: ref('UTC') });
// Episodes.
defs.EpisodeMember = obj({ canonicalEventId: ref('Id'), revisionId: ref('Id'), role: ref('MembershipRole'), confidence: { type: 'number', minimum: 0, maximum: 1 }, evidenceIds: arr(ref('Id')) });
defs.EpisodeSummary = obj({ artifactId: ref('Id'), revision: ref('Version'), text: str, citationIds: arr(ref('Id')) });
const episodeFields = { id: ref('Id'), type: ref('EpisodeType'), version: ref('Version'), status: ref('EpisodeStatus'), startAt: ref('Timestamp'), endAt: nullable(ref('Timestamp')), timeUncertaintyMs: ref('Count'), confidence: { type: 'number', minimum: 0, maximum: 1 }, members: arr(ref('EpisodeMember')), summary: nullable(ref('EpisodeSummary')), reviewReasons: arr(str) };
defs.Episode = obj(episodeFields);
defs.EpisodeDetail = obj({ ...episodeFields, priorRevisionIds: arr(ref('Id')), activeCorrectionIds: arr(ref('Id')) });
defs.EpisodePage = obj({ items: arr(ref('Episode')), nextCursor: nullable(ref('Cursor')) });
// Financial transactions.
defs.Merchant = obj({ id: nullable(ref('Id')), label: str, verified: bool });
defs.FinancialEvidence = obj({ observationId: ref('Id'), revisionId: ref('Id'), factIds: arr(ref('Id')), role: ref('EvidenceRole'), strength: ref('EvidenceStrength') });
defs.FinancialAdjustment = obj({ id: ref('Id'), kind: en('refund', 'reversal', 'fee', 'adjustment'), amount: ref('Magnitude'), currency: ref('Currency'), postedAt: nullable(ref('Timestamp')), reference: nullable(ref('Id')), lifecycle: ref('TransactionLifecycle') });
defs.FinancialTransaction = obj({ id: ref('Id'), canonicalEventId: ref('Id'), version: ref('Version'), kind: ref('TransactionKind'), lifecycle: ref('TransactionLifecycle'), amount: ref('Magnitude'), currency: ref('Currency'), currencyStatus: ref('CurrencyStatus'), occurredAt: ref('Timestamp'), postedAt: nullable(ref('Timestamp')), merchant: ref('Merchant'), accountId: nullable(ref('Id')), evidenceCount: ref('Count'), revisionCount: ref('Count'), evidence: arr(ref('FinancialEvidence')), adjustments: arr(ref('FinancialAdjustment')), reviewReasons: arr(str) });
defs.FinancialTransactionPage = obj({ asOf: ref('UTC'), items: arr(ref('FinancialTransaction')), nextCursor: nullable(ref('Cursor')) });
// Facts: strict discriminated value variants. No generic value placeholder.
defs.EntityRef = obj({ entityId: ref('Id'), entityType: ref('Id'), label: str });
defs.FactEvidence = obj({ pointer: { type: 'string', minLength: 1, maxLength: 1024 }, start: nullable(int(0, 2147483647)), end: nullable(int(0, 2147483647)), excerptHash: ref('Hash') });
const typedValueVariants = [
  obj({ factType: { const: 'string' }, value: { type: 'string', maxLength: 8192 } }),
  obj({ factType: { const: 'decimal' }, value: ref('Decimal') }),
  obj({ factType: { const: 'currency' }, value: ref('Currency') }),
  obj({ factType: { const: 'timestamp' }, value: ref('Timestamp') }),
  obj({ factType: { const: 'boolean' }, value: bool }),
  obj({ factType: { const: 'entity_ref' }, value: ref('EntityRef') })
];
defs.TypedValue = { oneOf: typedValueVariants };
defs.FactCandidate = { oneOf: typedValueVariants.map(v => obj({ ...v.properties, confidence: { type: 'number', minimum: 0, maximum: 1 } })) };
defs.FactUncertainty = obj({ reason: en('ambiguous_identity', 'conflicting_evidence', 'incomplete_time', 'low_confidence'), candidates: { type: 'array', maxItems: 20, items: ref('FactCandidate') } });
const factCommon = { id: ref('Id'), field: ref('FactField'), revisionId: ref('Id'), evidence: ref('FactEvidence'), method: en('deterministic', 'provider_structured', 'llm', 'user'), extractorVersion: ref('Id'), modelRevision: nullable(ref('Id')), confidence: { type: 'number', minimum: 0, maximum: 1 }, uncertainty: nullable(ref('FactUncertainty')), validationStatus: en('proposed', 'validated', 'ambiguous', 'rejected', 'user_confirmed'), userCorrectionStatus: en('none', 'active', 'revoked'), visibility: en('visible', 'internal') };
defs.Fact = { oneOf: typedValueVariants.map(v => obj({ ...factCommon, ...v.properties })) };
// Corrections.
defs.RuleMatch = obj({ sourceInstanceId: ref('Id'), exactDescriptor: { type: 'string', minLength: 1, maxLength: 512 } });
defs.CorrectionTarget = obj({ type: en('fact', 'event', 'transaction', 'episode'), id: ref('Id'), expectedVersion: ref('Version') });
defs.CorrectionResponse = obj({ correctionId: ref('Id'), version: ref('Version'), status: en('applied', 'review'), reprocessing: en('queued', 'not_required'), affectedCount: ref('Count'), reviewReasons: arr(str) });
defs.CorrectionRecord = obj({ correctionId: ref('Id'), version: ref('Version'), status: en('applied', 'review'), reprocessing: en('queued', 'not_required'), target: ref('CorrectionTarget'), field: ref('CorrectionField'), appliedAt: ref('UTC'), revokedAt: nullable(ref('UTC')) });
defs.EpisodeMembershipValue = obj({ eventIds: { type: 'array', minItems: 1, maxItems: 100, items: ref('Id') } });
defs.EpisodeSplitValue = obj({ groups: { type: 'array', minItems: 2, maxItems: 20, items: obj({ eventIds: { type: 'array', minItems: 1, maxItems: 100, items: ref('Id') } }) } });
defs.EpisodeMergeValue = obj({ sourceEpisodeIds: { type: 'array', minItems: 1, maxItems: 50, items: ref('Id') }, targetEpisodeId: ref('Id') });
const correctionTarget = type => obj({ type: { const: type }, id: ref('Id'), expectedVersion: ref('Version') });
const correctionBranch = (targetType, field, value) => ({
  ...obj({ idempotencyKey: ref('Id'), target: correctionTarget(targetType), field: { const: field }, value, scope: en('once', 'rule'), ruleMatch: nullable(ref('RuleMatch')), reason: { type: 'string', maxLength: 2000 } }, ['reason']),
  allOf: [{ if: { properties: { scope: { const: 'rule' } }, required: ['scope'] }, then: { properties: { ruleMatch: { not: { type: 'null' } } } } }]
});
const eventValueFields = [
  ['event_type', ref('EventType')],
  ['lifecycle', ref('EventLifecycle')],
  ['occurred_start', ref('Timestamp')],
  ['occurred_end', nullable(ref('Timestamp'))]
];
const transactionValueFields = [
  ['merchant_label', { type: 'string', minLength: 1, maxLength: 512 }],
  ['category', ref('Id')],
  ['account_id', ref('Id')],
  ['amount', ref('Magnitude')],
  ['currency', ref('Currency')],
  ['occurred_at', ref('Timestamp')],
  ['posted_at', nullable(ref('Timestamp'))],
  ['kind', ref('TransactionKind')],
  ['lifecycle', ref('TransactionLifecycle')]
];
defs.CorrectionRequest = { oneOf: [
  correctionBranch('fact', 'fact_value', ref('TypedValue')),
  ...eventValueFields.map(([field, value]) => correctionBranch('event', field, value)),
  ...transactionValueFields.map(([field, value]) => correctionBranch('transaction', field, value)),
  correctionBranch('episode', 'membership_include', ref('EpisodeMembershipValue')),
  correctionBranch('episode', 'membership_exclude', ref('EpisodeMembershipValue')),
  correctionBranch('episode', 'split', ref('EpisodeSplitValue')),
  correctionBranch('episode', 'merge', ref('EpisodeMergeValue'))
] };
// Export.
defs.Artifact = obj({ artifactId: ref('Id'), kind: en('episode_summary', 'answer', 'digest', 'insight'), revision: ref('Version'), text: str, citationIds: arr(ref('Id')), createdAt: ref('UTC') });
defs.ExportItem = { oneOf: [
  ['observation', 'ObservationDetail'], ['revision', 'ObservationRevision'], ['fact', 'Fact'], ['correction', 'CorrectionRecord'], ['event', 'Event'], ['transaction', 'FinancialTransaction'], ['episode', 'EpisodeDetail'], ['artifact', 'Artifact']
].map(([type, record]) => obj({ type: { const: type }, id: ref('Id'), record: ref(record) })) };
defs.ExportResponse = obj({ snapshotId: ref('Id'), items: arr(ref('ExportItem')), nextCursor: nullable(ref('Cursor')), expiresAt: ref('UTC') });
// Queries.
defs.QueryFilters = obj({ sourceInstanceIds: { type: 'array', maxItems: 100, items: ref('Id') }, from: ref('Timestamp'), to: ref('Timestamp'), types: { type: 'array', maxItems: 5, uniqueItems: true, items: ref('QueryEvidenceType') } }, ['sourceInstanceIds', 'from', 'to', 'types']);
defs.QueryRequest = obj({ query: { type: 'string', minLength: 1, maxLength: 2000 }, maxEvidence: int(1, 30), externalSynthesisAllowed: bool, filters: ref('QueryFilters') });
defs.QueryAccepted = obj({ queryId: ref('Id'), status: en('queued', 'running') });
defs.QueryEvidence = obj({ id: ref('Id'), observationId: ref('Id'), revisionId: ref('Id'), factId: nullable(ref('Id')), pointer: nullable({ type: 'string', minLength: 1, maxLength: 1024 }), permittedExcerpt: str });
defs.QueryClaim = obj({ text: str, citationIds: arr(ref('Id')), verification: en('supported', 'uncertain') });
defs.QueryStructuredTotal = obj({ currency: ref('Currency'), total: ref('Magnitude'), transactionCount: ref('Count'), from: ref('Timestamp'), to: ref('Timestamp') });
defs.QueryCoverage = obj({ exhaustive: bool, retrievalStrategies: { type: 'array', uniqueItems: true, items: ref('RetrievalStrategy') }, timeRange: obj({ from: ref('Timestamp'), to: ref('Timestamp') }) });
defs.QueryFailure = obj({ code: en('timeout', 'unavailable', 'policy_blocked', 'internal_error'), message: str, retryable: bool });
const queryBase = { queryId: ref('Id'), modelCalls: ref('Count'), elapsedMs: ref('Count') };
defs.QueryResult = { oneOf: [
  obj({ ...queryBase, status: en('queued', 'running'), answer: { type: 'null' }, structuredTotals: { type: 'null' }, evidence: { type: 'array', maxItems: 0, items: false }, claims: { type: 'array', maxItems: 0, items: false }, limitations: arr(str), coverage: { type: 'null' }, failure: { type: 'null' } }),
  obj({ ...queryBase, status: { const: 'completed' }, answer: str, structuredTotals: nullable(arr(ref('QueryStructuredTotal'))), evidence: arr(ref('QueryEvidence')), claims: arr(ref('QueryClaim')), limitations: arr(str), coverage: ref('QueryCoverage'), failure: { type: 'null' } }),
  obj({ ...queryBase, status: { const: 'review' }, answer: nullable(str), structuredTotals: nullable(arr(ref('QueryStructuredTotal'))), evidence: arr(ref('QueryEvidence')), claims: arr(ref('QueryClaim')), limitations: arr(str), coverage: ref('QueryCoverage'), failure: { type: 'null' } }),
  obj({ ...queryBase, status: { const: 'failed' }, answer: { type: 'null' }, structuredTotals: { type: 'null' }, evidence: { type: 'array', maxItems: 0, items: false }, claims: { type: 'array', maxItems: 0, items: false }, limitations: arr(str), coverage: { type: 'null' }, failure: ref('QueryFailure') })
] };
// Email connector.
defs.EmailAuthorizeRequest = obj({ provider: { const: 'gmail' }, returnRoute: ref('EmailReturnRoute'), historyDays: int(1, 90) });
defs.EmailAuthorizeResponse = obj({ provider: { const: 'gmail' }, authorizationUrl: { type: 'string', format: 'uri', maxLength: 4096, pattern: '^https://' }, stateExpiresAt: ref('UTC'), scopes: { type: 'array', minItems: 1, maxItems: 1, items: ref('AuthorizationScope') }, returnRoute: ref('EmailReturnRoute') });
// Exactly one of code or error, with state always present; a provider error
// callback legitimately omits code.
const callbackQuery = obj({ code: { type: 'string', minLength: 1, maxLength: 2048 }, state: { type: 'string', minLength: 1, maxLength: 512 }, error: { type: 'string', minLength: 1, maxLength: 256 } }, ['code', 'error']);
callbackQuery.oneOf = [{ required: ['code'], properties: { code: callbackQuery.properties.code } }, { required: ['error'], properties: { error: callbackQuery.properties.error } }];
defs.EmailCallbackQuery = callbackQuery;
defs.ConnectorRevokeRequest = obj({ expectedVersion: ref('Version'), deleteCapturedData: bool });
defs.ConnectorRevokeResponse = obj({ connectorId: ref('Id'), status: { const: 'revoked' }, version: ref('Version'), revokedAt: ref('UTC'), deleteCapturedData: bool, deletionId: nullable(ref('Id')) });
const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://brainia.invalid/contracts/brain-ai/2.0.0/schema.json', title: 'Brain AI 2.0.0 proposed revision B02-r3; see open-items.json', $defs: defs };
write('schema.json', schema);
const items = [];
const resolved = (name, where, why, decision, resolutionDetail, schemas = [], operations = []) => items.push({ name, where, why, decision, status: 'resolved', resolution: 'owner_confirmed_encoded', resolutionDetail, resolvedAt: '2026-10-17', schemas, operations });
const provisional = (operation, why, fixtures) => items.push({ name: operation, where: operation, why: why + ' are not fully specified in the source draft.', decision: 'Approve full strict request/response schemas and semantics before implementing this operation.', status: 'schema_published_pending_review', resolution: 'provisional_contract_authorization', resolutionDetail: 'Strict schema, enums, pagination, error variants and positive/negative fixtures published in revision B02-r3. Implementation and mobile consumption remain blocked until this revision passes contracts:verify and independent review.', resolvedAt: '2026-10-17', schemas: [], operations: [operation], fixtures, implementationBlocked: true });
resolved('activity.marker', 'content.type=activity', 'Observed/inferred marker has no field name or wire type; confidence/interval constraints incomplete.', 'Approve exact marker name/enum, signal types and interval/confidence semantics; Activity stays false.', 'activityMarker enum observed|inferred; closed signalTypes allowlist still|walking|running|cycling|driving|transit|unknown; interval {start,end} with end>=start; confidence 0..1. Activity capability stays false.', ['Activity']);
resolved('email.addresses', 'Email.sender and Email.recipients[]', 'Address shape (string or structured) and validation are unspecified.', 'Approve sender and recipient DTOs; Email sender remains false.', 'Structured {address, displayName?} with format email and maxLength 320 for address, maxLength 256 for displayName. Email capability stays false.', ['Email', 'EmailAddress']);
resolved('attachmentRefs.items', 'Email.attachmentRefs / ReceiptContent.attachmentRefs', 'Attachment reference DTO and authorization/expiry are unspecified.', 'Approve exact attachment reference DTO and lifecycle; only empty lists currently accepted.', 'Opaque {refId, provider?, mimeType?, sizeBytes?, sha256?, expiresAt?} DTO remains documented, but both attachmentRefs arrays are empty-only (maxItems: 0) until a connector is approved; no credentialed URLs. Non-empty arrays are rejected.', ['AttachmentRef', 'Email', 'ReceiptContent']);
resolved('error.details', 'ErrorObject.details', 'Field paths/limits/versions described without keys or types.', 'Approve strict detail variants; optional details currently forbidden.', 'Strict discriminated union by kind: field_errors[] (field/code/expected/actual), retry(retryAfterSeconds), conflict(conflictId), blocked_category(blockedCategory). No free-form details object.', ['ErrorDetails', 'ErrorObject']);
resolved('receipt.processing', 'Receipt.processing', 'Only queued appears in normative receipt; later processing values unspecified.', 'Confirm queued-only durable receipts or enumerate other receipt states.', 'Durable receipts are queued-only in v2.0.0; later states require a versioned contract revision.', ['Receipt']);
resolved('capabilities.auth', 'GET /api/v2/capabilities', 'All routes require owner/scope, while table says No credentials.', 'Confirm bearer-protected response contains no credentials (bundle interpretation) or approve public access.', 'GET /api/v2/capabilities is bearer-protected; response contains no credentials, only booleans, limits and registry version.', ['Capabilities']);
resolved('capabilities.featureGates', 'Capabilities.features', 'No location/activity/connector/episode advertisement fields exist.', 'Approve feature advertisement fields before enabling any of these captures/features.', 'features {email, activity, location, episodes, connectors} are booleans fixed false in this revision; observationRevisions and decimalFinance remain true. A gate may only be advertised after its evidence exists.', ['Capabilities']);
resolved('timestamp.presence', 'Envelope.sourceOccurredAt / sourceUpdatedAt', 'Required-fields paragraph says nullable; data model mentions absent optional canonicalized to null.', 'Confirm both fields required on wire and null represents unknown (bundle interpretation).', 'sourceOccurredAt and sourceUpdatedAt are required nullable wire fields; null means unknown, never now.', ['Envelope']);
resolved('raw.security', 'Content.raw', 'Explicit extension object permits arbitrary names, but credential prohibition has no complete portable key allowlist.', 'Approve source-specific raw allowlists and privacy limits; schema success alone cannot authorize raw payloads.', 'raw allowlists: notification {packageName,title,body}; receipt/wallet {amount,currency,merchant,transactionType}. note/email/activity/location raw must be empty. Unknown or credential-shaped keys are rejected; raw payloads remain source-policy gated.', ['Notification', 'ReceiptContent', 'Note', 'Email', 'Activity', 'Location']);
resolved('batch.minimumAndMalformedIdentity', 'BatchRequest.items / BatchResponse.results', 'Maximum given but empty batch semantics and per-item deliveryId for malformed/missing UUID unspecified.', 'Confirm nonempty batches (subset restriction) and specify unidentified-item error behavior.', 'Batches are non-empty 1..100. Each result carries input index 0..99. Malformed items return deliveryId null plus a per-item error; valid items still process.', ['BatchRequest', 'BatchItem', 'BatchResponse']);
resolved('decimal.storageAndFX', 'Decimal / Conversion.rate', 'Wire permits 6 decimals without integer digit limit; storage NUMERIC(24,6), FX NUMERIC(24,12).', 'Approve magnitude/digit bounds and separate FX precision DTO; subset rejects rates beyond 6 fractional digits.', 'Amounts are decimal strings with at most 18 integer and 6 fractional digits. Conversion.rate uses ConversionRate with at most 12 fractional digits. Storage NUMERIC(24,6)/NUMERIC(24,12).', ['Decimal', 'Magnitude', 'ConversionRate', 'Conversion']);
resolved('currency.registry', 'Currency / FinancialSummary', 'ISO registry version, unsupported ISO handling and conversion rounding DTO not pinned.', 'Pin currency registry, exponents and rounding rule; only UYU/USD confirmed summary fixture semantics tested.', 'Currency is a 3-letter ISO 4217 code; capabilities advertises currencyRegistryVersion ISO4217-CLDR-45; round half-even to the CLDR exponent; unsupported codes return unsupported_currency. Only UYU/USD summary fixtures are confirmed.', ['Currency', 'Capabilities', 'FinancialSummary']);
resolved('deletion.creationResponse', 'POST /api/v2/deletions 202', 'Deletion ID/state names described but full creation response absent.', 'Approve exact 202 response; operation remains excluded.', '202 {deletionId, state:"queued", createdAt, remainingCategories:[]}; the deletion worker and the POST operation itself remain excluded from this revision.', ['DeletionCreationResponse'], ['POST /api/v2/deletions']);
resolved('deletion.remainingCategories', 'DeletionState.remainingCategories[] / blockedAt', 'Category enum and blockedAt meaning/nullability unspecified.', 'Approve category allowlist and timestamp semantics; schema is structural only.', 'Category allowlist raw_events, derived_knowledge, embeddings, financial_records, connectors, backups. blockedAt is a required nullable UTC timestamp meaning waiting on the named category.', ['DeletionState']);
provisional('GET /api/v2/observations/{id}', 'Observation detail identity/revision/stage/cursor DTO field names and stage enums', ['ObservationDetail']);
provisional('GET /api/v2/observations/{id}/revisions', 'Revision page wrapper, evidence links, history DTO and paging fields', ['ObservationRevision', 'ObservationRevisionPage']);
provisional('GET /api/v2/events/{id}', 'Event type/lifecycle/evidence/uncertainty/interpretation DTOs', ['Event', 'EventEvidence', 'EventUncertainty', 'EventInterpretation']);
provisional('GET /api/v2/episodes', 'Episode membership role enum, summary revision typing, list filters and pagination', ['Episode', 'EpisodePage', 'EpisodeMember']);
provisional('GET /api/v2/episodes/{id}', 'Episode detail and correction payloads; M07 remains blocked', ['EpisodeDetail', 'EpisodeMember']);
provisional('GET /api/v2/financial/transactions', 'Financial lifecycle/currency nullability, evidence role/strength, signed-adjustment DTO and list wrapper', ['FinancialTransaction', 'FinancialTransactionPage', 'FinancialAdjustment', 'FinancialEvidence']);
provisional('POST /api/v2/corrections', 'Allowlisted fields/typed values, rule preview, episode split/merge/include/exclude payloads and review response', ['CorrectionRequest', 'CorrectionResponse']);
provisional('GET /api/v2/export', 'Snapshot query/expiry/audit metadata and approved DTOs for every record discriminator', ['ExportResponse', 'ExportItem', 'CorrectionRecord', 'Artifact']);
provisional('POST /api/v2/queries', 'Query length/maxEvidence bounds, type filters, timeRange, status/results/async response and structuredTotals', ['QueryRequest', 'QueryAccepted', 'QueryResult']);
provisional('GET /api/v2/queries/{id}', 'Pending/review/failed result variants, claim/citation verification and coverage DTO', ['QueryResult', 'QueryEvidence', 'QueryClaim', 'QueryCoverage']);
provisional('POST /api/v2/connectors/email/authorize', 'Allowlisted returnRoute, authorize response keys/expiry and Gmail scope set', ['EmailAuthorizeRequest', 'EmailAuthorizeResponse']);
provisional('GET /api/v2/connectors/email/callback', 'Callback query/redirect allowlist, error responses and opaque success ID encoding', ['ErrorObject', 'EmailCallbackQuery']);
provisional('POST /api/v2/connectors/{id}/revoke', 'Owner-bound revoke response, deletion linkage and replay semantics', ['ConnectorRevokeRequest', 'ConnectorRevokeResponse']);
resolved('Fact', 'Fact DTO (not an endpoint)', 'uncertainty candidates/value variants, field allowlist, pointer/excerpt hashing and entity reference shape incomplete.', 'Approve discriminated Fact schema including UTF-16 span and evidence checks; no generic value placeholder.', 'Fact is a strict discriminated union on factType (string|decimal|currency|timestamp|boolean|entity_ref) with typed value, UTF-16 start/end spans that must be paired, excerptHash, confidence 0..1, extractorVersion and visibility through validationStatus/userCorrectionStatus. Evidence must reference an existing event; no generic placeholder value.', ['Fact', 'FactEvidence', 'FactCandidate', 'TypedValue']);
resolved('enrollmentAndRetention', 'Out-of-band admin device/source issuance and PRD retention defaults', 'No public enrollment/rotation/logout wire flow approved; retention defaults require privacy owner approval.', 'Approve admin issuance/revocation ownership, source/device lifecycle, explicit empty-selection consent and dated retention decisions.', 'Device-to-owner credential registry for first release; owner-controlled audited admin issuance/revocation; no public enrollment API; explicit selection with empty selection capturing nothing. Retention defaults remain as recorded in the G1 ledger and do not create wire fields in this revision.', []);
resolved('summary.filters', 'GET /api/v2/financial/summary query', 'conversionTo/fxRateId pairing specified, but time bounds/defaults and allowed conversion currencies incomplete.', 'Approve required time range, bound ordering and currency/rate registry; subset requires from/to.', 'from and to are required, from<=to, max range 366 days; conversion requires fxRateId; currency must be in the approved registry (confirmed UYU/USD subset); no defaults. Encoded by FinancialSummaryQuery and summary query fixtures.', ['FinancialSummary', 'FinancialSummaryQuery', 'CurrencyRegistry']);
write('open-items.json', {
  status: 'PROPOSED_REVISION_PENDING_REVIEW',
  approvalReady: false,
  revision: 'B02-r3',
  openDecisionCount: 0,
  resolvedDecisionCount: items.filter(x => x.status === 'resolved').length,
  provisionalOperationCount: items.filter(x => x.status === 'schema_published_pending_review').length,
  items,
  excludedOperations: ['POST /api/v2/deletions'],
  intentionallyExcludedOperations: [{ operation: 'POST /api/v2/deletions', reason: 'Destructive deletion creation remains excluded from OpenAPI and mobile implementation until a deletion worker and separate owner approval exist. Its response DTO is published for future structural review.' }],
  blockedMobileTasks: ['M07', 'activity capture', 'email capture', 'connectors'],
  rule: 'Resolved decisions are encoded, not approved. Provisional operation schemas authorise no implementation until contracts:verify and independent review complete.'
});
const response = name => ({ description: name, content: { 'application/json': { schema: { $ref: `./schema.json#/$defs/${name}` } } } });
const parameter = (name, s, required = false, loc = 'query') => ({ name, in: loc, required, schema: s });
const paths = {};
function operation(route, method, scope, request, output, statuses = [200], parameters = []) {
 const op = { operationId: method + route.replace(/[^a-zA-Z0-9]/g, ''), 'x-required-scope': scope, 'x-approval-status': 'proposed-subset', parameters, responses: Object.fromEntries(statuses.map(s => [s, response(output)])) };
 if (request) op.requestBody = { required: true, content: { 'application/json': { schema: { $ref: `./schema.json#/$defs/${request}` } } } };
 for (const status of [400, 401, 403, 404, 409, 413, 422, 429, 503]) op.responses[status] = { ...response('Error'), headers: { 'X-Request-Id': { schema: str }, ...(status === 429 || status === 503 ? { 'Retry-After': { required: true, schema: str } } : {}) } };
 paths[route] ??= {}; paths[route][method] = op;
}
function addOp(route, method, config) {
 const op = { operationId: method + route.replace(/[^a-zA-Z0-9]/g, ''), 'x-required-scope': config.scope, 'x-approval-status': 'provisional-operation-schema-unapproved', 'x-owner-scoped': config.ownerScoped !== false, parameters: config.parameters || [], responses: {} };
 if (config.request) op.requestBody = { required: true, content: { 'application/json': { schema: { $ref: `./schema.json#/$defs/${config.request}` } } } };
 for (const [status, value] of Object.entries(config.success)) op.responses[status] = typeof value === 'string' ? response(value) : value;
 for (const status of config.errorStatuses || [400, 401, 403, 404, 409, 413, 422, 429, 503]) op.responses[status] = { ...response('Error'), headers: { 'X-Request-Id': { schema: str }, ...(status === 429 || status === 503 ? { 'Retry-After': { required: true, schema: str } } : {}) } };
 if (config.security !== undefined) op.security = config.security;
 paths[route] ??= {}; paths[route][method] = op;
}
operation('/api/v2/capabilities', 'get', 'capture:read', null, 'Capabilities');
operation('/api/v2/observations', 'post', 'capture:write', 'Envelope', 'Receipt', [200, 201]);
operation('/api/v2/observations/batch', 'post', 'capture:write', 'BatchRequest', 'BatchResponse');
operation('/api/v2/sources/{id}/policy', 'put', 'privacy:write', 'PolicyRequest', 'PolicyResponse', [200], [parameter('id', { $ref: './schema.json#/$defs/Id' }, true, 'path')]);
operation('/api/v2/deletions/{id}', 'get', 'privacy:read', null, 'DeletionState', [200], [parameter('id', { $ref: './schema.json#/$defs/Id' }, true, 'path')]);
operation('/api/v2/financial/summary', 'get', 'finance:read', null, 'FinancialSummary', [200], [parameter('from', { $ref: './schema.json#/$defs/Timestamp' }, true), parameter('to', { $ref: './schema.json#/$defs/Timestamp' }, true), parameter('accountId', { $ref: './schema.json#/$defs/Id' }), parameter('conversionTo', { $ref: './schema.json#/$defs/CurrencyRegistry' }), parameter('fxRateId', { $ref: './schema.json#/$defs/Id' })]);
Object.assign(paths['/api/v2/financial/summary'].get, {
  'x-query-schema': './schema.json#/$defs/FinancialSummaryQuery',
  'x-query-constraints': ['from and to are required and have no defaults', 'from must not be after to', 'the inclusive range must not exceed 366 days (366 * 86400000 ms)', 'conversionTo requires fxRateId', 'conversionTo must be a member of the approved currency registry (confirmed UYU/USD subset)']
});
const pathId = parameter('id', { $ref: './schema.json#/$defs/Id' }, true, 'path');
const cursor = parameter('cursor', { $ref: './schema.json#/$defs/Cursor' });
const limit = parameter('limit', int(1, 100));
const from = parameter('from', { $ref: './schema.json#/$defs/Timestamp' }, true);
const to = parameter('to', { $ref: './schema.json#/$defs/Timestamp' }, true);
addOp('/api/v2/observations/{id}', 'get', { scope: 'capture:read', success: { 200: 'ObservationDetail' }, parameters: [pathId] });
addOp('/api/v2/observations/{id}/revisions', 'get', { scope: 'evidence:read', success: { 200: 'ObservationRevisionPage' }, parameters: [pathId, cursor, limit] });
addOp('/api/v2/events/{id}', 'get', { scope: 'evidence:read', success: { 200: 'Event' }, parameters: [pathId] });
addOp('/api/v2/episodes', 'get', { scope: 'evidence:read', success: { 200: 'EpisodePage' }, parameters: [parameter('sourceInstanceId', { $ref: './schema.json#/$defs/Id' }), parameter('from', { $ref: './schema.json#/$defs/Timestamp' }), parameter('to', { $ref: './schema.json#/$defs/Timestamp' }), parameter('type', { $ref: './schema.json#/$defs/EpisodeType' }), parameter('status', { $ref: './schema.json#/$defs/EpisodeStatus' }), cursor, limit] });
addOp('/api/v2/episodes/{id}', 'get', { scope: 'evidence:read', success: { 200: 'EpisodeDetail' }, parameters: [pathId] });
addOp('/api/v2/financial/transactions', 'get', { scope: 'finance:read', success: { 200: 'FinancialTransactionPage' }, parameters: [from, to, parameter('currency', { $ref: './schema.json#/$defs/Currency' }), parameter('lifecycle', { $ref: './schema.json#/$defs/TransactionLifecycle' }), parameter('accountId', { $ref: './schema.json#/$defs/Id' }), cursor, limit] });
addOp('/api/v2/corrections', 'post', { scope: 'corrections:write', request: 'CorrectionRequest', success: { 200: 'CorrectionResponse', 201: 'CorrectionResponse' } });
addOp('/api/v2/export', 'get', { scope: 'privacy:export', success: { 200: 'ExportResponse' }, parameters: [{ name: 'types', in: 'query', required: false, style: 'form', explode: true, schema: { type: 'array', uniqueItems: true, items: { $ref: './schema.json#/$defs/ExportType' } } }, parameter('from', { $ref: './schema.json#/$defs/Timestamp' }), parameter('to', { $ref: './schema.json#/$defs/Timestamp' }), cursor, limit] });
addOp('/api/v2/queries', 'post', { scope: 'intelligence:read', request: 'QueryRequest', success: { 200: 'QueryResult', 202: 'QueryAccepted' } });
addOp('/api/v2/queries/{id}', 'get', { scope: 'intelligence:read', success: { 200: 'QueryResult' }, parameters: [pathId] });
addOp('/api/v2/connectors/email/authorize', 'post', { scope: 'connectors:write', request: 'EmailAuthorizeRequest', success: { 200: 'EmailAuthorizeResponse' } });
addOp('/api/v2/connectors/email/callback', 'get', { scope: 'oauth:callback', ownerScoped: false, security: [], success: { 302: { description: 'Redirect to allowlisted mobile deep link', headers: { Location: { required: true, schema: { type: 'string', format: 'uri' } } } } }, parameters: [parameter('code', { type: 'string', minLength: 1, maxLength: 2048 }), parameter('state', { type: 'string', minLength: 1, maxLength: 512 }, true), parameter('error', { type: 'string', minLength: 1, maxLength: 256 })], errorStatuses: [400, 401, 403, 404, 409, 422, 429, 503] });
Object.assign(paths['/api/v2/connectors/email/callback'].get, {
  'x-query-schema': './schema.json#/$defs/EmailCallbackQuery',
  'x-query-constraints': ['state is always required', 'exactly one of code or error must be present', 'a provider error callback omits code and returns a 302 redirect to the allowlisted route', 'Location must use the brainia:// scheme and must not contain a token']
});
addOp('/api/v2/connectors/{id}/revoke', 'post', { scope: 'connectors:write', request: 'ConnectorRevokeRequest', success: { 200: 'ConnectorRevokeResponse' }, parameters: [pathId] });
write('openapi.json', { openapi: '3.1.0', jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema', info: { title: 'Brain AI proposed resolved API revision B02-r2', version: '2.0.0', description: 'UNAPPROVED revision. Resolved field decisions and provisional operation schemas; see open-items.json. Schema validity does not imply consent, ownership, source eligibility, implementation or runtime support.' }, security: [{ deviceBearer: [] }], components: { securitySchemes: { deviceBearer: { type: 'http', scheme: 'bearer', description: 'Revocable owner/device-bound opaque credential; out-of-band issuance, no public enrollment API.' } } }, 'x-open-items': './open-items.json', paths });
const ajv = new Ajv({ strict: true, code: { source: true }, allErrors: true });
addFormats(ajv);
ajv.addSchema(schema);
const exports = Object.fromEntries(Object.keys(defs).map(k => [k, `${schema.$id}#/$defs/${k}`]));
const generated = standalone(ajv, exports);
await build({ stdin: { contents: generated, resolveDir: process.cwd(), sourcefile: 'standalone.cjs' }, bundle: true, platform: 'node', format: 'cjs', outfile: path.join(dir, 'validators.cjs'), legalComments: 'inline', minify: false });
write('validator-provenance.json', { schemaSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'schema.json'))).digest('hex'), compiler: 'ajv 8.20.0', formats: 'ajv-formats 3.0.1', bundler: 'esbuild ' + (await import('esbuild')).version });
for (const pkg of ['ajv', 'ajv-formats']) fs.copyFileSync(path.join(process.cwd(), 'node_modules', pkg, 'LICENSE'), path.join(dir, `${pkg}.LICENSE`));
console.log('Schema, OpenAPI, resolved open-item checklist and standalone validators generated.');
