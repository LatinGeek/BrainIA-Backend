import { randomUUID, createHash } from "node:crypto";
import type { Queryable } from "../postgres.js";
import { withOwnerTransaction } from "../postgres.js";
import { ApiError, canonicalize, fingerprint, type Envelope } from "../../domain/v2/contracts.js";
import { decodeCursor, encodeCursor } from "./cursors.js";

export function utc(value: string | Date): string { return new Date(value).toISOString(); }
export const missing = () => new ApiError(404, "not_found", "Resource not found");
type Row = Record<string, any>;

export async function sourceFor(db: Queryable, owner: string, id: string) {
  const source = (await db.query(`select * from v2_source_instances where owner_id=$1 and id=$2`, [owner, id])).rows[0];
  if (!source) throw missing();
  return source;
}
export async function capture(owner: string, envelope: Envelope) {
  return withOwnerTransaction(owner, async db => {
    const deliveryId = envelope.deliveryId.replace(/^urn:uuid:/i, "");
    const producerRevisionId = envelope.producerRevisionId.replace(/^urn:uuid:/i, "");
    // Serializes identity allocation across deliveries, including concurrent
    // first revisions, without locking another owner's work.
    await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`v2:capture:${owner}`]);
    const requestHash = createHash("sha256").update(canonicalize(envelope)).digest("hex");
    const previous = (await db.query(`select * from v2_delivery_receipts where owner_id=$1 and delivery_id=$2`, [owner, deliveryId])).rows[0];
    if (previous) {
      if (previous.request_hash !== requestHash) throw new ApiError(409, "identity_conflict", "Delivery identity has different content");
      return { status: 200, receipt: previous.receipt };
    }
    const source = await sourceFor(db, owner, envelope.sourceInstanceId);
    if (source.content_type !== envelope.content.type) throw new ApiError(403, "forbidden", "Source content type is not authorized");
    const policy = (await db.query(`select * from source_processing_policies where owner_id=$1 and source=$2 order by updated_at desc limit 1`, [owner, source.source])).rows[0];
    if (!source.enabled || policy?.enabled === false) throw new ApiError(403, "source_disabled", "Source is disabled");
    if (["email", "activity", "location"].includes(envelope.content.type)) throw new ApiError(403, "feature_disabled", "Source feature is disabled");
    let observation = (await db.query(`select * from v2_observations where owner_id=$1 and source_instance_id=$2 and source_observation_key=$3 for update`, [owner, envelope.sourceInstanceId, envelope.sourceObservationKey])).rows[0];
    if (observation?.deleted) throw new ApiError(403, "source_disabled", "Observation is deleted");
    if (observation && observation.content_type !== envelope.content.type) throw new ApiError(409, "identity_conflict", "Observation type cannot change");
    let revision: Row | undefined = observation ? (await db.query(`select * from v2_observation_revisions where owner_id=$1 and observation_id=$2 and producer_revision_id=$3`, [owner, observation.id, producerRevisionId])).rows[0] : undefined;
    if (revision && (revision.content_fingerprint !== envelope.contentFingerprint || revision.producer_sequence !== envelope.producerSequence || revision.change_kind !== envelope.changeKind || canonicalize(revision.content) !== canonicalize(envelope.content) || (revision.source_occurred_at ? utc(revision.source_occurred_at) : null) !== (envelope.sourceOccurredAt ? utc(envelope.sourceOccurredAt) : null) || (revision.source_updated_at ? utc(revision.source_updated_at) : null) !== (envelope.sourceUpdatedAt ? utc(envelope.sourceUpdatedAt) : null))) {
      throw new ApiError(409, "identity_conflict", "Producer revision has different content");
    }
    const duplicate = Boolean(revision);
    const receivedAt = new Date().toISOString();
    if (!observation) {
      observation = (await db.query(`insert into v2_observations(id,owner_id,source_instance_id,source_observation_key,content_type) values($1,$2,$3,$4,$5) returning *`, [`obs_${randomUUID()}`, owner, envelope.sourceInstanceId, envelope.sourceObservationKey, envelope.content.type])).rows[0];
    }
    if (!revision) {
      const id = `rev_${randomUUID()}`;
      const eventId = `v2_${randomUUID()}`;
      const number = observation.revision_count + 1;
      const content = envelope.content;
      const receiptAmount = content.type === "receipt" && typeof content.raw.amount === "string" && /^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/.test(content.raw.amount) ? content.raw.amount : null;
      const receiptCurrency = content.type === "receipt" && typeof content.raw.currency === "string" && /^(UYU|USD)$/.test(content.raw.currency) ? content.raw.currency : null;
      const projectionBody = content.type === "receipt" && receiptAmount && receiptCurrency ? [content.body, `${receiptCurrency} ${receiptAmount}`,content.merchantText].filter(Boolean).join("\n") : content.body;
      const event = {
        id: eventId, source: source.source, contractVersion: 2,
        kind: content.type === "notification" || content.type === "receipt" ? "notification" : "note",
        title: content.title || undefined, body: projectionBody ?? undefined,
        timestamp: utc(envelope.sourceOccurredAt ?? envelope.deviceObservedAt),
        externalId: envelope.sourceObservationKey, idempotencyKey: id,
        raw: { ...content.raw, ...(content.type === "notification" ? { packageName: content.packageName } : {}), ...(content.type === "receipt" ? { merchant: content.merchantText ?? content.raw.merchant, reference: content.reference } : {}), v2ObservationId: observation.id, v2RevisionId: id }, tags: [],
      };
      // The legacy helpers assign owner metadata after insert. V2 writes the
      // owner in each initial statement so restricted-role RLS also works.
      await db.query(`insert into raw_events(id,owner_id,client_id,source,contract_version,kind,title,body,timestamp,external_id,idempotency_key,dedupe_key,raw,tags,processing_status_reason) values($1,$2,$2,$3,2,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'{}'::text[],'v2_immutable_revision')`, [eventId,owner,event.source,event.kind,event.title ?? null,event.body ?? null,event.timestamp,event.externalId,id,`${owner}:v2:${id}`,JSON.stringify(event.raw)]);
      await db.query(`insert into background_jobs(id,owner_id,client_id,event_id,job_type,idempotency_key,payload,provider) values($1,$2,$2,$3,'classification',$4,$5::jsonb,'deepseek')`, [`job_${randomUUID()}`,owner,eventId,`classification:${eventId}:v1`,JSON.stringify({eventId})]);
      revision = (await db.query(`insert into v2_observation_revisions(id,owner_id,observation_id,revision_number,producer_revision_id,producer_sequence,delivery_id,change_kind,canonicalization_version,content_fingerprint,source_occurred_at,source_updated_at,device_observed_at,received_at,content,raw_event_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16) returning *`, [id, owner, observation.id, number, producerRevisionId, envelope.producerSequence, deliveryId, envelope.changeKind, envelope.canonicalizationVersion, envelope.contentFingerprint, envelope.sourceOccurredAt, envelope.sourceUpdatedAt, envelope.deviceObservedAt, receivedAt, JSON.stringify(content), eventId])).rows[0];
      const latest = observation.latest_revision_id ? (await db.query(`select producer_sequence from v2_observation_revisions where owner_id=$1 and id=$2`, [owner, observation.latest_revision_id])).rows[0] : null;
      const isLatest = !latest || BigInt(envelope.producerSequence) > BigInt(latest.producer_sequence);
      await db.query(`update v2_observations set revision_count=$3,updated_at=$4,latest_revision_id=case when $5 then $6 else latest_revision_id end,latest_revision_number=case when $5 then $3 else latest_revision_number end,raw_event_id=case when $5 then $7 else raw_event_id end,stage='queued',stage_updated_at=$4 where owner_id=$1 and id=$2`, [owner, observation.id, number, receivedAt, isLatest, id, eventId]);
    }
    const receipt = { contractVersion: 2, deliveryId: envelope.deliveryId, receiptId: `receipt_${randomUUID()}`, observationId: observation.id, revisionId: revision!.id, revisionNumber: revision!.revision_number, producerRevisionId: envelope.producerRevisionId, contentFingerprint: envelope.contentFingerprint, disposition: duplicate ? "duplicate" : "stored", receivedAt, processing: "queued", policyVersion: Number(policy?.policy_version ?? 1) };
    await db.query(`insert into v2_delivery_receipts(owner_id,delivery_id,request_hash,receipt) values($1,$2,$3,$4::jsonb)`, [owner, deliveryId, requestHash, JSON.stringify(receipt)]);
    return { status: duplicate ? 200 : 201, receipt };
  });
}

