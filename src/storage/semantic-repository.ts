import { randomUUID } from "node:crypto";
import { ontologyDraft, LIFE_DOMAINS, ONTOLOGY_PARENT_RELATIONS, SEEDED_CONCEPTS, SEMANTIC_GOVERNANCE_VERSION, SEMANTIC_PROMPT_VERSION } from "../domain/ontology.js";
import { normalizeEntityValue, type EntityDraft } from "../domain/entities.js";
import { normalizeRelationType, type RelationDraft } from "../domain/relations.js";
import { upsertEntity } from "./entity-repository.js";
import { linkEventRelation, upsertRelation } from "./relation-repository.js";
import { pool } from "./postgres.js";

type Queryable = Pick<typeof pool, "query">;
const RULE_ELIGIBLE_ENTITY_TYPES = new Set(["app", "merchant", "sender", "recipient", "email_message", "financial_event", "activity_instance"]);

export type SemanticCandidate = {
  id: string; clientId: string | null; eventId: string | null; subjectEntityId: string | null;
  subjectValue?: string | null; subjectType?: string | null;
  relationType: string; targetType: string; targetValue: string; targetNormalizedValue: string;
  confidence: number; rationale: string | null; status: "pending" | "approved" | "rejected";
  resolvedTargetEntityId: string | null; createdAt: string;
  extractor?: string;
  parentTargetValue?: string | null;
  decisionKind?: string;
  domainValue?: string | null;
  anchorRole?: "primary" | "secondary" | null;
  proposedPath?: string[];
  alternatives?: unknown[];
  associations?: unknown[];
  recurrenceCount?: number;
  governanceVersion?: string;
  promptVersion?: string;
  model?: string | null;
};

export async function ensureOntology(db: Queryable, clientId: string | null) {
  const domains = [];
  for (const name of LIFE_DOMAINS) domains.push(await upsertEntity(db, ontologyDraft(name)));
  const concepts = new Map<string, Awaited<ReturnType<typeof upsertEntity>>>();
  for (const name of SEEDED_CONCEPTS) concepts.set(name, await upsertEntity(db, ontologyDraft(name, "concept")));
  const domainByName = new Map(domains.map((domain) => [domain.value, domain]));
  for (const [childName, parentName] of ONTOLOGY_PARENT_RELATIONS) {
    const child = concepts.get(childName)!;
    const parent = concepts.get(parentName) ?? domainByName.get(parentName)!;
    await setImmediateHierarchyParent(db, {
      child,
      parent,
      confidence: 1,
      metadata: { source: "ontology", governanceVersion: SEMANTIC_GOVERNANCE_VERSION },
    });
  }
  if (clientId) {
    for (const domain of domains) {
      await db.query(`insert into client_domain_preferences (client_id, domain_entity_id) values ($1, $2) on conflict do nothing`, [clientId, domain.id]);
    }
  }
  return domains;
}

export async function consolidateProviderIdentity(db: Queryable, draft: EntityDraft) {
  if (draft.type !== "app") return upsertEntity(db, draft);
  const canonical = await upsertEntity(db, draft);
  // Older classifiers used several labels for the same installed app
  // (source, application, app_name, and even notification/merchant).  An
  // installed app is a provider identity, so retain one canonical app node and
  // merge only non-ontology records with exactly the same normalized name.
  const matches = await db.query<{ id: string }>(
    `select entity.id from entities entity
      left join entity_merges merged on merged.alias_entity_id = entity.id
      where entity.normalized_value = $1
        and entity.type not in ('domain', 'concept')
        and entity.id <> $2
        and merged.alias_entity_id is null`,
    [draft.normalizedValue, canonical.id],
  );
  for (const match of matches.rows) {
    const { mergeEntities } = await import("./entity-repository.js");
    await mergeEntities(db, match.id, canonical.id, { reason: "provider_identity_normalization", confidence: 1 });
  }
  return canonical;
}

