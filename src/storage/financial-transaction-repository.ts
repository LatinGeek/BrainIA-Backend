import { randomUUID } from "node:crypto";
import type { FinancialTransactionCandidate } from "../domain/financial-transactions.js";
import { candidateWindowBounds } from "../domain/financial-transactions.js";
import { pool } from "./postgres.js";

type Queryable = Pick<typeof pool, "query">;

export type FinancialTransactionEvidenceRecord = {
  id: string;
  transactionId: string;
  rawEventId: string;
  source: string;
  kind: string;
  amount: string;
  currency: string;
  merchantLabel: string;
  normalizedMerchant: string;
  observedAt: string;
  matchScore: number;
  matchReason: string;
  createdAt: string;
};

export type FinancialTransactionRecord = {
  id: string;
  kind: string;
  amount: string;
  currency: string;
  merchantLabel: string;
  normalizedMerchant: string;
  merchantEntityId: string | null;
  observedAt: string;
  windowStart: string;
  windowEnd: string;
  evidenceCount: number;
  matchScore: number;
  matchStrategy: string;
  primarySource: string;
  anchorEventId: string | null;
  createdAt: string;
  updatedAt: string;
  evidence?: FinancialTransactionEvidenceRecord[];
};

type FinancialTransactionCandidateMatch = FinancialTransactionRecord & {
  timeDiffSeconds: number;
};

function normalizeCurrency(currency: string) {
  return currency.trim().toUpperCase();
}

function buildMatchClause(candidate: FinancialTransactionCandidate, params: unknown[]) {
  const window = candidateWindowBounds(candidate.observedAt, 6);

  params.push(candidate.kind);
  const kindParam = `$${params.length}`;
  params.push(candidate.amount.toFixed(2));
  const amountParam = `$${params.length}`;
  params.push(normalizeCurrency(candidate.currency));
  const currencyParam = `$${params.length}`;
  params.push(candidate.observedAt);
  const observedAtParam = `$${params.length}`;
  params.push(window.start);
  const windowStartParam = `$${params.length}`;
  params.push(window.end);
  const windowEndParam = `$${params.length}`;
  params.push(candidate.merchantEntityId);
  const merchantEntityParam = `$${params.length}`;
  params.push(candidate.normalizedMerchant);
  const normalizedMerchantParam = `$${params.length}`;

  const merchantLike = `%${candidate.normalizedMerchant.replace(/[\\%_]/g, "\\$&")}%`;
  params.push(merchantLike);
  const merchantLikeParam = `$${params.length}`;

  return {
    sql: `
      kind = ${kindParam}
      and amount = ${amountParam}::numeric
      and upper(currency) = ${currencyParam}
      and observed_at >= ${windowStartParam}::timestamptz
      and observed_at <= ${windowEndParam}::timestamptz
      and (
        (${merchantEntityParam}::text is not null and merchant_entity_id = ${merchantEntityParam})
        or lower(normalized_merchant) = ${normalizedMerchantParam}
        or lower(merchant_label) = ${normalizedMerchantParam}
        or lower(normalized_merchant) like ${merchantLikeParam} escape '\\'
        or ${normalizedMerchantParam} like '%' || lower(normalized_merchant) || '%'
      )
    `,
    params,
    observedAtParam,
  };
}

function buildTransactionProjectionSql() {
  return `
    select
      t.id,
      t.kind,
      t.amount::text as "amount",
      t.currency,
      t.merchant_label as "merchantLabel",
      t.normalized_merchant as "normalizedMerchant",
      t.merchant_entity_id as "merchantEntityId",
      t.observed_at as "observedAt",
      t.window_start as "windowStart",
      t.window_end as "windowEnd",
      t.evidence_count as "evidenceCount",
      t.match_score as "matchScore",
      t.match_strategy as "matchStrategy",
      t.primary_source as "primarySource",
      t.anchor_event_id as "anchorEventId",
      t.created_at as "createdAt",
      t.updated_at as "updatedAt"
    from financial_transactions t
  `;
}

async function loadFinancialTransactionEvidence(db: Queryable, transactionId: string) {
  const result = await db.query<FinancialTransactionEvidenceRecord>(
    `
      select
        e.id,
        e.transaction_id as "transactionId",
        e.raw_event_id as "rawEventId",
        e.source,
        e.kind,
        e.amount::text as "amount",
        e.currency,
        e.merchant_label as "merchantLabel",
        e.normalized_merchant as "normalizedMerchant",
        e.observed_at as "observedAt",
        e.match_score as "matchScore",
        e.match_reason as "matchReason",
        e.created_at as "createdAt"
      from financial_transaction_events e
      where e.transaction_id = $1
      order by e.created_at asc
    `,
    [transactionId],
  );

  return result.rows;
}

