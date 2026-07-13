# BrainIA Backend

Backend puro para recibir eventos desde móvil, clasificarlos y prepararlos para una base de conocimiento.

## Objetivo

Separar el origen del evento del procesamiento:

- el móvil solo envía eventos
- el backend normaliza, clasifica y persiste
- una capa posterior de IA puede construir entidades, relaciones, resúmenes e insights

## Stack

- Node.js
- Fastify
- TypeScript
- Zod

## Endpoints

- `GET /health`
- `POST /api/v1/events`
- `POST /api/v1/events/:id/reprocess`
- `GET /api/v1/events`
- `GET /api/v1/metrics`

## Por qué Fastify

- es liviano
- tiene buen rendimiento
- encaja bien para APIs puras
- no arrastra decisiones de UI

## Documentación

- [`docs/agent.md`](docs/agent.md)
- [`docs/architecture.md`](docs/architecture.md)
- [`docs/api.md`](docs/api.md)
- [`docs/domain.md`](docs/domain.md)
- [`docs/operations.md`](docs/operations.md)
- [`docs/changelog.md`](docs/changelog.md)
- [`docs/mvp.md`](docs/mvp.md)
- [`docs/backlog.md`](docs/backlog.md)

## Siguiente paso

La evolución natural ahora es:

1. mejorar la extracción heurística de entidades y relaciones
2. ampliar el reprocess para rebuilds más amplios
3. formalizar el MCP server si hace falta
4. expandir observabilidad, backup y retención
