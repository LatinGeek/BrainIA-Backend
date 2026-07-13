# Future Features

This file collects concrete follow-up ideas for BrainIA after the current baseline.

## Retrieval and Knowledge

- embeddings for semantic search
- hybrid retrieval across text, graph, and embeddings
- better ranking across entities, relations, events, insights, and digests
- materialized subgraph projections for frequently inspected entities
- graph freshness policies and projection invalidation

## Insights and Digests

- scheduled daily and weekly digests
- per-entity digests
- topic-based digests
- digest push delivery to mobile clients
- richer replay tooling for past insights and digests
- insight and digest comparison views across model versions

## Extraction

- more source-specific adapters
- richer merchant, person, and organization extraction
- improved LLM-assisted extraction for ambiguous inputs
- replay tooling for model outputs with diffing against prior runs

## Operations

- retry queues for derived work
- dead-letter handling for failed enrichments
- distributed tracing and external observability
- retention automation and backup verification
- data export and recovery tooling

## Clients

- mobile shell hardening
- offline-first sync improvements
- push notifications for important digests
- richer dashboard views for manual review and cleanup
- optional React Native client once the backend contract stabilizes

## Agent Experience

- more self-describing MCP tool metadata
- agent workflow recipes for common queries
- tool-specific examples for digestion, replay, and recovery
- assistant-side memory synchronization with project docs
