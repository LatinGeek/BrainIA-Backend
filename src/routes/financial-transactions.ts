import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ownerScope } from "../auth.js";
import { pool } from "../storage/postgres.js";
import { FINANCIAL_CATEGORIES } from "../domain/financial-categories.js";
import {
  createFinancialAccount,
  createBalanceAdjustment,
  createManualFinancialTransaction,
  createPendingFinancialTransaction,
  cancelPendingFinancialTransaction,
  deleteFinancialAccount,
  executePendingFinancialTransaction,
  getFinancialSummary,
  hideFinancialTransaction,
  listFinancialAccounts,
  listFinancialTransactions,
  listPendingFinancialTransactions,
  loadFinancialTransactionById,
  markFinancialTransactionFalsePositive,
  mergeFinancialTransactions,
  updateFinancialAccount,
  updatePendingFinancialTransaction,
  updateFinancialTransactionContext,
} from "../storage/financial-transaction-repository.js";

const listQuerySchema = z.object({
  // Financial reports must include an entire cycle, not only its 100 most
  // recent records. Keep a bounded upper limit for the mobile client.
  limit: z.coerce.number().int().min(1).max(1000).default(25),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

// Amounts may be sent as exact decimal text (preferred) or as the legacy
// JSON number. Neither form is turned into floating-point money server-side.
const decimalAmountSchema = z.union([
  z.number().positive(),
  z.string().trim()
    .regex(/^\d+(?:\.\d{1,6})?$/, "Expected a positive decimal amount")
    .refine((value) => /[1-9]/.test(value), "Expected a positive decimal amount"),
]);

const summaryQuerySchema = z.object({
  // The v2 FinancialSummary contract requires a bounded range; omitting either
  // side is a validation error instead of returning null timestamps.
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  accountId: z.string().trim().max(200).optional(),
  conversionTo: z.string().trim().length(3).optional(),
  fxRateId: z.string().trim().max(200).optional(),
}).superRefine((value, context) => {
  if (value.conversionTo && !value.fxRateId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["fxRateId"],
      message: "An approved fxRateId is required for any conversion",
    });
  }
});

const contextSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().max(120).nullable().optional(),
  amount: decimalAmountSchema.optional(),
  accountId: z.string().trim().max(200).nullable().optional(),
  destinationAccountId: z.string().trim().max(200).nullable().optional(),
  destinationAmount: decimalAmountSchema.nullable().optional(),
  destinationCurrency: z.enum(["UYU", "USD"]).nullable().optional(),
  currency: z.enum(["UYU", "USD"]).optional(),
  kind: z.enum(["expense", "income", "transfer"]).optional(),
}).superRefine((value, context) => {
  if (value.kind !== "transfer") return;
  if (!value.accountId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["accountId"], message: "A source account is required for transfers" });
  if (!value.destinationAccountId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["destinationAccountId"], message: "A destination account is required for transfers" });
  if (value.accountId && value.destinationAccountId && value.accountId === value.destinationAccountId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["destinationAccountId"], message: "A transfer must use two different accounts" });
  }
  if (!value.destinationAmount) context.addIssue({ code: z.ZodIssueCode.custom, path: ["destinationAmount"], message: "A positive destination amount is required for transfers" });
  if (!value.destinationCurrency) context.addIssue({ code: z.ZodIssueCode.custom, path: ["destinationCurrency"], message: "A destination currency is required for transfers" });
});

const accountSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(40).optional(),
  mask: z.string().trim().max(40).nullable().optional(),
  currency: z.enum(["UYU", "USD"]),
  color: z.enum(["#2563EB", "#4F46E5", "#7C3AED", "#DB2777", "#E11D48", "#D97706", "#059669", "#0891B2"]).optional(),
});

const adjustmentSchema = z.object({
  targetBalance: z.coerce.number().finite().min(-999999999999).max(999999999999),
  note: z.string().trim().max(200).optional(),
});

const mergeSchema = z.object({
  duplicateId: z.string().trim().min(1).max(200),
});

const categorySchema = z.object({
  kind: z.enum(["expense", "income"]),
  name: z.string().trim().min(1).max(120),
});

const financialEntrySchema = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(["expense", "income"]),
  amount: decimalAmountSchema,
  currency: z.enum(["UYU", "USD"]),
  category: z.string().trim().max(120).nullable().optional(),
  accountId: z.string().trim().max(200).nullable().optional(),
});

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

const manualTransactionSchema = financialEntrySchema.extend({
  observedAt: z.string().datetime({ offset: true }),
});

const pendingTransactionSchema = financialEntrySchema.extend({
  estimatedExecutionDate: isoDateSchema,
});

const pendingTransactionPatchSchema = pendingTransactionSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one pending transaction field is required",
);

const executePendingTransactionSchema = z.object({
  executedAt: z.string().datetime({ offset: true }),
});

