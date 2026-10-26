import { z } from "zod";
import type { EntityDraft } from "../domain/entities.js";
import { normalizeEntityValue } from "../domain/entities.js";
import {
  DECISION_POLICY_VERSION,
  DECISION_VERIFIER_PROMPT_VERSION,
  decisionEvidenceFingerprint,
  decisionPolicyMode,
  isLowUtilityPromotion,
  isRedundantProviderOrHeadingConcept,
  isRejectedFinancialText,
  isSupportedAssociationRationale,
  semanticActionKind,
  type DecisionVerification,
  type EvidenceItem,
  type EvidenceReference,
} from "../domain/decision-policy.js";
import {
  AUTO_APPLY_CONFIDENCE,
  LIFE_DOMAINS,
  MAX_SEMANTIC_DEPTH,
  NEW_NODE_OBSERVATION_CONFIDENCE,
  ONTOLOGY_PARENT_RELATIONS,
  ONTOLOGY_TREE,
  PRIMARY_ROOT_CONFIDENCE,
  PRIMARY_ROOT_MARGIN,
  SEMANTIC_GOVERNANCE_VERSION,
  SEMANTIC_PROMPT_VERSION,
  TAXONOMY_VERSION,
  categoryByKey,
  categoryByLabel,
  categoryCatalogPrompt,
  categoryKeyForPath,
  categoryPath,
  ontologyTreePrompt,
} from "../domain/ontology.js";
import { normalizeRelationType } from "../domain/relations.js";
import { generateNaturalLanguageSummary } from "./deepseek.js";
import { pool } from "./postgres.js";
import {
  authorizeModelDispatch,
  loadSourceProcessingPolicy,
  stillAuthorized,
  type PrivacyAuthorization,
  type SourceProcessingPolicy,
} from "./privacy.js";
import { retrieveSemanticContext } from "./hybrid-retrieval.js";
import { tautologyCheck, validateEvidenceReferences, verifyDecision } from "./decision-verification.js";

// Hierarchy is for the meaning of an occurrence, never for the systems and
// actors mentioned by it. Apps, merchants, senders and recipients remain
// first-class identity/evidence nodes (and deterministic facets), but letting
// the model place them in a life-domain tree made a payment processor look
// like a durable personal concept.
export const SEMANTIC_SUBJECT_TYPES = new Set(["email_message", "financial_event", "activity_instance"]);
export const STANDARD_ASSOCIATION_TYPES = new Set(["spent_at", "sent_by", "sent_to", "received_from", "uses_service", "produced_by_app", "represents_order", "paid_for", "has_transaction", "occurred_at", "received_via", "controls", "mentions", "related_to"]);

export type SemanticStep = {
  parent: string;
  decision: "descend_existing" | "stop" | "propose_child" | "merge" | "discard" | "no_relation";
  selectedChild: string | null;
  confidence: number;
  alternatives: Array<{ value: string; confidence: number }>;
};

export type SemanticPathDecision = {
  subject: EntityDraft;
  identity?: {
    canonicalName: string;
    description: string;
    confidence: number;
  };
  role: "primary" | "secondary";
  domain: string;
  action: "reuse" | "create" | "merge" | "discard" | "no_relation";
  hierarchyPath: string[];
  steps: SemanticStep[];
  confidence: number;
  rationale: string;
  evidence?: EvidenceReference[];
  proposedChild?: { value: string; description: string; parent: string; durable: boolean; confidence: number } | null;
  mergeTargetNormalizedValue?: string | null;
  eventAnchor?: boolean;
  categoryKey?: string | null;
};

export type SemanticFacet = {
  type: "merchant" | "account" | "channel" | "sender" | "recipient" | "location" | "recurrence" | "payment_method" | "status";
  value: string;
  normalizedValue: string;
  confidence: number;
  source: "deterministic" | "deepseek";
};

export type SemanticAssociationDecision = {
  sourceNormalizedValue: string;
  targetNormalizedValue: string;
  relationType: string;
  confidence: number;
  rationale: string;
  evidence?: EvidenceReference[];
};

export type SemanticDecision = {
  paths: SemanticPathDecision[];
  associations: SemanticAssociationDecision[];
  rootAlternatives: Array<{ value: string; confidence: number }>;
  governanceVersion: typeof SEMANTIC_GOVERNANCE_VERSION;
  promptVersion: typeof SEMANTIC_PROMPT_VERSION;
  model: string;
  status: "resolved" | "review" | "unclassified" | "model_unavailable" | "retryable" | "discarded";
  source: "deepseek" | "structural";
  failureReason?: "missing_api_key" | "empty_response" | "invalid_response" | "model_error" | "privacy_policy";
  taxonomyVersion: typeof TAXONOMY_VERSION;
  primaryCategoryKey: string | null;
  secondaryCategoryKeys: string[];
  facets: SemanticFacet[];
  policyVersion?: string;
  evidence?: EvidenceItem[];
  evidenceFingerprint?: string | null;
  verification?: DecisionVerification | null;
  verificationStatus?: "verified" | "rejected" | "unavailable" | "not_required";
  abstained?: boolean;
  abstentionReason?: string | null;
  rejectedProposals?: Array<{ kind: string; label: string; reason: string }>;
};

