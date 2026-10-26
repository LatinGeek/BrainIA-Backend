import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { classifyEvent } from "../domain/classification.js";
import type { ClassifiedEvent, EventInput } from "../domain/event.js";
import { buildEntityDrafts, normalizeEntityValue } from "../domain/entities.js";
import { buildEventInterpretation } from "../domain/event-interpretation.js";
import {
  DECISION_POLICY_VERSION,
  isLowUtilityPromotion,
  isRedundantProviderOrHeadingConcept,
  isRejectedFinancialText,
  isSupportedAssociationRationale,
  type EvidenceItem,
} from "../domain/decision-policy.js";
import { semanticInstanceDraft, SEMANTIC_GOVERNANCE_VERSION, SEMANTIC_PROMPT_VERSION, categoryKeyForPath } from "../domain/ontology.js";
import { buildFinancialTransactionCandidate } from "../domain/financial-transactions.js";
import { preserveCorrectionOverlay } from "./correction-projection.js";
import {
  insertClassifiedEvent,
  loadRawEventById,
  loadStoredEventById,
  replaceClassificationFacts,
  replaceSemanticProjection,
  transitionEventProcessingStatus,
  updateClassifiedEventInterpretation,
} from "./event-repository.js";
import { correlateFinancialEventWithDb } from "./event-store.js";
import { deriveKnowledgeFacts } from "./knowledge-fact-repository.js";
import { pool, withTransaction } from "./postgres.js";
import { buildDeterministicSemanticDecision, buildModelSemanticDecision, isUninformativeEvent, type SemanticDecision } from "./semantic-enrichment.js";
import { persistSemanticDecision } from "./semantic-resolver.js";
import { ensureOntology } from "./semantic-repository.js";

type Queryable = Pick<typeof pool, "query">;

