import crypto, { randomUUID } from "node:crypto";
import { estimateTokens, modelRequestFingerprint, recordModelCallAudit } from "./model-audit.js";
import { pool } from "./postgres.js";
import { redactForModel } from "./privacy.js";

type Queryable = Pick<typeof pool, "query">;

export const LOCAL_EMBEDDING_DIMENSIONS = 192;
export const LOCAL_EMBEDDING_MODEL = "brainia-semantic-hash";
export const EMBEDDING_VERSION = process.env.EMBEDDING_VERSION ?? "embedding-v1";

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

export async function generateEmbedding(input: {
  text: string;
  clientId?: string | null;
  objectId?: string | null;
}) {
  const apiKey = process.env.EMBEDDING_API_KEY;
  const endpoint = process.env.EMBEDDING_API_URL;
  const model = process.env.EMBEDDING_MODEL ?? LOCAL_EMBEDDING_MODEL;
  if (!apiKey || !endpoint) {
    return { embedding: buildLocalEmbedding(input.text), model: LOCAL_EMBEDDING_MODEL, version: EMBEDDING_VERSION };
  }

  const safeText = redactForModel(input.text);
  const startedAt = Date.now();
  const fingerprint = modelRequestFingerprint({ model, systemPrompt: "embedding", userPrompt: safeText });
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input: safeText }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Embedding provider returned HTTP ${response.status}`);
    const payload = await response.json() as { data?: Array<{ embedding?: number[] }>; usage?: { prompt_tokens?: number; total_tokens?: number } };
    const embedding = payload.data?.[0]?.embedding;
    if (!embedding?.length || embedding.some((value) => !Number.isFinite(value))) throw new Error("Embedding provider returned an invalid vector");
    await recordModelCallAudit({
      clientId: input.clientId, eventId: null, provider: "embedding", operation: "embedding",
      model, promptVersion: EMBEDDING_VERSION, status: "succeeded",
      inputTokens: payload.usage?.prompt_tokens ?? estimateTokens(safeText), outputTokens: 0,
      latencyMs: Date.now() - startedAt, requestFingerprint: fingerprint,
      resultMetadata: { objectId: input.objectId ?? null, dimensions: embedding.length },
    });
    return { embedding: normalizeVector(embedding), model, version: EMBEDDING_VERSION };
  } catch (error) {
    await recordModelCallAudit({
      clientId: input.clientId, eventId: null, provider: "embedding", operation: "embedding",
      model, promptVersion: EMBEDDING_VERSION, status: "failed",
      inputTokens: estimateTokens(safeText), outputTokens: 0,
      latencyMs: Date.now() - startedAt, requestFingerprint: fingerprint,
      resultMetadata: { objectId: input.objectId ?? null, fallback: LOCAL_EMBEDDING_MODEL },
      errorCode: "embedding_provider_error", errorMessage: error instanceof Error ? error.message : String(error),
    });
    return { embedding: buildLocalEmbedding(input.text), model: LOCAL_EMBEDDING_MODEL, version: EMBEDDING_VERSION };
  }
}

export async function upsertEmbedding(db: Queryable, input: {
  clientId?: string | null;
  objectType: "event" | "entity" | "insight" | "digest" | "fact";
  objectId: string;
  content: string;
  metadata?: Record<string, unknown>;
}) {
  const content = input.content.normalize("NFKC").trim().slice(0, 20_000);
  if (!content) return null;
  const generated = await generateEmbedding({ text: content, clientId: input.clientId, objectId: input.objectId });
  const contentHash = crypto.createHash("sha256").update(content).digest("hex");
  const result = await db.query(`
    insert into knowledge_embeddings (
      id, client_id, object_type, object_id, embedding, dimensions,
      model, embedding_version, content_hash, content, metadata
    ) values ($1,$2,$3,$4,$5::float8[],$6,$7,$8,$9,$10,$11::jsonb)
    on conflict (object_type, object_id, embedding_version) do update set
      client_id = excluded.client_id, embedding = excluded.embedding,
      dimensions = excluded.dimensions, model = excluded.model,
      content_hash = excluded.content_hash, content = excluded.content,
      metadata = excluded.metadata, updated_at = now()
    returning id, object_type as "objectType", object_id as "objectId",
      dimensions, model, embedding_version as version, updated_at as "updatedAt"
  `, [
    `embedding_${randomUUID()}`, input.clientId ?? null, input.objectType, input.objectId,
    generated.embedding, generated.embedding.length, generated.model, generated.version,
    contentHash, content, JSON.stringify(input.metadata ?? {}),
  ]);
  return result.rows[0] ?? null;
}

export async function refreshEventEmbeddings(db: Queryable, eventId: string) {
  const event = await db.query<{
    id: string; clientId: string | null; source: string; kind: string;
    title: string | null; body: string | null; displayTitle: string | null;
    displayDescription: string | null;
  }>(`
    select event.id, event.client_id as "clientId", event.source, event.kind,
      event.title, event.body, classified.display_title as "displayTitle",
      classified.display_description as "displayDescription"
    from raw_events event left join classified_events classified on classified.raw_event_id = event.id
    where event.id = $1 and event.privacy_status <> 'hidden'
  `, [eventId]);
  const row = event.rows[0];
  if (!row) return [];
  const stored = [];
  const eventEmbedding = await upsertEmbedding(db, {
    clientId: row.clientId, objectType: "event", objectId: row.id,
    content: [row.displayTitle, row.displayDescription, row.title, row.body, row.source, row.kind].filter(Boolean).join("\n"),
    metadata: { source: row.source, kind: row.kind },
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
    const embedding = await upsertEmbedding(db, {
      clientId: row.clientId, objectType: "entity", objectId: entity.id,
      content: [entity.value, entity.description, entity.type, ...entity.aliases].filter(Boolean).join("\n"),
      metadata: { type: entity.type },
    });
    if (embedding) stored.push(embedding);
  }
  return stored;
}

