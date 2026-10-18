import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { buildApp } from "../src/app.ts";
import type { AuthConfig } from "../src/auth.ts";
import {
  buildFinancialTransactionCandidate,
  type FinancialTransactionCandidate,
} from "../src/domain/financial-transactions.ts";
import {
  addDecimal,
  compareDecimal,
  multiplyDecimal,
  normalizeDecimal,
  parseLocalizedMoneyDecimal,
  quantizeDecimal,
  subtractDecimal,
} from "../src/domain/money.ts";
import {
  createManualFinancialTransaction,
  getFinancialSummary,
  getFinancialSummaryExclusionDiagnostics,
  linkFinancialTransactionForEvent,
  listFinancialAccounts,
  listFinancialTransactions,
  loadFinancialTransactionById,
  updateFinancialTransactionContext,
} from "../src/storage/financial-transaction-repository.ts";
import { insertRawEvent } from "../src/storage/event-repository.ts";
import { detectInsightCandidates } from "../src/storage/proactive-insights.ts";
import { collectIntelligenceEvidence } from "../src/storage/intelligence-evidence.ts";
import { pool, withTransaction } from "../src/storage/postgres.ts";

const OBSERVED_AT = "2026-05-01T12:00:00.000Z";
const RANGE = { from: "2026-04-30T00:00:00.000Z", to: "2026-05-02T00:00:00.000Z" };

async function rawEvent(ownerId: string, raw: Record<string, unknown>, options: {
  merchant?: string;
  observedAt?: string;
  kind?: "expense" | "income";
} = {}) {
  const id = randomUUID();
  const observedAt = options.observedAt ?? OBSERVED_AT;
  await insertRawEvent(pool, {
    id,
    source: String(raw.source ?? "test.b10"),
    contractVersion: 1,
    kind: options.kind ?? "expense",
    title: options.merchant ?? `B10 ${id.slice(0, 8)}`,
    body: "",
    timestamp: observedAt,
    raw,
    tags: [],
  }, ownerId, `${ownerId}:${id}`);
  await pool.query(`update raw_events set owner_id = $2 where id = $1`, [id, ownerId]);
  return id;
}

function candidateFor(ownerId: string, eventId: string, raw: Record<string, unknown>, options: {
  merchant?: string;
  observedAt?: string;
  kind?: "expense" | "income";
} = {}): FinancialTransactionCandidate {
  const amountText = String(raw.amount ?? "");
  const merchant = options.merchant ?? String(raw.merchant ?? "B10 merchant");
  const candidate = buildFinancialTransactionCandidate({
    event: {
      id: eventId,
      source: String(raw.source ?? "test.b10"),
      kind: "notification",
      title: merchant,
      body: "",
      timestamp: options.observedAt ?? OBSERVED_AT,
      raw,
    },
    classified: { inferredKind: options.kind ?? "expense", confidence: 1 },
    entityDrafts: [{ type: "amount", value: amountText, normalizedValue: amountText }],
    observedAt: options.observedAt ?? OBSERVED_AT,
  });
  assert.ok(candidate, `candidate should build for owner ${ownerId}`);
  return candidate;
}

async function link(ownerId: string, raw: Record<string, unknown>, options: Parameters<typeof rawEvent>[2] = {}) {
  const eventId = await rawEvent(ownerId, raw, options);
  const candidate = candidateFor(ownerId, eventId, raw, options);
  const result = await withTransaction((db) => linkFinancialTransactionForEvent(db, candidate));
  return { eventId, candidate, result };
}

async function createAccount(ownerId: string, currency: "UYU" | "USD") {
  const id = `account_b10_${randomUUID()}`;
  await pool.query(
    `insert into financial_accounts (id, name, type, currency, owner_id) values ($1, $2, 'bank', $3, $4)`,
    [id, `B10 ${id.slice(-6)}`, currency, ownerId],
  );
  return id;
}

