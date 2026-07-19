# Graph Report - BrainIA-Backend  (2026-07-19)

## Corpus Check
- 124 files · ~62,120 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 904 nodes · 1534 edges · 61 communities (59 shown, 2 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.61)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1b1462bd`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_entity-repository.ts|entity-repository.ts]]
- [[_COMMUNITY_app.ts|app.ts]]
- [[_COMMUNITY_event-store.ts|event-store.ts]]
- [[_COMMUNITY_postgres.ts|postgres.ts]]
- [[_COMMUNITY_Domain Model|Domain Model]]
- [[_COMMUNITY_Postgres Schema|Postgres Schema]]
- [[_COMMUNITY_Live Event Analysis Report|Live Event Analysis Report]]
- [[_COMMUNITY_financial-transactions.ts|financial-transactions.ts]]
- [[_COMMUNITY_digests.ts|digests.ts]]
- [[_COMMUNITY_financial-transaction-repository.ts|financial-transaction-repository.ts]]
- [[_COMMUNITY_capture.ts|capture.ts]]
- [[_COMMUNITY_cleanup-test-data.ts|cleanup-test-data.ts]]
- [[_COMMUNITY_app.js|app.js]]
- [[_COMMUNITY_scripts|scripts]]
- [[_COMMUNITY_entity-alias-repository.ts|entity-alias-repository.ts]]
- [[_COMMUNITY_package.json|package.json]]
- [[_COMMUNITY_API|API]]
- [[_COMMUNITY_Future Roadmap|Future Roadmap]]
- [[_COMMUNITY_HomeScreen.tsx|HomeScreen.tsx]]
- [[_COMMUNITY_README|README.md]]
- [[_COMMUNITY_Flow|Flow]]
- [[_COMMUNITY_compilerOptions|compilerOptions]]
- [[_COMMUNITY_BrainIA Agent Context|BrainIA Agent Context]]
- [[_COMMUNITY_Architecture|Architecture]]
- [[_COMMUNITY_expo|expo]]
- [[_COMMUNITY_Operations|Operations]]
- [[_COMMUNITY_compilerOptions|compilerOptions]]
- [[_COMMUNITY_Event ingestion|Event ingestion]]
- [[_COMMUNITY_MVP Scope|MVP Scope]]
- [[_COMMUNITY_Runbooks|Runbooks]]
- [[_COMMUNITY_Memory|Memory]]
- [[_COMMUNITY_remote-smoke.ts|remote-smoke.ts]]
- [[_COMMUNITY_BrainIA|BrainIA]]
- [[_COMMUNITY_Agent tools|Agent tools]]
- [[_COMMUNITY_Alias review queue|Alias review queue]]
- [[_COMMUNITY_Capture workflows|Capture workflows]]
- [[_COMMUNITY_Knowledge queries|Knowledge queries]]
- [[_COMMUNITY_BrainIA Mobile Shell|BrainIA Mobile Shell]]
- [[_COMMUNITY_vercel.json|vercel.json]]
- [[_COMMUNITY_Insights|Insights]]
- [[_COMMUNITY_Post-MVP Backlog|Post-MVP Backlog]]
- [[_COMMUNITY_Insights and Digests|Insights and Digests]]
- [[_COMMUNITY_Digests|Digests]]
- [[_COMMUNITY_p1-knowledge.test.ts|p1-knowledge.test.ts]]
- [[_COMMUNITY_Event reprocessing|Event reprocessing]]
- [[_COMMUNITY_entity-repository.ts|entity-repository.ts]]
- [[_COMMUNITY_semantic-repository.ts|semantic-repository.ts]]
- [[_COMMUNITY_semantic-enrichment.ts|semantic-enrichment.ts]]
- [[_COMMUNITY_backfill-semantics.ts|backfill-semantics.ts]]
- [[_COMMUNITY_event-repository.ts|event-repository.ts]]
- [[_COMMUNITY_Semantic graph governance|Semantic graph governance]]
- [[_COMMUNITY_entities.ts|entities.ts]]
- [[_COMMUNITY_entity-repository.ts|entity-repository.ts]]
- [[_COMMUNITY_semantic-resolver.ts|semantic-resolver.ts]]
- [[_COMMUNITY_backfill-semantics.ts|backfill-semantics.ts]]
- [[_COMMUNITY_insights.ts|insights.ts]]
- [[_COMMUNITY_capture.ts|capture.ts]]
- [[_COMMUNITY_AI-governed entity identity|AI-governed entity identity]]

## God Nodes (most connected - your core abstractions)
1. `pool` - 31 edges
2. `normalizeEntityValue()` - 26 edges
3. `Domain Model` - 26 edges
4. `persistClassifiedEvent()` - 25 edges
5. `scripts` - 19 edges
6. `API` - 19 edges
7. `buildModelSemanticDecision()` - 17 edges
8. `Postgres Schema` - 15 edges
9. `buildEntityDrafts()` - 14 edges
10. `upsertEntity()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `createApp()` --calls--> `buildApp()`  [INFERRED]
  tests/api-contracts.test.ts → src/app.ts
