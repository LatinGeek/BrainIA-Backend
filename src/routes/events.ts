import type { FastifyPluginAsync } from "fastify";
import { resolveAuthContext, type AuthConfig } from "../auth.js";
import { eventSchema } from "../domain/event.js";
import { appendEvent, reprocessEvent } from "../storage/event-store.js";

type EventRoutesOptions = {
  authConfig: AuthConfig;
};

export const registerEventRoutes = (options: EventRoutesOptions): FastifyPluginAsync => {
  return async (app) => {
    app.post("/events", async (request, reply) => {
      const parsed = eventSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "invalid_event",
          issues: parsed.error.flatten(),
        });
      }

      const auth = resolveAuthContext(request.headers, options.authConfig);
      if ("ok" in auth && !auth.ok) {
        return reply.status(auth.statusCode).send({
          error: auth.error,
          message: auth.message,
        });
      }

      const stored = await appendEvent(parsed.data, {
        clientId: "mode" in auth ? (auth.mode === "disabled" ? null : auth.clientId) : null,
      });

      request.log.info(
        {
          eventId: stored.id,
          source: stored.source,
          inferredKind: stored.inferredKind,
          contractVersion: stored.contractVersion,
          dedupeKey: stored.dedupeKey,
          clientId: "mode" in auth ? (auth.mode === "disabled" ? null : auth.clientId) : null,
        },
        "event ingested",
      );

      return reply.status(201).send(stored);
    });

    app.post("/events/:id/reprocess", async (request, reply) => {
      const params = request.params as { id?: string };
      const eventId = params.id?.trim();
      if (!eventId) {
        return reply.status(400).send({
          error: "invalid_event_id",
          message: "The event id is required",
        });
      }

      const auth = resolveAuthContext(request.headers, options.authConfig);
      if ("ok" in auth && !auth.ok) {
        return reply.status(auth.statusCode).send({
          error: auth.error,
          message: auth.message,
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
  };
};
