import crypto, { randomUUID } from "node:crypto";
import { estimateTokens, modelRequestFingerprint, recordModelCallAudit } from "./model-audit.js";
import { pool, withTransaction } from "./postgres.js";
import { categoryLabelEs, KIND_LABELS_ES } from "../domain/category-labels.js";
import { assertJobFence, type JobFence } from "./job-repository.js";
import {
  acquireProviderSlot,
  authorizeModelDispatch,
  logPrivacyDenial,
  redactForModel,
  stillAuthorized,
  type PrivacyAuthorization,
  type PrivacyDenial,
} from "./privacy.js";

type Queryable = Pick<typeof pool, "query">;

export const LOCAL_EMBEDDING_DIMENSIONS = 192;
export const LOCAL_EMBEDDING_MODEL = "brainia-semantic-hash";
export const EMBEDDING_VERSION = process.env.EMBEDDING_VERSION ?? "embedding-v1";

export const OPENAI_EMBEDDING_URL = "https://api.openai.com/v1/embeddings";
export const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
/**
 * 512 output dimensions keep nearly all of text-embedding-3-small's retrieval
 * quality while making an exact in-database similarity scan cheap for one
 * owner's data (no vector extension needed).
 */
export const OPENAI_EMBEDDING_DIMENSIONS = 512;

export type EmbeddingProvider = { apiKey: string; endpoint: string; model: string; dimensions: number | null };

/**
 * Resolves the external embedding provider. OPENAI_EMBEDDING_API_KEY alone is
 * enough (OpenAI endpoint, text-embedding-3-small, 512 dims); the generic
 * EMBEDDING_* variables override any of those for another compatible provider.
 * Returns null when no provider is configured, so the local hash vector is used.
 */
export function embeddingProvider(env: NodeJS.ProcessEnv = process.env): EmbeddingProvider | null {
  const openAiKey = env.OPENAI_EMBEDDING_API_KEY?.trim() || null;
  const apiKey = env.EMBEDDING_API_KEY?.trim() || openAiKey;
  if (!apiKey) return null;
  const endpoint = env.EMBEDDING_API_URL?.trim() || (openAiKey ? OPENAI_EMBEDDING_URL : null);
  // The example file ships the local model name; it is never an external model id.
  const explicitModel = env.EMBEDDING_MODEL?.trim();
  const model = explicitModel && explicitModel !== LOCAL_EMBEDDING_MODEL
    ? explicitModel : openAiKey ? OPENAI_EMBEDDING_MODEL : null;
  // A provider without a real model id cannot record provenance: stay local.
  if (!endpoint || !model) return null;
  const explicitDimensions = Number(env.EMBEDDING_DIMENSIONS);
  const dimensions = Number.isInteger(explicitDimensions) && explicitDimensions >= 64 && explicitDimensions <= 4096
    ? explicitDimensions : model.startsWith("text-embedding-3") ? OPENAI_EMBEDDING_DIMENSIONS : null;
  return { apiKey, endpoint, model, dimensions };
}

/** True only when an external provider can produce vectors with recorded provenance. */
export function externalEmbeddingsConfigured() {
  return embeddingProvider() !== null;
}

const SEMANTIC_EQUIVALENTS: Record<string, string> = {
  gasto: "expense", gastos: "expense", compra: "expense", compras: "expense", pago: "payment", pagos: "payment",
  ingreso: "income", ingresos: "income", salario: "income", sueldo: "income",
  comercio: "merchant", tienda: "merchant", proveedor: "merchant",
  correo: "email", correos: "email", mensaje: "message", mensajes: "message",
  tarea: "task", tareas: "task", pendiente: "task", pendientes: "task",
  suscripcion: "subscription", suscripciones: "subscription", recurrente: "recurring",
  transporte: "transport", viaje: "travel", viajes: "travel",
  salud: "health", ejercicio: "exercise", entrenamiento: "exercise",
  dinero: "finance", financiero: "finance", financiera: "finance",
};

function normalizedTokens(text: string) {
  return text.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu)?.flatMap((token) => {
      const equivalent = SEMANTIC_EQUIVALENTS[token];
      return equivalent && equivalent !== token ? [token, equivalent] : [token];
    }) ?? [];
}

function hashToken(token: string) {
  const bytes = crypto.createHash("sha256").update(token).digest();
  return { index: bytes.readUInt32LE(0) % LOCAL_EMBEDDING_DIMENSIONS, sign: (bytes[4]! & 1) === 0 ? 1 : -1 };
}

