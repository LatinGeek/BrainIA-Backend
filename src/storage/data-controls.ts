import crypto, { randomUUID } from "node:crypto";
import { normalizeEntityValue } from "../domain/entities.js";
import { mergeEntities } from "./entity-repository.js";
import { deleteDerivedDataForEvent, transitionEventProcessingStatus } from "./event-repository.js";
import { pool, withTransaction } from "./postgres.js";
import { setImmediateHierarchyParent } from "./semantic-repository.js";

type Queryable = Pick<typeof pool, "query">;

function fingerprint(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function exportPersonalData(clientId: string | null) {
  const [events, facts, entities, relations, insights, digests, feedback, policies] = await Promise.all([
    pool.query(`select * from raw_events where ($1::text is null or client_id is not distinct from $1) order by created_at`, [clientId]),
    pool.query(`select fact.* from knowledge_facts fact where ($1::text is null or fact.client_id is not distinct from $1) order by fact.created_at`, [clientId]),
    pool.query(`select distinct entity.* from entities entity left join event_entities link on link.entity_id = entity.id left join raw_events event on event.id = link.event_id where $1::text is null or event.client_id is not distinct from $1 or entity.type in ('domain','concept') order by entity.created_at`, [clientId]),
    pool.query(`select distinct relation.* from relations relation left join event_relations link on link.relation_id = relation.id left join raw_events event on event.id = link.event_id where $1::text is null or event.client_id is not distinct from $1 order by relation.created_at`, [clientId]),
    pool.query(`select * from insight_runs order by created_at`, []),
    pool.query(`select * from digest_runs order by created_at`, []),
    pool.query(`select * from knowledge_feedback where $1::text is null or client_id is not distinct from $1 order by created_at`, [clientId]),
    pool.query(`select * from source_processing_policies where client_scope = $1 order by source`, [clientId ?? "anonymous"]),
  ]);
  return {
    format: "brainia-personal-data-v1",
    exportedAt: new Date().toISOString(),
    clientId,
    data: {
      rawEvents: events.rows, knowledgeFacts: facts.rows, entities: entities.rows,
      relations: relations.rows, insights: insights.rows, digests: digests.rows,
      feedback: feedback.rows, sourcePolicies: policies.rows,
    },
  };
}

export async function setEventPrivacy(input: {
  eventId: string;
  clientId: string | null;
  privacyStatus: "standard" | "private" | "hidden";
}) {
  return withTransaction(async (db) => {
    const result = await db.query<{ id: string }>(`
      update raw_events set privacy_status = $3,
        processing_allowed = case when $3 = 'hidden' then false else processing_allowed end
      where id = $1 and ($2::text is null or client_id is not distinct from $2)
      returning id
    `, [input.eventId, input.clientId, input.privacyStatus]);
    if (!result.rows[0]) return null;
    if (input.privacyStatus === "hidden") await transitionEventProcessingStatus(db, {
      eventId: input.eventId, toStatus: "discarded", reason: "user_hidden_evidence",
    });
    await db.query(`update knowledge_facts set visibility = $2, updated_at = now() where event_id = $1`, [
      input.eventId,
      input.privacyStatus === "standard" ? "visible" : input.privacyStatus,
    ]);
    await db.query(`
      insert into data_deletion_audit (id, client_id, target_type, target_fingerprint, mode, counts)
      values ($1,$2,'event',$3,$4,$5::jsonb)
    `, [randomUUID(), input.clientId, fingerprint(input.eventId), input.privacyStatus === "private" ? "private" : "hide", JSON.stringify({ events: 1 })]);
    return { eventId: input.eventId, privacyStatus: input.privacyStatus };
  });
}

export async function setEntityVisibility(input: {
  entityId: string;
  visibility: "visible" | "private" | "hidden";
}) {
  const result = await pool.query(`
    update entities set visibility = $2 where id = $1
    returning id, visibility, value, description
  `, [input.entityId, input.visibility]);
  return result.rows[0] ?? null;
}

export async function deletePersonalData(input: {
  eventId: string;
  clientId: string | null;
  mode: "delete_evidence" | "delete_knowledge" | "delete_all";
  reason?: string | null;
}) {
  return withTransaction(async (db) => {
    const target = await db.query<{ id: string }>(`
      select id from raw_events where id = $1 and ($2::text is null or client_id is not distinct from $2) for update
    `, [input.eventId, input.clientId]);
    if (!target.rows[0]) return null;
    let counts: Record<string, number> = {};
    if (input.mode === "delete_knowledge") {
      const linked = await db.query<{ entityId: string }>(`select entity_id as "entityId" from event_entities where event_id = $1`, [input.eventId]);
      await db.query(`delete from knowledge_embeddings where object_type = 'event' and object_id = $1`, [input.eventId]);
      await deleteDerivedDataForEvent(db, input.eventId);
      if (linked.rows.length) await db.query(`
        delete from knowledge_embeddings embedding where embedding.object_type = 'entity'
          and embedding.object_id = any($1::text[])
          and not exists (select 1 from event_entities link where link.entity_id = embedding.object_id)
      `, [linked.rows.map((row) => row.entityId)]);
      await db.query(`update raw_events set processing_allowed = false where id = $1`, [input.eventId]);
      await transitionEventProcessingStatus(db, { eventId: input.eventId, toStatus: "discarded", reason: "user_deleted_derived_knowledge" });
      counts = { evidence: 0, derivedEvents: 1 };
    } else {
      await db.query(`delete from knowledge_embeddings where object_type = 'event' and object_id = $1`, [input.eventId]);
      const deleted = await db.query(`delete from raw_events where id = $1`, [input.eventId]);
      counts = { evidence: deleted.rowCount ?? 0, derivedCascade: deleted.rowCount ?? 0 };
    }
    await db.query(`
      insert into data_deletion_audit (id, client_id, target_type, target_fingerprint, mode, reason, counts)
      values ($1,$2,'event',$3,$4,$5,$6::jsonb)
    `, [randomUUID(), input.clientId, fingerprint(input.eventId), input.mode, input.reason ?? null, JSON.stringify(counts)]);
    return { eventId: input.eventId, mode: input.mode, counts, recoverable: false };
  });
}

export async function recordKnowledgeFeedback(input: {
  clientId: string | null;
  action: "accept" | "reject" | "merge" | "rename" | "categorize";
  targetType: "event" | "entity" | "relation" | "fact" | "insight" | "candidate";
  targetId: string;
  payload?: Record<string, unknown>;
}) {
  return withTransaction(async (db) => {
    const feedbackId = `feedback_${randomUUID()}`;
    let semanticRuleId: string | null = null;
    let result: unknown = null;
    if ((input.action === "accept" || input.action === "reject") && input.targetType === "candidate") {
      const resolution = await db.query(`
        update semantic_candidates set status = $2, resolved_at = now(), updated_at = now()
        where id = $1 and status = 'pending' returning id, status
      `, [input.targetId, input.action === "accept" ? "approved" : "rejected"]);
      result = resolution.rows[0] ?? null;
    } else if ((input.action === "accept" || input.action === "reject") && input.targetType === "insight") {
      const feedbackStatus = input.action === "accept" ? "accepted" : "rejected";
      const resolution = await db.query(`
        update insight_runs set feedback_status = $2 where id = $1
        returning id, feedback_status as "feedbackStatus"
      `, [input.targetId, feedbackStatus]);
      await db.query(`update insight_candidates set feedback_status = $2, updated_at = now() where id = any(
        select unnest(candidate_ids) from insight_runs where id = $1
      )`, [input.targetId, feedbackStatus]);
      result = resolution.rows[0] ?? null;
    } else if (input.action === "merge" && input.targetType === "entity") {
      const canonicalEntityId = String(input.payload?.canonicalEntityId ?? "").trim();
      if (!canonicalEntityId) throw new Error("canonicalEntityId is required for merge feedback");
      result = await mergeEntities(db, input.targetId, canonicalEntityId, { reason: "user_feedback", confidence: 1 });
    } else if (input.action === "rename" && input.targetType === "entity") {
      const value = String(input.payload?.value ?? "").trim();
      const description = typeof input.payload?.description === "string" ? input.payload.description.trim() : null;
      if (!value) throw new Error("value is required for rename feedback");
      const current = await db.query<{ id: string; value: string }>(`select id, value from entities where id = $1 for update`, [input.targetId]);
      if (!current.rows[0]) throw new Error("entity_not_found");
      await db.query(`
        insert into entity_aliases (id, entity_id, alias, normalized_alias)
        values ($1,$2,$3,$4) on conflict (normalized_alias) do nothing
      `, [randomUUID(), input.targetId, current.rows[0].value, normalizeEntityValue(current.rows[0].value)]);
      const renamed = await db.query(`
        update entities set value = $2, normalized_value = $3,
          description = coalesce($4, description), identity_source = 'user'
        where id = $1 returning id, value, normalized_value as "normalizedValue", description
      `, [input.targetId, value, normalizeEntityValue(value), description]);
      result = renamed.rows[0];
    } else if (input.action === "categorize" && input.targetType === "entity") {
      const parentEntityId = String(input.payload?.parentEntityId ?? "").trim();
      if (!parentEntityId) throw new Error("parentEntityId is required for categorize feedback");
      const rows = await db.query<{ id: string; type: string; value: string; normalizedValue: string }>(`
        select id, type, value, normalized_value as "normalizedValue" from entities where id = any($1::text[])
      `, [[input.targetId, parentEntityId]]);
      const child = rows.rows.find((row) => row.id === input.targetId);
      const parent = rows.rows.find((row) => row.id === parentEntityId);
      if (!child || !parent) throw new Error("entity_or_parent_not_found");
      result = await setImmediateHierarchyParent(db, { child, parent, confidence: 1, metadata: { source: "user_feedback" } });
      semanticRuleId = `rule_${randomUUID()}`;
      await db.query(`
        insert into semantic_rules (id, client_id, source_type, source_normalized_value, relation_type, target_entity_id)
        values ($1,$2,$3,$4,'part_of',$5)
        on conflict (client_id, source_type, source_normalized_value, relation_type)
        do update set target_entity_id = excluded.target_entity_id, updated_at = now()
      `, [semanticRuleId, input.clientId, child.type, child.normalizedValue, parent.id]);
    }
    await db.query(`
      insert into knowledge_feedback (id, client_id, action, target_type, target_id, payload, semantic_rule_id)
      values ($1,$2,$3,$4,$5,$6::jsonb,$7)
    `, [feedbackId, input.clientId, input.action, input.targetType, input.targetId, JSON.stringify(input.payload ?? {}), semanticRuleId]);
    return { id: feedbackId, action: input.action, targetType: input.targetType, targetId: input.targetId, semanticRuleId, result };
  });
}

export async function applyRetentionPolicies(now = new Date()) {
  return withTransaction(async (db) => {
    const targets = await db.query<{ id: string; clientId: string | null; source: string }>(`
      select event.id, event.client_id as "clientId", event.source
      from raw_events event join source_processing_policies policy
        on policy.client_scope = coalesce(event.client_id, 'anonymous') and lower(policy.source) = lower(event.source)
      where policy.retention_days is not null
        and event.created_at < $1::timestamptz - (policy.retention_days || ' days')::interval
      order by event.created_at limit 1000 for update of event skip locked
    `, [now.toISOString()]);
    const byScope = new Map<string, number>();
    for (const target of targets.rows) {
      await db.query(`delete from knowledge_embeddings where object_type = 'event' and object_id = $1`, [target.id]);
      await db.query(`delete from raw_events where id = $1`, [target.id]);
      const key = `${target.clientId ?? "anonymous"}:${target.source}`;
      byScope.set(key, (byScope.get(key) ?? 0) + 1);
      await db.query(`
        insert into data_deletion_audit (id, client_id, target_type, target_fingerprint, mode, reason, counts)
        values ($1,$2,'event',$3,'delete_all','retention_policy',$4::jsonb)
      `, [randomUUID(), target.clientId, fingerprint(target.id), JSON.stringify({ evidence: 1, derivedCascade: 1 })]);
    }
    return { processedAt: now.toISOString(), deleted: targets.rows.length, scopes: Object.fromEntries(byScope) };
  });
}
