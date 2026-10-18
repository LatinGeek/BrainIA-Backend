import crypto, { randomUUID } from "node:crypto";
import { normalizeEntityValue } from "../domain/entities.js";
import { mergeEntities } from "./entity-repository.js";
import { transitionEventProcessingStatus } from "./event-repository.js";
import { invalidateGraphTraversalCache } from "./graph-cache.js";
import { pool, withTransaction } from "./postgres.js";
import { derivedRunReadEligibilitySql } from "./search-repository.js";
import { setImmediateHierarchyParent } from "./semantic-repository.js";

type Queryable = Pick<typeof pool, "query">;

export type DeletionMode = "delete_evidence" | "delete_knowledge" | "delete_all" | "retention";

export type DeletionTombstoneRow = {
  id: string;
  ownerId: string;
  targetType: string;
  targetId: string;
  mode: DeletionMode;
  policy: Record<string, unknown>;
  reason: string | null;
  status: "tombstoned" | "cleanup_running" | "cleaned" | "restore_applied";
  counts: Record<string, number>;
  createdAt: string;
  cleanedAt: string | null;
  backupExpiresAt: string;
  restoreAppliedAt: string | null;
};

/**
 * Proposed backup window. A backup older than this can predate the tombstone
 * ledger, so a restore must be blocked and reviewed rather than served. The
 * database column default is the same 30-day interval; keep both in sync.
 */
export const DELETION_BACKUP_EXPIRY_DAYS = 30;

/**
 * Writes the durable tombstone (the source of truth for restore replay) without
 * touching the target. The caller must quarantine the target in the same
 * transaction before cleanup is allowed to run asynchronously.
 */
export async function recordDeletionTombstone(
  db: Queryable,
  input: {
    ownerId: string;
    targetType: string;
    targetId: string;
    mode: DeletionMode;
    policy?: Record<string, unknown>;
    reason?: string | null;
    backupExpiresAt?: string | null;
  },
) {
  const result = await db.query<DeletionTombstoneRow>(`
    insert into deletion_tombstones (
      id, owner_id, target_type, target_id, mode, policy, reason, status,
      backup_expires_at, created_at
    ) values ($1,$2,$3,$4,$5,$6::jsonb,$7,'tombstoned',$8::timestamptz,now())
    on conflict (owner_id, target_type, target_id) do update set
      mode = excluded.mode,
      policy = excluded.policy,
      reason = coalesce(excluded.reason, deletion_tombstones.reason),
      status = 'tombstoned',
      cleaned_at = null,
      restore_applied_at = null,
      backup_expires_at = greatest(deletion_tombstones.backup_expires_at, excluded.backup_expires_at)
    returning id, owner_id as "ownerId", target_type as "targetType",
      target_id as "targetId", mode, policy, reason, status, counts,
      created_at as "createdAt", cleaned_at as "cleanedAt",
      backup_expires_at as "backupExpiresAt", restore_applied_at as "restoreAppliedAt"
  `, [
    `tombstone_${randomUUID()}`, input.ownerId, input.targetType, input.targetId,
    input.mode, JSON.stringify(input.policy ?? { backupExpiryDays: DELETION_BACKUP_EXPIRY_DAYS }),
    input.reason ?? null,
    input.backupExpiresAt ?? new Date(Date.now() + DELETION_BACKUP_EXPIRY_DAYS * 86_400_000).toISOString(),
  ]);
  return result.rows[0] ?? null;
}

async function recordLineage(
  db: Queryable,
  input: {
    tombstoneId: string;
    ownerId: string;
    targetType: string;
    targetId: string;
    disposition: "tombstoned" | "deleted" | "invalidated" | "detached" | "retained";
    reason?: string | null;
  },
) {
  await db.query(`
    insert into deletion_tombstone_targets (
      id, tombstone_id, owner_id, target_type, target_id, disposition, reason
    ) values ($1,$2,$3,$4,$5,$6,$7)
    on conflict (tombstone_id, target_type, target_id) do update set
      disposition = excluded.disposition, reason = excluded.reason
  `, [
    `lineage_${randomUUID()}`, input.tombstoneId, input.ownerId, input.targetType,
    input.targetId, input.disposition, input.reason ?? null,
  ]);
}

async function recordLineageRows(
  db: Queryable,
  tombstone: DeletionTombstoneRow,
  targetType: string,
  ids: string[],
  disposition: "tombstoned" | "deleted" | "invalidated" | "detached" | "retained",
) {
  for (const id of [...new Set(ids.filter(Boolean))]) {
    await recordLineage(db, {
      tombstoneId: tombstone.id, ownerId: tombstone.ownerId, targetType,
      targetId: id, disposition,
    });
  }
}