test("B10 exact decimals, amount roles and original-vs-converted evidence", () => {
  assert.equal(parseLocalizedMoneyDecimal("1.733,00"), "1733.00");
  assert.equal(parseLocalizedMoneyDecimal("1,733.00"), "1733.00");
  assert.equal(parseLocalizedMoneyDecimal("1733,00"), "1733.00");
  assert.equal(parseLocalizedMoneyDecimal("4,00"), "4.00");
  assert.equal(parseLocalizedMoneyDecimal("U$S 4,00"), null);
  // Locale-ambiguous single separators and malformed grouping are rejected, not
  // silently rescaled to a 100x/1000x different amount.
  for (const malformed of ["1.733", "1,733", "100.000", "1.2.3", "12.34.56", "1,23,456"]) {
    assert.equal(parseLocalizedMoneyDecimal(malformed), null, malformed);
  }
  assert.equal(parseLocalizedMoneyDecimal("1.733.000,00"), "1733000.00");
  assert.equal(addDecimal("0.1", "0.2"), "0.3");
  assert.equal(addDecimal("152.46", "4.00"), "156.46");
  assert.equal(subtractDecimal("195.00", "0.005"), "194.995");
  assert.equal(quantizeDecimal("2.345", 2), "2.35");
  assert.equal(quantizeDecimal("2.344", 2), "2.34");
  assert.equal(multiplyDecimal("125.505", "38.5"), "4831.9425");
  assert.equal(compareDecimal("4.00", "4"), 0);
  assert.equal(normalizeDecimal("0012.30"), "12.30");

  const owner = `owner-decimals-${randomUUID()}`;
  const uyuEvent = randomUUID();
  const uyu = candidateFor(owner, uyuEvent, { amount: "152,46", currency: "UYU", merchant: "Bodega", amountRole: "purchase" });
  assert.equal(uyu.amountDecimal, "152.46");
  assert.equal(uyu.amount, 152.46);
  assert.equal(uyu.currency, "UYU");
  assert.equal(uyu.currencyStatus, "explicit");
  assert.equal(uyu.amountRole, "purchase");
  assert.equal(uyu.rawAmountText, "152,46");

  const usdEvent = randomUUID();
  const usd = candidateFor(owner, usdEvent, { amount: "4,00", currency: "USD", merchant: "Patreon" });
  assert.equal(usd.amountDecimal, "4.00");
  assert.equal(usd.currency, "USD");
  assert.equal(usd.currencyStatus, "explicit");

  const convertedEvent = randomUUID();
  const converted = candidateFor(owner, convertedEvent, {
    amount: "100,00",
    currency: "USD",
    merchant: "Converter",
    convertedAmount: "3800,50",
    convertedCurrency: "UYU",
    fxRateId: "fx_b10_test",
  });
  assert.equal(converted.amountDecimal, "100.00");
  assert.equal(converted.convertedAmount, "3800.50");
  assert.equal(converted.convertedCurrency, "UYU");
  assert.equal(converted.fxRateId, "fx_b10_test");

  const excessEvent = randomUUID();
  const excess = candidateFor(owner, excessEvent, { amount: "2.3450", currency: "UYU", merchant: "Excess" });
  assert.equal(excess.amountDecimal, "2.35");
  assert.equal(excess.amountConfirmed, false);
  assert.ok(excess.reviewReasons.includes("amount_precision_excess"));
});

test("B10 bare dollar is ambiguous unless an owned account confirms it", async () => {
  const owner = `owner-ambiguous-${randomUUID()}`;
  const ambiguous = await link(owner, { amount: "$ 195,00", merchant: "Ambiguous Shop", source: "test.b10" });
  assert.equal(ambiguous.candidate.currencyStatus, "ambiguous");
  assert.equal(ambiguous.candidate.currency, "UNKNOWN");
  assert.equal(ambiguous.candidate.currencyProvenance, "ambiguous_dollar_symbol");
  assert.ok(ambiguous.candidate.reviewReasons.includes("ambiguous_currency"));
  assert.equal(ambiguous.result.transaction?.currencyStatus, "ambiguous");
  assert.equal(ambiguous.result.transaction?.currency, "UNKNOWN");

  let summary = await getFinancialSummary({ ownerId: owner, ...RANGE });
  assert.deepEqual(summary.totals, []);
  assert.equal(summary.excluded.ambiguous, 1);

  const accountId = await createAccount(owner, "UYU");
  const confirmed = await link(owner, {
    amount: "$ 100,00",
    merchant: "Confirmed Shop",
    accountId,
    source: "test.b10",
  });
  assert.equal(confirmed.result.transaction?.currencyStatus, "account_confirmed");
  assert.equal(confirmed.result.transaction?.currencyProvenance, "account_currency");
  assert.equal(confirmed.result.transaction?.currency, "UYU");

  summary = await getFinancialSummary({ ownerId: owner, ...RANGE });
  assert.equal(summary.totals.length, 1);
  assert.equal(summary.totals[0].currency, "UYU");
  assert.equal(summary.totals[0].expense, "100.00");
  assert.equal(summary.excluded.ambiguous, 1);
});

