import {
  buildOrTsQuery,
  canonicalCategories,
  previousPeriod,
  reciprocalRankFusion,
  type AskPlan,
  type FinancePlan,
  type ResolvedPeriod,
} from "../domain/ask.js";
import { categoryLabelEs, entityTypeLabelEs, eventKindLabelEs, KIND_LABELS_ES } from "../domain/category-labels.js";
import { quantizeDecimal, subtractDecimal } from "../domain/money.js";
import { nearestEmbeddings } from "./embeddings.js";
import { REPORTABLE_TRANSACTION_FILTERS, summaryScopeFilters } from "./financial-transaction-repository.js";
import type { Queryable } from "./postgres.js";
import { listDeniedEgressSources } from "./privacy.js";

/**
 * Retrieval tools for the Ask (Explorar) chat. Each tool returns
 *  - sources: compact, model-facing evidence with deep links for the app, and
 *  - cards: deterministic structured data the app renders directly.
 * Numbers in cards and calculation sources come from SQL over canonical rows,
 * never from the model.
 */

export type AskSourceKind = "calculation" | "transaction" | "event" | "entity";

export type AskSource = {
  kind: AskSourceKind;
  title: string;
  subtitle: string | null;
  date: string | null;
  /** Model-facing text. Redaction is applied to the full prompt at dispatch. */
  text: string;
  route: { pathname: string; params: Record<string, string> } | null;
  eventIds: string[];
  sourceNames: string[];
  amount: { value: string; currency: string; kind: string } | null;
  score: number;
};

export type AskCard =
  | {
      type: "totals";
      period: { label: string; fromDate: string; toDate: string };
      kind: FinancePlan["kind"];
      filtersLabel: string | null;
      rows: Array<{
        currency: string; expense: string; income: string; net: string; count: number;
        previous: { label: string; expense: string; income: string; count: number } | null;
        changePct: number | null;
      }>;
      excludedCount: number;
    }
  | {
      type: "breakdown";
      groupBy: string;
      period: { label: string; fromDate: string; toDate: string };
      kind: FinancePlan["kind"];
      currency: string;
      total: string;
      items: Array<{ label: string; amount: string; share: number; count: number }>;
    }
  | {
      type: "transactions";
      title: string;
      items: Array<{
        id: string; title: string; amount: string; currency: string; kind: string;
        date: string; category: string; account: string | null;
      }>;
    };

export type AskContextData = {
  categories: string[];
  accounts: Array<{ id: string; name: string }>;
  deniedSources: string[];
};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** "45320.5" → "45.320,50" without floating point. */
export function formatAmountEs(value: string) {
  const fixed = quantizeDecimal(value, 2);
  const negative = fixed.startsWith("-");
  const [integer, fraction = "00"] = fixed.replace("-", "").split(".");
  const grouped = integer!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped},${fraction.padEnd(2, "0").slice(0, 2)}`;
}

function percentChange(current: string, previous: string) {
  const prev = Number(previous);
  const cur = Number(current);
  if (!Number.isFinite(prev) || !Number.isFinite(cur) || prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

function formatPercentEs(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1).replace(".", ",")}%`;
}

