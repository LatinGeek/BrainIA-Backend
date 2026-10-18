import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { FastifyRequest } from "fastify";
import { ownerScope } from "../auth.js";
import { deletePersonalData, exportPersonalData, recordKnowledgeFeedback, setEntityVisibility, setEventPrivacy } from "../storage/data-controls.js";
import { pool, withOwnerRead } from "../storage/postgres.js";
import { upsertSourceProcessingPolicy } from "../storage/privacy.js";

function clientId(request: FastifyRequest) {
  return ownerScope(request) ?? null;
}

export const registerPrivacyRoutes: FastifyPluginAsync = async (app) => {
  app.get("/privacy/export", async (request) => {
    const ownerId = clientId(request);
    return withOwnerRead(ownerId ?? undefined, (db) => exportPersonalData(ownerId, db));
  });

  app.patch("/privacy/events/:id", async (request, reply) => {
    const parsed = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ privacyStatus: z.enum(["standard", "private", "hidden"]) }).safeParse(request.body);
    if (!parsed.success || !body.success) return reply.status(400).send({ error: "invalid_event_privacy_request" });
    const result = await setEventPrivacy({ eventId: parsed.data.id, clientId: clientId(request), privacyStatus: body.data.privacyStatus });
    return result ?? reply.status(404).send({ error: "event_not_found" });
  });

  app.delete("/privacy/events/:id", async (request, reply) => {
    const parsed = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ mode: z.enum(["delete_evidence", "delete_knowledge", "delete_all"]), reason: z.string().max(500).optional() }).safeParse(request.body);
    if (!parsed.success || !body.success) return reply.status(400).send({ error: "invalid_data_deletion_request" });
    const result = await deletePersonalData({ eventId: parsed.data.id, clientId: clientId(request), ...body.data });
    return result ?? reply.status(404).send({ error: "event_not_found" });
  });

  app.patch("/privacy/entities/:id", async (request, reply) => {
    const parsed = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ visibility: z.enum(["visible", "private", "hidden"]) }).safeParse(request.body);
    if (!parsed.success || !body.success) return reply.status(400).send({ error: "invalid_entity_visibility_request" });
    const result = await setEntityVisibility({ entityId: parsed.data.id, clientId: clientId(request), visibility: body.data.visibility });
    return result ?? reply.status(404).send({ error: "entity_not_found" });
  });

  app.put("/privacy/sources/:source", async (request, reply) => {
    const parsed = z.object({ source: z.string().min(1) }).safeParse(request.params);
    const body = z.object({
      enabled: z.boolean().optional(), sendToLlm: z.boolean().optional(),
      redactEmails: z.boolean().optional(), redactFinancialIdentifiers: z.boolean().optional(),
      retentionDays: z.number().int().positive().nullable().optional(),
    }).safeParse(request.body);
    if (!parsed.success || !body.success) return reply.status(400).send({ error: "invalid_source_policy" });
    return upsertSourceProcessingPolicy(pool, { clientId: clientId(request), source: parsed.data.source, ...body.data });
  });

  app.post("/knowledge/feedback", async (request, reply) => {
    const body = z.object({
      action: z.enum(["accept", "reject", "merge", "rename", "categorize"]),
      targetType: z.enum(["event", "entity", "relation", "fact", "insight", "candidate"]),
      targetId: z.string().min(1), payload: z.record(z.unknown()).default({}),
    }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: "invalid_knowledge_feedback", issues: body.error.flatten() });
    try {
      const feedback = await recordKnowledgeFeedback({ clientId: clientId(request), ...body.data });
      if (!feedback) return reply.status(404).send({ error: "feedback_target_not_found" });
      return feedback;
    } catch (error) {
      return reply.status(409).send({ error: "feedback_could_not_be_applied", message: error instanceof Error ? error.message : String(error) });
    }
  });
};
