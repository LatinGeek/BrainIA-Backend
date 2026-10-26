import { randomUUID } from "node:crypto";
import type { EntityDraft } from "../domain/entities.js";
import { normalizeEntityValue } from "../domain/entities.js";
import {
  AUTO_APPLY_CONFIDENCE,
  NEW_NODE_OBSERVATION_CONFIDENCE,
  PRIMARY_ROOT_CONFIDENCE,
  SEMANTIC_GOVERNANCE_VERSION,
  SEMANTIC_PROMPT_VERSION,
} from "../domain/ontology.js";
import type { SemanticDecision, SemanticPathDecision } from "./semantic-enrichment.js";
import { buildModelSemanticDecision, SEMANTIC_SUBJECT_TYPES } from "./semantic-enrichment.js";
import {
  DECISION_POLICY_VERSION,
  semanticActionKind,
  semanticDecisionFingerprint,
  spanishChangeExplanation,
} from "../domain/decision-policy.js";
import { upsertEntity } from "./entity-repository.js";
import { linkEventRelation } from "./relation-repository.js";
import {
  applySemanticRules,
  enqueueSemanticCandidate,
  rootEventEvidenceFromAnchors,
  settleSatisfiedSemanticCandidates,
  setImmediateHierarchyParent,
  upsertEventSemanticAnchor,
} from "./semantic-repository.js";
import { pool } from "./postgres.js";

type Queryable = Pick<typeof pool, "query">;
type StoredEntity = { id: string; type: string; value: string; normalizedValue: string };

async function findCanonicalEntity(db: Queryable, normalizedValue: string, allowedTypes?: string[]): Promise<StoredEntity | null> {
  const result = await db.query<StoredEntity>(`
    select canonical.id, canonical.type, canonical.value, canonical.normalized_value as "normalizedValue"
    from entities matched
    left join entity_merges merged on merged.alias_entity_id = matched.id
    join entities canonical on canonical.id = coalesce(merged.canonical_entity_id, matched.id)
    where matched.normalized_value = $1 and ($2::text[] is null or canonical.type = any($2::text[]))
    order by case canonical.type when 'domain' then 0 when 'concept' then 1 else 2 end, canonical.created_at asc limit 1
  `, [normalizeEntityValue(normalizedValue), allowedTypes ?? null]);
  return result.rows[0] ?? null;
}

async function findHierarchyRoot(db: Queryable, entityId: string) {
  const result = await db.query<{ id: string }>(`
    with recursive ancestors(id, type) as (
      select e.id, e.type from entities e where e.id = $1
      union
      select parent.id, parent.type from ancestors child join relations r on r.source_entity_id = child.id
        and r.relation_type in ('part_of', 'belongs_to_domain') join entities parent on parent.id = r.target_entity_id
    ) select id from ancestors where type = 'domain' limit 1
  `, [entityId]);
  return result.rows[0]?.id ?? null;
}

async function findImmediateHierarchyParent(db: Queryable, entityId: string): Promise<StoredEntity | null> {
  const result = await db.query<StoredEntity>(`
    select parent.id, parent.type, parent.value, parent.normalized_value as "normalizedValue"
    from relations relation join entities parent on parent.id = relation.target_entity_id
    where relation.source_entity_id = $1 and relation.relation_type in ('part_of', 'belongs_to_domain')
    order by relation.confidence desc, relation.created_at desc limit 1
  `, [entityId]);
  return result.rows[0] ?? null;
}

async function isHierarchyAncestor(db: Queryable, ancestorId: string, descendantId: string) {
  if (ancestorId === descendantId) return true;
  const result = await db.query<{ matches: boolean }>(`
    with recursive ancestors(entity_id) as (
      select target_entity_id from relations
      where source_entity_id = $1 and relation_type in ('part_of', 'belongs_to_domain')
      union
      select relation.target_entity_id from ancestors current
      join relations relation on relation.source_entity_id = current.entity_id
      where relation.relation_type in ('part_of', 'belongs_to_domain')
    ) select exists(select 1 from ancestors where entity_id = $2) as matches
  `, [descendantId, ancestorId]);
  return result.rows[0]?.matches ?? false;
}

