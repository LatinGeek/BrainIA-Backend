# Shared API contract 2.0.0

Status: **PROPOSED / UNAPPROVED**. Specification revision 2.0.0-draft.1. Authority: BrainIA-Backend planning bundle; consumers: BrainIA-Backend and BrainIA-Mobile. This is a normative interface specification, not an implemented API. Existing `/api/v1` remains available during migration. No mobile implementation, including credentials/consent/capture/UI changes, may start before G1 records human approval of this contract bundle's SHA-256 and both repository reviewers. Safety containment on a live release requires separately authorized action if approval cannot wait.

## Distribution and compatibility

Backend contract worker publishes reviewed OpenAPI 3.1 + JSON Schema + fixtures + checksum bundle in `contracts/brain-ai/2.0.0/` (future task). Mobile contract-import worker imports those exact bytes into its own repository and verifies SHA-256; backend workers never copy into mobile. Contract validation precedes generation of TypeScript/Kotlin models. No runtime imports across repositories. SemVer: optional response fields/minor enum extension with unknown handling -> minor; changed required fields/identity/state semantics -> major; clarification -> patch. Unknown response enum values show unknown state and never imply acknowledged/succeeded. Requests reject unknown fields except explicit `content.raw` extension object.

Approval ledger entry must contain version, canonical artifact hashes (spec/schema/fixtures), backend reviewer, mobile reviewer, human approver, timestamp, auth and retention decisions, approved capabilities, and expiry/change policy. A textual draft or worker completion is not approval. G1 can approve a subset only if omitted mobile feature tasks remain blocked. Any material wire change invalidates downstream approval until reviewed. Live capabilities endpoint, not app version alone, determines v2 support. Remove v1 only after >=30 days with zero known active v1 devices and explicit retirement approval; offline devices remain an open migration concern.

## Authentication and HTTP conventions

HTTPS mandatory. Initial strategy: registered revocable owner-bound device credential using `Authorization: Bearer <opaque-device-token>`. Server maps token hash to principal/owner/scopes; token contains no trusted caller-supplied owner. Legacy client API key accepted by v1 only after mapping to same principal; reject mismatched `x-brainia-client-id`, do not use it as filter authority. Never ship global backend/admin or Supabase service credentials in mobile. Device credential enrollment occurs out of band through controlled admin issuance in first release; OAuth/user-session enrollment is deferred, not silently implemented without review.

All routes below require authenticated owner and listed operation scope. Admin/cron auth uses dedicated exact endpoints and distinct credential class. Caller cannot provide owner_id/client_id in bodies/queries. 401 pauses queue and prompts reauthentication; 403 pauses relevant operation; 404 hides foreign IDs. `X-Request-Id` is an opaque trace ID, no personal content. `Cache-Control: no-store` for personal responses. `Content-Type: application/json; charset=utf-8`. JSON timestamps RFC3339 with explicit offset; responses UTC. Dates never use device locale formatting. Opaque IDs 1–160 characters; source keys 1–512, revision/delivery IDs UUID strings. Decimal regex `^-?(0|[1-9][0-9]*)(\.[0-9]{1,6})?$`, no exponent/NaN/floats. Cursors opaque, owner/filter-bound, exclusive; default 50/max100 results.

Errors use `{error:{code,message,requestId,retryable,details?}}`; details contain field paths/limits/expected versions, never secret/personal payload. Common codes: invalid_request(400), unauthenticated(401), forbidden(403), not_found(404), identity_conflict or version_conflict(409), payload_too_large(413), unsupported_contract(422), fingerprint_mismatch(422), rate_limited(429), unavailable(503). 429/503 supply Retry-After; retries preserve identity fields. Policy-disabled capture returns 403/source_disabled, not a success receipt. Server does not accept-and-drop evidence. 5xx before acknowledgement may have committed: replay same delivery ID.

## Endpoints