export async function loadFinancialTransactionById(db: Queryable, id: string) {
  const result = await db.query<FinancialTransactionRecord>(
    `
      ${buildTransactionProjectionSql()}
      where t.id = $1
      limit 1
    `,
    [id],
  );

  const transaction = result.rows[0] ?? null;
  if (!transaction) {
    return null;
  }

  return {
    ...transaction,
    evidence: await loadFinancialTransactionEvidence(db, transaction.id),
  };
}

export async function listFinancialTransactions(limit = 50) {
  const result = await pool.query<FinancialTransactionRecord>(
    `
      ${buildTransactionProjectionSql()}
      order by t.observed_at desc, t.created_at desc
      limit $1
    `,
    [limit],
  );

  const items = await Promise.all(
    result.rows.map(async (transaction) => ({
      ...transaction,
      evidence: await loadFinancialTransactionEvidence(pool, transaction.id),
    })),
  );

  return items;
}

async function findMatchingFinancialTransaction(
  db: Queryable,
  candidate: FinancialTransactionCandidate,
): Promise<FinancialTransactionCandidateMatch | null> {
  const window = candidateWindowBounds(candidate.observedAt, 6);
  const params: unknown[] = [
    candidate.kind,
    candidate.amount.toFixed(2),
    normalizeCurrency(candidate.currency),
    candidate.observedAt,
    window.start,
    window.end,
    candidate.merchantEntityId,
    candidate.normalizedMerchant,
    `%${candidate.normalizedMerchant.replace(/[\\%_]/g, "\\$&")}%`,
  ];

  const result = await db.query<FinancialTransactionCandidateMatch>(
    `
      select
        t.id,
        t.kind,
        t.amount::text as "amount",
        t.currency,
        t.merchant_label as "merchantLabel",
        t.normalized_merchant as "normalizedMerchant",
        t.merchant_entity_id as "merchantEntityId",
        t.observed_at as "observedAt",
        t.window_start as "windowStart",
        t.window_end as "windowEnd",
        t.evidence_count as "evidenceCount",
        t.match_score as "matchScore",
        t.match_strategy as "matchStrategy",
        t.primary_source as "primarySource",
        t.anchor_event_id as "anchorEventId",
        t.created_at as "createdAt",
        t.updated_at as "updatedAt",
        abs(extract(epoch from (t.observed_at - $4::timestamptz))) as "timeDiffSeconds"
      from financial_transactions t
      where t.kind = $1
        and t.amount = $2::numeric
        and (
          upper(t.currency) = $3
          or $3 = 'UNKNOWN'
          or upper(t.currency) = 'UNKNOWN'
        )
        and t.observed_at >= $5::timestamptz
        and t.observed_at <= $6::timestamptz
        and (
          ($7::text is not null and t.merchant_entity_id = $7)
          or lower(t.normalized_merchant) = $8
          or lower(t.merchant_label) = $8
          or lower(t.normalized_merchant) like $9 escape '\\'
          or $8 like '%' || lower(t.normalized_merchant) || '%'
        )
      order by
        case when $7::text is not null and t.merchant_entity_id = $7 then 0 else 1 end,
        abs(extract(epoch from (t.observed_at - $4::timestamptz))) asc,
        t.evidence_count asc,
        t.created_at desc
      limit 1
    `,
    params,
  );

  return result.rows[0] ?? null;
}

async function storeFinancialTransactionEvidence(
  db: Queryable,
  input: {
    transactionId: string;
    candidate: FinancialTransactionCandidate;
    matchScore: number;
    matchReason: string;
  },
) {
  await db.query(
    `
      insert into financial_transaction_events (
        id,
        transaction_id,
        raw_event_id,
        source,
        kind,
        amount,
        currency,
        merchant_label,
        normalized_merchant,
        observed_at,
        match_score,
        match_reason
      ) values (
        $1, $2, $3, $4, $5, $6::numeric, $7, $8, $9, $10::timestamptz, $11, $12
      )
      on conflict (raw_event_id)
      do update set
        transaction_id = excluded.transaction_id,
        source = excluded.source,
        kind = excluded.kind,
        amount = excluded.amount,
        currency = excluded.currency,
        merchant_label = excluded.merchant_label,
        normalized_merchant = excluded.normalized_merchant,
        observed_at = excluded.observed_at,
        match_score = excluded.match_score,
        match_reason = excluded.match_reason
    `,
    [
      `fte_${randomUUID()}`,
      input.transactionId,
      input.candidate.eventId,
      input.candidate.source,
      input.candidate.kind,
      input.candidate.amount.toFixed(2),
      normalizeCurrency(input.candidate.currency),
      input.candidate.merchantLabel,
      input.candidate.normalizedMerchant,
      input.candidate.observedAt,
      input.matchScore,
      input.matchReason,
    ],
  );
}

