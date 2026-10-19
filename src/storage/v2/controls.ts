import { randomUUID } from "node:crypto";
import type { Queryable } from "../postgres.js";
import { ApiError, canonicalize } from "../../domain/v2/contracts.js";
import { invalidateDerivedWorkForPolicyChange } from "../privacy.js";
import { sourceFor, missing, utc } from "./observations.js";
import { eventDto, eventVisible, financeVisible } from "./reads.js";

type Row = Record<string, any>;
export async function updatePolicy(db: Queryable, owner: string, id: string, input: { expectedVersion: number; enabled: boolean; externalModelsAllowed: boolean; externalEmbeddingsAllowed: boolean; retentionDays: number | null }) {
  await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`v2:policy:${owner}:${id}`]);
  const source = await sourceFor(db, owner, id);
  const previous = (await db.query(`select * from source_processing_policies where owner_id=$1 and source=$2 for update`, [owner, source.source])).rows[0];
  const version = Number(previous?.policy_version ?? 1);
  if (input.expectedVersion !== version) throw new ApiError(409, "version_conflict", "Source policy version has changed");
  const embeddings = input.externalModelsAllowed && input.externalEmbeddingsAllowed;
  let row: Row;
  if (previous) {
    row = (await db.query(`update source_processing_policies set enabled=$3,send_to_llm=($4 and $5),external_models_allowed=$4,external_embeddings_allowed=$5,retention_days=$6,updated_at=now() where owner_id=$1 and id=$2 returning *`, [owner, previous.id, input.enabled, input.externalModelsAllowed, embeddings, input.retentionDays])).rows[0];
  } else {
    row = (await db.query(`insert into source_processing_policies(id,owner_id,client_scope,source,enabled,send_to_llm,external_models_allowed,external_embeddings_allowed,retention_days,policy_version) values($1,$2,$2,$3,$4,($5 and $6),$5,$6,$7,2) returning *`, [`policy_${randomUUID()}`, owner, source.source, input.enabled, input.externalModelsAllowed, embeddings, input.retentionDays])).rows[0];
  }
  const next = Number(row.policy_version);
  if (next !== version) await invalidateDerivedWorkForPolicyChange(db, { ownerId: owner, source: source.source, previousVersion: version, nextVersion: next });
  let cancelledPendingWorkCount = 0;
  if (!input.enabled) {
    const cancelled = await db.query(`update background_jobs j set status='cancelled',updated_at=now() where j.owner_id=$1 and j.status in ('queued','retry_scheduled') and exists(select 1 from raw_events r where r.id=j.event_id and r.owner_id=$1 and r.source=$2) returning id`, [owner, source.source]);
    cancelledPendingWorkCount = cancelled.rows.length;
  }
  return { sourceInstanceId: id, policyVersion: next, enabled: row.enabled, externalModelsAllowed: row.external_models_allowed, externalEmbeddingsAllowed: row.external_embeddings_allowed, retentionDays: row.retention_days, effectiveAt: utc(row.updated_at), cancelledPendingWorkCount };
}