function normalizeVector(vector: number[]) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude ? vector.map((value) => value / magnitude) : vector;
}

export function buildLocalEmbedding(text: string) {
  const tokens = normalizedTokens(text);
  const vector = Array.from({ length: LOCAL_EMBEDDING_DIMENSIONS }, () => 0);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const unigram = hashToken(`u:${token}`);
    vector[unigram.index]! += unigram.sign;
    if (index > 0) {
      const bigram = hashToken(`b:${tokens[index - 1]}:${token}`);
      vector[bigram.index]! += bigram.sign * 0.6;
    }
  }
  return normalizeVector(vector);
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]) {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftMagnitude += left[index]! * left[index]!;
    rightMagnitude += right[index]! * right[index]!;
  }
  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return denominator ? dot / denominator : 0;
}

/**
 * External embedding dispatch requires the same owner/purpose/evidence
 * authorization as LLM calls. Without it the deterministic local vector is
 * used, so retrieval still works while no payload leaves the process.
 */
export async function generateEmbedding(input: {
  text: string;
  clientId?: string | null;
  ownerId?: string | null;
  objectId?: string | null;
  purpose?: string | null;
  authorization?: PrivacyAuthorization | PrivacyDenial | null;
}) {
  const provider = embeddingProvider();
  const local = () => ({ embedding: buildLocalEmbedding(input.text), model: LOCAL_EMBEDDING_MODEL, version: EMBEDDING_VERSION });
  // A local hash vector must never be labelled as an external vector, and an
  // external vector must carry the provider's real model id.
  if (!provider) {
    return local();
  }
  const { apiKey, endpoint, model } = provider;
  const authorization = input.authorization;
  if (!authorization?.allowed) {
    logPrivacyDenial(authorization ? authorization.reason : "missing_owner", {
      purpose: input.purpose ?? "embedding",
    });
    return local();
  }

  const safeText = redactForModel(input.text, authorization.redaction);
  const startedAt = Date.now();
  const fingerprint = modelRequestFingerprint({ model, systemPrompt: "embedding", userPrompt: safeText });
  const release = await acquireProviderSlot(authorization.ownerId);
  try {
    if (!(await stillAuthorized(authorization))) {
      logPrivacyDenial("policy_version_changed", { purpose: authorization.purpose });
      return local();
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model, input: safeText,
        ...(provider.dimensions ? { dimensions: provider.dimensions } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Embedding provider returned HTTP ${response.status}`);
    const payload = await response.json() as { data?: Array<{ embedding?: number[] }>; usage?: { prompt_tokens?: number; total_tokens?: number } };
    const embedding = payload.data?.[0]?.embedding;
    if (!embedding?.length || embedding.some((value) => !Number.isFinite(value))) throw new Error("Embedding provider returned an invalid vector");
    const publishable = await stillAuthorized(authorization);
    await recordModelCallAudit({
      clientId: input.clientId, eventId: null, provider: "embedding", operation: "embedding",
      model, promptVersion: EMBEDDING_VERSION, status: publishable ? "succeeded" : "cancelled",
      inputTokens: payload.usage?.prompt_tokens ?? estimateTokens(safeText), outputTokens: 0,
      latencyMs: Date.now() - startedAt, requestFingerprint: fingerprint,
      resultMetadata: { objectId: input.objectId ?? null, dimensions: embedding.length },
    });
    if (!publishable) {
      logPrivacyDenial("policy_version_changed", { purpose: authorization.purpose });
      return local();
    }
    return { embedding: normalizeVector(embedding), model, version: EMBEDDING_VERSION };
  } catch (error) {
    await recordModelCallAudit({
      clientId: input.clientId, eventId: null, provider: "embedding", operation: "embedding",
      model, promptVersion: EMBEDDING_VERSION, status: "failed",
      inputTokens: estimateTokens(safeText), outputTokens: 0,
      latencyMs: Date.now() - startedAt, requestFingerprint: fingerprint,
      resultMetadata: { objectId: input.objectId ?? null, fallback: LOCAL_EMBEDDING_MODEL, errorName: error instanceof Error ? error.name : "Error" },
      errorCode: "embedding_provider_error",
    });
    return local();
  } finally {
    release();
  }
}

type DerivedRunPolicy = { ownerId: string | null; policyVersion: number | null };

async function loadDerivedRunPolicy(
  db: Queryable,
  objectType: "insight" | "digest",
  objectId: string,
): Promise<DerivedRunPolicy | null> {
  const table = objectType === "insight" ? "insight_runs" : "digest_runs";
  const result = await db.query<DerivedRunPolicy>(`
    select owner_id as "ownerId", policy_version::int as "policyVersion"
    from ${table} where id = $1 limit 1
  `, [objectId]);
  return result.rows[0] ?? null;
}

/**
 * Replay barrier at the application boundary. The migration also installs a
 * trigger, but checking here avoids generating an external embedding for an
 * object that is already logically deleted.
 */
async function embeddingTargetTombstoned(
  db: Queryable,
  input: { ownerId: string | null; objectType: string; objectId: string },
) {
  if (!input.ownerId) return false;
  const result = await db.query<{ blocked: boolean }>(`
    select (
      exists (
        select 1 from deletion_tombstones tombstone
        where tombstone.owner_id = $1 and tombstone.target_type = $2 and tombstone.target_id = $3
      )
      or ($2 = 'event' and exists (
        select 1 from deletion_tombstones tombstone
        where tombstone.owner_id = $1 and tombstone.target_type = 'event' and tombstone.target_id = $3
      ))
      or ($2 = 'entity' and exists (
        select 1 from event_entities link
        join deletion_tombstones tombstone
          on tombstone.owner_id = $1 and tombstone.target_type = 'event'
          and tombstone.target_id = link.event_id
        where link.entity_id = $3
      ))
      or ($2 = 'fact' and exists (
        select 1 from knowledge_facts fact
        join deletion_tombstones tombstone
          on tombstone.owner_id = $1 and tombstone.target_type = 'event'
          and tombstone.target_id = fact.event_id
        where fact.id = $3
      ))
    ) as blocked
  `, [input.ownerId, input.objectType, input.objectId]);
  return Boolean(result.rows[0]?.blocked);
}

export async function upsertEmbedding(db: Queryable, input: {
  clientId?: string | null;
  ownerId?: string | null;
  objectType: "event" | "entity" | "insight" | "digest" | "fact";
  objectId: string;
  content: string;
  metadata?: Record<string, unknown>;
  purpose?: string | null;
  eventIds?: string[];
  /**
   * Optional authorization computed by a caller that already knows the full
   * evidence lineage (for example proactive insights). When supplied it is the
   * single gate for this embedding, including its policy version, so a denied
   * derivation cannot be re-authorized by an empty source set here.
   */
  authorization?: PrivacyAuthorization | PrivacyDenial | null;
}) {
  const content = input.content.normalize("NFKC").trim().slice(0, 20_000);
  if (!content) return null;
  const callerOwnerId = input.ownerId ?? input.clientId ?? null;
  const source = typeof input.metadata?.source === "string" ? input.metadata.source : null;
  const authorization = input.authorization ?? await authorizeModelDispatch(db, {
    ownerId: callerOwnerId,
    purpose: input.purpose ?? "embedding",
    sources: source ? [source] : [],
    eventIds: input.eventIds ?? (input.objectType === "event" ? [input.objectId] : []),
  });
  // Derived insight/digest embeddings are joinable to their run. Persist the
  // run owner and policy version so a later policy bump can mark them stale
  // without relying on (often absent) metadata.source.
  const derivedRun = input.objectType === "insight" || input.objectType === "digest"
    ? await loadDerivedRunPolicy(db, input.objectType, input.objectId)
    : null;
  const ownerId = callerOwnerId ?? derivedRun?.ownerId ?? null;
  if (await embeddingTargetTombstoned(db, { ownerId, objectType: input.objectType, objectId: input.objectId })) {
    return null;
  }
  const policyVersion = Math.max(
    authorization.allowed ? authorization.policyVersion : 0,
    derivedRun?.policyVersion ?? 0,
  );
  const metadata = derivedRun
    ? {
        ...input.metadata,
        ownerId,
        derivedFrom: `${input.objectType}_run`,
        runId: input.objectId,
        policyVersion,
      }
    : { ...input.metadata };
  const contentHash = crypto.createHash("sha256").update(content).digest("hex");
  // Unchanged content embedded by the model we would use now (and under a
  // policy version that is still current) needs no new provider call. This
  // keeps reprocessing and backfills from re-paying for identical text.
  const expectedModel = authorization.allowed ? embeddingProvider()?.model ?? LOCAL_EMBEDDING_MODEL : LOCAL_EMBEDDING_MODEL;
  const existing = await db.query<{ id: string }>(`
    select id from knowledge_embeddings
    where object_type = $1 and object_id = $2 and embedding_version = $3
      and content_hash = $4 and model = $5 and coalesce(policy_version, 0) >= $6
      and coalesce(metadata->>'policyStale', 'false') <> 'true'
    limit 1
  `, [input.objectType, input.objectId, EMBEDDING_VERSION, contentHash, expectedModel, policyVersion]);
  if (existing.rows.length) return null;
  const generated = await generateEmbedding({
    text: content, clientId: input.clientId, ownerId, objectId: input.objectId,
    purpose: input.purpose ?? "embedding", authorization,
  });
  const result = await db.query(`
    insert into knowledge_embeddings (
      id, client_id, owner_id, object_type, object_id, embedding, dimensions,
      model, embedding_version, content_hash, content, metadata, policy_version
    ) values ($1,$2,$3,$4,$5,$6::float8[],$7,$8,$9,$10,$11,$12::jsonb,$13)
    on conflict (object_type, object_id, embedding_version) do update set
      client_id = excluded.client_id, owner_id = coalesce(excluded.owner_id, knowledge_embeddings.owner_id),
      embedding = excluded.embedding,
      dimensions = excluded.dimensions, model = excluded.model,
      content_hash = excluded.content_hash, content = excluded.content,
      metadata = excluded.metadata, policy_version = excluded.policy_version, updated_at = now()
    returning id, object_type as "objectType", object_id as "objectId",
      dimensions, model, embedding_version as version, policy_version as "policyVersion", updated_at as "updatedAt"
  `, [
    `embedding_${randomUUID()}`, input.clientId ?? null, ownerId, input.objectType, input.objectId,
    generated.embedding, generated.embedding.length, generated.model, generated.version,
    contentHash, content, JSON.stringify(metadata), policyVersion,
  ]);
  return result.rows[0] ?? null;
}

/**
 * Contextual retrieval text: a short header (date, source, money facts in
 * Spanish) followed by the interpreted and raw text. Short transport text such
 * as "Compra aprobada $1.250" embeds poorly on its own; the header lets a
 * question like "¿cuánto gasté en delivery?" match it semantically. The raw
 * body is capped so long emails do not dilute the vector.
 */
export function buildEventEmbeddingText(row: {
  source: string; kind: string; title: string | null; body: string | null;
  displayTitle: string | null; displayDescription: string | null; occurredAt?: string | null;
  inferredKind?: string | null; txKind?: string | null; txAmount?: string | null;
  txCurrency?: string | null; txCategory?: string | null; txMerchant?: string | null;
}) {
  const header = [
    row.occurredAt ? `Fecha: ${row.occurredAt}` : null,
    `Fuente: ${row.source}`,
    `Tipo: ${row.inferredKind ?? row.kind}`,
  ].filter(Boolean).join(" · ");
  const money = row.txKind && row.txAmount
    ? `Movimiento: ${KIND_LABELS_ES[row.txKind] ?? row.txKind} de ${row.txAmount} ${row.txCurrency ?? ""}`.trim()
      + (row.txMerchant ? ` en ${row.txMerchant}` : "")
      + ` · Categoría: ${categoryLabelEs(row.txCategory)}`
    : null;
  const raw = [row.title, row.body].filter(Boolean).join("\n").slice(0, 1800);
  return [header, money, row.displayTitle, row.displayDescription, raw].filter(Boolean).join("\n");
}

export type KnnHit = { objectType: "event" | "entity"; objectId: string; score: number };

/**
 * Exact cosine nearest neighbours computed inside Postgres. Stored vectors are
 * unit-normalised, so the dot product is the cosine. Only rows produced by the
 * same model/version/dimensions as the query vector are comparable; mixing a
 * hash vector with a provider vector would silently score zero.
 */
export async function nearestEmbeddings(db: Queryable, input: {
  ownerId: string | null;
  vector: number[];
  model: string;
  objectTypes: Array<"event" | "entity">;
  from?: string | null;
  to?: string | null;
  limit: number;
}): Promise<KnnHit[]> {
  if (!input.vector.length) return [];
  const result = await db.query<{ objectType: "event" | "entity"; objectId: string; score: number }>(`
    with query as (select $1::float8[] as vector)
    select embedding.object_type as "objectType", embedding.object_id as "objectId",
      (select sum(a * b) from unnest(embedding.embedding, query.vector) as pair(a, b))::float8 as score
    from knowledge_embeddings embedding cross join query
    left join raw_events event on embedding.object_type = 'event' and event.id = embedding.object_id
    left join entities entity on embedding.object_type = 'entity' and entity.id = embedding.object_id
    where embedding.embedding_version = $2 and embedding.model = $3 and embedding.dimensions = $4
      and embedding.object_type = any($5::text[])
      and coalesce(embedding.owner_id, embedding.client_id) is not distinct from $6
      and coalesce(embedding.metadata->>'policyStale', 'false') <> 'true'
      and (embedding.object_type <> 'event' or (event.id is not null and event.privacy_status = 'standard'
        and ($7::timestamptz is null or coalesce(event.timestamp, event.created_at) >= $7)
        and ($8::timestamptz is null or coalesce(event.timestamp, event.created_at) <= $8)))
      and (embedding.object_type <> 'entity' or (entity.id is not null and entity.visibility <> 'hidden'))
    order by score desc nulls last
    limit $9
  `, [input.vector, EMBEDDING_VERSION, input.model, input.vector.length, input.objectTypes,
    input.ownerId, input.from ?? null, input.to ?? null, input.limit]);
  return result.rows.map((row) => ({ ...row, score: Number(row.score) }));
}

export async function refreshEventEmbeddings(
  db: Queryable,
  eventId: string,
  options: { fence?: JobFence | null } = {},
) {
  const event = await db.query<{
    id: string; clientId: string | null; ownerId: string | null; source: string; kind: string;
    title: string | null; body: string | null; displayTitle: string | null;
    displayDescription: string | null; occurredAt: string | null; inferredKind: string | null;
    txKind: string | null; txAmount: string | null; txCurrency: string | null;
    txCategory: string | null; txMerchant: string | null;
  }>(`
    select event.id, event.client_id as "clientId", event.owner_id as "ownerId", event.source, event.kind,
      event.title, event.body, classified.display_title as "displayTitle",
      classified.display_description as "displayDescription",
      to_char(coalesce(event.timestamp, event.created_at) at time zone 'America/Montevideo', 'YYYY-MM-DD') as "occurredAt",
      classified.inferred_kind as "inferredKind",
      tx.kind as "txKind", tx.amount::text as "txAmount", tx.currency as "txCurrency",
      tx.category as "txCategory", coalesce(tx.title_override, tx.merchant_label) as "txMerchant"
    from raw_events event left join classified_events classified on classified.raw_event_id = event.id
    left join lateral (
      select t.kind, t.amount, t.currency, t.category, t.title_override, t.merchant_label
      from financial_transaction_events link
      join financial_transactions t on t.id = link.transaction_id
      where link.raw_event_id = event.id and t.hidden_at is null
      order by t.updated_at desc limit 1
    ) tx on true
    where event.id = $1 and event.privacy_status <> 'hidden'
  `, [eventId]);
  const row = event.rows[0];
  if (!row) return [];
  // A fenced write is one transaction containing the ownership check and the
  // upsert. A claim that advanced the fence therefore cannot be overwritten by
  // an expired worker, even when the model/vector generation happened before.
  const write = async (input: Parameters<typeof upsertEmbedding>[1]) => {
    if (!options.fence) return upsertEmbedding(db, input);
    return withTransaction(async (tx) => {
      await assertJobFence(tx, options.fence!, "embedding_write");
      return upsertEmbedding(tx, input);
    });
  };
  const stored = [];
  const ownerId = row.ownerId ?? row.clientId;
  const eventEmbedding = await write({
    clientId: row.clientId, ownerId, objectType: "event", objectId: row.id,
    content: buildEventEmbeddingText(row),
    metadata: { source: row.source, kind: row.kind, occurredAt: row.occurredAt }, eventIds: [row.id],
  });
  if (eventEmbedding) stored.push(eventEmbedding);

  const entities = await db.query<{ id: string; value: string; description: string; type: string; aliases: string[] }>(`
    select distinct entity.id, entity.value, entity.description, entity.type,
      coalesce((select array_agg(alias.alias order by alias.alias) from entity_aliases alias where alias.entity_id = entity.id), '{}') as aliases
    from event_entities link join entities entity on entity.id = link.entity_id
    left join entity_merges merged on merged.alias_entity_id = entity.id
    where link.event_id = $1 and merged.alias_entity_id is null and entity.visibility <> 'hidden'
  `, [eventId]);
  for (const entity of entities.rows) {
    const embedding = await write({
      clientId: row.clientId, ownerId, objectType: "entity", objectId: entity.id,
      content: [entity.value, entity.description, entity.type, ...entity.aliases].filter(Boolean).join("\n"),
      metadata: { type: entity.type, source: row.source }, eventIds: [row.id],
    });
    if (embedding) stored.push(embedding);
  }
  return stored;
}
