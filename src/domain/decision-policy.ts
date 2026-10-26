import { createHash } from "node:crypto";
import { normalizeEntityValue } from "./entities.js";

/**
 * Shared, versioned policy for every model decision in BrainIA.
 *
 * A generated decision is only applyable when:
 *  1. deterministic checks pass;
 *  2. every evidence reference resolves against the actual supplied input;
 *  3. an independent verifier accepts it (enforce mode);
 *  4. the current privacy authorization still permits publication.
 *
 * The generator's confidence is never evidence. The verifier never receives it.
 */
export const DECISION_POLICY_VERSION = "evidence-grounded-v1";
export const DECISION_VERIFIER_PROMPT_VERSION = "decision-verifier-v1";
export const DECISION_POLICY_MODES = ["off", "shadow", "enforce"] as const;
export type DecisionPolicyMode = typeof DECISION_POLICY_MODES[number];

export function decisionPolicyMode(): DecisionPolicyMode {
  const raw = process.env.BRAINIA_EVIDENCE_POLICY?.trim().toLowerCase();
  return (DECISION_POLICY_MODES as readonly string[]).includes(raw ?? "")
    ? raw as DecisionPolicyMode
    : "shadow";
}

export function verifierModel(generatorModel: string) {
  return process.env.DEEPSEEK_VERIFIER_MODEL?.trim()
    || generatorModel
    || process.env.DEEPSEEK_MODEL?.trim()
    || "deepseek-v4-flash";
}

export type DecisionActionKind =
  | "classify_event"
  | "extract_evidence"
  | "assign_existing_category"
  | "create_category"
  | "merge_identities"
  | "associate_entities"
  | "place_entity"
  | "summarize"
  | "insight"
  | "intelligence";

export type EvidenceKind =
  | "event_title"
  | "event_body"
  | "event_source"
  | "event_kind"
  | "event_timestamp"
  | "deterministic"
  | "entity"
  | "canonical_context"
  | "aggregate"
  | "human_correction";

export type EvidenceItem = {
  ref: string;
  kind: EvidenceKind;
  label: string;
  text: string;
  eventId?: string | null;
  source?: string | null;
  occurredAt?: string | null;
  field?: string | null;
};

export type EvidenceReference = {
  ref: string;
  excerpt?: string;
};

export type EvidenceResolution = {
  resolved: EvidenceItem[];
  invalidRefs: string[];
  excerptMismatches: string[];
  resolvedRefs: string[];
};

export type DeterministicCheck = {
  ok: boolean;
  errors: string[];
  warnings?: string[];
};

export type DecisionVerificationStatus = "verified" | "rejected" | "unavailable" | "not_required";

export type PathVerdict = {
  index: number;
  accept: boolean;
  reason: string;
};

export type AssociationVerdict = {
  index: number;
  accept: boolean;
  reason: string;
};

export type DecisionVerification = {
  status: DecisionVerificationStatus;
  actionKind: DecisionActionKind;
  policyVersion: string;
  verifierModel: string;
  verifierPromptVersion: string;
  generatorModel?: string | null;
  generatorPromptVersion?: string | null;
  deterministic: DeterministicCheck;
  reason: string;
  unsupported: string[];
  pathVerdicts: PathVerdict[];
  associationVerdicts: AssociationVerdict[];
  evidenceFingerprint: string | null;
  checkedAt: string;
  enforced: boolean;
};

export type VerificationOutcome = {
  verification: DecisionVerification;
  applies: boolean;
};