export async function setImmediateHierarchyParent(db: Queryable, input: {
  child: { id: string; type: string; value: string; normalizedValue: string };
  parent: { id: string; type: string; value: string; normalizedValue: string };
  confidence: number;
  metadata?: Record<string, unknown>;
}) {
  if (input.child.id === input.parent.id) throw new Error("A hierarchy node cannot parent itself");
  await db.query(`select pg_advisory_xact_lock(hashtext($1))`, [input.child.id]);
  const cycle = await db.query<{ cycle: boolean }>(`
    with recursive ancestors(entity_id) as (
      select $1::text
      union
      select r.target_entity_id from relations r join ancestors a on a.entity_id = r.source_entity_id
      where r.relation_type in ('part_of', 'belongs_to_domain')
    ) select exists(select 1 from ancestors where entity_id = $2) as cycle
  `, [input.parent.id, input.child.id]);
  if (cycle.rows[0]?.cycle) throw new Error("Hierarchy relation would create a cycle");
  const relationType = input.parent.type === "domain" ? "belongs_to_domain" : "part_of";
  await db.query(`delete from relations where source_entity_id = $1 and relation_type in ('part_of', 'belongs_to_domain')
    and (target_entity_id <> $2 or relation_type <> $3)`, [input.child.id, input.parent.id, relationType]);
  return upsertRelation(db, {
    relationType, label: "Part of", description: `${input.child.value} is part of ${input.parent.value}`,
    sourceEntity: { type: input.child.type, value: input.child.value, normalizedValue: input.child.normalizedValue },
    targetEntity: { type: input.parent.type, value: input.parent.value, normalizedValue: input.parent.normalizedValue },
    confidence: input.confidence, metadata: input.metadata,
  }, input.child.id, input.parent.id);
}

export type SemanticAnchorWrite = {
  applied: boolean;
  // True when an existing primary anchor outside the requested
  // domain/generation was deliberately preserved instead of being deleted.
  preservedPrimary: boolean;
};

// B04: an event's primary anchor may only be replaced inside the same governed
// domain and the same governance generation. A reprocessed path that would
// move the event to another domain, or that would overwrite an anchor from an
// older generation, is preserved as durable evidence and returned to the
// caller for review. The one-primary index is therefore never satisfied by
// implicitly deleting unrelated history.
export async function upsertEventSemanticAnchor(db: Queryable, input: {
  eventId: string; domainEntityId: string; anchorEntityId: string; role: "primary" | "secondary";
  confidence: number; rationale: string; governanceVersion: string;
}): Promise<SemanticAnchorWrite> {
  // Serialize anchor writes per event so two concurrent resolutions cannot
  // both observe "no primary" and then collide on the partial unique index.
  await db.query(`select pg_advisory_xact_lock(hashtext($1))`, [`event-semantic-anchor:${input.eventId}`]);
  if (input.role === "primary") {
    const existing = await db.query<{ domainEntityId: string; governanceVersion: string }>(`
      select domain_entity_id as "domainEntityId", governance_version as "governanceVersion"
      from event_semantic_anchors
      where event_id = $1 and role = 'primary'
      for update
    `, [input.eventId]);
    const primary = existing.rows[0];
    if (primary && (primary.domainEntityId !== input.domainEntityId || primary.governanceVersion !== input.governanceVersion)) {
      return { applied: false, preservedPrimary: true };
    }
  }
  await db.query(`
    insert into event_semantic_anchors (event_id, domain_entity_id, anchor_entity_id, role, confidence, rationale, governance_version)
    values ($1,$2,$3,$4,$5,$6,$7)
    on conflict (event_id, domain_entity_id) do update set anchor_entity_id = excluded.anchor_entity_id, role = excluded.role,
      confidence = excluded.confidence, rationale = excluded.rationale, governance_version = excluded.governance_version, updated_at = now()
  `, [input.eventId, input.domainEntityId, input.anchorEntityId, input.role, input.confidence, input.rationale, input.governanceVersion]);
  return { applied: true, preservedPrimary: false };
}

