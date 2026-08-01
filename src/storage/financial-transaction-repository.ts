import { randomUUID } from "node:crypto";
import type { FinancialTransactionCandidate } from "../domain/financial-transactions.js";
import { candidateWindowBounds } from "../domain/financial-transactions.js";
import { pool, withTransaction } from "./postgres.js";

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
  displayMerchantLabel: string;
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
  category: string | null;
  accountId: string | null;
  account: string | null;
  destinationAccountId: string | null;
  destinationAccount: string | null;
  excludedFromReports: boolean;
  adjustmentTargetBalance: string | null;
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
      coalesce(merchant_alias.alias, merchant_entity.value, t.merchant_label) as "displayMerchantLabel",
      t.normalized_merchant as "normalizedMerchant",
      t.merchant_entity_id as "merchantEntityId",
      t.observed_at as "observedAt",
      t.window_start as "windowStart",
      t.window_end as "windowEnd",
      (
        select count(*)
        from financial_transaction_events evidence
        join financial_transactions evidence_transaction on evidence_transaction.id = evidence.transaction_id
        where evidence.transaction_id = t.id
           or evidence_transaction.merged_into_transaction_id = t.id
      )::int as "evidenceCount",
      t.match_score as "matchScore",
      t.match_strategy as "matchStrategy",
      t.category,
      t.account_id as "accountId",
      coalesce(a.name, a.mask) as account,
      t.destination_account_id as "destinationAccountId",
      coalesce(destination.name, destination.mask) as "destinationAccount",
      t.excluded_from_reports as "excludedFromReports",
      t.adjustment_target_balance::text as "adjustmentTargetBalance",
      t.primary_source as "primarySource",
      t.anchor_event_id as "anchorEventId",
      t.created_at as "createdAt",
      t.updated_at as "updatedAt"
    from financial_transactions t
    left join financial_accounts a on a.id = t.account_id
    left join financial_accounts destination on destination.id = t.destination_account_id
    left join entity_merges merchant_merge on merchant_merge.alias_entity_id = t.merchant_entity_id
    left join entities merchant_entity on merchant_entity.id = coalesce(merchant_merge.canonical_entity_id, t.merchant_entity_id)
    left join lateral (
      select alias
      from entity_aliases
      where entity_id = merchant_entity.id
      order by updated_at desc, created_at desc
      limit 1
    ) merchant_alias on true
  `;
}

export type FinancialAccountRecord = {
  id: string;
  name: string;
  type: string;
  mask: string | null;
  externalRef: string | null;
  currency: "UYU" | "USD" | null;
  color: string;
  balance: string;
};

export async function listFinancialAccounts() {
  const result = await pool.query<FinancialAccountRecord>(
    `
      select
        a.id,
        a.name,
        a.type,
        a.mask,
        a.external_ref as "externalRef",
        a.currency,
        a.color,
        coalesce(sum(
          case
            when t.kind = 'transfer' and t.account_id = a.id then -t.amount
            when t.kind = 'transfer' and t.destination_account_id = a.id then t.amount
            when t.kind = 'income' and t.account_id = a.id then t.amount
            when t.kind = 'expense' and t.account_id = a.id then -t.amount
            else 0
          end
        ), 0)::text as balance
      from financial_accounts a
      left join financial_transactions t
        on (t.account_id = a.id or t.destination_account_id = a.id)
        and upper(t.currency) = upper(a.currency)
        and t.hidden_at is null
      group by a.id
      order by a.currency nulls last, a.name asc
    `,
  );
  return result.rows;
}

export async function createFinancialAccount(input: { name: string; type?: string; mask?: string | null; currency: "UYU" | "USD"; color?: string }) {
  const result = await pool.query<FinancialAccountRecord>(
    `
      insert into financial_accounts (id, name, type, mask, currency, color)
      values ($1, $2, $3, $4, $5, $6)
      returning id, name, type, mask, external_ref as "externalRef", currency, color, '0.00'::text as balance
    `,
    [`account_${randomUUID()}`, input.name.trim(), input.type?.trim() || "bank", input.mask?.trim() || null, input.currency, input.color ?? "#2563EB"],
  );
  return result.rows[0];
}

export async function updateFinancialAccount(
  id: string,
  input: { name: string; type?: string; mask?: string | null; currency: "UYU" | "USD"; color?: string },
) {
  const incompatible = await pool.query<{ exists: boolean }>(
    `
      select exists (
        select 1 from financial_transactions
        where (account_id = $1 or destination_account_id = $1)
          and hidden_at is null
          and upper(currency) <> $2
      ) as exists
    `,
    [id, input.currency],
  );
  if (incompatible.rows[0]?.exists) {
    throw new Error("Account currency cannot differ from its existing transactions");
  }

  const result = await pool.query<FinancialAccountRecord>(
    `
      update financial_accounts
      set name = $2, type = $3, mask = $4, currency = $5, color = $6, updated_at = now()
      where id = $1
      returning id, name, type, mask, external_ref as "externalRef", currency, color, '0.00'::text as balance
    `,
    [id, input.name.trim(), input.type?.trim() || "bank", input.mask?.trim() || null, input.currency, input.color ?? "#2563EB"],
  );
  if (!result.rowCount) return null;
  return (await listFinancialAccounts()).find((account) => account.id === id) ?? result.rows[0];
}

export async function deleteFinancialAccount(id: string) {
  return withTransaction(async (db) => {
    const account = await db.query<{ id: string }>(
      `select id from financial_accounts where id = $1 for update`,
      [id],
    );
    if (!account.rowCount) return null;

    const references = await db.query<{ count: string }>(
      `
        select count(*)::text as count
        from financial_transactions
        where account_id = $1 or destination_account_id = $1
      `,
      [id],
    );
    const deleted = await db.query(`delete from financial_accounts where id = $1`, [id]);
    if (!deleted.rowCount) return null;
    return {
      deleted: true as const,
      detachedTransactions: Number(references.rows[0]?.count ?? 0),
    };
  });
}

export async function createBalanceAdjustment(input: { accountId: string; targetBalance: number; note?: string }) {
  return withTransaction(async (db) => {
    const accountResult = await db.query<FinancialAccountRecord>(
      `select id, name, type, mask, external_ref as "externalRef", currency, color, '0.00'::text as balance from financial_accounts where id = $1 for update`,
      [input.accountId],
    );
    const account = accountResult.rows[0];
    if (!account?.currency) throw new Error("Financial account not found");

    const balanceResult = await db.query<{ balance: string }>(
      `
        select coalesce(sum(
          case
            when kind = 'transfer' and account_id = $1 then -amount
            when kind = 'transfer' and destination_account_id = $1 then amount
            when kind = 'income' and account_id = $1 then amount
            when kind = 'expense' and account_id = $1 then -amount
            else 0
          end
        ), 0)::text as balance
        from financial_transactions
        where (account_id = $1 or destination_account_id = $1)
          and hidden_at is null
      `,
      [account.id],
    );
    const currentBalance = Number(balanceResult.rows[0]?.balance ?? 0);
    const delta = Math.round((input.targetBalance - currentBalance) * 100) / 100;
    if (Math.abs(delta) < 0.005) throw new Error("Account balance already matches the target");

    const id = `financial_${randomUUID()}`;
    const now = new Date().toISOString();
    await db.query(
      `
        insert into financial_transactions (
          id, kind, amount, currency, merchant_label, normalized_merchant,
          observed_at, window_start, window_end, evidence_count, match_score,
          match_strategy, primary_source, category, account_id,
          excluded_from_reports, adjustment_target_balance
        ) values (
          $1, $2, $3::numeric, $4, $5, 'balance adjustment',
          $6::timestamptz, $6::timestamptz, $6::timestamptz, 0, 1,
          'manual_balance_adjustment', 'manual', 'Balance adjustment', $7, true, $8::numeric
        )
      `,
      [
        id,
        delta > 0 ? "income" : "expense",
        Math.abs(delta).toFixed(2),
        account.currency,
        input.note?.trim() || `Balance adjustment for ${account.name}`,
        now,
        account.id,
        input.targetBalance.toFixed(2),
      ],
    );
    return loadFinancialTransactionById(db, id);
  });
}

export async function updateFinancialTransactionContext(
  id: string,
  input: { category?: string | null; accountId?: string | null; destinationAccountId?: string | null; currency?: "UYU" | "USD"; kind?: "expense" | "income" | "transfer" },
) {
  const accountIds = [input.accountId, input.destinationAccountId].filter((value): value is string => Boolean(value));
  if (accountIds.length) {
    const compatibility = await pool.query<{ matches: boolean }>(
      `
        select exists (
          select 1
          from financial_transactions t
          join financial_accounts a on a.id = any($2::text[])
          where t.id = $1
            and a.currency = coalesce($3, t.currency)
        ) as matches
      `,
      [id, accountIds, input.currency ?? null],
    );
    if (!compatibility.rows[0]?.matches) {
      throw new Error("The account currency must match the transaction currency");
    }
  }
  if (input.kind === "transfer" && input.accountId && input.destinationAccountId && input.accountId === input.destinationAccountId) {
    throw new Error("A transfer must use two different accounts");
  }
  const result = await pool.query(`
    update financial_transactions
    set category = $2, account_id = $3, destination_account_id = $4, currency = coalesce($5, currency), kind = coalesce($6, kind), updated_at = now()
    where id = $1
      and hidden_at is null
    returning id
  `, [id, input.category?.trim() || null, input.accountId || null, input.destinationAccountId || null, input.currency ?? null, input.kind ?? null]);

  if (!result.rowCount) return null;
  return loadFinancialTransactionById(pool, id);
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
      join financial_transactions t on t.id = e.transaction_id
      where e.transaction_id = $1
         or t.merged_into_transaction_id = $1
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
        and t.hidden_at is null
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

export async function listFinancialTransactions(
  limit = 50,
  range: { from?: string; to?: string } = {},
) {
  const filters: string[] = [];
  const params: unknown[] = [];

  filters.push("t.hidden_at is null");

  if (range.from) {
    params.push(range.from);
    filters.push(`t.observed_at >= $${params.length}::timestamptz`);
  }
  if (range.to) {
    params.push(range.to);
    filters.push(`t.observed_at <= $${params.length}::timestamptz`);
  }
  params.push(limit);

  const result = await pool.query<FinancialTransactionRecord>(
    `
      ${buildTransactionProjectionSql()}
      ${filters.length ? `where ${filters.join(" and ")}` : ""}
      order by t.observed_at desc, t.created_at desc
      limit $${params.length}
    `,
    params,
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
        and t.hidden_at is null
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
        evidence_count = (
          select count(*) + 1
          from financial_transaction_events
          where transaction_id = $1
        ),
        match_score = greatest(match_score, $2),
        merchant_label = $3,
        normalized_merchant = $4,
        merchant_entity_id = $5,
        primary_source = case
          when primary_source = '' then $6
          else primary_source
        end,
        anchor_event_id = coalesce(anchor_event_id, $7),
        window_start = least(window_start, $8::timestamptz),
        window_end = greatest(window_end, $9::timestamptz),
        account_id = coalesce($10, account_id),
        category = coalesce($11, category),
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
      input.candidate.accountId,
      input.candidate.category,
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
        anchor_event_id,
        account_id,
        category
      ) values (
        $1, $2, $3::numeric, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz, $10::timestamptz, 1, $11, $12, $13, $14, $15, $16
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
      candidate.accountId,
      candidate.category,
    ],
  );

  return result.rows[0] ?? null;
}

export async function linkFinancialTransactionForEvent(
  db: Queryable,
  candidate: FinancialTransactionCandidate,
) {
  // A user can hide a record or consolidate it into another transaction. The
  // source event remains linked to that hidden projection so reprocessing does
  // not silently bring the duplicate back into Money.
  const retainedHiddenLink = await db.query<{ hiddenAt: string | null }>(
    `
      select t.hidden_at as "hiddenAt"
      from financial_transaction_events evidence
      join financial_transactions t on t.id = evidence.transaction_id
      where evidence.raw_event_id = $1
      limit 1
    `,
    [candidate.eventId],
  );
  if (retainedHiddenLink.rows[0]?.hiddenAt) {
    return {
      transaction: null,
      matchScore: 1,
      matchReason: "user_hidden_transaction",
      matchedExisting: true,
    };
  }

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
  await db.query(
    `
      delete from financial_transaction_events e
      using financial_transactions t
      where e.raw_event_id = $1
        and e.transaction_id = t.id
        and t.hidden_at is null
    `,
    [eventId],
  );
  await db.query(
    `
      delete from financial_transactions t
      where not t.excluded_from_reports
        and t.hidden_at is null
        and not exists (
        select 1
        from financial_transaction_events e
        where e.transaction_id = t.id
      )
    `,
  );
}

export async function mergeFinancialTransactions(canonicalId: string, duplicateId: string) {
  if (canonicalId === duplicateId) {
    throw new Error("Choose two different transactions to consolidate");
  }

  return withTransaction(async (db) => {
    const result = await db.query<
      Pick<FinancialTransactionRecord, "id" | "kind" | "excludedFromReports"> & { hiddenAt: string | null }
    >(
      `
        select
          id,
          kind,
          excluded_from_reports as "excludedFromReports",
          hidden_at as "hiddenAt"
        from financial_transactions
        where id = any($1::text[])
        for update
      `,
      [[canonicalId, duplicateId]],
    );
    const canonical = result.rows.find((transaction) => transaction.id === canonicalId);
    const duplicate = result.rows.find((transaction) => transaction.id === duplicateId);
    if (!canonical || !duplicate || canonical.hiddenAt || duplicate.hiddenAt) return null;
    if (canonical.kind !== duplicate.kind) {
      throw new Error("Only transactions of the same type can be consolidated");
    }
    if (canonical.excludedFromReports || duplicate.excludedFromReports) {
      throw new Error("Balance adjustments cannot be consolidated");
    }

    await db.query(
      `
        update financial_transactions
        set hidden_at = now(), merged_into_transaction_id = $1, updated_at = now()
        where id = $2
      `,
      [canonicalId, duplicateId],
    );

    await db.query(
      `
        update financial_transactions
        set evidence_count = (
          select count(*)
          from financial_transaction_events evidence
          join financial_transactions evidence_transaction on evidence_transaction.id = evidence.transaction_id
          where evidence.transaction_id = $1
             or evidence_transaction.merged_into_transaction_id = $1
        ), updated_at = now()
        where id = $1
      `,
      [canonicalId],
    );

    return loadFinancialTransactionById(db, canonicalId);
  });
}

export async function hideFinancialTransaction(id: string) {
  const result = await pool.query(
    `
      update financial_transactions
      set hidden_at = now(), merged_into_transaction_id = null, updated_at = now()
      where id = $1
        and hidden_at is null
      returning id
    `,
    [id],
  );
  return Boolean(result.rowCount);
}
