import { config } from "../config.js";

// Read per call (not at import) so deployments and tests can toggle the model.
const deepseekKey = () => process.env.DEEPSEEK_API_KEY?.trim() || undefined;
import {
  answerSystemPrompt,
  ASK_ANSWER_PROMPT_VERSION,
  ASK_PLAN_PROMPT_VERSION,
  checkNumericGrounding,
  defaultFinancePeriod,
  formatLocalDate,
  heuristicPlan,
  localDateIn,
  planPrompt,
  sanitizeCitations,
  sanitizePlan,
  type AskPlan,
  type PlanContext,
} from "../domain/ask.js";
import { parseModelJson } from "../domain/intelligence.js";
import { generateNaturalLanguageSummary, streamChatCompletion } from "./deepseek.js";
import { generateEmbedding } from "./embeddings.js";
import { loadAskContext, retrieveFinance, retrieveKnowledge, type AskCard, type AskSource } from "./ask-retrieval.js";
import { pool, withOwnerRead } from "./postgres.js";
import { authorizeModelDispatch } from "./privacy.js";

export type AskTurn = { role: "user" | "assistant"; content: string };

export type AskPublicSource = {
  id: string; // "S1"
  kind: AskSource["kind"];
  title: string;
  subtitle: string | null;
  date: string | null;
  route: AskSource["route"];
  amount: AskSource["amount"];
};

export type AskGrounding = { status: "verified" | "unverified" | "not_applicable"; unverified: string[] };

export type AskStreamEvent =
  | { type: "status"; stage: "understanding" | "retrieving" | "answering" }
  | { type: "plan"; standalone: string; intent: AskPlan["intent"]; period: { label: string; fromDate: string; toDate: string; assumed: boolean } | null; filters: string[] }
  | { type: "sources"; sources: AskPublicSource[]; cards: AskCard[] }
  | { type: "delta"; text: string }
  | { type: "done"; answer: string; citations: string[]; grounding: AskGrounding; mode: "model" | "deterministic"; timings: Record<string, number> }
  | { type: "error"; code: string; message: string };

const MAX_SOURCES = 16;
const MAX_EVIDENCE_CHARS = 14_000;

export function askEnabled() {
  return process.env.BRAINIA_ASK_ENABLED !== "false";
}

function trimHistory(history: AskTurn[]) {
  return history.slice(-6).map((turn) => ({ role: turn.role, content: turn.content.replace(/\[S\d+\]/g, "").slice(0, turn.role === "assistant" ? 500 : 400) }));
}

async function planQuestion(input: {
  ownerId: string | null; question: string; history: AskTurn[]; context: PlanContext;
}): Promise<AskPlan> {
  if (!deepseekKey()) return heuristicPlan(input.question, input.context);
  // The planner sees only the question, the conversation and the owner's own
  // account/category names; no captured evidence is sent at this stage.
  const authorization = await authorizeModelDispatch(pool, { ownerId: input.ownerId, purpose: "ask_plan" });
  try {
    const raw = await generateNaturalLanguageSummary({
      apiKey: deepseekKey(),
      model: process.env.DEEPSEEK_ASK_PLAN_MODEL ?? config.deepseekModel,
      systemPrompt: planPrompt(input.context),
      userPrompt: JSON.stringify({ history: trimHistory(input.history), question: input.question }),
      jsonMode: true,
      maxTokens: 700,
      timeoutMs: 12_000,
      privacy: authorization,
      audit: { clientId: input.ownerId, operation: "ask_plan", promptVersion: ASK_PLAN_PROMPT_VERSION },
    });
    if (!raw) return heuristicPlan(input.question, input.context);
    return sanitizePlan(parseModelJson(raw), input.question, input.context);
  } catch {
    // Planner failures degrade to the deterministic plan, never to no answer.
    return heuristicPlan(input.question, input.context);
  }
}