async function stringIds(db: Queryable, sql: string, params: unknown[]) {
  const result = await db.query<{ id: string }>(sql, params);
  return result.rows.map((row) => row.id);
}

async function eventInsightIds(db: Queryable, ownerId: string, eventId: string) {
  return stringIds(db, `
    select id from insight_runs
    where owner_id = $1 and (
      strpos(coalesce(evidence::text, ''), $2) > 0
      or strpos(coalesce(request::text, ''), $2) > 0
      or strpos(coalesce(response::text, ''), $2) > 0
      or exists (
        select 1 from event_entities link
        where link.event_id = $2 and (
          strpos(coalesce(insight_runs.evidence::text, ''), link.entity_id) > 0
          or strpos(coalesce(insight_runs.request::text, ''), link.entity_id) > 0
          or strpos(coalesce(insight_runs.response::text, ''), link.entity_id) > 0
        )
      )
    )
  `, [ownerId, eventId]);
}

async function eventDigestIds(db: Queryable, ownerId: string, eventId: string) {
  return stringIds(db, `
    select id from digest_runs
    where owner_id = $1 and (
      strpos(coalesce(request::text, ''), $2) > 0
      or strpos(coalesce(response::text, ''), $2) > 0
      or strpos(coalesce(summary, ''), $2) > 0
      -- Window digests may never have persisted the event id. A digest whose
      -- window contains the deleted event is not safe to serve either.
      or exists (
        select 1 from raw_events event
        where event.id = $2
          and digest_runs.window_from is not null
          and digest_runs.window_to is not null
          and coalesce(event.timestamp, event.created_at)
            between digest_runs.window_from and digest_runs.window_to
      )
    )
  `, [ownerId, eventId]);
}

async function eventArtifactIds(db: Queryable, ownerId: string, eventId: string) {
  return stringIds(db, `
    select distinct artifact_id as id from intelligence_dependencies where event_id = $1
    union
    select id from intelligence_artifacts
    where coalesce(owner_id, client_id) = $2
      and (
        strpos(coalesce(evidence::text, ''), $1) > 0
        or strpos(coalesce(checkpoint::text, ''), $1) > 0
      )
  `, [eventId, ownerId]);
}

async function eventCandidateIds(db: Queryable, ownerId: string, eventId: string, transactionIds: string[]) {
  const markers = [eventId, ...transactionIds];
  const result = await db.query<{ id: string }>(`
    select id from insight_candidates
    where coalesce(owner_id, client_id) = $1
      and (${markers.map((_marker, index) => `strpos(coalesce(evidence::text, ''), $${index + 2}) > 0`).join(" or ")})
  `, [ownerId, ...markers]);
  return result.rows.map((row) => row.id);
}

async function eventTransactionIds(db: Queryable, eventId: string) {
  return stringIds(db, `
    select distinct transaction_id as id from financial_transaction_events where raw_event_id = $1
    union
    select id from financial_transactions where anchor_event_id = $1
  `, [eventId]);
}

/**
 * Makes the target and everything reachable from it immediately ineligible.
 * This is deliberately separate from physical cleanup: the tombstone commits
 * first, and reads/retrieval/model dispatch consult the resulting flags and
 * ledger before any cleanup worker can run.
 */