function identityStem(value: string) {
  return normalizeEntityValue(value).replace(/\s+(app|application|merchant|provider|service)$/u, "").trim();
}

export function isSemanticRestatement(value: string, parentValue: string) {
  const valueNormalized = normalizeEntityValue(value);
  const parentNormalized = normalizeEntityValue(parentValue);
  return valueNormalized === parentNormalized
    || valueNormalized.includes(parentNormalized)
    || parentNormalized.includes(valueNormalized);
}

async function recordDecision(db: Queryable, input: { eventId: string; clientId: string | null; decision: SemanticDecision }) {
  const primary = input.decision.paths.find((path) => path.role === "primary");
  await db.query(`
    insert into semantic_event_decisions (event_id, client_id, status, primary_domain_value, decision, governance_version, prompt_version, model, taxonomy_version, primary_category_key, secondary_category_keys, facets, verification_status, verification, policy_version, abstained, abstention_reason, evidence_fingerprint, generation_id)
    values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14::jsonb,$15,$16,$17,$18,$19)
    on conflict (event_id) do update set client_id = excluded.client_id, status = excluded.status,
      primary_domain_value = excluded.primary_domain_value, decision = excluded.decision,
      governance_version = excluded.governance_version, prompt_version = excluded.prompt_version,
      model = excluded.model, taxonomy_version = excluded.taxonomy_version,
      primary_category_key = excluded.primary_category_key, secondary_category_keys = excluded.secondary_category_keys,
      facets = excluded.facets, verification_status = excluded.verification_status,
      verification = excluded.verification, policy_version = excluded.policy_version,
      abstained = excluded.abstained, abstention_reason = excluded.abstention_reason,
      evidence_fingerprint = excluded.evidence_fingerprint, generation_id = coalesce(excluded.generation_id, semantic_event_decisions.generation_id), updated_at = now()
  `, [
    input.eventId, input.clientId, input.decision.status, primary?.domain ?? null, JSON.stringify(input.decision),
    input.decision.governanceVersion, input.decision.promptVersion, input.decision.model, input.decision.taxonomyVersion,
    input.decision.primaryCategoryKey, input.decision.secondaryCategoryKeys, JSON.stringify(input.decision.facets),
    input.decision.verificationStatus ?? "not_required", JSON.stringify(input.decision.verification ?? {}),
    input.decision.policyVersion ?? DECISION_POLICY_VERSION,
    Boolean(input.decision.abstained), input.decision.abstentionReason ?? null,
    input.decision.evidenceFingerprint ?? null,
    (input.decision as SemanticDecision & { generationId?: string | null }).generationId ?? null,
  ]);
}

async function hasRejectedEquivalent(db: Queryable, input: {
  clientId: string | null;
  fingerprint: string;
}) {
  const result = await db.query(`select 1 from semantic_candidate_feedback
    where coalesce(client_id, '') = coalesce($1, '') and decision_fingerprint = $2 and reason = 'user_rejected' limit 1`,
  [input.clientId, input.fingerprint]);
  return result.rows.length > 0;
}

function candidateAlternatives(path: SemanticPathDecision) {
  return path.steps.flatMap((step) => step.alternatives.map((alternative) => ({ parent: step.parent, ...alternative })));
}

