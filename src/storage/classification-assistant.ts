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
import {
  DECISION_POLICY_VERSION,
  decisionPolicyMode,
  unsupportedNumericClaims,
  type DecisionVerification,
  type EvidenceItem,
  type EvidenceReference,
} from "../domain/decision-policy.js";
import { validateEvidenceReferences, verifyDecision } from "./decision-verification.js";

type ClassificationAssistantDeps = {
  apiKey?: string;
  model: string;
  generateCompletion?: typeof generateNaturalLanguageSummary;
  verifyCompletion?: typeof generateNaturalLanguageSummary;
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
  evidence: z.array(z.object({
    field: z.enum(["inferredKind", "entities", "displayTitle", "displayDescription"]),
    ref: z.string().min(1).max(220),
    excerpt: z.string().min(1).max(600).optional(),
  })).max(12).optional(),
  abstainReason: z.string().min(1).max(500).nullable().optional(),
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

function classificationEvidence(event: EventInput, base: ClassifiedEvent, lessons: ClassificationLesson[]): EvidenceItem[] {
  const occurredAt = event.timestamp ?? null;
  const items: EvidenceItem[] = [
    { ref: "event.title", kind: "event_title", label: "Título", text: event.title ?? "", eventId: event.id, source: event.source, occurredAt, field: "title" },
    { ref: "event.body", kind: "event_body", label: "Texto", text: event.body ?? "", eventId: event.id, source: event.source, occurredAt, field: "body" },
    { ref: "event.source", kind: "event_source", label: "Fuente", text: event.source, eventId: event.id, source: event.source, occurredAt, field: "source" },
    { ref: "event.kind", kind: "event_kind", label: "Tipo capturado", text: event.kind, eventId: event.id, source: event.source, occurredAt, field: "kind" },
    { ref: "deterministic.classification", kind: "deterministic", label: "Clasificación determinista", text: base.inferredKind, eventId: event.id, source: event.source, occurredAt, field: "inferredKind" },
    {
      ref: "deterministic.amount",
      kind: "deterministic",
      label: "Importe determinista",
      text: base.entities.filter((entity) => entity.type === "amount").map((entity) => entity.value).join(" | "),
      eventId: event.id,
      source: event.source,
      occurredAt,
      field: "amount",
    },
    {
      ref: "deterministic.entities",
      kind: "deterministic",
      label: "Entidades deterministas",
      text: base.entities.map((entity) => `${entity.type}: ${entity.value}`).join(" | "),
      eventId: event.id,
      source: event.source,
      occurredAt,
      field: "entities",
    },
    {
      ref: "human.confirmed-examples",
      kind: "human_correction",
      label: "Correcciones humanas confirmadas",
      text: lessons.map((lesson) => JSON.stringify(lesson)).join("\n"),
      eventId: event.id,
      source: event.source,
      occurredAt,
      field: "corrections",
    },
  ];
  return items.filter((item) => item.text.trim().length > 0);
}

function moneyDigits(value: string) {
  return value.replace(/[^\d]/gu, "").replace(/0+$/u, "");
}

function eventContainsMoney(eventText: string, amount: string) {
  if (!amount) return false;
  if (eventText.includes(amount)) return true;
  const digits = moneyDigits(amount);
  if (!digits) return false;
  return [...eventText.matchAll(/-?\d+(?:[.,]\d+)*/gu)]
    .some((match) => moneyDigits(match[0]) === digits);
}

function validateClassificationSuggestion(input: {
  suggestion: z.infer<typeof suggestionSchema>;
  base: ClassifiedEvent;
  event: EventInput;
  evidence: EvidenceItem[];
}) {
  const { suggestion, base, event, evidence } = input;
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!suggestion.evidence?.length) {
    if (decisionPolicyMode() === "enforce") errors.push("missing_evidence_references");
    else warnings.push("legacy_response_without_evidence");
  } else {
    const resolution = resolveEvidence(suggestion.evidence, evidence);
    errors.push(...resolution.errors);
  }
  const financialKinds = new Set(["expense", "income", "transfer"]);
  const eventText = [event.title, event.body, event.raw ? JSON.stringify(event.raw) : ""].filter(Boolean).join("\n");
  const deterministicAmount = base.entities.find((entity) => entity.type === "amount")?.value ?? "";
  const modelAmount = suggestion.entities.find((entity) => entity.type === "amount")?.value ?? "";
  const amountEvidence = deterministicAmount || modelAmount;
  if (financialKinds.has(suggestion.inferredKind) && suggestion.inferredKind !== base.inferredKind) {
    if (!amountEvidence) errors.push("financial_kind_without_amount_evidence");
    else if (!eventContainsMoney(eventText, amountEvidence)) errors.push("amount_not_in_event_evidence");
  }
  for (const entity of suggestion.entities) {
    if (entity.type === "amount" && deterministicAmount && moneyDigits(entity.value) !== moneyDigits(deterministicAmount)) {
      errors.push(`model_amount_conflicts_with_deterministic:${entity.value}`);
    }
    if (["merchant", "app", "sender", "recipient"].includes(entity.type) && !entity.value.trim()) {
      errors.push(`empty_entity:${entity.type}`);
    }
  }
  if (suggestion.displayTitle && /^(?:aviso|alerta|notification|notificaci[oó]n|message|mensaje|movimiento)$/iu.test(suggestion.displayTitle.trim())) {
    errors.push("generic_display_title");
  }
  if (suggestion.displayDescription) {
    const unsupported = unsupportedNumericClaims(suggestion.displayDescription, eventText);
    if (unsupported.length) errors.push(`unsupported_description_numbers:${unsupported.join(",")}`);
  }
  if (suggestion.abstainReason) errors.push("model_abstained");
  return { ok: errors.length === 0, errors, warnings };
}

