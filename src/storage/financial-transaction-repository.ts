import { randomUUID } from "node:crypto";
import { recordCorrection } from './correction-memory.js';
import { applyCorrectionProjection, correctionSnapshot } from './correction-projection.js';
import type { FinancialTransactionCandidate } from "../domain/financial-transactions.js";
import { canAutoLinkFinancialCandidate, candidateWindowBounds } from "../domain/financial-transactions.js";
import {
  absDecimal,
  compareDecimal,
  isConfirmedCurrencyStatus,
  isDecimalString,
  isSupportedCurrency,
  multiplyDecimal,
  normalizeDecimal,
  quantizeDecimal,
  subtractDecimal,
  type AmountRole,
  type CurrencyStatus,
} from "../domain/money.js";
import { pool, withTransaction } from "./postgres.js";
import { ensurePendingFinancialTransactionsSchema } from "./pending-financial-schema.js";

type Queryable = Pick<typeof pool, "query">;

export type FinancialTransactionEvidenceRecord = {
  id: string;
  transactionId: string;
  rawEventId: string;
  source: string;
  kind: string;
  amount: string;
  amountRole: AmountRole;
  currency: string;
  currencyStatus: CurrencyStatus;
  currencyProvenance: string | null;
  rawAmountText: string | null;
  amountConfirmed: boolean;
  nativeReference: string | null;
  referenceNamespace: string | null;
  merchantLabel: string;
  displayMerchantLabel: string;
  normalizedMerchant: string;
  observedAt: string;
  matchScore: number;
  matchReason: string;
  reviewReasons: string[];
  createdAt: string;
};

export type FinancialTransactionRecord = {
  id: string;
  kind: string;
  amount: string;
  amountRole: AmountRole;
  currency: string;
  currencyStatus: CurrencyStatus;
  currencyProvenance: string | null;
  rawAmountText: string | null;
  amountConfirmed: boolean;
  nativeReference: string | null;
  referenceNamespace: string | null;
  convertedAmount: string | null;
  convertedCurrency: string | null;
  fxRateId: string | null;
  fxRate: string | null;
  reviewReasons: string[];
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
  destinationAmount: string | null;
  destinationCurrency: string | null;
  excludedFromReports: boolean;
  adjustmentTargetBalance: string | null;
  primarySource: string;
  anchorEventId: string | null;
  createdAt: string;
  updatedAt: string;
  evidence?: FinancialTransactionEvidenceRecord[];
};

export type FinancialSummaryCurrencyTotal = {
  currency: string;
  income: string;
  expense: string;
  refunds: string;
  net: string;
  transactionCount: number;
};

export type FinancialSummary = {
  from: string;
  to: string;
  asOf: string;
  totals: FinancialSummaryCurrencyTotal[];
  // Mirrors the v2 FinancialSummary.excluded contract exactly: only these
  // review buckets are wire fields. Legacy UNKNOWN / unconfirmed diagnostics are
  // available through getFinancialSummaryExclusionDiagnostics and never leak
  // into this response.
  excluded: {
    ambiguous: number;
    unsupported: number;
    pending: number;
  };
  conversion: null | {
    rateId: string;
    rate: string;
    asOf: string;
    provider: string;
    toCurrency: string;
    amount: string;
  };
};

export type FinancialSummaryExclusionDiagnostics = {
  unknown: number;
  unconfirmedAmount: number;
};

export type PendingFinancialTransactionRecord = {
  id: string;
  title: string;
  kind: "expense" | "income";
  amount: string;
  currency: "UYU" | "USD";
  category: string | null;
  accountId: string | null;
  account: string | null;
  estimatedExecutionDate: string;
  status: "pending" | "executed" | "cancelled";
  createdAt: string;
  updatedAt: string;
};

export type ManualFinancialTransactionInput = {
  title: string;
  kind: "expense" | "income";
  amount: number | string;
  currency: "UYU" | "USD";
  category?: string | null;
  accountId?: string | null;
  observedAt: string;
  ownerId?: string;
};

export type PendingFinancialTransactionInput = Omit<ManualFinancialTransactionInput, "observedAt"> & {
  estimatedExecutionDate: string;
};

type FinancialTransactionCandidateMatch = FinancialTransactionRecord & {
  timeDiffSeconds: number;
};

function normalizeCurrency(currency: string) {
  return currency.trim().toUpperCase();
}

function toExactAmount(value: number | string): string {
  const normalized = normalizeDecimal(typeof value === "number" ? String(value) : value.trim());
  if (normalized === null) throw new Error("Invalid monetary amount");
  return quantizeDecimal(normalized, 2);
}

function buildTransactionProjectionSql() {
  return `
    select
      t.id,
      t.kind,
      t.amount::text as "amount",
      t.amount_role as "amountRole",
      case when t.currency_status = 'ambiguous' then 'UNKNOWN' else t.currency end as "currency",
      t.currency_status as "currencyStatus",
      t.currency_provenance as "currencyProvenance",
      t.raw_amount_text as "rawAmountText",
      t.amount_confirmed as "amountConfirmed",
      t.native_reference as "nativeReference",
      t.reference_namespace as "referenceNamespace",
      t.converted_amount::text as "convertedAmount",
      t.converted_currency as "convertedCurrency",
      t.fx_rate_id as "fxRateId",
      t.fx_rate::text as "fxRate",
      t.review_reasons as "reviewReasons",
      t.merchant_label as "merchantLabel",
      -- A title explicitly chosen by the user always wins. Otherwise, use the
      -- event interpretation generated from the complete captured event before
      -- falling back to merchant identity/transport text.
      coalesce(t.title_override, anchor_classified.display_title, merchant_alias.alias, merchant_entity.value, t.merchant_label) as "displayMerchantLabel",
      t.normalized_merchant as "normalizedMerchant",
      t.merchant_entity_id as "merchantEntityId",
      t.observed_at as "observedAt",
      t.window_start as "windowStart",
      t.window_end as "windowEnd",
      coalesce(evidence_counts.count, 0)::int as "evidenceCount",
      t.match_score as "matchScore",
      t.match_strategy as "matchStrategy",
      t.category,
      t.account_id as "accountId",
      coalesce(a.name, a.mask) as account,
      t.destination_account_id as "destinationAccountId",
      coalesce(destination.name, destination.mask) as "destinationAccount",
      t.destination_amount::text as "destinationAmount",
      t.destination_currency as "destinationCurrency",
      t.excluded_from_reports as "excludedFromReports",
      t.adjustment_target_balance::text as "adjustmentTargetBalance",
      t.primary_source as "primarySource",
      t.anchor_event_id as "anchorEventId",
      t.created_at as "createdAt",
      t.updated_at as "updatedAt"
    from financial_transactions t
    left join financial_accounts a on a.id = t.account_id
    left join financial_accounts destination on destination.id = t.destination_account_id
    left join classified_events anchor_classified on anchor_classified.raw_event_id = t.anchor_event_id
    left join entity_merges merchant_merge on merchant_merge.alias_entity_id = t.merchant_entity_id
    left join entities merchant_entity on merchant_entity.id = coalesce(merchant_merge.canonical_entity_id, t.merchant_entity_id)
    left join lateral (
      select alias
      from entity_aliases
      where entity_id = merchant_entity.id
      order by updated_at desc, created_at desc
      limit 1
    ) merchant_alias on true
    left join (
      -- Aggregate once for the whole result set. A correlated count here used
      -- to run an expanding evidence query for every transaction row.
      select
        coalesce(evidence_transaction.merged_into_transaction_id, evidence.transaction_id) as transaction_id,
        -- One row per distinct evidence observation. A join fan-out must never
        -- inflate the displayed count or, indirectly, a report total.
        count(distinct evidence.id)::int as count
      from financial_transaction_events evidence
      join financial_transactions evidence_transaction on evidence_transaction.id = evidence.transaction_id
      group by coalesce(evidence_transaction.merged_into_transaction_id, evidence.transaction_id)
    ) evidence_counts on evidence_counts.transaction_id = t.id
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

export async function listFinancialAccounts(ownerId?: string) {
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
            when t.kind = 'transfer' and t.destination_account_id = a.id then coalesce(t.destination_amount, t.amount)
            when t.kind = 'income' and t.account_id = a.id then t.amount
            when t.kind = 'expense' and t.account_id = a.id then -t.amount
            else 0
          end
        ), 0)::text as balance
      from financial_accounts a
      left join financial_transactions t
        on (
          (t.account_id = a.id and upper(t.currency) = upper(a.currency))
          or (
            t.destination_account_id = a.id
            and upper(coalesce(t.destination_currency, t.currency)) = upper(a.currency)
          )
        )
        and t.hidden_at is null
        and t.currency_status in ('explicit', 'account_confirmed', 'user_confirmed')
        and t.amount_confirmed = true
        and (
          t.owner_id is not distinct from a.owner_id
          or (
            -- Historical captures predate owner_id backfill; their evidence event
            -- still carries the authenticated client scope.
            t.owner_id is null
            and a.owner_id is not null
            and exists (
              select 1
              from financial_transaction_events owner_evidence
              join raw_events owner_event on owner_event.id = owner_evidence.raw_event_id
              where owner_evidence.transaction_id = t.id
                and owner_event.client_id = a.owner_id
            )
          )
        )
      where ($1::text is null or a.owner_id = $1)
      group by a.id
      order by a.currency nulls last, a.name asc
    `,
    [ownerId ?? null],
  );
  return result.rows;
}