async function enqueuePathCandidate(db: Queryable, input: { eventId: string; clientId: string | null; subject: StoredEntity; path: SemanticPathDecision; targetValue: string; targetType?: string; relationType?: string; parentTargetValue?: string; recurrenceCount?: number; decision: SemanticDecision; forceReview?: boolean }) {
  const targetType = input.targetType ?? (input.path.hierarchyPath.length === 1 ? "domain" : "concept");
  const targetNormalizedValue = normalizeEntityValue(input.targetValue);
  // True self-links and no-effect changes never enter the review queue.
  if (input.subject.id && targetNormalizedValue === input.subject.normalizedValue && targetType === input.subject.type) return null;
  const existingTarget = await findCanonicalEntity(db, targetNormalizedValue, [targetType]);
  if (existingTarget?.id === input.subject.id) return null;
  const relationType = input.relationType ?? (input.path.hierarchyPath.length === 1 ? "belongs_to_domain" : "part_of");
  if (existingTarget && !input.forceReview) {
    const existingRelation = ["part_of", "belongs_to_domain"].includes(relationType)
      ? await db.query(`select 1 from relations where source_entity_id = $1 and target_entity_id = $2 and relation_type in ('part_of','belongs_to_domain') limit 1`, [input.subject.id, existingTarget.id])
      : await db.query(`select 1 from relations where source_entity_id = $1 and target_entity_id = $2 and relation_type = $3 limit 1`, [input.subject.id, existingTarget.id, relationType]);
    if (existingRelation.rows.length) return null;
  }
  const candidateEvidence = candidateEvidenceFor(input.decision, input.path);
  const declined = await hasRejectedEquivalent(db, { clientId: input.clientId, fingerprint: candidateEvidence.fingerprint });
  if (declined) return null;
  const actionKind = semanticActionKind({ decisionKind: input.path.action, subjectType: input.path.subject.type, targetType });
  const linkedEvents = await db.query<{ count: number }>(`
    select count(distinct event_id)::int as count from event_entities where entity_id = $1
  `, [input.subject.id]);
  const verifiedEventCount = Math.max(
    1,
    linkedEvents.rows[0]?.count ?? 0,
    candidateEvidence.verifiedEventIds.length,
  );
  const changeExplanation = spanishChangeExplanation({
    actionKind,
    subjectLabel: input.path.subject.value,
    targetLabel: input.targetValue,
    relationType,
    hierarchyPath: input.path.hierarchyPath,
    verifiedEventCount,
    isFinancial: input.path.subject.type === "financial_event",
  });
  return enqueueSemanticCandidate(db, {
    clientId: input.clientId, eventId: input.eventId, subjectEntityId: input.subject.id,
    relationType,
    targetType,
    targetValue: input.targetValue, targetNormalizedValue,
    parentTargetValue: input.parentTargetValue, confidence: input.path.confidence,
    rationale: input.path.rationale, extractor: "deepseek-v2", decisionKind: input.path.action,
    domainValue: input.path.domain, anchorRole: input.path.role, proposedPath: input.path.hierarchyPath,
    alternatives: candidateAlternatives(input.path), associations: input.decision.associations,
    recurrenceCount: input.recurrenceCount ?? 1, governanceVersion: input.decision.governanceVersion,
    promptVersion: input.decision.promptVersion, model: input.decision.model,
    actionKind,
    evidence: candidateEvidence.evidence,
    evidenceEventIds: candidateEvidence.verifiedEventIds,
    verifiedEventCount,
    verificationStatus: input.decision.verificationStatus ?? "not_required",
    verification: input.decision.verification ?? {},
    policyVersion: input.decision.policyVersion ?? DECISION_POLICY_VERSION,
    changeExplanation,
    decisionFingerprint: candidateEvidence.fingerprint,
    generationId: (input.decision as SemanticDecision & { generationId?: string | null }).generationId ?? null,
  });
}

