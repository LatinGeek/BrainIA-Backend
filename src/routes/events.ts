import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ownerScope, type AuthConfig } from "../auth.js";
import { config } from "../config.js";
import { eventSchema } from "../domain/event.js";
import {
  eventHistoryFilters,
  eventHistoryQuerySchema,
  InvalidEventCursorError,
} from "../domain/event-history.js";
import {
  REPROCESS_STAGES,
  ReprocessRequestError,
} from "../domain/event-reprocess.js";
import { withOwnerRead } from "../storage/postgres.js";
import {
  appendEvent,
  classifyCapturedEvent,
  correlateFinancialEvent,
  getEvent,
  queueEventReprocess,
  reprocessEvent,
} from "../storage/event-store.js";
import { listEventBackgroundJobs } from "../storage/job-repository.js";
import { listEventHistoryPage, listStoredEvents, loadStoredEventById } from "../storage/event-repository.js";
import { withEventProgress } from "../storage/event-progress.js";
import { loadEventExplanation } from "../storage/event-explanation.js";

type EventRoutesOptions = {
  authConfig: AuthConfig;
};

const reprocessRequestSchema = z.object({
  stages: z.array(z.string().trim().min(1)).min(1).max(REPROCESS_STAGES.length).optional(),
  execution: z.enum(["coalesce", "new"]).optional(),
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
  mode: z.enum(["queued", "legacy"]).optional(),
});