async function updateFinancialTransaction(
  db: Queryable,
  input: {
    id: string;
    candidate: FinancialTransactionCandidate;
    matchScore: number;
    primarySource: string;
  },
) {
  const window = candidateWindowBounds(input.candidate.observedAt, 6);
  const result = await db.query<FinancialTransactionRecord>(
    `
      update financial_transactions
      set
        evidence_count = evidence_count + 1,
        match_score = greatest(match_score, $2),
        merchant_label = case
          when merchant_label = '' then $3
          else merchant_label
        end,
        normalized_merchant = case
          when normalized_merchant = '' then $4
          else normalized_merchant
        end,
        merchant_entity_id = coalesce(merchant_entity_id, $5),
        primary_source = case
          when primary_source = '' then $6
          else primary_source
        end,
        anchor_event_id = coalesce(anchor_event_id, $7),
        window_start = least(window_start, $8::timestamptz),
        window_end = greatest(window_end, $9::timestamptz),
        updated_at = now()
      where id = $1
      returning
        id,
        kind,
        amount::text as "amount",
        currency,
        merchant_label as "merchantLabel",
        normalized_merchant as "normalizedMerchant",
        merchant_entity_id as "merchantEntityId",
        observed_at as "observedAt",
        window_start as "windowStart",
        window_end as "windowEnd",
        evidence_count as "evidenceCount",
        match_score as "matchScore",
        match_strategy as "matchStrategy",
        primary_source as "primarySource",
        anchor_event_id as "anchorEventId",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `,
    [
      input.id,
      input.matchScore,
      input.candidate.merchantLabel,
      input.candidate.normalizedMerchant,
      input.candidate.merchantEntityId,
      input.primarySource,
      input.candidate.eventId,
      window.start,
      window.end,
    ],
  );

  return result.rows[0] ?? null;
}

async function createFinancialTransaction(
  db: Queryable,
  candidate: FinancialTransactionCandidate,
  matchScore: number,
  matchStrategy: string,
) {
  const window = candidateWindowBounds(candidate.observedAt, 6);
  const result = await db.query<FinancialTransactionRecord>(
    `
      insert into financial_transactions (
        id,
        kind,
        amount,
        currency,
        merchant_label,
        normalized_merchant,
        merchant_entity_id,
        observed_at,
        window_start,
        window_end,
        evidence_count,
        match_score,
        match_strategy,
        primary_source,
        anchor_event_id
      ) values (
        $1, $2, $3::numeric, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz, $10::timestamptz, 1, $11, $12, $13, $14
      )
      returning
        id,
        kind,
        amount::text as "amount",
        currency,
        merchant_label as "merchantLabel",
        normalized_merchant as "normalizedMerchant",
        merchant_entity_id as "merchantEntityId",
        observed_at as "observedAt",
        window_start as "windowStart",
        window_end as "windowEnd",
        evidence_count as "evidenceCount",
        match_score as "matchScore",
        match_strategy as "matchStrategy",
        primary_source as "primarySource",
        anchor_event_id as "anchorEventId",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `,
    [
      `financial_${randomUUID()}`,
      candidate.kind,
      candidate.amount.toFixed(2),
      normalizeCurrency(candidate.currency),
      candidate.merchantLabel,
      candidate.normalizedMerchant,
      candidate.merchantEntityId,
      candidate.observedAt,
      window.start,
      window.end,
      matchScore,
      matchStrategy,
      candidate.source,
      candidate.eventId,
    ],
  );

  return result.rows[0] ?? null;
}

export async function linkFinancialTransactionForEvent(
  db: Queryable,
  candidate: FinancialTransactionCandidate,
) {
  const existing = await findMatchingFinancialTransaction(db, candidate);
  const matchScore = existing ? (existing.merchantEntityId === candidate.merchantEntityId ? 0.98 : 0.92) : 0.95;
  const matchReason = existing
    ? existing.merchantEntityId === candidate.merchantEntityId
      ? "merchant_entity_match"
      : "merchant_text_match"
    : "new_financial_transaction";

  const transaction = existing
    ? await updateFinancialTransaction(db, {
        id: existing.id,
        candidate,
        matchScore,
        primarySource: candidate.source,
      })
    : await createFinancialTransaction(db, candidate, matchScore, candidate.matchStrategy);

  if (!transaction) {
    throw new Error("Financial transaction could not be stored");
  }

  await storeFinancialTransactionEvidence(db, {
    transactionId: transaction.id,
    candidate,
    matchScore,
    matchReason,
  });

  return {
    transaction,
    matchScore,
    matchReason,
    matchedExisting: Boolean(existing),
  };
}

export async function deleteFinancialTransactionsForEvent(db: Queryable, eventId: string) {
  await db.query("delete from financial_transaction_events where raw_event_id = $1", [eventId]);
  await db.query(
    `
      delete from financial_transactions t
      where not exists (
        select 1
        from financial_transaction_events e
        where e.transaction_id = t.id
      )
    `,
  );
}
