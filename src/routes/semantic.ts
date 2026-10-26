import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ownerScope } from "../auth.js";
import { pool, withTransaction } from "../storage/postgres.js";
import { ensureOntology, listSemanticCandidates, resolveSemanticCandidate, SemanticCandidateConflictError } from "../storage/semantic-repository.js";
import { listEvents, previewEventSemantics, reprocessEvent } from "../storage/event-store.js";
import { CATEGORY_CATALOG, SEMANTIC_GOVERNANCE_VERSION, TAXONOMY_VERSION } from "../domain/ontology.js";
import { reconcileSemanticGraph } from "../storage/semantic-reconciler.js";
import { isRuleEligibleAction, semanticActionKind, spanishChangeExplanation } from "../domain/decision-policy.js";
import { currentInterpretationGeneration, getInterpretationGeneration, listInterpretationGenerations } from "../storage/interpretation-generations.js";

function clientId(request: Parameters<typeof ownerScope>[0]) {
  return ownerScope(request) ?? null;
}

export const registerSemanticRoutes: FastifyPluginAsync = async (app) => {
  app.get("/semantic/generations", async () => ({
    control: await currentInterpretationGeneration(),
    items: await listInterpretationGenerations(10),
  }));

  app.get("/semantic/generations/:id", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "invalid_generation_id" });
    const generation = await getInterpretationGeneration(params.data.id);
    return generation ? generation : reply.status(404).send({ error: "interpretation_generation_not_found" });
  });

  app.get("/semantic/taxonomy", async () => ({
    version: TAXONOMY_VERSION,
    categories: CATEGORY_CATALOG.map((category) => ({
      key: category.key,
      label: category.label,
      description: category.description,
      parentKey: category.parentKey,
      level: category.level,
      kind: category.kind,
    })),
  }));

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
      reconcileAtEnd: z.boolean().default(true),
      governanceVersion: z.literal(SEMANTIC_GOVERNANCE_VERSION).default(SEMANTIC_GOVERNANCE_VERSION),
    }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: "invalid_semantic_backfill" });
    const scope = clientId(request);
    const events = await listEvents(scope ?? undefined);
    const scoped = scope === null ? events : events.filter((event) => event.clientId === scope);
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
    const remainingHint = Math.max(0, scoped.length - cursorIndex - selected.length);
    const reconciliation = !parsed.data.dryRun && parsed.data.reconcileAtEnd && remainingHint === 0 && failed.length === 0
      ? await reconcileSemanticGraph()
      : { status: parsed.data.dryRun ? "preview_skipped" : failed.length > 0 ? "awaiting_failed_event_retry" : remainingHint > 0 ? "awaiting_final_batch" : "skipped" };
    const report = { requested: selected.length, processed, failed, nextCursor, remainingHint, reconciliation };
    await pool.query(`update semantic_backfill_runs set processed = $2, failed = $3, cursor_value = $4, report = $5::jsonb, completed_at = now() where id = $1`, [runId, processed, failed.length, nextCursor, JSON.stringify(report)]);
    return { runId, dryRun: parsed.data.dryRun, governanceVersion: parsed.data.governanceVersion, ...report };
  });

  app.get("/semantic/candidates", async (request, reply) => {
    const parsed = z.object({ status: z.enum(["pending", "approved", "rejected", "superseded"]).default("pending") }).safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_semantic_candidate_query", issues: parsed.error.flatten() });
    const items = await listSemanticCandidates(pool, clientId(request), parsed.data.status);
    return {
      items: items.map((candidate) => {
        const actionKind = (candidate.actionKind as ReturnType<typeof semanticActionKind> | null)
          ?? semanticActionKind({ decisionKind: candidate.decisionKind, subjectType: candidate.subjectType, targetType: candidate.targetType });
        const subjectKind = ["activity_instance", "financial_event", "email_message"].includes(candidate.subjectType ?? "")
          ? "event" as const
          : "identity" as const;
        const targetKind = ["domain", "concept"].includes(candidate.targetType) ? "category" as const : "identity" as const;
        const evidence = Array.isArray(candidate.evidence) ? candidate.evidence : [];
        const verifiedEventCount = candidate.verifiedEventCount
          ?? (Array.isArray(candidate.evidenceEventIds) ? candidate.evidenceEventIds.length : 0);
        const ruleEligible = isRuleEligibleAction({
          actionKind,
          decisionKind: candidate.decisionKind,
          relationType: candidate.relationType,
          subjectType: candidate.subjectType,
        });
        return {
          ...candidate,
          // Internal model scores remain available for audit, but clients must
          // not present them as human confidence.
          actionKind,
          endpoints: {
            subject: {
              id: candidate.subjectEntityId ?? undefined,
              canonicalId: candidate.subjectEntityId ?? undefined,
              type: candidate.subjectType ?? undefined,
              label: candidate.subjectValue ?? undefined,
              kind: subjectKind,
            },
            target: {
              id: candidate.targetEntityId ?? undefined,
              canonicalId: candidate.targetEntityId ?? undefined,
              type: candidate.targetType,
              label: candidate.targetValue,
              kind: targetKind,
            },
          },
          evidence: evidence.slice(0, 5),
          verifiedEventCount,
          verificationStatus: candidate.verificationStatus ?? "not_required",
          changeExplanation: candidate.changeExplanation
            ?? spanishChangeExplanation({
              actionKind,
              subjectLabel: candidate.subjectValue ?? "esta actividad",
              targetLabel: candidate.targetValue,
              relationType: candidate.relationType,
              hierarchyPath: candidate.proposedPath,
              verifiedEventCount,
              isFinancial: candidate.subjectType === "financial_event",
            }),
          ruleEligible,
        };
      }),
    };
  });

  app.post("/semantic/candidates/:id/resolve", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({
      action: z.enum(["approve", "reject"]),
      targetEntityId: z.string().min(1).optional(),
      createRule: z.boolean().default(false),
      reason: z.string().min(1).max(500).optional(),
      expectedPolicyVersion: z.string().min(1).max(80).optional(),
    }).safeParse(request.body);
    if (!params.success || !body.success) return reply.status(400).send({ error: "invalid_semantic_resolution" });
    try {
      const candidate = await withTransaction((db) => resolveSemanticCandidate(db, params.data.id, {
        ...body.data,
        clientId: clientId(request),
      }));
      return candidate ? candidate : reply.status(404).send({ error: "semantic_candidate_not_found" });
    } catch (error) {
      if (error instanceof SemanticCandidateConflictError) {
        return reply.status(409).send(error.toResponse());
      }
      throw error;
    }
  });
};