function candidateEvidenceFor(decision: SemanticDecision, path: SemanticPathDecision) {
  const refs = new Set((path.evidence ?? []).map((reference) => reference.ref));
  const items = (decision.evidence ?? []).filter((item) => refs.has(item.ref));
  const verifiedEventIds = [...new Set(items.map((item) => item.eventId).filter((id): id is string => Boolean(id)))];
  return {
    evidence: items.map((item) => ({
      eventId: item.eventId ?? null,
      source: item.source ?? null,
      occurredAt: item.occurredAt ?? null,
      field: item.field ?? null,
      title: item.kind === "event_title" ? item.text.slice(0, 280) : null,
      excerpt: item.text.slice(0, 700),
      ref: item.ref,
      kind: item.kind,
    })),
    verifiedEventIds,
    fingerprint: semanticDecisionFingerprint({
      actionKind: semanticActionKind({ decisionKind: path.action, subjectType: path.subject.type }),
      subjectNormalizedValue: path.subject.normalizedValue,
      targetNormalizedValue: path.proposedChild?.value ?? path.hierarchyPath.at(-1) ?? path.mergeTargetNormalizedValue ?? "",
      evidenceRefs: [...refs],
    }),
  };
}

async function applyEventAnchor(
  db: Queryable,
  input: { eventId: string; clientId: string | null; path: SemanticPathDecision; decision: SemanticDecision },
  subject: StoredEntity,
  anchor: {
    eventId: string; domainEntityId: string; anchorEntityId: string; role: "primary" | "secondary";
    confidence: number; rationale: string; governanceVersion: string;
  },
  reviewTargetValue: string,
) {
  const result = await upsertEventSemanticAnchor(db, anchor);
  if (!result.applied) {
    // Preserve the unrelated/cross-generation primary anchor and surface the
    // attempted transition as a review candidate instead of deleting evidence.
    await enqueuePathCandidate(db, { ...input, subject, targetValue: reviewTargetValue, forceReview: true });
  }
  return result;
}

