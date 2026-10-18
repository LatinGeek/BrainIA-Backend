import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/brainia_test";
process.env.DEEPSEEK_API_KEY = "";

const { buildApp } = await import("../src/app.ts");
const { pool } = await import("../src/storage/postgres.ts");

test("pending financial entries stay out of balances until execution", async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const accountId = `account_pending_${suffix}`;
  const app = await buildApp();

  try {
    await pool.query(
      `insert into financial_accounts (id, name, type, currency) values ($1, $2, 'bank', 'UYU')`,
      [accountId, `Pending test ${suffix}`],
    );
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/financial/pending-transactions",
      payload: {
        title: "Cobro pendiente",
        kind: "income",
        amount: 1234.5,
        currency: "UYU",
        category: "Ventas",
        accountId,
        estimatedExecutionDate: "2026-10-20",
      },
    });
    assert.equal(created.statusCode, 201);
    const pending = created.json() as { id: string; estimatedExecutionDate: string };
    assert.ok(pending.id);
    assert.equal(pending.estimatedExecutionDate, "2026-10-20");

    const balanceBefore = await app.inject({ method: "GET", url: "/api/v1/financial/accounts" });
    const accountBefore = (balanceBefore.json() as { accounts: Array<{ id: string; balance: string }> }).accounts.find((account) => account.id === accountId);
    assert.equal(Number(accountBefore?.balance), 0);

    const pendingList = await app.inject({ method: "GET", url: "/api/v1/financial/pending-transactions" });
    assert.equal(pendingList.statusCode, 200);
    assert.equal((pendingList.json() as { items: Array<{ id: string }> }).items[0]?.id, pending.id);

    const movementsBefore = await app.inject({ method: "GET", url: "/api/v1/financial/transactions?limit=100" });
    assert.ok(!(movementsBefore.json() as { items: Array<{ id: string }> }).items.some((item) => item.id === pending.id));

    const executed = await app.inject({
      method: "POST",
      url: `/api/v1/financial/pending-transactions/${pending.id}/execute`,
      payload: { executedAt: "2026-10-21T15:00:00.000Z" },
    });
    assert.equal(executed.statusCode, 200);
    const transaction = executed.json() as { id: string; merchantLabel: string; primarySource: string };
    assert.ok(transaction.id.startsWith("financial_"));
    assert.equal(transaction.merchantLabel, "Cobro pendiente");
    assert.equal(transaction.primarySource, "pending_execution");

    const balanceAfter = await app.inject({ method: "GET", url: "/api/v1/financial/accounts" });
    const accountAfter = (balanceAfter.json() as { accounts: Array<{ id: string; balance: string }> }).accounts.find((account) => account.id === accountId);
    assert.equal(Number(accountAfter?.balance), 1234.5);

    const pendingAfter = await app.inject({ method: "GET", url: "/api/v1/financial/pending-transactions" });
    assert.equal((pendingAfter.json() as { items: unknown[] }).items.length, 0);
  } finally {
    await pool.query(`delete from pending_financial_transactions where account_id = $1`, [accountId]);
    await pool.query(`delete from financial_transactions where primary_source = 'pending_execution' and account_id = $1`, [accountId]);
    await pool.query("delete from financial_accounts where id = $1", [accountId]);
    await app.close();
  }
});

test("pending financial entries can be edited and cancelled without producing a movement", async () => {
  const app = await buildApp();
  try {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/financial/pending-transactions",
      payload: { title: "Deuda a cancelar", kind: "expense", amount: 50, currency: "USD", estimatedExecutionDate: "2026-11-02" },
    });
    assert.equal(created.statusCode, 201);
    const pending = created.json() as { id: string };

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/v1/financial/pending-transactions/${pending.id}`,
      payload: { amount: 75, estimatedExecutionDate: "2026-11-05" },
    });
    assert.equal(updated.statusCode, 200);
    assert.equal((updated.json() as { amount: string; estimatedExecutionDate: string }).amount, "75.00");
    assert.equal((updated.json() as { estimatedExecutionDate: string }).estimatedExecutionDate, "2026-11-05");

    const cancelled = await app.inject({ method: "DELETE", url: `/api/v1/financial/pending-transactions/${pending.id}` });
    assert.equal(cancelled.statusCode, 204);
    const list = await app.inject({ method: "GET", url: "/api/v1/financial/pending-transactions" });
    assert.ok(!(list.json() as { items: Array<{ id: string }> }).items.some((item) => item.id === pending.id));
  } finally {
    await pool.query(`delete from pending_financial_transactions where title = 'Deuda a cancelar'`);
    await app.close();
  }
});
