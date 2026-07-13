# BrainIA Agent Context

## Project

BrainIA is a backend-first system for capturing generic events from a mobile client, classifying them, and turning them into a queryable knowledge base for future AI use.

## Design principle

The mobile app must not process business logic. It only captures and sends events.

The backend is the source of truth for:

- ingestion
- normalization
- classification
- persistence
- queries
- graph preparation

## Functional goal

The system should accept events such as:

- emails
- expenses
- notes
- notifications
- reminders
- any other generic event

And then:

- classify them
- enrich them
- relate them to each other
- expose them to an assistant or AI layer

## Current stack

- Node.js
- Fastify
- TypeScript
- Zod

## Architecture decision

The base of the project is a pure API.

No web UI is assumed as the primary product.
The future target UI is mobile.

## API convention

- base version: `/api/v1`
- healthcheck: `/health`

## Current state

- a minimal API is already working
- heuristic classification is active
- Postgres persistence is active
- optional API-key or client-scoped auth is active for API routes
- event contract versioning and idempotency are active
- raw events and derived knowledge are split
- entity extraction and event-to-entity links are active
- relation extraction and event-to-relation links are active
- single-event reprocessing is active
- a lightweight metrics endpoint is active
- text search is active
- bounded graph expansion is active
- entity resolution is separated from graph expansion
- the agent tool catalog stays compact and self-describing
- DeepSeek can generate a short natural-language summary when configured

## Recommended next steps

1. improve heuristic entity and relation extraction
2. refine the reprocess pipeline into a broader rebuild flow
3. formalize the MCP server surface if needed
4. expand observability and durability notes
5. keep the mobile client thin and API-driven

## What must stay updated

This file should always reflect:

- the project objective
- the current architecture
- technical decisions
- the system state
- the next steps

## Short-term memory

Before closing a session or introducing a new decision, evaluate whether `memory.md` should be updated.

`memory.md` is the short-term working memory and should:

- summarize active decisions
- reflect recent changes
- point to documentation that should be created, updated, or removed
- act as operational memory for the current phase

Practical rule:

- if an important decision changes, review whether `memory.md` should change too
- if a document becomes obsolete, fix or remove it
- if a new flow or module appears, document it explicitly

The long-term planning surface lives in `docs/backlog.md`.
