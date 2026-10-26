import { z } from "zod";
import type { ClassifiedEvent, EventInput } from "../domain/event.js";
import { eventKindSchema } from "../domain/event.js";
import { generateNaturalLanguageSummary } from "./deepseek.js";
import { authorizeModelDispatch, loadSourceProcessingPolicy, type PrivacyAuthorization, type SourceProcessingPolicy } from "./privacy.js";
import { pool } from "./postgres.js";
import { loadClassificationLessons, type ClassificationLesson } from "./classification-learning.js";
import { classifyWithJev } from './jev.js';
import { applyConfirmedCorrections } from './correction-memory.js';
import { isCompletedFinancialNotice, isNonTransactionalFinancialNotice } from '../domain/classification.js';

type ClassificationAssistantDeps = {
  apiKey?: string;
  model: string;
  generateCompletion?: typeof generateNaturalLanguageSummary;
  resolvePolicy?: (input: { clientId: string | null; source: string }) => Promise<SourceProcessingPolicy>;
  authorizeDispatch?: (input: { ownerId: string | null; source: string }) => Promise<PrivacyAuthorization | null>;
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
    const authorization = deps.authorizeDispatch
      ? await deps.authorizeDispatch({ ownerId: input.clientId ?? null, source: input.event.source })
      : undefined;
    if (deps.authorizeDispatch && !authorization) {
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
      privacy: authorization,
      systemPrompt:
        "Return only strict JSON. Classify the real-world event semantics, not its transport type. A posted or completed card transaction is an expense even when captured as a notification and even when the title says Aviso; a rejected or declined attempt is only a notification. Preserve the exact currency and full amount, including thousands separators such as UYU 1.733,00. Extract concise evidence and generate a user-facing event identity for every event. displayTitle must state what actually happened in concise Spanish; never copy a generic heading such as Aviso, Notification, Message, or a raw sentence. displayDescription must explain the event using only supplied facts. Always inspect financial alerts and email bodies even when deterministic classification is already confident. For card alerts, identify the real merchant from processor descriptors such as +phone/OPENAI *CHATGPT, not the generic heading. confirmedExamples are explicit user corrections from this same source. Treat an exact or clearly equivalent descriptor as strong evidence for the canonical entity. taxonomyKeys and roles inside an exact confirmed example are user-confirmed facts about that entity; preserve them as evidence for the semantic governor, but never apply them to a merely similar-looking descriptor or invent an event category/relationship from them. Allowed entity types are only app, merchant, sender, recipient, message, amount, and card_last_four. Do not output domains, categories, concepts, notification titles, timestamps, other IDs, raw fragments, or invented entities; a separate semantic governor decides durable graph placement.",
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
            inferredKind: "email | expense | income | transfer | note | notification | task | other",
            confidence: "number between 0 and 1",
            entities: [{ type: "string", value: "string" }],
            rationale: "short explanation",
            displayTitle: "concise meaningful Spanish event name",
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
          },
        };
      }

      const suggestion = parsed.data;
      const improved = suggestion.confidence > input.base.confidence;
      const selectedTransactionType = typeof input.event.raw?.transactionType === "string"
        && ["income", "expense", "transfer"].includes(input.event.raw.transactionType)
        ? input.event.raw.transactionType
        : null;
      const financialKinds = new Set(["expense", "income", "transfer"]);
      const protectedFinancialKind = financialKinds.has(input.base.inferredKind)
        && (financialKinds.has(input.event.kind) || isCompletedFinancialNotice(input.event)
          || selectedTransactionType === input.base.inferredKind);
      const lowInformationKinds = new Set(["notification", "other"]);
      const protectedSpecificKind = !lowInformationKinds.has(input.base.inferredKind)
        && !financialKinds.has(input.base.inferredKind)
        && lowInformationKinds.has(suggestion.inferredKind);
      const protectedNonTransaction = isNonTransactionalFinancialNotice(input.event)
        && financialKinds.has(suggestion.inferredKind);
      const sameKind = suggestion.inferredKind === input.base.inferredKind;
      const correctingFinancialGuess = financialKinds.has(input.base.inferredKind)
        && lowInformationKinds.has(suggestion.inferredKind) && suggestion.confidence >= input.base.confidence;
      const applySuggestedKind = (improved || correctingFinancialGuess)
        && !protectedFinancialKind && !protectedSpecificKind && !protectedNonTransaction;
      const applied = sameKind ? improved : applySuggestedKind;

      return {
        ...input.base,
        classificationVersion: applied
          ? `${input.base.classificationVersion}+llm`
          : input.base.classificationVersion,
        inferredKind: applySuggestedKind ? suggestion.inferredKind : input.base.inferredKind,
        // Confidence belongs to the retained kind, never to a rejected answer.
        confidence: sameKind ? Math.max(input.base.confidence, suggestion.confidence)
          : applySuggestedKind ? suggestion.confidence : input.base.confidence,
        entities: mergeEntities(input.base.entities, suggestion.entities),
        modelMetadata: {
          provider: "deepseek",
          model: deps.model,
          applied,
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

const enhanceWithDeepSeek = createClassificationAssistant({
  apiKey: process.env.DEEPSEEK_API_KEY,
  model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
  resolvePolicy: (input) => loadSourceProcessingPolicy(pool, input),
  authorizeDispatch: async (input) => {
    const decision = await authorizeModelDispatch(pool, {
      ownerId: input.ownerId, purpose: "event_classification", sources: [input.source],
    });
    return decision.allowed ? decision : null;
  },
  loadLessons: (input) => loadClassificationLessons(pool, input),
});

export async function maybeEnhanceClassification(input: Parameters<typeof enhanceWithDeepSeek>[0]) {
  const jevAuthorization = input.allowModel === false
    ? null
    : await authorizeModelDispatch(pool, {
        ownerId: input.clientId ?? null,
        purpose: "event_classification",
        sources: [input.event.source],
        // Bind JEV to the event itself. Source-level authorization is not
        // enough for the direct classifier boundary.
        eventIds: [input.event.id],
      });
  const jev = await classifyWithJev({
    ...input,
    allowModel: input.allowModel === false ? false : jevAuthorization?.allowed === true,
    authorization: jevAuthorization?.allowed ? jevAuthorization : null,
  });
  const base = jev?.applied ? { ...input.base, inferredKind: jev.decision.answers.kind.choice,
    confidence: jev.decision.answers.kind.probabilities[jev.decision.answers.kind.choice]!, classificationVersion: 'jev-v1' } : input.base;
  const enhanced = await enhanceWithDeepSeek({ ...input, base });
  const result = jev ? { ...enhanced, inferredKind: jev.applied ? base.inferredKind : enhanced.inferredKind,
    modelMetadata: { ...enhanced.modelMetadata, jev } } : enhanced;
  if (process.env.BRAINIA_LEARNING_ENABLED !== 'true') return result;
  return applyConfirmedCorrections(input.event, result, input.clientId ?? null);
}