export const visibleObservation = `o.owner_id=$1 and not o.deleted and (o.raw_event_id is null or exists(select 1 from raw_events raw where raw.id=o.raw_event_id and raw.owner_id=$1 and raw.privacy_status<>'hidden' and public.brainia_v2_row_visible('raw_events',raw.id,$1) and not exists(select 1 from deletion_tombstones t where t.owner_id=$1 and t.target_type='event' and t.target_id=raw.id)))`;
export function observationDto(row: Row, owner: string) {
  const status = row.processing_status;
  const stage = status === "semantically_resolved" ? "succeeded" : status === "review" ? "review" : status === "retryable" ? "retry_scheduled" : status === "discarded" ? "cancelled" : row.stage;
  return { observationId: row.id, sourceInstanceId: row.source_instance_id, sourceObservationKey: row.source_observation_key, latestRevisionNumber: row.latest_revision_number, latestRevisionId: row.latest_revision_id, revisionCount: row.revision_count, contentType: row.content_type, stage, stageUpdatedAt: utc(row.processing_status_updated_at ?? row.stage_updated_at), createdAt: utc(row.created_at), updatedAt: utc(row.updated_at), deleted: row.deleted, revisionsCursor: encodeCursor(owner, `revisions:${row.id}`, {}, "0") };
}
export function revisionDto(row: Row) {
  // Legacy import identities describe this one import, never a reconstructed
  // producer history. Original producer metadata remains absent in storage.
  const hash = createHash("sha256").update(`legacy-import:${row.id}`).digest("hex");
  const importedId = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
  const sourceOccurredAt = row.source_occurred_at ? utc(row.source_occurred_at) : null;
  const sourceUpdatedAt = row.source_updated_at ? utc(row.source_updated_at) : null;
  return { revisionId: row.id, observationId: row.observation_id, revisionNumber: row.revision_number, producerRevisionId: row.producer_revision_id ?? importedId, producerSequence: row.producer_sequence ?? "1", changeKind: row.change_kind, contentFingerprint: row.content_fingerprint ?? fingerprint({ changeKind: row.change_kind, content: row.content, sourceOccurredAt, sourceUpdatedAt }), sourceOccurredAt, sourceUpdatedAt, deviceObservedAt: utc(row.device_observed_at), receivedAt: utc(row.received_at), content: row.content, evidenceIds: row.raw_event_id ? [row.raw_event_id] : [] };
}
export async function getObservation(db: Queryable, owner: string, id: string) {
  const row = (await db.query(`select o.*,r.processing_status,r.processing_status_updated_at from v2_observations o left join raw_events r on r.id=o.raw_event_id and r.owner_id=o.owner_id where ${visibleObservation} and o.id=$2`, [owner, id])).rows[0];
  if (!row) throw missing();
  return observationDto(row, owner);
}
export async function revisions(db: Queryable, owner: string, id: string, page: { limit: number; cursor?: string }) {
  await getObservation(db, owner, id);
  const position = decodeCursor(page.cursor, owner, `revisions:${id}`, {}) ?? "0";
  if (!/^\d+$/.test(position)) throw new ApiError(400, "invalid_request", "Invalid cursor position");
  const rows = (await db.query(`select rev.* from v2_observation_revisions rev where rev.owner_id=$1 and rev.observation_id=$2 and rev.revision_number>$3 and (rev.raw_event_id is null or exists(select 1 from raw_events r where r.id=rev.raw_event_id and r.owner_id=$1 and r.privacy_status<>'hidden' and not exists(select 1 from deletion_tombstones t where t.owner_id=$1 and t.target_type='event' and t.target_id=r.id))) order by rev.revision_number limit $4`, [owner, id, position, page.limit + 1])).rows;
  return { observationId: id, items: rows.slice(0, page.limit).map(revisionDto), nextCursor: rows.length > page.limit ? encodeCursor(owner, `revisions:${id}`, {}, String(rows[page.limit - 1].revision_number)) : null };
}
