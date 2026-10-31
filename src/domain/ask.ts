import { z } from "zod";
import { FINANCIAL_CATEGORIES } from "./financial-categories.js";
import { CATEGORY_LABELS_ES } from "./category-labels.js";

/**
 * Ask (Explorar chat) domain logic. Everything here is deterministic and free
 * of I/O so the parts that decide answer accuracy (date windows, plan
 * sanitisation, rank fusion, citation and figure checks) are unit-testable.
 */

export const ASK_PLAN_PROMPT_VERSION = "ask-plan-v1";
export const ASK_ANSWER_PROMPT_VERSION = "ask-answer-v1";
export const DEFAULT_TIME_ZONE = "America/Montevideo";

// ---------------------------------------------------------------------------
// Time windows (always resolved in the user's time zone)
// ---------------------------------------------------------------------------

export type LocalDate = { year: number; month: number; day: number };

export type ResolvedPeriod = {
  fromDate: string; // YYYY-MM-DD inclusive, local
  toDate: string; // YYYY-MM-DD inclusive, local
  from: string; // ISO instant of local 00:00 on fromDate
  to: string; // ISO instant of local 23:59:59.999 on toDate
  label: string;
  source: "expression" | "model" | "default";
};

const MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function localDateIn(timeZone: string, instant = new Date()): LocalDate {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function offsetMinutes(timeZone: string, instant: Date) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(instant).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!match) return 0;
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