export async function enqueueSemanticCandidate(db: Queryable, input: Omit<SemanticCandidate, "id" | "status" | "createdAt" | "resolvedTargetEntityId">) {
  const normalized = normalizeRelationType(input.relationType);
  const result = await db.query<SemanticCandidate>(`
    insert into semantic_candidates (id, client_id, event_id, subject_entity_id, relation_type, target_type, target_value, target_normalized_value, confidence, rationale, extractor, parent_target_value, parent_target_normalized_value, decision_kind, domain_value, anchor_role, proposed_path, alternatives, associations, recurrence_count, governance_version, prompt_version, model)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19::jsonb,$20,$21,$22,$23)
    on conflict (event_id, subject_entity_id, relation_type, target_type, target_normalized_value)
    do update set confidence = greatest(semantic_candidates.confidence, excluded.confidence), rationale = excluded.rationale, extractor = excluded.extractor, decision_kind = excluded.decision_kind, domain_value = excluded.domain_value, anchor_role = excluded.anchor_role, proposed_path = excluded.proposed_path, alternatives = excluded.alternatives, associations = excluded.associations, recurrence_count = greatest(semantic_candidates.recurrence_count, excluded.recurrence_count), governance_version = excluded.governance_version, prompt_version = excluded.prompt_version, model = excluded.model, updated_at = now()
    returning id, client_id as "clientId", event_id as "eventId", subject_entity_id as "subjectEntityId", relation_type as "relationType", target_type as "targetType", target_value as "targetValue", target_normalized_value as "targetNormalizedValue", parent_target_value as "parentTargetValue", confidence::float8, rationale, extractor, status, resolved_target_entity_id as "resolvedTargetEntityId", decision_kind as "decisionKind", domain_value as "domainValue", anchor_role as "anchorRole", proposed_path as "proposedPath", alternatives, associations, recurrence_count as "recurrenceCount", governance_version as "governanceVersion", prompt_version as "promptVersion", model, created_at as "createdAt"
  `, [randomUUID(), input.clientId, input.eventId, input.subjectEntityId, normalized.relationType, input.targetType, input.targetValue, input.targetNormalizedValue, input.confidence, input.rationale, input.extractor ?? "semantic-v3", input.parentTargetValue ?? null, input.parentTargetValue ? normalizeEntityValue(input.parentTargetValue) : null, input.decisionKind ?? "reuse", input.domainValue ?? null, input.anchorRole ?? null, JSON.stringify(input.proposedPath ?? []), JSON.stringify(input.alternatives ?? []), JSON.stringify(input.associations ?? []), input.recurrenceCount ?? 1, input.governanceVersion ?? SEMANTIC_GOVERNANCE_VERSION, input.promptVersion ?? SEMANTIC_PROMPT_VERSION, input.model ?? null]);
  return result.rows[0];
}

export async function settleSatisfiedSemanticCandidates(db: Queryable, eventId?: string) {
  const result = await db.query<{ id: string }>(`
    with candidate_targets as (
      select candidate.id,
        coalesce(merged.canonical_entity_id, matched.id) as canonical_target_id
      from semantic_candidates candidate
      join entities matched on matched.normalized_value = candidate.target_normalized_value
        and matched.type = candidate.target_type
      left join entity_merges merged on merged.alias_entity_id = matched.id
      where candidate.status = 'pending' and ($1::text is null or candidate.event_id = $1)
    ), satisfied as (
      select distinct candidate.id, target.canonical_target_id
      from semantic_candidates candidate
      join candidate_targets target on target.id = candidate.id
      join relations relation on relation.source_entity_id = candidate.subject_entity_id
        and relation.target_entity_id = target.canonical_target_id
        and (relation.relation_type = candidate.relation_type
          or (relation.relation_type in ('part_of','belongs_to_domain')
            and candidate.relation_type in ('part_of','belongs_to_domain')))
    )
    update semantic_candidates candidate set status = 'approved', resolved_target_entity_id = satisfied.canonical_target_id,
      resolved_at = now(), updated_at = now(),
      rationale = coalesce(candidate.rationale, '') || ' [Automatically resolved: the canonical relation already exists.]'
    from satisfied where candidate.id = satisfied.id
    returning candidate.id
  `, [eventId ?? null]);
  return result.rows.length;
}