| Endpoint | Scope | Semantics |
|---|---|---|
| GET /api/v2/capabilities | capture:read | `{apiVersion:"2.0.0",captureVersions:[1,2],maxBatchItems:50,maxItemBytes:65536,maxBatchBytes:1048576,features:{observationRevisions:true,decimalFinance:true},policyVersion}`. No credentials. |
| POST /api/v2/observations | capture:write | One envelope below, 201 new revision or 200 exact replay; atomic evidence + receipt + job commit. |
| POST /api/v2/observations/batch | capture:write | `{contractVersion:2,items:[Envelope]}` <=50/1MiB. 200 `{results:[{deliveryId,status:201|200|400|403|409|422|503,receipt?,error?}]}` in input order; per-item transactions. Invalid top envelope/size fails whole request. Unacknowledged items replay individually. |
| GET /api/v2/observations/:id | capture:read | Owner's identity, revision references, stage summary and cursor; no server jobs claimed by client. |
| GET /api/v2/observations/:id/revisions | evidence:read | Cursor page immutable content/evidence IDs; hidden/deleted excluded. |
| GET /api/v2/events/:id | evidence:read | Canonical ID/type/lifecycle/version and permitted evidence links, uncertainty and interpretations distinguished. |
| GET /api/v2/episodes | evidence:read | Owner/source/time/type filters and cursor; episode DTO below. B23 provides isolated staging for M07 verification; production enablement waits for G4. |
| GET /api/v2/episodes/:id | evidence:read | Current revision and permitted member evidence with version, uncertainty and corrections; 404 for inaccessible ID. |
| GET /api/v2/financial/transactions | finance:read | Filters from/to (inclusive/exclusive), currency, lifecycle, accountId, cursor. Decimal amounts, canonical IDs and evidence counts. |
| GET /api/v2/financial/summary | finance:read | from/to/accountId; original-currency groups, exact SQL totals, excluded/review counts and asOf. Optional explicit conversionTo with approved fxRateId only; no default conversion. |
| POST /api/v2/corrections | corrections:write | Optimistic versioned correction below; 201 or 200 idempotent replay, 409 stale target. |
| PUT /api/v2/sources/:id/policy | privacy:write | expectedVersion, enabled, externalModelsAllowed, externalEmbeddingsAllowed, retentionDays:null|1..3650. Both external booleans explicit; externalModelsAllowed:false forces embeddings false. Returns policyVersion + effectiveAt. |
| POST /api/v2/deletions | privacy:delete | idempotencyKey, scope:{sourceInstanceId? OR observationId? OR all:true}, mode:evidence|derived|all, expectedPolicyVersion; 202 deletion ID/state. Immediate tombstone, asynchronous content cleanup. |
| GET /api/v2/deletions/:id | privacy:read | `{id,state:queued|running|completed|failed,blockedAt,completedAt?,remainingCategories,backupExpiryAt?}` no personal deleted content. |
| GET /api/v2/export | privacy:export | Cursor-paged export of permitted evidence, revisions, corrections, finance and provenance; snapshots/filter/owner bound, audit metadata. |
| POST /api/v2/queries | intelligence:read | `{query,maxEvidence:30,externalSynthesisAllowed:false,filters:{sourceInstanceIds?,from?,to?,types?}}`; 200 result or 202 queryId. Defaults no external query upload. |
| GET /api/v2/queries/:id | intelligence:read | queued/running/completed/review/failed with answer/evidence below only after verification. |
| POST /api/v2/connectors/email/authorize | connectors:write | provider:gmail, returnRoute from allowlist, historyDays:1..90; returns OAuth URL/state expiry; backend stores PKCE/state binding. No refresh tokens in response. |
| GET /api/v2/connectors/email/callback | server OAuth callback | One-use state+code/PKCE binds owner and provider account; deny missing/expired state. Returns allowlisted mobile deep link with opaque success ID, never token. |
| POST /api/v2/connectors/:id/revoke | connectors:write | expectedVersion, deleteCapturedData:boolean; cancels sync/revokes token, optionally queues deletion. Idempotent owner-bound response. |

Connector endpoints are Phase 4, behind capabilities and G5; mobile consent feature may implement only after its corresponding contracts remain approved. Attachment upload and provider push delivery are backend connector internals, not unrestricted public capture endpoints. Source instances for mobile are provisioned with credentials; email instances arise from OAuth. Location/activity use the same observation endpoint only when approved features advertise their source type.

## Observation envelope and acknowledgement

```json
{
  "contractVersion": 2,
  "deliveryId": "7192b218-14b0-44e6-95cb-3987d625d186",
  "sourceInstanceId": "src_device_notifications",
  "sourceObservationKey": "instance:014f9a7b",
  "producerRevisionId": "a0226d7a-7156-473a-93d9-8d9d68a6e618",
  "producerSequence": "2",
  "changeKind": "updated",
  "canonicalizationVersion": "jcs-sha256-v1",
  "contentFingerprint": "<64 lowercase hex characters computed from canonical content>",
  "sourceOccurredAt": "2026-10-15T12:00:00-03:00",
  "sourceUpdatedAt": "2026-10-15T12:01:00-03:00",
  "deviceObservedAt": "2026-10-15T15:01:01Z",
  "content": {
    "type": "notification",
    "packageName": "example.bank",
    "title": "Compra confirmada",
    "body": "UYU 125,50 en Comercio Ejemplo",
    "raw": {"notificationKey":"opaque-key", "isOngoing":false}
  }
}
```

