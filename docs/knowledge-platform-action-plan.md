# Plan de acción: plataforma de conocimiento personal de BrainIA

## Estado de implementación

Implementado en su totalidad el 22 de julio de 2026 mediante `migrations/0028_knowledge_platform.sql` y las capas de dominio, almacenamiento, recuperación, insights, operaciones y privacidad asociadas.

- Fases 0-1: `KnowledgeFact`, estados observables, auditoría de modelos, métricas bloqueantes y reconciliación gobernada.
- Fase 2: FTS con GIN, embeddings versionados, recuperación híbrida, reranking y contexto de ingestión limitado a 10-30 candidatos.
- Fase 3: candidatos de insight, detectores determinísticos, deduplicación, síntesis selectiva y cron diario protegido.
- Fase 4: outbox transaccional, trabajos por etapa, reintentos exponenciales, DLQ, worker, retención y verificación de backups.
- Fase 5: políticas por fuente, redacción, privacidad independiente de evidencia/conocimiento, exportación, borrado y aprendizaje por feedback.

La verificación ejecutable está en `tests/knowledge-platform.test.ts`, junto con la suite integral existente.

## Propósito

BrainIA debe absorber datos personales de múltiples fuentes, preservarlos como evidencia auditable, convertirlos en conocimiento canónico y permitir que un modelo responda preguntas y genere insights proactivos con alta precisión y bajo consumo de tokens.

El objetivo no es que un LLM relea todo el historial. El objetivo es construir una memoria personal estructurada que recupere únicamente la evidencia necesaria para cada decisión.

## Diagnóstico actual

La aplicación ya cuenta con una base funcional:

- captura de notificaciones, emails, notas y eventos financieros;
- almacenamiento de eventos crudos idempotentes en `raw_events`;
- clasificación en `classified_events`;
- entidades, relaciones, aliases, merges y enlaces de evidencia;
- decisiones semánticas, candidatos revisables y anclas de dominio;
- transacciones financieras correlacionadas con eventos fuente;
- búsqueda textual, expansión acotada del grafo, insights y digests auditables.

Las limitaciones que impiden escalar hacia una memoria personal inteligente son:

1. La ingestión semántica carga hasta 300 entidades y una jerarquía amplia en el prompt de cada evento.
2. La recuperación es mayormente textual; no existen full-text indexes dedicados, embeddings, reranking ni recuperación híbrida.
3. La cobertura semántica histórica no está completa: hay entidades durables y decisiones que aún necesitan reconciliación.
4. Los endpoints de insights y digest existen, pero no hay un proceso programado que detecte, priorice y entregue insights diariamente.
5. No hay una capa operativa de colas, reintentos, dead letters, costo/tokens, ni métricas de calidad semántica.
6. La documentación arquitectónica conserva referencias antiguas a JSONL y clasificación puramente heurística.

## Principios de diseño

### 1. La evidencia es inmutable

Cada entrada externa se almacena primero como evento crudo, con payload original, fuente, tiempo observado, idempotency key y referencias externas. Nunca se reemplaza la evidencia para corregir una interpretación.

### 2. Las proyecciones son reemplazables y versionadas

Clasificaciones, extracciones, transacciones, entidades, relaciones y conclusiones del modelo son derivados. Deben guardar versión de modelo, prompt, fecha, confianza y vínculo a la evidencia que los produjo.

### 3. Todo conocimiento durable debe ser gobernado

Una entidad visible debe tener:

- nombre canónico con significado;
- descripción generada o aprobada;
- identidad canónica o alias explícito;
- un único padre jerárquico inmediato;
- una ruta válida hasta uno de los dominios principales;
- evidencia de origen trazable.

### 4. Un evento es evidencia, no un concepto duplicado

El evento debe colgar de un significado canónico seleccionado como ancla primaria. Eventos repetidos se agrupan debajo de la misma entidad o concepto; no compiten como nodos durables equivalentes.

### 5. Recuperar antes de razonar

Antes de llamar al LLM, el sistema debe seleccionar una pequeña colección de hechos, entidades, relaciones y eventos relevantes. El modelo sintetiza sobre evidencia seleccionada; no explora la base completa.

### 6. El LLM decide semántica; el sistema impone invariantes

El LLM puede proponer identidad, ubicación, merge, relaciones y explicaciones. Las reglas del backend validan jerarquía, unicidad, ciclos, confianza, permisos y trazabilidad.

## Arquitectura objetivo

