import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { canonical, fingerprint, sha256 } from './canonical.mjs';
const dir = path.dirname(fileURLToPath(import.meta.url));
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const validators = createRequire(import.meta.url)('./validators.cjs');
const schema = read('schema.json'), open = read('open-items.json'), api = read('openapi.json');
const fixtures = read('fixtures.json');
let checks = 0;
function check(condition, label) { assert.ok(condition, label); checks++; }
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
function semantic(name, value) {
  // These cannot be expressed portably in JSON Schema: byte lengths, int64,
  // fingerprint recomputation, decimal comparisons and cross-field policy.
  canonical(value); // Reject invalid Unicode everywhere, including raw keys.
  if (name === 'Envelope') {
    if (BigInt(value.producerSequence) > 9223372036854775807n) return false;
    if (bytes(value) > 65536 || (value.content.title !== null && Buffer.byteLength(value.content.title) > 1024) || (value.content.body !== null && Buffer.byteLength(value.content.body) > 49152)) return false;
    if (fingerprint(value) !== value.contentFingerprint) return false;
    if (value.content.type === 'location') {
      const c = value.content;
      if (compare(c.latitude, '-90') < 0 || compare(c.latitude, '90') > 0 || compare(c.longitude, '-180') < 0 || compare(c.longitude, '180') > 0 || Date.parse(c.intervalEnd) < Date.parse(c.intervalStart)) return false;
    }
    if (value.content.type === 'activity') {
      const c = value.content;
      if (Date.parse(c.interval.end) < Date.parse(c.interval.start)) return false;
    }
  }
  if (name === 'BatchRequest') return bytes(value) <= 1048576 && value.items.every(e => valid('Envelope', e));
  if (name === 'BatchResponse') return value.results.every((r, i) => r.index === i && (r.status >= 400 ? (r.deliveryId === null || typeof r.deliveryId === 'string') : r.deliveryId === r.receipt.deliveryId));
  if (name === 'PolicyRequest' || name === 'PolicyResponse') return value.externalModelsAllowed || !value.externalEmbeddingsAllowed;
  if (name === 'Fact') {
    const e = value.evidence;
    if ((e.start === null) !== (e.end === null)) return false;
    if (e.start !== null && e.end <= e.start) return false;
  }
  if (name === 'Episode' || name === 'EpisodeDetail') return value.endAt === null || Date.parse(value.endAt) >= Date.parse(value.startAt);
  if (name === 'QueryRequest') {
    const f = value.filters;
    return !(f.from && f.to) || Date.parse(f.from) <= Date.parse(f.to);
  }
  if (name === 'FinancialTransaction') return value.adjustments.every(a => a.currency === value.currency);
  if (name === 'FinancialSummary') {
    const span = Date.parse(value.to) - Date.parse(value.from);
    return span >= 0 && span <= 366 * 86400000;
  }
  if (name === 'FinancialSummaryQuery') {
    const span = Date.parse(value.to) - Date.parse(value.from);
    return span >= 0 && span <= 366 * 86400000;
  }
  return true;
}
function valid(name, value) { try { return !!validators[name](value) && semantic(name, value); } catch { return false; } }
function scaled(value) { const neg = value.startsWith('-'); const [integer, fraction = ''] = value.replace(/^-/, '').split('.'); const n = BigInt(integer) * 1000000n + BigInt(fraction.padEnd(6, '0')); return neg ? -n : n; }
function compare(a, b) { const x = scaled(a), y = scaled(b); return x < y ? -1 : x > y ? 1 : 0; }
// Verify exact distribution bytes before interpreting fixture assertions.
const manifest = read('SHA256SUMS.json');
const actualNames = fs.readdirSync(dir).filter(n => n !== 'SHA256SUMS.json').sort();
check(JSON.stringify(Object.keys(manifest.files).sort()) === JSON.stringify(actualNames), 'manifest file set');
for (const [name, hash] of Object.entries(manifest.files)) {
  check(!name.includes('/') && !name.includes('\\') && sha256(fs.readFileSync(path.join(dir, name))) === hash, 'checksum ' + name);
}
check(sha256(fs.readFileSync(path.resolve(dir, '../../../docs/BRAIN_AI_V2_API_CONTRACT_v2.0.0.md'))) === manifest.files['spec.md'], 'normative spec snapshot matches');
check(read('validator-provenance.json').schemaSha256 === manifest.files['schema.json'], 'standalone validator schema binding');
check(api.openapi === '3.1.0' && schema.$schema === 'https://json-schema.org/draft/2020-12/schema', 'schema dialects');
for (const [name, definition] of Object.entries(schema.$defs)) {
  check(typeof validators[name] === 'function', 'compiled definition ' + name);
  if (definition?.type === 'object') check(definition.additionalProperties === false, 'strict object ' + name);
  if (definition?.oneOf) for (const variant of definition.oneOf) if (variant?.type === 'object') check(variant.additionalProperties === false, 'strict variant ' + name);
}
check(open.approvalReady === false && open.status === 'PROPOSED_REVISION_PENDING_REVIEW', 'approval cannot silently pass');
check(open.revision === 'B02-r3', 'revision identifier');
check(open.openDecisionCount === 0 && !open.items.some(x => x.status === 'open'), 'no open decisions remain');
const requiredResolved = ['activity.marker', 'email.addresses', 'attachmentRefs.items', 'error.details', 'receipt.processing', 'capabilities.auth', 'capabilities.featureGates', 'timestamp.presence', 'raw.security', 'batch.minimumAndMalformedIdentity', 'decimal.storageAndFX', 'currency.registry', 'deletion.creationResponse', 'deletion.remainingCategories', 'Fact', 'enrollmentAndRetention', 'summary.filters'];
for (const name of requiredResolved) check(open.items.some(x => x.name === name && x.status === 'resolved' && typeof x.resolutionDetail === 'string' && x.resolutionDetail.length > 0), 'resolved decision ' + name);
const provisional = ['GET /api/v2/observations/{id}', 'GET /api/v2/observations/{id}/revisions', 'GET /api/v2/events/{id}', 'GET /api/v2/episodes', 'GET /api/v2/episodes/{id}', 'GET /api/v2/financial/transactions', 'POST /api/v2/corrections', 'GET /api/v2/export', 'POST /api/v2/queries', 'GET /api/v2/queries/{id}', 'POST /api/v2/connectors/email/authorize', 'GET /api/v2/connectors/email/callback', 'POST /api/v2/connectors/{id}/revoke'];
for (const operation of provisional) check(open.items.some(x => x.name === operation && x.status === 'schema_published_pending_review' && x.implementationBlocked === true && Array.isArray(x.fixtures) && x.fixtures.length > 0), 'provisional operation ' + operation);
for (const item of open.items) {
  check(['name', 'where', 'why', 'decision'].every(k => typeof item[k] === 'string' && item[k].length > 0), 'actionable item ' + item.name);
  check(['resolved', 'schema_published_pending_review'].includes(item.status), 'item status ' + item.name);
  for (const name of item.schemas) check(Object.hasOwn(schema.$defs, name), 'item schema exists ' + name);
}
check(schema.$defs.Activity.properties.activityMarker.enum.join(',') === 'observed,inferred', 'activity marker decision encoded');
check(schema.$defs.Email.properties.sender.$ref === '#/$defs/EmailAddress', 'email address decision encoded');
check(schema.$defs.ErrorObject.properties.details.$ref === '#/$defs/ErrorDetails', 'error details decision encoded');
check(schema.$defs.Receipt.properties.processing.const === 'queued', 'receipt processing queued-only');
for (const name of ['Email', 'ReceiptContent']) check(schema.$defs[name].properties.attachmentRefs.maxItems === 0, 'attachment refs empty-only decision encoded');
check(schema.$defs.BatchRequest.properties.items.maxItems === 100 && schema.$defs.BatchResponse.properties.results.maxItems === 100 && schema.$defs.Capabilities.properties.maxBatchItems.const === 100, 'batch limit 1..100 decision encoded');
check(schema.$defs.BatchItem.oneOf.every(v => v.properties.index.maximum === 99), 'batch result index bound matches 1..100');
check(schema.$defs.FinancialSummaryQuery.properties.conversionTo.$ref === '#/$defs/CurrencyRegistry' && JSON.stringify(schema.$defs.FinancialSummaryQuery.dependentRequired) === JSON.stringify({ conversionTo: ['fxRateId'] }), 'summary conversion requires fxRateId');
check(JSON.stringify(schema.$defs.CurrencyRegistry.enum) === JSON.stringify(['USD', 'UYU']), 'summary currency registry membership encoded');
check(schema.$defs.EmailCallbackQuery.oneOf.length === 2 && JSON.stringify(schema.$defs.EmailCallbackQuery.required) === JSON.stringify(['state']), 'callback allows code xor error with state required');
check(schema.$defs.Notification.properties.raw.additionalProperties === false && schema.$defs.ReceiptContent.properties.raw.additionalProperties === false, 'raw allowlists fail closed');
check(schema.$defs.Note.properties.raw.additionalProperties === false && schema.$defs.Note.properties.raw.properties && Object.keys(schema.$defs.Note.properties.raw.properties).length === 0, 'note raw empty');
check(schema.$defs.Capabilities.properties.features.properties.email.const === false && schema.$defs.Capabilities.properties.features.properties.connectors.const === false, 'capability gates stay false');
check(schema.$defs.DeletionCreationResponse.properties.state.const === 'queued', 'deletion creation response decision encoded');
check(open.blockedMobileTasks.includes('M07'), 'M07 remains blocked');
// The destructive creation operation remains excluded from OpenAPI.
check(JSON.stringify(open.excludedOperations) === JSON.stringify(['POST /api/v2/deletions']), 'only deletion creation excluded');
check(open.intentionallyExcludedOperations.some(x => x.operation === 'POST /api/v2/deletions' && x.reason.length > 0), 'deletion exclusion documented');
check(!api.paths['/api/v2/deletions']?.post, 'deletion creation absent from OpenAPI');
// Published provisional operations carry explicit scopes and response schemas.
const expectedOps = {
  'get /api/v2/observations/{id}': ['capture:read', 'ObservationDetail'],
  'get /api/v2/observations/{id}/revisions': ['evidence:read', 'ObservationRevisionPage'],
  'get /api/v2/events/{id}': ['evidence:read', 'Event'],
  'get /api/v2/episodes': ['evidence:read', 'EpisodePage'],
  'get /api/v2/episodes/{id}': ['evidence:read', 'EpisodeDetail'],
  'get /api/v2/financial/transactions': ['finance:read', 'FinancialTransactionPage'],
  'post /api/v2/corrections': ['corrections:write', 'CorrectionResponse'],
  'get /api/v2/export': ['privacy:export', 'ExportResponse'],
  'post /api/v2/queries': ['intelligence:read', 'QueryResult'],
  'get /api/v2/queries/{id}': ['intelligence:read', 'QueryResult'],
  'post /api/v2/connectors/email/authorize': ['connectors:write', 'EmailAuthorizeResponse'],
  'get /api/v2/connectors/email/callback': ['oauth:callback', null],
  'post /api/v2/connectors/{id}/revoke': ['connectors:write', 'ConnectorRevokeResponse']
};
for (const [key, [scope, output]] of Object.entries(expectedOps)) {
  const [method, route] = key.split(' ');
  const op = api.paths[route]?.[method];
  check(!!op, 'published operation ' + key);
  check(op['x-required-scope'] === scope, 'operation scope ' + key);
  if (output) check([200, 201, 202].some(s => op.responses[s]?.content?.['application/json']?.schema?.$ref === './schema.json#/$defs/' + output), 'operation response ' + key);
}
check(api.paths['/api/v2/connectors/email/callback'].get.responses['302'].headers.Location.required === true, 'callback redirect allowlisted by Location header');
check(Array.isArray(api.paths['/api/v2/connectors/email/callback'].get.security) && api.paths['/api/v2/connectors/email/callback'].get.security.length === 0, 'callback does not require a bearer header');
// Every external OpenAPI schema reference resolves in the published JSON Schema.
function walk(value) { if (!value || typeof value !== 'object') return; for (const [key, v] of Object.entries(value)) { if (key === '$ref') { check(typeof v === 'string' && v.startsWith('./schema.json#/$defs/') && Object.hasOwn(schema.$defs, v.split('/').at(-1)), 'OpenAPI reference ' + v); } else walk(v); } }
walk(api);
for (const fixture of fixtures.schemaCases) check(valid(fixture.schema, fixture.value) === fixture.valid, 'fixture ' + fixture.name);
for (const name of ['attachment-receipt-nonempty', 'attachment-email-nonempty', 'batch-count-max', 'batch-count-limit', 'summary-query-reversed-range', 'summary-query-too-long', 'summary-query-conversion-without-rate', 'summary-query-unsupported-currency', 'email-callback-provider-error', 'email-callback-missing-code-and-error']) {
  check(fixtures.schemaCases.some(c => c.name === name), 'required fixture ' + name);
}
for (const c of fixtures.callbackCases) {
  const q = c.query;
  const shape = typeof q?.state === 'string' && ((typeof q.code === 'string') !== (typeof q.error === 'string'));
  const secure = typeof c.location === 'string' && c.location.startsWith('brainia://connectors/email/callback?') && !/token|code|access_token/i.test(c.location);
  check((shape && c.status === 302 && secure) === c.valid, 'callback ' + c.name);
}
for (const c of fixtures.canonicalCases) {
  if (c.invalid) { assert.throws(() => canonical(c.input)); checks++; continue; }
  const actual = canonical(c.input);
  check(actual === c.canonical, 'JCS bytes ' + c.name);
  check(Buffer.from(actual).toString('hex') === c.utf8Hex, 'UTF-8 bytes ' + c.name);
  check(sha256(actual) === c.sha256, 'JCS hash ' + c.name);
}
check(fixtures.canonicalCases.find(x => x.name === 'composed').sha256 !== fixtures.canonicalCases.find(x => x.name === 'decomposed').sha256, 'no Unicode normalization');
// Independent fixed SHA-256 known answer and JCS primitive answers.
check(sha256('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA-256 known answer');
check(canonical({ b: 2, a: 1 }) === '{"a":1,"b":2}' && canonical([-0, 1e30, 0.002]) === '[0,1e+30,0.002]', 'JCS fixed known answers');
check(canonical({ '\ue000': 1, '\ud83d\ude00': 2 }) === '{"\ud83d\ude00":2,"\ue000":1}', 'UTF-16 key order differs from code-point order');
check(canonical('\b\t\n\f\r"\\') === '"\\b\\t\\n\\f\\r\\"\\\\"', 'JCS escaping fixed answer');
for (const c of fixtures.acknowledgementCases) {
  const accepted = [200, 201].includes(c.status) && valid('Receipt', c.receipt) && ['deliveryId', 'producerRevisionId', 'contentFingerprint'].every(k => c.envelope[k] === c.receipt[k]);
  check(accepted === c.accepted, 'ack ' + c.name);
}
// Reference identity oracle ONLY: not a server/DB implementation or E02 certification.
for (const sequence of fixtures.identitySequences) {
  const deliveries = new Map(), revisions = new Map(), observations = new Map(); const statuses = [];
  for (const e of sequence.items) {
    check(valid('Envelope', e), 'sequence envelope ' + sequence.name);
    const delivery = e.sourceInstanceId + '/' + e.deliveryId, revision = e.sourceInstanceId + '/' + e.producerRevisionId;
    const obs = e.sourceInstanceId + '/' + e.sourceObservationKey;
    const request = canonical(e), identity = canonical([obs, e.producerSequence, e.contentFingerprint]);
    if (deliveries.has(delivery)) { statuses.push(deliveries.get(delivery) === request ? 200 : 409); continue; }
    if (revisions.has(revision)) { if (revisions.get(revision) !== identity) { statuses.push(409); continue; } deliveries.set(delivery, request); statuses.push(200); continue; }
    deliveries.set(delivery, request); revisions.set(revision, identity); statuses.push(201);
    const previous = observations.get(obs) || 0n; observations.set(obs, BigInt(e.producerSequence) > previous ? BigInt(e.producerSequence) : previous);
  }
  check(revisions.size === sequence.expected.revisionCount && observations.size === sequence.expected.observationCount, 'sequence counts ' + sequence.name);
  check(JSON.stringify(statuses) === JSON.stringify(sequence.expected.statuses), 'sequence status ' + sequence.name);
  check([...observations.values()].reduce((a, b) => a > b ? a : b, 0n).toString() === sequence.expected.latestSequence, 'sequence latest ' + sequence.name);
}
for (const c of fixtures.policyCases) { const allowed = c.owner === c.sourceOwner && c.enabled && (c.purpose !== 'external' || c.externalAllowed); const status = allowed ? 200 : c.owner !== c.sourceOwner ? 404 : 403; check(allowed === c.allowed && status === c.status, 'policy oracle ' + c.name); }
for (const c of fixtures.groundingCases) { const accepted = c.owner === c.evidenceOwner && c.permitted && c.start >= 0 && c.end >= c.start && c.end <= c.source.length && c.source.slice(c.start, c.end) === c.excerpt && sha256(c.excerpt) === c.excerptHash; check(accepted === c.valid, 'grounding oracle ' + c.name); }
for (const c of fixtures.moneyCases) { check(scaled(c.refund) - scaled(c.expense) === scaled(c.net), 'exact decimal refund ' + c.currency); check(['UYU', 'USD'].includes(c.currency) && [c.expense, c.refund, c.net].every(v => /^-?(0|[1-9][0-9]*)\.[0-9]{2}$/.test(v)), 'currency precision ' + c.currency); }
for (const c of fixtures.deferredCases) check(open.items.some(item => item.name === c.blockedBy) && c.runtimeVerified === false, 'deferred runtime scenario ' + c.name);
console.log(`PASS ${checks} contract checks; ${fixtures.schemaCases.length} positive/negative schema+semantic fixtures; ${fixtures.identitySequences.length} identity sequences.`);
console.log('Bundle manifest SHA-256: ' + sha256(fs.readFileSync(path.join(dir, 'SHA256SUMS.json'))));
console.log('PROPOSED REVISION PENDING REVIEW: ' + open.openDecisionCount + ' open G1 decisions; ' + open.provisionalOperationCount + ' provisional operation schemas; deletion creation remains excluded. Pure fixture oracles do not certify runtime privacy, database, native capture or grounded synthesis.');