async function applyPath(db: Queryable, input: { eventId: string; clientId: string | null; path: SemanticPathDecision; decision: SemanticDecision }) {
  const subjectRecord = await upsertEntity(db, input.path.subject);
  const subject: StoredEntity = { id: subjectRecord.id, type: subjectRecord.type, value: subjectRecord.value, normalizedValue: subjectRecord.normalizedValue };
  if (input.path.role === "secondary" && !input.decision.paths.some((candidate) => candidate.role === "primary")) {
    await enqueuePathCandidate(db, { ...input, subject, targetValue: input.path.hierarchyPath[input.path.hierarchyPath.length - 1]! });
    return false;
  }
  const domain = await findCanonicalEntity(db, input.path.domain, ["domain"]);
  const leafName = input.path.hierarchyPath[input.path.hierarchyPath.length - 1]!;
  const parent = await findCanonicalEntity(
    db,
    leafName,
    input.path.hierarchyPath.length === 1 ? ["domain"] : ["concept", "app", "merchant", "sender", "recipient"],
  );
  if (!domain || !parent) {
    const createTarget = input.path.action === "create" && input.path.proposedChild?.durable
      ? input.path.proposedChild.value
      : leafName;
    await enqueuePathCandidate(db, {
      ...input,
      subject,
      targetValue: createTarget,
      targetType: input.path.action === "create" && input.path.proposedChild?.durable ? "concept" : undefined,
      parentTargetValue: input.path.action === "create" ? input.path.proposedChild?.parent : undefined,
    });
    return false;
  }
  if (subject.id === parent.id) {
    // Some model responses include a reused subject itself as the final path
    // segment. It is already the durable leaf; never create a self-edge.
    if (input.path.eventAnchor === false) return true;
    return (await applyEventAnchor(db, input, subject, {
      eventId: input.eventId,
      domainEntityId: domain.id,
      anchorEntityId: subject.id,
      role: input.path.role,
      confidence: input.path.confidence,
      rationale: input.path.rationale,
      governanceVersion: input.decision.governanceVersion,
    }, subject.value)).applied;
  }
  const existingRootId = await findHierarchyRoot(db, subject.id);
  if (input.path.role === "primary" && existingRootId && existingRootId !== domain.id) {
    await enqueuePathCandidate(db, { ...input, subject, targetValue: leafName });
    return false;
  }
  const currentParent = await findImmediateHierarchyParent(db, subject.id);
  const mayParentSubject = !existingRootId || existingRootId === domain.id;
  let anchorEntityId = mayParentSubject ? subject.id : parent.id;

  if (currentParent && await isHierarchyAncestor(db, subject.id, parent.id)) {
    // The model tried to move a container below one of its own descendants
    // (for example Xiaomi Home below Motion detection). Preserve the already
    // governed parent instead of creating a cycle or asking the user to review
    // a structurally impossible proposal.
    if (input.path.eventAnchor === false) return true;
    return (await applyEventAnchor(db, input, subject, {
      eventId: input.eventId, domainEntityId: domain.id, anchorEntityId: subject.id, role: input.path.role,
      confidence: input.path.confidence, rationale: `${input.path.rationale} Invalid descendant refinement ignored.`, governanceVersion: input.decision.governanceVersion,
    }, subject.value)).applied;
  }

  if (input.path.action === "reuse" && currentParent?.id === parent.id) {
    if (input.path.eventAnchor === false) return true;
    return (await applyEventAnchor(db, input, subject, {
      eventId: input.eventId, domainEntityId: domain.id, anchorEntityId: subject.id, role: input.path.role,
      confidence: input.path.confidence, rationale: input.path.rationale, governanceVersion: input.decision.governanceVersion,
    }, subject.value)).applied;
  }

  if (input.path.action === "merge") {
    const mergeTarget = input.path.mergeTargetNormalizedValue ? await findCanonicalEntity(db, input.path.mergeTargetNormalizedValue) : null;
    // Merges change identity everywhere and are always a human decision.
    await enqueuePathCandidate(db, { ...input, subject, targetValue: mergeTarget?.value ?? input.path.mergeTargetNormalizedValue ?? leafName, targetType: mergeTarget?.type ?? subject.type, relationType: "same_as" });
    return false;
  }

  if (input.path.action === "create" && input.path.proposedChild?.durable) {
    const proposal = input.path.proposedChild;
    if (proposal.confidence < NEW_NODE_OBSERVATION_CONFIDENCE) {
      await enqueuePathCandidate(db, { ...input, subject, targetValue: proposal.value, parentTargetValue: proposal.parent });
      return false;
    }
    // Do not create a concept that merely restates the classified identity
    // (for example app "Xiaomi Home" and concept "Xiaomi Home app"). The
    // identity itself is the durable leaf below the proposed parent.
    const isEventInstance = input.path.subject.metadata?.instance === true;
    if (!isEventInstance && identityStem(proposal.value) === identityStem(subject.value)) {
      if (!currentParent || await isHierarchyAncestor(db, currentParent.id, parent.id)) {
        const relation = await setImmediateHierarchyParent(db, { child: subject, parent, confidence: proposal.confidence, metadata: { source: "semantic-deepseek", governanceVersion: SEMANTIC_GOVERNANCE_VERSION, identityLeaf: true } });
        await linkEventRelation(db, input.eventId, relation.id, proposal.confidence);
      }
      if (input.path.eventAnchor === false) return true;
      return (await applyEventAnchor(db, input, subject, { eventId: input.eventId, domainEntityId: domain.id, anchorEntityId: subject.id, role: input.path.role, confidence: input.path.confidence, rationale: input.path.rationale, governanceVersion: input.decision.governanceVersion }, subject.value)).applied;
    }
    if (isEventInstance && isSemanticRestatement(proposal.value, parent.value)) {
      const relation = await setImmediateHierarchyParent(db, { child: subject, parent, confidence: input.path.confidence, metadata: { source: "semantic-event-meaning-reuse", governanceVersion: SEMANTIC_GOVERNANCE_VERSION } });
      await linkEventRelation(db, input.eventId, relation.id, input.path.confidence);
      if (input.path.eventAnchor === false) return true;
      return (await applyEventAnchor(db, input, subject, { eventId: input.eventId, domainEntityId: domain.id, anchorEntityId: parent.id, role: input.path.role, confidence: input.path.confidence, rationale: input.path.rationale, governanceVersion: input.decision.governanceVersion }, parent.value)).applied;
    }
    // A new reusable concept changes the durable graph and is always reviewed.
    await enqueuePathCandidate(db, { ...input, subject, targetValue: proposal.value, parentTargetValue: proposal.parent });
    return false;
  } else if (input.path.action === "reuse"
    && input.path.confidence >= (input.path.subject.metadata?.instance === true ? PRIMARY_ROOT_CONFIDENCE : AUTO_APPLY_CONFIDENCE)
    && (input.path.subject.metadata?.instance === true || input.path.steps.every((step) => step.confidence >= AUTO_APPLY_CONFIDENCE))) {
    if (mayParentSubject) {
      if (!currentParent || currentParent.id === parent.id) {
        const relation = await setImmediateHierarchyParent(db, { child: subject, parent, confidence: input.path.confidence, metadata: { source: "semantic-deepseek", governanceVersion: SEMANTIC_GOVERNANCE_VERSION, path: input.path.hierarchyPath } });
        await linkEventRelation(db, input.eventId, relation.id, input.path.confidence);
      } else if (await isHierarchyAncestor(db, currentParent.id, parent.id)) {
        // The proposal is more specific than the current parent, so refining
        // downward is safe. A later broad event cannot flatten it again.
        const relation = await setImmediateHierarchyParent(db, { child: subject, parent, confidence: input.path.confidence, metadata: { source: "semantic-deepseek", governanceVersion: SEMANTIC_GOVERNANCE_VERSION, path: input.path.hierarchyPath, refinement: true } });
        await linkEventRelation(db, input.eventId, relation.id, input.path.confidence);
      } else if (!await isHierarchyAncestor(db, parent.id, currentParent.id)) {
        // Sibling reclassification is a user decision unless the assignment is
        // a deterministic or independently verified reuse of an established
        // category. Those are safe to apply automatically.
        const automaticAssignment = input.path.subject.metadata?.instance === true
          && (input.decision.source === "structural" || input.decision.verificationStatus === "verified");
        if (automaticAssignment) {
          const relation = await setImmediateHierarchyParent(db, { child: subject, parent, confidence: input.path.confidence, metadata: { source: "semantic-assignment", governanceVersion: SEMANTIC_GOVERNANCE_VERSION, previousParentId: currentParent.id } });
          await linkEventRelation(db, input.eventId, relation.id, input.path.confidence);
        } else {
          await enqueuePathCandidate(db, { ...input, subject, targetValue: leafName });
          return false;
        }
      }
    }
  } else {
    await enqueuePathCandidate(db, { ...input, subject, targetValue: leafName });
    return false;
  }

  if (input.path.eventAnchor === false) return true;
  return (await applyEventAnchor(db, input, subject, { eventId: input.eventId, domainEntityId: domain.id, anchorEntityId, role: input.path.role, confidence: input.path.confidence, rationale: input.path.rationale, governanceVersion: input.decision.governanceVersion }, leafName)).applied;
}