export async function correct(db: Queryable, owner: string, input: { idempotencyKey: string; target: { type: string; id: string; expectedVersion: number }; field: string; value: unknown; scope: string; ruleMatch: unknown; reason?: string }) {
  await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`v2:correction:${owner}`]);
  const previous = (await db.query(`select * from v2_corrections where owner_id=$1 and idempotency_key=$2`, [owner, input.idempotencyKey])).rows[0];
  const response = (r: Row) => ({ correctionId: r.id, version: r.version, status: r.status, reprocessing: r.reprocessing, affectedCount: r.affected_count, reviewReasons: r.review_reasons });
  if (previous) {
    if (canonicalize(previous.request) !== canonicalize(input)) throw new ApiError(409, "identity_conflict", "Idempotency key has different content");
    return { status: 200, body: response(previous) };
  }
  const target = input.target;
  if (input.ruleMatch && typeof input.ruleMatch === "object" && "sourceInstanceId" in input.ruleMatch) await sourceFor(db, owner, String(input.ruleMatch.sourceInstanceId));
  if (target.type === "episode") throw missing();
  if (target.type === "event") await eventDto(db, owner, target.id);
  if (target.type === "transaction") {
    const row = (await db.query(`select t.id from financial_transactions t where ${financeVisible} and t.id=$2 for update`, [owner, target.id])).rows[0];
    if (!row) throw missing();
  }
  if (target.type === "fact") {
    const row = (await db.query(`select f.id,f.fact_type from knowledge_facts f join raw_events r on r.id=f.event_id where f.owner_id=$1 and f.id=$2 and f.visibility='visible' and ${eventVisible} for update of f`, [owner, target.id])).rows[0];
    if (!row) throw missing();
    if (!["merchant","sender","recipient","amount","currency","category","title","description","reference","status"].includes(row.fact_type.replace(/^entity_/,""))) throw new ApiError(400,"invalid_request","Legacy fact has no supported v2 field mapping");
    if (input.value && typeof input.value === "object" && "factType" in input.value && input.value.factType === "entity_ref" && "value" in input.value) {
      const value = input.value.value as {entityId?:string};
      const entity = (await db.query(`select id from entities where id=$2 and (owner_id=$1 or (owner_id is null and type in ('domain','concept')))`, [owner,value.entityId])).rows[0];
      if (!entity) throw missing();
    }
  }
  if (input.field === "account_id") {
    const account = (await db.query(`select id from financial_accounts where owner_id=$1 and id=$2`, [owner, input.value])).rows[0];
    if (!account) throw missing();
  }
  await db.query(`insert into v2_target_versions(owner_id,target_type,target_id,version,overrides) values($1,$2,$3,1,'{}') on conflict do nothing`, [owner, target.type, target.id]);
  const current = (await db.query(`select * from v2_target_versions where owner_id=$1 and target_type=$2 and target_id=$3 for update`, [owner, target.type, target.id])).rows[0];
  if (current.version !== target.expectedVersion) throw new ApiError(409, "version_conflict", "Target version has changed");
  const review = input.scope === "rule";
  const version = current.version + 1;
  if (!review) {
    const key = ({ event_type: "eventType", occurred_start: "occurredStart", occurred_end: "occurredEnd" } as Record<string,string>)[input.field] ?? input.field;
    await db.query(`update v2_target_versions set version=$4,overrides=overrides || $5::jsonb where owner_id=$1 and target_type=$2 and target_id=$3`, [owner, target.type, target.id, version, JSON.stringify({ [key]: input.value })]);
  }
  const row = (await db.query(`insert into v2_corrections(id,owner_id,idempotency_key,target_type,target_id,expected_version,field,value,scope,rule_match,reason,status,version,affected_count,reprocessing,review_reasons,request,applied_at) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13,$14,'not_required',$15::jsonb,$16::jsonb,now()) returning *`, [`correction_${randomUUID()}`, owner, input.idempotencyKey, target.type, target.id, target.expectedVersion, input.field, JSON.stringify(input.value), input.scope, JSON.stringify(input.ruleMatch), input.reason ?? null, review ? "review" : "applied", review ? current.version : version, review ? 0 : 1, JSON.stringify(review ? ["broad_rule_requires_review"] : []), JSON.stringify(input)])).rows[0];
  return { status: 201, body: response(row) };
}

export async function deletionState(db: Queryable, owner: string, id: string) {
  const row = (await db.query(`select * from deletion_tombstones where owner_id=$1 and id=$2`, [owner, id])).rows[0];
  if (!row) throw missing();
  const complete = ["cleaned", "restore_applied"].includes(row.status);
  return { id: row.id, state: complete ? "completed" : row.status === "cleanup_running" ? "running" : "queued", blockedAt: utc(row.created_at), ...(row.cleaned_at ? { completedAt: utc(row.cleaned_at) } : {}), remainingCategories: complete ? [] : ["raw_events", "derived_knowledge", "embeddings", "financial_records", "backups"], backupExpiryAt: utc(row.backup_expires_at) };
}