export async function rootEventEvidenceFromAnchors(db: Queryable, eventId?: string) {
  const result = await db.query<{
    eventId: string;
    subjectId: string; subjectType: string; subjectValue: string; subjectNormalizedValue: string;
    anchorId: string; anchorType: string; anchorValue: string; anchorNormalizedValue: string;
    confidence: number;
  }>(`
    select distinct on (subject.id)
      event_entity.event_id as "eventId", subject.id as "subjectId", subject.type as "subjectType",
      subject.value as "subjectValue", subject.normalized_value as "subjectNormalizedValue",
      anchor.id as "anchorId", anchor.type as "anchorType", anchor.value as "anchorValue",
      anchor.normalized_value as "anchorNormalizedValue", semantic_anchor.confidence::float8
    from entities subject
    join event_entities event_entity on event_entity.entity_id = subject.id
    join event_semantic_anchors semantic_anchor on semantic_anchor.event_id = event_entity.event_id
      and semantic_anchor.role = 'primary'
    left join entity_merges anchor_merge on anchor_merge.alias_entity_id = semantic_anchor.anchor_entity_id
    join entities anchor on anchor.id = coalesce(anchor_merge.canonical_entity_id, semantic_anchor.anchor_entity_id)
    where subject.type in ('activity_instance','financial_event','email_message')
      and subject.id <> anchor.id
      and ($1::text is null or event_entity.event_id = $1)
      -- Event evidence has exactly one immediate semantic parent: the primary
      -- anchor selected for that event. Replacing a legacy parent here is
      -- intentional; otherwise a reprocessed event can remain beneath a
      -- stale, generic concept and look disconnected in Explore.
      and (
        exists (
          select 1 from relations current
          where current.source_entity_id = subject.id
            and current.relation_type in ('part_of','belongs_to_domain')
            and current.target_entity_id <> anchor.id
        )
          or not exists (
            select 1 from relations current
            where current.source_entity_id = subject.id
              and current.relation_type in ('part_of','belongs_to_domain')
          )
      )
    order by subject.id, semantic_anchor.confidence desc
  `, [eventId ?? null]);
  let rooted = 0;
  for (const row of result.rows) {
    const relation = await setImmediateHierarchyParent(db, {
      child: { id: row.subjectId, type: row.subjectType, value: row.subjectValue, normalizedValue: row.subjectNormalizedValue },
      parent: { id: row.anchorId, type: row.anchorType, value: row.anchorValue, normalizedValue: row.anchorNormalizedValue },
      confidence: row.confidence,
      metadata: { source: "semantic-anchor-repair", governanceVersion: SEMANTIC_GOVERNANCE_VERSION },
    });
    await linkEventRelation(db, row.eventId, relation.id, row.confidence);
    rooted += 1;
  }
  return rooted;
}

export async function applySemanticRules(db: Queryable, input: { clientId: string | null; eventId: string; drafts: EntityDraft[] }) {
  for (const draft of input.drafts) {
    if (!RULE_ELIGIBLE_ENTITY_TYPES.has(draft.type)) continue;
    const rules = await db.query<{ relationType: string; targetEntityId: string; targetType: string; targetValue: string; targetNormalizedValue: string }>(`
      select rule.relation_type as "relationType", rule.target_entity_id as "targetEntityId",
        target.type as "targetType", target.value as "targetValue", target.normalized_value as "targetNormalizedValue"
      from semantic_rules rule join entities target on target.id = rule.target_entity_id
      where rule.client_id is not distinct from $1 and rule.source_type = $2 and rule.source_normalized_value = $3
      order by rule.updated_at desc, rule.created_at desc
    `, [input.clientId, draft.type, draft.normalizedValue]);
    // Rules are optional. Never turn every extractor field into an entity just
    // by checking whether it has a rule.
    if (rules.rows.length === 0) continue;
    const source = await upsertEntity(db, draft);
    for (const rule of rules.rows) {
      if (source.id === rule.targetEntityId) continue;
      const relation = ["part_of", "belongs_to_domain"].includes(rule.relationType)
        ? await setImmediateHierarchyParent(db, {
          child: source,
          parent: { id: rule.targetEntityId, type: rule.targetType, value: rule.targetValue, normalizedValue: rule.targetNormalizedValue },
          confidence: 1,
          metadata: { source: "semantic-rule" },
        })
        : await upsertRelation(db, {
          relationType: rule.relationType, label: rule.relationType.replace(/_/g, " "),
          description: `${source.value} ${rule.relationType.replace(/_/g, " ")}`,
          sourceEntity: draft, targetEntity: { type: rule.targetType, value: rule.targetValue, normalizedValue: rule.targetNormalizedValue }, confidence: 1,
        }, source.id, rule.targetEntityId);
      await linkEventRelation(db, input.eventId, relation.id, 1);
      // A governed entity can have one hierarchy rule. Older rules with a
      // different hierarchy relation type would otherwise recreate a second
      // parent on the next event.
      if (["part_of", "belongs_to_domain"].includes(rule.relationType)) break;
    }
  }
}

