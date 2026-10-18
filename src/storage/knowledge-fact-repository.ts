import { randomUUID } from "node:crypto";
import type { ClassifiedEvent, EventInput } from "../domain/event.js";
import type { EntityDraft } from "../domain/entities.js";
import {
  KNOWLEDGE_FACT_EXTRACTOR_VERSION,
  knowledgeFactSchema,
  normalizeFactValue,
  type KnowledgeFact,
} from "../domain/knowledge-fact.js";
import { pool } from "./postgres.js";

type Queryable = Pick<typeof pool, "query">;

export type StoredKnowledgeFact = KnowledgeFact & {
  id: string;
  clientId: string | null;
  eventId: string;
  createdAt: string;
  updatedAt: string;
};

export function deriveKnowledgeFacts(input: {
  event: EventInput;
  classified: Pick<ClassifiedEvent, "inferredKind" | "confidence" | "classificationVersion" | "modelMetadata">;
  entities: EntityDraft[];
}): KnowledgeFact[] {
  const model = typeof input.classified.modelMetadata?.model === "string"
    ? input.classified.modelMetadata.model
    : null;
  const facts: KnowledgeFact[] = [knowledgeFactSchema.parse({
    factType: "event_classification",
    value: { kind: input.classified.inferredKind },
    normalizedValue: input.classified.inferredKind,
    confidence: input.classified.confidence,
    evidence: { eventId: input.event.id, source: input.event.source, fields: ["kind", "title", "body"] },
    model,
    modelVersion: model,
    promptVersion: model ? "classification-v1" : null,
    extractorVersion: KNOWLEDGE_FACT_EXTRACTOR_VERSION,
  })];

  const seen = new Set<string>();
  for (const entity of input.entities) {
    if (!["amount", "merchant", "sender", "recipient", "app", "card_last_four"].includes(entity.type)) continue;
    const value = { type: entity.type, value: entity.value };
    const normalizedValue = `${entity.type}:${entity.normalizedValue || normalizeFactValue(entity.value)}`;
    if (seen.has(normalizedValue)) continue;
    seen.add(normalizedValue);
    facts.push(knowledgeFactSchema.parse({
      factType: `entity_${entity.type}`,
      value,
      normalizedValue,
      confidence: typeof entity.metadata?.identityConfidence === "number"
        ? entity.metadata.identityConfidence
        : input.classified.confidence,
      evidence: { eventId: input.event.id, source: input.event.source, fields: ["classified_entities"] },
      model: entity.identitySource === "ai" ? model : null,
      modelVersion: entity.identitySource === "ai" ? model : null,
      promptVersion: entity.identitySource === "ai" ? "semantic-governance-v2" : null,
      extractorVersion: KNOWLEDGE_FACT_EXTRACTOR_VERSION,
    }));
  }
  return facts;
}

// B04: the previous event-wide fact replacement helper was removed. Fact
// replacement is scoped by extractor generation and fact type in
// replaceClassificationFacts (event-repository); a projection rebuild must not
// delete user-authored, other-extractor or other-domain facts.
export async function listEventKnowledgeFacts(db: Queryable, eventId: string) {
  const result = await db.query<StoredKnowledgeFact>(`
    select id, client_id as "clientId", event_id as "eventId",
      fact_type as "factType", value, normalized_value as "normalizedValue",
      confidence::float8 as confidence, evidence, model,
      model_version as "modelVersion", prompt_version as "promptVersion",
      extractor_version as "extractorVersion", visibility,
      created_at as "createdAt", updated_at as "updatedAt"
    from knowledge_facts where event_id = $1 and visibility <> 'hidden'
    order by confidence desc, fact_type, id
  `, [eventId]);
  return result.rows;
}