test("B10 unsupported currency stays explicit evidence but never enters confirmed totals", async () => {
  const owner = `owner-unsupported-${randomUUID()}`;
  const linked = await link(owner, { amount: "1000", currency: "JPY", merchant: "Tokyo Store", source: "test.b10" });
  assert.equal(linked.candidate.currency, "JPY");
  assert.equal(linked.candidate.currencyStatus, "unsupported");
  assert.ok(linked.candidate.reviewReasons.includes("unsupported_currency"));

  const summary = await getFinancialSummary({ ownerId: owner, ...RANGE });
  assert.deepEqual(summary.totals, []);
  assert.equal(summary.excluded.unsupported, 1);
});

test("B10 same amount/time without a native reference never auto-merges", async () => {
  const owner = `owner-ambiguous-merge-${randomUUID()}`;
  const merchant = "Same Amount Merchant";
  const first = await link(owner, { amount: "100,00", currency: "UYU", merchant, source: "test.b10" });
  const second = await link(owner, { amount: "$ 100,00", merchant, source: "test.b10" });

  assert.notEqual(first.result.transaction?.id, second.result.transaction?.id);
  assert.equal(second.result.matchedExisting, false);

  const rows = await pool.query<{ id: string; count: number }>(
    `select id, count(*) over ()::int as count from financial_transactions where owner_id = $1`,
    [owner],
  );
  assert.equal(rows.rows[0]?.count, 2);

  // Even a clear observation with the same merchant/amount/time/currency/role
  // stays a separate observation and is queued for review. Only identity
  // evidence (native reference) may consolidate.
  const third = await link(owner, { amount: "100,00", currency: "UYU", merchant, source: "test.b10" });
  assert.notEqual(third.result.transaction?.id, first.result.transaction?.id);
  assert.equal(third.result.matchedExisting, false);
  const thirdRow = await pool.query<{ reasons: string[] }>(
    `select review_reasons as reasons from financial_transactions where id = $1`,
    [third.result.transaction!.id],
  );
  assert.ok(thirdRow.rows[0]?.reasons.includes("possible_duplicate_pending_review"));

  const summary = await getFinancialSummary({ ownerId: owner, ...RANGE });
  assert.equal(summary.totals.find((total) => total.currency === "UYU")?.expense, "200.00");
  assert.equal(summary.totals.find((total) => total.currency === "UYU")?.transactionCount, 2);
});

test("B10 native-reference conflicts never auto-merge and matching scoped references do", async () => {
  const owner = `owner-reference-${randomUUID()}`;
  const reference = `REF-${randomUUID()}`;
  const merchant = "Reference Merchant";
  const first = await link(owner, { amount: "100,00", currency: "UYU", merchant, reference, source: "test.b10" });
  const conflict = await link(owner, { amount: "120,00", currency: "UYU", merchant, reference, source: "test.b10" });

  assert.notEqual(first.result.transaction?.id, conflict.result.transaction?.id);
  assert.equal(conflict.result.matchReason, "native_reference_conflict");
  const conflictRow = await pool.query<{ reasons: string[] }>(
    `select review_reasons as reasons from financial_transactions where id = $1`,
    [conflict.result.transaction!.id],
  );
  assert.ok(conflictRow.rows[0]?.reasons.includes("native_reference_conflict"));

  const replay = await link(owner, { amount: "100,00", currency: "UYU", merchant, reference, source: "test.b10" });
  assert.equal(replay.result.transaction?.id, first.result.transaction?.id);
  assert.equal(replay.result.matchReason, "native_reference_match");
});

test("B10 evidence joins count distinct observations and cannot inflate report totals", async () => {
  const owner = `owner-evidence-${randomUUID()}`;
  const merchant = "Evidence Merchant";
  const reference = `EVID-${randomUUID()}`;
  const first = await link(owner, { amount: "50,00", currency: "UYU", merchant, reference, source: "test.b10" });
  const second = await link(owner, { amount: "50,00", currency: "UYU", merchant, reference, source: "test.b10" });
  const third = await link(owner, { amount: "50,00", currency: "UYU", merchant, reference, source: "test.b10" });

  assert.equal(second.result.transaction?.id, first.result.transaction?.id);
  assert.equal(third.result.transaction?.id, first.result.transaction?.id);
  assert.equal(second.result.matchReason, "native_reference_match");
  assert.equal(third.result.matchReason, "native_reference_match");

  const detail = await loadFinancialTransactionById(pool, first.result.transaction!.id);
  assert.equal(detail?.evidenceCount, 3);
  assert.equal(detail?.evidence?.length, 3);

  const summary = await getFinancialSummary({ ownerId: owner, ...RANGE });
  assert.equal(summary.totals.length, 1);
  assert.equal(summary.totals[0].currency, "UYU");
  assert.equal(summary.totals[0].expense, "50.00");
  assert.equal(summary.totals[0].transactionCount, 1);
});