- `createApp()` --calls--> `buildApp()`  [INFERRED]
  tests/e2e.test.ts → src/app.ts
- `createCaptureApp()` --calls--> `registerCaptureRoutes()`  [INFERRED]
  tests/capture.test.ts → src/routes/capture.ts
- `buildApp()` --calls--> `createApiAuthHook()`  [EXTRACTED]
  src/app.ts → src/auth.ts
- `buildApp()` --calls--> `loadAuthConfig()`  [EXTRACTED]
  src/app.ts → src/auth.ts

## Import Cycles
- 3-file cycle: `src/storage/entity-repository.ts -> src/storage/graph-cache.ts -> src/storage/graph-repository.ts -> src/storage/entity-repository.ts`

## Communities (61 total, 2 thin omitted)

### Community 0 - "entity-repository.ts"
Cohesion: 0.08
Nodes (33): inspectSchema, registerAgentInspectRoutes(), graphParamsSchema, registerGraphRoutes(), registerSearchRoutes(), searchQuerySchema, InspectDeps, inspectKnowledge (+25 more)

### Community 1 - "app.ts"
Cohesion: 0.19
Nodes (10): digestHistoryParamsSchema, digestHistoryQuerySchema, digestQuerySchema, registerDigestRoutes(), DigestRunInput, DigestRunRecord, insertDigestRun(), listDigestRuns() (+2 more)

### Community 2 - "event-store.ts"
Cohesion: 0.50
Nodes (3): mergeBodySchema, mergeParamsSchema, registerEntityMergeRoutes()

### Community 3 - "postgres.ts"
Cohesion: 0.22
Nodes (9): registerEntityResolveRoutes(), resolveQuerySchema, result, typeResult, apps, connectionString, pool, withTransaction() (+1 more)

### Community 4 - "Domain Model"
Cohesion: 0.06
Nodes (31): Alias review queue, Capture adapters, Classification intent, Classification policy, Classified event, Core idea, Data philosophy, Derived fields (+23 more)

### Community 5 - "Postgres Schema"
Cohesion: 0.06
Nodes (31): Active runtime tables, Canonicalization phase, `classified_events`, Columns, Current columns, Current runtime target, `entities`, `entities` (+23 more)

### Community 6 - "Live Event Analysis Report"
Cohesion: 0.06
Nodes (30): 1. Reprocess leaves orphan graph rows, 2. Heuristic entity extraction is too permissive, 3. Alias review is too eager for obvious labels, 4. Email extraction should be provider-aware but bridge-agnostic, 5. Financial dedupe should be multi-source by design, 6. Cleanup coverage should extend to support/audit tables, Classification, Classification (+22 more)

### Community 7 - "financial-transactions.ts"
Cohesion: 0.16
Nodes (9): buildApp(), config, registerCaptureRoutes(), registerDashboardRoutes(), webRoot, registerEventRoutes(), createApp(), createCaptureApp() (+1 more)

### Community 8 - "digests.ts"
Cohesion: 0.16
Nodes (15): DeepSeekChatMessage, generateNaturalLanguageSummary(), buildHighlights(), buildKnowledgeDigest(), buildTimeClause(), countBy(), createKnowledgeDigest(), DigestBuildContext (+7 more)