const alternativeSchema = z.object({ value: z.string().min(1).max(120), confidence: z.number().min(0).max(1) });
const evidenceRefSchema = z.object({ ref: z.string().min(1).max(220), excerpt: z.string().min(1).max(1000).optional() });
const stepSchema = z.object({
  parent: z.string().min(1).max(120),
  decision: z.enum(["descend_existing", "stop", "propose_child", "merge", "discard", "no_relation"]),
  selectedChild: z.string().min(1).max(120).nullable(),
  confidence: z.number().min(0).max(1),
  alternatives: z.array(alternativeSchema).max(8).default([]),
});
const pathSchema = z.object({
  subjectNormalizedValue: z.string().min(1),
  identity: z.object({
    canonicalName: z.string().min(2).max(100),
    description: z.string().min(20).max(500),
    confidence: z.number().min(0).max(1),
  }),
  role: z.enum(["primary", "secondary"]),
  domain: z.string().min(1).max(120),
  action: z.enum(["reuse", "create", "merge", "discard", "no_relation"]),
  hierarchyPath: z.array(z.string().min(1).max(120)).min(1).max(MAX_SEMANTIC_DEPTH),
  steps: z.array(stepSchema).max(MAX_SEMANTIC_DEPTH).default([]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(600),
  evidence: z.array(evidenceRefSchema).min(1).max(12),
  proposedChild: z.object({ value: z.string().min(2).max(120), description: z.string().min(20).max(500), parent: z.string().min(1).max(120), durable: z.boolean(), confidence: z.number().min(0).max(1) }).nullable().optional(),
  mergeTargetNormalizedValue: z.string().min(1).nullable().optional(),
  categoryKey: z.string().min(1).max(160).nullable().optional(),
});
const modelSchema = z.object({
  rootAlternatives: z.array(alternativeSchema).min(1).max(LIFE_DOMAINS.length),
  paths: z.array(pathSchema).max(30),
  associations: z.array(z.object({
    sourceNormalizedValue: z.string().min(1), targetNormalizedValue: z.string().min(1),
    relationType: z.string().min(1).max(80), confidence: z.number().min(0).max(1), rationale: z.string().min(1).max(400),
    evidence: z.array(evidenceRefSchema).min(1).max(8),
  })).max(20).default([]),
  primaryCategoryKey: z.string().min(1).max(160).nullable().optional(),
  secondaryCategoryKeys: z.array(z.string().min(1).max(160)).max(4).default([]),
  abstentionReason: z.string().min(1).max(500).nullable().optional(),
  facets: z.array(z.object({
    type: z.enum(["merchant", "account", "channel", "sender", "recipient", "location", "recurrence", "payment_method", "status"]),
    value: z.string().min(1).max(160),
    confidence: z.number().min(0).max(1),
  })).max(20).default([]),
});

function deterministicFacets(entities: EntityDraft[], source: string, inferredKind: string): SemanticFacet[] {
  const supported = new Map<string, SemanticFacet["type"]>([
    ["merchant", "merchant"], ["sender", "sender"], ["recipient", "recipient"], ["app", "channel"],
    ["account", "account"], ["card_last_four", "payment_method"], ["location", "location"],
  ]);
  const facets: SemanticFacet[] = entities.flatMap((entity) => {
    const type = supported.get(entity.type);
    return type ? [{ type, value: entity.value, normalizedValue: entity.normalizedValue, confidence: 0.9, source: "deterministic" as const }] : [];
  });
  if (source.trim() && !facets.some((facet) => facet.type === "channel" && facet.normalizedValue === normalizeEntityValue(source))) {
    facets.push({ type: "channel", value: source.trim(), normalizedValue: normalizeEntityValue(source), confidence: 1, source: "deterministic" });
  }
  facets.push({ type: "status", value: inferredKind, normalizedValue: normalizeEntityValue(inferredKind), confidence: 1, source: "deterministic" });
  return [...new Map(facets.map((facet) => [`${facet.type}:${facet.normalizedValue}`, facet])).values()];
}

function decisionCategorization(paths: SemanticPathDecision[]) {
  const anchored = paths.filter((path) => path.eventAnchor !== false && ["activity_instance", "financial_event", "email_message"].includes(path.subject.type));
  const primary = anchored.find((path) => path.role === "primary") ?? paths.find((path) => path.role === "primary");
  const primaryCategoryKey = primary?.categoryKey ?? categoryKeyForPath(primary?.hierarchyPath ?? []);
  const secondaryCategoryKeys = [...new Set(paths
    .filter((path) => path.role === "secondary")
    .map((path) => path.categoryKey ?? categoryKeyForPath(path.hierarchyPath))
    .filter((key): key is string => Boolean(key)))];
  return { primaryCategoryKey: primaryCategoryKey ?? null, secondaryCategoryKeys };
}

export async function requestSemanticJson(input: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  clientId: string | null;
  eventId: string | null;
  policy: SourceProcessingPolicy;
  privacy?: PrivacyAuthorization | null;
  operation?: string;
  completion?: typeof generateNaturalLanguageSummary;
}) {
  let validationErrors: Array<{path:string;message:string}> = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await (input.completion ?? generateNaturalLanguageSummary)({
      apiKey: input.apiKey,
      model: input.model,
      systemPrompt: input.systemPrompt,
      userPrompt: attempt === 0 ? input.userPrompt : JSON.stringify({originalRequest:input.userPrompt,
        repair:{instruction:'The previous response failed schema validation. Return the complete corrected JSON. Do not invent evidence to satisfy the schema.',errors:validationErrors}}),
      jsonMode: true,
      audit: {
        clientId: input.clientId,
        eventId: input.eventId,
        operation: input.operation ?? "semantic_enrichment",
        promptVersion: SEMANTIC_PROMPT_VERSION,
        attempt: attempt + 1,
      },
      redaction: input.policy,
      privacy: input.privacy,
    });
    if (!response) continue;
    if (input.privacy && !(await stillAuthorized(input.privacy))) return null;
    try {
      const parsed = modelSchema.safeParse(parseJson(response));
      if (parsed.success) return parsed.data;
      validationErrors=parsed.error.issues.slice(0,20).map(issue=>({path:issue.path.join('.'),message:issue.message}));
    } catch {
      validationErrors=[{path:'$',message:'Return one complete valid JSON object.'}];
      // A second bounded attempt is safer than materializing partial model output.
    }
  }
  return null;
}

function isSemanticSubject(entity: EntityDraft) {
  return SEMANTIC_SUBJECT_TYPES.has(entity.type);
}

export function hasMeaningfulAiIdentity(subject: EntityDraft, identity: z.infer<typeof pathSchema>["identity"]) {
  const name = identity.canonicalName.trim();
  const normalizedName = normalizeEntityValue(name);
  if (!/[\p{L}\p{N}]/u.test(name) || /(?:\.\.\.|\u2026)$/.test(name)) return false;
  if (/^(?:aviso|alerta|notification|notificaci(?:o|\u00f3)n|realizada|movimiento|message|mensaje)$/iu.test(name)) return false;
  if (["activity_instance", "financial_event", "email_message"].includes(subject.type)
    && normalizedName === normalizeEntityValue(subject.value)
    && subject.identitySource !== "ai") return false;
  return identity.description.trim().length >= 20 && identity.confidence >= PRIMARY_ROOT_CONFIDENCE;
}

function applyModelIdentity(subject: EntityDraft, identity: z.infer<typeof pathSchema>["identity"], model: string): EntityDraft {
  const isEventInstance = ["activity_instance", "financial_event", "email_message"].includes(subject.type);
  return {
    ...subject,
    value: identity.canonicalName.trim(),
    // Event nodes need meaningful AI labels but must retain their immutable
    // event-scoped identity. Two OpenAI payments are two pieces of evidence,
    // not one entity merely because their generated labels match.
    normalizedValue: isEventInstance ? subject.normalizedValue : normalizeEntityValue(identity.canonicalName),
    description: identity.description.trim(),
    identitySource: "ai",
    metadata: {
      ...(subject.metadata ?? {}),
      aiIdentity: true,
      identityModel: model,
      identityConfidence: identity.confidence,
      evidenceValue: subject.value,
      evidenceNormalizedValue: subject.normalizedValue,
    },
  };
}

function refineTypedExistingPath(path: z.infer<typeof pathSchema>, subject: EntityDraft) {
  const leaf = path.hierarchyPath[path.hierarchyPath.length - 1];
  if (normalizeEntityValue(path.domain) !== "communication" || normalizeEntityValue(leaf ?? "") !== "email") return path;
  const typedLeaf = subject.type === "recipient" ? "Email accounts" : subject.type === "sender" ? "Email contacts" : null;
  if (!typedLeaf) return path;
  return {
    ...path,
    hierarchyPath: [...path.hierarchyPath, typedLeaf],
    rationale: `${path.rationale} The supplied ${subject.type} role refines this existing branch to ${typedLeaf}.`,
  };
}

function parseJson(content: string) {
  const text = content.trim().replace(/^```json\s*|\s*```$/gim, "");
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}

async function loadCanonicalContext(clientId: string | null, query: string) {
  const retrieved = await retrieveSemanticContext(query, clientId, 20, pool);
  const staticHierarchy = ONTOLOGY_PARENT_RELATIONS.map(([child, parent]) => ({ child, parent }));
  return { entities: retrieved.entities, hierarchy: [...staticHierarchy, ...retrieved.hierarchy] };
}

type SemanticContext = Awaited<ReturnType<typeof loadCanonicalContext>>;

function structuralPathEvidence(evidence: EvidenceItem[]): EvidenceReference[] {
  return evidence
    .filter((item) => ["event.title", "event.body", "event.source", "deterministic.classification"].includes(item.ref) && item.text.trim())
    .map((item) => ({ ref: item.ref, excerpt: item.text.trim().slice(0, 180) }));
}