test("B10 reports group by original currency and reject implicit conversion", async () => {
  const owner = `owner-groups-${randomUUID()}`;
  await createManualFinancialTransaction({
    title: "UYU expense", kind: "expense", amount: "100.00", currency: "UYU",
    observedAt: OBSERVED_AT, ownerId: owner,
  });
  await createManualFinancialTransaction({
    title: "USD income", kind: "income", amount: "10.00", currency: "USD",
    observedAt: OBSERVED_AT, ownerId: owner,
  });
  await createManualFinancialTransaction({
    title: "Foreign owner expense", kind: "expense", amount: "999.00", currency: "USD",
    observedAt: OBSERVED_AT, ownerId: `other-${owner}`,
  });

  const summary = await getFinancialSummary({ ownerId: owner, ...RANGE });
  assert.deepEqual(summary.totals.map((total) => total.currency), ["USD", "UYU"]);
  assert.equal(summary.totals.find((total) => total.currency === "USD")?.income, "10.00");
  assert.equal(summary.totals.find((total) => total.currency === "UYU")?.expense, "100.00");
  assert.equal(summary.conversion, null);

  const app = await buildApp();
  try {
    const implicit = await app.inject({ method: "GET", url: "/api/v1/financial/summary?conversionTo=USD" });
    assert.equal(implicit.statusCode, 400);
    assert.equal((implicit.json() as { error: string }).error, "invalid_financial_summary_query");
  } finally {
    await app.close();
  }

  const rateId = `fx_${randomUUID()}`;
  await pool.query(
    `insert into fx_rates (id, base_currency, quote_currency, rate, as_of, provider, approved)
     values ($1, 'UYU', 'USD', 0.025, $2::timestamptz, 'test', true)`,
    [rateId, OBSERVED_AT],
  );
  await assert.rejects(
    getFinancialSummary({ ownerId: owner, ...RANGE, conversionTo: "USD", fxRateId: rateId }),
    /fx_rate_scope_unsupported/,
  );

  const singleOwner = `owner-single-${randomUUID()}`;
  await createManualFinancialTransaction({
    title: "Single currency", kind: "expense", amount: "100.00", currency: "UYU",
    observedAt: OBSERVED_AT, ownerId: singleOwner,
  });
  const converted = await getFinancialSummary({
    ownerId: singleOwner,
    ...RANGE,
    conversionTo: "USD",
    fxRateId: rateId,
  });
  assert.equal(converted.totals[0].expense, "100.00");
  assert.equal(converted.conversion?.rateId, rateId);
  assert.equal(converted.conversion?.amount, "-2.50");
});

test("B10 explicit amount correction preserves exact values and the correction overlay", async () => {
  const owner = `owner-correction-${randomUUID()}`;
  const transaction = await createManualFinancialTransaction({
    title: "Original amount", kind: "expense", amount: "12.34", currency: "UYU",
    observedAt: OBSERVED_AT, ownerId: owner,
  });
  assert.ok(transaction);
  const updated = await updateFinancialTransactionContext(transaction.id, {
    amount: "125.50",
    category: "Food",
  });
  assert.ok(updated);
  assert.equal(updated.amount, "125.50");
  assert.equal(updated.category, "Food");
  assert.equal(updated.amountConfirmed, true);

  const summary = await getFinancialSummary({ ownerId: owner, ...RANGE });
  assert.equal(summary.totals.find((total) => total.currency === "UYU")?.expense, "125.50");
});

