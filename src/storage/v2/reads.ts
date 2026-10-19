import type { Queryable } from "../postgres.js";
import { ApiError } from "../../domain/v2/contracts.js";
import { missing, utc } from "./observations.js";
import { decodeCursor, encodeCursor } from "./cursors.js";

type Row = Record<string, any>;
export const eventVisible = `r.owner_id=$1 and r.privacy_status<>'hidden' and public.brainia_v2_row_visible('raw_events',r.id,$1) and not exists(select 1 from deletion_tombstones t where t.owner_id=$1 and t.target_type='event' and t.target_id=r.id)`;
export const financeVisible = `t.owner_id=$1 and t.hidden_at is null and public.brainia_v2_row_visible('financial_transactions',t.id,$1) and exists(select 1 from raw_events r where r.id=t.anchor_event_id and ${eventVisible})`;
export async function targetVersion(db: Queryable, owner: string, type: string, id: string) {
  const row = (await db.query(`select * from v2_target_versions where owner_id=$1 and target_type=$2 and target_id=$3`, [owner, type, id])).rows[0];
  return { version: row?.version ?? 1, overrides: row?.overrides ?? {} };
}
export async function eventDto(db: Queryable, owner: string, id: string) {
  const row = (await db.query(`select r.*, c.inferred_kind,c.confidence from raw_events r left join classified_events c on c.raw_event_id=r.id and c.owner_id=$1 where ${eventVisible} and r.id=$2`, [owner, id])).rows[0];
  if (!row) throw missing();
  const refs = (await db.query(`select rev.id,rev.observation_id from v2_observation_revisions rev join v2_observations o on o.id=rev.observation_id and o.owner_id=rev.owner_id where rev.owner_id=$1 and rev.raw_event_id=$2 and not o.deleted`, [owner, id])).rows;
  const version = await targetVersion(db, owner, "event", id);
  const mapped: Record<string, string> = { expense: "purchase", income: "income", transfer: "transfer", email: "communication" };
  return { eventId: id, eventType: mapped[row.inferred_kind ?? row.kind] ?? "other", lifecycle: "observed", version: version.version, occurredStart: utc(row.timestamp ?? row.created_at), occurredEnd: null, timeUncertaintyMs: 0, mergedIntoId: null, evidence: refs.map(r => ({ observationId: r.observation_id, revisionId: r.id, factId: null, role: "primary", strength: "strong", active: true })), uncertainty: null, interpretations: [], reviewReasons: [], createdAt: utc(row.created_at), updatedAt: utc(row.processing_status_updated_at ?? row.created_at), ...version.overrides };
}

function currencyStatus(row: Row) { return ["explicit", "user_confirmed", "account_confirmed"].includes(row.currency_status) ? "confirmed" : row.currency_status === "unsupported" ? "unsupported" : "ambiguous"; }
function lifecycle(row: Row) { return row.amount_role === "authorized" ? "authorized" : row.amount_role === "refund" ? "posted" : row.amount_confirmed && currencyStatus(row) === "confirmed" ? "posted" : "review"; }
export async function transactionDto(db: Queryable, owner: string, row: Row) {
  const refs = (await db.query(`select distinct rev.id,rev.observation_id,e.amount_role from financial_transaction_events e join raw_events r on r.id=e.raw_event_id join v2_observation_revisions rev on rev.raw_event_id=r.id and rev.owner_id=$1 join v2_observations o on o.id=rev.observation_id and o.owner_id=$1 where e.transaction_id=$2 and ${eventVisible} and not o.deleted`, [owner, row.id])).rows;
  const version = await targetVersion(db, owner, "transaction", row.id);
  const overrides = version.overrides;
  const amount = overrides.amount ?? row.amount;
  const effective = { ...row, currency_status: overrides.currency ? "user_confirmed" : row.currency_status, amount_confirmed: overrides.amount !== undefined || row.amount_confirmed };
  // Unknown stored currencies have no valid ISO code. Leave them out of the
  // transaction page and count them explicitly in summary exclusions.
  if (!/^[A-Z]{3}$/.test(overrides.currency ?? row.currency)) throw new ApiError(422, "unsupported_currency", "Transaction currency is unknown");
  return { id: row.id, canonicalEventId: row.anchor_event_id, version: version.version, kind: overrides.kind ?? row.kind, lifecycle: overrides.lifecycle ?? lifecycle(effective), amount: String(amount).replace(/^-/, ""), currency: overrides.currency ?? row.currency, currencyStatus: currencyStatus(effective), occurredAt: utc(overrides.occurred_at ?? row.observed_at), postedAt: overrides.posted_at === null ? null : overrides.posted_at ? utc(overrides.posted_at) : lifecycle(effective) === "posted" ? utc(overrides.occurred_at ?? row.observed_at) : null, merchant: { id: row.merchant_entity_id, label: overrides.merchant_label ?? row.merchant_label, verified: false }, accountId: overrides.account_id ?? row.account_id ?? null, evidenceCount: new Set(refs.map(r => r.observation_id)).size, revisionCount: refs.length, evidence: refs.map(r => ({ observationId: r.observation_id, revisionId: r.id, factIds: [], role: r.amount_role === "refund" ? "refund" : r.amount_role === "authorized" ? "authorization" : "charge", strength: "strong" })), adjustments: [], reviewReasons: row.review_reasons ?? [] };
}
export type FinanceFilters = { from?: string; to?: string; currency?: string; lifecycle?: string; accountId?: string; limit: number; cursor?: string };
export async function financialPage(db: Queryable, owner: string, query: FinanceFilters) {
  const { cursor, limit, ...filters } = query;
  const position = decodeCursor(cursor, owner, "finance", filters);
  const rows = (await db.query(`select t.*,t.amount::text as amount from financial_transactions t left join v2_target_versions v on v.owner_id=$1 and v.target_type='transaction' and v.target_id=t.id where ${financeVisible} and ($2::timestamptz is null or coalesce((v.overrides->>'occurred_at')::timestamptz,t.observed_at) >= $2) and ($3::timestamptz is null or coalesce((v.overrides->>'occurred_at')::timestamptz,t.observed_at) < $3) and ($4::text is null or coalesce(v.overrides->>'currency',t.currency)=$4) and ($5::text is null or coalesce(v.overrides->>'account_id',t.account_id)=$5) and coalesce(v.overrides->>'currency',t.currency) ~ '^[A-Z]{3}$' and ($6::text is null or t.id>$6) order by t.id`, [owner, filters.from ?? null, filters.to ?? null, filters.currency ?? null, filters.accountId ?? null, position])).rows;
  const items = [];
  for (const row of rows) {
    const dto = await transactionDto(db, owner, row);
    if (!filters.lifecycle || dto.lifecycle === filters.lifecycle) items.push(dto);
    if (items.length > limit) break;
  }
  return { asOf: new Date().toISOString(), items: items.slice(0, limit), nextCursor: items.length > limit ? encodeCursor(owner, "finance", filters, items[limit - 1].id) : null };
}