function formatDateEs(isoDate: string) {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

// ---------------------------------------------------------------------------
// Context for the planner
// ---------------------------------------------------------------------------

export async function loadAskContext(db: Queryable, ownerId: string | null): Promise<AskContextData> {
  const [custom, accounts, deniedSources] = await Promise.all([
    db.query<{ name: string }>(
      "select name from financial_custom_categories where client_scope = $1 order by created_at limit 40",
      [ownerId ?? "anonymous"],
    ),
    db.query<{ id: string; name: string }>(`
      select a.id, coalesce(a.name, a.mask, a.id) as name from financial_accounts a
      where ($1::text is null or a.owner_id = $1 or a.owner_id is null)
      order by a.name limit 30
    `, [ownerId]).catch(() => ({ rows: [] as Array<{ id: string; name: string }> })),
    ownerId ? listDeniedEgressSources(db, ownerId) : Promise.resolve([] as string[]),
  ]);
  return { categories: canonicalCategories(custom.rows.map((row) => row.name)), accounts: accounts.rows, deniedSources };
}

// ---------------------------------------------------------------------------
// Finance tool
// ---------------------------------------------------------------------------

type SqlBuilder = { params: unknown[]; p: (value: unknown) => string };
function sqlBuilder(): SqlBuilder {
  const params: unknown[] = [];
  return { params, p: (value) => { params.push(value); return `$${params.length}`; } };
}

const FINANCE_FROM = `
  from financial_transactions t
  left join financial_accounts a on a.id = t.account_id
  left join entity_merges merchant_merge on merchant_merge.alias_entity_id = t.merchant_entity_id
  left join entities merchant on merchant.id = coalesce(merchant_merge.canonical_entity_id, t.merchant_entity_id)
  left join classified_events anchor_classified on anchor_classified.raw_event_id = t.anchor_event_id
  left join raw_events anchor on anchor.id = t.anchor_event_id`;

function stripAccents(value: string) {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es");
}

/**
 * Filters shared by every finance query in one answer. The owner/date scope is
 * the Money tab's own helper; privacy excludes rows whose anchor evidence may
 * not be sent to a model under the owner's source policies.
 */
function financeFilters(builder: SqlBuilder, input: {
  ownerId: string | null; period: ResolvedPeriod | null; finance: FinancePlan; deniedSources: string[];
}) {
  const filters: string[] = [];
  const scopeParams: unknown[] = [];
  const scope = summaryScopeFilters({
    from: input.period?.from ?? "-infinity",
    to: input.period?.to ?? "infinity",
    ownerId: input.ownerId ?? undefined,
  }, scopeParams);
  // Re-number the helper's placeholders into this builder.
  const offset = builder.params.length;
  builder.params.push(...scopeParams);
  filters.push(...scope.map((clause) => clause.replace(/\$(\d+)/g, (_match, index) => `$${Number(index) + offset}`)));

  if (input.finance.kind !== "all") filters.push(`t.kind = ${builder.p(input.finance.kind)}`);
  if (input.finance.categories.length) filters.push(`t.category = any(${builder.p(input.finance.categories)}::text[])`);
  if (input.finance.accountIds.length) filters.push(`t.account_id = any(${builder.p(input.finance.accountIds)}::text[])`);
  if (input.finance.currency) filters.push(`upper(t.currency) = ${builder.p(input.finance.currency)}`);
  if (input.finance.merchants.length) {
    const terms = [...new Set(input.finance.merchants.flatMap((merchant) => [merchant.toLocaleLowerCase("es"), stripAccents(merchant)]))];
    filters.push(`exists (
      select 1 from unnest(${builder.p(terms)}::text[]) term
      where lower(concat_ws(' ', t.merchant_label, t.normalized_merchant, t.title_override, merchant.value,
        anchor_classified.display_title,
        (select string_agg(alias.alias, ' ') from entity_aliases alias where alias.entity_id = merchant.id)))
        like '%' || term || '%'
    )`);
  }
  filters.push(`(t.anchor_event_id is null or (anchor.privacy_status = 'standard' and anchor.processing_allowed
    and not (lower(anchor.source) = any(${builder.p(input.deniedSources)}::text[]))))`);
  return filters;
}

function filtersLabel(finance: FinancePlan, accounts: AskContextData["accounts"]) {
  const parts = [
    finance.merchants.length ? `comercio: ${finance.merchants.join(", ")}` : null,
    finance.categories.length ? `categoría: ${finance.categories.map(categoryLabelEs).join(", ")}` : null,
    finance.accountIds.length ? `cuenta: ${finance.accountIds.map((id) => accounts.find((account) => account.id === id)?.name ?? id).join(", ")}` : null,
    finance.currency ? `moneda: ${finance.currency}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

async function financeTotals(db: Queryable, input: {
  ownerId: string | null; period: ResolvedPeriod | null; finance: FinancePlan; deniedSources: string[];
}) {
  const builder = sqlBuilder();
  const filters = [...REPORTABLE_TRANSACTION_FILTERS, ...financeFilters(builder, input)];
  const result = await db.query<{ currency: string; income: string; expense: string; count: number }>(`
    select upper(t.currency) as currency,
      coalesce(sum(case when t.kind = 'income' then t.amount else 0 end), 0)::text as income,
      coalesce(sum(case when t.kind = 'expense' then t.amount else 0 end), 0)::text as expense,
      count(*)::int as count
    ${FINANCE_FROM}
    where ${filters.join(" and ")}
    group by upper(t.currency) order by upper(t.currency)
  `, builder.params);
  return result.rows;
}

/** Rows in scope that the Money totals also leave out (unconfirmed amount or currency). */
async function financeExcludedCount(db: Queryable, input: Parameters<typeof financeTotals>[1]) {
  const builder = sqlBuilder();
  const base = ["t.hidden_at is null", "t.excluded_from_reports = false", "t.kind <> 'transfer'", ...financeFilters(builder, input)];
  const result = await db.query<{ count: number }>(`
    select count(*)::int as count ${FINANCE_FROM}
    where ${base.join(" and ")} and not (${REPORTABLE_TRANSACTION_FILTERS.join(" and ")})
  `, builder.params);
  return result.rows[0]?.count ?? 0;
}

async function financeBreakdown(db: Queryable, input: Parameters<typeof financeTotals>[1] & { timeZone: string }) {
  const builder = sqlBuilder();
  const filters = [...REPORTABLE_TRANSACTION_FILTERS, ...financeFilters(builder, input)];
  // Only bind the time zone when the grouping uses it: an unused bind
  // parameter is a protocol error in Postgres.
  const groupBy = input.finance.groupBy ?? "category";
  const local = () => `t.observed_at at time zone ${builder.p(input.timeZone)}`;
  const groupExpression = groupBy === "category" ? "coalesce(nullif(t.category, ''), 'Uncategorized')"
    : groupBy === "merchant" ? "coalesce(merchant.value, t.title_override, t.merchant_label)"
    : groupBy === "account" ? "coalesce(a.name, a.mask, 'Sin cuenta')"
    : groupBy === "month" ? `to_char(date_trunc('month', ${local()}), 'YYYY-MM')`
    : groupBy === "week" ? `to_char(date_trunc('week', ${local()}), 'YYYY-MM-DD')`
    : `to_char(${local()}, 'YYYY-MM-DD')`;
  const chronological = ["month", "week", "day"].includes(input.finance.groupBy ?? "");
  const amountExpression = input.finance.kind === "income"
    ? "case when t.kind = 'income' then t.amount else 0 end"
    : "case when t.kind = 'expense' then t.amount else 0 end";
  const result = await db.query<{ currency: string; label: string; amount: string; count: number; total: string; rank: number }>(`
    with grouped as (
      select upper(t.currency) as currency, ${groupExpression} as label,
        sum(${amountExpression}) as amount, count(*)::int as count
      ${FINANCE_FROM}
      where ${filters.join(" and ")}
      group by 1, 2
    ), ranked as (
      select currency, label, amount, count,
        sum(amount) over (partition by currency) as total,
        row_number() over (partition by currency order by ${chronological ? "label asc" : "amount desc, label asc"}) as rank
      from grouped where amount > 0
    )
    select currency, label, amount::text as amount, count, total::text as total, rank::int as rank
    from ranked where rank <= ${chronological ? 36 : 8}
    order by currency, rank
  `, builder.params);
  return result.rows;
}

async function financeList(db: Queryable, input: Parameters<typeof financeTotals>[1] & { timeZone: string }) {
  const builder = sqlBuilder();
  // Lists show what the user would see in Money, including rows still awaiting
  // currency confirmation, but never hidden, merged or transfer-only noise.
  const filters = ["t.hidden_at is null", "t.kind <> 'transfer'", ...financeFilters(builder, input)];
  const order = input.finance.sort === "amount" ? "t.amount desc, t.observed_at desc" : "t.observed_at desc, t.created_at desc";
  const tz = builder.p(input.timeZone);
  const result = await db.query<{
    id: string; title: string; amount: string; currency: string; currencyConfirmed: boolean; kind: string;
    date: string; category: string | null; account: string | null; anchorEventId: string | null; source: string | null;
  }>(`
    select t.id, coalesce(t.title_override, anchor_classified.display_title, merchant.value, t.merchant_label) as title,
      t.amount::text as amount, upper(t.currency) as currency,
      (t.currency_status in ('explicit', 'account_confirmed', 'user_confirmed') and t.amount_confirmed) as "currencyConfirmed",
      t.kind, to_char(t.observed_at at time zone ${tz}, 'YYYY-MM-DD') as date, t.category,
      coalesce(a.name, a.mask) as account, t.anchor_event_id as "anchorEventId", anchor.source
    ${FINANCE_FROM}
    where ${filters.join(" and ")}
    order by ${order}
    limit ${builder.p(input.finance.limit)}
  `, builder.params);
  return result.rows;
}

export async function retrieveFinance(db: Queryable, input: {
  ownerId: string | null; plan: AskPlan; period: ResolvedPeriod | null; context: AskContextData; timeZone: string;
}): Promise<{ sources: AskSource[]; cards: AskCard[] }> {
  const finance = input.plan.finance;
  if (!finance) return { sources: [], cards: [] };
  const base = { ownerId: input.ownerId, finance, deniedSources: input.context.deniedSources };
  const sources: AskSource[] = [];
  const cards: AskCard[] = [];
  const scopeText = filtersLabel(finance, input.context.accounts);
  const periodText = input.period
    ? `${input.period.label} (${formatDateEs(input.period.fromDate)} a ${formatDateEs(input.period.toDate)}, hora de Uruguay)`
    : "todo el historial";

  if (input.period) {
    const [current, excludedCount] = await Promise.all([
      financeTotals(db, { ...base, period: input.period }),
      financeExcludedCount(db, { ...base, period: input.period }),
    ]);
    const previous = finance.compare ? previousPeriod(input.period, input.timeZone) : null;
    const prior = previous ? await financeTotals(db, { ...base, period: previous }) : [];
    // The busiest currency leads (it is shown as the headline figure).
    const activity = new Map(current.map((row) => [row.currency, row.count]));
    const currencies = [...new Set([...current.map((row) => row.currency), ...prior.map((row) => row.currency)])]
      .sort((left, right) => (activity.get(right) ?? 0) - (activity.get(left) ?? 0) || left.localeCompare(right));
    const rows = currencies.map((currency) => {
      const now = current.find((row) => row.currency === currency) ?? { currency, income: "0", expense: "0", count: 0 };
      const before = prior.find((row) => row.currency === currency);
      const focus = finance.kind === "income" ? "income" : "expense";
      return {
        currency,
        expense: quantizeDecimal(now.expense, 2),
        income: quantizeDecimal(now.income, 2),
        net: quantizeDecimal(subtractDecimal(now.income, now.expense), 2),
        count: now.count,
        previous: previous && before ? {
          label: previous.label, expense: quantizeDecimal(before.expense, 2), income: quantizeDecimal(before.income, 2), count: before.count,
        } : previous ? { label: previous.label, expense: "0.00", income: "0.00", count: 0 } : null,
        changePct: previous ? percentChange(now[focus], before?.[focus] ?? "0") : null,
      };
    });
    cards.push({
      type: "totals",
      period: { label: input.period.label, fromDate: input.period.fromDate, toDate: input.period.toDate },
      kind: finance.kind, filtersLabel: scopeText, rows, excludedCount,
    });
    const lines = rows.length ? rows.map((row) => {
      const parts = [
        finance.kind !== "income" ? `gastos ${row.currency} ${formatAmountEs(row.expense)}` : null,
        finance.kind !== "expense" ? `ingresos ${row.currency} ${formatAmountEs(row.income)}` : null,
        finance.kind === "all" ? `neto ${row.currency} ${formatAmountEs(row.net)}` : null,
        `${row.count} movimientos`,
      ].filter(Boolean).join(", ");
      const comparison = row.previous
        ? `; período anterior (${row.previous.label}): ${finance.kind === "income" ? `ingresos ${row.currency} ${formatAmountEs(row.previous.income)}` : `gastos ${row.currency} ${formatAmountEs(row.previous.expense)}`}, ${row.previous.count} movimientos${row.changePct !== null ? `; variación ${formatPercentEs(row.changePct)}` : ""}`
        : "";
      return `- ${row.currency}: ${parts}${comparison}`;
    }).join("\n") : "- No hay movimientos confirmados que cumplan los filtros.";
    sources.push({
      kind: "calculation",
      title: `Totales · ${input.period.label}`,
      subtitle: scopeText,
      date: input.period.toDate,
      text: `CÁLCULO EXACTO sobre movimientos confirmados (mismo criterio que la pestaña Dinero; transferencias excluidas; monedas nunca se mezclan).
Período: ${periodText}${scopeText ? `\nFiltros: ${scopeText}` : ""}
${lines}${excludedCount ? `\nNo incluidos: ${excludedCount} movimientos con monto o moneda sin confirmar.` : ""}`,
      route: null, eventIds: [], sourceNames: [], amount: null, score: 1,
    });

    if (finance.mode === "breakdown" || finance.groupBy) {
      const groupBy = finance.groupBy ?? "category";
      const breakdown = await financeBreakdown(db, { ...base, period: input.period, timeZone: input.timeZone });
      const byCurrency = new Map<string, typeof breakdown>();
      for (const row of breakdown) byCurrency.set(row.currency, [...(byCurrency.get(row.currency) ?? []), row]);
      for (const [currency, items] of byCurrency) {
        const total = items[0]?.total ?? "0";
        const labelled = items.map((item) => ({
          label: groupBy === "category" ? categoryLabelEs(item.label) : item.label,
          amount: quantizeDecimal(item.amount, 2),
          share: Number(total) > 0 ? Math.round((Number(item.amount) / Number(total)) * 1000) / 10 : 0,
          count: item.count,
        }));
        cards.push({
          type: "breakdown", groupBy, currency, total: quantizeDecimal(total, 2), kind: finance.kind,
          period: { label: input.period.label, fromDate: input.period.fromDate, toDate: input.period.toDate },
          items: labelled,
        });
        const groupName = { category: "categoría", merchant: "comercio", account: "cuenta", month: "mes", week: "semana", day: "día" }[groupBy];
        sources.push({
          kind: "calculation",
          title: `Por ${groupName} · ${currency}`,
          subtitle: input.period.label,
          date: input.period.toDate,
          text: `CÁLCULO EXACTO: ${finance.kind === "income" ? "ingresos" : "gastos"} en ${currency} por ${groupName}, ${periodText}. Total ${currency} ${formatAmountEs(total)}.
${labelled.map((item) => `- ${item.label}: ${currency} ${formatAmountEs(item.amount)} (${String(item.share).replace(".", ",")}%, ${item.count} movimientos)`).join("\n")}`,
          route: null, eventIds: [], sourceNames: [], amount: null, score: 0.95,
        });
      }
    }
  }

  // Individual movements: always for list questions, and as concrete examples
  // for merchant/category questions so the answer can point at real rows.
  if (finance.mode === "list" || finance.merchants.length || finance.categories.length) {
    const list = await financeList(db, { ...base, period: input.period, timeZone: input.timeZone, finance: { ...finance, limit: finance.mode === "list" ? finance.limit : 5 } });
    if (list.length) {
      cards.push({
        type: "transactions",
        title: finance.sort === "amount" ? "Mayores movimientos" : "Movimientos",
        items: list.map((row) => ({
          id: row.id, title: row.title, amount: quantizeDecimal(row.amount, 2), currency: row.currency,
          kind: row.kind, date: row.date, category: categoryLabelEs(row.category), account: row.account,
        })),
      });
    }
    for (const row of list) {
      sources.push({
        kind: "transaction",
        title: row.title,
        subtitle: [categoryLabelEs(row.category), row.account].filter(Boolean).join(" · "),
        date: row.date,
        text: `MOVIMIENTO ${formatDateEs(row.date)}: ${KIND_LABELS_ES[row.kind] ?? row.kind} de ${row.currency} ${formatAmountEs(row.amount)} en "${row.title}"; categoría ${categoryLabelEs(row.category)}${row.account ? `; cuenta ${row.account}` : ""}${row.currencyConfirmed ? "" : "; moneda o monto sin confirmar (no cuenta en los totales)"}.`,
        route: { pathname: "/transaction/[id]", params: { id: row.id, label: row.title } },
        eventIds: row.anchorEventId ? [row.anchorEventId] : [],
        sourceNames: row.source ? [row.source] : [],
        amount: { value: quantizeDecimal(row.amount, 2), currency: row.currency, kind: row.kind },
        score: 0.8,
      });
    }
  }
  return { sources, cards };
}

// ---------------------------------------------------------------------------
// Knowledge tool
// ---------------------------------------------------------------------------

type EventRow = {
  id: string; source: string; kind: string; date: string; displayTitle: string | null;
  displayDescription: string | null; title: string | null; body: string | null;
  txId: string | null; txKind: string | null; txAmount: string | null; txCurrency: string | null;
  txCategory: string | null; txTitle: string | null; entityNames: string[] | null;
};

type EntityRow = {
  id: string; value: string; type: string; description: string; aliases: string[];
  eventCount: number; firstSeen: string | null; lastSeen: string | null;
  relations: Array<{ label: string; neighbor: string }> | null;
};

async function fullTextEvents(db: Queryable, input: {
  ownerId: string | null; tsQuery: string; period: ResolvedPeriod | null; deniedSources: string[]; limit: number;
}) {
  if (!input.tsQuery) return [] as string[];
  const result = await db.query<{ id: string }>(`
    with query as (select to_tsquery('simple', $1) as q)
    select event.id
    from raw_events event cross join query
    left join classified_events classified on classified.raw_event_id = event.id
    where coalesce(event.owner_id, event.client_id) is not distinct from $2
      and event.privacy_status = 'standard' and event.processing_allowed
      and not (lower(event.source) = any($3::text[]))
      and ($4::timestamptz is null or coalesce(event.timestamp, event.created_at) >= $4)
      and ($5::timestamptz is null or coalesce(event.timestamp, event.created_at) <= $5)
      and (event.search_vector @@ query.q
        or to_tsvector('simple', coalesce(classified.display_title, '') || ' ' || coalesce(classified.display_description, '')) @@ query.q)
    order by greatest(
        ts_rank_cd(event.search_vector, query.q),
        ts_rank_cd(to_tsvector('simple', coalesce(classified.display_title, '') || ' ' || coalesce(classified.display_description, '')), query.q)
      ) desc, coalesce(event.timestamp, event.created_at) desc
    limit $6
  `, [input.tsQuery, input.ownerId, input.deniedSources, input.period?.from ?? null, input.period?.to ?? null, input.limit]);
  return result.rows.map((row) => row.id);
}

async function fullTextEntities(db: Queryable, input: { ownerId: string | null; tsQuery: string; names: string[]; limit: number }) {
  if (!input.tsQuery && !input.names.length) return [] as string[];
  const result = await db.query<{ id: string }>(`
    with query as (select case when $1 = '' then null else to_tsquery('simple', $1) end as q)
    select distinct on (coalesce(merged.canonical_entity_id, entity.id)) coalesce(merged.canonical_entity_id, entity.id) as id,
      greatest(
        case when lower(entity.value) = any($4::text[]) then 10 else 0 end,
        coalesce(ts_rank_cd(entity.search_vector, query.q), 0),
        coalesce((select max(ts_rank_cd(alias.search_vector, query.q)) from entity_aliases alias where alias.entity_id = entity.id), 0)
      ) as rank
    from entities entity cross join query
    left join entity_merges merged on merged.alias_entity_id = entity.id
    where entity.visibility <> 'hidden'
      and ($2::text is null or entity.owner_id = $2 or (entity.owner_id is null and entity.type in ('domain', 'concept')))
      and ((query.q is not null and (entity.search_vector @@ query.q or exists (
            select 1 from entity_aliases alias where alias.entity_id = entity.id and alias.search_vector @@ query.q)))
        or lower(entity.value) = any($4::text[])
        or exists (select 1 from entity_aliases alias where alias.entity_id = entity.id and lower(alias.alias) = any($4::text[])))
    order by coalesce(merged.canonical_entity_id, entity.id), rank desc
    limit $3
  `, [input.tsQuery, input.ownerId, input.limit * 3, input.names.map((name) => name.toLocaleLowerCase("es"))]);
  return result.rows.map((row) => row.id).slice(0, input.limit);
}

async function hydrateEvents(db: Queryable, ids: string[], input: { ownerId: string | null; deniedSources: string[]; timeZone: string }) {
  if (!ids.length) return new Map<string, EventRow>();
  const result = await db.query<EventRow>(`
    select event.id, event.source, coalesce(classified.inferred_kind, event.kind) as kind,
      to_char(coalesce(event.timestamp, event.created_at) at time zone $4, 'YYYY-MM-DD') as date,
      classified.display_title as "displayTitle", classified.display_description as "displayDescription",
      event.title, left(event.body, 900) as body,
      tx.id as "txId", tx.kind as "txKind", tx.amount::text as "txAmount", upper(tx.currency) as "txCurrency",
      tx.category as "txCategory", coalesce(tx.title_override, tx.merchant_label) as "txTitle",
      (select array_agg(name) from (
        select distinct entity.value as name from event_entities link join entities entity on entity.id = link.entity_id
        where link.event_id = event.id and entity.visibility <> 'hidden' limit 5) names) as "entityNames"
    from raw_events event
    left join classified_events classified on classified.raw_event_id = event.id
    left join lateral (
      select t.id, t.kind, t.amount, t.currency, t.category, t.title_override, t.merchant_label
      from financial_transaction_events link join financial_transactions t on t.id = link.transaction_id
      where link.raw_event_id = event.id and t.hidden_at is null
      order by t.updated_at desc limit 1
    ) tx on true
    where event.id = any($1::text[])
      and coalesce(event.owner_id, event.client_id) is not distinct from $2
      and event.privacy_status = 'standard' and event.processing_allowed
      and not (lower(event.source) = any($3::text[]))
  `, [ids, input.ownerId, input.deniedSources, input.timeZone]);
  return new Map(result.rows.map((row) => [row.id, row]));
}

async function hydrateEntities(db: Queryable, ids: string[], ownerId: string | null) {
  if (!ids.length) return new Map<string, EntityRow>();
  const result = await db.query<EntityRow>(`
    select entity.id, entity.value, entity.type, entity.description,
      coalesce((select array_agg(alias.alias order by alias.alias) from (
        select alias from entity_aliases where entity_id = entity.id limit 6) alias), '{}') as aliases,
      coalesce(stats.count, 0)::int as "eventCount",
      to_char(stats.first_seen, 'YYYY-MM-DD') as "firstSeen", to_char(stats.last_seen, 'YYYY-MM-DD') as "lastSeen",
      (select json_agg(json_build_object('label', rel.label, 'neighbor', rel.neighbor)) from (
        select coalesce(nullif(relation.label, ''), relation.relation_type) as label, neighbor.value as neighbor
        from relations relation
        join entities neighbor on neighbor.id = case when relation.source_entity_id = entity.id then relation.target_entity_id else relation.source_entity_id end
        where (relation.source_entity_id = entity.id or relation.target_entity_id = entity.id)
          and neighbor.visibility <> 'hidden'
          and ($2::text is null or relation.owner_id is not distinct from $2)
        order by relation.confidence desc limit 6) rel) as relations
    from entities entity
    left join lateral (
      select count(distinct event.id) as count, min(coalesce(event.timestamp, event.created_at)) as first_seen,
        max(coalesce(event.timestamp, event.created_at)) as last_seen
      from event_entities link join raw_events event on event.id = link.event_id
      where link.entity_id = entity.id and event.privacy_status = 'standard'
        and coalesce(event.owner_id, event.client_id) is not distinct from $2
    ) stats on true
    where entity.id = any($1::text[]) and entity.visibility <> 'hidden'
  `, [ids, ownerId]);
  return new Map(result.rows.map((row) => [row.id, row]));
}

function eventSource(row: EventRow, score: number): AskSource {
  const title = row.displayTitle || row.title || row.txTitle || row.kind;
  const description = row.displayDescription || "";
  const raw = [row.title, row.body].filter(Boolean).join(" — ").replace(/\s+/g, " ").slice(0, 600);
  const money = row.txKind && row.txAmount
    ? `Movimiento vinculado: ${KIND_LABELS_ES[row.txKind] ?? row.txKind} de ${row.txCurrency} ${formatAmountEs(row.txAmount)}${row.txTitle ? ` en "${row.txTitle}"` : ""}, categoría ${categoryLabelEs(row.txCategory)}.`
    : null;
  return {
    kind: "event",
    title,
    subtitle: eventKindLabelEs(row.kind),
    date: row.date,
    text: [`REGISTRO ${formatDateEs(row.date)} (${row.source}, ${row.kind}): ${title}`, description, raw, money,
      row.entityNames?.length ? `Menciona: ${row.entityNames.join(", ")}` : null].filter(Boolean).join("\n"),
    route: { pathname: "/event/[id]", params: { id: row.id } },
    eventIds: [row.id],
    sourceNames: [row.source],
    amount: row.txAmount && row.txCurrency && row.txKind ? { value: quantizeDecimal(row.txAmount, 2), currency: row.txCurrency, kind: row.txKind } : null,
    score,
  };
}

function entitySource(row: EntityRow, score: number): AskSource {
  const relations = (row.relations ?? []).map((relation) => `${relation.label.replace(/_/g, " ")} → ${relation.neighbor}`);
  return {
    kind: "entity",
    title: row.value,
    subtitle: entityTypeLabelEs(row.type),
    date: row.lastSeen,
    text: [`ELEMENTO "${row.value}" (${row.type})`, row.description,
      row.aliases.length ? `También llamado: ${row.aliases.join(", ")}` : null,
      `Aparece en ${row.eventCount} registros${row.firstSeen ? `, desde ${formatDateEs(row.firstSeen)}` : ""}${row.lastSeen ? ` hasta ${formatDateEs(row.lastSeen)}` : ""}.`,
      relations.length ? `Relaciones: ${relations.join("; ")}` : null].filter(Boolean).join("\n"),
    route: { pathname: "/entity/[id]", params: { id: row.id } },
    eventIds: [],
    sourceNames: [],
    amount: null,
    score,
  };
}

export async function retrieveKnowledge(db: Queryable, input: {
  ownerId: string | null;
  plan: AskPlan;
  context: AskContextData;
  timeZone: string;
  queryVectors: Array<{ vector: number[]; model: string }>;
  maxEvents?: number;
  maxEntities?: number;
}): Promise<AskSource[]> {
  const maxEvents = input.maxEvents ?? 10;
  const maxEntities = input.maxEntities ?? 4;
  const tsQuery = buildOrTsQuery([input.plan.standalone, ...input.plan.searchQueries, ...input.plan.entities]);
  const names = [...input.plan.entities, ...(input.plan.finance?.merchants ?? [])];
  const base = { ownerId: input.ownerId, deniedSources: input.context.deniedSources };

  const [textEvents, textEntities, ...vectorLists] = await Promise.all([
    fullTextEvents(db, { ...base, tsQuery, period: input.plan.period, limit: 30 }),
    fullTextEntities(db, { ownerId: input.ownerId, tsQuery, names, limit: 10 }),
    ...input.queryVectors.flatMap((query) => [
      nearestEmbeddings(db, { ownerId: input.ownerId, vector: query.vector, model: query.model, objectTypes: ["event"], from: input.plan.period?.from, to: input.plan.period?.to, limit: 30 }),
      nearestEmbeddings(db, { ownerId: input.ownerId, vector: query.vector, model: query.model, objectTypes: ["entity"], limit: 10 }),
    ]),
  ]);

  // Vector hits below a floor are noise for any model; the floor is low because
  // RRF already discounts weak tail ranks.
  const vectorEvents = vectorLists.filter((_, index) => index % 2 === 0)
    .map((hits) => hits.filter((hit) => hit.score >= 0.2).map((hit) => hit.objectId));
  const vectorEntities = vectorLists.filter((_, index) => index % 2 === 1)
    .map((hits) => hits.filter((hit) => hit.score >= 0.3).map((hit) => hit.objectId));

  const fusedEvents = reciprocalRankFusion([textEvents, ...vectorEvents]);
  const fusedEntities = reciprocalRankFusion([textEntities, ...vectorEntities]);

  const events = await hydrateEvents(db, fusedEvents.slice(0, maxEvents * 2).map(([id]) => id), { ...base, timeZone: input.timeZone });
  const sources: AskSource[] = [];
  const seenTransactions = new Set<string>();
  const seenTitles = new Set<string>();
  for (const [id, score] of fusedEvents) {
    const row = events.get(id);
    if (!row) continue; // filtered by privacy or ownership at hydration
    // A purchase usually arrives as a notification and an email: keep one.
    if (row.txId && seenTransactions.has(row.txId)) continue;
    const titleKey = `${row.date}:${(row.displayTitle ?? row.title ?? "").toLocaleLowerCase("es").trim()}`;
    if (seenTitles.has(titleKey)) continue;
    if (row.txId) seenTransactions.add(row.txId);
    seenTitles.add(titleKey);
    sources.push(eventSource(row, score));
    if (sources.length >= maxEvents) break;
  }

  const entities = await hydrateEntities(db, fusedEntities.slice(0, maxEntities).map(([id]) => id), input.ownerId);
  for (const [id, score] of fusedEntities.slice(0, maxEntities)) {
    const row = entities.get(id);
    if (row) sources.push(entitySource(row, score));
  }
  return sources;
}
