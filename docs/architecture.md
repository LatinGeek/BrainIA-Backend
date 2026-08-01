# Architecture

## Overview

BrainIA is a Postgres-backed personal knowledge platform. Thin mobile and integration clients capture evidence; the backend owns normalization, classification, semantic governance, retrieval, proactive insight generation, privacy, and operations.

```text
External sources
  -> immutable raw_events evidence
  -> transactional background_jobs outbox
  -> classified_events + knowledge_facts
  -> governed entities/relations/semantic anchors
  -> FTS + versioned embedding projections
  -> hybrid retrieval and deterministic detectors
  -> auditable insights/digests
```

## Storage layers

1. **Evidence:** `raw_events` preserves source payloads, observation time, client scope, idempotency, privacy, and an observable processing state.
2. **Interpretation:** `classified_events`, `knowledge_facts`, and `semantic_event_decisions` are replaceable, versioned projections.
3. **Canonical knowledge:** `entities`, aliases, merges, relations, hierarchy, and semantic anchors form the governed graph.
4. **Domain projections:** financial accounts and transactions correlate multiple source events without replacing evidence.
5. **Retrieval:** GIN full-text indexes and `knowledge_embeddings` support bounded hybrid retrieval across events, entities, facts, relations, insights, and digests.
6. **Conclusions:** insight candidates, insight runs, and digest runs retain selected evidence, confidence, model metadata, delivery state, feedback, and expiry.
7. **Operations:** background jobs, attempts, model-call audits, processing history, deletion audits, and backup verification runs make failures observable and recoverable.

## Invariants

- Raw evidence is never rewritten to correct a derived interpretation.
- Every event has one of `captured`, `classified`, `semantically_resolved`, `review`, `retryable`, or `discarded`.
- Every visible durable entity has a meaningful name, description, one immediate parent, and a valid route to a governed domain.
- Hierarchy writes are cycle-safe and the database enforces one immediate parent.
- Event instances remain evidence under their primary semantic meaning; they do not become duplicate concepts.
- Ambiguous merges and reparenting are review candidates, not silent graph mutations.
- Every provider call records provider, operation, model, prompt version, attempts, token usage, latency, cost estimate, result, and request fingerprint.
- Model prompts contain a bounded 10–30 candidate retrieval package, never the entire graph.
- Jobs are idempotent, retry with exponential backoff, and end in a visible dead-letter state after bounded attempts.

## Processing modes

`BRAINIA_PROCESSING_MODE=inline` is the backward-compatible default: raw evidence commits first, then derived processing is attempted in the request. A processing failure returns the captured record in `retryable` state instead of losing it.

`BRAINIA_PROCESSING_MODE=queued` returns after capture and lets `npm run worker:once` or the protected operations worker run independent classification, semantic enrichment, financial correlation, embedding, insight detection, reconciliation, retention, and backup jobs.

## Retrieval

`GET /api/v1/retrieval/hybrid` combines:

- structured filters for client, source, kind, time, currency, account, and category;
- PostgreSQL full-text ranking through dedicated GIN indexes;
- versioned local or remote embeddings and bounded cosine similarity;
- canonical aliases and merges;
- a one-hop graph neighborhood;
- recency, confidence, frequency, and lightweight reranking.

The response includes a compact `evidencePackage` with stable evidence identifiers. Semantic ingestion uses the same mechanism with a hard 10–30 candidate bound.

## Proactive insights

Deterministic detectors evaluate spending changes, recurrence/subscriptions, source-frequency changes, cross-domain temporal correlations, pending tasks/reviews, and high-confidence graph changes. Candidates are scored by novelty, impact, confidence, recurrence, and utility. Only the highest-ranked non-duplicate candidates are offered to DeepSeek for synthesis.

Vercel invokes the protected daily route at 08:00 UTC. `CRON_SECRET` is verified before any work runs.

## Privacy and learning

Source policies decide whether a source is enabled, whether it may be sent to an LLM, which identifiers are redacted, and how long evidence is retained. Evidence and knowledge have independent visibility controls. User accept/reject/merge/rename/categorize feedback is audited and can materialize local semantic rules.

## Deployment

Fastify runs directly for local development and through `serverless.ts` on Vercel. Postgres is the sole durable system of record; no JSONL runtime remains. Migrations use the direct database URL, while runtime traffic uses the pooled URL.
