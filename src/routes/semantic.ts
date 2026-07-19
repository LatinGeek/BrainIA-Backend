import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CLIENT_ID_HEADER } from "../auth.js";
import { pool, withTransaction } from "../storage/postgres.js";
import { ensureOntology, listSemanticCandidates, resolveSemanticCandidate } from "../storage/semantic-repository.js";
import { listEvents, previewEventSemantics, reprocessEvent } from "../storage/event-store.js";
import { SEMANTIC_GOVERNANCE_VERSION } from "../domain/ontology.js";

function clientId(request: { headers: Record<string, string | string[] | undefined> }) {
  const value = request.headers[CLIENT_ID_HEADER];
  return (Array.isArray(value) ? value[0] : value)?.trim() || null;
}

export const registerSemanticRoutes: FastifyPluginAsync = async (app) => {
  app.post("/semantic/seed", async (request) => {
    const domains = await withTransaction((db) => ensureOntology(db, clientId(request)));
    return { domains };
  });

  app.post("/semantic/backfill", async (request, reply) => {
    const parsed = z.object({
      batchSize: z.coerce.number().int().min(1).max(100).default(25),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      cursor: z.string().min(1).optional(),
      dryRun: z.boolean().default(false),
      governanceVersion: z.literal(SEMANTIC_GOVERNANCE_VERSION).default(SEMANTIC_GOVERNANCE_VERSION),
    }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: "invalid_semantic_backfill" });
    const scope = clientId(request);
    const events = await listEvents();
    const scoped = events.filter((event) => scope === null || event.clientId === scope);
    const cursorIndex = parsed.data.cursor ? scoped.findIndex((event) => event.id === parsed.data.cursor) + 1 : 0;
    const selected = scoped.slice(Math.max(0, cursorIndex), Math.max(0, cursorIndex) + (parsed.data.limit ?? parsed.data.batchSize));
    const runId = randomUUID();
    await pool.query(`insert into semantic_backfill_runs (id, client_id, governance_version, dry_run, requested, cursor_value) values ($1,$2,$3,$4,$5,$6)`, [runId, scope, parsed.data.governanceVersion, parsed.data.dryRun, selected.length, parsed.data.cursor ?? null]);
    let processed = 0;
    const failed: Array<{ eventId: string; error: string }> = [];
    if (!parsed.data.dryRun) await withTransaction((db) => ensureOntology(db, scope));
    for (const event of selected) {
      try {
        const result = parsed.data.dryRun ? await previewEventSemantics(event.id) : await reprocessEvent(event.id, { ensureOntology: false });
        if (result) processed += 1;
      } catch (error) {
        failed.push({ eventId: event.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const nextCursor = selected.at(-1)?.id ?? parsed.data.cursor ?? null;
    const report = { requested: selected.length, processed, failed, nextCursor, remainingHint: Math.max(0, scoped.length - cursorIndex - selected.length) };
    await pool.query(`update semantic_backfill_runs set processed = $2, failed = $3, cursor_value = $4, report = $5::jsonb, completed_at = now() where id = $1`, [runId, processed, failed.length, nextCursor, JSON.stringify(report)]);
    return { runId, dryRun: parsed.data.dryRun, governanceVersion: parsed.data.governanceVersion, ...report };
  });

  app.get("/semantic/candidates", async (request, reply) => {
    const parsed = z.object({ status: z.enum(["pending", "approved", "rejected"]).default("pending") }).safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_semantic_candidate_query", issues: parsed.error.flatten() });
    return { items: await listSemanticCandidates(pool, clientId(request), parsed.data.status) };
  });

  app.post("/semantic/candidates/:id/resolve", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ action: z.enum(["approve", "reject"]), targetEntityId: z.string().min(1).optional(), createRule: z.boolean().default(true) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.status(400).send({ error: "invalid_semantic_resolution" });
    const candidate = await withTransaction((db) => resolveSemanticCandidate(db, params.data.id, body.data));
    return candidate ? candidate : reply.status(404).send({ error: "semantic_candidate_not_found" });
  });
};
