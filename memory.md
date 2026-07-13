# Memory

## Propósito

Memoria de corto plazo del proyecto BrainIA.

Este archivo debe reflejar el estado actual más reciente, no el historial completo.

## Uso

Actualizar este archivo cuando:

- cambie una decisión técnica importante
- se incorpore o elimine documentación relevante
- aparezca un nuevo flujo de trabajo
- haya que marcar documentación obsoleta para revisión o eliminación

## Estado actual

- proyecto backend-first
- stack base: Node.js + Fastify + TypeScript + Zod
- API versionada bajo `/api/v1`
- backend sin UI por ahora
- documentación centralizada en `docs/`
- `docs/agent.md` actúa como contexto persistente principal
- `memory.md` actúa como memoria operativa de corto plazo
- almacenamiento actual: Postgres para eventos
- todavía no hay autenticación
- contrato de evento de entrada ya formalizado en Markdown
- migraciones SQL versionadas ya definidas
- modelo de conocimiento split entre raw_events, classified_events, entities y relations
- runtime ya escribe en raw_events y classified_events
- primera extracción de entidades y links event_entities activa
- migración 0003 agrega secuencias y canonicalización de entities
- relaciones guardan tipo canónico, label y description
- primera extracción de relaciones y links event_relations activa
- endpoints de consulta para entities y relations activos
- endpoint de búsqueda textual activo para retrieval del asistente
- endpoint de grafo por entidad activo con depth y límites
- endpoint de manifiesto de herramientas del agente activo
- endpoint de registry MCP-like con schemas, examples y errors activo
- resolución de entidad separada de expansión de grafo
- grafo devuelve rootDistance, direction y paths de reconstrucción
- endpoint inspect activo para resolve + expand + explain
- DeepSeek habilitado vía `DEEPSEEK_API_KEY` para resumen natural
- catálogo de tools del agente reducido para el MVP
- suite mínima de tests activa
- alcance del MVP documentado en `docs/mvp.md`

## Decisiones activas

- el móvil será un cliente del backend, no el lugar donde viva la lógica central
- el sistema debe capturar eventos genéricos y luego clasificarlos
- la documentación del proyecto es parte del producto y debe mantenerse viva
- cada cambio importante debe evaluar si corresponde actualizar `memory.md`

## Reglas operativas

- mantener `memory.md` breve y accionable
- reflejar solo decisiones vivas o recientes
- si un documento quedó desactualizado, corregirlo o retirarlo
- si una decisión afecta arquitectura o flujo, documentarla antes de seguir

## Próximos pasos inmediatos

1. preparar autenticación básica para el cliente móvil
2. mejorar la extracción heurística de entidades
3. mejorar la extracción heurística de relaciones
4. agregar proyecciones de grafo cuando el modelo se estabilice