async function queryVectors(ownerId: string | null, plan: AskPlan) {
  const texts = [...new Set([plan.standalone, plan.searchQueries[0]].filter((text): text is string => Boolean(text?.trim())))].slice(0, 2);
  const authorization = await authorizeModelDispatch(pool, { ownerId, purpose: "retrieval_query" });
  const generated = await Promise.all(texts.map((text) => generateEmbedding({
    text, clientId: ownerId, ownerId, purpose: "retrieval_query", authorization,
  })));
  return generated.map((item) => ({ vector: item.embedding, model: item.model }));
}

/** Orders and caps sources: calculations, then movements, records and elements. */
function packSources(sources: AskSource[]) {
  const order: Record<AskSource["kind"], number> = { calculation: 0, transaction: 1, event: 2, entity: 3 };
  const transactionEvents = new Set(sources.filter((source) => source.kind === "transaction").flatMap((source) => source.eventIds));
  const packed: AskSource[] = [];
  let chars = 0;
  for (const source of [...sources].sort((left, right) => order[left.kind] - order[right.kind] || right.score - left.score)) {
    // A record that only repeats a movement already listed adds no evidence.
    if (source.kind === "event" && source.eventIds.some((id) => transactionEvents.has(id))) continue;
    if (packed.length >= MAX_SOURCES || chars + source.text.length > MAX_EVIDENCE_CHARS) continue;
    packed.push(source);
    chars += source.text.length;
  }
  return packed;
}

function publicSources(sources: AskSource[]): AskPublicSource[] {
  return sources.map((source, index) => ({
    id: `S${index + 1}`, kind: source.kind, title: source.title, subtitle: source.subtitle,
    date: source.date, route: source.route, amount: source.amount,
  }));
}

function noEvidenceAnswer(plan: AskPlan) {
  const period = plan.period ? ` en ${plan.period.label}` : "";
  return `No encontré registros sobre eso${period} en lo que BrainIA capturó. Prueba con otro período, o nombra el comercio, la persona o el tema tal como aparece en tus datos.`;
}

/**
 * Runs one Ask turn and reports progress through `emit`. Retrieval happens in a
 * short owner-scoped read transaction; no network call to a model holds a
 * database connection.
 */
