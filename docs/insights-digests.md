# Insights and Digests

BrainIA now has two complementary retrieval surfaces:

- `insights` for entity- or query-centric conclusions
- `digests` for time-window summaries over recent activity

## Insight

An insight answers a focused question like:

- "What is this entity?"
- "What does the graph around this merchant look like?"
- "What is the best compact explanation for this target?"

The implementation flow is:

1. resolve the requested entity or query
2. expand the local graph around that target
3. summarize the structured result
4. persist the full request and response snapshot in `insight_runs`

The stored audit snapshot makes it possible to:

- replay a past conclusion
- compare model outputs over time
- inspect what the agent saw when the insight was generated

Relevant routes:

- `GET /api/v1/insights`
- `GET /api/v1/insights/history`
- `GET /api/v1/insights/history/:id`

## Digest

A digest answers a broader question like:

- "What happened in the last 7 days?"
- "What does the recent event stream look like for a source or kind?"
- "What are the aggregate signals across recent inputs?"

The implementation flow is:

1. normalize a time window and optional filters
2. load recent events from Postgres
3. aggregate metrics such as counts by source and kind
4. include related insight runs from the same window
5. summarize the digest, optionally with DeepSeek
6. persist the full request and response snapshot in `digest_runs`

The digest is intentionally more periodic and aggregate-oriented than an insight.
It always returns a human-readable summary, and DeepSeek is used to enrich that summary when configured.

Relevant routes:

- `GET /api/v1/digests`
- `GET /api/v1/digests/history`
- `GET /api/v1/digests/history/:id`

## Practical rule

Use an insight when you need:

- a single entity
- a bounded graph
- a compact explanation

Use a digest when you need:

- a time-window summary
- counts and patterns
- a higher-level operational view of recent activity

In short:

- insight = point lookup
- digest = windowed aggregation