export type InterpretationGeneration = {
  id: string;
  label: string | null;
  status: "staging" | "staged" | "activating" | "active" | "superseded" | "rolled_back" | "failed";
  policyVersion: string;
  governanceVersion: string;
  promptVersion: string;
  previousGenerationId: string | null;
  cursorValue: string | null;
  requested: number;
  staged: number;
  blocked: number;
  failed: number;
  comparison: Record<string, unknown>;
  totals: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  stagedAt: string | null;
  activatedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type InterpretationSnapshot = {
  id: string;
  generationId: string;
  eventId: string;
  clientId: string | null;
  processingAllowed: boolean;
  privacyStatus: string | null;
  status: "staged" | "blocked" | "failed" | "applied" | "superseded";
  blockedReason: string | null;
  classification: Record<string, unknown>;
  semanticDecision: Record<string, unknown>;
  interpretation: Record<string, unknown>;
  verificationStatus: string;
  abstained: boolean;
  evidenceEventIds: string[];
  latencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
  appliedAt: string | null;
};

const generationColumns = `
  id, label, status, policy_version as "policyVersion", governance_version as "governanceVersion",
  prompt_version as "promptVersion", previous_generation_id as "previousGenerationId",
  cursor_value as "cursorValue", requested, staged, blocked, failed, comparison, totals,
  created_by as "createdBy", created_at as "createdAt", staged_at as "stagedAt",
  activated_at as "activatedAt", completed_at as "completedAt", updated_at as "updatedAt"
`;

const snapshotColumns = `
  id, generation_id as "generationId", event_id as "eventId", client_id as "clientId",
  processing_allowed as "processingAllowed", privacy_status as "privacyStatus", status,
  blocked_reason as "blockedReason", classification, semantic_decision as "semanticDecision",
  interpretation, verification_status as "verificationStatus", abstained,
  evidence_event_ids as "evidenceEventIds", latency_ms as "latencyMs", input_tokens as "inputTokens",
  output_tokens as "outputTokens", created_at as "createdAt", applied_at as "appliedAt"
`;

export async function createInterpretationGeneration(input: {
  label?: string | null;
  clientId?: string | null;
  createdBy?: string | null;
}) {
  const active = await pool.query<{ id: string }>(`select id from interpretation_generations where status = 'active' order by activated_at desc limit 1`);
  let requested = 0;
  if (input.clientId !== undefined && input.clientId !== null) {
    const count = await pool.query<{ count: string }>(`select count(*)::text as count from raw_events where client_id = $1`, [input.clientId]);
    requested = Number(count.rows[0]?.count ?? 0);
  } else {
    const count = await pool.query<{ count: string }>(`select count(*)::text as count from raw_events`);
    requested = Number(count.rows[0]?.count ?? 0);
  }
  const result = await pool.query<InterpretationGeneration>(`
    insert into interpretation_generations (id, label, status, policy_version, governance_version, prompt_version, requested, created_by)
    values ($1,$2,'staging',$3,$4,$5,$6,$7)
    returning ${generationColumns}
  `, [randomUUID(), input.label ?? null, DECISION_POLICY_VERSION, SEMANTIC_GOVERNANCE_VERSION, SEMANTIC_PROMPT_VERSION, requested, input.createdBy ?? null]);
  void active;
  return result.rows[0]!;
}

export async function getInterpretationGeneration(id: string) {
  const result = await pool.query<InterpretationGeneration>(`select ${generationColumns} from interpretation_generations where id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function listInterpretationGenerations(limit = 20) {
  const result = await pool.query<InterpretationGeneration>(`select ${generationColumns} from interpretation_generations order by created_at desc limit $1`, [Math.min(100, Math.max(1, limit))]);
  return result.rows;
}

export async function currentInterpretationGeneration() {
  const result = await pool.query<{ activeGenerationId: string | null; mode: string; updatedAt: string }>(`
    select active_generation_id as "activeGenerationId", mode, updated_at as "updatedAt"
    from interpretation_generation_control where id = 1
  `);
  return result.rows[0] ?? { activeGenerationId: null, mode: "shadow", updatedAt: new Date().toISOString() };
}

function parseCursor(value: string | null) {
  if (!value) return null;
  const index = value.indexOf("|");
  if (index <= 0) return null;
  return { occurredAt: value.slice(0, index), eventId: value.slice(index + 1) };
}

function formatCursor(occurredAt: string, eventId: string) {
  return `${occurredAt}|${eventId}`;
}

async function insertSnapshot(db: Queryable, input: Omit<InterpretationSnapshot, "id" | "createdAt" | "appliedAt">) {
  await db.query(`
    insert into event_interpretation_snapshots (
      id, generation_id, event_id, client_id, processing_allowed, privacy_status, status,
      blocked_reason, classification, semantic_decision, interpretation, verification_status,
      abstained, evidence_event_ids, latency_ms, input_tokens, output_tokens
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14::jsonb,$15,$16,$17)
    on conflict (generation_id, event_id) do nothing
  `, [
    randomUUID(), input.generationId, input.eventId, input.clientId, input.processingAllowed,
    input.privacyStatus, input.status, input.blockedReason, JSON.stringify(input.classification),
    JSON.stringify(input.semanticDecision), JSON.stringify(input.interpretation), input.verificationStatus,
    input.abstained, JSON.stringify(input.evidenceEventIds), input.latencyMs, input.inputTokens,
    input.outputTokens,
  ]);
}

function classificationSnapshot(classified: ClassifiedEvent) {
  const metadata = classified.modelMetadata ?? {};
  return {
    inferredKind: classified.inferredKind,
    confidence: classified.confidence,
    classificationVersion: classified.classificationVersion,
    entities: classified.entities,
    modelMetadata: {
      provider: typeof metadata.provider === "string" ? metadata.provider : null,
      model: typeof metadata.model === "string" ? metadata.model : null,
      applied: metadata.applied === true,
      reason: typeof metadata.reason === "string" ? metadata.reason : null,
      verification: metadata.verification ?? null,
      jevVerification: metadata.jevVerification ?? null,
      correctionIds: Array.isArray(metadata.correctionIds) ? metadata.correctionIds : [],
    },
  };
}

function evidenceEventIds(decision: SemanticDecision) {
  return [...new Set((decision.evidence ?? []).map((item) => item.eventId).filter((id): id is string => Boolean(id)))];
}

async function stageOneEvent(input: {
  generationId: string;
  eventId: string;
  clientId?: string | null;
}) {
  const startedAt = Date.now();
  const raw = await loadRawEventById(pool, input.eventId);
  if (!raw) {
    await insertSnapshot(pool, {
      generationId: input.generationId, eventId: input.eventId, clientId: input.clientId ?? null,
      processingAllowed: false, privacyStatus: null, status: "failed",
      blockedReason: "event_not_found", classification: {}, semanticDecision: {}, interpretation: {},
      verificationStatus: "not_required", abstained: true, evidenceEventIds: [], latencyMs: 0,
      inputTokens: 0, outputTokens: 0,
    });
    return { status: "failed" as const };
  }
  if (input.clientId !== undefined && input.clientId !== null && raw.clientId !== input.clientId) {
    return { status: "skipped" as const };
  }
  const allowed = raw.processingAllowed && raw.privacyStatus !== "hidden";
  if (!allowed) {
    await insertSnapshot(pool, {
      generationId: input.generationId, eventId: raw.id, clientId: raw.clientId,
      processingAllowed: raw.processingAllowed, privacyStatus: raw.privacyStatus, status: "blocked",
      blockedReason: !raw.processingAllowed ? "processing_disabled" : "privacy_hidden",
      classification: {}, semanticDecision: {}, interpretation: {},
      verificationStatus: "not_required", abstained: true, evidenceEventIds: [], latencyMs: 0,
      inputTokens: 0, outputTokens: 0,
    });
    return { status: "blocked" as const };
  }
  try {
    const stored = await loadStoredEventById(pool, raw.id);
    let classified: ClassifiedEvent = stored?.classificationVersion && stored.inferredKind
      ? {
          ...raw,
          classificationVersion: stored.classificationVersion,
          inferredKind: stored.inferredKind,
          confidence: stored.confidence ?? 0,
          entities: stored.classifiedEntities ?? [],
          modelMetadata: stored.modelMetadata ?? null,
        }
      : { ...raw, ...classifyEvent(raw as EventInput), raw: raw.raw };
    classified = await preserveCorrectionOverlay(pool, raw.id, classified);
    let entityDrafts = buildEntityDrafts({ ...classified, raw: classified.raw });
    let instanceDraft = semanticInstanceDraft({
      eventId: raw.id,
      inferredKind: classified.inferredKind,
      source: raw.source,
      title: raw.title,
      body: raw.body,
      identity: {
        displayTitle: typeof classified.modelMetadata?.response === "object" && classified.modelMetadata.response
          ? (classified.modelMetadata.response as Record<string, unknown>).displayTitle as string | undefined
          : undefined,
        displayDescription: typeof classified.modelMetadata?.response === "object" && classified.modelMetadata.response
          ? (classified.modelMetadata.response as Record<string, unknown>).displayDescription as string | undefined
          : undefined,
      },
    });
    entityDrafts.push(instanceDraft);
    // Deterministic catalog evidence is stronger and cheaper than a fresh model
    // call. It is retained as valid deterministic processing; only events that
    // have no deterministic category go through the generative + verifier path.
    let semanticDecision = buildDeterministicSemanticDecision({
      entities: entityDrafts,
      source: raw.source,
      inferredKind: classified.inferredKind,
      title: raw.title,
      body: raw.body,
      status: "review",
    });
    if (!semanticDecision.paths.length) {
      if (isUninformativeEvent({ source: raw.source, title: raw.title, body: raw.body })) {
        semanticDecision = {
          ...semanticDecision,
          status: "unclassified",
          abstained: true,
          abstentionReason: "La notificación solo repite el nombre del proveedor o un encabezado genérico; no hay actividad que clasificar.",
        };
      } else if (isLowUtilityPromotion({ source: raw.source, title: raw.title, body: raw.body })) {
        semanticDecision = {
          ...semanticDecision,
          status: "unclassified",
          abstained: true,
          abstentionReason: "Es una comunicación promocional sin una compra, entrega, pago o cambio concreto; no se propone una categoría.",
        };
      } else {
        const humanContext = (() => {
          const metadata = classified.modelMetadata;
          if (!metadata) return undefined;
          const eventCategory = typeof metadata.eventCategory === "string" ? metadata.eventCategory : undefined;
          const explanation = typeof metadata.humanExplanation === "string" ? metadata.humanExplanation : undefined;
          return eventCategory || explanation ? { eventCategory, explanation } : undefined;
        })();
        semanticDecision = await buildModelSemanticDecision({
          entities: entityDrafts,
          source: raw.source,
          inferredKind: classified.inferredKind,
          title: raw.title,
          body: raw.body,
          clientId: raw.clientId,
          allowModel: raw.privacyStatus === "standard",
          auditEventId: raw.id,
          humanContext,
        });
      }
    }
    const financialCandidate = buildFinancialTransactionCandidate({
      event: raw,
      classified,
      entityDrafts,
      merchantEntity: null,
      amountEntity: null,
      observedAt: raw.timestamp ?? raw.rawEventCreatedAt,
    });
    const interpretation = buildEventInterpretation({
      event: raw,
      classified,
      decision: semanticDecision,
      eventIdentity: instanceDraft,
      financialCandidate,
    });
    await insertSnapshot(pool, {
      generationId: input.generationId,
      eventId: raw.id,
      clientId: raw.clientId,
      processingAllowed: true,
      privacyStatus: raw.privacyStatus,
      status: "staged",
      blockedReason: null,
      classification: classificationSnapshot(classified),
      semanticDecision: semanticDecision as unknown as Record<string, unknown>,
      interpretation: interpretation as unknown as Record<string, unknown>,
      verificationStatus: semanticDecision.verificationStatus ?? "not_required",
      abstained: Boolean(semanticDecision.abstained),
      evidenceEventIds: evidenceEventIds(semanticDecision),
      latencyMs: Date.now() - startedAt,
      inputTokens: 0,
      outputTokens: 0,
    });
    return { status: "staged" as const };
  } catch (error) {
    await insertSnapshot(pool, {
      generationId: input.generationId, eventId: raw.id, clientId: raw.clientId,
      processingAllowed: true, privacyStatus: raw.privacyStatus, status: "failed",
      blockedReason: error instanceof Error ? error.message.slice(0, 500) : "staging_failed",
      classification: {}, semanticDecision: {}, interpretation: {},
      verificationStatus: "not_required", abstained: true, evidenceEventIds: [],
      latencyMs: Date.now() - startedAt, inputTokens: 0, outputTokens: 0,
    });
    return { status: "failed" as const };
  }
}

async function refreshGenerationTotals(db: Queryable, generationId: string) {
  await db.query(`
    update interpretation_generations generation set
      staged = totals.staged, blocked = totals.blocked, failed = totals.failed, updated_at = now()
    from (
      select generation_id,
        count(*) filter (where status in ('staged','applied'))::int as staged,
        count(*) filter (where status = 'blocked')::int as blocked,
        count(*) filter (where status = 'failed')::int as failed
      from event_interpretation_snapshots where generation_id = $1 group by generation_id
    ) totals
    where generation.id = totals.generation_id
  `, [generationId]);
  await db.query(`
    update interpretation_generations generation set staged = 0, blocked = 0, failed = 0, updated_at = now()
    where generation.id = $1 and not exists (select 1 from event_interpretation_snapshots snapshot where snapshot.generation_id = $1)
  `, [generationId]);
}

export async function captureBaselineInterpretationGeneration(input: {
  label?: string | null;
  clientId?: string | null;
  createdBy?: string | null;
}) {
  const generation = await createInterpretationGeneration({ ...input, label: input.label ?? "pre-evidence baseline" });
  const clientFilter = input.clientId !== undefined && input.clientId !== null;
  const rows = await pool.query<{
    id: string; clientId: string | null; inferredKind: string | null; confidence: number | null;
    classificationVersion: string | null; entities: unknown; modelMetadata: unknown;
    displayTitle: string | null; displayDescription: string | null; interpretationStatus: string | null;
    interpretationSource: string | null; interpretationConfidence: number | null;
    interpretationModel: string | null; interpretationPromptVersion: string | null;
    interpretationFailureReason: string | null; decision: Record<string, unknown> | null;
    verificationStatus: string | null;
  }>(`
    select event.id, event.client_id as "clientId", classified.inferred_kind as "inferredKind",
      classified.confidence::float8, classified.classification_version as "classificationVersion",
      classified.entities, classified.model_metadata as "modelMetadata",
      classified.display_title as "displayTitle", classified.display_description as "displayDescription",
      classified.interpretation_status as "interpretationStatus", classified.interpretation_source as "interpretationSource",
      classified.interpretation_confidence as "interpretationConfidence", classified.interpretation_model as "interpretationModel",
      classified.interpretation_prompt_version as "interpretationPromptVersion",
      classified.interpretation_failure_reason as "interpretationFailureReason",
      decision.decision, decision.verification_status as "verificationStatus"
    from raw_events event
    left join classified_events classified on classified.raw_event_id = event.id
    left join semantic_event_decisions decision on decision.event_id = event.id
    where (${clientFilter ? "event.client_id = $1" : "true"})
    order by event.created_at, event.id
  `, clientFilter ? [input.clientId] : []);
  let staged = 0;
  let blocked = 0;
  for (const row of rows.rows) {
    const classification = row.classificationVersion ? {
      inferredKind: row.inferredKind,
      confidence: row.confidence,
      classificationVersion: row.classificationVersion,
      entities: row.entities ?? [],
      modelMetadata: row.modelMetadata ?? {},
    } : {};
    const semanticDecision = row.decision && Object.keys(row.decision).length
      ? row.decision
      : { paths: [], associations: [], abstained: true, abstentionReason: "Línea base sin decisión semántica previa." };
    await insertSnapshot(pool, {
      generationId: generation.id, eventId: row.id, clientId: row.clientId,
      processingAllowed: true, privacyStatus: "standard",
      status: row.classificationVersion ? "staged" : "blocked",
      blockedReason: row.classificationVersion ? null : "baseline_without_classification",
      classification, semanticDecision,
      interpretation: {
        displayTitle: row.displayTitle,
        displayDescription: row.displayDescription,
        status: row.interpretationStatus ?? "unclassified",
        source: row.interpretationSource ?? "structural",
        confidence: row.interpretationConfidence,
        model: row.interpretationModel ?? "structural",
        promptVersion: row.interpretationPromptVersion ?? SEMANTIC_PROMPT_VERSION,
        failureReason: row.interpretationFailureReason,
      },
      verificationStatus: row.verificationStatus ?? "not_required",
      abstained: !row.decision || (Array.isArray(row.decision.paths) && row.decision.paths.length === 0),
      evidenceEventIds: [row.id],
      latencyMs: 0, inputTokens: 0, outputTokens: 0,
    });
    if (row.classificationVersion) staged += 1; else blocked += 1;
  }
  await pool.query(`
    update interpretation_generations set status = 'active', staged = $2, blocked = $3,
      staged_at = now(), activated_at = now(), completed_at = now(), updated_at = now()
    where id = $1
  `, [generation.id, staged, blocked]);
  await pool.query(`update interpretation_generation_control set active_generation_id = $1, updated_at = now() where id = 1`, [generation.id]);
  return { ...(await getInterpretationGeneration(generation.id))!, staged, blocked };
}

export async function stageInterpretationGeneration(generationId: string, input: {
  batchSize?: number;
  maxEvents?: number;
  clientId?: string | null;
  concurrency?: number;
  shardIndex?: number;
  shardCount?: number;
} = {}) {
  const generation = await getInterpretationGeneration(generationId);
  if (!generation) throw new Error("interpretation_generation_not_found");
  if (!["staging", "staged"].includes(generation.status)) throw new Error("interpretation_generation_not_stageable");
  const batchSize = Math.min(100, Math.max(1, input.batchSize ?? 10));
  const concurrency = Math.min(8, Math.max(1, input.concurrency ?? 2));
  const shardCount = Math.max(1, Math.trunc(input.shardCount ?? 1));
  const shardIndex = Math.max(0, Math.min(shardCount - 1, Math.trunc(input.shardIndex ?? 0)));
  const maxEvents = input.maxEvents && input.maxEvents > 0 ? input.maxEvents : Number.POSITIVE_INFINITY;
  let processed = 0;
  let cursor = shardCount > 1 ? null : parseCursor(generation.cursorValue);
  while (processed < maxEvents) {
    const clientFilter = input.clientId !== undefined && input.clientId !== null;
    const params: Array<unknown> = [generationId];
    let where = "true";
    if (clientFilter) {
      params.push(input.clientId);
      where = `event.client_id = $${params.length}`;
    }
    if (shardCount > 1) {
      params.push(shardCount);
      const shardCountParam = params.length;
      params.push(shardIndex);
      const shardIndexParam = params.length;
      where = `${where} and mod(abs(hashtext(event.id)::bigint), $${shardCountParam}::bigint) = $${shardIndexParam}::bigint`;
    }
    params.push(batchSize);
    const limitParam = params.length;
    let cursorClause = "";
    if (cursor) {
      params.push(cursor.occurredAt);
      const cursorTimeParam = params.length;
      params.push(cursor.eventId);
      const cursorIdParam = params.length;
      cursorClause = `and (coalesce(event.timestamp, event.created_at), event.id) > ($${cursorTimeParam}::timestamptz, $${cursorIdParam})`;
    }
    const rows = await pool.query<{ id: string; occurredAt: string }>(`
      select event.id, coalesce(event.timestamp, event.created_at)::text as "occurredAt"
      from raw_events event
      where (${where})
        and not exists (
          select 1 from event_interpretation_snapshots snapshot
          where snapshot.generation_id = $1 and snapshot.event_id = event.id
        )
        ${cursorClause}
      order by coalesce(event.timestamp, event.created_at), event.id
      limit $${limitParam}
    `, params);
    if (!rows.rows.length) break;
    for (let index = 0; index < rows.rows.length; index += concurrency) {
      const batch = rows.rows.slice(index, index + concurrency);
      const results = await Promise.allSettled(batch.map((row) => stageOneEvent({
        generationId,
        eventId: row.id,
        clientId: input.clientId,
      })));
      for (const result of results) {
        processed += 1;
        if (result.status === "rejected") continue;
      }
    }
    const last = rows.rows.at(-1)!;
    cursor = { occurredAt: last.occurredAt, eventId: last.id };
    if (shardCount === 1) {
      await pool.query(`update interpretation_generations set cursor_value = $2, updated_at = now() where id = $1`, [generationId, formatCursor(cursor.occurredAt, cursor.eventId)]);
    }
    await refreshGenerationTotals(pool, generationId);
  }
  await refreshGenerationTotals(pool, generationId);
  const remainingParams: Array<unknown> = [generationId];
  const remainingClientClause = input.clientId !== undefined && input.clientId !== null
    ? `and event.client_id = $${remainingParams.push(input.clientId)}`
    : "";
  const shardClause = shardCount > 1
    ? `and mod(abs(hashtext(event.id)::bigint), ${shardCount}::bigint) = ${shardIndex}::bigint`
    : "";
  const remaining = await pool.query<{ count: string }>(`
    select count(*)::text as count from raw_events event
    where true ${remainingClientClause} ${shardClause}
      and not exists (select 1 from event_interpretation_snapshots snapshot where snapshot.generation_id = $1 and snapshot.event_id = event.id)
  `, remainingParams);
  if (Number(remaining.rows[0]?.count ?? 0) === 0) {
    await pool.query(`update interpretation_generations set status = 'staged', staged_at = now(), updated_at = now() where id = $1 and status = 'staging'`, [generationId]);
  }
  return { generationId, processed, remaining: Number(remaining.rows[0]?.count ?? 0), generation: await getInterpretationGeneration(generationId) };
}

async function loadSnapshotsForComparison(db: Queryable, generationId: string, limit = 5000) {
  const result = await db.query<InterpretationSnapshot>(`select ${snapshotColumns} from event_interpretation_snapshots where generation_id = $1 order by created_at, event_id limit $2`, [generationId, limit]);
  return result.rows;
}

function decisionPathCount(decision: Record<string, unknown>, action: string) {
  const paths = Array.isArray(decision.paths) ? decision.paths : [];
  return paths.filter((path) => path && typeof path === "object" && (path as { action?: unknown }).action === action).length;
}

export async function compareInterpretationGeneration(generationId: string, input: { writeReport?: boolean; reportDir?: string } = {}) {
  const generation = await getInterpretationGeneration(generationId);
  if (!generation) throw new Error("interpretation_generation_not_found");
  const snapshots = await loadSnapshotsForComparison(pool, generationId);
  const ids = snapshots.map((snapshot) => snapshot.eventId);
  const current = ids.length
    ? await pool.query<{ eventId: string; inferredKind: string | null; primaryCategoryKey: string | null; processingStatus: string }>(`
        select event.id as "eventId", classified.inferred_kind as "inferredKind",
          decision.primary_category_key as "primaryCategoryKey", event.processing_status as "processingStatus"
        from raw_events event
        left join classified_events classified on classified.raw_event_id = event.id
        left join semantic_event_decisions decision on decision.event_id = event.id
        where event.id = any($1::text[])
      `, [ids])
    : { rows: [] as Array<{ eventId: string; inferredKind: string | null; primaryCategoryKey: string | null; processingStatus: string }> };
  const byId = new Map(current.rows.map((row) => [row.eventId, row]));
  const rawRows = ids.length
    ? await pool.query<{ id: string; source: string; title: string | null; body: string | null }>(`
        select id, source, title, body from raw_events where id = any($1::text[])
      `, [ids])
    : { rows: [] as Array<{ id: string; source: string; title: string | null; body: string | null }> };
  const rawById = new Map(rawRows.rows.map((row) => [row.id, { ...row, contractVersion: 1, kind: "notification", raw: {}, tags: [] } as unknown as EventInput]));
  const counts = {
    requested: generation.requested,
    snapshots: snapshots.length,
    staged: snapshots.filter((snapshot) => snapshot.status === "staged" || snapshot.status === "applied").length,
    applied: snapshots.filter((snapshot) => snapshot.status === "applied").length,
    blocked: snapshots.filter((snapshot) => snapshot.status === "blocked").length,
    failed: snapshots.filter((snapshot) => snapshot.status === "failed").length,
    abstentions: 0,
    verification: {
      verified: snapshots.filter((snapshot) => snapshot.verificationStatus === "verified").length,
      rejected: snapshots.filter((snapshot) => snapshot.verificationStatus === "rejected").length,
      unavailable: snapshots.filter((snapshot) => snapshot.verificationStatus === "unavailable").length,
      not_required: snapshots.filter((snapshot) => snapshot.verificationStatus === "not_required").length,
    },
    changedClassifications: 0,
    changedPrimaryCategories: 0,
    proposedConcepts: 0,
    proposedAssociations: 0,
    removedMachineProposals: 0,
    revalidationDroppedPaths: 0,
    latencyMs: snapshots.reduce((sum, snapshot) => sum + (snapshot.latencyMs ?? 0), 0),
    inputTokens: 0,
    outputTokens: 0,
  };
  const samples: Array<Record<string, unknown>> = [];
  for (const snapshot of snapshots) {
    const was = byId.get(snapshot.eventId);
    const classification = snapshot.classification as { inferredKind?: string };
    const raw = rawById.get(snapshot.eventId);
    const effective = raw
      ? revalidateSnapshotDecision(snapshot.semanticDecision as unknown as SemanticDecision, raw)
      : snapshot.semanticDecision as unknown as SemanticDecision;
    const originalPaths = Array.isArray((snapshot.semanticDecision as { paths?: unknown[] }).paths)
      ? (snapshot.semanticDecision as { paths: unknown[] }).paths.length
      : 0;
    counts.revalidationDroppedPaths += Math.max(0, originalPaths - (effective.paths?.length ?? 0));
    const abstained = Boolean(effective.abstained ?? snapshot.abstained);
    const changedKind = Boolean(was && classification.inferredKind && was.inferredKind !== classification.inferredKind);
    const changedCategory = Boolean(was && (effective.primaryCategoryKey ?? null) !== (was.primaryCategoryKey ?? null));
    counts.changedClassifications += changedKind ? 1 : 0;
    counts.changedPrimaryCategories += changedCategory ? 1 : 0;
    counts.abstentions += abstained ? 1 : 0;
    counts.proposedConcepts += (effective.paths ?? []).filter((path) => path.action === "create").length;
    counts.proposedAssociations += effective.associations?.length ?? 0;
    if ((changedKind || changedCategory || abstained) && samples.length < 25) {
      samples.push({
        eventId: snapshot.eventId,
        before: was ? { inferredKind: was.inferredKind, primaryCategoryKey: was.primaryCategoryKey, processingStatus: was.processingStatus } : null,
        after: {
          inferredKind: classification.inferredKind ?? null,
          primaryCategoryKey: effective.primaryCategoryKey ?? null,
          abstained,
          verificationStatus: snapshot.verificationStatus,
        },
        blockedReason: snapshot.blockedReason,
      });
    }
  }
  if (ids.length) {
    const removed = await pool.query<{ count: string }>(`
      select count(*)::text as count from semantic_candidates
      where event_id = any($1::text[]) and status = 'pending'
    `, [ids]);
    counts.removedMachineProposals = Number(removed.rows[0]?.count ?? 0);
  }
  const verificationTotals = await pool.query<{ inputTokens: string; outputTokens: string; latencyMs: string }>(`
    select coalesce(sum(input_tokens),0)::text as "inputTokens",
      coalesce(sum(output_tokens),0)::text as "outputTokens",
      coalesce(sum(latency_ms),0)::text as "latencyMs"
    from decision_verifications
    where created_at >= $1
  `, [generation.createdAt]);
  counts.inputTokens = Number(verificationTotals.rows[0]?.inputTokens ?? 0);
  counts.outputTokens = Number(verificationTotals.rows[0]?.outputTokens ?? 0);
  const comparison = {
    generationId,
    generatedAt: new Date().toISOString(),
    policyVersion: generation.policyVersion,
    governanceVersion: generation.governanceVersion,
    promptVersion: generation.promptVersion,
    counts,
    samples,
    limitations: [
      "Staged snapshots are computed decisions, not yet published graph rows.",
      "Latency and token totals include verifier calls recorded after generation creation; provider usage is estimated when unavailable.",
    ],
  };
  await pool.query(`update interpretation_generations set comparison = $2::jsonb, updated_at = now() where id = $1`, [generationId, JSON.stringify(comparison)]);
  if (input.writeReport !== false) {
    const dir = input.reportDir ?? resolve("output");
    try {
      await writeFile(resolve(dir, `evidence-generation-${generationId}.json`), `${JSON.stringify(comparison, null, 2)}\n`, "utf8");
      await writeFile(resolve(dir, `evidence-generation-${generationId}.md`), renderComparisonMarkdown(comparison), "utf8");
    } catch {
      // Report writing is operational convenience; comparison is already stored.
    }
  }
  return comparison;
}

function renderComparisonMarkdown(comparison: {
  generationId: string;
  generatedAt: string;
  policyVersion: string;
  counts: Record<string, unknown>;
  samples: Array<Record<string, unknown>>;
}) {
  const counts = comparison.counts as Record<string, number | Record<string, number>>;
  const verification = counts.verification as Record<string, number>;
  return [
    `# Evidence generation comparison`,
    ``,
    `- Generation: \`${comparison.generationId}\``,
    `- Generated: ${comparison.generatedAt}`,
    `- Policy: \`${comparison.policyVersion}\``,
    ``,
    `## Counts`,
    ``,
    `| Metric | Value |`,
    `| --- | ---: |`,
    `| Requested events | ${counts.requested} |`,
    `| Snapshots | ${counts.snapshots} |`,
    `| Staged | ${counts.staged} |`,
    `| Applied | ${counts.applied} |`,
    `| Blocked | ${counts.blocked} |`,
    `| Failed | ${counts.failed} |`,
    `| Abstentions | ${counts.abstentions} |`,
    `| Changed classifications | ${counts.changedClassifications} |`,
    `| Changed primary categories | ${counts.changedPrimaryCategories} |`,
    `| Proposed concepts | ${counts.proposedConcepts} |`,
    `| Proposed associations | ${counts.proposedAssociations} |`,
    `| Paths dropped by activation revalidation | ${counts.revalidationDroppedPaths ?? 0} |`,
    `| Existing pending machine proposals for these events | ${counts.removedMachineProposals} |`,
    `| Verifier verified | ${verification.verified} |`,
    `| Verifier rejected | ${verification.rejected} |`,
    `| Verifier unavailable | ${verification.unavailable} |`,
    `| Verification not required | ${verification.not_required} |`,
    `| Estimated input tokens | ${counts.inputTokens} |`,
    `| Estimated output tokens | ${counts.outputTokens} |`,
    `| Staging latency (ms) | ${counts.latencyMs} |`,
    ``,
    `## Samples`,
    ``,
    ...comparison.samples.map((sample) => `- \`${String(sample.eventId)}\`: ${JSON.stringify(sample.before)} → ${JSON.stringify(sample.after)}${sample.blockedReason ? ` (${String(sample.blockedReason)})` : ""}`),
    ``,
  ].join("\n");
}

async function hasHumanSemanticDecision(db: Queryable, eventId: string) {
  const result = await db.query(`
    select 1 from semantic_candidates
    where event_id = $1 and status = 'approved'
    union all
    select 1 from relations relation
    join event_relations link on link.relation_id = relation.id
    where link.event_id = $1
      and coalesce(relation.metadata ->> 'source', '') in ('semantic-review','user','manual')
    limit 1
  `, [eventId]);
  return result.rows.length > 0;
}

async function supersedeObsoleteMachineCandidates(db: Queryable, eventId: string, generationId: string) {
  await db.query(`
    update semantic_candidates old
    set status = 'superseded',
      superseded_by_candidate_id = (
        select replacement.id from semantic_candidates replacement
        where replacement.event_id = old.event_id
          and replacement.subject_entity_id is not distinct from old.subject_entity_id
          and replacement.target_normalized_value = old.target_normalized_value
          and replacement.relation_type = old.relation_type
          and replacement.status = 'pending'
          and replacement.generation_id = $2
        order by replacement.created_at desc limit 1
      ),
      updated_at = now()
    where old.event_id = $1 and old.status = 'pending'
      and old.generation_id is distinct from $2
  `, [eventId, generationId]);
}

/**
 * Activation revalidates the deterministic safety invariants that do not
 * depend on a model. This protects activations from snapshots produced by an
 * earlier build, and keeps the same guarantees when a policy is tightened.
 */
export function revalidateSnapshotDecision(decision: SemanticDecision, raw: EventInput): SemanticDecision {
  const verificationBlocked = ["rejected", "unavailable"].includes(decision.verificationStatus ?? "");
  const rejectedFinancial = isRejectedFinancialText({
    source: raw.source,
    title: raw.title,
    body: raw.body,
    entityValues: (decision.paths ?? []).map((path) => path.subject.value),
  });
  const paths = (decision.paths ?? []).filter((path) => {
    if (verificationBlocked) return false;
    const leaf = path.hierarchyPath.at(-1) ?? "";
    const proposed = path.action === "create" ? path.proposedChild?.value ?? leaf : leaf;
    if (rejectedFinancial && (
      (path.categoryKey ?? "").startsWith("finances.spending")
      || path.hierarchyPath.some((node) => /(?:spending|card purchases)/iu.test(node))
    )) {
      return false;
    }
    const messageText = normalizeEntityValue([raw.title, raw.body, path.subject.value].join(" "));
    if ((path.categoryKey ?? "").startsWith("finances.spending")
      && /(?:^|\b)(?:mensaje|message)(?:\b|$)/u.test(messageText)
      && !/(?:pagó|pagaste|gastaste|realizado|realizada|pago realizado)/u.test(messageText)) {
      return false;
    }
    if (isLowUtilityPromotion({ source: raw.source, title: raw.title, body: raw.body })) {
      return false;
    }
    if (isRedundantProviderOrHeadingConcept({
      proposedValue: proposed,
      source: raw.source,
      eventTitle: raw.title,
      subjectValue: path.subject.value,
      supportedNames: [],
    })) return false;
    if (path.subject.value && proposed
      && normalizeEntityValue(path.subject.value) === normalizeEntityValue(proposed)) return false;
    return true;
  });
  const associations = verificationBlocked ? [] : (decision.associations ?? []).filter((association) => {
    if (association.sourceNormalizedValue === association.targetNormalizedValue) return false;
    return isSupportedAssociationRationale(association.rationale);
  });
  const primary = paths.find((path) => path.role === "primary") ?? paths[0];
  const primaryCategoryKey = primary?.categoryKey ?? (primary ? categoryKeyForPath(primary.hierarchyPath) : null);
  return {
    ...decision,
    paths,
    associations,
    primaryCategoryKey: paths.length ? primaryCategoryKey ?? decision.primaryCategoryKey : null,
    secondaryCategoryKeys: paths.length
      ? [...new Set(paths.filter((path) => path.role === "secondary").map((path) => path.categoryKey ?? categoryKeyForPath(path.hierarchyPath)).filter((key): key is string => Boolean(key)))]
      : [],
    status: paths.length ? decision.status : "unclassified",
    abstained: paths.length === 0,
    abstentionReason: paths.length ? decision.abstentionReason ?? null : "La evidencia disponible no permite una decisión verificable y sin ambigüedad.",
  };
}

async function applyOneSnapshot(input: {  snapshot: InterpretationSnapshot;
  generation: InterpretationGeneration;
}) {
  const { snapshot, generation } = input;
  if (!["staged", "blocked"].includes(snapshot.status)) return { status: snapshot.status };
  return withTransaction(async (db) => {
    const raw = await loadRawEventById(db, snapshot.eventId);
    if (!raw) {
      await db.query(`update event_interpretation_snapshots set status = 'failed', blocked_reason = 'event_not_found', updated_at = now() where id = $1`, [snapshot.id]);
      return { status: "failed" as const };
    }
    if (!raw.processingAllowed || raw.privacyStatus === "hidden") {
      await db.query(`update event_interpretation_snapshots set status = 'blocked', blocked_reason = 'evidence_no_longer_available', updated_at = now() where id = $1`, [snapshot.id]);
      return { status: "blocked" as const };
    }
    const human = await hasHumanSemanticDecision(db, snapshot.eventId);
    const classification = snapshot.classification as {
      inferredKind?: string; confidence?: number; classificationVersion?: string;
      entities?: ClassifiedEvent["entities"]; modelMetadata?: Record<string, unknown>;
    };
    if (!classification.inferredKind || !classification.classificationVersion) {
      await db.query(`update event_interpretation_snapshots set status = 'failed', blocked_reason = 'missing_classification_snapshot', updated_at = now() where id = $1`, [snapshot.id]);
      return { status: "failed" as const };
    }
    const classified: ClassifiedEvent = {
      ...raw,
      inferredKind: classification.inferredKind as ClassifiedEvent["inferredKind"],
      confidence: Number(classification.confidence ?? 0),
      classificationVersion: classification.classificationVersion,
      entities: classification.entities ?? [],
      modelMetadata: classification.modelMetadata ?? null,
    };
    const currentClassification = await db.query<{ inferredKind: string | null; classificationVersion: string | null }>(`
      select inferred_kind as "inferredKind", classification_version as "classificationVersion"
      from classified_events where raw_event_id = $1 limit 1
    `, [raw.id]);
    const classificationChanged = currentClassification.rows[0]?.inferredKind !== classified.inferredKind
      || currentClassification.rows[0]?.classificationVersion !== classified.classificationVersion;
    await insertClassifiedEvent(db, classified, raw.id, raw.clientId);
    const entityDrafts = buildEntityDrafts({ ...classified, raw: classified.raw });
    await replaceClassificationFacts(db, {
      eventId: raw.id, clientId: raw.clientId,
      facts: deriveKnowledgeFacts({ event: raw, classified, entities: entityDrafts }),
    });
    await transitionEventProcessingStatus(db, { eventId: raw.id, toStatus: "classified", reason: `generation_${generation.id}_classification` });
    const interpretation = snapshot.interpretation as {
      displayTitle?: string | null; displayDescription?: string | null; status?: string; source?: string;
      confidence?: number | null; model?: string; promptVersion?: string; failureReason?: string | null;
    };
    if (interpretation.status) {
      await updateClassifiedEventInterpretation(db, raw.id, {
        displayTitle: interpretation.displayTitle ?? null,
        displayDescription: interpretation.displayDescription ?? null,
        status: interpretation.status,
        source: interpretation.source ?? "structural",
        confidence: interpretation.confidence ?? null,
        model: interpretation.model ?? "structural",
        promptVersion: interpretation.promptVersion ?? SEMANTIC_PROMPT_VERSION,
        failureReason: interpretation.failureReason ?? null,
      });
    }
    if (!human) {
      const decision = revalidateSnapshotDecision(snapshot.semanticDecision as unknown as SemanticDecision, raw);
      if (!decision.paths.length) {
        await db.query(`update event_interpretation_snapshots set status = 'blocked', blocked_reason = 'activation_revalidation_abstained', semantic_decision = $2::jsonb, updated_at = now() where id = $1`, [snapshot.id, JSON.stringify(decision)]);
        return { status: "blocked" as const };
      }
      const drafts = [...entityDrafts, semanticInstanceDraft({
        eventId: raw.id, inferredKind: classified.inferredKind, source: raw.source, title: raw.title, body: raw.body,
      })];
      await db.query(`delete from semantic_candidates where event_id = $1 and status = 'pending'`, [raw.id]);
      await db.query(`delete from semantic_observations where event_id = $1`, [raw.id]);
      await db.query(`delete from event_semantic_anchors where event_id = $1`, [raw.id]);
      await persistSemanticDecision(db, {
        eventId: raw.id, clientId: raw.clientId, drafts,
        decision: { ...decision, generationId: generation.id } as SemanticDecision & { generationId: string },
      });
      await supersedeObsoleteMachineCandidates(db, raw.id, generation.id);
    }
    if (classificationChanged) {
      await correlateFinancialEventWithDb(db, raw.id).catch(() => undefined);
    }
    await db.query(`update event_interpretation_snapshots set status = $2, blocked_reason = $3, applied_at = now(), updated_at = now() where id = $1`, [
      snapshot.id,
      human ? "blocked" : "applied",
      human ? "human_semantic_decision_preserved" : null,
    ]);
    return { status: human ? "blocked" as const : "applied" as const };
  });
}

export async function activateInterpretationGeneration(generationId: string, input: {
  batchSize?: number;
  maxEvents?: number;
  concurrency?: number;
  shardIndex?: number;
  shardCount?: number;
} = {}) {
  const generation = await getInterpretationGeneration(generationId);
  if (!generation) throw new Error("interpretation_generation_not_found");
  if (generation.status === "active") return { generation, applied: 0, blocked: 0, failed: 0 };
  if (!["staged", "activating", "failed"].includes(generation.status)) throw new Error("interpretation_generation_not_activatable");
  const comparison = generation.comparison as { counts?: { failed?: number; snapshots?: number } };
  if (!comparison?.counts?.snapshots) await compareInterpretationGeneration(generationId, { writeReport: false });
  await pool.query(`update interpretation_generations set status = 'activating', updated_at = now() where id = $1`, [generationId]);
  const domainCount = await pool.query<{ count: string }>(`select count(*)::text as count from entities where type = 'domain'`);
  if (Number(domainCount.rows[0]?.count ?? 0) === 0) {
    const owners = await pool.query<{ clientId: string | null }>(`
      select distinct client_id as "clientId" from event_interpretation_snapshots
      where generation_id = $1 and status = 'staged'
    `, [generationId]);
    for (const owner of owners.rows) {
      await withTransaction((db) => ensureOntology(db, owner.clientId));
    }
  }
  const batchSize = Math.min(100, Math.max(1, input.batchSize ?? 25));
  const shardCount = Math.max(1, Math.trunc(input.shardCount ?? 1));
  const shardIndex = Math.max(0, Math.min(shardCount - 1, Math.trunc(input.shardIndex ?? 0)));
  const shardClause = shardCount > 1
    ? `and mod(abs(hashtext(event_id)::bigint), ${shardCount}::bigint) = ${shardIndex}::bigint`
    : "";
  const maxEvents = input.maxEvents && input.maxEvents > 0 ? input.maxEvents : Number.POSITIVE_INFINITY;
  let applied = 0;
  let blocked = 0;
  let failed = 0;
  let processed = 0;
  while (processed < maxEvents) {
    const rows = await pool.query<InterpretationSnapshot>(`
      select ${snapshotColumns} from event_interpretation_snapshots
      where generation_id = $1 and status = 'staged' ${shardClause}
      order by created_at, event_id limit $2
    `, [generationId, batchSize]);
    if (!rows.rows.length) break;
    const concurrency = Math.min(8, Math.max(1, input.concurrency ?? 1));
    for (let index = 0; index < rows.rows.length; index += concurrency) {
      const batch = rows.rows.slice(index, index + concurrency);
      const results = await Promise.allSettled(batch.map((snapshot) => applyOneSnapshot({ snapshot, generation })));
      for (const settled of results) {
        processed += 1;
        if (settled.status === "rejected") {
          failed += 1;
          continue;
        }
        if (settled.value.status === "applied") applied += 1;
        else if (settled.value.status === "blocked") blocked += 1;
        else if (settled.value.status === "failed") failed += 1;
      }
    }
  }
  const remaining = await pool.query<{ count: string }>(`
    select count(*)::text as count from event_interpretation_snapshots where generation_id = $1 and status = 'staged'
  `, [generationId]);
  if (Number(remaining.rows[0]?.count ?? 0) > 0) {
    return { generation: await getInterpretationGeneration(generationId), applied, blocked, failed, remaining: Number(remaining.rows[0]?.count ?? 0) };
  }
  const previous = await currentInterpretationGeneration();
  await withTransaction(async (db) => {
    if (previous.activeGenerationId && previous.activeGenerationId !== generationId) {
      await db.query(`update interpretation_generations set status = 'superseded', completed_at = now(), updated_at = now() where id = $1 and status = 'active'`, [previous.activeGenerationId]);
    }
    await db.query(`update interpretation_generations set status = 'active', previous_generation_id = $2, activated_at = now(), completed_at = now(), updated_at = now() where id = $1`, [generationId, previous.activeGenerationId]);
    await db.query(`update interpretation_generation_control set active_generation_id = $1, updated_at = now() where id = 1`, [generationId]);
  });
  await refreshGenerationTotals(pool, generationId);
  return { generation: await getInterpretationGeneration(generationId), applied, blocked, failed, remaining: 0 };
}

export async function rollbackInterpretationGeneration(input: { toGenerationId?: string } = {}) {
  const control = await currentInterpretationGeneration();
  if (!control.activeGenerationId) throw new Error("no_active_interpretation_generation");
  const targetId = input.toGenerationId ?? (await getInterpretationGeneration(control.activeGenerationId))?.previousGenerationId ?? null;
  if (!targetId) throw new Error("no_previous_interpretation_generation");
  const target = await getInterpretationGeneration(targetId);
  if (!target) throw new Error("rollback_generation_not_found");
  await pool.query(`update interpretation_generations set status = 'rolled_back', updated_at = now() where id = $1`, [control.activeGenerationId]);
  await pool.query(`update interpretation_generations set status = 'staged', activated_at = null, updated_at = now() where id = $1 and status in ('active','staged')`, [targetId]);
  return activateInterpretationGeneration(targetId);
}