/** UTC instant of a local wall-clock time in `timeZone`. */
export function zonedInstant(date: LocalDate, timeZone: string, endOfDay = false) {
  const wall = Date.UTC(date.year, date.month - 1, date.day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  // Two passes handle offset changes (DST) around the target instant.
  let instant = wall - offsetMinutes(timeZone, new Date(wall)) * 60_000;
  instant = wall - offsetMinutes(timeZone, new Date(instant)) * 60_000;
  return new Date(instant).toISOString();
}

function addDays(date: LocalDate, days: number): LocalDate {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function formatLocalDate(date: LocalDate) {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export function parseLocalDate(value: string): LocalDate | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (date.month < 1 || date.month > 12 || date.day < 1 || date.day > lastDayOfMonth(date.year, date.month)) return null;
  return date;
}

function compareLocal(left: LocalDate, right: LocalDate) {
  return formatLocalDate(left).localeCompare(formatLocalDate(right));
}

export function buildPeriod(fromDate: LocalDate, toDate: LocalDate, label: string, timeZone: string, source: ResolvedPeriod["source"]): ResolvedPeriod {
  return {
    fromDate: formatLocalDate(fromDate),
    toDate: formatLocalDate(toDate),
    from: zonedInstant(fromDate, timeZone),
    to: zonedInstant(toDate, timeZone, true),
    label,
    source,
  };
}

function stripAccents(value: string) {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es");
}

const NUMBER_WORDS: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, doce: 12, quince: 15, treinta: 30, noventa: 90 };

/**
 * Deterministic Spanish relative-date resolution. LLMs regularly miscount
 * calendars, so when a recognised expression is present this window wins over
 * the model's dates. Returns null when no time expression is recognised.
 */
export function resolvePeriodExpression(text: string, timeZone = DEFAULT_TIME_ZONE, now = new Date()): ResolvedPeriod | null {
  const value = stripAccents(text);
  const today = localDateIn(timeZone, now);
  const make = (from: LocalDate, to: LocalDate, label: string) => buildPeriod(from, to, label, timeZone, "expression");
  const weekday = (new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay() + 6) % 7; // Monday = 0

  if (/\banteayer\b/.test(value)) { const day = addDays(today, -2); return make(day, day, "anteayer"); }
  if (/\bayer\b/.test(value)) { const day = addDays(today, -1); return make(day, day, "ayer"); }
  if (/\bhoy\b/.test(value)) return make(today, today, "hoy");

  const lastN = value.match(/\b(?:ultim[oa]s|pasad[oa]s)\s+(\d{1,3}|[a-z]+)\s+(dias|semanas|meses|anos)\b/);
  if (lastN) {
    const amount = Number(lastN[1]) || NUMBER_WORDS[lastN[1]!] || 0;
    if (amount > 0) {
      const unit = lastN[2]!;
      const days = unit === "dias" ? amount : unit === "semanas" ? amount * 7 : unit === "meses" ? amount * 30 : amount * 365;
      return make(addDays(today, -(Math.min(days, 3650) - 1)), today, `últimos ${amount} ${unit === "anos" ? "años" : unit === "dias" ? "días" : unit}`);
    }
  }
  if (/\b(?:el\s+)?ultimo\s+mes\b/.test(value)) return make(addDays(today, -29), today, "últimos 30 días");
  if (/\b(?:la\s+)?ultima\s+semana\b/.test(value)) return make(addDays(today, -6), today, "últimos 7 días");

  if (/\b(?:la\s+)?semana\s+pasada\b/.test(value)) {
    const start = addDays(today, -weekday - 7);
    return make(start, addDays(start, 6), "la semana pasada");
  }
  if (/\besta\s+semana\b/.test(value)) return make(addDays(today, -weekday), today, "esta semana");

  if (/\b(?:el\s+)?mes\s+pasado\b/.test(value)) {
    const month = today.month === 1 ? 12 : today.month - 1;
    const year = today.month === 1 ? today.year - 1 : today.year;
    return make({ year, month, day: 1 }, { year, month, day: lastDayOfMonth(year, month) }, `${MONTHS_ES[month - 1]} ${year}`);
  }
  if (/\beste\s+mes\b/.test(value)) return make({ ...today, day: 1 }, today, `${MONTHS_ES[today.month - 1]} ${today.year} (hasta hoy)`);

  if (/\b(?:el\s+)?ano\s+pasado\b/.test(value)) {
    const year = today.year - 1;
    return make({ year, month: 1, day: 1 }, { year, month: 12, day: 31 }, `${year}`);
  }
  if (/\beste\s+ano\b/.test(value)) return make({ year: today.year, month: 1, day: 1 }, today, `${today.year} (hasta hoy)`);

  // Named month, optionally with a year: "en octubre", "octubre 2025", "octubre del ano pasado".
  const monthMatch = value.match(new RegExp(`\\b(${MONTHS_ES.map(stripAccents).join("|")}|setiembre)\\b(?:\\s+(?:de|del)?\\s*(\\d{4}|ano\\s+pasado))?`));
  if (monthMatch) {
    const name = monthMatch[1] === "setiembre" ? "septiembre" : monthMatch[1]!;
    const month = MONTHS_ES.indexOf(name) + 1;
    let year = monthMatch[2] && /^\d{4}$/.test(monthMatch[2]) ? Number(monthMatch[2]) : today.year;
    if (monthMatch[2]?.startsWith("ano")) year = today.year - 1;
    // A month later than the current one without an explicit year means last year.
    if (!monthMatch[2] && month > today.month) year -= 1;
    const end = { year, month, day: lastDayOfMonth(year, month) };
    const to = compareLocal(end, today) > 0 ? today : end;
    return make({ year, month, day: 1 }, to, `${name} ${year}${to === today && compareLocal(end, today) > 0 ? " (hasta hoy)" : ""}`);
  }
  return null;
}

/** Previous window of equal length, ending the day before `period` starts. */
export function previousPeriod(period: ResolvedPeriod, timeZone = DEFAULT_TIME_ZONE): ResolvedPeriod {
  const from = parseLocalDate(period.fromDate)!;
  const to = parseLocalDate(period.toDate)!;
  // Whole calendar months compare against the previous whole month(s).
  const wholeMonth = from.day === 1 && (to.day === lastDayOfMonth(to.year, to.month));
  if (wholeMonth && from.year === to.year && from.month === to.month) {
    const month = from.month === 1 ? 12 : from.month - 1;
    const year = from.month === 1 ? from.year - 1 : from.year;
    return buildPeriod({ year, month, day: 1 }, { year, month, day: lastDayOfMonth(year, month) }, `${MONTHS_ES[month - 1]} ${year}`, timeZone, "default");
  }
  // Month-to-date compares against the same days of the previous month.
  if (from.day === 1 && from.year === to.year && from.month === to.month) {
    const month = from.month === 1 ? 12 : from.month - 1;
    const year = from.month === 1 ? from.year - 1 : from.year;
    const day = Math.min(to.day, lastDayOfMonth(year, month));
    return buildPeriod({ year, month, day: 1 }, { year, month, day }, `${MONTHS_ES[month - 1]} ${year} (1–${day})`, timeZone, "default");
  }
  const days = Math.round((Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / 86_400_000) + 1;
  const end = addDays(from, -1);
  const start = addDays(end, -(days - 1));
  return buildPeriod(start, end, `${formatLocalDate(start)} a ${formatLocalDate(end)}`, timeZone, "default");
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export const financeGroupBySchema = z.enum(["category", "merchant", "account", "month", "week", "day"]);
export type FinanceGroupBy = z.infer<typeof financeGroupBySchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Shape the planner model must return. Unknown or invalid fields are dropped by sanitizePlan. */
export const modelPlanSchema = z.object({
  standalone: z.string().max(500).optional(),
  intent: z.enum(["finance", "knowledge", "mixed", "chitchat"]).optional(),
  period: z.object({ from: isoDate, to: isoDate }).nullable().optional(),
  finance: z.object({
    mode: z.enum(["total", "breakdown", "list"]).optional(),
    kind: z.enum(["expense", "income", "all"]).optional(),
    groupBy: financeGroupBySchema.nullable().optional(),
    categories: z.array(z.string().max(80)).max(8).optional(),
    merchants: z.array(z.string().max(80)).max(6).optional(),
    accountIds: z.array(z.string().max(120)).max(6).optional(),
    currency: z.enum(["UYU", "USD"]).nullable().optional(),
    compare: z.boolean().optional(),
    sort: z.enum(["amount", "date"]).optional(),
    limit: z.number().int().min(1).max(25).optional(),
  }).nullable().optional(),
  searchQueries: z.array(z.string().max(120)).max(5).optional(),
  entities: z.array(z.string().max(80)).max(5).optional(),
}).passthrough();

export type FinancePlan = {
  mode: "total" | "breakdown" | "list";
  kind: "expense" | "income" | "all";
  groupBy: FinanceGroupBy | null;
  categories: string[];
  merchants: string[];
  accountIds: string[];
  currency: "UYU" | "USD" | null;
  compare: boolean;
  sort: "amount" | "date";
  limit: number;
};

export type AskPlan = {
  standalone: string;
  intent: "finance" | "knowledge" | "mixed" | "chitchat";
  period: ResolvedPeriod | null;
  finance: FinancePlan | null;
  searchQueries: string[];
  entities: string[];
  plannedBy: "model" | "heuristic";
};

export type PlanContext = {
  timeZone: string;
  now: Date;
  /** Category keys the planner may use (canonical + the owner's custom categories). */
  categories: string[];
  accounts: Array<{ id: string; name: string }>;
};

export function canonicalCategories(custom: string[] = []) {
  return [...new Set([...FINANCIAL_CATEGORIES.expense, ...FINANCIAL_CATEGORIES.income, ...custom.filter(Boolean)])];
}

/** "Food / Delivery (Comida / Delivery)" style hints so the planner can map Spanish words to keys. */
export function categoryHints(keys: string[]) {
  return keys.map((key) => {
    const label = CATEGORY_LABELS_ES[key.toLowerCase()];
    return label && label !== key ? `${key} (${label})` : key;
  });
}

const FINANCE_PATTERN = /\b(gast\w*|pag\w*|compr\w*|cobr\w*|ingres\w*|sueldo|plata|dinero|cuanto|suscripci\w*|factur\w*|transfer\w*|deb\w*|cuenta[s]?|presupuesto|ahorr\w*|uyu|usd|dolares|pesos|caro|barato)\b/;
const BREAKDOWN_PATTERN = /\b(en que|por categoria|categorias|desglos\w*|reparti\w*|distribu\w*|mas gast\w*|donde gast\w*|por comercio|comercios|por cuenta)\b/;
const LIST_PATTERN = /\b(ultim[oa]s?|lista\w*|cuales|movimientos|transacciones|compras de|mayores|mas grandes|mas car[oa]s)\b/;
const COMPARE_PATTERN = /\b(compar\w*|vs|versus|respecto|frente al?|mas que|menos que|aument\w*|baj[oó]\w*|subi\w*|diferencia)\b/;

const STOPWORDS = new Set("a al algo algun alguna como con cual cuales cuando cuanto cuanta cuantos cuantas de del desde donde el ella ellas ellos en entre era es esa ese eso esta este esto estos fue ha han hay hice la las le les lo los mas me mi mis muy no nos o para pero por que quien se sea segun ser si sin sobre son su sus tambien te tengo tiene tu tus un una uno unos unas y ya yo hoy ayer semana mes ano pasado pasada este esta ultimo ultima ultimos ultimas dias gaste gastado gasto gastos pague pago pagos dime decime muestrame cuentame sabes".split(" "));

export function keywordQuery(text: string) {
  return stripAccents(text)
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((token) => token.length > 2 && !STOPWORDS.has(token))
    .slice(0, 8)
    .join(" ") ?? "";
}

/** Fallback when the planner model is unavailable or returns unusable JSON. */
export function heuristicPlan(question: string, context: PlanContext): AskPlan {
  const value = stripAccents(question);
  const finance = FINANCE_PATTERN.test(value);
  const period = resolvePeriodExpression(question, context.timeZone, context.now);
  const kind: FinancePlan["kind"] = /\b(ingres\w*|cobr\w*|sueldo|gane|ganado|recib\w*)\b/.test(value) ? "income" : "expense";
  const categories = context.categories.filter((key) => {
    const label = stripAccents(CATEGORY_LABELS_ES[key.toLowerCase()] ?? key);
    return label.split(/[\s/]+/).some((word) => word.length > 3 && value.includes(word));
  });
  const keywords = keywordQuery(question);
  return {
    standalone: question.trim(),
    intent: finance ? "finance" : "knowledge",
    period,
    finance: finance ? {
      mode: BREAKDOWN_PATTERN.test(value) ? "breakdown" : LIST_PATTERN.test(value) ? "list" : "total",
      kind,
      groupBy: BREAKDOWN_PATTERN.test(value) ? (/\bcomercio|donde\b/.test(value) ? "merchant" : /\bcuenta\b/.test(value) ? "account" : "category") : null,
      categories,
      merchants: [],
      accountIds: [],
      currency: /\b(usd|dolares)\b/.test(value) ? "USD" : null,
      compare: COMPARE_PATTERN.test(value),
      sort: /\b(mayores|mas grandes|mas car[oa]s)\b/.test(value) ? "amount" : "date",
      limit: 8,
    } : null,
    searchQueries: keywords ? [keywords] : [],
    entities: [],
    plannedBy: "heuristic",
  };
}

const MAX_PERIOD_DAYS = 3660;

/**
 * Turns an untrusted model plan into an executable one: categories and
 * accounts must exist, dates must parse and lie in the past, and a recognised
 * relative-date expression overrides the model's arithmetic.
 */
export function sanitizePlan(raw: unknown, question: string, context: PlanContext): AskPlan {
  const fallback = heuristicPlan(question, context);
  const parsed = modelPlanSchema.safeParse(raw);
  if (!parsed.success) return fallback;
  const plan = parsed.data;
  const standalone = plan.standalone?.trim() || question.trim();
  const today = localDateIn(context.timeZone, context.now);

  let period: ResolvedPeriod | null = resolvePeriodExpression(standalone, context.timeZone, context.now)
    ?? resolvePeriodExpression(question, context.timeZone, context.now);
  if (!period && plan.period) {
    const from = parseLocalDate(plan.period.from);
    let to = parseLocalDate(plan.period.to);
    if (from && to) {
      if (compareLocal(to, today) > 0) to = today;
      const span = (Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / 86_400_000;
      if (compareLocal(from, to) <= 0 && span <= MAX_PERIOD_DAYS) {
        period = buildPeriod(from, to, `${formatLocalDate(from)} a ${formatLocalDate(to)}`, context.timeZone, "model");
      }
    }
  }

  const categoryByLower = new Map(context.categories.map((key) => [key.toLowerCase(), key]));
  const accountIds = new Set(context.accounts.map((account) => account.id));
  const intent = plan.intent ?? fallback.intent;
  const financeRaw = plan.finance;
  const financeWanted = intent === "finance" || intent === "mixed";
  const finance: FinancePlan | null = financeWanted ? {
    mode: financeRaw?.mode ?? fallback.finance?.mode ?? "total",
    kind: financeRaw?.kind ?? fallback.finance?.kind ?? "expense",
    groupBy: financeRaw?.groupBy ?? (financeRaw?.mode === "breakdown" ? "category" : fallback.finance?.groupBy ?? null),
    categories: [...new Set((financeRaw?.categories ?? []).map((value) => categoryByLower.get(value.trim().toLowerCase())).filter((value): value is string => Boolean(value)))],
    merchants: [...new Set((financeRaw?.merchants ?? []).map((value) => value.trim()).filter((value) => value.length >= 2))].slice(0, 6),
    accountIds: (financeRaw?.accountIds ?? []).filter((id) => accountIds.has(id)),
    currency: financeRaw?.currency ?? null,
    compare: financeRaw?.compare ?? fallback.finance?.compare ?? false,
    sort: financeRaw?.sort ?? fallback.finance?.sort ?? "date",
    limit: financeRaw?.limit ?? 8,
  } : null;
  if (finance?.mode === "breakdown" && !finance.groupBy) finance.groupBy = "category";

  const searchQueries = [...new Set([
    ...(plan.searchQueries ?? []).map((value) => value.trim()).filter(Boolean),
    keywordQuery(standalone),
  ].filter(Boolean))].slice(0, 4);

  return {
    standalone,
    intent,
    period,
    finance,
    searchQueries,
    entities: [...new Set((plan.entities ?? []).map((value) => value.trim()).filter((value) => value.length >= 2))].slice(0, 5),
    plannedBy: "model",
  };
}

/** Finance questions without a time expression get an explicit, stated default window. */
export function defaultFinancePeriod(plan: AskPlan, timeZone: string, now: Date): ResolvedPeriod | null {
  if (plan.period || !plan.finance) return plan.period;
  if (plan.finance.mode === "list") return null; // "my last purchase at X" has no natural window
  const today = localDateIn(timeZone, now);
  return { ...buildPeriod(addDays(today, -89), today, "últimos 90 días", timeZone, "default") };
}

export function planPrompt(context: PlanContext) {
  const today = localDateIn(context.timeZone, context.now);
  return `Eres el planificador de búsqueda de BrainIA, una app personal de finanzas y conocimiento.
No respondes la pregunta: devuelves SOLO un JSON que describe qué datos recuperar.
Hoy es ${formatLocalDate(today)} (zona ${context.timeZone}). Las semanas empiezan el lunes.

Esquema:
{"standalone":"pregunta reescrita autocontenida (resuelve 'eso', 'y el mes anterior?' usando el historial)",
 "intent":"finance|knowledge|mixed|chitchat",
 "period":{"from":"YYYY-MM-DD","to":"YYYY-MM-DD"} o null,
 "finance":{"mode":"total|breakdown|list","kind":"expense|income|all","groupBy":"category|merchant|account|month|week|day" o null,
   "categories":[claves exactas de la lista],"merchants":["nombre de comercio tal como lo diría el usuario"],
   "accountIds":[ids exactos de la lista],"currency":"UYU|USD" o null,"compare":bool,"sort":"amount|date","limit":1-25} o null,
 "searchQueries":["2 a 4 consultas cortas en español con sinónimos y nombres propios útiles para búsqueda semántica"],
 "entities":["personas, comercios, proyectos o temas nombrados"]}

Reglas:
- finance: montos, gastos, ingresos, totales, comercios, categorías, cuentas. knowledge: notas, correos, personas, temas, qué pasó. mixed: ambos.
- breakdown cuando pregunta "en qué", "dónde", "por categoría"; list para "últimas compras", "mayores gastos"; total para "cuánto".
- compare=true si pide comparar con otro período o si subió/bajó.
- Usa solo claves de categoría de la lista. Si nombra un comercio, ponlo en merchants y NO inventes categoría.
- No inventes fechas si la pregunta no indica período: usa null.
- Categorías: ${categoryHints(context.categories).join("; ")}
- Cuentas: ${context.accounts.length ? context.accounts.map((account) => `${account.id}=${account.name}`).join("; ") : "(ninguna)"}`;
}

// ---------------------------------------------------------------------------
// Retrieval fusion
// ---------------------------------------------------------------------------

/**
 * Reciprocal rank fusion. Full-text rank and cosine similarity live on
 * incomparable scales; fusing ranks instead of raw scores is robust and needs
 * no per-corpus calibration.
 */
export function reciprocalRankFusion<T extends string>(lists: T[][], k = 60) {
  const scores = new Map<T, number>();
  for (const list of lists) {
    list.forEach((key, index) => scores.set(key, (scores.get(key) ?? 0) + 1 / (k + index + 1)));
  }
  return [...scores.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

/** Prefix OR query for to_tsquery('simple', ...): tolerant of word forms and of missing accents. */
export function buildOrTsQuery(queries: string[]) {
  const tokens = new Set<string>();
  for (const query of queries) {
    for (const token of query.toLocaleLowerCase("es").match(/[\p{L}\p{N}]+/gu) ?? []) {
      const plain = stripAccents(token);
      if (plain.length < 3 || STOPWORDS.has(plain)) continue;
      for (const variant of new Set([token, plain])) {
        if (!/^[\p{L}\p{N}]+$/u.test(variant)) continue;
        tokens.add(variant.length >= 4 ? `${variant}:*` : variant);
      }
    }
  }
  return [...tokens].slice(0, 24).join(" | ");
}

// ---------------------------------------------------------------------------
// Answer validation
// ---------------------------------------------------------------------------

/** Canonical numeric keys ("45320.5" → "45320.50") for a localized number token. */
function numericKey(token: string): string | null {
  let value = token.replace(/\s/g, "");
  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    value = lastComma > lastDot ? value.replace(/\./g, "").replace(",", ".") : value.replace(/,/g, "");
  } else if (lastComma > -1) {
    value = /,\d{3}$/.test(value) && !/,\d{3},/.test(value) && value.split(",").length === 2 && value.length > 5
      ? value.replace(/,/g, "") : value.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > -1 && /^\d{1,3}(\.\d{3})+$/.test(value)) {
    value = value.replace(/\./g, "");
  }
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : null;
}

const NUMBER_TOKEN = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/g;

export function extractNumberKeys(text: string) {
  const keys = new Set<string>();
  for (const token of text.match(NUMBER_TOKEN) ?? []) {
    const key = numericKey(token);
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * Every material figure in the answer must appear in the evidence. Small
 * counts (≤ 31) and calendar years are ignored; they are usually ordinals,
 * days or dates, and dates are separately anchored by the sources.
 */
export function checkNumericGrounding(answer: string, evidenceTexts: string[]) {
  const evidence = new Set<string>();
  for (const text of evidenceTexts) for (const key of extractNumberKeys(text)) evidence.add(key);
  const withoutCitations = answer.replace(/\[S\d+\]/g, " ");
  const unverified: string[] = [];
  for (const match of withoutCitations.matchAll(new RegExp(`(${NUMBER_TOKEN.source})(\\s*%)?`, "g"))) {
    const token = match[1]!;
    const isPercent = Boolean(match[2]);
    const key = numericKey(token);
    if (!key) continue;
    const value = Number(key);
    // Percentages are always derived figures, so they are checked whatever their size.
    const isSmallInteger = !isPercent && Number.isInteger(value) && value <= 31;
    const isYear = !isPercent && Number.isInteger(value) && value >= 1990 && value <= 2100 && /^\d{4}$/.test(token);
    if (isSmallInteger || isYear) continue;
    if (!evidence.has(key)) unverified.push(isPercent ? `${token}%` : token);
  }
  return { status: unverified.length ? "unverified" as const : "verified" as const, unverified: [...new Set(unverified)].slice(0, 10) };
}

/** Normalises "[S1, S3]" / "[S1][S2]" and drops references to sources that do not exist. */
export function sanitizeCitations(answer: string, sourceCount: number) {
  const used = new Set<number>();
  const text = answer
    .replace(/\[\s*S\d+(?:\s*[,;]\s*S?\d+)*\s*\]/gi, (group) => {
      const ids = [...group.matchAll(/\d+/g)].map((match) => Number(match[0]));
      const valid = ids.filter((id) => id >= 1 && id <= sourceCount);
      valid.forEach((id) => used.add(id));
      return valid.map((id) => `[S${id}]`).join("");
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/ {2,}/g, " ");
  return { text: text.trim(), citations: [...used].sort((a, b) => a - b) };
}

export function answerSystemPrompt(input: { today: string; timeZone: string }) {
  return `Eres BrainIA, el asistente del segundo cerebro personal del usuario. Respondes en español neutro, tratando al usuario de "tú".
Hoy es ${input.today} (${input.timeZone}).

Usa SOLO las FUENTES del mensaje. No uses conocimiento externo sobre la vida del usuario.
Reglas de exactitud:
1. Empieza con la respuesta directa en la primera frase (el número, el nombre o el sí/no).
2. Cada afirmación basada en datos termina con su cita, por ejemplo [S1] o [S2][S4]. Nunca cites una fuente que no existe.
3. Montos: copia las cifras EXACTAS de las fuentes de tipo CÁLCULO, con su moneda. No sumes, restes ni conviertas monedas tú mismo; si una cifra no está calculada en las fuentes, no la inventes. Nunca mezcles UYU y USD en un mismo total.
4. Menciona el período exacto usado. Si el período fue elegido por defecto, dilo ("en los últimos 90 días").
5. Las fuentes solo cubren lo que BrainIA capturó. Si la cobertura es parcial o hay movimientos excluidos, dilo en una frase corta.
6. Si las fuentes no alcanzan para responder, dilo claramente y sugiere qué dato falta. No especules.
7. Sé breve: hasta 110 palabras salvo que pidan detalle. Para varios elementos usa una lista corta (máximo 5 viñetas con "- ").
8. No uses títulos, tablas ni negritas. No repitas la pregunta.`;
}