async function applyAssociations(db: Queryable, input: { eventId: string; clientId: string | null; decision: SemanticDecision }) {
  for (const association of input.decision.associations) {
    const source = await findCanonicalEntity(db, association.sourceNormalizedValue);
    const target = await findCanonicalEntity(db, association.targetNormalizedValue);
    if (!source || !target || source.id === target.id) continue;
    if (["part_of", "belongs_to_domain"].includes(association.relationType)) continue;
    // Associations must add meaning, not duplicate an existing hierarchy edge
    // or connect a node again to one of its ancestors.
    if (await isHierarchyAncestor(db, source.id, target.id) || await isHierarchyAncestor(db, target.id, source.id)) continue;
    const existing = await db.query(`select 1 from relations where source_entity_id = $1 and target_entity_id = $2 and relation_type = $3 limit 1`, [source.id, target.id, association.relationType]);
    if (existing.rows.length) continue;
    const decision = input.decision;
    const evidence = (decision.evidence ?? []).filter((item) =>
      (association.evidence ?? []).some((reference) => reference.ref === item.ref));
    const refs = (association.evidence ?? []).map((reference) => reference.ref);
    const actionKind = "associate_entities" as const;
    const fingerprint = semanticDecisionFingerprint({
      actionKind,
      subjectNormalizedValue: source.normalizedValue,
      targetNormalizedValue: target.normalizedValue,
      evidenceRefs: refs,
    });
    if (await hasRejectedEquivalent(db, { clientId: input.clientId, fingerprint })) continue;
    const verifiedEventIds = [...new Set(evidence.map((item) => item.eventId).filter((id): id is string => Boolean(id)))];
    const verifiedEventCount = Math.max(1, verifiedEventIds.length);
    await enqueueSemanticCandidate(db, {
      clientId: input.clientId, eventId: input.eventId, subjectEntityId: source.id, relationType: association.relationType,
      targetType: target.type, targetValue: target.value, targetNormalizedValue: target.normalizedValue,
      confidence: association.confidence, rationale: association.rationale, extractor: "deepseek-v2",
      decisionKind: "association", proposedPath: [], alternatives: [], associations: [association], recurrenceCount: 1,
      governanceVersion: decision.governanceVersion, promptVersion: decision.promptVersion, model: decision.model,
      actionKind,
      evidence: evidence.map((item) => ({
        eventId: item.eventId ?? null, source: item.source ?? null, occurredAt: item.occurredAt ?? null,
        field: item.field ?? null, title: item.kind === "event_title" ? item.text.slice(0, 280) : null,
        excerpt: item.text.slice(0, 700), ref: item.ref, kind: item.kind,
      })),
      evidenceEventIds: verifiedEventIds,
      verifiedEventCount,
      verificationStatus: decision.verificationStatus ?? "not_required",
      verification: decision.verification ?? {},
      policyVersion: decision.policyVersion ?? DECISION_POLICY_VERSION,
      changeExplanation: spanishChangeExplanation({
        actionKind, subjectLabel: source.value, targetLabel: target.value,
        relationType: association.relationType, verifiedEventCount,
        isFinancial: source.type === "financial_event" || target.type === "financial_event",
      }),
      decisionFingerprint: fingerprint,
      generationId: (decision as SemanticDecision & { generationId?: string | null }).generationId ?? null,
    });
  }
}

