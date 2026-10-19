import { randomUUID, createHash } from "node:crypto";
import type { Queryable } from "../postgres.js";
import { ApiError } from "../../domain/v2/contracts.js";
import { observationDto, revisionDto, visibleObservation, missing, utc } from "./observations.js";
import { eventDto, eventVisible, financeVisible, transactionDto, targetVersion } from "./reads.js";
import { decodeCursor, encodeCursor } from "./cursors.js";

type Row = Record<string, any>;
export async function factDto(db: Queryable, owner: string, row: Row, revision: Row) {
  const field = row.fact_type.replace(/^entity_/, "");
  if (!["merchant", "sender", "recipient", "amount", "currency", "category", "title", "description", "reference", "status"].includes(field)) return null;
  const overlay = await targetVersion(db, owner, "fact", row.id);
  const corrected = overlay.overrides.fact_value;
  const value = corrected?.value ?? row.value?.value;
  if (!corrected && typeof value !== "string") return null;
  const decimal = typeof value === "string" && /^-?(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/.test(value);
  const factType = corrected?.factType ?? (field === "amount" && decimal ? "decimal" : "string");
  const modelRevision = row.model_version ?? null;
  return { id: row.id, field, revisionId: revision.id, evidence: { pointer: "/content", start: null, end: null, excerptHash: createHash("sha256").update(JSON.stringify(revision.content)).digest("hex") }, method: corrected ? "user" : row.model ? "llm" : "deterministic", extractorVersion: row.extractor_version, modelRevision, confidence: Number(row.confidence), uncertainty: null, validationStatus: corrected ? "user_confirmed" : "proposed", userCorrectionStatus: corrected ? "active" : "none", visibility: "visible", factType, value };
}

type ExportFilters = { types?: string[]; from?: string; to?: string; cursor?: string; limit: number };
async function exportRecords(db: Queryable, owner: string, filters: Omit<ExportFilters,"cursor"|"limit">) {
  const records: Array<{ type: string; id: string; record: Row }> = [];
  const include = (type: string) => !filters.types || filters.types.includes(type);
  const observations = (await db.query(`select o.* from v2_observations o where ${visibleObservation} and ($2::timestamptz is null or o.created_at >= $2) and ($3::timestamptz is null or o.created_at < $3) order by o.id`, [owner, filters.from ?? null, filters.to ?? null])).rows;
  const ids = observations.map(o => o.id);
  if (include("observation")) for (const row of observations) records.push({ type: "observation", id: row.id, record: observationDto(row, owner) });
  const revisions = ids.length ? (await db.query(`select rev.* from v2_observation_revisions rev join raw_events r on r.id=rev.raw_event_id where rev.owner_id=$1 and rev.observation_id=any($2::text[]) and ${eventVisible} order by rev.id`, [owner, ids])).rows : [];
  if (include("revision")) for (const row of revisions) records.push({ type: "revision", id: row.id, record: revisionDto(row) });
  const events = (await db.query(`select r.id from raw_events r where ${eventVisible} and ($2::timestamptz is null or coalesce(r.timestamp,r.created_at) >= $2) and ($3::timestamptz is null or coalesce(r.timestamp,r.created_at) < $3) order by r.id`, [owner, filters.from ?? null, filters.to ?? null])).rows;
  if (include("event")) for (const row of events) records.push({ type: "event", id: row.id, record: await eventDto(db, owner, row.id) });
  if (include("fact")) for (const rev of revisions) {
    const facts = (await db.query(`select * from knowledge_facts where owner_id=$1 and event_id=$2 and visibility='visible' order by id`, [owner, rev.raw_event_id])).rows;
    for (const row of facts) { const dto = await factDto(db, owner, row, rev); if (dto) records.push({ type: "fact", id: row.id, record: dto }); }
  }
  if (include("correction")) {
    const corrections = (await db.query(`select * from v2_corrections where owner_id=$1 and ($2::timestamptz is null or created_at >= $2) and ($3::timestamptz is null or created_at < $3) order by id`, [owner, filters.from ?? null, filters.to ?? null])).rows;
    for (const row of corrections) records.push({ type: "correction", id: row.id, record: { correctionId: row.id, version: row.version, status: row.status, reprocessing: row.reprocessing, target: row.request.target, field: row.field, appliedAt: utc(row.applied_at ?? row.created_at), revokedAt: row.revoked_at ? utc(row.revoked_at) : null } });
  }
  if (include("transaction")) {
    const transactions = (await db.query(`select t.*,t.amount::text as amount from financial_transactions t where ${financeVisible} and t.currency ~ '^[A-Z]{3}$' and ($2::timestamptz is null or t.observed_at >= $2) and ($3::timestamptz is null or t.observed_at < $3) order by t.id`, [owner, filters.from ?? null, filters.to ?? null])).rows;
    for (const row of transactions) records.push({ type: "transaction", id: row.id, record: await transactionDto(db, owner, row) });
  }
  // V1 generated prose lacks the v2 verified citation model and is therefore
  // ineligible as a v2 artifact. Episodes remain behind their feature gate.
  return records.sort((a,b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`));
}

async function exportItemVisible(db: Queryable, owner: string, item: Row) {
  if (item.type === "observation" || item.type === "revision") {
    if (item.type === "revision") return Boolean((await db.query(`select rev.id from v2_observation_revisions rev join v2_observations o on o.id=rev.observation_id and o.owner_id=rev.owner_id join raw_events r on r.id=rev.raw_event_id where ${visibleObservation} and ${eventVisible} and rev.owner_id=$1 and rev.id=$2`, [owner,item.id])).rows[0]);
    const id = item.type === "observation" ? item.id : item.record.observationId;
    return Boolean((await db.query(`select o.id from v2_observations o where ${visibleObservation} and o.id=$2`, [owner,id])).rows[0]);
  }
  if (item.type === "event") return Boolean((await db.query(`select r.id from raw_events r where ${eventVisible} and r.id=$2`, [owner,item.id])).rows[0]);
  if (item.type === "transaction") return Boolean((await db.query(`select t.id from financial_transactions t where ${financeVisible} and t.id=$2`, [owner,item.id])).rows[0]);
  if (item.type === "fact") return Boolean((await db.query(`select f.id from knowledge_facts f join raw_events r on r.id=f.event_id where f.owner_id=$1 and f.id=$2 and f.visibility='visible' and ${eventVisible}`, [owner,item.id])).rows[0]);
  if (item.type === "correction") {
    const target = item.record.target;
    const mapped = target.type === "transaction" ? "transaction" : target.type === "fact" ? "fact" : "event";
    return exportItemVisible(db, owner, { type: mapped, id: target.id });
  }
  return false;
}
export async function exportPage(db: Queryable, owner: string, input: ExportFilters) {
  const { cursor, limit, ...filters } = input;
  const position = decodeCursor(cursor, owner, "export", filters);
  let snapshot: Row;
  let offset = 0;
  if (position) {
    const parsed = position.split(":");
    const id = parsed[0]; offset = Number(parsed[1]);
    if (parsed.length !== 2 || !Number.isSafeInteger(offset) || offset < 0) throw new ApiError(400,"invalid_request","Invalid cursor");
    snapshot = (await db.query(`select * from v2_export_snapshots where owner_id=$1 and id=$2`, [owner,id])).rows[0];
    if (!snapshot) throw new ApiError(400,"invalid_request","Invalid cursor");
    if (new Date(snapshot.expires_at).getTime() <= Date.now()) throw new ApiError(409,"export_snapshot_expired","Export snapshot expired");
  } else {
    const items = await exportRecords(db, owner, filters);
    snapshot = (await db.query(`insert into v2_export_snapshots(id,owner_id,filters,items,expires_at) values($1,$2,$3::jsonb,$4::jsonb,now()+interval '15 minutes') returning *`, [`snapshot_${randomUUID()}`,owner,JSON.stringify(filters),JSON.stringify(items)])).rows[0];
  }
  const selected = snapshot.items.slice(offset, offset+limit);
  const items = [];
  for (const item of selected) if (await exportItemVisible(db,owner,item)) items.push(item);
  const nextOffset = offset+selected.length;
  await db.query(`insert into v2_export_audit(id,owner_id,snapshot_id,page_count) values($1,$2,$3,$4)`, [`export_${randomUUID()}`,owner,snapshot.id,items.length]);
  return { snapshotId: snapshot.id, items, nextCursor: nextOffset < snapshot.items.length ? encodeCursor(owner,"export",filters,`${snapshot.id}:${nextOffset}`) : null, expiresAt: utc(snapshot.expires_at) };
}

type QueryInput = { query: string; maxEvidence: number; externalSynthesisAllowed: boolean; filters: { sourceInstanceIds?: string[]; from?: string; to?: string; types?: string[] } };
export async function createQuery(db: Queryable, owner: string, input: QueryInput) {
  const started = Date.now();
  const id = `query_${randomUUID()}`;
  const types = input.filters.types;
  const allowed = !types || types.some(t => ["observation","event","fact","transaction"].includes(t));
  const rows = allowed ? (await db.query(`select rev.*,o.source_instance_id from v2_observation_revisions rev join v2_observations o on o.id=rev.observation_id and o.owner_id=rev.owner_id join raw_events r on r.id=rev.raw_event_id where ${visibleObservation} and ${eventVisible}
    and ($2::text[] is null or o.source_instance_id=any($2)) and ($3::timestamptz is null or coalesce(rev.source_occurred_at,rev.received_at)>=$3) and ($4::timestamptz is null or coalesce(rev.source_occurred_at,rev.received_at)<$4)
    and (coalesce(rev.content->>'title','') ilike $5 escape '\\' or coalesce(rev.content->>'body','') ilike $5 escape '\\')
    and ($6::text[] is null or 'observation'=any($6) or 'event'=any($6) or ('fact'=any($6) and exists(select 1 from knowledge_facts f where f.event_id=r.id and f.owner_id=$1 and f.visibility='visible')) or ('transaction'=any($6) and exists(select 1 from financial_transactions t where t.anchor_event_id=r.id and t.owner_id=$1 and t.hidden_at is null)))
    order by rev.received_at desc,rev.id limit $7`, [owner,input.filters.sourceInstanceIds ?? null,input.filters.from ?? null,input.filters.to ?? null,`%${input.query.replace(/[\\%_]/g,"\\$&")}%`,types ?? null,input.maxEvidence])).rows : [];
  const evidence = rows.map(row => ({ id: row.observation_id, observationId: row.observation_id, revisionId: row.id, factId: null, pointer: "/content", permittedExcerpt: [row.content.title,row.content.body].filter(Boolean).join("\n").slice(0,2000) }));
  const result = { queryId: id, modelCalls: 0, elapsedMs: Date.now()-started, status: "review", answer: null, structuredTotals: null, evidence, claims: [], limitations: ["Evidence-only retrieval; external synthesis is not configured.", "Retrieval does not establish exhaustive coverage."], coverage: { exhaustive: false, retrievalStrategies: ["sql"], timeRange: { from: input.filters.from ?? "1970-01-01T00:00:00Z", to: input.filters.to ?? new Date().toISOString() } }, failure: null };
  await db.query(`insert into v2_queries(id,owner_id,status,request,result) values($1,$2,'review',$3::jsonb,$4::jsonb)`, [id,owner,JSON.stringify(input),JSON.stringify(result)]);
  return result;
}
export async function queryResult(db: Queryable, owner: string, id: string) {
  const row = (await db.query(`select * from v2_queries where owner_id=$1 and id=$2`, [owner,id])).rows[0];
  if (!row) throw missing();
  const result = row.result;
  const evidence = [];
  for (const item of result.evidence ?? []) {
    const visible = (await db.query(`select rev.id from v2_observation_revisions rev join v2_observations o on o.id=rev.observation_id and o.owner_id=rev.owner_id join raw_events r on r.id=rev.raw_event_id where ${visibleObservation} and ${eventVisible} and rev.owner_id=$1 and rev.id=$2`, [owner,item.revisionId])).rows[0];
    if (visible) evidence.push(item);
  }
  return { ...result, evidence };
}
