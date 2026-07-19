import { normalizeEntityValue, type EntityDraft } from "./entities.js";

export const LIFE_DOMAINS = [
  "Health", "Social", "Finances", "Work", "Entrepreneurship", "Psychology",
  "Location", "Home", "Food", "Communication", "Learning", "Entertainment",
] as const;

export const SEEDED_CONCEPTS = [
  "Email", "Email accounts", "Email contacts", "Financial activity", "Food / Delivery",
  "Food / Groceries", "Home automation", "Music", "Orders",
] as const;

export const ONTOLOGY_PARENT_RELATIONS = [
  ["Food / Delivery", "Food"],
  ["Food / Groceries", "Food"],
  ["Home automation", "Home"],
  ["Email", "Communication"],
  ["Email accounts", "Email"],
  ["Email contacts", "Email"],
  ["Financial activity", "Finances"],
  ["Music", "Entertainment"],
  ["Orders", "Food / Delivery"],
] as const;

export const ONTOLOGY_TREE = {
  Food: ["Food / Delivery", "Food / Groceries"],
  Home: ["Home automation"],
  Communication: ["Email"],
  Email: ["Email accounts", "Email contacts"],
  Entertainment: ["Music"],
  Finances: ["Financial activity"], Health: [], Social: [], Work: [], Entrepreneurship: [], Psychology: [], Location: [], Learning: [],
} as const;

export const SEMANTIC_GOVERNANCE_VERSION = "semantic-governance-v3";
export const SEMANTIC_PROMPT_VERSION = "semantic-identity-v3";
export const MAX_SEMANTIC_DEPTH = 8;
export const PRIMARY_ROOT_CONFIDENCE = 0.8;
export const PRIMARY_ROOT_MARGIN = 0.1;
export const AUTO_APPLY_CONFIDENCE = 0.9;
export const NEW_NODE_OBSERVATION_CONFIDENCE = 0.85;

const ONTOLOGY_DESCRIPTIONS: Record<string, string> = {
  Health: "The user's physical health, healthcare, exercise, symptoms, and wellbeing.",
  Social: "The user's relationships, social interactions, communities, and shared activities.",
  Finances: "The user's money, accounts, transactions, spending, income, and financial decisions.",
  Work: "The user's employment, professional responsibilities, colleagues, and workplace activity.",
  Entrepreneurship: "The user's ventures, business building, commercial ideas, and entrepreneurial activity.",
  Psychology: "The user's emotional patterns, mental wellbeing, motivations, and personal reflection.",
  Location: "Places, movement, travel, and geographic context relevant to the user's life.",
  Home: "The user's household, living environment, domestic routines, and connected devices.",
  Food: "The user's meals, groceries, restaurants, delivery, and food-related habits.",
  Communication: "The user's messages, email, contacts, conversations, and communication channels.",
  Learning: "The user's study, research, skills, educational material, and knowledge development.",
  Entertainment: "The user's music, media, games, leisure, and recreational interests.",
  Email: "Electronic messages and the services, accounts, contacts, and conversations around them.",
  "Email accounts": "Email identities and inboxes used by the user to send or receive messages.",
  "Email contacts": "People and organizations that communicate with the user through email.",
  "Financial activity": "Concrete movements of money such as purchases, income, transfers, and payments.",
  "Food / Delivery": "Prepared-food purchases and delivery services used to place and receive orders.",
  "Food / Groceries": "Food and household provisions purchased for later preparation or consumption.",
  "Home automation": "Connected devices, services, and routines that monitor or control the user's home.",
  Music: "Artists, tracks, listening services, playlists, and the user's music habits.",
  Orders: "Individual purchases and fulfillment activity associated with requested goods or food.",
};

export function isLifeDomain(value: string): value is typeof LIFE_DOMAINS[number] {
  return LIFE_DOMAINS.includes(value as typeof LIFE_DOMAINS[number]);
}

export function ontologyParentName(value: string) {
  return ONTOLOGY_PARENT_RELATIONS.find(([child]) => normalizeEntityValue(child) === normalizeEntityValue(value))?.[1] ?? null;
}

export function ontologyTreePrompt() {
  return Object.entries(ONTOLOGY_TREE).map(([parent, children]) => `${parent}${children.length ? ` -> ${children.join(", ")}` : ""}`).join("; ");
}

export function ontologyDraft(value: string, type: "domain" | "concept" = "domain"): EntityDraft {
  return {
    type,
    value,
    normalizedValue: normalizeEntityValue(value),
    description: ONTOLOGY_DESCRIPTIONS[value] ?? `A governed knowledge concept for ${value}.`,
    identitySource: "ai_seed",
    metadata: { source: "ontology", ontologyVersion: SEMANTIC_GOVERNANCE_VERSION, seeded: true },
  };
}

export function semanticInstanceDraft(input: { eventId: string; inferredKind: string; source?: string; title?: string; body?: string }): EntityDraft {
  const type = input.inferredKind === "email" ? "email_message" : input.inferredKind === "expense" || input.inferredKind === "income" ? "financial_event" : "activity_instance";
  const title = input.title?.trim();
  const body = input.body?.trim();
  const titleIsProviderName = type === "activity_instance"
    && Boolean(title)
    && Boolean(input.source)
    && normalizeEntityValue(title ?? "") === normalizeEntityValue(input.source ?? "");
  const evidenceBody = titleIsProviderName
    ? body?.split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && normalizeEntityValue(line) !== normalizeEntityValue(input.source ?? ""))
      .join(" ")
    : body;
  // Android often uses the app name as notification title. An activity node is
  // evidence, not another copy of the provider, so prefer the notification
  // content in that case and retain a clear fallback when no content exists.
  const value = (titleIsProviderName ? evidenceBody : title || body?.slice(0, 160))
    || (type === "activity_instance" && input.source ? `Notification from ${input.source}` : input.inferredKind);
  return {
    type,
    value,
    normalizedValue: `event:${input.eventId}`,
    metadata: { source: SEMANTIC_GOVERNANCE_VERSION, eventId: input.eventId, instance: true },
  };
}