test("D1 event ingestion never attaches a transaction to another owner's account", async () => {
  const ownerA = `owner-d1-a-${randomUUID()}`;
  const ownerB = `owner-d1-b-${randomUUID()}`;
  const bAccount = await createAccount(ownerB, "UYU");
  const other = await createAccount(ownerA, "UYU");

  const linked = await link(ownerA, {
    amount: "55,00",
    currency: "UYU",
    merchant: "Foreign account capture",
    accountId: bAccount,
    destinationAccountId: bAccount,
    source: "test.b10",
  });

  assert.equal(linked.result.transaction?.accountId, null);
  assert.equal(linked.result.transaction?.destinationAccountId, null);
  const stored = await pool.query<{ accountId: string | null; reasons: string[] }>(
    `select account_id as "accountId", review_reasons as reasons
     from financial_transactions where id = $1`,
    [linked.result.transaction!.id],
  );
  assert.equal(stored.rows[0]?.accountId, null);
  assert.ok(stored.rows[0]?.reasons.includes("foreign_account_ignored"));

  const bAccounts = await listFinancialAccounts(ownerB);
  const bState = bAccounts.find((account) => account.id === bAccount);
  assert.ok(bState);
  assert.equal(Number(bState!.balance), 0, "owner B balance must not change");

  const aTransactions = await listFinancialTransactions(50, { ownerId: ownerA });
  const exposed = aTransactions.find((transaction) => transaction.id === linked.result.transaction!.id);
  assert.ok(exposed);
  assert.equal(exposed!.account, null, "owner B account label must not be exposed");
  assert.equal(exposed!.accountId, null);

  // A genuinely owned account is still attachable.
  const owned = await link(ownerA, {
    amount: "$ 10,00",
    merchant: "Owned account capture",
    accountId: other,
    source: "test.b10",
  });
  assert.equal(owned.result.transaction?.accountId, other);
  assert.equal(owned.result.transaction?.currencyStatus, "account_confirmed");
});

test("D2 unknown amount roles stay reviewable and never auto-merge", async () => {
  const owner = `owner-d2-role-${randomUUID()}`;
  const merchant = "Role Merchant";
  const first = await link(owner, { amount: "80,00", currency: "UYU", merchant, amountRole: "posted", source: "test.b10" });
  const unknown = await link(owner, { amount: "80,00", currency: "UYU", merchant, amountType: "mystery_adjustment", source: "test.b10" });

  assert.notEqual(unknown.result.transaction?.id, first.result.transaction?.id);
  assert.equal(unknown.result.matchedExisting, false);
  assert.equal(unknown.result.transaction?.amountRole, "posted");
  // N3: an unrecognised role may be a balance/fee/authorization, so it is kept
  // out of confirmed totals until reviewed even though it is stored as posted.
  assert.equal(unknown.result.transaction?.amountConfirmed, false);
  const row = await pool.query<{ reasons: string[] }>(
    `select review_reasons as reasons from financial_transactions where id = $1`,
    [unknown.result.transaction!.id],
  );
  assert.ok(row.rows[0]?.reasons.includes("unknown_amount_role"));

  const summary = await getFinancialSummary({ ownerId: owner, ...RANGE });
  assert.equal(summary.totals.find((total) => total.currency === "UYU")?.expense, "80.00");
  assert.equal(summary.totals.find((total) => total.currency === "UYU")?.transactionCount, 1);
});

test("D3 raw currencyConfirmed cannot promote a bare dollar into a confirmed total", async () => {
  const owner = `owner-d3-${randomUUID()}`;
  const linked = await link(owner, {
    amount: "$ 777,00",
    merchant: "BareBypass",
    currencyConfirmed: true,
    userConfirmedCurrency: true,
    source: "test.b10",
  });
  assert.equal(linked.candidate.currencyStatus, "ambiguous");
  assert.equal(linked.candidate.currency, "UNKNOWN");
  assert.equal(linked.result.transaction?.currency, "UNKNOWN");

  const summary = await getFinancialSummary({ ownerId: owner, ...RANGE });
  assert.deepEqual(summary.totals, []);
  assert.equal(summary.excluded.ambiguous, 1);
  const diagnostics = await getFinancialSummaryExclusionDiagnostics({ ownerId: owner, ...RANGE });
  assert.equal(diagnostics.unknown, 0);
});