function semanticEventId(input: { auditEventId?: string | null; entities: EntityDraft[] }) {
  if (input.auditEventId) return input.auditEventId;
  const fromEntity = input.entities.find((entity) => typeof entity.metadata?.eventId === "string")?.metadata?.eventId;
  return typeof fromEntity === "string" ? fromEntity : null;
}

/**
 * The exact bytes the decision may cite. Model-visible context is derived only
 * from authorized event fields, supplied entity evidence and canonical context.
 * References are stable keys the model must copy; they are never instructions.
 */
function buildSemanticEvidence(input: {
  source: string;
  inferredKind: string;
  title?: string;
  body?: string;
  entities: EntityDraft[];
  auditEventId?: string | null;
}, context: SemanticContext): EvidenceItem[] {
  const eventId = semanticEventId(input);
  const occurredAt = typeof input.entities[0]?.metadata?.eventTimestamp === "string"
    ? String(input.entities[0].metadata.eventTimestamp)
    : null;
  const items: EvidenceItem[] = [];
  const add = (item: EvidenceItem) => {
    if (!items.some((existing) => existing.ref === item.ref)) items.push(item);
  };
  add({ ref: "event.title", kind: "event_title", label: "Título de la notificación", text: input.title ?? "", eventId, source: input.source, occurredAt, field: "title" });
  add({ ref: "event.body", kind: "event_body", label: "Texto de la notificación", text: input.body ?? "", eventId, source: input.source, occurredAt, field: "body" });
  add({ ref: "event.source", kind: "event_source", label: "Aplicación o fuente", text: input.source, eventId, source: input.source, occurredAt, field: "source" });
  add({ ref: "event.kind", kind: "event_kind", label: "Tipo capturado", text: input.inferredKind, eventId, source: input.source, occurredAt, field: "kind" });
  add({ ref: "deterministic.classification", kind: "deterministic", label: "Clasificación determinista", text: input.inferredKind, eventId, source: input.source, occurredAt, field: "inferredKind" });
  for (const entity of input.entities) {
    const type = entity.type || "entity";
    add({
      ref: `entity:${type}:${entity.normalizedValue}`,
      kind: "entity",
      label: `${type} ${entity.value}`,
      text: [entity.value, entity.description].filter(Boolean).join(" — "),
      eventId,
      source: input.source,
      occurredAt,
      field: type,
    });
  }
  for (const entity of context.entities) {
    add({
      ref: `context:${entity.type}:${entity.normalizedValue}`,
      kind: "canonical_context",
      label: `${entity.type} ${entity.value}`,
      text: [entity.value, entity.description, ...(entity.aliases ?? []), ...(entity.taxonomyKeys ?? [])].filter(Boolean).join(" — "),
    });
  }
  add({
    ref: "aggregate:canonical-context-count",
    kind: "aggregate",
    label: "Conceptos canónicos recuperados",
    text: String(context.entities.length),
  });
  return items.filter((item) => item.text.trim().length > 0);
}

function pathActionKind(path: z.infer<typeof pathSchema>, subject: EntityDraft) {
  return semanticActionKind({
    decisionKind: path.action,
    subjectType: subject.type,
    targetType: path.action === "create" ? "concept" : (path.hierarchyPath.length === 1 ? "domain" : "concept"),
  });
}

function validateModelPathEvidence(input: {
  path: z.infer<typeof pathSchema>;
  subject: EntityDraft;
  evidence: EvidenceItem[];
  context: SemanticContext;
  source: string;
  title?: string;
  body?: string;
  entities: EntityDraft[];
}) {
  const evidenceCheck = validateEvidenceReferences({
    references: input.path.evidence,
    evidence: input.evidence,
    requireEventEvidence: true,
  });
  const errors = [...evidenceCheck.errors];
  const leaf = input.path.hierarchyPath[input.path.hierarchyPath.length - 1] ?? "";
  const proposed = input.path.action === "create" ? input.path.proposedChild?.value ?? leaf : leaf;
  const actionKind = pathActionKind(input.path, input.subject);
  const tautology = tautologyCheck({
    subjectLabel: input.subject.value,
    subjectType: input.subject.type,
    targetLabel: proposed,
    targetType: input.path.action === "create" ? "concept" : undefined,
    actionKind,
  });
  errors.push(...tautology.errors);
  if (["activity_instance", "financial_event", "email_message"].includes(input.subject.type)) {
    const redundant = isRedundantProviderOrHeadingConcept({
      proposedValue: proposed,
      source: input.source,
      eventTitle: input.title,
      subjectValue: input.subject.value,
      supportedNames: input.context.entities.map((entity) => entity.value),
    });
    if (redundant) errors.push("concept_restates_provider_or_notification_heading");
  }
  // A declined or rejected card attempt is not a completed purchase. It must
  // never be placed under spending/card purchases merely because it mentions a
  // card and an amount.
  const spendingPath = (input.path.categoryKey ?? "").startsWith("finances.spending")
    || input.path.hierarchyPath.some((node) => /(?:spending|card purchases)/iu.test(node));
  if (spendingPath && isRejectedFinancialText({ source: input.source, title: input.title, body: input.body, entityValues: input.entities.map((entity) => `${entity.type} ${entity.value}`) })) {
    errors.push("rejected_transaction_cannot_be_a_purchase");
  }
  const messageText = normalizeEntityValue([input.title, input.body, ...input.entities.map((entity) => entity.value)].join(" "));
  if (spendingPath
    && /(?:^|\b)(?:mensaje|message)(?:\b|$)/u.test(messageText)
    && !/(?:pagó|pagaste|gastaste|realizado|realizada|pago realizado)/u.test(messageText)) {
    errors.push("message_about_a_purchase_is_not_a_purchase");
  }
  if (isLowUtilityPromotion({ source: input.source, title: input.title, body: input.body })) {
    errors.push("promotional_notification_is_not_an_activity");
  }
  return { ok: errors.length === 0, errors, actionKind };
}

function validateAssociationEvidence(input: {
  association: z.infer<typeof modelSchema>["associations"][number];
  evidence: EvidenceItem[];
}) {
  const check = validateEvidenceReferences({ references: input.association.evidence, evidence: input.evidence, requireEventEvidence: true });
  const errors = [...check.errors];
  if (normalizeEntityValue(input.association.sourceNormalizedValue) === normalizeEntityValue(input.association.targetNormalizedValue)) {
    errors.push("association_self_link");
  }
  if (!isSupportedAssociationRationale(input.association.rationale)) {
    errors.push("association_supported_only_by_shared_channel");
  }
  return { ok: errors.length === 0, errors };
}