export async function persistSemanticDecision(db: Queryable, input: { eventId: string; clientId: string | null; drafts: EntityDraft[]; decision: SemanticDecision; dryRun?: boolean }) {
  if (input.dryRun) return { appliedPaths: 0, reviewPaths: input.decision.paths.length, decision: input.decision };
  await recordDecision(db, input);
  if (input.decision.status === "discarded") {
    return { appliedPaths: 0, reviewPaths: 0, decision: input.decision };
  }
  // Reprocessing may replace an earlier AI-created event identity with a
  // better subject (or decide that no durable event node is warranted). Keep
  // the historical row as evidence, but remove it from the governed graph so
  // stale model output cannot survive as a visible knowledge node.
  const governedSubjects = input.decision.paths.map((path) => path.subject.normalizedValue);
  await db.query(`
    update entities set identity_source = 'evidence'
    where identity_source = 'ai'
      and metadata ->> 'eventId' = $1
      and coalesce(metadata ->> 'instance', 'false') = 'true'
      and not (normalized_value = any($2::text[]))
  `, [input.eventId, governedSubjects]);
  await applySemanticRules(db, { clientId: input.clientId, eventId: input.eventId, drafts: input.drafts });
  let appliedPaths = 0;
  for (const path of input.decision.paths) if (await applyPath(db, { eventId: input.eventId, clientId: input.clientId, path, decision: input.decision })) appliedPaths += 1;
  // The event instance is evidence, never a second semantic branch. Once its
  // primary meaning has been chosen, make that meaning its sole direct parent
  // even when an older extraction or a prior model pass attached it elsewhere.
  await rootEventEvidenceFromAnchors(db, input.eventId);
  const coveredSubjects = new Set(input.decision.paths.map((path) => path.subject.normalizedValue));
  const primary = input.decision.paths.find((path) => path.role === "primary") ?? input.decision.paths[0];
  const mayProposeFromDrafts = !input.decision.abstained
    && !["rejected", "unavailable"].includes(input.decision.verificationStatus ?? "not_required");
  if (mayProposeFromDrafts) for (const draft of input.drafts) {
    if (!SEMANTIC_SUBJECT_TYPES.has(draft.type) || coveredSubjects.has(draft.normalizedValue)) continue;
    const subjectRecord = await upsertEntity(db, draft);
    if (await findHierarchyRoot(db, subjectRecord.id)) continue;
    const structuralPath = ["sender", "recipient", "email_message"].includes(draft.type)
      ? ["Communication", "Email"]
      : draft.type === "financial_event"
        ? ["Finances", "Financial activity"]
        : primary?.hierarchyPath ?? [input.decision.rootAlternatives[0]?.value ?? "Communication"];
    const targetValue = structuralPath[structuralPath.length - 1]!;
    await enqueueSemanticCandidate(db, {
      clientId: input.clientId, eventId: input.eventId, subjectEntityId: subjectRecord.id,
      relationType: structuralPath.length === 1 ? "belongs_to_domain" : "part_of",
      targetType: structuralPath.length === 1 ? "domain" : "concept", targetValue, targetNormalizedValue: normalizeEntityValue(targetValue),
      confidence: primary?.confidence ?? input.decision.rootAlternatives[0]?.confidence ?? 0,
      rationale: `The model did not return a validated path for ${draft.value}. Review the closest event-level proposal before this entity becomes visible in the graph.`,
      extractor: "deepseek-v2", decisionKind: "classify", domainValue: structuralPath[0], proposedPath: structuralPath,
      alternatives: input.decision.rootAlternatives, associations: [], recurrenceCount: 1,
      governanceVersion: input.decision.governanceVersion, promptVersion: input.decision.promptVersion, model: input.decision.model,
    });
  }
  await applyAssociations(db, { eventId: input.eventId, clientId: input.clientId, decision: input.decision });
  await settleSatisfiedSemanticCandidates(db, input.eventId);
  // AI identities that still lack a governed parent are review candidates,
  // not graph nodes. Preserve the evidence and its generated description;
  // semantic review promotes it once the hierarchy is approved.
  await db.query(`
    update entities entity set identity_source = 'candidate'
    where entity.identity_source = 'ai'
      and entity.metadata ->> 'eventId' = $1
      and coalesce(entity.metadata ->> 'instance', 'false') = 'true'
      and not exists (
        select 1 from relations relation
        where relation.source_entity_id = entity.id
          and relation.relation_type in ('part_of', 'belongs_to_domain')
      )
  `, [input.eventId]);
  if (!["retryable", "unclassified", "model_unavailable", "discarded"].includes(input.decision.status)) {
    await db.query(`update semantic_event_decisions decision set status = case
      when exists (select 1 from semantic_candidates candidate where candidate.event_id = decision.event_id and candidate.status = 'pending') then 'review'
      else 'resolved' end, updated_at = now() where event_id = $1`, [input.eventId]);
  }
  return { appliedPaths, reviewPaths: input.decision.paths.length - appliedPaths, decision: input.decision };
}

export async function resolveEventSemantics(db: Queryable, input: { eventId: string; clientId: string | null; drafts: EntityDraft[]; source: string; inferredKind: string; title?: string; body?: string; decision?: SemanticDecision; dryRun?: boolean }) {
  const decision = input.decision ?? await buildModelSemanticDecision({ entities: input.drafts, source: input.source, inferredKind: input.inferredKind, title: input.title, body: input.body, clientId: input.clientId });
  return persistSemanticDecision(db, { eventId: input.eventId, clientId: input.clientId, drafts: input.drafts, decision, dryRun: input.dryRun });
}