export async function listSemanticCandidates(db: Queryable, clientId: string | null, status: SemanticCandidate["status"] = "pending") {
  const result = await db.query<SemanticCandidate>(`
    select candidate.id, candidate.client_id as "clientId", candidate.event_id as "eventId",
      candidate.subject_entity_id as "subjectEntityId", subject.value as "subjectValue", subject.type as "subjectType",
      candidate.relation_type as "relationType", candidate.target_type as "targetType",
      candidate.target_value as "targetValue", candidate.target_normalized_value as "targetNormalizedValue",
      candidate.parent_target_value as "parentTargetValue", candidate.confidence::float8, candidate.rationale,
      candidate.extractor, candidate.status, candidate.resolved_target_entity_id as "resolvedTargetEntityId",
      candidate.decision_kind as "decisionKind", candidate.domain_value as "domainValue",
      candidate.anchor_role as "anchorRole", candidate.proposed_path as "proposedPath", candidate.alternatives,
      candidate.associations, candidate.recurrence_count as "recurrenceCount",
      candidate.governance_version as "governanceVersion", candidate.prompt_version as "promptVersion",
      candidate.model, candidate.created_at as "createdAt"
    from semantic_candidates candidate
    left join entities subject on subject.id = candidate.subject_entity_id
    where candidate.client_id is not distinct from $1 and candidate.status = $2
    order by candidate.created_at desc
  `, [clientId, status]);
  return result.rows;
}

