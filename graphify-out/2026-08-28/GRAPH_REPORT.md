# Graph Report - BrainIA-Backend  (2026-08-07)

## Corpus Check
- 171 files · ~96,953 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1178 nodes · 2215 edges · 75 communities (71 shown, 4 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.66)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `80f11cf3`
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
- [[_COMMUNITY_semantic-repository.ts|semantic-repository.ts]]
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
- [[_COMMUNITY_embeddings.ts|embeddings.ts]]
- [[_COMMUNITY_ontology.ts|ontology.ts]]
- [[_COMMUNITY_Semantic graph governance|Semantic graph governance]]
- [[_COMMUNITY_entities.ts|entities.ts]]
- [[_COMMUNITY_semantic-resolver.ts|semantic-resolver.ts]]
- [[_COMMUNITY_auth.ts|auth.ts]]
- [[_COMMUNITY_classification.ts|classification.ts]]
- [[_COMMUNITY_capture.ts|capture.ts]]
- [[_COMMUNITY_entity-merge.ts|entity-merge.ts]]
- [[_COMMUNITY_AI-governed entity identity|AI-governed entity identity]]
- [[_COMMUNITY_withTransaction|withTransaction]]
- [[_COMMUNITY_backup-verification.ts|backup-verification.ts]]
- [[_COMMUNITY_relation-repository.ts|relation-repository.ts]]
- [[_COMMUNITY_job-worker.ts|job-worker.ts]]
- [[_COMMUNITY_search-repository.ts|search-repository.ts]]
- [[_COMMUNITY_job-repository.ts|job-repository.ts]]
- [[_COMMUNITY_reprocess-pending-semantics.ts|reprocess-pending-semantics.ts]]
- [[_COMMUNITY_operations.ts|operations.ts]]
- [[_COMMUNITY_semantic-reconciler.ts|semantic-reconciler.ts]]
- [[_COMMUNITY_metrics.ts|metrics.ts]]
- [[_COMMUNITY_reprocess-pending-semantics.ts|reprocess-pending-semantics.ts]]
- [[_COMMUNITY_search.ts|search.ts]]

