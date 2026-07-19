import type { EntityDraft } from "./entities.js";

export type RelationDraft = {
  relationType: string;
  label: string;
  description: string;
  sourceEntity: EntityDraft;
  targetEntity: EntityDraft;
  confidence: number;
  metadata?: Record<string, unknown>;
};

const RELATION_TYPE_ALIASES: Record<string, { relationType: string; label: string }> = {
  spent_at: { relationType: "spent_at", label: "Spent at" },
  spend_at: { relationType: "spent_at", label: "Spent at" },
  paid_at: { relationType: "spent_at", label: "Spent at" },
  paid_to: { relationType: "spent_at", label: "Spent at" },
  purchased_from: { relationType: "spent_at", label: "Spent at" },
  purchase_at: { relationType: "spent_at", label: "Spent at" },
  same_as: { relationType: "same_as", label: "Same as" },
  equivalent_to: { relationType: "same_as", label: "Same as" },
  duplicate_of: { relationType: "same_as", label: "Same as" },
  sent_by: { relationType: "sent_by", label: "Sent by" },
  sent_to: { relationType: "sent_to", label: "Sent to" },
  received_from: { relationType: "received_from", label: "Received from" },
  belongs_to_domain: { relationType: "belongs_to_domain", label: "Belongs to" },
  part_of: { relationType: "part_of", label: "Part of" },
  uses_service: { relationType: "uses_service", label: "Uses service" },
  produced_by_app: { relationType: "produced_by_app", label: "Produced by app" },
  has_instance: { relationType: "has_instance", label: "Has instance" },
  represents_order: { relationType: "represents_order", label: "Represents order" },
  paid_for: { relationType: "paid_for", label: "Paid for" },
  has_transaction: { relationType: "has_transaction", label: "Has transaction" },
  occurred_at: { relationType: "occurred_at", label: "Occurred at" },
  occurred_on: { relationType: "occurred_on", label: "Occurred on" },
  received_via: { relationType: "received_via", label: "Received via" },
  controls: { relationType: "controls", label: "Controls" },
  mentions: { relationType: "mentions", label: "Mentions" },
  evidence_for: { relationType: "evidence_for", label: "Evidence for" },
};

export function normalizeRelationType(relationType: string, label?: string) {
  const normalized = relationType
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const fromType = RELATION_TYPE_ALIASES[normalized];
  if (fromType) return fromType;

  const normalizedLabel = (label ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (/\b(spent|spend|paid|purchase|purchased)\b/.test(normalizedLabel)) return RELATION_TYPE_ALIASES.spent_at;
  if (/\b(same|equivalent|duplicate)\b/.test(normalizedLabel)) return RELATION_TYPE_ALIASES.same_as;

  return {
    relationType: normalized || "related_to",
    label: label?.trim() || (normalized || "related_to").replace(/_/g, " "),
  };
}

function getFirstEntity(entities: EntityDraft[], type: string) {
  return entities.find((entity) => entity.type === type);
}

function buildRelationMetadata(input: {
  source: string;
  title?: string;
  body?: string;
  inferredKind: string;
}) {
  return {
    source: "heuristic",
    evidence: {
      kind: input.inferredKind,
      title: input.title ?? null,
      body: input.body ?? null,
      source: input.source,
    },
  };
}

export function buildRelationDrafts(input: {
  title?: string;
  body?: string;
  source?: string;
  inferredKind: string;
  entities: EntityDraft[];
}): RelationDraft[] {
  const drafts: RelationDraft[] = [];

  if (input.inferredKind === "expense") {
    const amount = getFirstEntity(input.entities, "amount");
    const merchant = getFirstEntity(input.entities, "merchant");
    if (amount && merchant) {
      drafts.push({
        relationType: "spent_at",
        label: "se gastó en",
        description: `${amount.value} se gastó en ${merchant.value}`,
        sourceEntity: amount,
        targetEntity: merchant,
        confidence: 0.8,
        metadata: buildRelationMetadata({
          source: input.source ?? "unknown",
          title: input.title,
          body: input.body,
          inferredKind: input.inferredKind,
        }),
      });
    }
  }

  if (input.inferredKind === "email") {
    const message = getFirstEntity(input.entities, "message");
    const recipient = getFirstEntity(input.entities, "recipient");
    const sender = getFirstEntity(input.entities, "sender");

    if (message && sender) {
      drafts.push({
        relationType: "sent_by",
        label: "se envía desde",
        description: `${message.value} se envía desde ${sender.value}`,
        sourceEntity: message,
        targetEntity: sender,
        confidence: 0.75,
        metadata: buildRelationMetadata({
          source: input.source ?? "unknown",
          title: input.title,
          body: input.body,
          inferredKind: input.inferredKind,
        }),
      });
    }

    if (message && recipient) {
      drafts.push({
        relationType: "sent_to",
        label: "se envía a",
        description: `${message.value} se envía a ${recipient.value}`,
        sourceEntity: message,
        targetEntity: recipient,
        confidence: 0.75,
        metadata: buildRelationMetadata({
          source: input.source ?? "unknown",
          title: input.title,
          body: input.body,
          inferredKind: input.inferredKind,
        }),
      });
    }
  }

  return drafts;
}