Envelope required fields: all above except source timestamps nullable. producerSequence is a positive int64 decimal string allocated in durable source storage, not a JavaScript number. content.type enum notification|email|receipt|note|activity|location, per-type schemas below. Item <=64KiB UTF-8 including raw, body <=48KiB, title <=1KiB; original oversized evidence must not be silently truncated and labelled complete. Queue item becomes needs_attention, with explicit user decision or separately versioned attachment support. Limits are part of G1 approval.

Common content shape is strict `{type,title:string|null,body:string|null,raw:object}`; notification additionally requires packageName. Email adds providerMessageId, providerThreadId nullable, sender, recipients array, attachmentRefs array; no OAuth tokens. Receipt adds merchantText nullable, reference nullable, attachmentRefs; values still extracted/validated backend-side. Activity adds signalType, intervalStart, intervalEnd, confidence nullable and observed/inferred marker. Location adds latitude/longitude decimal strings, accuracyMeters nonnegative decimal, intervalStart/end, provider; no inferred activity in observed field. Note has no extra required fields. All observations require a source instance with matching authorized type. JSON Schema worker must enumerate full strict per-type variants and invalid examples before approval; no generic raw payload may bypass consent/limits.

```json
{
  "contractVersion": 2,
  "deliveryId": "7192b218-14b0-44e6-95cb-3987d625d186",
  "receiptId": "receipt_opaque",
  "observationId": "obs_opaque",
  "revisionId": "rev_opaque",
  "revisionNumber": 2,
  "producerRevisionId": "a0226d7a-7156-473a-93d9-8d9d68a6e618",
  "contentFingerprint": "<same validated fingerprint>",
  "disposition": "stored",
  "receivedAt": "2026-10-15T15:01:02Z",
  "processing": "queued",
  "policyVersion": 3
}
```

disposition enum stored|duplicate; revisionNumber is positive server integer <=2^31-1. Exact delivery replay returns same receipt/revision. Same producer revision with new delivery ID returns duplicate pointing to existing revision. Different content with reused delivery or revision ID -> 409; fingerprint mismatch ->422. Acknowledgement is durable storage, not canonical confirmation. Mobile validates deliveryId+producerRevisionId+fingerprint and supported contract before marking acknowledged; an arbitrary 2xx or malformed body leaves item pending. No fallback of a v2 queued update to key-only v1 semantics. Capability failure holds v2 queue; a separately flagged v1 mode is limited and visibly lacks revision guarantee.

## Fact, financial, correction and answer DTOs

Fact contract (Zod discriminator plan): strict common object `{id,field,dataType,value,revisionId,evidence:{pointer,start?,end?,excerptHash},method,extractorVersion,modelRevision:null|string,confidence:0..1,uncertainty:{reason,candidates}?,validationStatus,userCorrectionStatus}`. dataType enum string|decimal|currency|timestamp|boolean|entity_ref; value type must match discriminator, decimal never float. method deterministic|provider_structured|llm|user; validationStatus proposed|validated|ambiguous|rejected|user_confirmed; userCorrectionStatus none|active|revoked. Span bounds must be paired and UTF-16 verified. Confidence is not an authorization or confirmation threshold. Model output passes Zod and source evidence validation before canonical selection; title/merchant without span stays proposal. Balances and totals are separate field/role facts. Conflict response preserves both fact IDs and review reason.

Financial DTO: `{id,canonicalEventId,version,kind:expense|income|transfer,lifecycle,amount:"125.50",currency:"UYU",currencyStatus,occurredAt,postedAt:null|string,merchant:{id?,label,verified},accountId:null|string,evidenceCount,revisionCount,evidence:[{observationId,revisionId,factIds,role,strength}],reviewReasons:[]}`. Signed adjustments are returned separately; amount is nonnegative base magnitude, summary applies kind/adjustment sign. No totals from evidenceCount. Summary `{from,to,asOf,totals:[{currency,income,expense,refunds,net,transactionCount}],excluded:{ambiguous,unsupported,pending},conversion:null|{rateId,rate,asOf,provider,toCurrency,amount}}`. Account scope validated on every request. All fields with currency include explicit currency or null/unknown status; no implicit USD/UYU fallback.