```text
Fuentes externas
  → registro inmutable de eventos
  → normalización y deduplicación
  → extracción de hechos y clasificación
  → resolución semántica y grafo canónico
  → índices de recuperación y agregados temporales
  → detección de patrones y candidatos a insight
  → paquete de evidencia compacto
  → LLM de síntesis / respuesta
  → insight auditable, revisable y entregable
```

### Capas de almacenamiento

| Capa | Responsabilidad | Tablas / proyecciones actuales |
|---|---|---|
| Evidencia | Registro fiel de lo recibido | `raw_events`, payload `raw` |
| Interpretación | Tipo, confianza, título y descripción interpretados | `classified_events`, `semantic_event_decisions` |
| Conocimiento | Entidades, aliases, merges, relaciones y jerarquía | `entities`, `relations`, `entity_merges`, `entity_aliases` |
| Trazabilidad | Qué evento sostuvo cada elemento | `event_entities`, `event_relations`, `event_semantic_anchors` |
| Finanzas | Proyección de movimientos y cuentas | `financial_transactions`, `financial_accounts` |
| Aprendizaje | Observaciones, revisiones y reglas del usuario | `semantic_observations`, `semantic_candidates`, `semantic_rules` |
| Conclusiones | Insights y digests reproducibles | `insight_runs`, `digest_runs` |

## Plan de ejecución

## Fase 0 — Definir contratos y métricas de calidad

**Objetivo:** convertir la calidad del conocimiento en algo medible y bloqueante para el sistema.

Acciones:

- Definir un contrato de `KnowledgeFact` para hechos derivados: tipo, valor, normalización, confianza, evidencia, modelo y versión.
- Definir estados explícitos para cada evento: `captured`, `classified`, `semantically_resolved`, `review`, `retryable`, `discarded`.
- Crear métricas de cobertura: porcentaje de eventos con ancla primaria, entidades durables con ruta a dominio, relaciones inválidas, duplicados semánticos y propuestas pendientes.
- Registrar tokens estimados, modelo, latencia, intentos, costo y resultado para cada llamada a DeepSeek.
- Actualizar `docs/architecture.md`, `docs/agent.md` y `docs/operations.md` para reflejar Postgres, DeepSeek y el grafo gobernado como estado actual.

Criterios de éxito:

- 100% de los eventos tienen estado observable.
- Ninguna entidad durable visible carece de nombre, descripción o ruta a dominio.
- Cada llamada de modelo puede auditarse por evento, prompt/model version y consumo.

## Fase 1 — Consolidar integridad semántica

**Objetivo:** asegurar que la memoria canónica sea confiable antes de optimizar la recuperación.

Acciones:

- Ejecutar de forma controlada los reprocesos de decisiones `retryable` y `unclassified`.
- Reconciliar entidades legacy sin descripción o sin identidad canónica: enriquecer, fusionar, convertir en evidencia o descartar de las proyecciones visibles.
- Mantener la regla de un único padre inmediato para la jerarquía.
- Hacer que toda evidencia cuelgue exclusivamente de la ancla semántica primaria vigente.
- Detectar duplicados por nombre normalizado, aliases, fuente, tipo y similitud semántica antes de crear entidades nuevas.
- Abrir revisión humana cuando un merge o reubicación sea ambiguo; nunca crear ramas paralelas silenciosas.

Criterios de éxito:

- 100% de entidades canónicas visibles están enraizadas.
- 0 nodos visibles sin relación jerárquica válida.
- 0 ciclos, atajos jerárquicos ni padres múltiples.
- Disminución sostenida de entidades duplicadas por fuente o texto extraído.

## Fase 2 — Recuperación híbrida y eficiente para LLM

**Objetivo:** sustituir el envío de contexto global por un paquete mínimo de evidencia relevante.

Acciones:

- Habilitar PostgreSQL full-text search para título, cuerpo, descripción, aliases y relaciones, con índices GIN.
- Añadir embeddings para tres objetos diferentes:
  - eventos o fragmentos de evidencia;
  - entidades y conceptos canónicos;
  - insights/digests ya generados.
- Usar `pgvector` o un almacén vectorial compatible, con embedding versionado y fecha de actualización.
- Implementar un recuperador híbrido que combine:
  - filtros estructurados: fecha, fuente, tipo, moneda, cuenta, categoría;
  - coincidencia textual;
  - similitud vectorial;
  - aliases y merges canónicos;
  - vecindario de grafo de profundidad limitada;
  - recencia, confianza y frecuencia.