test("D4 proactive insights and intelligence aggregates exclude ambiguous currency", async () => {
  const owner = `owner-d4-${randomUUID()}`;
  const now = new Date();
  const previousAt = new Date(now.getTime() - 8 * 86_400_000).toISOString();
  const currentAt = new Date(now.getTime() - 86_400_000).toISOString();

  await link(owner, { amount: "100,00", currency: "UYU", merchant: "Prior", source: "test.b10" }, { observedAt: previousAt });
  await link(owner, { amount: "200,00", currency: "UYU", merchant: "Current", source: "test.b10" }, { observedAt: currentAt });
  await link(owner, { amount: "50,00", currency: "UYU", merchant: "Current two", source: "test.b10" }, { observedAt: currentAt });
  await link(owner, { amount: "$ 300,00", merchant: "Ambiguous current", source: "test.b10" }, { observedAt: currentAt });

  const drafts = await detectInsightCandidates({ clientId: owner, now });
  const spending = drafts.find((draft) => draft.detector === "spending_variation" && draft.evidence.currency === "UYU");
  assert.ok(spending, "expected a UYU spending insight");
  assert.equal(spending!.evidence.current, 250);
  assert.equal(spending!.evidence.previous, 100);
  assert.ok(!JSON.stringify(drafts).includes("550"), "ambiguous $300 must not be added to the UYU total");

  const evidence = await collectIntelligenceEvidence(owner, [""], 30);
  const aggregate = evidence.find((item) => item.id === "aggregate:UYU:expense");
  assert.ok(aggregate, "expected a UYU expense aggregate");
  const payload = JSON.parse(aggregate!.text) as { last7Days: string; previous7Days: string; transactionCount: number; currency: string };
  assert.equal(payload.currency, "UYU");
  assert.equal(Number(payload.last7Days), 250);
  assert.equal(Number(payload.previous7Days), 100);
  assert.equal(payload.transactionCount, 3);
});

test("D5 negative event amounts are normalized by kind, never reported with an inverted sign", async () => {
  const owner = `owner-d5-${randomUUID()}`;
  const linked = await link(owner, { amount: "-100,00", currency: "UYU", merchant: "Debit notice", source: "test.b10" });
  assert.equal(linked.result.transaction?.amount, "100.00");
  assert.ok(linked.result.transaction?.reviewReasons.includes("negative_amount_normalized_by_kind"));

  const summary = await getFinancialSummary({ ownerId: owner, ...RANGE });
  const total = summary.totals.find((item) => item.currency === "UYU");
  assert.ok(total);
  assert.equal(total!.expense, "100.00");
  assert.equal(total!.net, "-100.00");
});

test("D6 malformed decimal grouping is rejected before it reaches matching", async () => {
  assert.equal(parseLocalizedMoneyDecimal("100.000"), null);
  assert.equal(parseLocalizedMoneyDecimal("1.2.3"), null);
  assert.equal(parseLocalizedMoneyDecimal("1.733"), null);
  assert.equal(parseLocalizedMoneyDecimal("1,733"), null);
  const candidate = buildFinancialTransactionCandidate({
    event: {
      id: randomUUID(),
      source: "test.b10",
      kind: "notification",
      title: "Malformed",
      body: "",
      timestamp: OBSERVED_AT,
      raw: { amount: "100.000", currency: "UYU", merchant: "Malformed" },
    },
    classified: { inferredKind: "expense", confidence: 1 },
    entityDrafts: [],
  });
  assert.equal(candidate, null);
});

test("D7 uncertain evidence cannot demote an existing confirmed transaction", async () => {
  const owner = `owner-d7-${randomUUID()}`;
  const reference = `D7-${randomUUID()}`;
  const merchant = "Confirmed Merchant";
  const first = await link(owner, { amount: "100,00", currency: "UYU", merchant, reference, source: "test.b10" });
  assert.equal(first.result.transaction?.amountConfirmed, true);

  const uncertain = await link(owner, { amount: "100.0000", currency: "UYU", merchant, reference, source: "test.b10" });
  assert.equal(uncertain.result.transaction?.id, first.result.transaction?.id);
  assert.ok(uncertain.candidate.reviewReasons.includes("amount_precision_excess"));

  const detail = await loadFinancialTransactionById(pool, first.result.transaction!.id);
  assert.equal(detail?.amountConfirmed, true);
  const summary = await getFinancialSummary({ ownerId: owner, ...RANGE });
  assert.equal(summary.totals.find((total) => total.currency === "UYU")?.expense, "100.00");
  const diagnostics = await getFinancialSummaryExclusionDiagnostics({ ownerId: owner, ...RANGE });
  assert.equal(diagnostics.unconfirmedAmount, 0);
});

