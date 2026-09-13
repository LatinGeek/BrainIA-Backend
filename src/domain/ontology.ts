import { normalizeEntityValue, type EntityDraft } from "./entities.js";

export const LIFE_DOMAINS = [
  "Health", "Social", "Finances", "Work", "Entrepreneurship", "Psychology",
  "Location", "Home", "Food", "Communication", "Learning", "Entertainment",
] as const;

export type CategoryDefinition = {
  key: string;
  label: string;
  description: string;
  parentKey: string | null;
  level: number;
  kind: "domain" | "family" | "class" | "subtype";
  allowedEventKinds?: readonly string[];
  aliases?: readonly string[];
};

export const TAXONOMY_VERSION = "personal-activity-v1";

const domain = (key: string, label: typeof LIFE_DOMAINS[number], description: string): CategoryDefinition => ({
  key, label, description, parentKey: null, level: 0, kind: "domain",
});
const category = (key: string, label: string, description: string, parentKey: string, level: number, kind: CategoryDefinition["kind"] = "family", allowedEventKinds?: readonly string[], aliases?: readonly string[]): CategoryDefinition => ({
  key, label, description, parentKey, level, kind, allowedEventKinds, aliases,
});

// Stable keys are the contract. Labels remain user-facing and may evolve
// without invalidating model fixtures, semantic rules, or API filters.
export const CATEGORY_CATALOG = [
  domain("health", "Health", "Physical health, healthcare, exercise, symptoms, medication, and wellbeing."),
  domain("social", "Social", "Relationships, social interactions, communities, and shared activities."),
  domain("finances", "Finances", "Money, accounts, transactions, spending, income, and financial decisions."),
  domain("work", "Work", "Employment, professional responsibilities, colleagues, and workplace activity."),
  domain("entrepreneurship", "Entrepreneurship", "Ventures, business building, customers, and commercial activity."),
  domain("psychology", "Psychology", "Emotional patterns, mental wellbeing, motivations, habits, and reflection."),
  domain("location", "Location", "Places, movement, travel, and geographic context."),
  domain("home", "Home", "Household, living environment, domestic routines, utilities, and connected devices."),
  domain("food", "Food", "Meals, groceries, restaurants, delivery, and food-related habits."),
  domain("communication", "Communication", "Messages, email, contacts, conversations, and communication channels."),
  domain("learning", "Learning", "Study, research, skills, educational material, and knowledge development."),
  domain("entertainment", "Entertainment", "Music, media, games, leisure, and recreational interests."),

  category("finances.activity", "Financial activity", "Concrete movements of money and account activity.", "finances", 1, "family", ["expense", "income", "transfer"]),
  category("finances.spending", "Spending", "Money leaving the user's accounts for purchases, bills, fees, or withdrawals.", "finances.activity", 2, "class", ["expense"]),
  category("finances.spending.card_purchase", "Card purchases", "Completed purchases made using a debit or credit card.", "finances.spending", 3, "subtype", ["expense"], ["card payment", "card charge"]),
  category("finances.spending.subscription", "Subscriptions", "Recurring payments for memberships or services.", "finances.spending", 3, "subtype", ["expense"]),
  category("finances.spending.bill", "Bills and services", "Payments for utilities, invoices, and recurring household or professional services.", "finances.spending", 3, "subtype", ["expense"]),
  category("finances.spending.fee", "Fees and charges", "Bank, platform, tax, and service fees.", "finances.spending", 3, "subtype", ["expense"]),
  category("finances.spending.cash", "Cash withdrawals", "Cash withdrawn from an account or card.", "finances.spending", 3, "subtype", ["expense"]),
  category("finances.income", "Income", "Money entering the user's accounts.", "finances.activity", 2, "class", ["income"]),
  category("finances.income.salary", "Salary income", "Salary, payroll, and employment compensation.", "finances.income", 3, "subtype", ["income"], ["salary", "payroll"]),
  category("finances.income.refund", "Refunds", "Returned money, reversals, and reimbursements.", "finances.income", 3, "subtype", ["income"]),
  category("finances.transfers", "Transfers", "Money moved between accounts or people.", "finances.activity", 2, "class", ["transfer"]),
  category("finances.transfers.internal", "Internal transfers", "Transfers between accounts controlled by the user.", "finances.transfers", 3, "subtype", ["transfer"]),
  category("finances.transfers.external", "External transfers", "Transfers to or from another person or organization.", "finances.transfers", 3, "subtype", ["transfer"]),
  category("finances.accounts", "Accounts and cards", "Financial accounts, balances, cards, and their administrative state.", "finances", 1, "family"),
  category("finances.payment_methods", "Payment methods", "Cards, wallets, and other instruments used to make or receive payments.", "finances", 1, "family"),
  category("finances.payment_methods.digital_wallets", "Digital wallets", "Digital payment wallets such as Google Pay, Apple Pay, and similar services.", "finances.payment_methods", 2, "class"),
  category("finances.payment_methods.cards", "Payment cards", "Debit, credit, prepaid, and virtual cards used as payment methods.", "finances.payment_methods", 2, "class"),

  category("communication.email", "Email", "Electronic messages and the identities and conversations around them.", "communication", 1, "family", ["email"]),
  category("communication.email.activity", "Email activity", "Email messages received, sent, or acted upon.", "communication.email", 2, "class", ["email"]),
  category("communication.email.accounts", "Email accounts", "Email identities and inboxes used by the user.", "communication.email", 2, "class"),
  category("communication.email.contacts", "Email contacts", "People and organizations communicating with the user through email.", "communication.email", 2, "class"),
  category("communication.messaging", "Messaging", "Chat, SMS, and direct-message activity.", "communication", 1, "family", ["notification"]),
  category("communication.calls", "Calls", "Voice and video call activity.", "communication", 1, "family", ["notification"]),

  category("food.delivery", "Food / Delivery", "Prepared-food purchases and delivery services.", "food", 1, "family", ["expense", "notification"]),
  category("food.delivery.orders", "Orders", "Purchases and fulfillment activity for delivered food.", "food.delivery", 2, "class", ["expense", "notification"]),
  category("food.groceries", "Food / Groceries", "Food and household provisions purchased for later use.", "food", 1, "family", ["expense"]),
  category("food.dining", "Dining", "Meals and drinks purchased from restaurants, cafes, and bars.", "food", 1, "family", ["expense"]),
  category("food.cooking", "Cooking", "Meal preparation and cooking activity.", "food", 1, "family", ["note", "task", "notification"]),

  category("home.automation", "Home automation", "Connected devices, services, and routines that monitor or control the home.", "home", 1, "family", ["notification"]),
  category("home.automation.device_alert", "Device alerts", "Meaningful state changes and alerts emitted by connected-home devices.", "home.automation", 2, "class", ["notification"]),
  category("home.maintenance", "Home maintenance", "Repairs, upkeep, cleaning, and household tasks.", "home", 1, "family", ["task", "note", "notification"]),
  category("home.utilities", "Utilities", "Electricity, water, connectivity, and other household services.", "home", 1, "family", ["expense", "notification"]),

  category("entertainment.music", "Music", "Artists, tracks, listening services, playlists, and music habits.", "entertainment", 1, "family", ["notification"]),
  category("entertainment.video", "Video and streaming", "Film, television, online video, and streaming activity.", "entertainment", 1, "family", ["notification"]),
  category("entertainment.games", "Games", "Video games, tabletop games, and play activity.", "entertainment", 1, "family", ["notification"]),

  category("work.tasks", "Work tasks", "Professional tasks, reminders, and deliverables.", "work", 1, "family", ["task", "note"]),
  category("work.meetings", "Meetings", "Professional meetings, calls, and scheduled collaboration.", "work", 1, "family", ["notification", "email"]),
  category("work.employment", "Employment", "Employer, payroll, role, and workplace administration.", "work", 1, "family", ["email", "notification"]),
  category("learning.study", "Study", "Courses, lessons, practice, and planned study.", "learning", 1, "family", ["task", "note", "notification"]),
  category("learning.research", "Research", "Research questions, sources, and investigative activity.", "learning", 1, "family", ["note", "email"]),
  category("location.travel", "Travel", "Trips, transport, accommodation, and travel planning.", "location", 1, "family", ["expense", "email", "notification"]),
  category("location.visits", "Places visited", "Meaningful visits and time spent at places.", "location", 1, "family", ["notification"]),
  category("health.care", "Healthcare", "Appointments, providers, treatment, and medical administration.", "health", 1, "family", ["email", "notification", "task"]),
  category("health.fitness", "Fitness", "Exercise, training, activity, and physical performance.", "health", 1, "family", ["notification", "note"]),
  category("social.interactions", "Social interactions", "Conversations, gatherings, and activity with other people.", "social", 1, "family", ["notification", "email", "note"]),
  category("psychology.reflection", "Reflection", "Journaling, moods, observations, and personal reflection.", "psychology", 1, "family", ["note"]),
  category("entrepreneurship.businesses", "Businesses", "Commercial organizations, shops, providers, and establishments represented as entities.", "entrepreneurship", 1, "family"),
  category("entrepreneurship.businesses.food", "Food establishments", "Restaurants, cafes, bakeries, takeaways, and other food businesses.", "entrepreneurship.businesses", 2, "class"),
  category("entrepreneurship.businesses.hardware", "Hardware stores", "Hardware stores, construction-supply shops, and home-improvement retailers.", "entrepreneurship.businesses", 2, "class"),
  category("entrepreneurship.businesses.electronics", "Electronics stores", "Retailers of consumer electronics, computers, phones, and related accessories.", "entrepreneurship.businesses", 2, "class"),
  category("entrepreneurship.businesses.pharmacy", "Pharmacies", "Pharmacies, drugstores, and health-product retailers.", "entrepreneurship.businesses", 2, "class"),
  category("entrepreneurship.businesses.fuel", "Fuel stations", "Gas stations, fuel retailers, and vehicle refueling services.", "entrepreneurship.businesses", 2, "class"),
  category("entrepreneurship.businesses.grocery", "Grocery stores", "Supermarkets, markets, grocers, and other everyday-provision retailers.", "entrepreneurship.businesses", 2, "class"),
  category("entrepreneurship.businesses.retail", "General retail", "Retail businesses that do not fit a more specific commercial type.", "entrepreneurship.businesses", 2, "class"),
  category("entrepreneurship.businesses.services", "Service businesses", "Businesses that primarily deliver professional, personal, repair, or local services.", "entrepreneurship.businesses", 2, "class"),
  category("entrepreneurship.operations", "Business operations", "Operational activity for a venture or independent business.", "entrepreneurship", 1, "family", ["task", "email", "expense", "income"]),
] as const satisfies readonly CategoryDefinition[];

