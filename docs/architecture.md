# Architecture

## Overview

BrainIA is designed as a backend-only system that receives generic events from a mobile client.

The mobile app acts as a thin event producer.

The backend acts as:

- ingestion layer
- normalization layer
- classification layer
- storage layer
- knowledge layer foundation

## Layers

### 1. Transport

Receives HTTP requests from mobile or other clients.

Responsibilities:

- validate input shape
- return clear errors
- expose versioned endpoints

### 2. Domain

Contains the project concepts:

- event
- event kind
- classified event
- entities
- relations

### 3. Classification

Transforms raw events into typed knowledge candidates.

For now this is heuristic.
Later it can become:

- rules-based
- LLM-assisted
- hybrid

### 4. Storage

Persists accepted events.

Current prototype:

- JSONL append-only file

Target production direction:

- Postgres
- normalized tables
- optional graph projection

## Design Goals

- backend-first
- mobile-first consumption later
- minimal coupling
- versioned API
- evolvable schema
- AI-ready data model

## Non-goals for the first phase

- full mobile app
- web dashboard as primary interface
- graph database dependency on day one
- over-engineered microservice split

## Evolution path

1. prototype API
2. durable storage
3. auth
4. query endpoints
5. knowledge graph tables
6. AI assistant access layer