export async function financialSummary(db: Queryable, owner: string, query: { from: string; to: string; accountId?: string; conversionTo?: string; fxRateId?: string }) {
  // Apply active v2 overlays in SQL before exact numeric aggregation; no
  // JavaScript monetary arithmetic, including corrections and FX conversion.
  const rows = (await db.query(`with eligible as (
    select t.*,coalesce(v.overrides->>'amount',t.amount::text)::numeric as effective_amount,
      coalesce(v.overrides->>'currency',t.currency) as effective_currency,
      coalesce(v.overrides->>'kind',t.kind) as effective_kind,
      case when v.overrides ? 'currency' then 'user_confirmed' else t.currency_status end as effective_status,
      coalesce(v.overrides->>'lifecycle',case when t.amount_role='authorized' then 'authorized' else 'posted' end) as effective_lifecycle,
      (v.overrides ? 'amount' or t.amount_confirmed) as effective_confirmed
    from financial_transactions t left join v2_target_versions v on v.owner_id=$1 and v.target_type='transaction' and v.target_id=t.id
    where ${financeVisible} and coalesce((v.overrides->>'occurred_at')::timestamptz,t.observed_at) >= $2 and coalesce((v.overrides->>'occurred_at')::timestamptz,t.observed_at) < $3
      and ($4::text is null or coalesce(v.overrides->>'account_id',t.account_id)=$4)
  ) select effective_currency as currency,
    coalesce(sum(effective_amount) filter(where effective_kind='income' and amount_role<>'refund' and eligible_for_total),0)::text as income,
    coalesce(sum(effective_amount) filter(where effective_kind='expense' and amount_role<>'refund' and eligible_for_total),0)::text as expense,
    coalesce(sum(effective_amount) filter(where amount_role='refund' and eligible_for_total),0)::text as refunds,
    (coalesce(sum(effective_amount) filter(where effective_kind='income' and amount_role<>'refund' and eligible_for_total),0)-coalesce(sum(effective_amount) filter(where effective_kind='expense' and amount_role<>'refund' and eligible_for_total),0)+coalesce(sum(effective_amount) filter(where amount_role='refund' and eligible_for_total),0))::text as net,
    count(*) filter(where eligible_for_total)::int as "transactionCount",
    count(*) filter(where effective_status='ambiguous' or effective_currency !~ '^[A-Z]{3}$')::int as ambiguous,
    count(*) filter(where effective_status='unsupported' or (effective_currency ~ '^[A-Z]{3}$' and effective_currency not in ('UYU','USD') and effective_status<>'ambiguous'))::int as unsupported,
    count(*) filter(where effective_lifecycle in ('authorized','pending','review') or not effective_confirmed)::int as pending
    from (select eligible.*,effective_status in ('explicit','account_confirmed','user_confirmed') and effective_currency in ('UYU','USD') and effective_confirmed and not excluded_from_reports and effective_lifecycle='posted' as eligible_for_total from eligible) counted group by effective_currency`, [owner, query.from, query.to, query.accountId ?? null])).rows;
  const totals = rows.filter(r => r.transactionCount > 0).map(({ currency, income, expense, refunds, net, transactionCount }) => ({ currency, income, expense, refunds, net, transactionCount }));
  let conversion = null;
  if (query.conversionTo) {
    const rate = (await db.query(`select *,rate::text from fx_rates where id=$1 and quote_currency=$2 and approved=true`, [query.fxRateId, query.conversionTo])).rows[0];
    if (!rate || totals.some(t => t.currency !== rate.base_currency)) throw new ApiError(422, "unsupported_currency", "An approved compatible FX rate is required");
    const converted = (await db.query(`select round($1::numeric * $2::numeric,6)::text as amount`, [totals[0]?.net ?? "0", rate.rate])).rows[0].amount;
    conversion = { rateId: rate.id, rate: rate.rate, asOf: utc(rate.as_of), provider: rate.provider, toCurrency: query.conversionTo, amount: converted };
  }
  return { from: query.from, to: query.to, asOf: new Date().toISOString(), totals, excluded: { ambiguous: rows.reduce((n,r) => n+r.ambiguous,0), unsupported: rows.reduce((n,r) => n+r.unsupported,0), pending: rows.reduce((n,r) => n+r.pending,0) }, conversion };
}