function categoryScope(request: Parameters<typeof ownerScope>[0]) {
  return ownerScope(request);
}

async function pendingOwnedBy(id: string, ownerId?: string) {
  if (!ownerId) return true;
  const result = await pool.query(
    `select 1 from pending_financial_transactions where id = $1 and owner_id = $2 limit 1`,
    [id, ownerId],
  );
  return (result.rowCount ?? 0) > 0;
}

async function accountOwnedBy(id: string, ownerId?: string) {
  if (!ownerId) return true;
  const result = await pool.query(
    `select 1 from financial_accounts where id = $1 and owner_id = $2 limit 1`,
    [id, ownerId],
  );
  return (result.rowCount ?? 0) > 0;
}

function normalizeCategoryName(name: string) {
  return name.split("/").map((part) => part.trim()).filter(Boolean).join(" / ");
}

export const registerFinancialTransactionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/financial/categories", async (request) => {
    const custom = await pool.query<{ kind: "expense" | "income"; name: string }>(
      `select kind, name from financial_custom_categories where client_scope = $1 order by created_at asc`,
      [categoryScope(request)],
    );
    const categories: { expense: string[]; income: string[] } = { expense: [...FINANCIAL_CATEGORIES.expense], income: [...FINANCIAL_CATEGORIES.income] };
    for (const item of custom.rows) {
      if (!categories[item.kind].some((name) => name.toLowerCase() === item.name.toLowerCase())) categories[item.kind].push(item.name);
    }
    return { categories };
  });

  app.post("/financial/categories", async (request, reply) => {
    const parsed = categorySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_financial_category", issues: parsed.error.flatten() });
    const name = normalizeCategoryName(parsed.data.name);
    if (!name) return reply.status(400).send({ error: "invalid_financial_category" });
    const result = await pool.query<{ kind: "expense" | "income"; name: string }>(
      `insert into financial_custom_categories (client_scope, kind, name, normalized_name)
       values ($1, $2, $3, lower($3))
       on conflict (client_scope, kind, normalized_name) do update set name = excluded.name
       returning kind, name`,
      [categoryScope(request), parsed.data.kind, name],
    );
    return reply.status(201).send({ category: result.rows[0] });
  });

  app.get("/financial/accounts", async (request) => ({ accounts: await listFinancialAccounts(ownerScope(request)) }));

  app.post("/financial/accounts", async (request, reply) => {
    const parsed = accountSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_financial_account", issues: parsed.error.flatten() });
    return reply.status(201).send(await createFinancialAccount({ ...parsed.data, ownerId: ownerScope(request) }));
  });

  app.patch("/financial/accounts/:id", async (request, reply) => {
    const params = request.params as { id?: string };
    const parsed = accountSchema.safeParse(request.body);
    if (!params.id?.trim() || !parsed.success) return reply.status(400).send({ error: "invalid_financial_account", issues: parsed.success ? undefined : parsed.error.flatten() });
    if (!(await accountOwnedBy(params.id.trim(), ownerScope(request)))) return reply.status(404).send({ error: "financial_account_not_found" });
    try {
      const account = await updateFinancialAccount(params.id.trim(), parsed.data);
      if (!account) return reply.status(404).send({ error: "financial_account_not_found" });
      return account;
    } catch (error) {
      return reply.status(409).send({ error: "financial_account_currency_mismatch", message: error instanceof Error ? error.message : "Unable to update account" });
    }
  });

  app.delete("/financial/accounts/:id", async (request, reply) => {
    const params = request.params as { id?: string };
    const id = params.id?.trim();
    if (!id) return reply.status(400).send({ error: "invalid_financial_account_id" });
    if (!(await accountOwnedBy(id, ownerScope(request)))) return reply.status(404).send({ error: "financial_account_not_found" });
    const result = await deleteFinancialAccount(id);
    if (!result) return reply.status(404).send({ error: "financial_account_not_found" });
    return result;
  });

  app.post("/financial/accounts/:id/adjustments", async (request, reply) => {
    const params = request.params as { id?: string };
    const parsed = adjustmentSchema.safeParse(request.body);
    if (!params.id?.trim() || !parsed.success) return reply.status(400).send({ error: "invalid_balance_adjustment", issues: parsed.success ? undefined : parsed.error.flatten() });
    if (!(await accountOwnedBy(params.id.trim(), ownerScope(request)))) return reply.status(404).send({ error: "financial_account_not_found" });
    try {
      const transaction = await createBalanceAdjustment({ accountId: params.id.trim(), ...parsed.data, ownerId: ownerScope(request) });
      return reply.status(201).send(transaction);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create balance adjustment";
      return reply.status(message.includes("not found") ? 404 : 409).send({ error: "balance_adjustment_failed", message });
    }
  });

  app.get("/financial/pending-transactions", async (request) => ({
    items: await listPendingFinancialTransactions(ownerScope(request)),
  }));

  app.post("/financial/pending-transactions", async (request, reply) => {
    const parsed = pendingTransactionSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_pending_financial_transaction", issues: parsed.error.flatten() });
    try {
      const pending = await createPendingFinancialTransaction({ ...parsed.data, ownerId: ownerScope(request) });
      return reply.status(201).send(pending);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create pending transaction";
      if (message.includes("Financial account not found")) return reply.status(404).send({ error: "financial_account_not_found" });
      return reply.status(409).send({ error: "pending_financial_transaction_failed", message });
    }
  });

  app.patch("/financial/pending-transactions/:id", async (request, reply) => {
    const id = (request.params as { id?: string }).id?.trim();
    const parsed = pendingTransactionPatchSchema.safeParse(request.body);
    if (!id || !parsed.success) return reply.status(400).send({ error: "invalid_pending_financial_transaction", issues: parsed.success ? undefined : parsed.error.flatten() });
    if (!(await pendingOwnedBy(id, ownerScope(request)))) return reply.status(404).send({ error: "pending_financial_transaction_not_found" });
    try {
      const pending = await updatePendingFinancialTransaction(id, parsed.data, ownerScope(request));
      if (!pending) return reply.status(404).send({ error: "pending_financial_transaction_not_found" });
      return pending;
    } catch (error) {
      return reply.status(409).send({ error: "pending_financial_transaction_failed", message: error instanceof Error ? error.message : "Unable to update pending transaction" });
    }
  });

  app.post("/financial/pending-transactions/:id/execute", async (request, reply) => {
    const id = (request.params as { id?: string }).id?.trim();
    const parsed = executePendingTransactionSchema.safeParse(request.body);
    if (!id || !parsed.success) return reply.status(400).send({ error: "invalid_pending_financial_execution", issues: parsed.success ? undefined : parsed.error.flatten() });
    if (!(await pendingOwnedBy(id, ownerScope(request)))) return reply.status(404).send({ error: "pending_financial_transaction_not_found" });
    try {
      const transaction = await executePendingFinancialTransaction(id, parsed.data.executedAt);
      if (!transaction) return reply.status(404).send({ error: "pending_financial_transaction_not_found" });
      return transaction;
    } catch (error) {
      return reply.status(409).send({ error: "pending_financial_execution_failed", message: error instanceof Error ? error.message : "Unable to execute pending transaction" });
    }
  });

  app.delete("/financial/pending-transactions/:id", async (request, reply) => {
    const id = (request.params as { id?: string }).id?.trim();
    if (!id) return reply.status(400).send({ error: "invalid_pending_financial_transaction_id" });
    if (!(await pendingOwnedBy(id, ownerScope(request)))) return reply.status(404).send({ error: "pending_financial_transaction_not_found" });
    const cancelled = await cancelPendingFinancialTransaction(id);
    if (!cancelled) return reply.status(404).send({ error: "pending_financial_transaction_not_found" });
    return reply.status(204).send();
  });

  app.get("/financial/summary", async (request, reply) => {
    const parsed = summaryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_financial_summary_query", issues: parsed.error.flatten() });
    }
    if (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to) {
      return reply.status(400).send({ error: "invalid_financial_summary_range", message: "The from value must be before the to value" });
    }
    const ownerId = ownerScope(request);
    if (parsed.data.accountId && !(await accountOwnedBy(parsed.data.accountId, ownerId))) {
      return reply.status(404).send({ error: "financial_account_not_found" });
    }
    try {
      return await getFinancialSummary({ ...parsed.data, ownerId });
    } catch (error) {
      const code = error instanceof Error ? error.message : "financial_summary_failed";
      if (code === "fx_rate_required" || code === "unsupported_conversion_currency") {
        return reply.status(400).send({ error: code });
      }
      if (code === "fx_rate_not_found" || code === "fx_rate_unapproved" || code === "fx_rate_quote_mismatch" || code === "fx_rate_base_mismatch" || code === "fx_rate_scope_unsupported") {
        return reply.status(409).send({ error: code });
      }
      return reply.status(500).send({ error: "financial_summary_failed" });
    }
  });

  app.get("/financial/transactions", async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      request.log.warn({ path: "/financial/transactions", issues: parsed.error.flatten() }, "invalid financial transaction query");
      return reply.status(400).send({
        error: "invalid_financial_transaction_query",
        issues: parsed.error.flatten(),
      });
    }

    if (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to) {
      return reply.status(400).send({
        error: "invalid_financial_transaction_range",
        message: "The from value must be before the to value",
      });
    }

    const items = await listFinancialTransactions(parsed.data.limit, {
      ownerId: ownerScope(request),
      from: parsed.data.from,
      to: parsed.data.to,
    });
    return {
      count: items.length,
      items,
    };
  });

  app.post("/financial/transactions", async (request, reply) => {
    const parsed = manualTransactionSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_manual_financial_transaction", issues: parsed.error.flatten() });
    try {
      const transaction = await createManualFinancialTransaction({ ...parsed.data, ownerId: ownerScope(request) });
      return reply.status(201).send(transaction);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create transaction";
      if (message.includes("Financial account not found")) return reply.status(404).send({ error: "financial_account_not_found" });
      return reply.status(409).send({ error: "manual_financial_transaction_failed", message });
    }
  });

  app.get("/financial/transactions/:id", async (request, reply) => {
    const params = request.params as { id?: string };
    const id = params.id?.trim();
    if (!id) {
      return reply.status(400).send({
        error: "invalid_financial_transaction_id",
        message: "The financial transaction id is required",
      });
    }

    const transaction = await loadFinancialTransactionById(pool, id, ownerScope(request));
    if (!transaction) {
      return reply.status(404).send({
        error: "financial_transaction_not_found",
        message: "No financial transaction matches the provided id",
      });
    }

    return transaction;
  });

  app.patch("/financial/transactions/:id", async (request, reply) => {
    const params = request.params as { id?: string };
    const parsed = contextSchema.safeParse(request.body);
    if (!params.id?.trim() || !parsed.success) {
      return reply.status(400).send({ error: "invalid_financial_transaction_context", issues: parsed.success ? undefined : parsed.error.flatten() });
    }
    const ownerId = ownerScope(request);
    if (!(await loadFinancialTransactionById(pool, params.id.trim(), ownerId))) {
      return reply.status(404).send({ error: "financial_transaction_not_found" });
    }
    // Re-pointing a movement must not attach it to another owner's account.
    if (parsed.data.accountId && !(await accountOwnedBy(parsed.data.accountId, ownerId))) {
      return reply.status(404).send({ error: "financial_account_not_found" });
    }
    if (parsed.data.destinationAccountId && !(await accountOwnedBy(parsed.data.destinationAccountId, ownerId))) {
      return reply.status(404).send({ error: "financial_account_not_found" });
    }

    try {
      const updated = await updateFinancialTransactionContext(params.id.trim(), parsed.data);
      if (!updated) return reply.status(404).send({ error: "financial_transaction_not_found" });
      return updated;
    } catch (error) {
      return reply.status(409).send({
        error: "financial_account_currency_mismatch",
        message: error instanceof Error ? error.message : "The account currency must match the transaction currency",
      });
    }
  });

  app.post("/financial/transactions/:id/merge", async (request, reply) => {
    const params = request.params as { id?: string };
    const parsed = mergeSchema.safeParse(request.body);
    if (!params.id?.trim() || !parsed.success) {
      return reply.status(400).send({ error: "invalid_financial_transaction_merge", issues: parsed.success ? undefined : parsed.error.flatten() });
    }
    if (!(await loadFinancialTransactionById(pool, params.id.trim(), ownerScope(request)))) {
      return reply.status(404).send({ error: "financial_transaction_not_found" });
    }
    if (!(await loadFinancialTransactionById(pool, parsed.data.duplicateId, ownerScope(request)))) {
      return reply.status(404).send({ error: "financial_transaction_not_found" });
    }
    try {
      const transaction = await mergeFinancialTransactions(params.id.trim(), parsed.data.duplicateId);
      if (!transaction) return reply.status(404).send({ error: "financial_transaction_not_found" });
      return transaction;
    } catch (error) {
      return reply.status(409).send({ error: "financial_transaction_merge_failed", message: error instanceof Error ? error.message : "Unable to consolidate transactions" });
    }
  });

  app.delete("/financial/transactions/:id", async (request, reply) => {
    const params = request.params as { id?: string };
    if (!params.id?.trim()) return reply.status(400).send({ error: "invalid_financial_transaction_id" });
    if (!(await loadFinancialTransactionById(pool, params.id.trim(), ownerScope(request)))) {
      return reply.status(404).send({ error: "financial_transaction_not_found" });
    }
    const deleted = await hideFinancialTransaction(params.id.trim());
    if (!deleted) return reply.status(404).send({ error: "financial_transaction_not_found" });
    return reply.status(204).send();
  });

  app.post("/financial/transactions/:id/false-positive", async (request, reply) => {
    const id = (request.params as { id?: string }).id?.trim();
    if (!id) return reply.status(400).send({ error: "invalid_financial_transaction_id" });
    if (!(await loadFinancialTransactionById(pool, id, ownerScope(request)))) {
      return reply.status(404).send({ error: "financial_transaction_not_found" });
    }
    const marked = await markFinancialTransactionFalsePositive(id);
    if (!marked) return reply.status(404).send({ error: "financial_transaction_not_found" });
    return marked;
  });
};
