import { z } from "zod";
import type { ClassifiedEvent, EventInput } from "../domain/event.js";
import { eventKindSchema } from "../domain/event.js";
import { generateNaturalLanguageSummary } from "./deepseek.js";
import { loadSourceProcessingPolicy, type SourceProcessingPolicy } from "./privacy.js";
import { pool } from "./postgres.js";
import { loadClassificationLessons, type ClassificationLesson } from "./classification-learning.js";

type ClassificationAssistantDeps = {
  apiKey?: string;
  model: string;
  generateCompletion?: typeof generateNaturalLanguageSummary;
  resolvePolicy?: (input: { clientId: string | null; source: string }) => Promise<SourceProcessingPolicy>;
  loadLessons?: (input: { clientId: string | null; source: string }) => Promise<ClassificationLesson[]>;
};

const suggestionSchema = z.object({
  inferredKind: eventKindSchema,
  confidence: z.number().min(0).max(1),
  entities: z
    .array(
      z.object({
        type: z.string().min(1),
        value: z.string().min(1),
      }),
    )
    .default([]),
  rationale: z.string().optional(),
  displayTitle: z.string().min(2).max(100).optional(),
  displayDescription: z.string().min(20).max(500).optional(),
});

// The classifier extracts evidence only.  It is deliberately not allowed to
// mint arbitrary graph types: semantic-enrichment is the single governed path
// for deciding whether evidence becomes durable knowledge.
const MODEL_EVIDENCE_TYPES = new Set(["app", "merchant", "sender", "recipient", "message", "amount", "card_last_four"]);

function normalizeEntityKey(type: string, value: string) {
  return `${type}:${value.trim().toLowerCase()}`;
}

function mergeEntities(
  baseEntities: ClassifiedEvent["entities"],
  suggestedEntities: ClassifiedEvent["entities"],
) {
  const merged: ClassifiedEvent["entities"] = [];
  const seen = new Set<string>();
  const hasDeterministicAmount = baseEntities.some((entity) => entity.type === "amount");
  const orderedEntities = hasDeterministicAmount
    ? [
        ...baseEntities.filter((entity) => entity.type === "amount"),
        ...suggestedEntities.filter((entity) => entity.type !== "amount"),
        ...baseEntities.filter((entity) => entity.type !== "amount"),
      ]
    : [...suggestedEntities, ...baseEntities];

  // Deterministically parsed amounts are ledger facts and cannot be replaced by
  // a model guess. Model-normalized merchant evidence still takes precedence.
  for (const entity of orderedEntities) {
    const normalizedValue = entity.value.trim();
    if (!normalizedValue) continue;
    if (suggestedEntities.includes(entity) && !MODEL_EVIDENCE_TYPES.has(entity.type)) continue;
    if (hasDeterministicAmount && suggestedEntities.includes(entity) && entity.type === "amount") continue;
    if (normalizedValue.length > 160 || /\r|\n/.test(normalizedValue)) continue;

    const key = normalizeEntityKey(entity.type, normalizedValue);
    if (seen.has(key)) continue;

    seen.add(key);
    merged.push({
      type: entity.type,
      value: normalizedValue,
    });
  }

  return merged;
}

function parseSuggestion(content: string) {
  const trimmed = content.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fencedMatch?.[1]?.trim() ?? trimmed;
  const jsonStart = jsonText.indexOf("{");
  const jsonEnd = jsonText.lastIndexOf("}");

  if (jsonStart < 0 || jsonEnd < 0 || jsonEnd <= jsonStart) {
    throw new Error("DeepSeek did not return JSON");
  }

  return JSON.parse(jsonText.slice(jsonStart, jsonEnd + 1));
}

