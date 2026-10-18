import type { FastifyPluginAsync } from "fastify";
import { ownerScope, type AuthConfig } from "../auth.js";
import { eventSchema } from "../domain/event.js";
import {
  appendEvent,
  classifyCapturedEvent,
  correlateFinancialEvent,
  getEvent,
  listEvents,
  reprocessEvent,
} from "../storage/event-store.js";

type EventRoutesOptions = {
  authConfig: AuthConfig;
};

export const registerEventRoutes = (options: EventRoutesOptions): FastifyPluginAsync => {
  return async (app) => {
    app.get("/events", async (request) => listEvents(ownerScope(request)));

    app.get("/events/:id", async (request, reply) => {
      const eventId = (request.params as { id?: string }).id?.trim();
      if (!eventId) {
        return reply.status(400).send({
          error: "invalid_event_id",
          message: "The event id is required",
        });
      }

      const event = await getEvent(eventId, ownerScope(request));
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