export function buildEvidenceIndex(items: EvidenceItem[]): Map<string, EvidenceItem> {
  const index = new Map<string, EvidenceItem>();
  for (const item of items) {
    if (!item.ref) continue;
    index.set(item.ref, item);
  }
  return index;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

/**
 * References must resolve against bytes the application actually supplied.
 * An invented reference invalidates the decision; a quoted excerpt must be a
 * literal (whitespace-normalized) substring of that reference.
 */
export function resolveEvidenceReferences(
  references: readonly EvidenceReference[] | null | undefined,
  index: Map<string, EvidenceItem>,
): EvidenceResolution {
  const resolved: EvidenceItem[] = [];
  const invalidRefs: string[] = [];
  const excerptMismatches: string[] = [];
  const resolvedRefs: string[] = [];
  const seen = new Set<string>();
  for (const reference of references ?? []) {
    if (!reference?.ref) {
      invalidRefs.push("<empty>");
      continue;
    }
    const item = index.get(reference.ref);
    if (!item) {
      invalidRefs.push(reference.ref);
      continue;
    }
    if (reference.excerpt?.trim()) {
      const haystack = normalizeWhitespace(item.text).toLocaleLowerCase("es");
      const needle = normalizeWhitespace(reference.excerpt).toLocaleLowerCase("es");
      if (!needle || !haystack.includes(needle)) {
        excerptMismatches.push(reference.ref);
        continue;
      }
    }
    if (!seen.has(reference.ref)) {
      seen.add(reference.ref);
      resolved.push(item);
      resolvedRefs.push(reference.ref);
    }
  }
  return { resolved, invalidRefs, excerptMismatches, resolvedRefs };
}

export function decisionEvidenceFingerprint(references: readonly EvidenceReference[] | null | undefined) {
  const keys = [...new Set((references ?? []).map((reference) => reference?.ref).filter((ref): ref is string => Boolean(ref)))].sort();
  return createHash("sha256").update(keys.join("\u0000")).digest("hex");
}

export function semanticDecisionFingerprint(input: {
  actionKind: string;
  subjectNormalizedValue: string;
  targetNormalizedValue: string;
  evidenceRefs: readonly string[];
}) {
  return createHash("sha256")
    .update(input.actionKind)
    .update("\u0000")
    .update(normalizeEntityValue(input.subjectNormalizedValue))
    .update("\u0000")
    .update(normalizeEntityValue(input.targetNormalizedValue))
    .update("\u0000")
    .update([...new Set(input.evidenceRefs)].sort().join("|"))
    .digest("hex");
}

/** Numbers, money and percentages asserted by generated prose. */
export function numericClaims(text: string): string[] {
  return [...text.matchAll(/-?\d+(?:[.,]\d+)*/gu)].map((match) => match[0]).filter(Boolean);
}

/**
 * Every number in generated prose must be computable from the supplied data.
 * This is a conservative check: formatting variants are accepted by comparing
 * the significant digits, but a fabricated total is rejected.
 */
export function unsupportedNumericClaims(text: string, evidenceText: string): string[] {
  const evidenceDigits = new Set(numericClaims(evidenceText).map(significantDigits));
  return numericClaims(text).filter((claim) => {
    const digits = significantDigits(claim);
    if (!digits) return false;
    if (evidenceDigits.has(digits)) return false;
    // A number that is a literal substring of the evidence (including a date
    // or identifier) is supported even if tokenization split it differently.
    return !evidenceText.includes(claim);
  });
}

function significantDigits(value: string) {
  const normalized = value.replace(/[.,](?=\d{3}\b)/gu, "").replace(",", ".");
  const number = Number(normalized);
  if (!Number.isFinite(number)) return "";
  return String(number);
}

const GENERIC_TRANSPORT = /(?:^|\b)(?:aviso|alerta|alert|notification|notificaci[oó]n|notificaci[oó]nes|message|mensaje|promo|promoci[oó]n|promociones|push|update|actualizaci[oó]n|recordatorio|reminder)(?:\b|$)/iu;
const PROVIDER_TYPES = new Set(["app", "merchant", "sender", "recipient", "channel"]);

/**
 * Reject a proposed concept that adds no activity meaning beyond the provider
 * or notification heading. A provider being mentioned never proves that an
 * order, purchase, delivery or other activity occurred.
 */
export function isRedundantProviderOrHeadingConcept(input: {
  proposedValue: string;
  source?: string | null;
  eventTitle?: string | null;
  subjectValue?: string | null;
  supportedNames?: Array<string | null | undefined>;
}) {
  const proposed = normalizeEntityValue(input.proposedValue);
  if (!proposed) return true;
  const source = normalizeEntityValue(input.source ?? "");
  const title = normalizeEntityValue(input.eventTitle ?? "");
  const subject = normalizeEntityValue(input.subjectValue ?? "");
  const names = [source, ...(input.supportedNames ?? []).map((value) => normalizeEntityValue(value ?? ""))]
    .filter((value) => value.length >= 2);

  if (subject && proposed === subject) return true;
  if (title && proposed === title) return true;
  if (source && proposed === source) return true;

  // "PedidosYa notification", "Notificación de PedidosYa", "PedidosYa alert".
  if (source && GENERIC_TRANSPORT.test(proposed)) {
    const withoutTransport = normalizeEntityValue(proposed.replace(GENERIC_TRANSPORT, " "));
    if (!withoutTransport || withoutTransport === source || names.some((name) => withoutTransport === name)) return true;
    if (proposed.includes(source)) return true;
  }

  // A heading copied from the notification, optionally prefixed by its source.
  if (title && title.length >= 4) {
    const withoutSource = source ? normalizeEntityValue(proposed.replace(source, " ")) : proposed;
    if (withoutSource === title && GENERIC_TRANSPORT.test(title)) return true;
    if (proposed === normalizeEntityValue(`${source} ${title}`)) return true;
  }

  // Generic transport alone is never a reusable activity class.
  if (GENERIC_TRANSPORT.test(proposed) && normalizeEntityValue(proposed.replace(GENERIC_TRANSPORT, " ")) === "") return true;
  return false;
}

export function isSameNormalizedLabel(left?: string | null, right?: string | null) {
  const a = normalizeEntityValue(left ?? "");
  const b = normalizeEntityValue(right ?? "");
  return Boolean(a && b && a === b);
}

export function isLowUtilityPromotion(input: { source?: string | null; title?: string | null; body?: string | null }) {
  const text = normalizeEntityValue(`${input.source ?? ""} ${input.title ?? ""} ${input.body ?? ""}`).toLocaleLowerCase("es");
  if (!text) return false;
  const promotional = /(?:promo|promoci[oó]n|descuento|oferta|offer|cup[oó]n|newsletter|bolet[ií]n|sale|% off|\boff\b|marketing|webinar|subscribe|suscr[ií]bete|unsubscribe|darse de baja|preaprobad|pre-approved)/u.test(text);
  if (!promotional) return false;
  const concreteActivity = /\b(?:pedidos?|orders?|deliver(?:y|ies)|entregas?|enviado|shipped|pagaste|gastaste|compraste|purchases?|recibos?|receipts?|reembolsos?|refunds?)\b|pago realizado/u.test(text);
  return !concreteActivity;
}

/**
 * A declined, rejected or cancelled card attempt is not a completed purchase.
 * This is deliberately conservative and shared by classification, semantic
 * placement and the evaluation harness.
 */
export function isRejectedFinancialText(input: {
  source?: string | null;
  title?: string | null;
  body?: string | null;
  entityValues?: string[];
}) {
  const text = normalizeEntityValue([
    input.source ?? "",
    input.title ?? "",
    input.body ?? "",
    ...(input.entityValues ?? []),
  ].join(" "));
  const explicitlyNegative = /(?:no se pudo|no se realiz|sin completar)/u.test(text);
  const rejected = /(?:rechaz|declin|deneg|failed|fall[oó]|no se pudo|no se realiz|sin completar|cancel|expir|revers|\b(?:pending|pendiente|hold|temporal|reminder|recordatorio|vencimiento|vence)\b|autoriz|preautoriz|facturas?\s+(?:pendientes?|para pagar|por pagar)|bill(?:\s+payment)?\s+reminder|preaprobad|pre-approved)/u.test(text);
  const approved = !explicitlyNegative && /\b(?:aprobad[oa]s?|approved|complet\w*|exitos\w*|success|posted|acredit\w*|pagó|pagaste|gastaste|realizado|realizada)\b/u.test(text);
  return rejected && !approved;
}

/** The four user-facing semantic review actions, plus a safe fallback. */
export function semanticActionKind(input: {
  decisionKind?: string | null;
  subjectType?: string | null;
  targetType?: string | null;
}): "assign_existing_category" | "create_category" | "merge_identities" | "associate_entities" | "place_entity" {
  if (input.decisionKind === "merge") return "merge_identities";
  if (input.decisionKind === "association") return "associate_entities";
  if (input.subjectType && ["activity_instance", "financial_event", "email_message"].includes(input.subjectType)) {
    return input.decisionKind === "create" ? "create_category" : "assign_existing_category";
  }
  return "place_entity";
}

const RELATION_LABELS_ES: Record<string, string> = {
  spent_at: "Pagar en",
  paid_for: "Pagar por",
  sent_by: "Enviado por",
  sent_to: "Enviado a",
  received_from: "Recibido de",
  uses_service: "Usar el servicio",
  produced_by_app: "Capturado por",
  represents_order: "Representa un pedido",
  has_transaction: "Tiene un movimiento",
  occurred_at: "Ocurrió en",
  received_via: "Recibido por",
  controls: "Controla",
  mentions: "Menciona",
  related_to: "Relacionar",
};

export function relationLabelEs(relationType: string) {
  return RELATION_LABELS_ES[relationType] ?? relationType.replace(/_/g, " ");
}

export function spanishChangeExplanation(input: {
  actionKind: ReturnType<typeof semanticActionKind>;
  subjectLabel: string;
  targetLabel: string;
  relationType?: string | null;
  hierarchyPath?: string[];
  verifiedEventCount?: number;
  isFinancial?: boolean;
}) {
  const subject = input.subjectLabel.trim() || "esta actividad";
  const target = input.targetLabel.trim() || "la categoría propuesta";
  const path = (input.hierarchyPath ?? []).filter(Boolean);
  const destination = path.length ? path.join(" › ") : target;
  const evidence = input.verifiedEventCount && input.verifiedEventCount > 1
    ? ` Respaldada por ${input.verifiedEventCount} eventos.`
    : "";
  switch (input.actionKind) {
    case "assign_existing_category":
      return `Clasificar «${subject}» en «${destination}». No se crea ningún concepto nuevo.${evidence}`;
    case "create_category":
      return `Crear la categoría «${target}» dentro de «${destination.split(" › ").slice(0, -1).join(" › ") || destination}» y usarla para «${subject}».${evidence}`;
    case "merge_identities":
      return `Unificar «${subject}» con «${target}» porque la evidencia indica que son la misma identidad. Los eventos y vínculos existentes se conservan.${evidence}`;
    case "associate_entities":
      return `Asociar «${subject}» con «${target}» mediante «${relationLabelEs(input.relationType ?? "related_to")}». Es una relación inferida y queda sujeta a tu revisión.${evidence}`;
    default:
      return `Ubicar «${subject}» en «${destination}» dentro del grafo.${evidence}`;
  }
}

export function isRuleEligibleAction(input: {
  actionKind: ReturnType<typeof semanticActionKind>;
  decisionKind?: string | null;
  relationType?: string | null;
  subjectType?: string | null;
}) {
  // Only a verified assignment to an already established category may become
  // a repeatable rule. New concepts, merges and inferred associations always
  // require a human decision each time they are proposed.
  return input.actionKind === "assign_existing_category"
    && input.decisionKind === "reuse"
    && ["part_of", "belongs_to_domain"].includes(input.relationType ?? "")
    && Boolean(input.subjectType);
}

export function isSupportedAssociationRationale(rationale: string | null | undefined) {
  const text = normalizeWhitespace(rationale ?? "").toLocaleLowerCase("es");
  if (!text) return false;
  // "Same app/platform/source" only proves that a provider is shared. It does
  // not establish a new real-world relationship between two events.
  const onlySharedChannel = /^(?:both|ambos|ambas|las dos|los dos)\b/iu.test(text)
    && /(?:same|mismo|misma|igual)\s+(?:app|aplicaci[oó]n|platform|plataforma|source|fuente|channel|canal|merchant|comercio)/iu.test(text)
    && !/\b(?:orders?|pedidos?|purchases?|compras?|deliver(?:y|ies)|entregas?|paid|pagos?|refunds?|reembolsos?|cancel\w*)\b/iu.test(text);
  return !onlySharedChannel;
}

export function evidenceTexts(items: readonly EvidenceItem[]) {
  return items.map((item) => item.text).join("\n");
}

export function redactProposalForVerifier<T>(value: T): T {
  // The verifier must not anchor on the generator's self-assessment. Remove
  // confidence, rationale and score fields recursively; keep the factual shape.
  const visit = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(visit);
    if (!input || typeof input !== "object") return input;
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(input as Record<string, unknown>)) {
      if (/^(confidence|rationale|reasoning|score|probability|probabilities)$/iu.test(key)) continue;
      output[key] = visit(child);
    }
    return output;
  };
  return visit(value) as T;
}