export async function resolveSemanticCandidate(db: Queryable, candidateId: string, input: { action: "approve" | "reject"; targetEntityId?: string; createRule?: boolean }) {
  const result = await db.query<SemanticCandidate>(`select id, client_id as "clientId", event_id as "eventId", subject_entity_id as "subjectEntityId", relation_type as "relationType", target_type as "targetType", target_value as "targetValue", target_normalized_value as "targetNormalizedValue", parent_target_value as "parentTargetValue", confidence::float8, rationale, extractor, status, resolved_target_entity_id as "resolvedTargetEntityId", decision_kind as "decisionKind", domain_value as "domainValue", anchor_role as "anchorRole", proposed_path as "proposedPath", alternatives, associations, recurrence_count as "recurrenceCount", governance_version as "governanceVersion", prompt_version as "promptVersion", model, created_at as "createdAt" from semantic_candidates where id = $1 for update`, [candidateId]);
  const candidate = result.rows[0];
  if (!candidate || candidate.status !== "pending") return null;
  if (input.action === "reject") {
    await db.query(`update semantic_candidates set status = 'rejected', resolved_at = now(), updated_at = now() where id = $1`, [candidateId]);
    return { ...candidate, status: "rejected" as const };
  }
  const target = input.targetEntityId ? await db.query<{ id: string; type: string; value: string; normalizedValue: string }>(`select id, type, value, normalized_value as "normalizedValue" from entities where id = $1`, [input.targetEntityId]) : null;
  const targetRecord = target?.rows[0] ?? await upsertEntity(db, { type: candidate.targetType, value: candidate.targetValue, normalizedValue: candidate.targetNormalizedValue, description: candidate.rationale ?? `A reviewed knowledge concept representing ${candidate.targetValue}.`, identitySource: "ai", metadata: { source: "semantic-review", governanceVersion: candidate.governanceVersion, aiIdentity: true } });
  const targetEntity = { id: targetRecord.id, type: "type" in targetRecord ? targetRecord.type : candidate.targetType, value: targetRecord.value, normalizedValue: targetRecord.normalizedValue };
  if (!candidate.subjectEntityId) throw new Error("Candidate is missing its subject entity");
  const subject = await db.query<{ id: string; type: string; value: string; normalizedValue: string }>(`select id, type, value, normalized_value as "normalizedValue" from entities where id = $1`, [candidate.subjectEntityId]);
  if (!subject.rows[0]) throw new Error("Candidate subject no longer exists");
  if (candidate.decisionKind === "merge") {
    const { mergeEntities } = await import("./entity-repository.js");
    await mergeEntities(db, candidate.subjectEntityId, targetEntity.id, { reason: "semantic_review", confidence: candidate.confidence });
  } else if (candidate.decisionKind === "association") {
    const relation = await upsertRelation(db, { relationType: candidate.relationType, label: candidate.relationType.replace(/_/g, " "), description: candidate.rationale ?? `${subject.rows[0].value} ${candidate.relationType.replace(/_/g, " ")} ${targetEntity.value}`, sourceEntity: subject.rows[0], targetEntity, confidence: candidate.confidence, metadata: { source: "semantic-review", candidateId, governanceVersion: candidate.governanceVersion } }, candidate.subjectEntityId, targetEntity.id);
    if (candidate.eventId) await linkEventRelation(db, candidate.eventId, relation.id, candidate.confidence);
  } else {
    if (candidate.parentTargetValue) {
      const parentType = LIFE_DOMAINS.includes(candidate.parentTargetValue as typeof LIFE_DOMAINS[number]) ? "domain" : "concept";
      const parentRecord = await upsertEntity(db, { type: parentType, value: candidate.parentTargetValue, normalizedValue: normalizeEntityValue(candidate.parentTargetValue), description: candidate.rationale ?? `A reviewed parent concept representing ${candidate.parentTargetValue}.`, identitySource: "ai", metadata: { source: "semantic-review", governanceVersion: candidate.governanceVersion, aiIdentity: true } });
      await setImmediateHierarchyParent(db, { child: targetEntity, parent: { id: parentRecord.id, type: parentRecord.type, value: parentRecord.value, normalizedValue: parentRecord.normalizedValue }, confidence: candidate.confidence, metadata: { source: "semantic-review", candidateId, governanceVersion: candidate.governanceVersion } });
    }
    const relation = await setImmediateHierarchyParent(db, { child: subject.rows[0], parent: targetEntity, confidence: candidate.confidence, metadata: { source: "semantic-review", candidateId, governanceVersion: candidate.governanceVersion } });
    if (candidate.eventId) await linkEventRelation(db, candidate.eventId, relation.id, candidate.confidence);
    await db.query(`
      update entities set identity_source = 'ai'
      where id = $1 and identity_source = 'candidate'
        and nullif(btrim(description), '') is not null
        and coalesce(metadata ->> 'aiIdentity', 'false') = 'true'
    `, [candidate.subjectEntityId]);
    if (candidate.eventId && candidate.domainValue && candidate.anchorRole) {
      const domain = await db.query<{ id: string }>(`select id from entities where type = 'domain' and normalized_value = $1 limit 1`, [normalizeEntityValue(candidate.domainValue)]);
      if (domain.rows[0]) await upsertEventSemanticAnchor(db, { eventId: candidate.eventId, domainEntityId: domain.rows[0].id, anchorEntityId: candidate.subjectEntityId, role: candidate.anchorRole, confidence: candidate.confidence, rationale: candidate.rationale ?? "Approved semantic path", governanceVersion: candidate.governanceVersion ?? SEMANTIC_GOVERNANCE_VERSION });
    }
  }
  if (input.createRule) {
    if (["part_of", "belongs_to_domain"].includes(candidate.relationType)) {
      await db.query(`delete from semantic_rules where client_id is not distinct from $1 and source_type = $2
        and source_normalized_value = $3 and relation_type in ('part_of', 'belongs_to_domain')`,
      [candidate.clientId, subject.rows[0].type, subject.rows[0].normalizedValue]);
    }
    await db.query(`insert into semantic_rules (id, client_id, source_type, source_normalized_value, relation_type, target_entity_id, created_from_candidate_id) values ($1,$2,$3,$4,$5,$6,$7) on conflict (client_id, source_type, source_normalized_value, relation_type) do update set target_entity_id = excluded.target_entity_id, created_from_candidate_id = excluded.created_from_candidate_id, updated_at = now()`, [randomUUID(), candidate.clientId, subject.rows[0].type, subject.rows[0].normalizedValue, candidate.relationType, targetEntity.id, candidateId]);
  }
  await db.query(`update semantic_candidates set status = 'approved', resolved_target_entity_id = $2, resolved_at = now(), updated_at = now() where id = $1`, [candidateId, targetEntity.id]);
  if (candidate.decisionKind !== "association" && candidate.subjectEntityId) {
    await db.query(`update semantic_candidates set status = 'rejected', resolved_at = now(), updated_at = now()
      where id <> $1 and subject_entity_id = $2 and status = 'pending' and relation_type in ('part_of', 'belongs_to_domain')`, [candidateId, candidate.subjectEntityId]);
  }
  return { ...candidate, status: "approved" as const, resolvedTargetEntityId: targetEntity.id };
}
