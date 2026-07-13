# BrainIA Agent Context

## Proyecto

BrainIA es un backend-first para capturar eventos genéricos desde un móvil, clasificarlos y convertirlos en una base de conocimiento consultable por una futura IA.

## Principio de diseño

La app móvil no debe procesar lógica de negocio. Solo captura y envía eventos.

El backend debe ser la fuente de verdad para:

- ingestión de eventos
- normalización
- clasificación
- persistencia
- consultas
- preparación de relaciones para un grafo de conocimiento

## Objetivo funcional

El sistema debe poder recibir eventos como:

- correos
- gastos
- notas
- notificaciones
- recordatorios
- cualquier otro evento genérico

Y luego:

- clasificarlos
- enriquecerlos
- relacionarlos entre sí
- exponerlos para un asistente o capa de IA

## Stack actual

- Node.js
- Fastify
- TypeScript
- Zod

## Decisión de arquitectura

La base del proyecto es una API pura.

No se asume UI web como producto principal.
La UI objetivo futura es móvil.

## Convención de API

- versión base: `/api/v1`
- healthcheck: `/health`

## Estado actual

- existe una API mínima funcional
- existe una clasificación inicial por heurísticas
- existe persistencia append-only en JSONL para prototipo
- no existe base de datos todavía

## Próximos pasos recomendados

1. reemplazar JSONL por Postgres
2. separar eventos crudos de eventos clasificados
3. definir esquema de entidades y relaciones
4. agregar autenticación para el cliente móvil
5. documentar contratos de API
6. documentar modelo de dominio y reglas de evolución

## Qué debe mantenerse actualizado

Este archivo debe reflejar siempre:

- objetivo del proyecto
- arquitectura vigente
- decisiones técnicas tomadas
- estado del sistema
- próximos pasos

## Memoria de corto plazo

Antes de cerrar una sesión o incorporar una decisión nueva, evaluar si corresponde actualizar `memory.md` en la raíz del proyecto.

`memory.md` debe usarse para registrar el estado de trabajo más reciente y puede:

- resumir decisiones activas
- reflejar cambios recientes
- señalar documentación que debe crearse, actualizarse o eliminarse
- actuar como memoria operativa de corto plazo

Regla práctica:

- si cambia una decisión importante, revisar si `memory.md` debe actualizarse
- si una parte de la documentación quedó obsoleta, ajustar o eliminar ese contenido
- si aparece un nuevo flujo o módulo, documentarlo en el proyecto de forma explícita