Correction POST `{idempotencyKey,target:{type:"fact"|"event"|"transaction",id,expectedVersion},field,value,scope:"once"|"rule",ruleMatch?:{sourceInstanceId,exactDescriptor},reason?}`. Allowlist field/value schemas; ruleMatch mandatory for rule; server previews affected count and returns review requirement if broad. Result `{correctionId,version,status:"applied"|"review",reprocessing:"queued"|"not_required"}`. Client cannot submit arbitrary SQL/ownership/lifecycle graph mutation. Rule application and undo have audited versions. Existing correction endpoints remain adapter-compatible.

Query result `{queryId,status,answer:null|string,structuredTotals?,evidence:[{id,observationId,revisionId,factId?,pointer?,permittedExcerpt}],claims:[{text,citationIds,verification:"supported"|"uncertain"}],limitations:[],coverage:{exhaustive:boolean,retrievalStrategies:[],timeRange},modelCalls,elapsedMs}`. Uncertain claims are labelled or withheld; no answer presented as verified before verification. Server never emits source text excluded by owner/policy; recheck at response time. Stored answers become unavailable/redacted after source deletion. Evidence text is data, not model/tool instructions.

Episode DTO `{id,type:"shopping"|"work"|"research"|"travel"|"purchase_delivery"|"appointment",version,status:"proposed"|"active"|"closed"|"review"|"retired",startAt,endAt:null|string,timeUncertaintyMs,confidence,members:[{canonicalEventId,revisionId,role,confidence,evidenceIds}],summary:null|{artifactId,revision,text,citationIds},reviewReasons:[]}`. Membership is a supported association, not causality. List response `{items:[Episode],nextCursor:null|string}`; detail additionally includes `priorRevisionIds` and `activeCorrectionIds`. Generic corrections support `target.type:"episode"` with fields membership_include/membership_exclude/split/merge, expectedVersion mandatory, typed ID payloads and source-owner checks; broad merge/split returns review preview before application. B02 must include this feature in G1 bundle or mark it excluded and keep M07 episode implementation blocked until an approved version includes it. No unapproved extension by a mobile worker.

Policy update response `{sourceInstanceId,policyVersion,enabled,externalModelsAllowed,externalEmbeddingsAllowed,retentionDays,effectiveAt,cancelledPendingWorkCount}`. Source disabled denies new capture/processing/retrieval, retains stored evidence until deletion; external processing disabled retains eligible local owner retrieval. A derived result requires all supporting sources to permit its requested purpose. Delete mode `derived` retires interpretations/indexes/artifacts but preserves raw evidence and blocks automatic rebuild until explicit reprocess consent; `evidence` removes raw content and descendants dependent solely on it, recomputing conclusions from remaining evidence; `all` removes both within selected scope. Deletion never deletes other owners' evidence. All modes tombstone their selected domain before cleanup and block stale jobs. Export response `{snapshotId,items:[{type,id,record}],nextCursor}`; type allowlist observation/revision/fact/correction/event/transaction/episode/artifact, each record uses corresponding approved DTO and excludes provider credentials. Cursor expiry returns 409/export_snapshot_expired; restart is explicit.

## Mobile durability, privacy and conformance

Local outbox transactions persist source mapping, sequence, fingerprint and pending item before scheduling. Delivery states pending -> in_flight -> acknowledged; failures -> retry_scheduled|blocked_auth|needs_attention; process restart reclaims in_flight. Exponential full jitter 2s..30min honors Retry-After; WorkManager connectivity constraints, unique drain work, periodic health separate from delivery. Listener callback must not wait for HTTP. Removal is a source lifecycle revision with no financial inference. Force-stop/permission loss cannot be defeated; surface health gap and reconcile available notifications on next permitted execution. Bounds/security/retention follow PRD. Native and JS credentials share one secure abstraction; never mirror plaintext secrets in preferences/logs/backups.

Contract fixture obligations for both repositories: valid/new/duplicate/update/reordered/A-B-A/reused-key/removed envelopes; matching fingerprints including Spanish accents and surrogate pairs; wrong owner, revoked source, private provider prohibition; malformed 2xx, 409, 429, 503, partial batch; decimal/currency/refund; stale correction; deletion replay. Backend publishes bytes, mobile tests against those exact bytes. Shared verification is split into one worker per repository; reviewers exchange receipts/reports through Supervisor, never filesystem write access across repositories.