## God Nodes (most connected - your core abstractions)
1. `pool` - 52 edges
2. `normalizeEntityValue()` - 32 edges
3. `persistClassifiedEvent()` - 31 edges
4. `reprocessEventUnlocked()` - 31 edges
5. `withTransaction()` - 30 edges
6. `scripts` - 29 edges
7. `Domain Model` - 26 edges
8. `API` - 23 edges
9. `buildModelSemanticDecision()` - 22 edges
10. `buildEntityDrafts()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `interpretFinancialEvent()` --calls--> `classifyEvent()`  [INFERRED]
  tests/interpretation-harness.test.ts → src/domain/classification.ts
- `interpretFinancialEvent()` --calls--> `buildFinancialTransactionCandidate()`  [INFERRED]
  tests/interpretation-harness.test.ts → src/domain/financial-transactions.ts
- `createApp()` --calls--> `buildApp()`  [INFERRED]
  tests/api-contracts.test.ts → src/app.ts
- `createApp()` --calls--> `buildApp()`  [INFERRED]
  tests/e2e.test.ts → src/app.ts
- `interpretFinancialEvent()` --calls--> `buildEntityDrafts()`  [INFERRED]
  tests/interpretation-harness.test.ts → src/domain/entities.ts

## Import Cycles
- 3-file cycle: `src/storage/entity-repository.ts -> src/storage/graph-cache.ts -> src/storage/graph-repository.ts -> src/storage/entity-repository.ts`

## Communities (75 total, 4 thin omitted)

### Community 0 - "entity-repository.ts"
Cohesion: 0.06
Nodes (44): allocateExploreGraphSlots(), clampInteger(), parseExploreGraphOptions(), parseGraphOptions(), registerEntityResolveRoutes(), resolveQuerySchema, graphParamsSchema, registerGraphRoutes() (+36 more)

### Community 1 - "app.ts"
Cohesion: 0.06
Nodes (62): classifyEvent(), extractCardAlertMerchant(), isAccountTransferAlert(), isCompletedCardTransactionAlert(), isRejectedCardTransactionAlert(), normalizeForMatching(), ClassifiedEvent, EventInput (+54 more)

### Community 2 - "event-store.ts"
Cohesion: 0.09
Nodes (22): 1. La evidencia es inmutable, 2. Las proyecciones son reemplazables y versionadas, 3. Todo conocimiento durable debe ser gobernado, 4. Un evento es evidencia, no un concepto duplicado, 5. Recuperar antes de razonar, 6. El LLM decide semántica; el sistema impone invariantes, Arquitectura objetivo, Capas de almacenamiento (+14 more)

### Community 3 - "postgres.ts"
Cohesion: 0.06
Nodes (51): dailyInsightSchema, insightHistoryParamsSchema, insightHistoryQuerySchema, insightSchema, registerInsightsRoutes(), inspectKnowledge, insertDigestRun(), buildHighlights() (+43 more)

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
Cohesion: 0.10
Nodes (17): buildApp(), inspectSchema, registerAgentInspectRoutes(), registerCaptureRoutes(), batchSchema, diagnosticSchema, registerClientDiagnosticRoutes(), mergeBodySchema (+9 more)

### Community 8 - "digests.ts"
Cohesion: 0.09
Nodes (38): eventKindSchema, ClassificationAssistantDeps, createClassificationAssistant(), mergeEntities(), MODEL_EVIDENCE_TYPES, normalizeEntityKey(), parseSuggestion(), suggestionSchema (+30 more)

### Community 9 - "financial-transaction-repository.ts"
Cohesion: 0.07
Nodes (48): FINANCIAL_CATEGORIES, FinancialCategoryKind, buildFinancialTransactionCandidate(), candidateWindowBounds(), collapseText(), CURRENCY_CODES, CURRENCY_SYMBOLS, EntityLike (+40 more)

### Community 10 - "semantic-repository.ts"
Cohesion: 0.12
Nodes (16): allEvents, decided, eventContains, eventFilter, events, failed, interpretationStatus, limit (+8 more)

### Community 11 - "cleanup-test-data.ts"
Cohesion: 0.10
Nodes (36): applyCleanup(), applyFullPurge(), buildRawMatchSpec(), buildRunMatchSpec(), buildTextMatchClause(), CleanupCounts, CleanupDeletes, CleanupOptions (+28 more)

### Community 12 - "app.js"
Cohesion: 0.12
Nodes (22): activityLog, addActivity(), escapeHtml(), graphPaths, graphSummary, graphSvg, inspectDepth, inspectForm (+14 more)

### Community 13 - "scripts"
Cohesion: 0.05
Nodes (42): dependencies, fastify, pg, zod, devDependencies, tsx, @types/node, @types/pg (+34 more)

### Community 14 - "entity-alias-repository.ts"
Cohesion: 0.20
Nodes (10): buildToolSections(), getToolSection(), registerAgentRoutes(), toMcpToolManifest(), ToolManifest, tools, ToolSectionId, ToolSectionManifest (+2 more)

### Community 15 - "package.json"
Cohesion: 0.11
Nodes (18): dependencies, expo, expo-status-bar, react, react-native, devDependencies, @types/react, @types/react-native (+10 more)

### Community 16 - "API"
Cohesion: 0.10
Nodes (20): API, Base URL, Contract notes, Design rules, Event reprocessing, `GET /api/v1/metrics`, `GET /api/v1/retrieval/hybrid?q=...`, `GET /api/v1/search?q=...` (+12 more)

### Community 17 - "Future Roadmap"
Cohesion: 0.12
Nodes (15): Agent Experience, Clients, Extraction, Future Features, Insights and Digests, Operations, Retrieval and Knowledge, Clients (+7 more)

### Community 18 - "HomeScreen.tsx"
Cohesion: 0.20
Nodes (11): MetricCard(), MetricCardProps, styles, captureSample(), getBaseUrl(), getMetrics(), inspectKnowledge(), requestJson() (+3 more)

### Community 19 - "README.md"
Cohesion: 0.23
Nodes (3): BrainIA Agent Context, 2026-07-13, Changelog

### Community 20 - "Flow"
Cohesion: 0.13
Nodes (15): 1. Event capture on mobile, 2. HTTP ingestion, 3. Validation, 4. Classification, 5. Persistence, 6. Response, 7. Downstream use, Flow (+7 more)

### Community 21 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, outDir, resolveJsonModule, skipLibCheck (+3 more)

### Community 22 - "BrainIA Agent Context"
Cohesion: 0.18
Nodes (11): API convention, Architecture decision, BrainIA Agent Context, Current stack, Current state, Design principle, Functional goal, Project (+3 more)

### Community 23 - "Architecture"
Cohesion: 0.22
Nodes (9): Architecture, Deployment, Invariants, Overview, Privacy and learning, Proactive insights, Processing modes, Retrieval (+1 more)

### Community 24 - "expo"
Cohesion: 0.20
Nodes (9): expo, assetBundlePatterns, name, orientation, platforms, scheme, slug, userInterfaceStyle (+1 more)

### Community 25 - "Operations"
Cohesion: 0.14
Nodes (14): Background processing and recovery, Backup verification, Environment variables, Local development, Migration workflow, Mobile client integration, Operational rules, Operations (+6 more)

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
Cohesion: 0.29
Nodes (7): `GET /api/v1/entities`, `GET /api/v1/entities/resolve?id=...`, `GET /api/v1/entities/resolve?q=...`, `GET /api/v1/graph?projection=taxonomy&depth=1&root=finances`, `GET /api/v1/relations`, Knowledge queries, `POST /api/v1/entities/:id/merge`

### Community 37 - "BrainIA Mobile Shell"
Cohesion: 0.33
Nodes (5): BrainIA Mobile Shell, Environment, Scope, Scripts, What it does

### Community 38 - "vercel.json"
Cohesion: 0.29
Nodes (6): buildCommand, builds, crons, rewrites, $schema, version

### Community 39 - "Insights"
Cohesion: 0.40
Nodes (5): `GET /api/v1/insights/history/:id`, `GET /api/v1/insights/history?limit=25`, `GET /api/v1/insights?id=...`, `GET /api/v1/insights?q=...`, Insights

### Community 40 - "Post-MVP Backlog"
Cohesion: 0.40
Nodes (5): Future roadmap, Notes, Post-MVP Backlog, Shipped baseline, Status

### Community 41 - "Insights and Digests"
Cohesion: 0.33
Nodes (5): Digest, Insight, Insights and Digests, Practical rule, Proactive evaluation

### Community 42 - "Digests"
Cohesion: 0.50
Nodes (4): Digests, `GET /api/v1/digests`, `GET /api/v1/digests/history/:id`, `GET /api/v1/digests/history?limit=25`

### Community 44 - "Event reprocessing"
Cohesion: 0.20
Nodes (18): EntityDraft, normalizeRelationType(), RELATION_TYPE_ALIASES, RelationDraft, upsertEntity(), linkEventRelation(), Queryable, StoredRelation (+10 more)

### Community 47 - "entity-repository.ts"
Cohesion: 0.17
Nodes (21): aliasListQuerySchema, createAliasSchema, ignoreReviewSchema, registerEntityAliasRoutes(), resolveReviewSchema, reviewListQuerySchema, createEntityAlias(), enqueueEntityReview() (+13 more)

### Community 48 - "semantic-repository.ts"
Cohesion: 0.16
Nodes (10): result, typeResult, apply, events, limit, limitArgument, report, apps (+2 more)

### Community 49 - "semantic-enrichment.ts"
Cohesion: 0.13
Nodes (30): normalizeEntityValue(), categoryByKey(), categoryByLabel(), categoryCatalogPrompt(), categoryKeyForPath(), categoryPath(), ontologyDraft(), ontologyTreePrompt() (+22 more)

### Community 50 - "embeddings.ts"
Cohesion: 0.50
Nodes (3): entityId, limit, result

### Community 51 - "ontology.ts"
Cohesion: 0.12
Nodes (10): CATEGORY_BY_KEY, CATEGORY_BY_LABEL, CategoryDefinition, LIFE_DOMAINS, ONTOLOGY_DESCRIPTIONS, ONTOLOGY_PARENT_RELATIONS, ONTOLOGY_TREE, SEEDED_CONCEPTS (+2 more)

### Community 52 - "Semantic graph governance"
Cohesion: 0.20
Nodes (9): Durable node creation, Entity hierarchy contract, Evaluation harness, Event classification contract, LLM output and enforcement, Purpose, Reconciliation and acceptance, Semantic graph governance v5 (+1 more)

### Community 53 - "entities.ts"
Cohesion: 0.17
Nodes (10): config, digestHistoryParamsSchema, digestHistoryQuerySchema, digestQuerySchema, registerDigestRoutes(), DigestRunInput, DigestRunRecord, listDigestRuns() (+2 more)

### Community 54 - "semantic-resolver.ts"
Cohesion: 0.21
Nodes (18): SEMANTIC_SUBJECT_TYPES, SemanticPathDecision, enqueueSemanticCandidate(), settleSatisfiedSemanticCandidates(), applyAssociations(), applyPath(), candidateAlternatives(), enqueuePathCandidate() (+10 more)

### Community 55 - "auth.ts"
Cohesion: 0.26
Nodes (10): AuthConfig, AuthContext, AuthFailure, AuthResult, createApiAuthHook(), isAuthEnabled(), loadAuthConfig(), parseClientKeyPairs() (+2 more)

### Community 57 - "capture.ts"
Cohesion: 0.13
Nodes (22): buildBaseEvent(), buildCaptureBatchEvents(), buildEmailCaptureEvent(), buildNoteCaptureEvent(), buildNotificationCaptureEvent(), buildStableEmailIdempotencyKey(), buildWalletCaptureEvent(), CaptureBatchItem (+14 more)

### Community 59 - "AI-governed entity identity"
Cohesion: 0.25
Nodes (7): AI-governed entity identity, Description rules, Existing data, Ingestion behavior, Naming rules, Purpose, Required identity contract

### Community 61 - "withTransaction"
Cohesion: 0.29
Nodes (8): registerPrivacyRoutes(), deletePersonalData(), exportPersonalData(), Queryable, recordKnowledgeFeedback(), setEntityVisibility(), setEventPrivacy(), withTransaction()

### Community 62 - "backup-verification.ts"
Cohesion: 0.53
Nodes (4): connectionFingerprint(), tableCounts(), TABLES, verifyConfiguredBackup()

### Community 63 - "relation-repository.ts"
Cohesion: 0.40
Nodes (5): `DELETE /api/v1/financial/transactions/:id`, Financial transactions, `GET /api/v1/financial/transactions/:id`, `GET /api/v1/financial/transactions?limit=50`, `POST /api/v1/financial/transactions/:id/merge`

### Community 64 - "job-worker.ts"
Cohesion: 0.24
Nodes (12): applyRetentionPolicies(), classifyCapturedEvent(), correlateFinancialEvent(), reprocessEvent(), claimBackgroundJobs(), completeBackgroundJob(), executeBackgroundJob(), processBackgroundJobs() (+4 more)

### Community 67 - "search-repository.ts"
Cohesion: 0.29
Nodes (5): Fixture, fixtures, recordArgument, recordPath, results

### Community 68 - "job-repository.ts"
Cohesion: 0.23
Nodes (12): BACKGROUND_JOB_TYPES, BackgroundJob, BackgroundJobStatus, BackgroundJobType, enqueueBackgroundJob(), failBackgroundJob(), jobProjection(), listBackgroundJobs() (+4 more)

### Community 70 - "reprocess-pending-semantics.ts"
Cohesion: 0.17
Nodes (16): buildDraftMetadata(), buildEntityDrafts(), cleanMerchantCandidate(), dedupeEntityDrafts(), extractStringValue(), GENERIC_MERCHANT_PREFIXES, isMeaningfulDraft(), MERCHANT_TERMINATORS (+8 more)

### Community 72 - "operations.ts"
Cohesion: 0.24
Nodes (6): registerMetricsRoutes(), ClientDiagnosticInput, listClientDiagnostics(), storeClientDiagnostics(), backgroundJobMetrics(), getKnowledgeQualityMetrics()

### Community 74 - "semantic-reconciler.ts"
Cohesion: 0.29
Nodes (10): mergeEntities(), invalidateGraphTraversalCache(), loadReconciliationNodes(), parseJson(), reconcileSemanticGraphUnlocked(), ReconciliationNode, reconciliationSchema, requestStructured() (+2 more)

### Community 76 - "reprocess-pending-semantics.ts"
Cohesion: 0.22
Nodes (8): failed, inspectOnly, limit, maintenanceOnly, pending, remaining, skipReconciliation, targetFilter

### Community 79 - "search.ts"
Cohesion: 0.29
Nodes (8): hybridQuerySchema, registerSearchRoutes(), searchQuerySchema, buildEventSearchQuery(), buildSearchMatchHint(), normalizeSearchText(), searchKnowledge(), SearchMatchHint

## Knowledge Gaps
- **574 isolated node(s):** `name`, `slug`, `scheme`, `version`, `orientation` (+569 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pool` connect `semantic-repository.ts` to `entity-repository.ts`, `app.ts`, `postgres.ts`, `financial-transactions.ts`, `digests.ts`, `financial-transaction-repository.ts`, `semantic-repository.ts`, `Event reprocessing`, `entity-repository.ts`, `semantic-enrichment.ts`, `embeddings.ts`, `ontology.ts`, `entities.ts`, `semantic-resolver.ts`, `entity-merge.ts`, `withTransaction`, `backup-verification.ts`, `job-worker.ts`, `job-repository.ts`, `operations.ts`, `semantic-reconciler.ts`, `reprocess-pending-semantics.ts`, `search.ts`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Why does `API` connect `API` to `Agent tools`, `Alias review queue`, `Capture workflows`, `Knowledge queries`, `Insights`, `Digests`, `metrics.ts`, `README.md`, `Event ingestion`, `relation-repository.ts`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `Postgres Schema` connect `Postgres Schema` to `README.md`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `name`, `slug`, `scheme` to the rest of the system?**
  _574 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `entity-repository.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06363636363636363 - nodes in this community are weakly interconnected._
- **Should `app.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.062456140350877196 - nodes in this community are weakly interconnected._
- **Should `event-store.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._