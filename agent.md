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

Usar este proyecto como backend-first para eventos genericos de movil.

El foco actual del repo incluye la base P0 ya implementada y el bloque P1 de knowledge quality y agent access: canonicalizacion, merge manual, `same_as`, graph canonical, search con filtros, MCP formal, inspect enriquecido e insights.

El backlog post-MVP ya esta reordenado para priorizar observabilidad, graph projections, retrieval quality, relation/entity quality y la surface de agente antes de la UI movil.
La observabilidad ya incluye request IDs, slow-request logging y runbooks operativos.
El grafo ya tiene caching de traversals con invalidacion explicita en writes.
La busqueda ya incluye hints de relevancia y explicacion por resultado.
Las entidades ya se deduplican y los candidatos ruidosos de merchant se filtran.
Las notificaciones pueden materializar una fuente para relaciones `received_from`.
Los merchant names y legal names financieros pueden ir a una cola de review para alias y categoria.
La capa financiera agrupa wallet, notification y email payloads en transacciones canonicas con evidencias por evento.
La limpieza de datos de prueba tambien cubre `financial_transactions` y `financial_transaction_events`.
DeepSeek puede reforzar clasificaciones ambiguas cuando esta configurado.
Las corridas de insights se persisten como auditoria y se pueden recuperar por id.
Los digests de ventana temporal se persisten como auditoria y se pueden recuperar por id.
Hay un test end-to-end exigente que cubre capture, search, graph, inspect, insight, digest y agent surfaces.
El catalogo de agente esta agrupado en non-financial extraction, general ingestion y financial alias review.
El deployment de produccion corre como `serverless.ts` con rewrite total al backend Fastify y el smoke remoto ya valido `/health` y un POST de captura contra la URL publica.
La verificacion de produccion quedo automatizada en `.github/workflows/production-smoke.yml`.
Hay rutas de capture rapidas para note, email, notification, wallet y batch offline.
Existe un scaffold de mobile shell en `mobile/` para metrics, inspect y capture.
Cada cambio importante deberia revisar si `memory.md` tambien necesita una actualizacion corta.
