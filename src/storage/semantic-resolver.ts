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
import { upsertEntity } from "./entity-repository.js";
import { linkEventRelation, upsertRelation } from "./relation-repository.js";
import {
  applySemanticRules,
  enqueueSemanticCandidate,
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
    insert into semantic_event_decisions (event_id, client_id, status, primary_domain_value, decision, governance_version, prompt_version, model)
    values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
    on conflict (event_id) do update set client_id = excluded.client_id, status = excluded.status,
      primary_domain_value = excluded.primary_domain_value, decision = excluded.decision,
      governance_version = excluded.governance_version, prompt_version = excluded.prompt_version,
      model = excluded.model, updated_at = now()
  `, [input.eventId, input.clientId, input.decision.status, primary?.domain ?? null, JSON.stringify(input.decision), input.decision.governanceVersion, input.decision.promptVersion, input.decision.model]);
}

function candidateAlternatives(path: SemanticPathDecision) {
  return path.steps.flatMap((step) => step.alternatives.map((alternative) => ({ parent: step.parent, ...alternative })));
}

async function enqueuePathCandidate(db: Queryable, input: { eventId: string; clientId: string | null; subject: StoredEntity; path: SemanticPathDecision; targetValue: string; targetType?: string; relationType?: string; parentTargetValue?: string; recurrenceCount?: number; decision: SemanticDecision }) {
  return enqueueSemanticCandidate(db, {
    clientId: input.clientId, eventId: input.eventId, subjectEntityId: input.subject.id,
    relationType: input.relationType ?? (input.path.hierarchyPath.length === 1 ? "belongs_to_domain" : "part_of"),
    targetType: input.targetType ?? (input.path.hierarchyPath.length === 1 ? "domain" : "concept"),
    targetValue: input.targetValue, targetNormalizedValue: normalizeEntityValue(input.targetValue),
    parentTargetValue: input.parentTargetValue, confidence: input.path.confidence,
    rationale: input.path.rationale, extractor: "deepseek-v2", decisionKind: input.path.action,
    domainValue: input.path.domain, anchorRole: input.path.role, proposedPath: input.path.hierarchyPath,
    alternatives: candidateAlternatives(input.path), associations: input.decision.associations,
    recurrenceCount: input.recurrenceCount ?? 1, governanceVersion: input.decision.governanceVersion,
    promptVersion: input.decision.promptVersion, model: input.decision.model,
  });
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
    await enqueuePathCandidate(db, { ...input, subject, targetValue: leafName });
    return false;
  }
  if (subject.id === parent.id) {
    // Some model responses include a reused subject itself as the final path
    // segment. It is already the durable leaf; never create a self-edge.
    if (input.path.eventAnchor !== false) await upsertEventSemanticAnchor(db, {
      eventId: input.eventId,
      domainEntityId: domain.id,
      anchorEntityId: subject.id,
      role: input.path.role,
      confidence: input.path.confidence,
      rationale: input.path.rationale,
      governanceVersion: input.decision.governanceVersion,
    });
    return true;
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
    if (input.path.eventAnchor !== false) await upsertEventSemanticAnchor(db, {
      eventId: input.eventId, domainEntityId: domain.id, anchorEntityId: subject.id, role: input.path.role,
      confidence: input.path.confidence, rationale: `${input.path.rationale} Invalid descendant refinement ignored.`, governanceVersion: input.decision.governanceVersion,
    });
    return true;
  }

  if (input.path.action === "reuse" && currentParent?.id === parent.id) {
    if (input.path.eventAnchor !== false) await upsertEventSemanticAnchor(db, {
      eventId: input.eventId, domainEntityId: domain.id, anchorEntityId: subject.id, role: input.path.role,
      confidence: input.path.confidence, rationale: input.path.rationale, governanceVersion: input.decision.governanceVersion,
    });
    return true;
  }

  if (input.path.action === "merge") {
    const mergeTarget = input.path.mergeTargetNormalizedValue ? await findCanonicalEntity(db, input.path.mergeTargetNormalizedValue) : null;
    const isEventInstance = input.path.subject.metadata?.instance === true;
    if (isEventInstance && mergeTarget?.type === "concept" && input.path.confidence >= AUTO_APPLY_CONFIDENCE) {
      const relation = await setImmediateHierarchyParent(db, { child: subject, parent: mergeTarget, confidence: input.path.confidence, metadata: { source: "semantic-event-meaning-reuse", governanceVersion: SEMANTIC_GOVERNANCE_VERSION } });
      await linkEventRelation(db, input.eventId, relation.id, input.path.confidence);
      if (input.path.eventAnchor !== false) await upsertEventSemanticAnchor(db, { eventId: input.eventId, domainEntityId: domain.id, anchorEntityId: mergeTarget.id, role: input.path.role, confidence: input.path.confidence, rationale: input.path.rationale, governanceVersion: input.decision.governanceVersion });
      return true;
    }
    await enqueuePathCandidate(db, { ...input, subject, targetValue: mergeTarget?.value ?? input.path.mergeTargetNormalizedValue ?? leafName, targetType: mergeTarget?.type ?? subject.type, relationType: "same_as" });
    return false;
  }

  if (input.path.action === "create" && input.path.proposedChild?.durable) {
    const proposal = input.path.proposedChild;
    // validatePath already proved that proposal.parent is the requested leaf.
    // parent may now carry a different normalized value because that leaf was
    // subsequently merged or renamed, so compare confidence here, not names.
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
      if (input.path.eventAnchor !== false) await upsertEventSemanticAnchor(db, { eventId: input.eventId, domainEntityId: domain.id, anchorEntityId: subject.id, role: input.path.role, confidence: input.path.confidence, rationale: input.path.rationale, governanceVersion: input.decision.governanceVersion });
      return true;
    }
    if (isEventInstance && isSemanticRestatement(proposal.value, parent.value)) {
      const relation = await setImmediateHierarchyParent(db, { child: subject, parent, confidence: input.path.confidence, metadata: { source: "semantic-event-meaning-reuse", governanceVersion: SEMANTIC_GOVERNANCE_VERSION } });
      await linkEventRelation(db, input.eventId, relation.id, input.path.confidence);
      if (input.path.eventAnchor !== false) await upsertEventSemanticAnchor(db, { eventId: input.eventId, domainEntityId: domain.id, anchorEntityId: parent.id, role: input.path.role, confidence: input.path.confidence, rationale: input.path.rationale, governanceVersion: input.decision.governanceVersion });
      return true;
    }
    if (isEventInstance) {
      // The LLM has already compared this meaning against canonicalContext.
      // Materialize one reusable concept hub at high confidence, then retain
      // each captured event as distinct evidence beneath that hub.
      const meaningRecord = await upsertEntity(db, {
        type: "concept",
        value: proposal.value,
        normalizedValue: normalizeEntityValue(proposal.value),
        description: proposal.description,
        identitySource: "ai",
        metadata: { source: "semantic-event-meaning", governanceVersion: SEMANTIC_GOVERNANCE_VERSION, aiIdentity: true },
      });
      const meaning: StoredEntity = { id: meaningRecord.id, type: meaningRecord.type, value: meaningRecord.value, normalizedValue: meaningRecord.normalizedValue };
      const meaningRelation = await setImmediateHierarchyParent(db, { child: meaning, parent, confidence: proposal.confidence, metadata: { source: "semantic-event-meaning", governanceVersion: SEMANTIC_GOVERNANCE_VERSION } });
      const evidenceRelation = await setImmediateHierarchyParent(db, { child: subject, parent: meaning, confidence: input.path.confidence, metadata: { source: "semantic-event-evidence", governanceVersion: SEMANTIC_GOVERNANCE_VERSION } });
      await linkEventRelation(db, input.eventId, meaningRelation.id, proposal.confidence);
      await linkEventRelation(db, input.eventId, evidenceRelation.id, input.path.confidence);
      if (input.path.eventAnchor !== false) await upsertEventSemanticAnchor(db, { eventId: input.eventId, domainEntityId: domain.id, anchorEntityId: meaning.id, role: input.path.role, confidence: input.path.confidence, rationale: input.path.rationale, governanceVersion: input.decision.governanceVersion });
      return true;
    }
    await db.query(`
      insert into semantic_observations (id, client_id, event_id, subject_entity_id, proposed_value, proposed_normalized_value, parent_entity_id, confidence, governance_version)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (event_id, subject_entity_id, proposed_normalized_value, parent_entity_id)
      do update set confidence = greatest(semantic_observations.confidence, excluded.confidence)
    `, [randomUUID(), input.clientId, input.eventId, subject.id, proposal.value, normalizeEntityValue(proposal.value), parent.id, proposal.confidence, SEMANTIC_GOVERNANCE_VERSION]);
    const recurrence = await db.query<{ count: number; average: number }>(`
      select count(distinct event_id)::int as count, avg(confidence)::float8 as average from semantic_observations
      where client_id is not distinct from $1 and proposed_normalized_value = $2 and parent_entity_id = $3 and confidence >= $4
    `, [input.clientId, normalizeEntityValue(proposal.value), parent.id, NEW_NODE_OBSERVATION_CONFIDENCE]);
    const count = recurrence.rows[0]?.count ?? 0;
    const average = recurrence.rows[0]?.average ?? 0;
    if (count < 2 || average < AUTO_APPLY_CONFIDENCE) {
      await enqueuePathCandidate(db, { ...input, subject, targetValue: proposal.value, parentTargetValue: proposal.parent, recurrenceCount: count });
      return false;
    }
    const childRecord = await upsertEntity(db, { type: "concept", value: proposal.value, normalizedValue: normalizeEntityValue(proposal.value), description: proposal.description, identitySource: "ai", metadata: { source: "semantic-recurrence", governanceVersion: SEMANTIC_GOVERNANCE_VERSION, observations: count, aiIdentity: true } });
    const child: StoredEntity = { id: childRecord.id, type: childRecord.type, value: childRecord.value, normalizedValue: childRecord.normalizedValue };
    await setImmediateHierarchyParent(db, { child, parent, confidence: average, metadata: { source: "semantic-recurrence", governanceVersion: SEMANTIC_GOVERNANCE_VERSION } });
    if (mayParentSubject) await setImmediateHierarchyParent(db, { child: subject, parent: child, confidence: input.path.confidence, metadata: { source: "semantic-deepseek", governanceVersion: SEMANTIC_GOVERNANCE_VERSION } });
    else anchorEntityId = child.id;
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
        // Sibling reclassification is a user decision, not an automatic
        // rewrite of established knowledge.
        await enqueuePathCandidate(db, { ...input, subject, targetValue: leafName });
        return false;
      }
    }
  } else {
    await enqueuePathCandidate(db, { ...input, subject, targetValue: leafName });
    return false;
  }

  if (input.path.eventAnchor !== false) await upsertEventSemanticAnchor(db, { eventId: input.eventId, domainEntityId: domain.id, anchorEntityId, role: input.path.role, confidence: input.path.confidence, rationale: input.path.rationale, governanceVersion: input.decision.governanceVersion });
  return true;
}

async function applyAssociations(db: Queryable, input: { eventId: string; clientId: string | null; decision: SemanticDecision }) {
  for (const association of input.decision.associations) {
    const source = await findCanonicalEntity(db, association.sourceNormalizedValue);
    const target = await findCanonicalEntity(db, association.targetNormalizedValue);
    if (!source || !target || source.id === target.id) continue;
    if (["part_of", "belongs_to_domain"].includes(association.relationType)) continue;
    // Associations must add meaning, not duplicate an existing hierarchy
    // edge or connect a node again to one of its ancestors.
    if (await isHierarchyAncestor(db, source.id, target.id) || await isHierarchyAncestor(db, target.id, source.id)) continue;
    if (association.confidence < AUTO_APPLY_CONFIDENCE) {
      await enqueueSemanticCandidate(db, {
        clientId: input.clientId, eventId: input.eventId, subjectEntityId: source.id, relationType: association.relationType,
        targetType: target.type, targetValue: target.value, targetNormalizedValue: target.normalizedValue,
        confidence: association.confidence, rationale: association.rationale, extractor: "deepseek-v2",
        decisionKind: "association", proposedPath: [], alternatives: [], associations: [association], recurrenceCount: 1,
        governanceVersion: input.decision.governanceVersion, promptVersion: input.decision.promptVersion, model: input.decision.model,
      });
      continue;
    }
    const relation = await upsertRelation(db, { relationType: association.relationType, label: association.relationType.replace(/_/g, " "), description: association.rationale, sourceEntity: { type: source.type, value: source.value, normalizedValue: source.normalizedValue }, targetEntity: { type: target.type, value: target.value, normalizedValue: target.normalizedValue }, confidence: association.confidence, metadata: { source: "semantic-deepseek", governanceVersion: input.decision.governanceVersion } }, source.id, target.id);
    await linkEventRelation(db, input.eventId, relation.id, association.confidence);
  }
}

export async function persistSemanticDecision(db: Queryable, input: { eventId: string; clientId: string | null; drafts: EntityDraft[]; decision: SemanticDecision; dryRun?: boolean }) {
  if (input.dryRun) return { appliedPaths: 0, reviewPaths: input.decision.paths.length, decision: input.decision };
  await recordDecision(db, input);
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
  const coveredSubjects = new Set(input.decision.paths.map((path) => path.subject.normalizedValue));
  const primary = input.decision.paths.find((path) => path.role === "primary") ?? input.decision.paths[0];
  for (const draft of input.drafts) {
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
  if (!["retryable", "unclassified", "model_unavailable"].includes(input.decision.status)) {
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