export async function quarantineDeletedTarget(db: Queryable, tombstone: DeletionTombstoneRow) {
  if (tombstone.targetType === "intelligence_artifact") {
    await db.query(`
      update intelligence_artifacts set status = 'stale', content = null, evidence = '[]'::jsonb,
        checkpoint = '{}'::jsonb, updated_at = now()
      where id = $1 and coalesce(owner_id, client_id) = $2
    `, [tombstone.targetId, tombstone.ownerId]);
    return;
  }
  if (tombstone.targetType === "insight" || tombstone.targetType === "digest") {
    const table = tombstone.targetType === "insight" ? "insight_runs" : "digest_runs";
    await db.query(`
      update ${table} set summary = null${tombstone.targetType === "insight" ? ", query = null, evidence = '[]'::jsonb, response = '{}'::jsonb" : ", request = '{}'::jsonb, response = '{}'::jsonb"}
      where id = $1 and owner_id = $2
    `, [tombstone.targetId, tombstone.ownerId]);
    return;
  }
  if (tombstone.targetType === "entity") {
    await db.query(`update entities set visibility = 'hidden' where id = $1 and owner_id = $2`, [
      tombstone.targetId, tombstone.ownerId,
    ]);
    await db.query(`update knowledge_embeddings set metadata = metadata || '{"deleted":true,"policyStale":true}'::jsonb where object_type = 'entity' and object_id = $1`, [tombstone.targetId]);
    invalidateGraphTraversalCache();
    return;
  }
  if (tombstone.targetType === "fact") {
    await db.query(`update knowledge_facts set visibility = 'hidden' where id = $1 and coalesce(owner_id, client_id) = $2`, [
      tombstone.targetId, tombstone.ownerId,
    ]);
    await db.query(`update knowledge_embeddings set metadata = metadata || '{"deleted":true,"policyStale":true}'::jsonb where object_type = 'fact' and object_id = $1`, [tombstone.targetId]);
    return;
  }
  if (tombstone.targetType !== "event") return;

  const eventId = tombstone.targetId;
  const ownerId = tombstone.ownerId;
  const entityIds = await stringIds(db, `
    select entity_id as id from event_entities where event_id = $1
  `, [eventId]);
  const transactionIds = await eventTransactionIds(db, eventId);
  const insightIds = await eventInsightIds(db, ownerId, eventId);
  const digestIds = await eventDigestIds(db, ownerId, eventId);
  const artifactIds = await eventArtifactIds(db, ownerId, eventId);
  const candidateIds = await eventCandidateIds(db, ownerId, eventId, transactionIds);

  // Persist the derived ids before redacting their content, so cleanup does not
  // depend on text that is intentionally made unreadable in this step.
  await recordLineageRows(db, tombstone, "insight", insightIds, "tombstoned");
  await recordLineageRows(db, tombstone, "digest", digestIds, "tombstoned");
  await recordLineageRows(db, tombstone, "intelligence_artifact", artifactIds, "tombstoned");
  await recordLineageRows(db, tombstone, "insight_candidate", candidateIds, "tombstoned");
  await recordLineageRows(db, tombstone, "financial_transaction", transactionIds, "tombstoned");

  await db.query(`
    update raw_events set privacy_status = 'hidden', processing_allowed = false,
      processing_status = 'discarded', processing_status_reason = $2,
      processing_status_updated_at = now()
    where id = $1 and (
      ($3::text = 'anonymous' and owner_id is null and client_id is null)
      or coalesce(owner_id, client_id) = $3
    )
  `, [eventId, `deletion_tombstone:${tombstone.id}`, ownerId]);

  await db.query(`update knowledge_facts set visibility = 'hidden' where event_id = $1`, [eventId]);
  await db.query(`update classification_corrections set revoked_at = now() where event_id = $1 and revoked_at is null`, [eventId]);
  await db.query(`update insight_candidates set status = 'expired', evidence = '[]'::jsonb, updated_at = now() where id = any($1::text[])`, [candidateIds]);
  await db.query(`
    update insight_runs set summary = null, query = null, evidence = '[]'::jsonb,
      response = '{}'::jsonb, request = '{}'::jsonb
    where id = any($1::text[])
  `, [insightIds]);
  await db.query(`
    update digest_runs set scope = null, summary = null, request = '{}'::jsonb, response = '{}'::jsonb
    where id = any($1::text[])
  `, [digestIds]);
  await db.query(`
    update intelligence_artifacts set status = 'stale', content = null, evidence = '[]'::jsonb,
      checkpoint = '{}'::jsonb, updated_at = now()
    where id = any($1::text[]) and status not in ('cancelled')
  `, [artifactIds]);

  // Derived embeddings are marked stale immediately. Physical deletion follows
  // in cleanup; the retrieval branches already exclude policyStale rows.
  await db.query(`
    update knowledge_embeddings set metadata = metadata || '{"deleted":true,"policyStale":true}'::jsonb
    where (object_type = 'event' and object_id = $1)
      or (object_type = 'fact' and object_id in (select id from knowledge_facts where event_id = $1))
      or (object_type = 'entity' and object_id = any($2::text[]))
      or (object_type = 'insight' and object_id = any($3::text[]))
      or (object_type = 'digest' and object_id = any($4::text[]))
  `, [eventId, entityIds, insightIds, digestIds]);

  // Hide only entities that have no other eligible supporting observation.
  await db.query(`
    update entities entity set visibility = 'hidden'
    where entity.id = any($1::text[]) and entity.visibility <> 'hidden'
      and not exists (
        select 1 from event_entities link
        join raw_events event on event.id = link.event_id
        where link.entity_id = entity.id and event.id <> $2
          and event.privacy_status = 'standard' and event.processing_allowed
      )
  `, [entityIds, eventId]);

  invalidateGraphTraversalCache();
}

/**
 * Physical cleanup. Safe to retry: it re-reads the current rows, preserves a
 * canonical finance row that has other supporting evidence, and records the
 * disposition of every derived family in the lineage ledger.
 */