export async function runAsk(input: {
  ownerId: string | null;
  question: string;
  history?: AskTurn[];
  timeZone?: string;
  now?: Date;
  emit: (event: AskStreamEvent) => void;
}) {
  const timeZone = input.timeZone ?? "America/Montevideo";
  const now = input.now ?? new Date();
  const history = input.history ?? [];
  const timings: Record<string, number> = {};
  const started = Date.now();
  const mark = (name: string, since: number) => { timings[name] = Date.now() - since; };

  input.emit({ type: "status", stage: "understanding" });
  const contextData = await withOwnerRead(input.ownerId ?? undefined, (db) => loadAskContext(db, input.ownerId));
  const planContext: PlanContext = { timeZone, now, categories: contextData.categories, accounts: contextData.accounts };
  const planStarted = Date.now();
  const plan = await planQuestion({ ownerId: input.ownerId, question: input.question, history, context: planContext });
  mark("planMs", planStarted);

  const assumedPeriod = !plan.period && Boolean(plan.finance);
  const period = defaultFinancePeriod(plan, timeZone, now);
  const effectivePlan: AskPlan = { ...plan, period };
  input.emit({
    type: "plan",
    standalone: plan.standalone,
    intent: plan.intent,
    period: period ? { label: period.label, fromDate: period.fromDate, toDate: period.toDate, assumed: assumedPeriod } : null,
    filters: [
      ...(plan.finance?.merchants ?? []),
      ...(plan.finance?.categories ?? []),
      ...(plan.finance?.currency ? [plan.finance.currency] : []),
    ],
  });

  let sources: AskSource[] = [];
  let cards: AskCard[] = [];
  if (plan.intent !== "chitchat") {
    input.emit({ type: "status", stage: "retrieving" });
    const retrievalStarted = Date.now();
    const vectors = await queryVectors(input.ownerId, effectivePlan);
    const result = await withOwnerRead(input.ownerId ?? undefined, async (db) => {
      const finance = await retrieveFinance(db, { ownerId: input.ownerId, plan: effectivePlan, period, context: contextData, timeZone });
      // Finance answers still get a few records for context (e.g. "the gift for
      // mamá"); knowledge questions get the full budget.
      const knowledge = await retrieveKnowledge(db, {
        ownerId: input.ownerId, plan: effectivePlan, context: contextData, timeZone, queryVectors: vectors,
        maxEvents: plan.intent === "finance" ? 4 : 10, maxEntities: plan.intent === "finance" ? 2 : 4,
      });
      return { sources: [...finance.sources, ...knowledge], cards: finance.cards };
    });
    sources = packSources(result.sources);
    cards = result.cards;
    mark("retrievalMs", retrievalStarted);
  }
  const published = publicSources(sources);
  input.emit({ type: "sources", sources: published, cards });

  const today = formatLocalDate(localDateIn(timeZone, now));
  const finish = (answer: string, mode: "model" | "deterministic", grounding: AskGrounding) => {
    const { text, citations } = sanitizeCitations(answer, published.length);
    timings.totalMs = Date.now() - started;
    const event: AskStreamEvent = { type: "done", answer: text, citations: citations.map((id) => `S${id}`), grounding, mode, timings };
    input.emit(event);
    return event;
  };

  if (plan.intent !== "chitchat" && !sources.length) {
    return finish(noEvidenceAnswer(effectivePlan), "deterministic", { status: "not_applicable", unverified: [] });
  }
  if (!deepseekKey()) {
    return finish("El asistente no está configurado en este servidor. Abajo tienes los datos que encontré.", "deterministic", { status: "not_applicable", unverified: [] });
  }

  const authorization = await authorizeModelDispatch(pool, {
    ownerId: input.ownerId,
    purpose: "ask_answer",
    evidence: sources.flatMap((source) => source.eventIds.map((eventId) => ({ eventId, source: source.sourceNames[0] ?? null }))),
    eventIds: sources.flatMap((source) => source.eventIds),
  });
  if (!authorization.allowed) {
    return finish("Tu configuración de privacidad no permite enviar estas fuentes al modelo. Abajo tienes los datos calculados directamente.", "deterministic", { status: "not_applicable", unverified: [] });
  }

  input.emit({ type: "status", stage: "answering" });
  const answerStarted = Date.now();
  const periodLine = period
    ? `${period.label} (${period.fromDate} a ${period.toDate})${assumedPeriod ? " — elegido por defecto porque la pregunta no indicó período" : ""}`
    : "sin período específico";
  const evidence = sources.map((source, index) => `[S${index + 1}] ${source.text}`).join("\n\n");
  const result = await streamChatCompletion({
    apiKey: deepseekKey(),
    model: process.env.DEEPSEEK_ASK_MODEL ?? config.deepseekModel,
    messages: [
      { role: "system", content: answerSystemPrompt({ today, timeZone }) },
      ...trimHistory(history),
      { role: "user", content: `PREGUNTA: ${plan.standalone}\nPERÍODO: ${periodLine}\n\nFUENTES:\n${evidence || "(sin fuentes: es una conversación general)"}` },
    ],
    maxTokens: 700,
    temperature: 0.2,
    timeoutMs: 45_000,
    privacy: authorization,
    audit: { clientId: input.ownerId, operation: "ask_answer", promptVersion: ASK_ANSWER_PROMPT_VERSION },
    onDelta: (text) => input.emit({ type: "delta", text }),
  });
  mark("answerMs", answerStarted);
  if (!result) {
    input.emit({ type: "error", code: "privacy_revoked", message: "La respuesta se descartó porque cambió tu configuración de privacidad." });
    return null;
  }
  // Figures must come from the evidence (calculations, movements, dates).
  const evidenceTexts = [...sources.map((source) => source.text), periodLine];
  const grounding = plan.intent === "chitchat" ? { status: "not_applicable" as const, unverified: [] } : checkNumericGrounding(result.content, evidenceTexts);
  return finish(result.content, "model", grounding);
}