export function createClassificationAssistant(deps: ClassificationAssistantDeps) {
  return async function maybeEnhanceClassification(input: {
    event: EventInput;
    base: ClassifiedEvent;
    clientId?: string | null;
    allowModel?: boolean;
    auditEventId?: string | null;
  }) {
    // Email bodies often contain the most useful source detail (receipts, transaction
    // alerts, confirmations, and commitments). Always let the model inspect them;
    // the confidence shortcut remains in place for non-email events.
    if (!deps.apiKey || input.allowModel === false) {
      return {
        ...input.base,
        modelMetadata: input.allowModel === false ? {
          provider: "deepseek", model: deps.model, applied: false, reason: "private_evidence",
        } : null,
      };
    }

    const policy = deps.resolvePolicy
      ? await deps.resolvePolicy({ clientId: input.clientId ?? null, source: input.event.source })
      : null;
    if (policy && (!policy.enabled || !policy.sendToLlm)) {
      return {
        ...input.base,
        modelMetadata: {
          provider: "deepseek",
          model: deps.model,
          applied: false,
          reason: "privacy_policy",
        },
      };
    }

    const completion = deps.generateCompletion ?? generateNaturalLanguageSummary;
    // A correction is not a one-off display preference. It is supervised
    // evidence about how this user's source encodes real-world entities.
    // Retrieval is bounded and best-effort so learning can never block capture.
    let confirmedExamples: ClassificationLesson[] = [];
    try {
      confirmedExamples = await (deps.loadLessons?.({ clientId: input.clientId ?? null, source: input.event.source })
        ?? Promise.resolve([]));
    } catch {
      confirmedExamples = [];
    }
    const content = await completion({
      apiKey: deps.apiKey,
      model: deps.model,
      jsonMode: true,
      audit: {
        clientId: input.clientId ?? null,
        eventId: input.auditEventId === undefined ? input.event.id : input.auditEventId,
        operation: "event_classification",
        promptVersion: "classification-v3",
      },
      redaction: policy ?? undefined,
      systemPrompt:
        "Return only strict JSON. Classify the real-world event semantics, not its transport type. A posted or completed card transaction is an expense even when captured as a notification and even when the title says Aviso; a rejected or declined attempt is only a notification. Preserve the exact currency and full amount, including thousands separators such as UYU 1.733,00. Extract concise evidence and generate a user-facing event identity for every event. displayTitle must state what actually happened in concise English; never copy a generic heading such as Aviso, Notification, Message, or a raw sentence. displayDescription must explain the event using only supplied facts. Always inspect financial alerts and email bodies even when deterministic classification is already confident. For card alerts, identify the real merchant from processor descriptors such as +phone/OPENAI *CHATGPT, not the generic heading. confirmedExamples are explicit user corrections from this same source. Treat an exact or clearly equivalent descriptor as strong evidence for the canonical entity. taxonomyKeys and roles inside an exact confirmed example are user-confirmed facts about that entity; preserve them as evidence for the semantic governor, but never apply them to a merely similar-looking descriptor or invent an event category/relationship from them. Allowed entity types are only app, merchant, sender, recipient, message, amount, and card_last_four. Do not output domains, categories, concepts, notification titles, timestamps, other IDs, raw fragments, or invented entities; a separate semantic governor decides durable graph placement.",
      userPrompt: JSON.stringify(
        {
          event: {
            id: input.event.id,
            source: input.event.source,
            contractVersion: input.event.contractVersion,
            kind: input.event.kind,
            title: input.event.title ?? null,
            body: input.event.body ?? null,
            externalId: input.event.externalId ?? null,
            tags: input.event.tags ?? [],
          },
          base: {
            inferredKind: input.base.inferredKind,
            confidence: input.base.confidence,
            entities: input.base.entities,
          },
          confirmedExamples,
          responseShape: {
            inferredKind: "email | expense | transfer | note | notification | task | other",
            confidence: "number between 0 and 1",
            entities: [{ type: "string", value: "string" }],
            rationale: "short explanation",
            displayTitle: "concise meaningful English event name",
            displayDescription: "20-500 character factual event description",
          },
        },
        null,
        2,
      ),
    });

    if (!content) {
      return {
        ...input.base,
        modelMetadata: {
          provider: "deepseek",
          model: deps.model,
          applied: false,
          reason: "empty_response",
        },
      };
    }

    try {
      const parsed = suggestionSchema.safeParse(parseSuggestion(content));
      if (!parsed.success) {
        return {
          ...input.base,
          modelMetadata: {
            provider: "deepseek",
            model: deps.model,
            applied: false,
            reason: "invalid_response",
            rawResponse: content,
          },
        };
      }

      const suggestion = parsed.data;
      const improved = suggestion.confidence > input.base.confidence;
      const selectedTransactionType = typeof input.event.raw?.transactionType === "string"
        && ["income", "expense", "transfer"].includes(input.event.raw.transactionType)
        ? input.event.raw.transactionType
        : null;
      const protectedFinancialKind = (input.base.inferredKind === "expense" || input.base.inferredKind === "income" || input.base.inferredKind === "transfer")
        && (input.base.confidence >= 0.95 || selectedTransactionType === input.base.inferredKind);
      const lowInformationKinds = new Set(["notification", "other"]);
      const protectedSpecificKind = !lowInformationKinds.has(input.base.inferredKind)
        && lowInformationKinds.has(suggestion.inferredKind);
      const applySuggestedKind = improved && !protectedFinancialKind && !protectedSpecificKind;

      return {
        ...input.base,
        classificationVersion: improved
          ? `${input.base.classificationVersion}+llm`
          : input.base.classificationVersion,
        inferredKind: applySuggestedKind ? suggestion.inferredKind : input.base.inferredKind,
        confidence: Math.max(input.base.confidence, suggestion.confidence),
        entities: mergeEntities(input.base.entities, suggestion.entities),
        modelMetadata: {
          provider: "deepseek",
          model: deps.model,
          applied: improved,
          prompt: {
            eventId: input.event.id,
            source: input.event.source,
            title: input.event.title ?? null,
            body: input.event.body ?? null,
            baseKind: input.base.inferredKind,
            baseConfidence: input.base.confidence,
          },
          response: suggestion,
          learning: { confirmedExamples: confirmedExamples.length },
          rawResponse: content,
        },
      };
    } catch {
      return {
        ...input.base,
        modelMetadata: {
          provider: "deepseek",
          model: deps.model,
          applied: false,
          reason: "parse_error",
        },
      };
    }
  };
}

export const maybeEnhanceClassification = createClassificationAssistant({
  apiKey: process.env.DEEPSEEK_API_KEY,
  model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
  resolvePolicy: (input) => loadSourceProcessingPolicy(pool, input),
  loadLessons: (input) => loadClassificationLessons(pool, input),
});
