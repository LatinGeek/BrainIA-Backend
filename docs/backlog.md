# Post-MVP Backlog

## Status

The post-MVP backlog has been executed and the repo now contains the shipped backend, agent surface, capture adapters, mobile shell scaffold, and optional web dashboard.

This file now serves as the closure record for that phase.

## Shipped baseline

The repo includes:

- optional API-key or client-scoped auth for API routes
- explicit `contractVersion` and `idempotencyKey` support on events
- deterministic dedupe keys across retries
- transactional ingestion and reprocessing
- single-event reprocess endpoint
- lightweight storage metrics endpoint
- entity canonicalization with deterministic canonical roots
- manual entity merge with `same_as` provenance
- graph traversal through canonical roots
- merge-aware entity resolution
- deduplicated search with source, kind, and time-window filters
- ranked relation traversal with readable path summaries
- MCP discovery over registry and JSON-RPC transport
- structured inspect resolution and graph summaries
- focused insight generation for agents
- request IDs are echoed on responses and slow requests are logged explicitly
- invalid inputs are logged with structured warnings
- graph traversal caching is active for repeated bounded expansions
- graph expansion logs are structured and queryable
- search results include local relevance hints and explanation fields
- entity drafts are deduplicated and noisy merchant candidates are filtered
- notification events can surface a source entity for `received_from` relations
- ambiguous classifications can be upgraded by DeepSeek when configured
- model-assisted classification metadata is stored for audit and replay
- quick capture routes are active for notes, email, notifications, wallet events, and offline batches
- a thin mobile shell scaffold exists and can read metrics, inspect knowledge, and send capture events
- a thin web dashboard scaffold exists for exploration and debugging

## Future roadmap

The remaining ideas from the old backlog are no longer blocking backlog items. They are now future roadmap topics:

- retry, dead-letter, and failure handling for derived work
- materialized subgraph projections beyond the current traversal cache
- hybrid retrieval and embeddings
- daily or weekly insight digests
- richer model-assisted extraction and source-specific adapters
- mobile shell hardening
- web dashboard expansion

## Notes

The active planning surface now lives in the feature-specific docs and any future roadmap documents that follow from them.
