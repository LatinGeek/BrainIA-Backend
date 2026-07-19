import { z } from "zod";
import type { EntityDraft } from "../domain/entities.js";
import { normalizeEntityValue } from "../domain/entities.js";
import {
  AUTO_APPLY_CONFIDENCE,
  LIFE_DOMAINS,
  MAX_SEMANTIC_DEPTH,
  ONTOLOGY_PARENT_RELATIONS,
  PRIMARY_ROOT_CONFIDENCE,
  PRIMARY_ROOT_MARGIN,
  SEMANTIC_GOVERNANCE_VERSION,
  SEMANTIC_PROMPT_VERSION,
  ontologyTreePrompt,
} from "../domain/ontology.js";
import { normalizeRelationType } from "../domain/relations.js";
import { generateNaturalLanguageSummary } from "./deepseek.js";
import { pool } from "./postgres.js";

export const SEMANTIC_SUBJECT_TYPES = new Set(["app", "merchant", "email_message", "sender", "recipient", "financial_event", "activity_instance"]);
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
  proposedChild?: { value: string; description: string; parent: string; durable: boolean; confidence: number } | null;
  mergeTargetNormalizedValue?: string | null;
  eventAnchor?: boolean;
};

export type SemanticAssociationDecision = {
  sourceNormalizedValue: string;
  targetNormalizedValue: string;
  relationType: string;
  confidence: number;
  rationale: string;
};

export type SemanticDecision = {
  paths: SemanticPathDecision[];
  associations: SemanticAssociationDecision[];
  rootAlternatives: Array<{ value: string; confidence: number }>;
  governanceVersion: typeof SEMANTIC_GOVERNANCE_VERSION;
  promptVersion: typeof SEMANTIC_PROMPT_VERSION;
  model: string;
  status: "resolved" | "review" | "unclassified" | "model_unavailable";
};

const alternativeSchema = z.object({ value: z.string().min(1).max(120), confidence: z.number().min(0).max(1) });
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
  proposedChild: z.object({ value: z.string().min(2).max(120), description: z.string().min(20).max(500), parent: z.string().min(1).max(120), durable: z.boolean(), confidence: z.number().min(0).max(1) }).nullable().optional(),
  mergeTargetNormalizedValue: z.string().min(1).nullable().optional(),
});
const modelSchema = z.object({
  rootAlternatives: z.array(alternativeSchema).min(1).max(LIFE_DOMAINS.length),
  paths: z.array(pathSchema).max(30),
  associations: z.array(z.object({
    sourceNormalizedValue: z.string().min(1), targetNormalizedValue: z.string().min(1),
    relationType: z.string().min(1).max(80), confidence: z.number().min(0).max(1), rationale: z.string().min(1).max(400),
  })).max(20).default([]),
});

function isSemanticSubject(entity: EntityDraft) {
  return SEMANTIC_SUBJECT_TYPES.has(entity.type);
}

export function hasMeaningfulAiIdentity(subject: EntityDraft, identity: z.infer<typeof pathSchema>["identity"]) {
  const name = identity.canonicalName.trim();
  const normalizedName = normalizeEntityValue(name);
  if (!/[\p{L}\p{N}]/u.test(name) || /(?:\.\.\.|\u2026)$/.test(name)) return false;
  if (/^(?:aviso|alerta|notification|notificaci(?:o|\u00f3)n|realizada|movimiento|message|mensaje)$/iu.test(name)) return false;
  if (["activity_instance", "financial_event", "email_message"].includes(subject.type)
    && normalizedName === normalizeEntityValue(subject.value)) return false;
  return identity.description.trim().length >= 20 && identity.confidence >= PRIMARY_ROOT_CONFIDENCE;
}