function resolveEvidence(references: EvidenceReference[], evidence: EvidenceItem[]) {
  const check = validateEvidenceReferences({ references, evidence, requireEventEvidence: true });
  return { errors: check.errors };
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
    const evidence = classificationEvidence(input.event, input.base, confirmedExamples);
    const promptVersion = "classification-v4";
    const content = await completion({
      apiKey: deps.apiKey,
      model: deps.model,
      jsonMode: true,
      audit: {
        clientId: input.clientId ?? null,
        eventId: input.auditEventId === undefined ? input.event.id : input.auditEventId,
        operation: "event_classification",
        promptVersion,
      },
      redaction: policy ?? undefined,
      privacy: authorization,
      systemPrompt:
        "Return only strict JSON. Classify the real-world event semantics, not its transport type. A posted or completed card transaction is an expense even when captured as a notification and even when the title says Aviso; a rejected or declined attempt is only a notification. Preserve the exact currency and full amount, including thousands separators such as UYU 1.733,00. Extract concise evidence and generate a user-facing event identity for every event. displayTitle must state what actually happened in concise Spanish; never copy a generic heading such as Aviso, Notification, Message, or a raw sentence. displayDescription must explain the event using only supplied facts. Always inspect financial alerts and email bodies even when deterministic classification is already confident. For card alerts, identify the real merchant from processor descriptors such as +phone/OPENAI *CHATGPT, not the generic heading. confirmedExamples are explicit user corrections from this same source. Treat an exact or clearly equivalent descriptor as strong evidence for the canonical entity. taxonomyKeys and roles inside an exact confirmed example are user-confirmed facts about that entity; preserve them as evidence for the semantic governor, but never apply them to a merely similar-looking descriptor or invent an event category/relationship from them. Allowed entity types are only app, merchant, sender, recipient, message, amount, and card_last_four. Do not output domains, categories, concepts, notification titles, timestamps, other IDs, raw fragments, or invented entities; a separate semantic governor decides durable graph placement. Evidence discipline is mandatory: return at least one {field,ref,excerpt} item; copy refs only from evidenceRefs and make excerpt a literal substring. A financial kind requires a deterministic amount present in the event evidence. If the evidence is insufficient, return abstainReason in Spanish and do not invent an answer.",
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
          evidenceRefs: evidence.map((item) => ({ ref: item.ref, kind: item.kind, label: item.label })),
          responseShape: {
            inferredKind: "email | expense | income | transfer | note | notification | task | other",
            confidence: "number between 0 and 1",
            entities: [{ type: "string", value: "string" }],
            rationale: "short explanation",
            displayTitle: "concise meaningful Spanish event name",
            displayDescription: "20-500 character factual event description",
            evidence: [{ field: "inferredKind | entities | displayTitle | displayDescription", ref: "copied from evidenceRefs", excerpt: "literal fragment" }],
            abstainReason: "Spanish reason or null",
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
      const deterministic = validateClassificationSuggestion({ suggestion, base: input.base, event: input.event, evidence });
      const shouldVerify = Boolean(deps.verifyCompletion) || !deps.generateCompletion;
      const policyMode = decisionPolicyMode();
      const verificationOutcome = suggestion.evidence?.length && shouldVerify
        ? await verifyDecision({
            actionKind: "classify_event",
            operation: "event_classification",
            clientId: input.clientId ?? null,
            eventId: input.auditEventId === undefined ? input.event.id : input.auditEventId,
            generatorModel: deps.model,
            generatorPromptVersion: promptVersion,
            evidence,
            evidenceReferences: suggestion.evidence,
            canonicalContext: { deterministicBase: input.base.inferredKind, confirmedExamples: confirmedExamples.length },
            proposal: {
              inferredKind: suggestion.inferredKind,
              entities: suggestion.entities,
              displayTitle: suggestion.displayTitle ?? null,
              displayDescription: suggestion.displayDescription ?? null,
            },
            deterministic,
            privacy: authorization,
            apiKey: deps.apiKey,
            completion: deps.verifyCompletion,
          })
        : {
            verification: {
              status: deterministic.ok ? "not_required" as const : "rejected" as const,
              actionKind: "classify_event" as const,
              policyVersion: DECISION_POLICY_VERSION,
              verifierModel: "legacy-or-test-seam",
              verifierPromptVersion: "not-run",
              deterministic,
              reason: deterministic.ok
                ? (policyMode === "off" ? "policy_off" : "legacy_response_without_evidence")
                : deterministic.errors.join(","),
              unsupported: [],
              pathVerdicts: [],
              associationVerdicts: [],
              evidenceFingerprint: null,
              checkedAt: new Date().toISOString(),
              enforced: policyMode === "enforce",
            } satisfies DecisionVerification,
            applies: deterministic.ok && policyMode !== "enforce",
          };
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
      const accepted = verificationOutcome.verification.deterministic.ok
        && verificationOutcome.applies
        && !suggestion.abstainReason;
      const applied = accepted && (sameKind ? improved : applySuggestedKind);

      return {
        ...input.base,
        classificationVersion: applied
          ? `${input.base.classificationVersion}+llm`
          : input.base.classificationVersion,
        inferredKind: applied && applySuggestedKind ? suggestion.inferredKind : input.base.inferredKind,
        // Confidence belongs to the retained kind, never to a rejected answer.
        confidence: applied
          ? (sameKind ? Math.max(input.base.confidence, suggestion.confidence) : suggestion.confidence)
          : input.base.confidence,
        entities: accepted ? mergeEntities(input.base.entities, suggestion.entities) : input.base.entities,
        modelMetadata: {
          provider: "deepseek",
          model: deps.model,
          applied,
          policyVersion: DECISION_POLICY_VERSION,
          prompt: {
            eventId: input.event.id,
            source: input.event.source,
            title: input.event.title ?? null,
            body: input.event.body ?? null,
            baseKind: input.base.inferredKind,
            baseConfidence: input.base.confidence,
          },
          response: suggestion,
          verification: verificationOutcome.verification,
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
  let jev = await classifyWithJev({
    ...input,
    allowModel: input.allowModel === false ? false : jevAuthorization?.allowed === true,
    authorization: jevAuthorization?.allowed ? jevAuthorization : null,
  });
  let jevVerification: DecisionVerification | null = null;
  if (jev?.applied && jevAuthorization?.allowed) {
    const evidence = classificationEvidence(input.event, input.base, []);
    const verified = await verifyDecision({
      actionKind: "classify_event",
      operation: "jev_classification",
      clientId: input.clientId ?? null,
      eventId: input.event.id,
      generatorModel: jev.decision.model,
      generatorPromptVersion: "jev-v1",
      evidence,
      evidenceReferences: [{ ref: "event.title", excerpt: input.event.title?.trim().slice(0, 200) || undefined },
        { ref: "event.body", excerpt: input.event.body?.trim().slice(0, 200) || undefined }].filter((reference) => reference.excerpt),
      canonicalContext: { deterministicBase: input.base.inferredKind },
      proposal: { inferredKind: jev.decision.answers.kind.choice },
      deterministic: { ok: true, errors: [] },
      privacy: jevAuthorization,
    });
    jevVerification = verified.verification;
    if (!verified.applies) jev = null;
  }
  const base = jev?.applied ? { ...input.base, inferredKind: jev.decision.answers.kind.choice,
    confidence: jev.decision.answers.kind.probabilities[jev.decision.answers.kind.choice]!, classificationVersion: 'jev-v1' } : input.base;
  const enhanced = await enhanceWithDeepSeek({ ...input, base });
  const result = jev ? { ...enhanced, inferredKind: jev.applied ? base.inferredKind : enhanced.inferredKind,
    modelMetadata: { ...enhanced.modelMetadata, jev, jevVerification } } : enhanced;
  if (process.env.BRAINIA_LEARNING_ENABLED !== 'true') return result;
  return applyConfirmedCorrections(input.event, result, input.clientId ?? null);
}
