import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/brainia_test";
process.env.DEEPSEEK_API_KEY = "";

const { buildApp } = await import("../src/app.ts");
const { pool } = await import("../src/storage/postgres.ts");

test("consolidating transactions hides the duplicate from lists and financial totals", async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const canonicalId = `financial_canonical_${suffix}`;
  const duplicateId = `financial_duplicate_${suffix}`;
  const accountId = `account_consolidation_${suffix}`;
  const observedAt = new Date().toISOString();
  const app = await buildApp();

  try {
    await pool.query(
      `
        insert into financial_accounts (id, name, type, currency)
        values ($1, $2, 'bank', 'UYU')
      `,
      [accountId, `Consolidation test ${suffix}`],
    );
    await pool.query(
      `
        insert into financial_transactions (
          id, kind, amount, currency, merchant_label, normalized_merchant,
          observed_at, window_start, window_end, evidence_count, match_score,
          match_strategy, primary_source, account_id
        )
        values
          ($1, 'expense', 100, 'UYU', 'Canonical payment', 'canonical payment',
           $4::timestamptz, $4::timestamptz, $4::timestamptz, 0, 1,
           'test', 'test', $3),
          ($2, 'expense', 40, 'UYU', 'Duplicate notification', 'duplicate notification',
           $4::timestamptz, $4::timestamptz, $4::timestamptz, 0, 1,
           'test', 'test', $3)
      `,
      [canonicalId, duplicateId, accountId, observedAt],
    );

    const accountsBefore = await app.inject({ method: "GET", url: "/api/v1/financial/accounts" });
    assert.equal(accountsBefore.statusCode, 200);
    const accountBefore = (accountsBefore.json() as { accounts: Array<{ id: string; balance: string }> })
      .accounts.find((account) => account.id === accountId);
    assert.equal(accountBefore?.balance, "-140.00");

    const merge = await app.inject({
      method: "POST",
      url: `/api/v1/financial/transactions/${canonicalId}/merge`,
      payload: { duplicateId },
    });
    assert.equal(merge.statusCode, 200);
    assert.equal((merge.json() as { id: string }).id, canonicalId);

    const transactions = await app.inject({
      method: "GET",
      url: "/api/v1/financial/transactions?limit=100",
    });
    assert.equal(transactions.statusCode, 200);
    const listedIds = (transactions.json() as { items: Array<{ id: string }> }).items.map((item) => item.id);
    assert.ok(listedIds.includes(canonicalId));
    assert.ok(!listedIds.includes(duplicateId));

    const duplicateDetail = await app.inject({
      method: "GET",
      url: `/api/v1/financial/transactions/${duplicateId}`,
    });
    assert.equal(duplicateDetail.statusCode, 404);

    const accountsAfter = await app.inject({ method: "GET", url: "/api/v1/financial/accounts" });
    assert.equal(accountsAfter.statusCode, 200);
    const accountAfter = (accountsAfter.json() as { accounts: Array<{ id: string; balance: string }> })
      .accounts.find((account) => account.id === accountId);
    assert.equal(accountAfter?.balance, "-100.00");

    const retainedDuplicate = await pool.query<{ hiddenAt: string | null; mergedIntoId: string | null }>(
      `
        select
          hidden_at as "hiddenAt",
          merged_into_transaction_id as "mergedIntoId"
        from financial_transactions
        where id = $1
      `,
      [duplicateId],
    );
    assert.ok(retainedDuplicate.rows[0]?.hiddenAt);
    assert.equal(retainedDuplicate.rows[0]?.mergedIntoId, canonicalId);
  } finally {
    await pool.query("delete from financial_transactions where id = any($1::text[])", [[canonicalId, duplicateId]]);
    await pool.query("delete from financial_accounts where id = $1", [accountId]);
    await app.close();
  }
});

test("deleting an account preserves its transactions and detaches their account reference", async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const accountId = `account_delete_${suffix}`;
  const transactionId = `financial_delete_${suffix}`;
  const observedAt = new Date().toISOString();
  const app = await buildApp();

  try {
    await pool.query(
      `insert into financial_accounts (id, name, type, currency) values ($1, $2, 'bank', 'UYU')`,
      [accountId, `Delete test ${suffix}`],
    );
    await pool.query(
      `
        insert into financial_transactions (
          id, kind, amount, currency, merchant_label, normalized_merchant,
          observed_at, window_start, window_end, evidence_count, match_score,
          match_strategy, primary_source, account_id
        ) values (
          $1, 'expense', 25, 'UYU', 'Preserved transaction', 'preserved transaction',
          $3::timestamptz, $3::timestamptz, $3::timestamptz, 0, 1,
          'test', 'test', $2
        )
      `,
      [transactionId, accountId, observedAt],
    );

    const response = await app.inject({ method: "DELETE", url: `/api/v1/financial/accounts/${accountId}` });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { deleted: true, detachedTransactions: 1 });

    const account = await pool.query(`select id from financial_accounts where id = $1`, [accountId]);
    assert.equal(account.rowCount, 0);
    const transaction = await pool.query<{ accountId: string | null }>(
      `select account_id as "accountId" from financial_transactions where id = $1`,
      [transactionId],
    );
    assert.equal(transaction.rows[0]?.accountId, null);
  } finally {
    await pool.query("delete from financial_transactions where id = $1", [transactionId]);
    await pool.query("delete from financial_accounts where id = $1", [accountId]);
    await app.close();
  }
});