export const SEEDED_CONCEPTS = CATEGORY_CATALOG.filter((node) => node.kind !== "domain").map((node) => node.label);
export const ONTOLOGY_PARENT_RELATIONS = CATEGORY_CATALOG
  .filter((node) => node.parentKey)
  .map((node) => [node.label, CATEGORY_CATALOG.find((parent) => parent.key === node.parentKey)!.label] as const);
export const ONTOLOGY_TREE = Object.fromEntries(CATEGORY_CATALOG.map((node) => [node.label, CATEGORY_CATALOG.filter((child) => child.parentKey === node.key).map((child) => child.label)])) as Record<string, string[]>;

export const SEMANTIC_GOVERNANCE_VERSION = "semantic-governance-v5";
export const SEMANTIC_PROMPT_VERSION = "semantic-meaning-v5";
export const MAX_SEMANTIC_DEPTH = 8;
export const PRIMARY_ROOT_CONFIDENCE = 0.8;
export const PRIMARY_ROOT_MARGIN = 0.1;
export const AUTO_APPLY_CONFIDENCE = 0.9;
export const NEW_NODE_OBSERVATION_CONFIDENCE = 0.85;

const CATEGORY_BY_KEY = new Map(CATEGORY_CATALOG.map((node) => [node.key, node]));
const CATEGORY_BY_LABEL = new Map(CATEGORY_CATALOG.map((node) => [normalizeEntityValue(node.label), node]));