- Introducir reranking ligero antes de construir el prompt final.
- Reemplazar el contexto fijo de hasta 300 entidades durante ingestión por una recuperación de 10–30 candidatos relevantes.

Formato de contexto para el LLM:

```text
Intención / pregunta
Hechos estructurados relevantes
Entidades canónicas y aliases
Relaciones y caminos semánticos
Agregados temporales o financieros
Eventos fuente compactados con identificadores de evidencia
Restricciones de respuesta y trazabilidad
```

Criterios de éxito:

- El contexto de clasificación crece con la relevancia, no con el tamaño total de la base.
- Las preguntas semánticas recuperan evidencia aunque no compartan términos exactos.
- Toda respuesta puede enlazar sus conclusiones a eventos y relaciones concretas.

## Fase 3 — Motor de insights proactivos

**Objetivo:** generar valor sin requerir que el usuario formule una pregunta.

Acciones:

- Configurar un cron diario protegido para ejecutar la evaluación de insights.
- Crear una tabla o proyección de `insight_candidates` con estado, score, evidencia, dedupe key, ventana temporal, severidad y expiración.
- Implementar detectores determinísticos antes del LLM:
  - variaciones de gasto;
  - recurrencias y suscripciones;
  - cambios de horario o frecuencia;
  - actividad inusual por fuente;
  - correlaciones temporales entre dominios;
  - tareas o revisiones pendientes;
  - nuevos nodos o relaciones de alta confianza.
- Calificar candidatos por novedad, impacto, confianza, recurrencia y utilidad esperada.
- Comparar con insights entregados recientemente para evitar repeticiones.
- Usar el LLM solo para sintetizar los mejores candidatos y explicar por qué importan.
- Guardar evidencia, explicación, modelo, feedback del usuario, estado de entrega y fecha de vencimiento.

Regla operativa:

```text
Detectores estructurados descubren cambios.
El LLM explica únicamente los cambios priorizados.
```

Criterios de éxito:

- Se genera al menos un digest diario auditable cuando hay actividad relevante.
- No se generan insights duplicados dentro de una ventana configurable.
- Cada insight contiene evidencia, nivel de confianza y acción sugerida cuando corresponde.

## Fase 4 — Procesamiento asíncrono y confiabilidad

**Objetivo:** evitar que una captura móvil dependa de una cadena larga de procesamiento sincrónico.

Acciones:

- Separar captura de procesamiento derivado mediante una cola u outbox transaccional.
- Crear trabajos independientes: clasificación, enriquecimiento semántico, embeddings, correlación financiera, detección de insights y reconciliación.
- Añadir reintentos exponenciales, idempotencia por trabajo, dead-letter queue y panel de fallos.
- Implementar cursores para reprocesos masivos y límites de concurrencia por proveedor/modelo.
- Añadir políticas de retención, exportación, borrado y backup verificable.

Criterios de éxito:

- Una falla de DeepSeek no bloquea la captura del evento.
- Todo trabajo puede reintentarse sin duplicar entidades, relaciones o transacciones.
- Los eventos pendientes y fallidos son visibles y recuperables.

## Fase 5 — Privacidad, control del usuario y aprendizaje

**Objetivo:** mantener la confianza del usuario a medida que BrainIA absorbe más datos.

Acciones:

- Definir reglas de minimización y redacción antes de enviar datos a un proveedor de LLM.
- Incorporar controles por fuente: qué apps, cuentas, emails o categorías se procesan.
- Permitir borrar, ocultar o marcar evidencia como privada sin borrar necesariamente el conocimiento derivado, y viceversa.
- Usar feedback explícito del usuario —aceptar, rechazar, fusionar, renombrar, categorizar— para crear reglas semánticas locales.
- Registrar el motivo de cada recomendación y permitir inspeccionar su cadena de evidencia.

## Orden recomendado

1. Fase 0 y Fase 1: calidad e integridad semántica.
2. Fase 2: recuperación híbrida y reducción de tokens.
3. Fase 3: insights diarios y priorización.
4. Fase 4: colas, reintentos y observabilidad operativa.
5. Fase 5: controles de privacidad y aprendizaje por feedback.

## Resultado esperado

Al completar este plan, BrainIA podrá operar como una memoria personal auditable:

- captura datos heterogéneos sin perder evidencia;
- los convierte en un árbol semántico canónico y navegable;
- recupera contexto pequeño, preciso y trazable para el LLM;
- responde preguntas complejas sin enviar el historial completo;
- detecta cambios y patrones de forma proactiva;
- aprende decisiones del usuario sin degradar la estructura del conocimiento.
