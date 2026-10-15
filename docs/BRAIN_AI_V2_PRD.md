# Brain AI v2 product and engineering requirements

Version 2.0.0-draft.1 · Proposed · 2026-10-15. Architecture and API contract are normative companions.

## Objective and boundaries

Deliver reliable personal memory from observed evidence, with precise finance, explainable retrieval, preserved corrections, explicit privacy and future connectors. Backend owns evidence, interpretation, canonical reconciliation and intelligence. Mobile owns native capture, local delivery durability, secure credentials and interaction. A delivery success is not an interpretation success. A generated summary is not evidence.

Non-goals: rewrite existing intelligence, autonomous external actions, general-purpose workflow platform, guaranteed capture while Android permissions are revoked/app force-stopped, automatic FX conversion, reconstructing missing historical source updates, full mailbox/location collection by default, or simultaneous multi-repository worker access.

## Requirements and acceptance

| ID / workstream | Requirement | Acceptance |
|---|---|---|
| R01 / WS01 | Reprocessing changes only owned projections. | Classification -> semantics -> retry -> correction replay retains transaction ID, distinct evidence count, manual title/category/account and unrelated domain rows in 100% of fixture cases. |
| R02 / WS02 | All operations use authenticated owner, source permissions and operation scope. | Full route/query matrix rejects other-owner reads/writes/exports/correlation; zero forbidden provider dispatches including embeddings and summaries. |
| R03 / WS03 | Durable leased jobs survive crashes and overlaps. | Every nonterminal recoverable job is reclaimed within lease + two poll intervals; stale attempts publish zero effects. |
| R04 / WS04 | Installed DB objects verified independently of ledger. | Fresh/upgrade/partial-schema and restricted-role tests pass; isolated backup restore reconciles evidence counts and tombstones. |
| R05 / WS05 | Observation revision and delivery identity remain separate. | Duplicate attempt returns same revision, update returns new revision, out-of-order deliveries preserve local ordering, conflicting fingerprint returns 409. |
| R06 / WS06 | Every material fact carries source span, method/version and validation. | Unsupported/ambiguous facts remain inspectable and never authoritative; 100% finance totals derive from validated facts or user confirmation. |
| R07 / WS07 | Explicit financial lifecycle and exact currency. | Same amount/time cannot auto-merge; refunds/authorizations/settlements/transfer legs do not double-count; UNKNOWN/unsupported excluded from reportable totals. |
| R08 / WS08 | Compatible, incremental embeddings only. | Content unchanged -> zero generation calls; model/dimension mismatch -> zero comparisons; deletion removes vectors and stored content. |
| R09 / WS09 | Hybrid queries have uniform filters and traceable answers. | All branches pass same owner/source/time/type tests; older-than-1,000 relevant evidence retrieved; Recall@20 >=0.90 on golden queries. |
| R10 / WS10 | Episodes preserve ambiguity, chronology and revisions. | Golden episode pairwise precision >=0.95; no unsupported causal statements; late evidence revises membership without rewriting evidence. |
| R11 / WS11 | Connectors reuse observations and privacy contracts. | Cursor replay/expiry/token revocation/duplicate receipt cases lose zero committed messages and cause zero confirmed false merges. |
| R12 / WS12 | Bounded and observable LLM use. | All calls audited with purpose/model/prompt/policy versions; budgets enforced across retries; <=1 average interpretation/governance call per successful observation on golden mix, no quality regression. |
| R13 / WS13 | Independent, repeatable quality evaluation. | Synthetic/sanitized versioned fixtures and baseline/target reports exist; hard release gates pass without averaging away failures. |

## User journeys

1. User registers one device, explicitly selects capture apps and confirms provider permissions. Empty selection captures nothing. Offline notification is committed locally before network delivery; UI shows pending/sent/needs-attention separately from interpretation. Reconnect returns durable receipt; queue removes only matching acknowledged revision.
2. A purchase notification updates from pending to posted. User sees one canonical event with an evidence timeline, separate authorization/settlement details and original currency. A second identical purchase remains distinct. Ambiguous reconciliation offers review with reasons and candidates.
3. User corrects merchant/category once or creates a reusable scoped rule. Automatic reprocessing retains the correction. Revoking the rule changes future projection selection with audit history; it does not erase earlier raw facts.
4. User asks a spending total or conceptual question. SQL returns exact grouped totals; retrieval returns permitted evidence only; synthesis cites immutable revision/fact IDs and discloses missing/uncertain evidence.
5. User disables model processing for a source. Queued work is denied at dispatch; local retrieval remains available if source enabled. Source capture opt-out pauses collection. Deletion previews scope and removes derived content, with visible asynchronous completion.
6. User connects email with least privilege and a bounded history window. Notifications and receipts correlate only on strong references or explicit confirmation. User can revoke access and delete connector data independently.

## Proposed service targets

Targets are release criteria, not measured current performance. Phase 0 records hardware/load/corpus and baseline; changes require an explicit plan amendment.

| Metric | Target and measurement boundary |
|---|---|
| Capture durability | Zero loss in 10,000 simulated persisted captures across process deaths/offline/ack-loss; OS-unobserved notifications reported separately. |
| API capture | p95 <=500ms warm at 10 concurrent requests on staging, durable commit only; cold-start tracked separately. |
| Processing | p95 <=60s after online durable ingestion at agreed 1 observation/s load, excluding provider outage and review. |
| Retrieval | p95 <=1s local retrieval at measured corpus plus synthetic scale; complete answer <=45s or explicit asynchronous pending. |
| Financial | Field precision >=99%, recall >=97%, currency precision 100% on supported confirmed cases, zero hard-fixture false merges/duplicates. |
| Grounding | 100% verifiable citation references and numeric claims; >=98% independently judged supported nonnumeric claims, unsupported claims withheld. |
| Cost | >=30% fewer provider calls vs measured baseline without quality regression; proposed cap $0.01/observation and $0.05/complex answer, human approval required. Denominator includes failed/retried calls. |
| Reliability | 100% crash scenarios recover, no forever-running jobs; alerts within two polls for expired leases/dead letters/backlog >5min. |
| Native UX | Offline/pending/auth-expired/storage-full states, TalkBack, font scaling and compact/large phone checks; no content/credential logging. |

## Retention and user control

Proposed defaults require privacy owner approval: acknowledged mobile outbox content deleted within 24h; unacknowledged bounded at 30 days/10,000 rows/50MiB, whichever first. Never silently evict pending records: pause capture, show recoverable storage-full state and obtain explicit export/discard decision. Backend raw evidence retained until user deletion by default; optional source retention applied in UTC daily. Location raw signals default seven days, disabled until consent. Derived data cannot outlive its last supporting permitted source. Online deletion completes within 24h; retrieval/provider access blocked immediately by tombstone. Backups expire under a proposed 30-day policy; restored databases replay deletion tombstones before serving traffic. Legal holds, if ever required, need separate user-visible policy rather than covert retention.

## Approval and release

G0 baseline establishes deployment facts; G1 approves API bundle before any mobile implementation; G2 verifies safety fixes; G3 verifies v1/v2 compatibility and native capture; G4 approves semantic/temporal and cost/privacy choices; G5 verifies connectors and opt-ins. Every gate requires independent worker evidence and repository revision hashes. All destructive changes and production deployments need explicit human approval. No phase is complete merely because a task was coded.