test("D8 legacy UNKNOWN currency rows are counted in exclusions", async () => {
  const owner = `owner-d8-${randomUUID()}`;
  const transaction = await createManualFinancialTransaction({
    title: "Legacy unknown",
    kind: "expense",
    amount: "42.00",
    currency: "UYU",
    observedAt: OBSERVED_AT,
    ownerId: owner,
  });
  assert.ok(transaction);
  await pool.query(`update financial_transactions set currency = 'UNKNOWN' where id = $1`, [transaction.id]);

  const summary = await getFinancialSummary({ ownerId: owner, ...RANGE });
  assert.deepEqual(summary.totals, []);
  assert.equal(summary.excluded.ambiguous, 0);
  const diagnostics = await getFinancialSummaryExclusionDiagnostics({ ownerId: owner, ...RANGE });
  assert.equal(diagnostics.unknown, 1);
});

test("D9 fx rates require explicit approval and are immutable once approved", async () => {
  const owner = `owner-d9-${randomUUID()}`;
  await createManualFinancialTransaction({
    title: "FX subject",
    kind: "expense",
    amount: "100.00",
    currency: "UYU",
    observedAt: OBSERVED_AT,
    ownerId: owner,
  });
  const rateId = `fx_unapproved_${randomUUID()}`;
  await pool.query(
    `insert into fx_rates (id, base_currency, quote_currency, rate, as_of, provider)
     values ($1, 'UYU', 'USD', 0.025, $2::timestamptz, 'test')`,
    [rateId, OBSERVED_AT],
  );
  await assert.rejects(
    getFinancialSummary({ ownerId: owner, ...RANGE, conversionTo: "USD", fxRateId: rateId }),
    /fx_rate_unapproved/,
  );

  await pool.query(`update fx_rates set approved = true where id = $1`, [rateId]);
  const converted = await getFinancialSummary({ ownerId: owner, ...RANGE, conversionTo: "USD", fxRateId: rateId });
  assert.equal(converted.conversion?.amount, "-2.50");

  await assert.rejects(
    pool.query(`update fx_rates set rate = 0.03 where id = $1`, [rateId]),
    /immutable/,
  );
  await assert.rejects(
    pool.query(`delete from fx_rates where id = $1`, [rateId]),
    /immutable/,
  );
});