export async function applyDeletionTombstoneCleanup(
  db: Queryable,
  tombstone: DeletionTombstoneRow,
) {
  await db.query(`
    update deletion_tombstones set status = 'cleanup_running', cleanup_started_at = coalesce(cleanup_started_at, now())
    where id = $1
  `, [tombstone.id]);
  const counts: Record<string, number> = {};
  const countRows = (key: string, result: { rowCount?: number | null; rows?: unknown[] }) => {
    counts[key] = (result.rowCount ?? result.rows?.length ?? 0) as number;
  };

  if (tombstone.targetType === "intelligence_artifact") {
    const deleted = await db.query(`delete from intelligence_artifacts where id = $1 and coalesce(owner_id, client_id) = $2`, [tombstone.targetId, tombstone.ownerId]);
    countRows("artifacts", deleted);
  } else if (tombstone.targetType === "insight" || tombstone.targetType === "digest") {
    const table = tombstone.targetType === "insight" ? "insight_runs" : "digest_runs";
    const deleted = await db.query(`delete from ${table} where id = $1 and owner_id = $2`, [tombstone.targetId, tombstone.ownerId]);
    countRows(`${tombstone.targetType}s`, deleted);
  } else if (tombstone.targetType === "entity") {
    const deleted = await db.query(`delete from entities where id = $1 and owner_id = $2`, [tombstone.targetId, tombstone.ownerId]);
    countRows("entities", deleted);
  } else if (tombstone.targetType === "fact") {
    const deleted = await db.query(`delete from knowledge_facts where id = $1 and coalesce(owner_id, client_id) = $2`, [tombstone.targetId, tombstone.ownerId]);
    countRows("facts", deleted);
  } else if (tombstone.targetType === "event") {
    const eventId = tombstone.targetId;
    const ownerId = tombstone.ownerId;
    const lineageIds = async (targetType: string) => stringIds(db, `
      select target_id as id from deletion_tombstone_targets
      where tombstone_id = $1 and target_type = $2
    `, [tombstone.id, targetType]);
    const entityIds = await stringIds(db, `select entity_id as id from event_entities where event_id = $1`, [eventId]);
    const transactionIds = [...new Set([
      ...(await eventTransactionIds(db, eventId)),
      ...(await lineageIds("financial_transaction")),
    ])];
    const insightIds = [...new Set([...(await eventInsightIds(db, ownerId, eventId)), ...(await lineageIds("insight"))])];
    const digestIds = [...new Set([...(await eventDigestIds(db, ownerId, eventId)), ...(await lineageIds("digest"))])];
    const artifactIds = [...new Set([...(await eventArtifactIds(db, ownerId, eventId)), ...(await lineageIds("intelligence_artifact"))])];
    const candidateIds = [...new Set([
      ...(await eventCandidateIds(db, ownerId, eventId, transactionIds)),
      ...(await lineageIds("insight_candidate")),
    ])];

    // Capture ids for lineage before the rows disappear.
    const factIds = await stringIds(db, `select id from knowledge_facts where event_id = $1`, [eventId]);
    const correctionIds = await stringIds(db, `select id from classification_corrections where event_id = $1`, [eventId]);
    const decisionIds = await stringIds(db, `select id from classification_decisions where event_id = $1`, [eventId]);
    const classifiedIds = await stringIds(db, `select id from classified_events where raw_event_id = $1`, [eventId]);
    const semanticIds = [
      ...(await stringIds(db, `select id from semantic_candidates where event_id = $1`, [eventId])),
      ...(await stringIds(db, `select id from semantic_observations where event_id = $1`, [eventId])),
      ...(await stringIds(db, `select event_id as id from semantic_event_decisions where event_id = $1`, [eventId])),
      ...(await stringIds(db, `select event_id as id from event_semantic_anchors where event_id = $1`, [eventId])),
    ];
    const relationIds = await stringIds(db, `select relation_id as id from event_relations where event_id = $1`, [eventId]);
    const diagnosticIds = await stringIds(db, `
      select id from client_diagnostic_logs
      where coalesce(owner_id, client_id) = $1 and (
        strpos(coalesce(metadata::text, ''), $2) > 0 or strpos(message, $2) > 0
      )
    `, [ownerId, eventId]);

    // Finance: delete only when this event is the sole supporting observation.
    for (const transactionId of transactionIds) {
      const other = await db.query<{ rawEventId: string }>(`
        select raw_event_id as "rawEventId" from financial_transaction_events
        where transaction_id = $1 and raw_event_id <> $2 order by created_at limit 1
      `, [transactionId, eventId]);
      if (!other.rows[0]) {
        const deleted = await db.query(`delete from financial_transactions where id = $1`, [transactionId]);
        counts.financialTransactions = (counts.financialTransactions ?? 0) + (deleted.rowCount ?? 0);
      } else {
        await db.query(`delete from financial_transaction_events where transaction_id = $1 and raw_event_id = $2`, [transactionId, eventId]);
        await db.query(`
          update financial_transactions transaction set
            anchor_event_id = case when transaction.anchor_event_id = $2 then $3 else transaction.anchor_event_id end,
            evidence_count = (select count(distinct raw_event_id) from financial_transaction_events where transaction_id = transaction.id),
            updated_at = now()
          where transaction.id = $1
        `, [transactionId, eventId, other.rows[0].rawEventId]);
        counts.financialEvidenceDetached = (counts.financialEvidenceDetached ?? 0) + 1;
      }
    }

    const embeddings = await db.query(`
      delete from knowledge_embeddings
      where (object_type = 'event' and object_id = $1)
        or (object_type = 'fact' and object_id = any($2::text[]))
        or (object_type = 'entity' and object_id = any($3::text[]))
        or (object_type = 'insight' and object_id = any($4::text[]))
        or (object_type = 'digest' and object_id = any($5::text[]))
    `, [eventId, factIds, entityIds, insightIds, digestIds]);
    countRows("embeddings", embeddings);

    countRows("facts", await db.query(`delete from knowledge_facts where event_id = $1`, [eventId]));
    countRows("classifiedEvents", await db.query(`delete from classified_events where raw_event_id = $1`, [eventId]));
    countRows("classificationCorrections", await db.query(`delete from classification_corrections where event_id = $1`, [eventId]));
    countRows("classificationDecisions", await db.query(`delete from classification_decisions where event_id = $1`, [eventId]));
    countRows("semanticCandidates", await db.query(`delete from semantic_candidates where event_id = $1`, [eventId]));
    countRows("semanticObservations", await db.query(`delete from semantic_observations where event_id = $1`, [eventId]));
    countRows("semanticDecisions", await db.query(`delete from semantic_event_decisions where event_id = $1`, [eventId]));
    countRows("semanticAnchors", await db.query(`delete from event_semantic_anchors where event_id = $1`, [eventId]));

    await db.query(`delete from intelligence_dependencies where event_id = $1`, [eventId]);
    for (const artifactId of artifactIds) {
      const dependencies = await db.query<{ count: number }>(`select count(*)::int as count from intelligence_dependencies where artifact_id = $1`, [artifactId]);
      if ((dependencies.rows[0]?.count ?? 0) === 0) {
        await db.query(`delete from intelligence_confirmations where artifact_id = $1`, [artifactId]);
        await db.query(`delete from intelligence_revisions where artifact_id = $1`, [artifactId]);
        await db.query(`delete from intelligence_feedback where artifact_id = $1`, [artifactId]);
        await db.query(`delete from intelligence_artifacts where id = $1`, [artifactId]);
        counts.intelligenceArtifacts = (counts.intelligenceArtifacts ?? 0) + 1;
      } else {
        await db.query(`
          update intelligence_artifacts set status = 'stale', content = null, evidence = '[]'::jsonb,
            checkpoint = '{}'::jsonb, updated_at = now() where id = $1
        `, [artifactId]);
        counts.intelligenceArtifactsInvalidated = (counts.intelligenceArtifactsInvalidated ?? 0) + 1;
      }
    }

    await db.query(`
      delete from knowledge_feedback
      where (target_type = 'event' and target_id = $1)
        or (target_type = 'candidate' and target_id = any($2::text[]))
        or (target_type = 'insight' and target_id = any($3::text[]))
        or (target_type = 'fact' and target_id = any($4::text[]))
    `, [eventId, candidateIds, insightIds, factIds]);
    countRows("insightCandidates", await db.query(`delete from insight_candidates where id = any($1::text[])`, [candidateIds]));
    countRows("insightRuns", await db.query(`delete from insight_runs where id = any($1::text[])`, [insightIds]));
    countRows("digestRuns", await db.query(`delete from digest_runs where id = any($1::text[])`, [digestIds]));

    await db.query(`delete from event_relations where event_id = $1`, [eventId]);
    for (const relationId of relationIds) {
      await db.query(`
        delete from relations relation
        where relation.id = $1 and relation.owner_id = $2
          and not exists (select 1 from event_relations link where link.relation_id = relation.id)
      `, [relationId, ownerId]);
    }
    await db.query(`delete from event_entities where event_id = $1`, [eventId]);

    countRows("clientDiagnostics", await db.query(`delete from client_diagnostic_logs where id = any($1::text[])`, [diagnosticIds]));
    await db.query(`
      update background_jobs set status = 'cancelled', updated_at = now(), completed_at = now()
      where status in ('queued', 'retry_scheduled', 'running')
        and (event_id = $1 or strpos(coalesce(payload::text, ''), $1) > 0)
    `, [eventId]);

    await recordLineageRows(db, tombstone, "knowledge_fact", factIds, "deleted");
    await recordLineageRows(db, tombstone, "classified_event", classifiedIds, "deleted");
    await recordLineageRows(db, tombstone, "classification_correction", correctionIds, "deleted");
    await recordLineageRows(db, tombstone, "classification_decision", decisionIds, "deleted");
    await recordLineageRows(db, tombstone, "semantic", semanticIds, "deleted");
    await recordLineageRows(db, tombstone, "relation", relationIds, "deleted");
    await recordLineageRows(db, tombstone, "insight", insightIds, "deleted");
    await recordLineageRows(db, tombstone, "digest", digestIds, "deleted");
    await recordLineageRows(db, tombstone, "intelligence_artifact", artifactIds, "invalidated");
    await recordLineageRows(db, tombstone, "financial_transaction", transactionIds, "retained");
    await recordLineageRows(db, tombstone, "client_diagnostic", diagnosticIds, "deleted");

    if (tombstone.mode === "delete_evidence" || tombstone.mode === "delete_all" || tombstone.mode === "retention") {
      countRows("evidence", await db.query(`
        delete from raw_events where id = $1 and (
          ($2::text = 'anonymous' and owner_id is null and client_id is null)
          or coalesce(owner_id, client_id) = $2
        )
      `, [eventId, ownerId]));
    } else {
      await db.query(`
        update raw_events set privacy_status = 'hidden', processing_allowed = false,
          processing_status = 'discarded', processing_status_reason = $2,
          processing_status_updated_at = now()
        where id = $1 and (
          ($3::text = 'anonymous' and owner_id is null and client_id is null)
          or coalesce(owner_id, client_id) = $3
        )
      `, [eventId, `deletion_tombstone:${tombstone.id}`, ownerId]);
      counts.evidenceRetainedHidden = 1;
    }
    counts.derivedRowsTombstoned = Object.entries(counts)
      .filter(([key]) => key !== "evidence" && key !== "evidenceRetainedHidden")
      .reduce((sum, [, value]) => sum + value, 0);
  }

  await db.query(`
    update deletion_tombstones set status = 'cleaned', cleaned_at = now(), counts = $2::jsonb
    where id = $1
  `, [tombstone.id, JSON.stringify(counts)]);
  await db.query(`
    insert into data_deletion_audit (id, client_id, target_type, target_fingerprint, mode, reason, counts)
    values ($1,$2,$3,$4,$5,$6,$7::jsonb)
  `, [
    randomUUID(), tombstone.ownerId, tombstone.targetType, fingerprint(tombstone.targetId),
    tombstone.mode === "retention" ? "delete_all" : tombstone.mode,
    tombstone.reason ?? "deletion_tombstone", JSON.stringify(counts),
  ]);
  return counts;
}