async function verifySemanticPaths(input: {
  actionKind: ReturnType<typeof semanticActionKind>;
  paths: SemanticPathDecision[];
  associations: SemanticAssociationDecision[];
  evidence: EvidenceItem[];
  context: SemanticContext;
  clientId: string | null;
  eventId: string | null;
  model: string;
  privacy: PrivacyAuthorization;
  operation?: string;
  generatorPromptVersion?: string;
}) {
  const references = [
    ...input.paths.flatMap((path) => path.evidence ?? []),
    ...input.associations.flatMap((association) => association.evidence ?? []),
  ];
  return verifyDecision({
    actionKind: input.actionKind,
    operation: input.operation ?? "semantic_enrichment",
    clientId: input.clientId,
    eventId: input.eventId,
    generatorModel: input.model,
    generatorPromptVersion: input.generatorPromptVersion ?? SEMANTIC_PROMPT_VERSION,
    evidence: input.evidence,
    evidenceReferences: references,
    canonicalContext: {
      entities: input.context.entities.map((entity) => ({
        type: entity.type, value: entity.value, normalizedValue: entity.normalizedValue,
        description: entity.description, aliases: entity.aliases, taxonomyKeys: entity.taxonomyKeys, roles: entity.roles,
      })),
      hierarchy: input.context.hierarchy,
    },
    proposal: {
      paths: input.paths.map((path) => ({
        subjectNormalizedValue: path.subject.normalizedValue,
        subjectType: path.subject.type,
        role: path.role,
        domain: path.domain,
        action: path.action,
        hierarchyPath: path.hierarchyPath,
        proposedChild: path.proposedChild,
        mergeTargetNormalizedValue: path.mergeTargetNormalizedValue,
        evidence: path.evidence,
      })),
      associations: input.associations.map((association) => ({
        sourceNormalizedValue: association.sourceNormalizedValue,
        targetNormalizedValue: association.targetNormalizedValue,
        relationType: association.relationType,
        evidence: association.evidence,
      })),
    },
    deterministic: { ok: true, errors: [] },
    privacy: input.privacy,
  });
}

function filterVerifiedPaths(
  paths: SemanticPathDecision[],
  associations: SemanticAssociationDecision[],
  verification: DecisionVerification,
  enforced: boolean,
) {
  if (!enforced) return { paths, associations };
  const pathVerdicts = new Map(verification.pathVerdicts.map((verdict) => [verdict.index, verdict]));
  const associationVerdicts = new Map(verification.associationVerdicts.map((verdict) => [verdict.index, verdict]));
  const verifiedPaths = paths.filter((path, index) => pathVerdicts.get(index)?.accept === true);
  const verifiedAssociations = associations.filter((association, index) => associationVerdicts.get(index)?.accept === true);
  return { paths: verifiedPaths, associations: verifiedAssociations };
}

function validatePath(path: z.infer<typeof pathSchema>, context: Awaited<ReturnType<typeof loadCanonicalContext>>, subject?: EntityDraft) {
  if (!LIFE_DOMAINS.includes(path.domain as typeof LIFE_DOMAINS[number])) return false;
  if (normalizeEntityValue(path.hierarchyPath[0] ?? "") !== normalizeEntityValue(path.domain)) return false;
  const knownNames = new Set([...LIFE_DOMAINS, ...context.entities.map((entity) => entity.value), ...Object.keys(ONTOLOGY_TREE)].map(normalizeEntityValue));
  const parents = new Set(context.hierarchy.map(({ child, parent }) => `${normalizeEntityValue(child)}|${normalizeEntityValue(parent)}`));
  for (let index = 1; index < path.hierarchyPath.length; index += 1) {
    const child = path.hierarchyPath[index]!;
    const parent = path.hierarchyPath[index - 1]!;
    if (!parents.has(`${normalizeEntityValue(child)}|${normalizeEntityValue(parent)}`)) return false;
  }
  const leaf = path.hierarchyPath[path.hierarchyPath.length - 1]!;
  if (path.action === "reuse" && !knownNames.has(normalizeEntityValue(leaf))) return false;
  if (subject && ["financial_event", "email_message", "activity_instance"].includes(subject.type) && path.action === "reuse") {
    const reusableMeaning = context.entities.find((entity) => entity.normalizedValue === normalizeEntityValue(leaf));
    if (reusableMeaning?.type !== "concept" && categoryByLabel(leaf)?.kind === "domain") return false;
    if (!reusableMeaning && !categoryByLabel(leaf)) return false;
  }
  if (path.action === "merge" && (!path.mergeTargetNormalizedValue || !knownNames.has(normalizeEntityValue(path.mergeTargetNormalizedValue)))) return false;
  if (path.action === "create") {
    if (!path.proposedChild?.durable) return false;
    if (normalizeEntityValue(path.proposedChild.parent) !== normalizeEntityValue(leaf)) return false;
  }
  return true;
}

function structuralDecision(input: { entities: EntityDraft[]; inferredKind: string; source?: string; title?: string; body?: string; model: string; failureReason?: SemanticDecision["failureReason"]; status?: SemanticDecision["status"] }): SemanticDecision {
  const subjects = input.entities.filter(isSemanticSubject);
  const rejectedFinancialNotice = isRejectedFinancialText({
    source: input.source ?? "",
    title: input.title,
    body: input.body,
    entityValues: input.entities.map((entity) => `${entity.type} ${entity.value}`),
  });
  const financial = !rejectedFinancialNotice
    && (input.inferredKind === "expense" || input.inferredKind === "income" || input.inferredKind === "transfer");
  const email = input.inferredKind === "email" || /(?:gmail|outlook|email|imap)/iu.test(input.source ?? "");
  const activityEvidence = normalizeEntityValue(`${input.source ?? ""} ${input.title ?? ""} ${input.body ?? ""} ${input.entities.map((entity) => entity.value).join(" ")}`);
  const homeDeviceAlert = /(?:xiaomi home|home assistant|smartthings|google home|alexa)/u.test(activityEvidence)
    || (/(?:motion|movement|movimiento|movimientos|sensor|detected|detectado|detecci[oó]n|device alert|alerta|offline|desconectad|door|window|puerta|ventana|bater[ií]a|battery|agua|water|vacuum|robot)/u.test(activityEvidence)
      && /(?:home|hogar|casa|device|dispositivo)/u.test(activityEvidence));
  const musicPlayback = /(?:spotify|apple music|youtube music|tidal|deezer|now playing)/u.test(activityEvidence);
  const socialInteraction = /(?:instagram|tiktok|twitter|facebook|linkedin)/u.test(activityEvidence);
  const paths: SemanticPathDecision[] = [];
  if (financial) {
    const categoryKey = input.inferredKind === "income" ? "finances.income"
      : input.inferredKind === "transfer" ? "finances.transfers"
        : "finances.spending.card_purchase";
    const hierarchyPath = categoryPath(categoryKey).map((node) => node.label);
    const financialSubjects = subjects.filter((candidate) => candidate.type === "financial_event");
    financialSubjects.forEach((subject, index) => paths.push({ subject, role: "primary", domain: "Finances", action: "reuse", hierarchyPath, steps: [], confidence: 0.9, rationale: `A classified ${input.inferredKind} belongs to ${hierarchyPath[hierarchyPath.length - 1]}.`, eventAnchor: index === 0, categoryKey }));
  }
  if (email) {
    const emailSubjects = subjects.filter((candidate) => candidate.type === "email_message");
    const emailRole = paths.some((path) => path.role === "primary") ? "secondary" as const : "primary" as const;
    const hasEmailMessage = emailSubjects.some((subject) => subject.type === "email_message");
    emailSubjects.forEach((subject, index) => {
      const categoryKey = "communication.email.activity";
      const hierarchyPath = categoryPath(categoryKey).map((node) => node.label);
      paths.push({ subject, role: emailRole, domain: "Communication", action: "reuse", hierarchyPath, steps: [], confidence: 0.9, rationale: `${subject.value} belongs to the ${hierarchyPath[hierarchyPath.length - 1]} branch.`, eventAnchor: hasEmailMessage ? subject.type === "email_message" : index === 0, categoryKey });
    });
  }
  const activityCategoryKey = homeDeviceAlert
    ? "home.automation.device_alert"
    : musicPlayback
      ? "entertainment.music"
      : socialInteraction
        ? "social.interactions"
        : null;
  if (activityCategoryKey) {
    const hierarchyPath = categoryPath(activityCategoryKey).map((node) => node.label);
    const activitySubjects = subjects.filter((candidate) => candidate.type === "activity_instance");
    const role = paths.some((path) => path.role === "primary") ? "secondary" as const : "primary" as const;
    activitySubjects.forEach((subject, index) => paths.push({
      subject,
      role,
      domain: hierarchyPath[0]!,
      action: "reuse",
      hierarchyPath,
      steps: [],
      confidence: 0.95,
      rationale: `Trusted provider and event signals map this activity to ${hierarchyPath[hierarchyPath.length - 1]}.`,
      eventAnchor: index === 0,
      categoryKey: activityCategoryKey,
    }));
  }
  const rootAlternatives = [...new Map(paths.map((path) => [path.domain, { value: path.domain, confidence: path.confidence }])).values()];
  const categorization = decisionCategorization(paths);
  return {
    paths,
    associations: [],
    rootAlternatives,
    governanceVersion: SEMANTIC_GOVERNANCE_VERSION,
    promptVersion: SEMANTIC_PROMPT_VERSION,
    model: input.model,
    status: input.status ?? (input.failureReason ? "retryable" : "model_unavailable"),
    source: "structural",
    failureReason: input.failureReason,
    taxonomyVersion: TAXONOMY_VERSION,
    ...categorization,
    facets: deterministicFacets(input.entities, input.source ?? "", input.inferredKind),
    policyVersion: DECISION_POLICY_VERSION,
    evidence: [],
    evidenceFingerprint: null,
    verification: null,
    verificationStatus: "not_required",
    abstained: paths.length === 0,
    abstentionReason: paths.length === 0 ? "No hay una categoría determinista aplicable para este evento." : null,
    rejectedProposals: [],
  };
}

