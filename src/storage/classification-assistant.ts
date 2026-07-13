import { z } from "zod";
import type { ClassifiedEvent, EventInput } from "../domain/event.js";
import { eventKindSchema } from "../domain/event.js";
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
    if (!deps.apiKey || input.base.confidence >= 0.75) {
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
        "Return only strict JSON. Improve an ambiguous event classification using the provided event and base heuristic output. Keep the same fields and do not invent unrelated entities.",
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