function fingerprint(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function exportPersonalData(clientId: string | null) {
  const [events, facts, entities, relations, insights, digests, feedback, policies] = await Promise.all([
    pool.query(`
      select * from raw_events event
      where ($1::text is null or event.client_id is not distinct from $1)
        and event.privacy_status <> 'hidden'
        and event.processing_allowed
        and not exists (
          select 1 from deletion_tombstones tombstone
          where tombstone.target_type = 'event' and tombstone.target_id = event.id
        )
      order by event.created_at
    `, [clientId]),
    pool.query(`
      select fact.* from knowledge_facts fact
      where ($1::text is null or fact.client_id is not distinct from $1)
        and fact.visibility <> 'hidden'
        and not exists (
          select 1 from deletion_tombstones tombstone
          where tombstone.target_type = 'fact' and tombstone.target_id = fact.id
        )
        and not exists (
          select 1 from deletion_tombstones tombstone
          join raw_events event on event.id = tombstone.target_id
          where tombstone.target_type = 'event' and event.id = fact.event_id
        )
      order by fact.created_at
    `, [clientId]),
    pool.query(`
      select distinct entity.* from entities entity
      left join event_entities link on link.entity_id = entity.id
      left join raw_events event on event.id = link.event_id
        and event.privacy_status <> 'hidden' and event.processing_allowed
      where ($1::text is null or event.client_id is not distinct from $1 or entity.type in ('domain','concept'))
        and entity.visibility <> 'hidden'
        and not exists (
          select 1 from deletion_tombstones tombstone
          where tombstone.target_type = 'entity' and tombstone.target_id = entity.id
        )
      order by entity.created_at
    `, [clientId]),
    pool.query(`
      select distinct relation.* from relations relation
      join entities source on source.id = relation.source_entity_id
      join entities target on target.id = relation.target_entity_id
      left join event_relations link on link.relation_id = relation.id
      left join raw_events event on event.id = link.event_id
        and event.privacy_status <> 'hidden' and event.processing_allowed
      where ($1::text is null or event.client_id is not distinct from $1)
        and source.visibility <> 'hidden'
        and target.visibility <> 'hidden'
        and not exists (
          select 1 from deletion_tombstones tombstone
          where tombstone.target_type = 'relation' and tombstone.target_id = relation.id
        )
        and (
          not exists (select 1 from event_relations event_link where event_link.relation_id = relation.id)
          or event.id is not null
        )
      order by relation.created_at
    `, [clientId]),
    pool.query(`
      select * from insight_runs run
      where ($1::text is null or run.owner_id is not distinct from $1)
        and run.summary is not null
        and ${derivedRunReadEligibilitySql("insight_runs", "run")}
      order by run.created_at
    `, [clientId]),
    pool.query(`
      select * from digest_runs run
      where ($1::text is null or run.owner_id is not distinct from $1)
        and run.summary is not null
        and ${derivedRunReadEligibilitySql("digest_runs", "run")}
      order by run.created_at
    `, [clientId]),
    pool.query(`
      select * from knowledge_feedback item
      where ($1::text is null or item.client_id is not distinct from $1)
        and not exists (
          select 1 from raw_events event
          where item.target_type = 'event' and event.id = item.target_id
            and (event.privacy_status = 'hidden' or not event.processing_allowed)
        )
      order by item.created_at
    `, [clientId]),
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
  clientId?: string | null;
  visibility: "visible" | "private" | "hidden";
}) {
  const result = await pool.query(`
    update entities entity set visibility = $2
    where entity.id = $1 and (
      $3::text is null
      or entity.owner_id = $3
      or (entity.owner_id is null and entity.type in ('domain','concept'))
      or (entity.owner_id is null and exists (
        select 1 from event_entities link join raw_events event on event.id = link.event_id
        where link.entity_id = entity.id and event.client_id = $3
      ))
    )
    returning id, visibility, value, description
  `, [input.entityId, input.visibility, input.clientId ?? null]);
  return result.rows[0] ?? null;
}

/**
 * Step 1 of deletion: write the durable tombstone and make the target
 * ineligible before any asynchronous cleanup. Ownership is mandatory and the
 * lookup is owner-scoped, so a foreign or missing target returns null without
 * writing a tombstone or mutating any row.
 */
export async function tombstoneDeletion(input: {
  eventId: string;
  clientId: string | null;
  ownerId?: string | null;
  mode: DeletionMode;
  reason?: string | null;
}) {
  const ownerId = input.ownerId?.trim() || input.clientId?.trim() || null;
  // Legacy local mode has no principal. It may only delete a legacy anonymous
  // event (both owner_id and client_id null); it can never reach owned rows.
  const ownerScope = ownerId ?? "anonymous";
  return withTransaction(async (db) => {
    const target = await db.query<{ id: string }>(`
      select id from raw_events
      where id = $1 and (
        ($2::text = 'anonymous' and owner_id is null and client_id is null)
        or coalesce(owner_id, client_id) = $2
      )
      for update
    `, [input.eventId, ownerScope]);
    if (!target.rows[0]) return null;
    const tombstone = await recordDeletionTombstone(db, {
      ownerId: ownerScope === "anonymous" ? "anonymous" : ownerScope,
      targetType: "event",
      targetId: input.eventId,
      mode: input.mode,
      reason: input.reason ?? "user_requested_deletion",
      policy: {
        backupExpiryDays: DELETION_BACKUP_EXPIRY_DAYS,
        deletionMode: input.mode,
        policyVersion: 1,
      },
    });
    if (!tombstone) return null;
    await quarantineDeletedTarget(db, tombstone);
    await recordLineage(db, {
      tombstoneId: tombstone.id, ownerId: tombstone.ownerId, targetType: "event",
      targetId: input.eventId, disposition: "tombstoned",
    });
    return tombstone;
  });
}

/**
 * Step 2 of deletion: physical cleanup runs only after the tombstone committed.
 * A failure leaves the tombstone and the quarantine flags in place, so the
 * target stays ineligible and the cleanup can be retried.
 */
export async function deletePersonalData(input: {
  eventId: string;
  clientId: string | null;
  ownerId?: string | null;
  mode: DeletionMode;
  reason?: string | null;
}) {
  const tombstone = await tombstoneDeletion(input);
  if (!tombstone) return null;
  const counts = await withTransaction((db) => applyDeletionTombstoneCleanup(db, tombstone));
  return {
    eventId: input.eventId,
    mode: input.mode,
    counts,
    recoverable: false,
    tombstoneId: tombstone.id,
    backupExpiresAt: tombstone.backupExpiresAt,
  };
}

/**
 * Restore-time replay. Inserts the tombstone ledger row if it is absent,
 * quarantines the target, and cleans it before the restored database is
 * exposed. The caller must run this before serving traffic.
 */
export async function replayDeletionTombstone(
  db: Queryable,
  input: {
    ownerId: string;
    targetType: string;
    targetId: string;
    mode: DeletionMode;
    policy?: Record<string, unknown>;
    reason?: string | null;
    backupExpiresAt?: string | null;
  },
) {
  const tombstone = await recordDeletionTombstone(db, input);
  if (!tombstone) return null;
  await quarantineDeletedTarget(db, tombstone);
  const counts = await applyDeletionTombstoneCleanup(db, tombstone);
  await db.query(`
    update deletion_tombstones set status = 'restore_applied', restore_applied_at = now()
    where id = $1
  `, [tombstone.id]);
  return { tombstoneId: tombstone.id, counts };
}

async function entityOwnedBy(db: Queryable, entityId: string, clientId: string) {
  const result = await db.query(
    `select 1 from entities
     where id = $1 and (owner_id = $2 or (owner_id is null and type in ('domain','concept')))
     limit 1`,
    [entityId, clientId],
  );
  return (result.rowCount ?? result.rows.length) > 0;
}

// Every feedback action mutates (or records a decision about) an existing row.
// A scoped caller may only target rows it owns; legacy null-owner rows are not
// guessed into an owner. Returning false aborts the transaction before any
// update, so a foreign id leaves no row and no feedback entry behind.
async function feedbackTargetOwnedBy(
  db: Queryable,
  input: { clientId: string | null; targetType: string; targetId: string },
) {
  if (!input.clientId) return true;
  const clientId = input.clientId;
  const result = await db.query(
    input.targetType === "event"
      ? `select 1 from raw_events where id = $1 and (owner_id = $2 or (owner_id is null and client_id = $2)) limit 1`
      : input.targetType === "entity"
        ? `select 1 from entities
           where id = $1 and (owner_id = $2 or (owner_id is null and type in ('domain','concept')))
           limit 1`
        : input.targetType === "relation"
          ? `select 1 from relations r
             where r.id = $1 and (
               r.owner_id = $2
               or (r.owner_id is null and exists (
                 select 1 from entities e
                 where e.id in (r.source_entity_id, r.target_entity_id) and e.owner_id = $2
               ))
             ) limit 1`
          : input.targetType === "fact"
            ? `select 1 from knowledge_facts where id = $1 and (owner_id = $2 or (owner_id is null and client_id = $2)) limit 1`
            : input.targetType === "insight"
              ? `select 1 from insight_runs where id = $1 and owner_id = $2 limit 1`
              : input.targetType === "candidate"
                ? `select 1 from semantic_candidates
                   where id = $1 and (owner_id = $2 or (owner_id is null and client_id = $2))
                   limit 1`
                : `select 1 where false`,
    [input.targetId, clientId],
  );
  return (result.rowCount ?? result.rows.length) > 0;
}

export async function recordKnowledgeFeedback(input: {
  clientId: string | null;
  action: "accept" | "reject" | "merge" | "rename" | "categorize";
  targetType: "event" | "entity" | "relation" | "fact" | "insight" | "candidate";
  targetId: string;
  payload?: Record<string, unknown>;
}) {
  return withTransaction(async (db) => {
    if (!(await feedbackTargetOwnedBy(db, input))) return null;
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
      if (input.clientId && !(await entityOwnedBy(db, canonicalEntityId, input.clientId))) return null;
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
      if (input.clientId && !(await entityOwnedBy(db, parentEntityId, input.clientId))) return null;
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
  const targets = await pool.query<{ id: string; clientId: string | null; ownerId: string | null; source: string }>(`
    select event.id, event.client_id as "clientId", event.owner_id as "ownerId", event.source
    from raw_events event join source_processing_policies policy
      on policy.client_scope = coalesce(event.client_id, 'anonymous') and lower(policy.source) = lower(event.source)
    where policy.retention_days is not null
      and event.privacy_status = 'standard' and event.processing_allowed
      and event.created_at < $1::timestamptz - (policy.retention_days || ' days')::interval
    order by event.created_at limit 1000
  `, [now.toISOString()]);
  const byScope = new Map<string, number>();
  let deleted = 0;
  for (const target of targets.rows) {
    const ownerId = target.ownerId ?? target.clientId;
    if (!ownerId) continue;
    // Retention uses the same tombstone-first path as user deletion. The
    // 30-day backup expiry is recorded on each tombstone.
    const result = await deletePersonalData({
      eventId: target.id,
      clientId: target.clientId,
      ownerId,
      mode: "retention",
      reason: "retention_policy",
    });
    if (!result) continue;
    deleted += 1;
    const key = `${target.ownerId ?? target.clientId ?? "anonymous"}:${target.source}`;
    byScope.set(key, (byScope.get(key) ?? 0) + 1);
  }
  return { processedAt: now.toISOString(), deleted, scopes: Object.fromEntries(byScope) };
}
