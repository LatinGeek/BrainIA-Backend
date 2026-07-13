# BrainIA Agent Context

Este archivo apunta al contexto persistente del proyecto.

- Documento principal: [`docs/agent.md`](docs/agent.md)
- Arquitectura: [`docs/architecture.md`](docs/architecture.md)
- API: [`docs/api.md`](docs/api.md)
- Dominio: [`docs/domain.md`](docs/domain.md)
- Operaciones: [`docs/operations.md`](docs/operations.md)
- Historial: [`docs/changelog.md`](docs/changelog.md)
- MVP: [`docs/mvp.md`](docs/mvp.md)
- Backlog: [`docs/backlog.md`](docs/backlog.md)
- Memoria activa: [`memory.md`](memory.md)

Usar este proyecto como backend-first para eventos genéricos de móvil.

El foco actual del repo incluye la base P0 ya implementada y el bloque P1 de knowledge quality y agent access: canonicalización, merge manual, `same_as`, graph canonical, search con filtros, MCP formal, inspect enriquecido e insights.

El backlog post-MVP ya está reordenado para priorizar observabilidad, graph projections, retrieval quality, relation/entity quality y la surface de agente antes de la UI móvil.
La observabilidad ya incluye request IDs, slow-request logging y runbooks operativos.
El grafo ya tiene caching de traversals con invalidación explícita en writes.
La búsqueda ya incluye hints de relevancia y explicación por resultado.
Las entidades ya se deduplican y los candidatos ruidosos de merchant se filtran.
Las notificaciones pueden materializar una fuente para relaciones `received_from`.
DeepSeek puede reforzar clasificaciones ambiguas cuando está configurado.
Las corridas de insights se persisten como auditoría y se pueden recuperar por id.
Los digests de ventana temporal se persisten como auditoría y se pueden recuperar por id.
Hay un test end-to-end exigente que cubre capture, search, graph, inspect, insight, digest y agent surfaces.
Hay rutas de capture rapidas para note, email, notification, wallet y batch offline.
Existe un scaffold de mobile shell en `mobile/` para metrics, inspect y capture.
