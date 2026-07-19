import { z } from "zod";
import type { ClassifiedEvent, EventInput } from "../domain/event.js";
import { eventKindSchema } from "../domain/event.js";
import { isCompletedCardTransactionAlert } from "../domain/classification.js";
import { generateNaturalLanguageSummary } from "./deepseek.js";

type ClassificationAssistantDeps = {
  apiKey?: string;
  model: string;
  generateCompletion?: typeof generateNaturalLanguageSummary;
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
});

// The classifier extracts evidence only.  It is deliberately not allowed to
// mint arbitrary graph types: semantic-enrichment is the single governed path
// for deciding whether evidence becomes durable knowledge.
const MODEL_EVIDENCE_TYPES = new Set(["app", "merchant", "sender", "recipient", "message"]);

function normalizeEntityKey(type: string, value: string) {
  return `${type}:${value.trim().toLowerCase()}`;
}

function mergeEntities(
  baseEntities: ClassifiedEvent["entities"],
  suggestedEntities: ClassifiedEvent["entities"],
) {
  const merged: ClassifiedEvent["entities"] = [];
  const seen = new Set<string>();

  for (const entity of [...baseEntities, ...suggestedEntities]) {
    const normalizedValue = entity.value.trim();
    if (!normalizedValue) continue;
    if (suggestedEntities.includes(entity) && !MODEL_EVIDENCE_TYPES.has(entity.type)) continue;
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
  }) {
    // Email bodies often contain the most useful source detail (receipts, transaction
    // alerts, confirmations, and commitments). Always let the model inspect them;
    // the confidence shortcut remains in place for non-email events.
    const isEmail = input.event.kind === "email" || input.base.inferredKind === "email";
    if (isCompletedCardTransactionAlert(input.event)) {
      return {
        ...input.base,
        modelMetadata: {
          provider: "heuristic",
          model: "deterministic-card-alert",
          applied: true,
          reason: "completed_card_transaction",
        },
      };
    }

    if (!deps.apiKey || (!isEmail && input.base.confidence >= 0.75)) {
      return {
        ...input.base,
        modelMetadata: null,
      };
    }

    const completion = deps.generateCompletion ?? generateNaturalLanguageSummary;
    const content = await completion({
      apiKey: deps.apiKey,
      model: deps.model,
      systemPrompt:
        "Return only strict JSON. Classify the event and extract concise evidence from its content. For emails, inspect the body even when the base classification is confident: detect transaction alerts, receipts, commitments, people, merchants, amounts, dates, and other meaningful evidence. Allowed entity types are only app, merchant, sender, recipient, and message. Do not output domains, categories, concepts, notification titles, amounts, IDs, timestamps, raw fragments, or invented entities; a separate semantic governor decides durable graph nodes.",
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
          responseShape: {
            inferredKind: "email | expense | note | notification | task | other",
            confidence: "number between 0 and 1",
            entities: [{ type: "string", value: "string" }],
            rationale: "short explanation",
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

      return {
        ...input.base,
        classificationVersion: improved
          ? `${input.base.classificationVersion}+llm`
          : input.base.classificationVersion,
        inferredKind: improved ? suggestion.inferredKind : input.base.inferredKind,
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
});