### Community 9 - "financial-transaction-repository.ts"
Cohesion: 0.09
Nodes (38): buildFinancialTransactionCandidate(), candidateWindowBounds(), collapseText(), CURRENCY_CODES, CURRENCY_SYMBOLS, EntityLike, FinancialTransactionCandidate, findRawAmountText() (+30 more)

### Community 10 - "capture.ts"
Cohesion: 0.26
Nodes (13): buildBaseEvent(), buildEmailCaptureEvent(), buildNoteCaptureEvent(), buildNotificationCaptureEvent(), buildStableEmailIdempotencyKey(), buildWalletCaptureEvent(), CaptureBatchItem, extractStringValue() (+5 more)

### Community 11 - "cleanup-test-data.ts"
Cohesion: 0.10
Nodes (35): applyCleanup(), applyFullPurge(), buildRawMatchSpec(), buildRunMatchSpec(), buildTextMatchClause(), CleanupCounts, CleanupDeletes, CleanupOptions (+27 more)

### Community 12 - "app.js"
Cohesion: 0.12
Nodes (22): activityLog, addActivity(), escapeHtml(), graphPaths, graphSummary, graphSvg, inspectDepth, inspectForm (+14 more)

### Community 13 - "scripts"
Cohesion: 0.06
Nodes (32): dependencies, fastify, pg, zod, devDependencies, tsx, @types/node, @types/pg (+24 more)

### Community 14 - "entity-alias-repository.ts"
Cohesion: 0.20
Nodes (10): buildToolSections(), getToolSection(), registerAgentRoutes(), toMcpToolManifest(), ToolManifest, tools, ToolSectionId, ToolSectionManifest (+2 more)

### Community 15 - "package.json"
Cohesion: 0.11
Nodes (18): dependencies, expo, expo-status-bar, react, react-native, devDependencies, @types/react, @types/react-native (+10 more)

### Community 16 - "API"
Cohesion: 0.11
Nodes (18): API, Base URL, Contract notes, Design rules, Financial transactions, `GET /api/v1/events`, `GET /api/v1/financial/transactions/:id`, `GET /api/v1/financial/transactions?limit=50` (+10 more)

### Community 17 - "Future Roadmap"
Cohesion: 0.12
Nodes (15): Agent Experience, Clients, Extraction, Future Features, Insights and Digests, Operations, Retrieval and Knowledge, Clients (+7 more)

### Community 18 - "HomeScreen.tsx"
Cohesion: 0.20
Nodes (11): MetricCard(), MetricCardProps, styles, captureSample(), getBaseUrl(), getMetrics(), inspectKnowledge(), requestJson() (+3 more)

### Community 19 - "README.md"
Cohesion: 0.24
Nodes (3): BrainIA Agent Context, 2026-07-13, Changelog

### Community 20 - "Flow"
Cohesion: 0.15
Nodes (13): 1. Event capture on mobile, 2. HTTP ingestion, 3. Validation, 4. Classification, 5. Persistence, 6. Response, 7. Downstream use, Flow (+5 more)

### Community 21 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, outDir, resolveJsonModule, skipLibCheck (+3 more)

### Community 22 - "BrainIA Agent Context"
Cohesion: 0.18
Nodes (11): API convention, Architecture decision, BrainIA Agent Context, Current stack, Current state, Design principle, Functional goal, Project (+3 more)

### Community 23 - "Architecture"
Cohesion: 0.18
Nodes (10): 1. Transport, 2. Domain, 3. Classification, 4. Storage, Architecture, Design Goals, Evolution path, Layers (+2 more)

### Community 24 - "expo"
Cohesion: 0.20
Nodes (9): expo, assetBundlePatterns, name, orientation, platforms, scheme, slug, userInterfaceStyle (+1 more)

### Community 25 - "Operations"
Cohesion: 0.22
Nodes (9): Environment variables, Local development, Migration workflow, Mobile client integration, Operational rules, Operations, Runbooks, Storage behavior (+1 more)