function applyModelIdentity(subject: EntityDraft, identity: z.infer<typeof pathSchema>["identity"], model: string): EntityDraft {
  return {
    ...subject,
    value: identity.canonicalName.trim(),
    normalizedValue: normalizeEntityValue(identity.canonicalName),
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

async function loadCanonicalContext(clientId: string | null) {
  const [entities, hierarchy] = await Promise.all([
    pool.query<{ id: string; type: string; value: string; normalizedValue: string; description: string; aliases: string[] }>(`
      select distinct on (e.type, e.normalized_value) e.id, e.type, e.value,
        e.normalized_value as "normalizedValue", e.description,
        coalesce((select array_agg(a.alias order by a.alias) from entity_aliases a where a.entity_id = e.id), '{}') as aliases
      from entities e
      left join entity_merges merged on merged.alias_entity_id = e.id
      left join event_entities ee on ee.entity_id = e.id
      left join raw_events event on event.id = ee.event_id
      where merged.alias_entity_id is null
        and e.identity_source in ('ai', 'ai_seed', 'user')
        and length(btrim(e.description)) > 0
        and e.type in ('domain', 'concept', 'app', 'merchant', 'sender', 'recipient')
        and (e.type in ('domain', 'concept') or event.client_id is not distinct from $1)
      order by e.type, e.normalized_value, e.created_at asc limit 160
    `, [clientId]),
    pool.query<{ child: string; parent: string }>(`
      select source.value as child, target.value as parent
      from relations r join entities source on source.id = r.source_entity_id join entities target on target.id = r.target_entity_id
      where r.relation_type in ('part_of', 'belongs_to_domain')
        and source.identity_source in ('ai', 'ai_seed', 'user') and length(btrim(source.description)) > 0
        and target.identity_source in ('ai', 'ai_seed', 'user') and length(btrim(target.description)) > 0
    `),
  ]);
  const staticHierarchy = ONTOLOGY_PARENT_RELATIONS.map(([child, parent]) => ({ child, parent }));
  return { entities: entities.rows, hierarchy: [...staticHierarchy, ...hierarchy.rows] };
}

function validatePath(path: z.infer<typeof pathSchema>, context: Awaited<ReturnType<typeof loadCanonicalContext>>) {
  if (!LIFE_DOMAINS.includes(path.domain as typeof LIFE_DOMAINS[number])) return false;
  if (normalizeEntityValue(path.hierarchyPath[0] ?? "") !== normalizeEntityValue(path.domain)) return false;
  const knownNames = new Set([...LIFE_DOMAINS, ...context.entities.map((entity) => entity.value)].map(normalizeEntityValue));
  const parents = new Set(context.hierarchy.map(({ child, parent }) => `${normalizeEntityValue(child)}|${normalizeEntityValue(parent)}`));
  for (let index = 1; index < path.hierarchyPath.length; index += 1) {
    const child = path.hierarchyPath[index]!;
    const parent = path.hierarchyPath[index - 1]!;
    if (!parents.has(`${normalizeEntityValue(child)}|${normalizeEntityValue(parent)}`)) return false;
  }
  const leaf = path.hierarchyPath[path.hierarchyPath.length - 1]!;
  if (path.action === "reuse" && !knownNames.has(normalizeEntityValue(leaf))) return false;
  if (path.action === "create") {
    if (!path.proposedChild?.durable) return false;
    if (normalizeEntityValue(path.proposedChild.parent) !== normalizeEntityValue(leaf)) return false;
  }
  return true;
}

function structuralDecision(input: { entities: EntityDraft[]; inferredKind: string; source?: string; model: string }): SemanticDecision {
  const subjects = input.entities.filter(isSemanticSubject);
  const financial = input.inferredKind === "expense" || input.inferredKind === "income";
  const email = input.inferredKind === "email" || /(?:gmail|outlook|email|imap)/iu.test(input.source ?? "");
  const paths: SemanticPathDecision[] = [];
  if (financial) {
    const financialSubjects = subjects.filter((candidate) => candidate.type === "merchant" || candidate.type === "financial_event");
    financialSubjects.forEach((subject, index) => paths.push({ subject, role: "primary", domain: "Finances", action: "reuse", hierarchyPath: ["Finances", "Financial activity"], steps: [], confidence: 0.9, rationale: "A classified financial subject belongs to Financial activity.", eventAnchor: index === 0 }));
  }
  if (email) {
    const emailSubjects = subjects.filter((candidate) => ["email_message", "recipient", "sender"].includes(candidate.type));
    const emailRole = paths.some((path) => path.role === "primary") ? "secondary" as const : "primary" as const;
    emailSubjects.forEach((subject, index) => {
      const leaf = subject.type === "recipient" ? "Email accounts" : subject.type === "sender" ? "Email contacts" : "Email";
      paths.push({ subject, role: emailRole, domain: "Communication", action: "reuse", hierarchyPath: leaf === "Email" ? ["Communication", "Email"] : ["Communication", "Email", leaf], steps: [], confidence: 0.9, rationale: `${subject.value} belongs to the ${leaf} branch.`, eventAnchor: index === 0 });
    });
  }
  const rootAlternatives = [...new Map(paths.map((path) => [path.domain, { value: path.domain, confidence: path.confidence }])).values()];
  return { paths, associations: [], rootAlternatives, governanceVersion: SEMANTIC_GOVERNANCE_VERSION, promptVersion: SEMANTIC_PROMPT_VERSION, model: input.model, status: paths.length ? "resolved" : "model_unavailable" };
}

export async function buildModelSemanticDecision(input: { entities: EntityDraft[]; source: string; inferredKind: string; title?: string; body?: string; clientId: string | null; independentSubjectAudit?: boolean }): Promise<SemanticDecision> {
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
  if (!process.env.DEEPSEEK_API_KEY) return structuralDecision({ entities: input.entities, inferredKind: input.inferredKind, source: input.source, model });
  try {
    const loadedContext = await loadCanonicalContext(input.clientId);
    const auditedSubjects = new Set(input.entities.map((entity) => entity.normalizedValue));
    const canonicalContext = input.independentSubjectAudit
      ? { ...loadedContext, hierarchy: loadedContext.hierarchy.filter((edge) => !auditedSubjects.has(normalizeEntityValue(edge.child))) }
      : loadedContext;
    const response = await generateNaturalLanguageSummary({
      apiKey: process.env.DEEPSEEK_API_KEY,
      model,
      systemPrompt: `Return strict JSON only. Governance ${SEMANTIC_GOVERNANCE_VERSION}. You govern durable personal knowledge, not keywords.

Roots: ${LIFE_DOMAINS.join(", ")}.
Seed tree: ${ontologyTreePrompt()}.

For each event choose one primary root only when confidence >= ${PRIMARY_ROOT_CONFIDENCE} and it leads the runner-up by >= ${PRIMARY_ROOT_MARGIN}. Then classify every supplied durable subject independently, descending through immediate existing children and recording one step per level. Several subjects may have paths in the same domain; that does not create extra event anchors. Evaluate other roots independently and use no_relation for incidental matches. A path contains the root through the immediate parent of its supplied subject. Never include the subject itself in hierarchyPath and never skip an existing intermediate parent. Recipient addresses normally descend through Email accounts; external senders normally descend through Email contacts. A merchant must be placed by what it represents, not merely because its event contains a payment.

Actions: reuse an existing parent; create only a reusable independently meaningful child; merge only for the same identity; discard raw fragments; no_relation for an unrelated domain. Never create amounts, timestamps, IDs, package names, notification titles, truncated strings, or one-off text. There may be at most one path per domain and exactly one primary path. Secondary paths need strong independent evidence.

Associations are separate from hierarchy. Use only: ${[...STANDARD_ASSOCIATION_TYPES].join(", ")}. Endpoints must be supplied canonical subjects/context.

Every path must also define the durable identity of its subject. canonicalName must be a concise, independently meaningful graph label chosen from the evidence; never copy an event title, sentence, amount, timestamp, card suffix, action word, or truncated fragment. Preserve factual proper nouns for known people, merchants, apps, and accounts while normalizing casing and noise. description must explain what the entity represents in the user's knowledge graph without inventing facts. If a safe meaningful identity cannot be produced, use discard and do not propose a node.

Return {"rootAlternatives":[{"value","confidence"}],"paths":[{"subjectNormalizedValue","identity":{"canonicalName","description","confidence"},"role":"primary|secondary","domain","action":"reuse|create|merge|discard|no_relation","hierarchyPath":["Root","Immediate child"],"steps":[{"parent","decision":"descend_existing|stop|propose_child|merge|discard|no_relation","selectedChild":null,"confidence", "alternatives":[]}],"confidence","rationale","proposedChild":{"value","description","parent","durable","confidence"}|null,"mergeTargetNormalizedValue":null}],"associations":[{"sourceNormalizedValue","targetNormalizedValue","relationType","confidence","rationale"}]}.`,
      userPrompt: JSON.stringify({ source: input.source, inferredKind: input.inferredKind, title: input.title ?? null, body: input.body ?? null, subjects: input.entities.filter(isSemanticSubject).map((entity) => ({ type: entity.type, value: entity.value, normalizedValue: entity.normalizedValue })), canonicalContext }),
    });
    if (!response) return structuralDecision({ entities: input.entities, inferredKind: input.inferredKind, source: input.source, model });
    const parsed = modelSchema.safeParse(parseJson(response));
    if (!parsed.success) return structuralDecision({ entities: input.entities, inferredKind: input.inferredKind, source: input.source, model });
    const subjectByValue = new Map(input.entities.filter(isSemanticSubject).map((entity) => [entity.normalizedValue, entity]));
    const roots = parsed.data.rootAlternatives.filter((root) => LIFE_DOMAINS.includes(root.value as typeof LIFE_DOMAINS[number])).sort((left, right) => right.confidence - left.confidence);
    const primaryAllowed = (roots[0]?.confidence ?? 0) >= PRIMARY_ROOT_CONFIDENCE && ((roots[0]?.confidence ?? 0) - (roots[1]?.confidence ?? 0) >= PRIMARY_ROOT_MARGIN || roots.length === 1);
    const seenSubjects = new Set<string>();
    let primarySeen = false;
    const paths = parsed.data.paths.flatMap((rawPath): SemanticPathDecision[] => {
      const subject = subjectByValue.get(rawPath.subjectNormalizedValue);
      if (!subject) return [];
      const path = refineTypedExistingPath(rawPath, subject);
      if (!hasMeaningfulAiIdentity(subject, path.identity)) return [];
      const subjectKey = `${path.subjectNormalizedValue}|${normalizeEntityValue(path.domain)}`;
      if (seenSubjects.has(subjectKey) || !validatePath(path, canonicalContext)) return [];
      if (path.action === "discard" || path.action === "no_relation") return [];
      if (path.role === "primary" && (!primaryAllowed || normalizeEntityValue(path.domain) !== normalizeEntityValue(roots[0]?.value ?? ""))) return [];
      if (path.role === "secondary" && path.confidence < PRIMARY_ROOT_CONFIDENCE) return [];
      seenSubjects.add(subjectKey);
      if (path.role === "primary") primarySeen = true;
      const governedSubject = applyModelIdentity(subject, path.identity, model);
      return [{ subject: governedSubject, identity: path.identity, role: path.role, domain: path.domain, action: path.action, hierarchyPath: path.hierarchyPath, steps: path.steps, confidence: path.confidence, rationale: path.rationale, proposedChild: path.proposedChild, mergeTargetNormalizedValue: path.mergeTargetNormalizedValue }];
    });
    const anchoredDomains = new Set<string>();
    for (const path of paths) {
      const domainKey = normalizeEntityValue(path.domain);
      path.eventAnchor = !anchoredDomains.has(domainKey);
      anchoredDomains.add(domainKey);
    }
    const knownSubjects = new Set(input.entities.filter(isSemanticSubject).map((entity) => entity.normalizedValue));
    const governedIdentities = new Map(paths.map((path) => [String(path.subject.metadata?.evidenceNormalizedValue ?? path.subject.normalizedValue), path.subject.normalizedValue]));
    const associations = parsed.data.associations.flatMap((association): SemanticAssociationDecision[] => {
      const relationType = normalizeRelationType(association.relationType).relationType;
      if (!STANDARD_ASSOCIATION_TYPES.has(relationType) || !knownSubjects.has(association.sourceNormalizedValue)) return [];
      return [{ ...association, sourceNormalizedValue: governedIdentities.get(association.sourceNormalizedValue) ?? association.sourceNormalizedValue, targetNormalizedValue: governedIdentities.get(association.targetNormalizedValue) ?? association.targetNormalizedValue, relationType }];
    });
    const coveredSubjects = new Set(paths.map((path) => String(path.subject.metadata?.evidenceNormalizedValue ?? path.subject.normalizedValue)));
    const suppliedSubjects = input.entities.filter(isSemanticSubject);
    const needsReview = !primarySeen || suppliedSubjects.some((subject) => !coveredSubjects.has(subject.normalizedValue)) || paths.some((path) => path.action !== "reuse" || path.confidence < AUTO_APPLY_CONFIDENCE) || associations.some((association) => association.confidence < AUTO_APPLY_CONFIDENCE);
    return { paths, associations, rootAlternatives: roots, governanceVersion: SEMANTIC_GOVERNANCE_VERSION, promptVersion: SEMANTIC_PROMPT_VERSION, model, status: paths.length ? (needsReview ? "review" : "resolved") : "unclassified" };
  } catch (error) {
    if (process.env.DEBUG_SEMANTIC === "true") console.warn("semantic_model_error", error instanceof Error ? error.message : String(error));
    return structuralDecision({ entities: input.entities, inferredKind: input.inferredKind, source: input.source, model });
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