export function isUninformativeEvent(input: { source: string; title?: string | null; body?: string | null }) {
  const source = normalizeEntityValue(input.source);
  const cleaned = normalizeEntityValue(
    `${input.title ?? ""} ${input.body ?? ""}`
      .replaceAll(input.source, " ")
      .replace(/(?:notificaci[oó]n|notification|aviso|alerta|alert|mensaje|message|push)/giu, " "),
  );
  if (!cleaned) return true;
  if (cleaned.length < 6) return true;
  if (cleaned === source) return true;
  return false;
}

export function buildDeterministicSemanticDecision(input: {  entities: EntityDraft[];
  source: string;
  inferredKind: string;
  title?: string;
  body?: string;
  status?: SemanticDecision["status"];
}) {
  return structuralDecision({
    entities: input.entities,
    inferredKind: input.inferredKind,
    source: input.source,
    title: input.title,
    body: input.body,
    model: "structural",
    status: input.status,
  });
}

export async function buildModelSemanticDecision(input: { entities: EntityDraft[]; source: string; inferredKind: string; title?: string; body?: string; clientId: string | null; independentSubjectAudit?: boolean; allowModel?: boolean; auditEventId?: string | null; humanContext?: { eventCategory?: string; explanation?: string } }): Promise<SemanticDecision> {
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
  if (input.allowModel === false) return structuralDecision({ entities: input.entities, inferredKind: input.inferredKind, source: input.source, title: input.title, body: input.body, model, failureReason: "privacy_policy", status: "review" });
  if (!process.env.DEEPSEEK_API_KEY) return structuralDecision({ entities: input.entities, inferredKind: input.inferredKind, source: input.source, title: input.title, body: input.body, model, failureReason: "missing_api_key" });
  try {
    const policy = await loadSourceProcessingPolicy(pool, { clientId: input.clientId, source: input.source });
    if (!policy.enabled) {
      return structuralDecision({ entities: input.entities, inferredKind: input.inferredKind, source: input.source, title: input.title, body: input.body, model, failureReason: "privacy_policy", status: "discarded" });
    }
    if (!policy.sendToLlm) {
      return structuralDecision({ entities: input.entities, inferredKind: input.inferredKind, source: input.source, title: input.title, body: input.body, model, failureReason: "privacy_policy", status: "review" });
    }
    const authorization = await authorizeModelDispatch(pool, {
      ownerId: input.clientId,
      purpose: "semantic_enrichment",
      sources: [input.source],
      eventIds: input.auditEventId ? [input.auditEventId] : [],
    });
    if (!authorization.allowed) {
      return structuralDecision({ entities: input.entities, inferredKind: input.inferredKind, source: input.source, title: input.title, body: input.body, model, failureReason: "privacy_policy", status: "review" });
    }
    const retrievalQuery = [input.source, input.inferredKind, input.title, input.body,
      ...input.entities.filter(isSemanticSubject).map((entity) => `${entity.type} ${entity.value}`)]
      .filter(Boolean).join(" ").slice(0, 4000);
    const loadedContext = await loadCanonicalContext(input.clientId, retrievalQuery);
    const auditedSubjects = new Set(input.entities.map((entity) => entity.normalizedValue));
    const canonicalContext = input.independentSubjectAudit
      ? { ...loadedContext, hierarchy: loadedContext.hierarchy.filter((edge) => !auditedSubjects.has(normalizeEntityValue(edge.child))) }
      : loadedContext;
    const evidenceIndex = buildSemanticEvidence({ ...input, auditEventId: input.auditEventId }, loadedContext);
    const parsed = await requestSemanticJson({
      apiKey: process.env.DEEPSEEK_API_KEY,
      model,
      clientId: input.clientId,
      eventId: input.auditEventId === undefined
        ? String(input.entities.find((entity) => typeof entity.metadata?.eventId === "string")?.metadata?.eventId ?? "") || null
        : input.auditEventId,
      policy,
      privacy: authorization,
      systemPrompt: `Return strict JSON only. Governance ${SEMANTIC_GOVERNANCE_VERSION}. You govern durable personal knowledge, not keywords.

Roots: ${LIFE_DOMAINS.join(", ")}.
Seed tree: ${ontologyTreePrompt()}.
Stable category catalog: ${categoryCatalogPrompt()}.

For each event choose one primary root only when confidence >= ${PRIMARY_ROOT_CONFIDENCE} and it leads the runner-up by >= ${PRIMARY_ROOT_MARGIN}. Then classify every supplied event instance independently, descending through immediate existing children and recording one step per level. Every supplied event instance (financial_event, email_message, or activity_instance) must receive a meaningful identity and a path unless the evidence truly cannot identify what happened. Several subjects may have paths in the same domain; that does not create extra event anchors. Evaluate other roots independently and use no_relation for incidental matches. A path contains the root through the immediate parent of its supplied subject. Never include the subject itself in hierarchyPath and never skip an existing intermediate parent. Merchants, apps, senders, recipients and accounts are identity facets or relationship endpoints, never hierarchy subjects and never personal concepts merely because an event mentions them.

Actions: reuse an existing parent; create only a reusable independently meaningful child; merge only for the same identity; discard raw fragments; no_relation for an unrelated domain. For every event instance, compare its meaning with every existing concept in canonicalContext before proposing a child. If an existing concept has the same meaning, descend to and reuse it even when wording differs. Only create a child when no existing concept represents that meaning. Event instances and activity instances are evidence, never reusable merge targets; if only equivalent occurrences exist but no concept exists yet, create the reusable concept. The proposed child must name the reusable event class (for example Home motion detection), never a dated occurrence or a paraphrase of the event title. Repeated occurrences remain evidence instances below that one concept. Never create amounts, timestamps, IDs, package names, notification titles, truncated strings, or one-off text. There may be at most one path per subject per domain and exactly one primary event anchor. Multiple supplied subjects may share a domain and immediate parent. Secondary paths need strong independent evidence.

Associations are separate from hierarchy. Use only: ${[...STANDARD_ASSOCIATION_TYPES].join(", ")}. Endpoints must be supplied canonical subjects/context. Do not infer an association only because two items share an app, platform, source or channel.

Evidence discipline is mandatory. Every path and association must include evidence: a non-empty array of {"ref","excerpt"}. Copy ref values only from the supplied evidenceRefs list. excerpt must be a literal substring of that reference. Never invent a ref or a fact. If the evidence is insufficient for a useful, non-tautological decision, return paths: [] and set abstentionReason in Spanish instead of guessing. A provider's presence never proves an order, purchase, delivery or other activity. Never propose a concept that merely restates the notification heading, the provider/app name, or a generic transport word (for example "PedidosYa notification" or "Promoción de PedidosYa"). Prefer reusing an equivalent existing concept over creating a new one.

Every path must also define the durable identity of its subject. canonicalName must be a concise, independently meaningful graph label chosen from the evidence; never copy an event title, sentence, amount, timestamp, card suffix, action word, or truncated fragment. Preserve factual proper nouns for known people, merchants, apps, and accounts while normalizing casing and noise. description must explain what the entity represents in the user's knowledge graph without inventing facts. If a safe meaningful identity cannot be produced, use discard and do not propose a node.

For paths ending at a catalog category, return its stable categoryKey. Return one primaryCategoryKey for the captured event, independently useful secondaryCategoryKeys only, and facets for merchant, account, channel, sender, recipient, location, recurrence, payment_method, or status. Facets never alter hierarchy.

Return {"rootAlternatives":[{"value","confidence"}],"primaryCategoryKey":"stable.key|null","secondaryCategoryKeys":[],"abstentionReason":null,"facets":[{"type","value","confidence"}],"paths":[{"subjectNormalizedValue","identity":{"canonicalName","description","confidence"},"role":"primary|secondary","domain","action":"reuse|create|merge|discard|no_relation","hierarchyPath":["Root","Immediate child"],"categoryKey":"stable.key|null","evidence":[{"ref":"event.title","excerpt":"literal fragment"}],"steps":[{"parent","decision":"descend_existing|stop|propose_child|merge|discard|no_relation","selectedChild":null,"confidence", "alternatives":[]}],"confidence","rationale","proposedChild":{"value","description","parent","durable","confidence"}|null,"mergeTargetNormalizedValue":null}],"associations":[{"sourceNormalizedValue","targetNormalizedValue","relationType","confidence","rationale","evidence":[{"ref","excerpt"}]}]}.`,
      userPrompt: JSON.stringify({ source: input.source, inferredKind: input.inferredKind, title: input.title ?? null, body: input.body ?? null, humanContext: input.humanContext ?? null, subjects: input.entities.filter(isSemanticSubject).map((entity) => ({ type: entity.type, value: entity.value, normalizedValue: entity.normalizedValue })), evidenceRefs: evidenceIndex.map((item) => ({ ref: item.ref, kind: item.kind, label: item.label })), canonicalContext }),
    });
    if (!parsed) return structuralDecision({ entities: input.entities, inferredKind: input.inferredKind, source: input.source, title: input.title, body: input.body, model, failureReason: "invalid_response" });
    if (!(await stillAuthorized(authorization))) {
      return structuralDecision({ entities: input.entities, inferredKind: input.inferredKind, source: input.source, title: input.title, body: input.body, model, failureReason: "privacy_policy", status: "review" });
    }
    const subjectByValue = new Map(input.entities.filter(isSemanticSubject).map((entity) => [entity.normalizedValue, entity]));
    const roots = parsed.rootAlternatives.filter((root) => LIFE_DOMAINS.includes(root.value as typeof LIFE_DOMAINS[number])).sort((left, right) => right.confidence - left.confidence);
    const primaryAllowed = (roots[0]?.confidence ?? 0) >= PRIMARY_ROOT_CONFIDENCE && ((roots[0]?.confidence ?? 0) - (roots[1]?.confidence ?? 0) >= PRIMARY_ROOT_MARGIN || roots.length === 1);
    const suppliedEvent = input.entities.find((entity) => ["financial_event", "email_message", "activity_instance"].includes(entity.type));
    const rawPaths = [...parsed.paths];
    const rejectedProposals: NonNullable<SemanticDecision["rejectedProposals"]> = [];
    const actionKindFor = (path: z.infer<typeof pathSchema>, subject: EntityDraft) => pathActionKind(path, subject);
    const toPath = (rawPath: z.infer<typeof pathSchema>, subject: EntityDraft): SemanticPathDecision | null => {
      let path = refineTypedExistingPath(rawPath, subject);
      if (!hasMeaningfulAiIdentity(subject, path.identity)) {
        rejectedProposals.push({ kind: "identity", label: path.identity.canonicalName, reason: "identity_not_meaningful" });
        return null;
      }
      // The model identified a meaningful event class but selected an app,
      // merchant, or account as though it were that class. Preserve the
      // model's identity judgment while materializing the required concept
      // between the durable parent and the individual evidence occurrence.
      if (suppliedEvent && path.subjectNormalizedValue === suppliedEvent.normalizedValue && path.action === "reuse") {
        const leaf = path.hierarchyPath[path.hierarchyPath.length - 1];
        const leafEntity = canonicalContext.entities.find((entity) => entity.normalizedValue === normalizeEntityValue(leaf ?? ""));
        if (leafEntity && leafEntity.type !== "concept" && leaf) {
          path = {
            ...path,
            action: "create" as const,
            proposedChild: {
              value: path.identity.canonicalName,
              description: path.identity.description,
              parent: leaf,
              durable: true,
              confidence: path.identity.confidence,
            },
            mergeTargetNormalizedValue: null,
            rationale: `${path.rationale} The selected ${leafEntity.type} is a durable container, so the model-generated event meaning is materialized as its reusable child concept.`,
          };
        }
      }
      const subjectKey = `${path.subjectNormalizedValue}|${normalizeEntityValue(path.domain)}`;
      if (seenSubjects.has(subjectKey) || !validatePath(path, canonicalContext, subject)) {
        rejectedProposals.push({ kind: "path", label: path.hierarchyPath.at(-1) ?? path.domain, reason: "invalid_path" });
        return null;
      }
      if (path.action === "discard" || path.action === "no_relation") return null;
      if (path.role === "primary" && (!primaryAllowed || normalizeEntityValue(path.domain) !== normalizeEntityValue(roots[0]?.value ?? ""))) {
        rejectedProposals.push({ kind: "path", label: path.hierarchyPath.at(-1) ?? path.domain, reason: "primary_root_not_supported" });
        return null;
      }
      if (path.role === "secondary" && path.confidence < PRIMARY_ROOT_CONFIDENCE) {
        rejectedProposals.push({ kind: "path", label: path.hierarchyPath.at(-1) ?? path.domain, reason: "secondary_evidence_too_weak" });
        return null;
      }
      const evidenceCheck = validateModelPathEvidence({ path, subject, evidence: evidenceIndex, context: loadedContext, source: input.source, title: input.title, body: input.body, entities: input.entities });
      if (!evidenceCheck.ok) {
        rejectedProposals.push({ kind: "path", label: path.action === "create" ? path.proposedChild?.value ?? path.hierarchyPath.at(-1) ?? path.domain : path.hierarchyPath.at(-1) ?? path.domain, reason: evidenceCheck.errors.join(",") });
        return null;
      }
      seenSubjects.add(subjectKey);
      const governedSubject = applyModelIdentity(subject, path.identity, model);
      const derivedCategoryKey = categoryKeyForPath(path.hierarchyPath);
      if (path.categoryKey && (!categoryByKey(path.categoryKey) || path.categoryKey !== derivedCategoryKey)) {
        rejectedProposals.push({ kind: "category", label: path.categoryKey, reason: "category_key_mismatch" });
        return null;
      }
      return {
        subject: governedSubject,
        identity: path.identity,
        role: path.role,
        domain: path.domain,
        action: path.action,
        hierarchyPath: path.hierarchyPath,
        steps: path.steps,
        confidence: path.confidence,
        rationale: path.rationale,
        evidence: path.evidence,
        proposedChild: path.proposedChild,
        mergeTargetNormalizedValue: path.mergeTargetNormalizedValue,
        categoryKey: derivedCategoryKey,
      };
    };
    const seenSubjects = new Set<string>();
    let primarySeen = false;
    let paths = rawPaths.flatMap((rawPath): SemanticPathDecision[] => {
      const subject = subjectByValue.get(rawPath.subjectNormalizedValue);
      if (!subject) {
        rejectedProposals.push({ kind: "path", label: rawPath.subjectNormalizedValue, reason: "unknown_subject" });
        return [];
      }
      const path = toPath(rawPath, subject);
      if (!path) return [];
      if (path.role === "primary") primarySeen = true;
      return [path];
    });
    let hasEventPath = paths.some((path) => ["financial_event", "email_message", "activity_instance"].includes(path.subject.type));
    let focusedVerification: DecisionVerification | null = null;
    let focusedPathsAccepted: SemanticPathDecision[] = [];
    if (suppliedEvent && !hasEventPath) {
      const focused = await requestSemanticJson({
        apiKey: process.env.DEEPSEEK_API_KEY,
        model,
        clientId: input.clientId,
        eventId: input.auditEventId === undefined
          ? (typeof suppliedEvent.metadata?.eventId === "string" ? suppliedEvent.metadata.eventId : null)
          : input.auditEventId,
        policy,
        privacy: authorization,
        operation: "semantic_event_identity",
        systemPrompt: `Return strict JSON only. Governance ${SEMANTIC_GOVERNANCE_VERSION}. Classify exactly one captured event as reusable knowledge evidence.

First compare the event meaning against every existing concept in canonicalContext. If the meaning already exists, action must be reuse and hierarchyPath must end at that concept. If it does not exist, action must be create with one durable reusable concept such as "Home motion detection"; the captured occurrence itself must never become that concept. Use merge only when an existing concept is semantically identical but has a noisy duplicate identity. The event remains a distinct evidence instance in every case.

Descend one immediate parent at a time from one of these roots: ${LIFE_DOMAINS.join(", ")}. Never skip an existing parent. canonicalName and description must explain this particular occurrence, while proposedChild describes the reusable class shared by equivalent occurrences.

Every path must include evidence: a non-empty array of {"ref","excerpt"} copied only from the supplied evidenceRefs. Never propose a concept that restates the provider, notification heading or a generic transport word. If the evidence is insufficient, return paths: [] and an abstentionReason in Spanish.

Return {"rootAlternatives":[{"value","confidence"}],"abstentionReason":null,"paths":[{"subjectNormalizedValue","identity":{"canonicalName","description","confidence"},"role":"secondary","domain","action":"reuse|create|merge|discard|no_relation","hierarchyPath":["Root","Immediate child"],"evidence":[{"ref","excerpt"}],"steps":[{"parent","decision":"descend_existing|stop|propose_child|merge|discard|no_relation","selectedChild":null,"confidence","alternatives":[]}],"confidence","rationale","proposedChild":{"value","description","parent","durable":true,"confidence"}|null,"mergeTargetNormalizedValue":null}],"associations":[]}.`,
        userPrompt: JSON.stringify({
          source: input.source,
          inferredKind: input.inferredKind,
          title: input.title ?? null,
          body: input.body ?? null,
          event: { type: suppliedEvent.type, value: suppliedEvent.value, normalizedValue: suppliedEvent.normalizedValue, description: suppliedEvent.description ?? null },
          evidenceRefs: evidenceIndex.map((item) => ({ ref: item.ref, kind: item.kind, label: item.label })),
          canonicalContext,
        }),
      });
      const focusedPaths = (focused?.paths ?? [])
        .filter((path) => path.subjectNormalizedValue === suppliedEvent.normalizedValue)
        .flatMap((path): SemanticPathDecision[] => {
          const pathDecision = toPath(path, suppliedEvent);
          return pathDecision ? [pathDecision] : [];
        });
      if (focusedPaths.length) {
        const outcome = await verifySemanticPaths({
          actionKind: focusedPaths[0]?.action === "create" ? "create_category" : "assign_existing_category",
          paths: focusedPaths,
          associations: [],
          evidence: evidenceIndex,
          context: loadedContext,
          clientId: input.clientId,
          eventId: semanticEventId({ ...input, auditEventId: input.auditEventId }),
          model,
          privacy: authorization,
          operation: "semantic_event_identity",
        });
        focusedVerification = outcome.verification;
        const accepted = filterVerifiedPaths(focusedPaths, [], outcome.verification, decisionPolicyMode() === "enforce");
        focusedPathsAccepted = accepted.paths;
        paths.push(...accepted.paths);
        hasEventPath = paths.some((path) => ["financial_event", "email_message", "activity_instance"].includes(path.subject.type));
        if (!accepted.paths.length) rejectedProposals.push({ kind: "verification", label: focusedPaths[0]?.hierarchyPath.at(-1) ?? "event", reason: outcome.verification.reason });
      }
    }
    // A deterministic catalog baseline is itself evidence for known categories.
    // It remains valid even when a model result is unavailable or rejected.
    const structuralBaseline = structuralDecision({
      entities: input.entities,
      inferredKind: input.inferredKind,
      source: input.source,
      title: input.title,
      body: input.body,
      model,
      status: "review",
    });
    let structuralPaths: SemanticPathDecision[] = [];
    if (structuralBaseline.primaryCategoryKey) {
      structuralPaths = structuralBaseline.paths.map((path) => ({
        ...path,
        evidence: structuralPathEvidence(evidenceIndex),
      }));
      const primaryDomain = categoryPath(structuralBaseline.primaryCategoryKey)[0]?.label;
      const secondaryModelPaths = paths
        .filter((path) => path.action === "reuse"
          && Boolean(path.categoryKey)
          && normalizeEntityValue(path.domain) !== normalizeEntityValue(primaryDomain ?? ""))
        .map((path) => ({ ...path, role: "secondary" as const, eventAnchor: false }));
      paths = [...structuralPaths, ...secondaryModelPaths];
      primarySeen = paths.some((path) => path.role === "primary");
    }
    const knownSubjects = new Set(input.entities.filter(isSemanticSubject).map((entity) => entity.normalizedValue));
    const governedIdentities = new Map(paths.map((path) => [String(path.subject.metadata?.evidenceNormalizedValue ?? path.subject.normalizedValue), path.subject.normalizedValue]));
    const associations = parsed.associations.flatMap((association): SemanticAssociationDecision[] => {
      const relationType = normalizeRelationType(association.relationType).relationType;
      const check = validateAssociationEvidence({ association, evidence: evidenceIndex });
      if (!STANDARD_ASSOCIATION_TYPES.has(relationType) || !knownSubjects.has(association.sourceNormalizedValue) || !check.ok) {
        rejectedProposals.push({ kind: "association", label: `${association.sourceNormalizedValue}→${association.targetNormalizedValue}`, reason: check.errors.join(",") || "unsupported_association" });
        return [];
      }
      return [{
        sourceNormalizedValue: governedIdentities.get(association.sourceNormalizedValue) ?? association.sourceNormalizedValue,
        targetNormalizedValue: governedIdentities.get(association.targetNormalizedValue) ?? association.targetNormalizedValue,
        relationType,
        confidence: association.confidence,
        rationale: association.rationale,
        evidence: association.evidence,
      }];
    });
    // One verifier call for this generated decision. The focused event decision,
    // if any, already had its own independent call above.
    const modelPaths = paths.filter((path) => !structuralPaths.includes(path) && !focusedPathsAccepted.includes(path) && path.evidence?.length);
    let verification: DecisionVerification | null = focusedVerification;
    if (modelPaths.length || associations.length) {
      const outcome = await verifySemanticPaths({
        actionKind: semanticActionKind({ decisionKind: modelPaths[0]?.action, subjectType: modelPaths[0]?.subject.type, targetType: modelPaths[0]?.categoryKey ? "concept" : undefined }),
        paths: modelPaths,
        associations,
        evidence: evidenceIndex,
        context: loadedContext,
        clientId: input.clientId,
        eventId: semanticEventId({ ...input, auditEventId: input.auditEventId }),
        model,
        privacy: authorization,
      });
      if (!focusedVerification) {
        verification = outcome.verification;
      } else {
        const statuses = [focusedVerification.status, outcome.verification.status];
        verification = {
          ...outcome.verification,
          status: statuses.includes("rejected") ? "rejected" : statuses.includes("unavailable") ? "unavailable" : "verified",
          reason: [focusedVerification.reason, outcome.verification.reason].filter(Boolean).join(" / "),
        };
      }
      const enforced = decisionPolicyMode() === "enforce";
      const accepted = filterVerifiedPaths(modelPaths, associations, outcome.verification, enforced);
      if (enforced) {
        const acceptedPaths = new Set(accepted.paths);
        const acceptedAssociations = new Set(accepted.associations);
        paths = paths.filter((path) => !modelPaths.includes(path) || acceptedPaths.has(path));
        associations.splice(0, associations.length, ...associations.filter((association) => acceptedAssociations.has(association)));
      }
    }
    if (!paths.some((path) => ["financial_event", "email_message", "activity_instance"].includes(path.subject.type))) {
      primarySeen = false;
    }
    const anchoredDomains = new Set<string>();
    for (const path of paths) {
      if (path.eventAnchor === false) continue;
      const domainKey = normalizeEntityValue(path.domain);
      path.eventAnchor = !anchoredDomains.has(domainKey);
      if (path.eventAnchor) anchoredDomains.add(domainKey);
    }
    const coveredSubjects = new Set(paths.map((path) => String(path.subject.metadata?.evidenceNormalizedValue ?? path.subject.normalizedValue)));
    const suppliedSubjects = input.entities.filter(isSemanticSubject);
    const verificationStatus = verification?.status ?? "not_required";
    const abstained = paths.length === 0;
    const needsReview = abstained
      || !primarySeen
      || suppliedSubjects.some((subject) => !coveredSubjects.has(subject.normalizedValue))
      || paths.some((path) => path.action !== "reuse" || path.confidence < AUTO_APPLY_CONFIDENCE)
      || associations.some((association) => association.confidence < AUTO_APPLY_CONFIDENCE)
      || (verification !== null && verificationStatus !== "verified");
    const categorization = decisionCategorization(paths);
    const evidenceText = normalizeEntityValue([input.source, input.title, input.body, ...input.entities.map((entity) => entity.value)].filter(Boolean).join(" "));
    const modelFacets: SemanticFacet[] = parsed.facets.flatMap((facet) => {
      const normalizedValue = normalizeEntityValue(facet.value);
      if (facet.confidence < PRIMARY_ROOT_CONFIDENCE || !evidenceText.includes(normalizedValue)) return [];
      return [{ ...facet, normalizedValue, source: "deepseek" as const }];
    });
    const facets = [...new Map([...deterministicFacets(input.entities, input.source, input.inferredKind), ...modelFacets].map((facet) => [`${facet.type}:${facet.normalizedValue}`, facet])).values()];
    const evidenceReferences = [...paths.flatMap((path) => path.evidence ?? []), ...associations.flatMap((association) => association.evidence ?? [])];
    const status = paths.length ? (needsReview ? "review" : "resolved") : "unclassified";
    return {
      paths,
      associations,
      rootAlternatives: roots,
      governanceVersion: SEMANTIC_GOVERNANCE_VERSION,
      promptVersion: SEMANTIC_PROMPT_VERSION,
      model,
      status,
      source: "deepseek",
      taxonomyVersion: TAXONOMY_VERSION,
      ...categorization,
      facets,
      policyVersion: DECISION_POLICY_VERSION,
      evidence: evidenceIndex,
      evidenceFingerprint: evidenceReferences.length ? decisionEvidenceFingerprint(evidenceReferences) : null,
      verification,
      verificationStatus,
      abstained,
      abstentionReason: abstained ? (parsed.abstentionReason ?? "La evidencia disponible no permite una decisión útil y verificable.") : null,
      rejectedProposals,
    };
  } catch (error) {
    if (process.env.DEBUG_SEMANTIC === "true") console.warn("semantic_model_error", error instanceof Error ? error.message : String(error));
    return structuralDecision({ entities: input.entities, inferredKind: input.inferredKind, source: input.source, title: input.title, body: input.body, model, failureReason: "model_error" });
  }
}

