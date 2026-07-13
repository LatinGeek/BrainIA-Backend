# Post-MVP Backlog

## Purpose

This backlog tracks the next phase after the MVP. It is intentionally focused on strengthening the backend, the knowledge model, and the agent surface before any mobile UI work expands.

Status note: the first P0 foundation pass has been implemented in the repo. The items below are now the remaining backlog surface, not the current blocking work.

## Prioritization rules

- keep the system backend-first and agent-first
- prefer generic primitives over product-specific shortcuts
- do not add UI work before the backend contracts are stable
- every item should be shippable in small increments
- if a decision changes the live system, update `memory.md` and the relevant docs

## Foundation pass shipped

The first pass of P0 is implemented in the repo:

- optional API-key or client-scoped auth for API routes
- explicit `contractVersion` and `idempotencyKey` support on events
- deterministic dedupe keys across retries
- transactional ingestion and reprocessing
- single-event reprocess endpoint
- lightweight storage metrics endpoint

The remaining work below is therefore follow-up hardening and expansion.

## P1. Knowledge quality

These items improve the usefulness of the knowledge graph.

### 5. Entity canonicalization and merging

- improve entity deduplication
- support `same_as` style merges
- keep provenance when entities are merged
- make canonical entity resolution deterministic

### 6. Relation quality and traversal

- improve relation extraction heuristics
- enrich relation descriptions
- rank relations by confidence or usefulness
- support better multi-hop traversal and path explanation

### 7. Search relevance

- add filters by source, kind, and time range
- improve ranking across events, entities, and relations
- expose query hints for agent retrieval
- consider hybrid retrieval once the text pipeline stabilizes

### 8. Graph projections

- materialize graph-friendly views when needed
- cache common traversals
- expose bounded subgraphs for agent reasoning
- keep graph expansion separate from entity resolution

## P1. Agent access layer

These items make the backend easier to consume by agents.

### 9. Formal MCP server

- expose the tool catalog as a real MCP endpoint
- keep HTTP routes and MCP tools aligned
- define stable schemas and examples for every public tool
- support agent discovery without hardcoded prompts

### 10. Richer inspect and explain flows

- expand the inspect flow with better summaries
- return more context about why an entity or relation was selected
- improve graph explanations for deeper traversals
- keep the single-call agent path simple

### 11. Insight endpoints

- generate summaries over entities, relations, and clusters
- add daily or weekly insight generation later
- allow agents to ask for focused explanations
- keep insight generation derived from stored knowledge

## P2. AI enhancements

These items are valuable once the data model is stable.

### 12. Embeddings and hybrid retrieval

- add embeddings only when lexical search is not enough
- compare semantic and lexical retrieval quality
- keep text search as a fallback
- avoid overcommitting to a vector store too early

### 13. LLM-assisted extraction

- use model calls for harder classification cases
- improve entity extraction beyond heuristics
- improve relation extraction from noisy mobile inputs
- keep model outputs auditable and replayable

### 14. Insight jobs

- summarize recurring expenses
- detect recurring topics and patterns
- build event digests for the assistant
- run these as derived jobs, not as source-of-truth writes

## P2. Product surfaces

These items are useful once the backend contracts are settled.

### 15. Mobile client shell

- build a native mobile consumption layer later
- keep it thin and API-driven
- focus on browse, inspect, and capture flows

### 16. Capture workflows

- add quick-capture paths for notes and events
- support offline queueing if needed
- add source-specific adapters for notifications, wallet events, and email-like inputs

### 17. Optional web dashboard

- only add a dashboard if it helps exploration or debugging
- do not make the web UI the primary product surface
- keep it aligned with the same API and domain model

## Recommended execution order

1. entity canonicalization and merging
2. relation quality and traversal
3. observability and durability hardening
4. formal MCP server
5. richer inspect and explain flows
6. embeddings and hybrid retrieval
7. mobile client shell

## Notes

This backlog is not a frozen roadmap. It should be updated whenever the architecture or product priorities change.
