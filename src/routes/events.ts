import type { FastifyPluginAsync } from "fastify";
import { ownerScope, type AuthConfig } from "../auth.js";
import { eventSchema } from "../domain/event.js";
import {
  eventHistoryFilters,
  eventHistoryQuerySchema,
  InvalidEventCursorError,
} from "../domain/event-history.js";
import { withOwnerRead } from "../storage/postgres.js";
import {
  appendEvent,
  classifyCapturedEvent,
  correlateFinancialEvent,
  getEvent,
  reprocessEvent,
} from "../storage/event-store.js";
import { listEventHistoryPage, listStoredEvents, loadStoredEventById } from "../storage/event-repository.js";

type EventRoutesOptions = {
  authConfig: AuthConfig;
};

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
      const event = await withOwnerRead(ownerId, (db) => loadStoredEventById(db, eventId, ownerId));
      return event ?? reply.status(404).send({
        error: "event_not_found",
        message: "No stored event matches the provided id",
      });
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

      return reply.status(201).send(stored);
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

      const clientId = ownerScope(request);
      const existing = await getEvent(eventId, clientId);
      if (!existing) {
        return reply.status(404).send({
          error: "event_not_found",
          message: "No stored event matches the provided id",
        });
      }

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