export const registerEventRoutes = (options: EventRoutesOptions): FastifyPluginAsync => {
  return async (app) => {
    // Two response shapes, selected by whether the request carries any query string:
    //  - no query params: legacy unbounded array of full records (deprecated; existing
    //    consumers such as the mobile client keep working unchanged);
    //  - any query param: paginated summary envelope, see domain/event-history.ts.
    app.get("/events", async (request, reply) => {
      const ownerId = ownerScope(request);
      const rawQuery = (request.query ?? {}) as Record<string, unknown>;

      if (Object.keys(rawQuery).length === 0) {
        reply.header("Deprecation", "true");
        reply.header("Link", `<${request.url.split("?")[0]}?limit=25>; rel="successor-version"`);
        return withOwnerRead(ownerId, (db) => listStoredEvents(ownerId, db));
      }

      const parsed = eventHistoryQuerySchema.safeParse(rawQuery);
      if (!parsed.success) {
        // A bad cursor is reported with the same code regardless of how it is bad.
        if (parsed.error.issues.some((issue) => issue.path[0] === "cursor")) {
          return reply.status(400).send({ error: "invalid_cursor", message: new InvalidEventCursorError().message });
        }
        return reply.status(400).send({
          error: "invalid_event_query",
          message: "The event history query is invalid",
          issues: parsed.error.flatten(),
        });
      }

      const query = parsed.data;
      const filters = eventHistoryFilters(query);
      try {
        const page = await withOwnerRead(ownerId, (db) =>
          listEventHistoryPage(db, { ownerId, limit: query.limit, cursor: query.cursor, filters }),
        );
        return {
          items: page.items,
          page: { limit: query.limit, hasMore: page.hasMore, nextCursor: page.nextCursor },
          query: filters,
        };
      } catch (error) {
        if (error instanceof InvalidEventCursorError) {
          return reply.status(400).send({ error: "invalid_cursor", message: error.message });
        }
        throw error;
      }
    });

    app.get("/events/:id", async (request, reply) => {
      const eventId = (request.params as { id?: string }).id?.trim();
      if (!eventId) {
        return reply.status(400).send({
          error: "invalid_event_id",
          message: "The event id is required",
        });
      }

      const ownerId = ownerScope(request);
      // `progress` is additive: processingStatus and every existing field are unchanged.
      const event = await withOwnerRead(ownerId, async (db) => {
        const stored = await loadStoredEventById(db, eventId, ownerId);
        return stored ? withEventProgress(db, stored) : null;
      });
      return event ?? reply.status(404).send({
        error: "event_not_found",
        message: "No stored event matches the provided id",
      });
    });

    app.get("/events/:id/explanation", async (request, reply) => {
      const eventId = (request.params as { id: string }).id;
      const ownerId = ownerScope(request);
      reply.header('Cache-Control', 'no-store');
      const explanation = await withOwnerRead(ownerId, async (db) => {
        const event = await loadStoredEventById(db, eventId, ownerId);
        return event ? loadEventExplanation(db, event) : null;
      });
      return explanation ?? reply.status(404).send({ error: 'event_not_found' });
    });

    app.post("/events", async (request, reply) => {
      const parsed = eventSchema.safeParse(request.body);
      if (!parsed.success) {
        request.log.warn(
          {
            issues: parsed.error.flatten(),
            path: "/events",
          },
          "invalid event payload",
        );
        return reply.status(400).send({
          error: "invalid_event",
          issues: parsed.error.flatten(),
        });
      }

      const clientId = ownerScope(request);
      const stored = await appendEvent(parsed.data, { clientId });

      request.log.info(
        {
          eventId: stored.id,
          source: stored.source,
          inferredKind: stored.inferredKind,
          contractVersion: stored.contractVersion,
          dedupeKey: stored.dedupeKey,
          clientId,
        },
        "event ingested",
      );

      // Lets the capture response say "Expense recorded; interpretation pending."
      // Progress is informational: never fail an already-persisted capture over it.
      const withProgress = await withOwnerRead(clientId, (db) => withEventProgress(db, stored))
        .catch((error) => {
          request.log.warn({ eventId: stored.id, error: String(error) }, "event progress unavailable");
          return stored;
        });
      return reply.status(201).send(withProgress);
    });

    app.get("/events/:id/jobs", async (request, reply) => {
      const eventId = (request.params as { id?: string }).id?.trim();
      if (!eventId) {
        return reply.status(400).send({
          error: "invalid_event_id",
          message: "The event id is required",
        });
      }

      const ownerId = ownerScope(request);
      const jobs = await withOwnerRead(ownerId, async (db) => {
        const stored = await loadStoredEventById(db, eventId, ownerId);
        if (!stored) return null;
        return listEventBackgroundJobs(db, eventId);
      });
      if (!jobs) {
        return reply.status(404).send({
          error: "event_not_found",
          message: "No stored event matches the provided id",
        });
      }
      return { eventId, count: jobs.length, jobs };
    });

    app.post("/events/:id/reprocess", async (request, reply) => {
      const params = request.params as { id?: string };
      const eventId = params.id?.trim();
      if (!eventId) {
        request.log.warn({ path: "/events/:id/reprocess" }, "invalid event id");
        return reply.status(400).send({
          error: "invalid_event_id",
          message: "The event id is required",
        });
      }

      const parsed = reprocessRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: "invalid_reprocess_request",
          message: "The reprocessing request is invalid",
          issues: parsed.error.flatten(),
          allowedStages: [...REPROCESS_STAGES],
        });
      }
      const body = parsed.data;
      if (body.mode === "legacy" && body.stages !== undefined) {
        return reply.status(400).send({
          error: "invalid_reprocess_request",
          message: "mode=legacy does not accept a stage selection",
        });
      }
      // Compatibility: a body without `stages` and without `mode=queued` is the
      // pre-queue synchronous reprocess. Existing clients (including capture
      // retries and the mobile detail action) keep their 200 response shape.
      const queued = body.mode !== "legacy" && (body.stages !== undefined || body.mode === "queued");
      if (!queued && (body.execution !== undefined || body.idempotencyKey !== undefined)) {
        return reply.status(400).send({
          error: "invalid_reprocess_request",
          message: "execution/idempotencyKey require stages or mode=queued",
        });
      }

      const clientId = ownerScope(request);
      const existing = await getEvent(eventId, clientId);
      if (!existing) {
        return reply.status(404).send({
          error: "event_not_found",
          message: "No stored event matches the provided id",
        });
      }

      if (queued) {
        try {
          const acceptance = await queueEventReprocess({
            eventId,
            stages: body.stages ?? [...REPROCESS_STAGES],
            execution: body.execution,
            idempotencyKey: body.idempotencyKey,
            clientId,
            ownerId: clientId,
          });
          request.log.info(
            {
              eventId,
              jobId: acceptance.job.id,
              disposition: acceptance.disposition,
              requestedStages: acceptance.requestedStages,
              executionStages: acceptance.executionStages,
            },
            "event reprocessing accepted",
          );
          return reply.status(202).send({
            ...acceptance,
            links: {
              event: `${config.apiPrefix}/events/${encodeURIComponent(eventId)}`,
              jobs: `${config.apiPrefix}/events/${encodeURIComponent(eventId)}/jobs`,
            },
          });
        } catch (error) {
          if (error instanceof ReprocessRequestError) {
            return reply.status(error.statusCode).send(error.toResponse());
          }
          throw error;
        }
      }

      // Legacy synchronous mode. Selective callers should send `stages`; this
      // path is retained unchanged for backward compatibility.
      const stored = await reprocessEvent(eventId);
      if (!stored) {
        return reply.status(404).send({
          error: "event_not_found",
          message: "No stored event matches the provided id",
        });
      }

      request.log.info(
        {
          eventId: stored.id,
          source: stored.source,
          inferredKind: stored.inferredKind,
          classificationVersion: stored.classificationVersion,
          dedupeKey: stored.dedupeKey,
        },
        "event reprocessed",
      );

      return reply.send(stored);
    });

    app.post("/events/:id/reconcile-financial", async (request, reply) => {
      const eventId = (request.params as { id?: string }).id?.trim();
      if (!eventId) {
        return reply.status(400).send({ error: "invalid_event_id", message: "The event id is required" });
      }

      const clientId = ownerScope(request);

      // Do not run semantic enrichment here. This narrow recovery operation is
      // for an already-captured notification whose financial ledger row was
      // delayed or missed by the background worker.
      const existing = await getEvent(eventId, clientId);
      if (!existing) {
        return reply.status(404).send({ error: "event_not_found", message: "No stored event matches the provided id" });
      }
      if (!existing.classificationVersion) {
        const classified = await classifyCapturedEvent(eventId);
        if (!classified) {
          return reply.status(409).send({ error: "event_not_processable", message: "This event cannot be classified" });
        }
      }
      const correlation = await correlateFinancialEvent(eventId);
      const stored = await getEvent(eventId, clientId);
      request.log.info({ eventId, correlated: correlation?.correlated ?? false }, "financial event reconciled");
      return reply.send({ event: stored, correlated: correlation?.correlated ?? false });
    });
  };
};