export async function createFinancialAccount(input: { name: string; type?: string; mask?: string | null; currency: "UYU" | "USD"; color?: string; ownerId?: string }) {
  const result = await pool.query<FinancialAccountRecord>(
    `
      insert into financial_accounts (id, name, type, mask, currency, color, owner_id)
      values ($1, $2, $3, $4, $5, $6, $7)
      returning id, name, type, mask, external_ref as "externalRef", currency, color, '0.00'::text as balance
    `,
    [`account_${randomUUID()}`, input.name.trim(), input.type?.trim() || "bank", input.mask?.trim() || null, input.currency, input.color ?? "#2563EB", input.ownerId ?? null],
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
        where hidden_at is null
          and (
            (account_id = $1 and upper(currency) <> $2)
            or (
              destination_account_id = $1
              and upper(coalesce(destination_currency, currency)) <> $2
            )
          )
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

export async function createBalanceAdjustment(input: { accountId: string; targetBalance: number; note?: string; ownerId?: string }) {
  return withTransaction(async (db) => {
    const accountResult = await db.query<FinancialAccountRecord & { ownerId: string | null }>(
      `select id, name, type, mask, external_ref as "externalRef", currency, color, owner_id as "ownerId", '0.00'::text as balance
       from financial_accounts
       where id = $1 and ($2::text is null or owner_id = $2)
       for update`,
      [input.accountId, input.ownerId ?? null],
    );
    const account = accountResult.rows[0];
    if (!account?.currency) throw new Error("Financial account not found");

    const balanceResult = await db.query<{ balance: string }>(
      `
        select coalesce(sum(
          case
            when kind = 'transfer' and account_id = $1 then -amount
            when kind = 'transfer' and destination_account_id = $1 then coalesce(destination_amount, amount)
            when kind = 'income' and account_id = $1 then amount
            when kind = 'expense' and account_id = $1 then -amount
            else 0
          end
        ), 0)::text as balance
        from financial_transactions t
        where (
          (account_id = $1 and upper(currency) = upper($2))
          or (destination_account_id = $1 and upper(coalesce(destination_currency, currency)) = upper($2))
        )
          and hidden_at is null
          and currency_status in ('explicit', 'account_confirmed', 'user_confirmed')
          and amount_confirmed = true
          and (
            t.owner_id is not distinct from $3
            or (
              -- Historical captures predate owner_id backfill; their evidence
              -- event still carries the authenticated client scope.
              t.owner_id is null
              and $3::text is not null
              and exists (
                select 1
                from financial_transaction_events owner_evidence
                join raw_events owner_event on owner_event.id = owner_evidence.raw_event_id
                where owner_evidence.transaction_id = t.id
                  and owner_event.client_id = $3
              )
            )
          )
      `,
      [account.id, account.currency, account.ownerId],
    );
    const currentBalance = normalizeDecimal(balanceResult.rows[0]?.balance ?? "0") ?? "0";
    const targetBalance = toExactAmount(input.targetBalance);
    const delta = quantizeDecimal(subtractDecimal(targetBalance, currentBalance), 2);
    if (compareDecimal(absDecimal(delta), "0.005") < 0) throw new Error("Account balance already matches the target");

    const id = `financial_${randomUUID()}`;
    const now = new Date().toISOString();
    await db.query(
      `
        insert into financial_transactions (
          id, kind, amount, amount_role, currency, currency_status, merchant_label, normalized_merchant,
          observed_at, window_start, window_end, evidence_count, match_score,
          match_strategy, primary_source, category, account_id,
          excluded_from_reports, adjustment_target_balance, owner_id, amount_confirmed
        ) values (
          $1, $2, $3::numeric, 'posted', $4, 'explicit', $5, 'balance adjustment',
          $6::timestamptz, $6::timestamptz, $6::timestamptz, 0, 1,
          'manual_balance_adjustment', 'manual', 'Balance adjustment', $7, true, $8::numeric, $9, true
        )
      `,
      [
        id,
        compareDecimal(delta, "0") > 0 ? "income" : "expense",
        absDecimal(delta),
        account.currency,
        input.note?.trim() || `Balance adjustment for ${account.name}`,
        now,
        account.id,
        targetBalance,
        input.ownerId ?? null,
      ],
    );
    return loadFinancialTransactionById(db, id);
  });
}

async function assertAccountCurrency(
  db: Queryable,
  accountId: string | null | undefined,
  currency: "UYU" | "USD",
  ownerId?: string,
) {
  if (!accountId) return;
  const result = await db.query<{ currency: string | null; ownerId: string | null }>(
    `select currency, owner_id as "ownerId" from financial_accounts where id = $1`,
    [accountId],
  );
  const account = result.rows[0];
  if (!account?.currency) throw new Error("Financial account not found");
  // Scoped callers may only attach movements to an account they own. Legacy
  // null-owner accounts are not inferred to belong to anyone; unscoped admins
  // (owner undefined) keep the previous behavior.
  if (ownerId && account.ownerId !== ownerId) throw new Error("Financial account not found");
  if (account.currency.toUpperCase() !== currency) {
    throw new Error("The account currency must match the transaction currency");
  }
}

async function insertManualFinancialTransaction(
  db: Queryable,
  input: ManualFinancialTransactionInput,
  primarySource = "manual",
) {
  await assertAccountCurrency(db, input.accountId, input.currency, input.ownerId);
  const id = `financial_${randomUUID()}`;
  const title = input.title.trim();
  const amount = toExactAmount(input.amount);
  await db.query(
    `
      insert into financial_transactions (
        id, kind, amount, amount_role, currency, currency_status, currency_provenance,
        raw_amount_text, amount_confirmed, merchant_label, normalized_merchant,
        observed_at, window_start, window_end, evidence_count, match_score,
        match_strategy, primary_source, category, account_id, owner_id
      ) values (
        $1, $2, $3::numeric, 'posted', $4, 'explicit', 'user_entry',
        $11, true, $5, lower($5),
        $6::timestamptz, $6::timestamptz, $6::timestamptz, 0, 1,
        'manual_entry', $7, $8, $9, $10
      )
    `,
    [
      id,
      input.kind,
      amount,
      input.currency,
      title,
      input.observedAt,
      primarySource,
      input.category?.trim() || null,
      input.accountId ?? null,
      input.ownerId ?? null,
      String(input.amount),
    ],
  );
  return loadFinancialTransactionById(db, id);
}

export async function createManualFinancialTransaction(input: ManualFinancialTransactionInput) {
  return withTransaction((db) => insertManualFinancialTransaction(db, input));
}

function pendingTransactionProjectionSql() {
  return `
    select
      p.id,
      p.title,
      p.kind,
      p.amount::text as amount,
      p.currency,
      p.category,
      p.account_id as "accountId",
      coalesce(a.name, a.mask) as account,
      p.estimated_execution_date::text as "estimatedExecutionDate",
      p.status,
      p.owner_id as "ownerId",
      p.created_at as "createdAt",
      p.updated_at as "updatedAt"
    from pending_financial_transactions p
    left join financial_accounts a on a.id = p.account_id
  `;
}

export async function listPendingFinancialTransactions(ownerId?: string) {
  await ensurePendingFinancialTransactionsSchema();
  const result = await pool.query<PendingFinancialTransactionRecord>(`
    ${pendingTransactionProjectionSql()}
    where p.status = 'pending'
      and ($1::text is null or p.owner_id = $1)
    order by p.estimated_execution_date asc, p.created_at desc
  `, [ownerId ?? null]);
  return result.rows;
}

export async function createPendingFinancialTransaction(input: PendingFinancialTransactionInput) {
  await ensurePendingFinancialTransactionsSchema();
  return withTransaction(async (db) => {
    await assertAccountCurrency(db, input.accountId, input.currency, input.ownerId);
    const id = `pending_financial_${randomUUID()}`;
    await db.query(
      `
        insert into pending_financial_transactions (
          id, title, kind, amount, currency, category, account_id, estimated_execution_date, owner_id
        ) values ($1, $2, $3, $4::numeric, $5, $6, $7, $8::date, $9)
      `,
      [id, input.title.trim(), input.kind, toExactAmount(input.amount), input.currency, input.category?.trim() || null, input.accountId ?? null, input.estimatedExecutionDate, input.ownerId ?? null],
    );
    const result = await db.query<PendingFinancialTransactionRecord>(`
      ${pendingTransactionProjectionSql()}
      where p.id = $1
    `, [id]);
    return result.rows[0] ?? null;
  });
}

export async function updatePendingFinancialTransaction(
  id: string,
  input: Partial<PendingFinancialTransactionInput>,
  ownerId?: string,
) {
  await ensurePendingFinancialTransactionsSchema();
  return withTransaction(async (db) => {
    const existingResult = await db.query<{
      title: string;
      kind: "expense" | "income";
      amount: string;
      currency: "UYU" | "USD";
      category: string | null;
      accountId: string | null;
    }>(`
      select title, kind, amount::text as amount, currency, category, account_id as "accountId"
      from pending_financial_transactions
      where id = $1 and status = 'pending'
      for update
    `, [id]);
    const existing = existingResult.rows[0];
    if (!existing) return null;

    const hasAccount = Object.hasOwn(input, "accountId");
    const hasCategory = Object.hasOwn(input, "category");
    const accountId = hasAccount ? input.accountId ?? null : existing.accountId;
    const currency = input.currency ?? existing.currency;
    await assertAccountCurrency(db, accountId, currency, ownerId);
    await db.query(
      `
        update pending_financial_transactions
        set title = coalesce($2, title),
            kind = coalesce($3, kind),
            amount = coalesce($4::numeric, amount),
            currency = coalesce($5, currency),
            category = case when $9 then $6 else category end,
            account_id = case when $8 then $7 else account_id end,
            estimated_execution_date = coalesce($10::date, estimated_execution_date),
            updated_at = now()
        where id = $1 and status = 'pending'
      `,
      [
        id,
        input.title?.trim() || null,
        input.kind ?? null,
        input.amount === undefined ? null : toExactAmount(input.amount),
        input.currency ?? null,
        input.category?.trim() || null,
        input.accountId ?? null,
        hasAccount,
        hasCategory,
        input.estimatedExecutionDate ?? null,
      ],
    );
    const result = await db.query<PendingFinancialTransactionRecord>(`
      ${pendingTransactionProjectionSql()}
      where p.id = $1
    `, [id]);
    return result.rows[0] ?? null;
  });
}

export async function executePendingFinancialTransaction(id: string, executedAt: string) {
  await ensurePendingFinancialTransactionsSchema();
  return withTransaction(async (db) => {
    const result = await db.query<PendingFinancialTransactionRecord>(`
      ${pendingTransactionProjectionSql()}
      where p.id = $1 and p.status = 'pending'
      for update of p
    `, [id]);
    const pending = result.rows[0];
    if (!pending) return null;
    const transaction = await insertManualFinancialTransaction(db, {
      title: pending.title,
      kind: pending.kind,
      amount: pending.amount,
      currency: pending.currency,
      category: pending.category,
      accountId: pending.accountId,
      observedAt: executedAt,
      ownerId: (pending as { ownerId?: string | null }).ownerId ?? undefined,
    }, "pending_execution");
    if (!transaction) throw new Error("Financial transaction could not be created");
    await db.query(
      `
        update pending_financial_transactions
        set status = 'executed', executed_at = $2::timestamptz,
            executed_transaction_id = $3, updated_at = now()
        where id = $1 and status = 'pending'
      `,
      [id, executedAt, transaction.id],
    );
    return transaction;
  });
}

export async function cancelPendingFinancialTransaction(id: string) {
  await ensurePendingFinancialTransactionsSchema();
  const result = await pool.query(
    `
      update pending_financial_transactions
      set status = 'cancelled', cancelled_at = now(), updated_at = now()
      where id = $1 and status = 'pending'
    `,
    [id],
  );
  return Boolean(result.rowCount);
}

export async function updateFinancialTransactionContext(
  id: string,
  input: {
    title?: string;
    category?: string | null;
    amount?: number | string;
    accountId?: string | null;
    destinationAccountId?: string | null;
    destinationAmount?: number | string | null;
    destinationCurrency?: "UYU" | "USD" | null;
    currency?: "UYU" | "USD";
    kind?: "expense" | "income" | "transfer";
  },
) {
  if (input.accountId || input.destinationAccountId) {
    const compatibility = await pool.query<{ matches: boolean }>(
      `
        select exists (
          select 1
          from financial_transactions t
          left join financial_accounts source on source.id = $2
          left join financial_accounts destination on destination.id = $3
          where t.id = $1
            and ($2::text is null or source.currency = coalesce($4, t.currency))
            and ($3::text is null or destination.currency = coalesce($5, t.destination_currency, t.currency))
        ) as matches
      `,
      [id, input.accountId ?? null, input.destinationAccountId ?? null, input.currency ?? null, input.destinationCurrency ?? null],
    );
    if (!compatibility.rows[0]?.matches) {
      throw new Error("The account currency must match the transaction currency");
    }
  }
  if (input.kind === "transfer" && input.accountId && input.destinationAccountId && input.accountId === input.destinationAccountId) {
    throw new Error("A transfer must use two different accounts");
  }
  const hasCategory = Object.hasOwn(input, "category");
  const hasAccount = Object.hasOwn(input, "accountId");
  const hasDestinationAccount = Object.hasOwn(input, "destinationAccountId");
  const hasDestinationAmount = Object.hasOwn(input, "destinationAmount");
  const hasDestinationCurrency = Object.hasOwn(input, "destinationCurrency");
  const result = await withTransaction(async db => {
    const context = process.env.BRAINIA_LEARNING_ENABLED === 'true'
      ? (await db.query('select e.id,e.client_id from financial_transactions t join raw_events e on e.id=t.anchor_event_id where t.id=$1',[id])).rows[0]
      : null;
    const before = context ? await correctionSnapshot(db,context.id) : null;
    const updated = await db.query(`
    update financial_transactions
    set title_override = coalesce($2, title_override),
        category = case when $11 then $3 else category end,
        amount = coalesce($4::numeric, amount),
        amount_confirmed = case when $4::numeric is not null then true else amount_confirmed end,
        currency = coalesce($7, currency),
        currency_status = case when $7::text is not null then 'user_confirmed' else currency_status end,
        currency_provenance = case when $7::text is not null then 'user_edit' else currency_provenance end,
        account_id = case when $12 then $5 else account_id end,
        destination_account_id = case when $13 then $6 else destination_account_id end,
        kind = coalesce($8, kind),
        destination_amount = case
          when coalesce($8, kind) <> 'transfer' then null
          when $14 then $9::numeric
          else destination_amount
        end,
        destination_currency = case
          when coalesce($8, kind) <> 'transfer' then null
          when $15 then $10
          else destination_currency
        end,
        updated_at = now()
    where id = $1
      and hidden_at is null
    returning id
  `, [
      id,
      input.title?.trim() || null,
      input.category?.trim() || null,
      input.amount === undefined || input.amount === null ? null : toExactAmount(input.amount),
      input.accountId ?? null,
      input.destinationAccountId ?? null,
      input.currency ?? null,
      input.kind ?? null,
      input.destinationAmount === undefined || input.destinationAmount === null ? null : toExactAmount(input.destinationAmount),
      input.destinationCurrency ?? null,
      hasCategory,
      hasAccount,
      hasDestinationAccount,
      hasDestinationAmount,
      hasDestinationCurrency,
    ]);
    if (updated.rowCount && context && before) {
      const after=await correctionSnapshot(db,context.id);
      for (const [field,value] of [['category',input.category],['inferredKind',input.kind]]) {
        if (!value) continue;
        const correction=await recordCorrection(db,{clientId:context.client_id,eventId:context.id,field:field!,value,reusable:true});
        await db.query('update classification_corrections set previous_value=$2 where id=$1',[correction.id,JSON.stringify({before,after})]);
      }
    }
    return updated;
  });


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
        e.amount_role as "amountRole",
        e.currency,
        e.currency_status as "currencyStatus",
        e.currency_provenance as "currencyProvenance",
        e.raw_amount_text as "rawAmountText",
        e.amount_confirmed as "amountConfirmed",
        e.native_reference as "nativeReference",
        e.reference_namespace as "referenceNamespace",
        e.review_reasons as "reviewReasons",
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

async function loadFinancialTransactionEvidenceBatch(db: Queryable, transactionIds: string[]) {
  if (!transactionIds.length) {
    return new Map<string, FinancialTransactionEvidenceRecord[]>();
  }

  const result = await db.query<FinancialTransactionEvidenceRecord & { ownerTransactionId: string }>(
    `
      select
        e.id,
        e.transaction_id as "transactionId",
        coalesce(t.merged_into_transaction_id, e.transaction_id) as "ownerTransactionId",
        e.raw_event_id as "rawEventId",
        e.source,
        e.kind,
        e.amount::text as "amount",
        e.amount_role as "amountRole",
        e.currency,
        e.currency_status as "currencyStatus",
        e.currency_provenance as "currencyProvenance",
        e.raw_amount_text as "rawAmountText",
        e.amount_confirmed as "amountConfirmed",
        e.native_reference as "nativeReference",
        e.reference_namespace as "referenceNamespace",
        e.review_reasons as "reviewReasons",
        e.merchant_label as "merchantLabel",
        e.normalized_merchant as "normalizedMerchant",
        e.observed_at as "observedAt",
        e.match_score as "matchScore",
        e.match_reason as "matchReason",
        e.created_at as "createdAt"
      from financial_transaction_events e
      join financial_transactions t on t.id = e.transaction_id
      where e.transaction_id = any($1::text[])
         or t.merged_into_transaction_id = any($1::text[])
      order by e.created_at asc
    `,
    [transactionIds],
  );

  const evidenceByTransaction = new Map<string, FinancialTransactionEvidenceRecord[]>();
  for (const transactionId of transactionIds) {
    evidenceByTransaction.set(transactionId, []);
  }
  for (const { ownerTransactionId, ...evidence } of result.rows) {
    evidenceByTransaction.get(ownerTransactionId)?.push(evidence);
  }
  return evidenceByTransaction;
}

export async function loadFinancialTransactionById(db: Queryable, id: string, ownerId?: string) {
  const result = await db.query<FinancialTransactionRecord>(
    `
      ${buildTransactionProjectionSql()}
      -- Some previously released mobile clients linked a detail view using the
      -- captured event id instead of the financial record id. Keep the
      -- canonical id as the first match, but resolve either event reference so
      -- an otherwise valid movement never opens as unavailable.
      where (
        t.id = $1
        or t.anchor_event_id = $1
        or exists (
          select 1
          from financial_transaction_events evidence_reference
          where evidence_reference.transaction_id = t.id
            and evidence_reference.raw_event_id = $1
        )
      )
        and t.hidden_at is null
        and (
          $2::text is null
          or t.owner_id = $2
          or (
            t.owner_id is null
            and exists (
              select 1 from financial_transaction_events owner_evidence
              join raw_events owner_event on owner_event.id = owner_evidence.raw_event_id
              where owner_evidence.transaction_id = t.id and owner_event.client_id = $2
            )
          )
        )
      order by case when t.id = $1 then 0 else 1 end
      limit 1
    `,
    [id, ownerId ?? null],
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
  range: { from?: string; to?: string; ownerId?: string } = {},
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
  if (range.ownerId) {
    params.push(range.ownerId);
    filters.push(`(
      t.owner_id = $${params.length}
      or (
        t.owner_id is null
        and exists (
          select 1 from financial_transaction_events owner_evidence
          join raw_events owner_event on owner_event.id = owner_evidence.raw_event_id
          where owner_evidence.transaction_id = t.id and owner_event.client_id = $${params.length}
        )
      )
    )`);
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

  const evidenceByTransaction = await loadFinancialTransactionEvidenceBatch(
    pool,
    result.rows.map((transaction) => transaction.id),
  );
  const items = result.rows.map((transaction) => ({
    ...transaction,
    evidence: evidenceByTransaction.get(transaction.id) ?? [],
  }));

  return items;
}

type FinancialSummaryScope = {
  from: string;
  to: string;
  ownerId?: string;
  accountId?: string;
};

function summaryScopeFilters(input: FinancialSummaryScope, params: unknown[]) {
  const filters: string[] = [];
  params.push(input.from);
  filters.push(`t.observed_at >= $${params.length}::timestamptz`);
  params.push(input.to);
  filters.push(`t.observed_at <= $${params.length}::timestamptz`);
  if (input.accountId) {
    params.push(input.accountId);
    filters.push(`(t.account_id = $${params.length} or t.destination_account_id = $${params.length})`);
  }
  if (input.ownerId) {
    params.push(input.ownerId);
    filters.push(`(
      t.owner_id = $${params.length}
      or (
        t.owner_id is null
        and exists (
          select 1 from financial_transaction_events owner_evidence
          join raw_events owner_event on owner_event.id = owner_evidence.raw_event_id
          where owner_evidence.transaction_id = t.id and owner_event.client_id = $${params.length}
        )
      )
    )`);
  }
  return filters;
}

export async function getFinancialSummary(input: {
  from: string;
  to: string;
  ownerId?: string;
  accountId?: string;
  conversionTo?: string;
  fxRateId?: string;
}): Promise<FinancialSummary> {
  const params: unknown[] = [];
  const filters = [
    "t.hidden_at is null",
    "t.excluded_from_reports = false",
    "t.amount_confirmed = true",
    "t.currency_status in ('explicit', 'account_confirmed', 'user_confirmed')",
    "t.currency <> 'UNKNOWN'",
    "t.kind <> 'transfer'",
    "not (t.review_reasons ? 'native_reference_conflict')",
  ];
  filters.push(...summaryScopeFilters(input, params));

  // Report totals aggregate canonical transaction rows once. Evidence tables are
  // never joined into the sum, so a duplicated/merged evidence link cannot
  // multiply a total.
  const totalsResult = await pool.query<{
    currency: string;
    income: string;
    expense: string;
    transactionCount: number;
  }>(
    `
      select
        upper(t.currency) as currency,
        coalesce(sum(case when t.kind = 'income' then t.amount else 0 end), 0)::text as income,
        coalesce(sum(case when t.kind = 'expense' then t.amount else 0 end), 0)::text as expense,
        count(*)::int as "transactionCount"
      from financial_transactions t
      where ${filters.join(" and ")}
        and upper(t.currency) in ('ARS', 'BRL', 'CLP', 'COP', 'EUR', 'GBP', 'MXN', 'PEN', 'USD', 'UYU')
        and t.amount_confirmed = true
      group by upper(t.currency)
      order by upper(t.currency) asc
    `,
    params,
  );

  const totals = totalsResult.rows.map((row) => ({
    currency: row.currency,
    income: quantizeDecimal(row.income, 2),
    expense: quantizeDecimal(row.expense, 2),
    refunds: "0.00",
    net: quantizeDecimal(subtractDecimal(row.income, row.expense), 2),
    transactionCount: row.transactionCount,
  }));

  const excludedParams: unknown[] = [];
  const excludedFilters = [
    "t.hidden_at is null",
    "t.excluded_from_reports = false",
    "t.kind <> 'transfer'",
  ];
  excludedFilters.push(...summaryScopeFilters(input, excludedParams));
  const excludedResult = await pool.query<{
    ambiguous: number;
    unsupported: number;
    unknown: number;
    unconfirmedAmount: number;
  }>(
    `
      select
        count(*) filter (where t.currency_status = 'ambiguous')::int as ambiguous,
        count(*) filter (where t.currency_status = 'unsupported')::int as unsupported,
        count(*) filter (
          where upper(t.currency) = 'UNKNOWN'
            and t.currency_status not in ('ambiguous', 'unsupported')
        )::int as unknown,
        count(*) filter (where t.amount_confirmed = false or t.review_reasons ? 'native_reference_conflict')::int as "unconfirmedAmount"
      from financial_transactions t
      where ${excludedFilters.join(" and ")}
    `,
    excludedParams,
  );
  const excludedCounts = excludedResult.rows[0] ?? { ambiguous: 0, unsupported: 0, unknown: 0, unconfirmedAmount: 0 };

  const pendingParams = input.ownerId ? [input.ownerId] : [];
  const pendingResult = await pool.query<{ count: number }>(
    `
      select count(*)::int as count
      from pending_financial_transactions
      where status = 'pending'
        ${input.ownerId ? "and owner_id = $1" : ""}
    `,
    pendingParams,
  );

  let conversion: FinancialSummary["conversion"] = null;
  if (input.conversionTo) {
    const toCurrency = input.conversionTo.trim().toUpperCase();
    if (!input.fxRateId) throw new Error("fx_rate_required");
    if (!isSupportedCurrency(toCurrency)) throw new Error("unsupported_conversion_currency");
    if (totals.length > 1) throw new Error("fx_rate_scope_unsupported");
    const rateResult = await pool.query<{
      id: string;
      rate: string;
      asOf: string;
      provider: string;
      baseCurrency: string;
      quoteCurrency: string;
      approved: boolean;
    }>(
      `select id, rate::text as rate, as_of as "asOf", provider,
              base_currency as "baseCurrency", quote_currency as "quoteCurrency",
              approved
       from fx_rates where id = $1`,
      [input.fxRateId],
    );
    const rate = rateResult.rows[0];
    if (!rate) throw new Error("fx_rate_not_found");
    if (!rate.approved) throw new Error("fx_rate_unapproved");
    if (rate.quoteCurrency.toUpperCase() !== toCurrency) throw new Error("fx_rate_quote_mismatch");
    const source = totals[0];
    if (source && rate.baseCurrency.toUpperCase() !== source.currency) {
      throw new Error("fx_rate_base_mismatch");
    }
    const sourceNet = source?.net ?? "0.00";
    conversion = {
      rateId: rate.id,
      rate: normalizeDecimal(rate.rate) ?? rate.rate,
      asOf: rate.asOf,
      provider: rate.provider,
      toCurrency,
      amount: quantizeDecimal(multiplyDecimal(sourceNet, rate.rate), 2),
    };
  }

  return {
    from: input.from,
    to: input.to,
    asOf: new Date().toISOString(),
    totals,
    excluded: {
      ambiguous: excludedCounts.ambiguous,
      unsupported: excludedCounts.unsupported,
      pending: pendingResult.rows[0]?.count ?? 0,
    },
    conversion,
  };
}

/**
 * Internal accounting for rows that the wire contract does not expose. The v2
 * summary schema is closed (`additionalProperties: false`), so legacy UNKNOWN
 * and unconfirmed counts must not be added to `excluded`. Callers that need
 * diagnostics can use this helper; the HTTP response stays contract-exact.
 */
export async function getFinancialSummaryExclusionDiagnostics(input: {
  from: string;
  to: string;
  ownerId?: string;
  accountId?: string;
}): Promise<FinancialSummaryExclusionDiagnostics> {
  const params: unknown[] = [];
  const filters = [
    "t.hidden_at is null",
    "t.excluded_from_reports = false",
    "t.kind <> 'transfer'",
  ];
  filters.push(...summaryScopeFilters(input, params));
  const result = await pool.query<FinancialSummaryExclusionDiagnostics>(
    `
      select
        count(*) filter (
          where upper(t.currency) = 'UNKNOWN'
            and t.currency_status not in ('ambiguous', 'unsupported')
        )::int as unknown,
        count(*) filter (where t.amount_confirmed = false or t.review_reasons ? 'native_reference_conflict')::int as "unconfirmedAmount"
      from financial_transactions t
      where ${filters.join(" and ")}
    `,
    params,
  );
  return result.rows[0] ?? { unknown: 0, unconfirmedAmount: 0 };
}

type NativeReferenceMatch = {
  match: FinancialTransactionCandidateMatch | null;
  conflict: boolean;
};

const CANDIDATE_MATCH_COLUMNS = `
  t.id, t.kind, t.amount::text as "amount", t.amount_role as "amountRole",
  t.currency, t.currency_status as "currencyStatus", t.currency_provenance as "currencyProvenance",
  t.raw_amount_text as "rawAmountText", t.amount_confirmed as "amountConfirmed",
  t.native_reference as "nativeReference", t.reference_namespace as "referenceNamespace",
  t.converted_amount::text as "convertedAmount", t.converted_currency as "convertedCurrency",
  t.fx_rate_id as "fxRateId", t.fx_rate::text as "fxRate", t.review_reasons as "reviewReasons",
  t.merchant_label as "merchantLabel", t.normalized_merchant as "normalizedMerchant",
  t.merchant_entity_id as "merchantEntityId", t.observed_at as "observedAt",
  t.window_start as "windowStart", t.window_end as "windowEnd",
  t.evidence_count as "evidenceCount", t.match_score as "matchScore",
  t.match_strategy as "matchStrategy", t.primary_source as "primarySource",
  t.anchor_event_id as "anchorEventId", t.created_at as "createdAt", t.updated_at as "updatedAt"
`;

async function findNativeReferenceMatch(
  db: Queryable,
  candidate: FinancialTransactionCandidate,
  ownerId: string | null,
  legacyClientId: string | null,
): Promise<NativeReferenceMatch> {
  if (!candidate.nativeReference || !candidate.referenceNamespace) {
    return { match: null, conflict: false };
  }

  const result = await db.query<FinancialTransactionCandidateMatch>(
    `
      select ${CANDIDATE_MATCH_COLUMNS},
        abs(extract(epoch from (t.observed_at - $4::timestamptz))) as "timeDiffSeconds"
      from financial_transactions t
      where (
          ($1::text is not null and t.owner_id = $1)
          or (
            $1::text is null
            and t.owner_id is null
            and exists(
              select 1 from raw_events owner_event
              where owner_event.id = t.anchor_event_id
                and owner_event.client_id is not distinct from $5
            )
          )
        )
        and t.reference_namespace = $2
        and t.native_reference = $3
        and t.hidden_at is null
      order by t.created_at desc
      limit 10
      for update of t
    `,
    [ownerId, candidate.referenceNamespace, candidate.nativeReference, candidate.observedAt, legacyClientId],
  );

  const rows = result.rows;
  if (!rows.length) return { match: null, conflict: false };

  // Look for a compatible observation before declaring a conflict. Several
  // distinct transactions may legitimately share a provider reference only if
  // their amount/currency/role/kind differ (kept for review), so the newest row
  // alone is not evidence of a conflict.
  const compatible = rows.find((row) =>
    compareDecimal(row.amount, candidate.amountDecimal) === 0 &&
    normalizeCurrency(row.currency) === normalizeCurrency(candidate.currency) &&
    isConfirmedCurrencyStatus(row.currencyStatus) &&
    isConfirmedCurrencyStatus(candidate.currencyStatus) &&
    row.amountRole === candidate.amountRole &&
    row.kind === candidate.kind
  );
  return compatible
    ? { match: compatible, conflict: false }
    : { match: null, conflict: true };
}

async function findPossibleDuplicateFinancialTransaction(
  db: Queryable,
  candidate: FinancialTransactionCandidate,
  ownerId: string | null,
): Promise<boolean> {
  // Same shape is a duplicate *candidate* for review, never proof of identity.
  // Without a verified native reference (or an explicit approved identity) we
  // must keep distinct observations distinct.
  if (!canAutoLinkFinancialCandidate(candidate) || candidate.nativeReference) return false;

  const window = candidateWindowBounds(candidate.observedAt, 6);
  const result = await db.query<{ id: string }>(
    `
      select t.id
      from financial_transactions t
      where t.kind = $1
        and $4::timestamptz is not null
        and $9::text is not null
        and t.hidden_at is null
        and t.amount = $2::numeric
        and upper(t.currency) = $3
        and t.currency_status in ('explicit', 'account_confirmed', 'user_confirmed')
        and t.amount_confirmed = true
        and t.amount_role = $11
        and t.native_reference is null
        and (
          ($12::text is not null and t.owner_id = $12)
          or (
            t.owner_id is null
            and exists(select 1 from raw_events owner_event
              where owner_event.id=t.anchor_event_id and owner_event.client_id is not distinct from
                (select client_id from raw_events where id=$10))
          )
        )
        and t.observed_at >= $5::timestamptz
        and t.observed_at <= $6::timestamptz
        and (
          ($7::text is not null and t.merchant_entity_id = $7)
          or lower(t.normalized_merchant) = $8
          or lower(t.merchant_label) = $8
        )
      limit 1
    `,
    [
      candidate.kind,
      candidate.amountDecimal,
      normalizeCurrency(candidate.currency),
      candidate.observedAt,
      window.start,
      window.end,
      candidate.merchantEntityId,
      candidate.normalizedMerchant,
      `%${candidate.normalizedMerchant.replace(/[\\%_]/g, "\\$&")}%`,
      candidate.eventId,
      candidate.amountRole,
      ownerId,
    ],
  );

  return Boolean(result.rows[0]);
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
        amount_role,
        currency,
        currency_status,
        currency_provenance,
        raw_amount_text,
        amount_confirmed,
        native_reference,
        reference_namespace,
        converted_amount,
        converted_currency,
        fx_rate_id,
        review_reasons,
        merchant_label,
        normalized_merchant,
        observed_at,
        match_score,
        match_reason
      ) values (
        $1, $2, $3, $4, $5, $6::numeric, $7, $8, $9, $10, $11, $12, $13, $14, $15::numeric, $16, $17, $18::jsonb, $19, $20, $21::timestamptz, $22, $23
      )
      on conflict (raw_event_id)
      do update set
        transaction_id = excluded.transaction_id,
        source = excluded.source,
        kind = excluded.kind,
        amount = excluded.amount,
        amount_role = excluded.amount_role,
        currency = excluded.currency,
        currency_status = excluded.currency_status,
        currency_provenance = excluded.currency_provenance,
        raw_amount_text = excluded.raw_amount_text,
        amount_confirmed = excluded.amount_confirmed,
        native_reference = excluded.native_reference,
        reference_namespace = excluded.reference_namespace,
        converted_amount = excluded.converted_amount,
        converted_currency = excluded.converted_currency,
        fx_rate_id = excluded.fx_rate_id,
        review_reasons = excluded.review_reasons,
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
      input.candidate.amountDecimal,
      input.candidate.amountRole,
      normalizeCurrency(input.candidate.currency),
      input.candidate.currencyStatus,
      input.candidate.currencyProvenance,
      input.candidate.rawAmountText,
      input.candidate.amountConfirmed,
      input.candidate.nativeReference,
      input.candidate.referenceNamespace,
      input.candidate.fxRateId ? input.candidate.convertedAmount : null,
      input.candidate.fxRateId ? input.candidate.convertedCurrency : null,
      input.candidate.fxRateId,
      JSON.stringify(input.candidate.reviewReasons),
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
        destination_account_id = coalesce($11, destination_account_id),
        destination_amount = coalesce($12::numeric, destination_amount),
        destination_currency = coalesce($13, destination_currency),
        category = coalesce($14, category),
        native_reference = coalesce(native_reference, $15),
        reference_namespace = coalesce(reference_namespace, $16),
        -- Uncertain evidence must never demote an already-confirmed canonical
        -- observation. Confirmation can only move forward.
        amount_confirmed = amount_confirmed or $17::boolean,
        review_reasons = review_reasons || $18::jsonb,
        updated_at = now()
      where id = $1
      returning
        id,
        kind,
        amount::text as "amount",
        amount_role as "amountRole",
        currency,
        currency_status as "currencyStatus",
        currency_provenance as "currencyProvenance",
        raw_amount_text as "rawAmountText",
        amount_confirmed as "amountConfirmed",
        native_reference as "nativeReference",
        reference_namespace as "referenceNamespace",
        review_reasons as "reviewReasons",
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
        account_id as "accountId",
        destination_account_id as "destinationAccountId",
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
      input.candidate.destinationAccountId,
      input.candidate.destinationAmountDecimal,
      input.candidate.destinationCurrency,
      input.candidate.category,
      input.candidate.nativeReference,
      input.candidate.referenceNamespace,
      input.candidate.amountConfirmed,
      JSON.stringify(input.candidate.reviewReasons),
    ],
  );

  return result.rows[0] ?? null;
}

async function createFinancialTransaction(
  db: Queryable,
  candidate: FinancialTransactionCandidate,
  matchScore: number,
  matchStrategy: string,
  ownerId: string | null,
) {
  const window = candidateWindowBounds(candidate.observedAt, 6);
  const result = await db.query<FinancialTransactionRecord>(
    `
      insert into financial_transactions (
        id,
        kind,
        amount,
        amount_role,
        currency,
        currency_status,
        currency_provenance,
        raw_amount_text,
        amount_confirmed,
        native_reference,
        reference_namespace,
        converted_amount,
        converted_currency,
        fx_rate_id,
        review_reasons,
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
        destination_account_id,
        destination_amount,
        destination_currency,
        category,
        owner_id
      ) values (
        $1, $2, $3::numeric, $21, $4, $22, $23, $24, $25, $26, $27,
        $28::numeric, $29, $30, $31::jsonb,
        $5, $6, $7, $8::timestamptz, $9::timestamptz, $10::timestamptz, 1, $11, $12, $13, $14, $15, $16, $17::numeric, $18, $19, $20
      )
      returning
        id,
        kind,
        amount::text as "amount",
        amount_role as "amountRole",
        currency,
        currency_status as "currencyStatus",
        currency_provenance as "currencyProvenance",
        raw_amount_text as "rawAmountText",
        amount_confirmed as "amountConfirmed",
        native_reference as "nativeReference",
        reference_namespace as "referenceNamespace",
        review_reasons as "reviewReasons",
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
        account_id as "accountId",
        destination_account_id as "destinationAccountId",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `,
    [
      `financial_${randomUUID()}`,
      candidate.kind,
      candidate.amountDecimal,
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
      candidate.destinationAccountId,
      candidate.destinationAmountDecimal,
      candidate.destinationCurrency,
      candidate.category,
      ownerId,
      candidate.amountRole,
      candidate.currencyStatus,
      candidate.currencyProvenance,
      candidate.rawAmountText,
      candidate.amountConfirmed,
      candidate.nativeReference,
      candidate.referenceNamespace,
      candidate.fxRateId ? candidate.convertedAmount : null,
      candidate.fxRateId ? candidate.convertedCurrency : null,
      candidate.fxRateId,
      JSON.stringify(candidate.reviewReasons),
    ],
  );

  return result.rows[0] ?? null;
}

type ResolvedFinancialAccount = {
  id: string | null;
  currency: string | null;
  reason: string | null;
};

async function resolveOwnedFinancialAccount(
  db: Queryable,
  accountId: string | null | undefined,
  ownerId: string | null,
): Promise<ResolvedFinancialAccount> {
  if (!accountId) return { id: null, currency: null, reason: null };
  const result = await db.query<{ currency: string | null; ownerId: string | null }>(
    `select currency, owner_id as "ownerId" from financial_accounts where id = $1`,
    [accountId],
  );
  const account = result.rows[0];
  if (!account) return { id: null, currency: null, reason: "event_account_not_found" };
  if ((account.ownerId ?? null) !== (ownerId ?? null)) {
    return { id: null, currency: null, reason: "foreign_account_ignored" };
  }
  return { id: accountId, currency: account.currency?.trim().toUpperCase() ?? null, reason: null };
}

export async function linkFinancialTransactionForEvent(
  db: Queryable,
  candidate: FinancialTransactionCandidate,
) {
  const ownerResult = await db.query<{ ownerId: string | null; clientId: string | null }>(
    `select owner_id as "ownerId", client_id as "clientId" from raw_events where id = $1`,
    [candidate.eventId],
  );
  const rawOwnerId = ownerResult.rows[0]?.ownerId ?? null;
  const legacyClientId = ownerResult.rows[0]?.clientId ?? null;
  // Real captures only populate `client_id`; `owner_id` is reserved for older or
  // explicitly scoped rows. The effective owner is therefore the authenticated
  // scope when `owner_id` is absent. Using it for account resolution, ledger
  // writes, matching and balances keeps own accounts attachable without ever
  // exposing a foreign account.
  const ownerId = rawOwnerId ?? legacyClientId;

  // Account attachment is an owner-scoped write. A raw payload may name any
  // account id, so resolve it against the event owner before it can reach the
  // ledger, a balance or an account label. Foreign ids are ignored and kept as
  // review evidence; they never mutate the other owner's account.
  const sourceAccount = await resolveOwnedFinancialAccount(db, candidate.accountId, ownerId);
  const destinationAccount = await resolveOwnedFinancialAccount(db, candidate.destinationAccountId, ownerId);
  const accountReviewReasons = [...candidate.reviewReasons];
  if (candidate.accountId && !sourceAccount.id) accountReviewReasons.push(sourceAccount.reason ?? "account_not_owned");
  if (candidate.destinationAccountId && !destinationAccount.id) {
    accountReviewReasons.push(destinationAccount.reason ?? "destination_account_not_owned");
  }
  let resolvedSource = sourceAccount;
  if (
    sourceAccount.id &&
    candidate.currencyStatus !== "ambiguous" &&
    isSupportedCurrency(candidate.currency) &&
    sourceAccount.currency !== normalizeCurrency(candidate.currency)
  ) {
    accountReviewReasons.push("account_currency_mismatch");
    resolvedSource = { id: null, currency: null, reason: null };
  }
  let resolvedDestination = destinationAccount;
  if (
    destinationAccount.id &&
    candidate.destinationCurrency &&
    destinationAccount.currency !== normalizeCurrency(candidate.destinationCurrency)
  ) {
    accountReviewReasons.push("destination_account_currency_mismatch");
    resolvedDestination = { id: null, currency: null, reason: null };
  }
  candidate = {
    ...candidate,
    accountId: resolvedSource.id,
    destinationAccountId: resolvedDestination.id,
    accountName: resolvedSource.id ? candidate.accountName : null,
    reviewReasons: [...new Set(accountReviewReasons)],
  };

  // Serialize each owner's native reference and matching/create/count sequence.
  // Native references lock on the scoped reference, not on every movement of
  // the owner, so unrelated captures cannot serialize each other.
  const lockKey = candidate.nativeReference && candidate.referenceNamespace
    ? `finance-ref:${ownerId ?? legacyClientId ?? "anonymous"}:${candidate.referenceNamespace}:${candidate.nativeReference}`
    : `finance-owner:${ownerId ?? legacyClientId ?? "anonymous"}`;
  await db.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [lockKey]);

  // An owned account with a confirmed currency is verified evidence for a bare
  // dollar amount. It is the only automatic promotion allowed; without it the
  // observation stays ambiguous and out of confirmed totals.
  if (candidate.currencyStatus === "ambiguous" && candidate.accountId) {
    const accountCurrency = resolvedSource.currency;
    if (accountCurrency && isSupportedCurrency(accountCurrency)) {
      candidate = {
        ...candidate,
        currency: accountCurrency,
        currencyStatus: "account_confirmed",
        currencyProvenance: "account_currency",
        reviewReasons: candidate.reviewReasons.filter((reason) => reason !== "ambiguous_currency"),
      };
    }
  }

  if(process.env.BRAINIA_LEARNING_ENABLED==='true') {
    const learned=await db.query<{category:string|null}>("select model_metadata->>'confirmedCategory' as category from classified_events where raw_event_id=$1",[candidate.eventId]);
    if(learned.rows[0]?.category)candidate={...candidate,category:learned.rows[0].category};
  }
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

  const native = await findNativeReferenceMatch(db, candidate, ownerId, legacyClientId);
  if (native.conflict) {
    candidate = {
      ...candidate,
      reviewReasons: [...new Set([...candidate.reviewReasons, "native_reference_conflict"])],
    };
  }

  const existing = native.match;
  if (!existing && !native.conflict && await findPossibleDuplicateFinancialTransaction(db, candidate, ownerId)) {
    candidate = {
      ...candidate,
      reviewReasons: [...new Set([...candidate.reviewReasons, "possible_duplicate_pending_review"])],
    };
  }
  const matchScore = existing ? (existing.merchantEntityId === candidate.merchantEntityId ? 0.98 : 0.92) : 0.95;
  const matchReason = native.match
    ? "native_reference_match"
    : native.conflict
      ? "native_reference_conflict"
      : "new_financial_transaction";

  const transaction = existing
    ? await updateFinancialTransaction(db, {
        id: existing.id,
        candidate,
        matchScore,
        primarySource: candidate.source,
      })
    : await createFinancialTransaction(db, candidate, matchScore, candidate.matchStrategy, ownerId);

  if (!transaction) {
    throw new Error("Financial transaction could not be stored");
  }

  await storeFinancialTransactionEvidence(db, {
    transactionId: transaction.id,
    candidate,
    matchScore,
    matchReason,
  });

  const count = await db.query<{ evidenceCount: number }>(`
    update financial_transactions t set evidence_count=(
      select count(distinct evidence.id) from financial_transaction_events evidence
      join financial_transactions linked on linked.id=evidence.transaction_id
      where coalesce(linked.merged_into_transaction_id,linked.id)=t.id)
    where t.id=$1 returning evidence_count::int as "evidenceCount"
  `, [transaction.id]);
  transaction.evidenceCount=count.rows[0].evidenceCount;
  return {
    transaction,
    matchScore,
    matchReason,
    matchedExisting: Boolean(existing),
  };
}

// B04: the previous event-wide finance orphan sweep was removed. Financial
// evidence is only deleted by an explicit, user-requested data control; a
// projection rebuild must never garbage-collect canonical finance rows.
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
    const isExpenseDuplicatingTransfer = canonical.kind === "transfer" && duplicate.kind === "expense";
    if (canonical.kind !== duplicate.kind && !isExpenseDuplicatingTransfer) {
      throw new Error("Only transactions of the same type can be consolidated, except an expense duplicated by a transfer");
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
          select count(distinct evidence.raw_event_id)
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

/** Records "this notification is not a transaction" as reusable supervision. */
export async function markFinancialTransactionFalsePositive(id: string) {
  return withTransaction(async (db) => {
    const result = await db.query<{ id: string; anchorEventId: string | null; clientId: string | null }>(
      `select t.id, t.anchor_event_id as "anchorEventId", event.client_id as "clientId"
       from financial_transactions t
       join raw_events event on event.id = t.anchor_event_id
       where t.id = $1 and t.hidden_at is null
       for update of t`,
      [id],
    );
    const transaction = result.rows[0];
    if (!transaction?.anchorEventId) return null;

    const correction = await recordCorrection(db, {
      clientId: transaction.clientId,
      eventId: transaction.anchorEventId,
      field: "inferredKind",
      value: "other",
      reusable: true,
    });
    await applyCorrectionProjection(db, transaction.anchorEventId, "inferredKind", "other");
    await db.query(
      `update financial_transactions
       set hidden_at = now(), merged_into_transaction_id = null, updated_at = now()
       where id = $1`,
      [id],
    );
    return { id, correctionId: correction.id };
  });
}