test("N1 real wallet capture attaches own accounts, updates the owner balance, and ignores foreign accounts", async () => {
  const ownerA = `owner-n1-a-${randomUUID()}`;
  const ownerB = `owner-n1-b-${randomUUID()}`;
  const authConfig: AuthConfig = {
    globalApiKey: null,
    clientKeys: new Map([[ownerA, "key-a"], [ownerB, "key-b"]]),
  };
  const headersA = { "x-brainia-client-id": ownerA, "x-brainia-api-key": "key-a" };
  const accountA = await createAccount(ownerA, "UYU");
  const accountB = await createAccount(ownerB, "UYU");

  const app = await buildApp({ authConfig });
  try {
    const capture = await app.inject({
      method: "POST",
      url: "/api/v1/capture/wallet",
      headers: headersA,
      payload: {
        id: randomUUID(),
        merchant: `N1 Own ${randomUUID()}`,
        amount: "55,00",
        currency: "UYU",
        transactionType: "expense",
        accountId: accountA,
      },
    });
    assert.equal(capture.statusCode, 201);
    const eventId = (capture.json() as { id: string }).id;

    // The real route does not set owner_id; ownership is carried by client_id.
    const raw = await pool.query<{ ownerId: string | null; clientId: string | null }>(
      `select owner_id as "ownerId", client_id as "clientId" from raw_events where id = $1`,
      [eventId],
    );
    assert.equal(raw.rows[0]?.ownerId, null);
    assert.equal(raw.rows[0]?.clientId, ownerA);

    const linked = await pool.query<{
      id: string;
      accountId: string | null;
      ownerId: string | null;
      currency: string;
      currencyStatus: string;
      reasons: string[];
    }>(
      `select t.id, t.account_id as "accountId", t.owner_id as "ownerId", t.currency,
              t.currency_status as "currencyStatus", t.review_reasons as reasons
       from financial_transactions t
       join financial_transaction_events e on e.transaction_id = t.id
       where e.raw_event_id = $1
       limit 1`,
      [eventId],
    );
    assert.ok(linked.rows[0], "captured wallet event must materialize one transaction");
    assert.equal(linked.rows[0]!.accountId, accountA);
    assert.equal(linked.rows[0]!.ownerId, ownerA);
    assert.equal(linked.rows[0]!.currency, "UYU");
    assert.ok(!linked.rows[0]!.reasons.includes("foreign_account_ignored"));

    const ownerAAccounts = await listFinancialAccounts(ownerA);
    assert.equal(ownerAAccounts.find((account) => account.id === accountA)?.balance, "-55.00");

    // A bare dollar amount is confirmed by the owned account's currency.
    const ambiguousCapture = await app.inject({
      method: "POST",
      url: "/api/v1/capture/wallet",
      headers: headersA,
      payload: {
        id: randomUUID(),
        merchant: `N1 Own Ambiguous ${randomUUID()}`,
        amount: "$ 12,00",
        transactionType: "expense",
        accountId: accountA,
      },
    });
    assert.equal(ambiguousCapture.statusCode, 201);
    const ambiguousEventId = (ambiguousCapture.json() as { id: string }).id;
    const ambiguousRow = await pool.query<{ accountId: string | null; currency: string; currencyStatus: string }>(
      `select t.account_id as "accountId", t.currency, t.currency_status as "currencyStatus"
       from financial_transactions t
       join financial_transaction_events e on e.transaction_id = t.id
       where e.raw_event_id = $1
       limit 1`,
      [ambiguousEventId],
    );
    assert.equal(ambiguousRow.rows[0]?.accountId, accountA);
    assert.equal(ambiguousRow.rows[0]?.currency, "UYU");
    assert.equal(ambiguousRow.rows[0]?.currencyStatus, "account_confirmed");

    // The same route with owner B's account stays foreign for owner A.
    const foreignCapture = await app.inject({
      method: "POST",
      url: "/api/v1/capture/wallet",
      headers: headersA,
      payload: {
        id: randomUUID(),
        merchant: `N1 Foreign ${randomUUID()}`,
        amount: "77,00",
        currency: "UYU",
        transactionType: "expense",
        accountId: accountB,
      },
    });
    assert.equal(foreignCapture.statusCode, 201);
    const foreignEventId = (foreignCapture.json() as { id: string }).id;
    const foreignRow = await pool.query<{ accountId: string | null; reasons: string[] }>(
      `select t.account_id as "accountId", t.review_reasons as reasons
       from financial_transactions t
       join financial_transaction_events e on e.transaction_id = t.id
       where e.raw_event_id = $1
       limit 1`,
      [foreignEventId],
    );
    assert.equal(foreignRow.rows[0]?.accountId, null);
    assert.ok(foreignRow.rows[0]?.reasons.includes("foreign_account_ignored"));

    const ownerBAccounts = await listFinancialAccounts(ownerB);
    assert.equal(Number(ownerBAccounts.find((account) => account.id === accountB)?.balance), 0);
  } finally {
    await app.close();
  }
});

test("N2 summary response is contract-exact and rejects an omitted range", async () => {
  const owner = `owner-n2-${randomUUID()}`;
  await createManualFinancialTransaction({
    title: "N2 contract shape",
    kind: "expense",
    amount: "10.00",
    currency: "UYU",
    observedAt: OBSERVED_AT,
    ownerId: owner,
  });
  const authConfig: AuthConfig = { globalApiKey: null, clientKeys: new Map([[owner, "key-n2"]]) };
  const headers = { "x-brainia-client-id": owner, "x-brainia-api-key": "key-n2" };
  const app = await buildApp({ authConfig });
  try {
    const missing = await app.inject({ method: "GET", url: "/api/v1/financial/summary", headers });
    assert.equal(missing.statusCode, 400);
    assert.equal((missing.json() as { error: string }).error, "invalid_financial_summary_query");

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/financial/summary?from=${encodeURIComponent(RANGE.from)}&to=${encodeURIComponent(RANGE.to)}`,
      headers,
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as Record<string, unknown> & {
      from: unknown;
      to: unknown;
      excluded: Record<string, unknown>;
    };
    assert.deepEqual(
      Object.keys(body).sort(),
      ["asOf", "conversion", "excluded", "from", "to", "totals"],
    );
    assert.deepEqual(Object.keys(body.excluded).sort(), ["ambiguous", "pending", "unsupported"]);
    assert.equal(typeof body.from, "string");
    assert.equal(typeof body.to, "string");
    assert.equal(body.from, RANGE.from);
    assert.equal(body.to, RANGE.to);
  } finally {
    await app.close();
  }
});

