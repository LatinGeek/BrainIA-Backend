import type { FastifyPluginAsync } from "fastify";
import { eventSchema } from "../domain/event.js";
import { classifyEvent } from "../domain/classification.js";
import { appendEvent, listEvents } from "../storage/event-store.js";

export const registerEventRoutes: FastifyPluginAsync = async (app) => {
  app.post("/events", async (request, reply) => {
    const parsed = eventSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_event",
        issues: parsed.error.flatten(),
      });
    }

    const classified = classifyEvent(parsed.data);
    const stored = await appendEvent(classified);
    return reply.status(201).send(stored);
  });

  app.get("/events", async () => listEvents());
};
