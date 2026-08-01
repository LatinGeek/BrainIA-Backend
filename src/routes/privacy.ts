import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { CLIENT_ID_HEADER } from "../auth.js";
import { deletePersonalData, exportPersonalData, recordKnowledgeFeedback, setEntityVisibility, setEventPrivacy } from "../storage/data-controls.js";
import { pool } from "../storage/postgres.js";
import { upsertSourceProcessingPolicy } from "../storage/privacy.js";

function clientId(headers: Record<string, string | string[] | undefined>) {
  const value = headers[CLIENT_ID_HEADER];
  return (Array.isArray(value) ? value[0] : value)?.trim() || null;
}

export const registerPrivacyRoutes: FastifyPluginAsync = async (app) => {
  app.get("/privacy/export", async (request) => exportPersonalData(clientId(request.headers)));

  app.patch("/privacy/events/:id", async (request, reply) => {
    const parsed = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ privacyStatus: z.enum(["standard", "private", "hidden"]) }).safeParse(request.body);
    if (!parsed.success || !body.success) return reply.status(400).send({ error: "invalid_event_privacy_request" });
    const result = await setEventPrivacy({ eventId: parsed.data.id, clientId: clientId(request.headers), privacyStatus: body.data.privacyStatus });
    return result ?? reply.status(404).send({ error: "event_not_found" });
  });

  app.delete("/privacy/events/:id", async (request, reply) => {
    const parsed = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ mode: z.enum(["delete_evidence", "delete_knowledge", "delete_all"]), reason: z.string().max(500).optional() }).safeParse(request.body);
    if (!parsed.success || !body.success) return reply.status(400).send({ error: "invalid_data_deletion_request" });
    const result = await deletePersonalData({ eventId: parsed.data.id, clientId: clientId(request.headers), ...body.data });
    return result ?? reply.status(404).send({ error: "event_not_found" });
  });

  app.patch("/privacy/entities/:id", async (request, reply) => {
    const parsed = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ visibility: z.enum(["visible", "private", "hidden"]) }).safeParse(request.body);
    if (!parsed.success || !body.success) return reply.status(400).send({ error: "invalid_entity_visibility_request" });
    const result = await setEntityVisibility({ entityId: parsed.data.id, visibility: body.data.visibility });
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
    return upsertSourceProcessingPolicy(pool, { clientId: clientId(request.headers), source: parsed.data.source, ...body.data });
  });

  app.post("/knowledge/feedback", async (request, reply) => {
    const body = z.object({
      action: z.enum(["accept", "reject", "merge", "rename", "categorize"]),
      targetType: z.enum(["event", "entity", "relation", "fact", "insight", "candidate"]),
      targetId: z.string().min(1), payload: z.record(z.unknown()).default({}),
    }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: "invalid_knowledge_feedback", issues: body.error.flatten() });
    try {
      return await recordKnowledgeFeedback({ clientId: clientId(request.headers), ...body.data });
    } catch (error) {
      return reply.status(409).send({ error: "feedback_could_not_be_applied", message: error instanceof Error ? error.message : String(error) });
    }
  });
};