// Compatibility adapter for operational scripts that still inspect flat proposals.
export async function buildModelSemanticProposals(input: Parameters<typeof buildModelSemanticDecision>[0]) {
  const decision = await buildModelSemanticDecision(input);
  return decision.paths.map((path) => ({ subject: path.subject, relationType: path.hierarchyPath.length === 1 ? "belongs_to_domain" : "part_of", targetType: path.hierarchyPath.length === 1 ? "domain" as const : "concept" as const, targetValue: path.hierarchyPath[path.hierarchyPath.length - 1]!, parentTargetValue: path.proposedChild?.parent, confidence: path.confidence, rationale: path.rationale, extractor: "deepseek" as const, autoApply: path.action === "reuse" && path.confidence >= AUTO_APPLY_CONFIDENCE }));
}

export function buildSemanticProposals(input: { entities: EntityDraft[]; source: string; inferredKind: string }) {
  return structuralDecision({ entities: input.entities, inferredKind: input.inferredKind, source: input.source, model: "structural" }).paths.map((path) => ({ subject: path.subject, relationType: path.hierarchyPath.length === 1 ? "belongs_to_domain" : "part_of", targetType: path.hierarchyPath.length === 1 ? "domain" as const : "concept" as const, targetValue: path.hierarchyPath[path.hierarchyPath.length - 1]!, confidence: path.confidence, rationale: path.rationale, extractor: "structural" as const, autoApply: true }));
}