export function categoryByKey(key: string) {
  return CATEGORY_BY_KEY.get(key) ?? null;
}

export function categoryByLabel(label: string) {
  return CATEGORY_BY_LABEL.get(normalizeEntityValue(label)) ?? null;
}

export function categoryPath(key: string) {
  const path: CategoryDefinition[] = [];
  let current = categoryByKey(key);
  while (current) {
    path.unshift(current);
    current = current.parentKey ? categoryByKey(current.parentKey) : null;
  }
  return path;
}

export function categoryKeyForPath(labels: readonly string[]) {
  for (let index = labels.length - 1; index >= 0; index -= 1) {
    const category = categoryByLabel(labels[index]!);
    if (category) return category.key;
  }
  return null;
}

export function categoryCatalogPrompt() {
  return CATEGORY_CATALOG.map((node) => `${node.key}=${node.label}${node.parentKey ? ` < ${node.parentKey}` : ""}`).join("; ");
}

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
  const category = categoryByLabel(value);
  return {
    type,
    value,
    normalizedValue: normalizeEntityValue(value),
    description: category?.description ?? ONTOLOGY_DESCRIPTIONS[value] ?? `A governed knowledge concept for ${value}.`,
    identitySource: "ai_seed",
    metadata: {
      source: "ontology",
      ontologyVersion: SEMANTIC_GOVERNANCE_VERSION,
      taxonomyVersion: TAXONOMY_VERSION,
      taxonomyKey: category?.key,
      taxonomyLevel: category?.level,
      taxonomyKind: category?.kind,
      seeded: true,
    },
  };
}

export function semanticInstanceDraft(input: { eventId: string; inferredKind: string; source?: string; title?: string; body?: string; identity?: { displayTitle?: string; displayDescription?: string } | null }): EntityDraft {
  const type = input.inferredKind === "email" ? "email_message" : input.inferredKind === "expense" || input.inferredKind === "income" || input.inferredKind === "transfer" ? "financial_event" : "activity_instance";
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
  const generatedTitle = input.identity?.displayTitle?.trim();
  const generatedDescription = input.identity?.displayDescription?.trim();
  const validGeneratedIdentity = Boolean(generatedTitle && generatedDescription && generatedDescription.length >= 20
    && !/^(?:aviso|alerta|notification|notificaci(?:o|ó)n|message|mensaje|movimiento|transaction|transacci(?:o|ó)n)$/iu.test(generatedTitle));
  const value = (validGeneratedIdentity ? generatedTitle : titleIsProviderName ? evidenceBody : title || body?.slice(0, 160))
    || (type === "activity_instance" && input.source ? `Notification from ${input.source}` : input.inferredKind);
  return {
    type,
    value,
    normalizedValue: `event:${input.eventId}`,
    description: validGeneratedIdentity ? generatedDescription : undefined,
    identitySource: validGeneratedIdentity ? "ai" : "extracted",
    metadata: { source: SEMANTIC_GOVERNANCE_VERSION, eventId: input.eventId, instance: true, aiIdentity: validGeneratedIdentity },
  };
}