### Community 26 - "compilerOptions"
Cohesion: 0.22
Nodes (8): compilerOptions, baseUrl, jsx, paths, strict, extends, include, @/*

### Community 27 - "Event ingestion"
Cohesion: 0.25
Nodes (8): Canonical ingestion example, Error contract, Event ingestion, Field semantics, `POST /api/v1/events`, Request contract, Response contract, Server behavior

### Community 28 - "MVP Scope"
Cohesion: 0.25
Nodes (8): Explicitly out of scope for the MVP, Goal, In scope, MVP exit criteria, MVP Scope, Post-MVP backlog, Primary agent flow, Support flows

### Community 29 - "Runbooks"
Cohesion: 0.25
Nodes (7): 1. Importing data, 2. Reprocessing, 3. Recovery, 4. Slow requests, 5. Backups and retention, 6. Cleaning test data, Runbooks

### Community 30 - "Memory"
Cohesion: 0.25
Nodes (7): Active decisions, Current state, Memory, Next immediate steps, Operating rules, Purpose, Usage

### Community 31 - "remote-smoke.ts"
Cohesion: 0.50
Nodes (7): buildHeaders(), main(), postSmokeNotification(), readBaseUrl(), readJsonResponse(), SmokeResponse, verifyEventStored()

### Community 32 - "BrainIA"
Cohesion: 0.29
Nodes (7): Backend commands, BrainIA, Current shape, Deployment notes, Design, Docs, Mobile shell

### Community 33 - "Agent tools"
Cohesion: 0.33
Nodes (6): Agent tools, `GET /api/v1/agent/inspect?id=...`, `GET /api/v1/agent/inspect?q=...`, `GET /api/v1/agent/mcp`, `GET /api/v1/agent/tools`, `POST /api/v1/agent/mcp`

### Community 34 - "Alias review queue"
Cohesion: 0.33
Nodes (6): Alias review queue, `GET /api/v1/aliases?entityId=...`, `GET /api/v1/entities/:id/graph?depth=2&maxNodes=100&maxRelations=100`, `GET /api/v1/review/aliases?status=pending|resolved|ignored`, `POST /api/v1/review/aliases/:id/ignore`, `POST /api/v1/review/aliases/:id/resolve`

### Community 35 - "Capture workflows"
Cohesion: 0.33
Nodes (6): Capture workflows, `POST /api/v1/capture/batch`, `POST /api/v1/capture/email`, `POST /api/v1/capture/note`, `POST /api/v1/capture/notification`, `POST /api/v1/capture/wallet`

### Community 36 - "Knowledge queries"
Cohesion: 0.33
Nodes (6): `GET /api/v1/entities`, `GET /api/v1/entities/resolve?id=...`, `GET /api/v1/entities/resolve?q=...`, `GET /api/v1/relations`, Knowledge queries, `POST /api/v1/entities/:id/merge`

### Community 37 - "BrainIA Mobile Shell"
Cohesion: 0.33
Nodes (5): BrainIA Mobile Shell, Environment, Scope, Scripts, What it does

### Community 38 - "vercel.json"
Cohesion: 0.33
Nodes (5): buildCommand, builds, rewrites, $schema, version

### Community 39 - "Insights"
Cohesion: 0.40
Nodes (5): `GET /api/v1/insights/history/:id`, `GET /api/v1/insights/history?limit=25`, `GET /api/v1/insights?id=...`, `GET /api/v1/insights?q=...`, Insights

### Community 40 - "Post-MVP Backlog"
Cohesion: 0.40
Nodes (5): Future roadmap, Notes, Post-MVP Backlog, Shipped baseline, Status

### Community 41 - "Insights and Digests"
Cohesion: 0.40
Nodes (4): Digest, Insight, Insights and Digests, Practical rule

### Community 42 - "Digests"
Cohesion: 0.50
Nodes (4): Digests, `GET /api/v1/digests`, `GET /api/v1/digests/history/:id`, `GET /api/v1/digests/history?limit=25`

### Community 47 - "entity-repository.ts"
Cohesion: 0.17
Nodes (20): aliasListQuerySchema, createAliasSchema, ignoreReviewSchema, registerEntityAliasRoutes(), resolveReviewSchema, reviewListQuerySchema, createEntityAlias(), enqueueEntityReview() (+12 more)

### Community 48 - "semantic-repository.ts"
Cohesion: 0.07
Nodes (44): classifyEvent(), extractCardAlertMerchant(), isCompletedCardTransactionAlert(), isRejectedCardTransactionAlert(), normalizeForMatching(), ClassifiedEvent, EventInput, eventKindSchema (+36 more)

### Community 49 - "semantic-enrichment.ts"
Cohesion: 0.19
Nodes (13): AuthConfig, AuthContext, AuthFailure, AuthResult, createApiAuthHook(), isAuthEnabled(), loadAuthConfig(), parseClientKeyPairs() (+5 more)

### Community 50 - "backfill-semantics.ts"
Cohesion: 0.08
Nodes (34): EntityDraft, normalizeEntityValue(), LIFE_DOMAINS, ONTOLOGY_DESCRIPTIONS, ONTOLOGY_PARENT_RELATIONS, ONTOLOGY_TREE, ontologyDraft(), ontologyTreePrompt() (+26 more)

### Community 51 - "event-repository.ts"
Cohesion: 0.18
Nodes (21): buildRelationDrafts(), buildRelationMetadata(), getFirstEntity(), normalizeRelationType(), RELATION_TYPE_ALIASES, RelationDraft, upsertEntity(), persistClassifiedEvent() (+13 more)

### Community 52 - "Semantic graph governance"
Cohesion: 0.22
Nodes (8): Durable node creation, Entity hierarchy contract, Event classification contract, LLM output and enforcement, Purpose, Reconciliation and acceptance, Semantic graph governance v2, Unified processing

### Community 53 - "entities.ts"
Cohesion: 0.17
Nodes (16): buildDraftMetadata(), buildEntityDrafts(), cleanMerchantCandidate(), dedupeEntityDrafts(), extractStringValue(), GENERIC_MERCHANT_PREFIXES, isMeaningfulDraft(), MERCHANT_TERMINATORS (+8 more)

### Community 54 - "entity-repository.ts"
Cohesion: 0.19
Nodes (15): registerKnowledgeRoutes(), EntityMatchRow, EntityMergeRecord, EntityRecord, listEntities(), loadCanonicalEntityById(), loadEntityById(), mergeEntities() (+7 more)

### Community 55 - "semantic-resolver.ts"
Cohesion: 0.27
Nodes (15): enqueueSemanticCandidate(), applyAssociations(), applyPath(), candidateAlternatives(), enqueuePathCandidate(), findCanonicalEntity(), findHierarchyRoot(), findImmediateHierarchyParent() (+7 more)

### Community 56 - "backfill-semantics.ts"
Cohesion: 0.14
Nodes (13): allEvents, concurrency, decided, eventContains, eventFilter, events, failed, limit (+5 more)

### Community 57 - "insights.ts"
Cohesion: 0.19
Nodes (11): dailyInsightSchema, insightHistoryParamsSchema, insightHistoryQuerySchema, insightSchema, registerInsightsRoutes(), insertInsightRun(), InsightRunInput, InsightRunRecord (+3 more)

### Community 58 - "capture.ts"
Cohesion: 0.18
Nodes (9): buildCaptureBatchEvents(), captureBatchSchema, CaptureIngestFn, CaptureRoutesOptions, commonCaptureSchema, emailCaptureSchema, noteCaptureSchema, notificationCaptureSchema (+1 more)

### Community 59 - "AI-governed entity identity"
Cohesion: 0.25
Nodes (7): AI-governed entity identity, Description rules, Existing data, Ingestion behavior, Naming rules, Purpose, Required identity contract

## Knowledge Gaps
- **466 isolated node(s):** `name`, `slug`, `scheme`, `version`, `orientation` (+461 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pool` connect `postgres.ts` to `entity-repository.ts`, `app.ts`, `event-store.ts`, `digests.ts`, `financial-transaction-repository.ts`, `entity-repository.ts`, `semantic-repository.ts`, `backfill-semantics.ts`, `event-repository.ts`, `entities.ts`, `entity-repository.ts`, `semantic-resolver.ts`, `backfill-semantics.ts`, `insights.ts`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `API` connect `API` to `Agent tools`, `Alias review queue`, `Capture workflows`, `Knowledge queries`, `Insights`, `Digests`, `Event reprocessing`, `README.md`, `Event ingestion`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `Domain Model` connect `Domain Model` to `README.md`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **What connects `name`, `slug`, `scheme` to the rest of the system?**
  _466 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `entity-repository.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07641196013289037 - nodes in this community are weakly interconnected._
- **Should `Domain Model` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._
- **Should `Postgres Schema` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._