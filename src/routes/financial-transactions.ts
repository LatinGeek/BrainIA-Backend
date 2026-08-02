import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { pool } from "../storage/postgres.js";
import { FINANCIAL_CATEGORIES } from "../domain/financial-categories.js";
import {
  createFinancialAccount,
  createBalanceAdjustment,
  deleteFinancialAccount,
  hideFinancialTransaction,
  listFinancialAccounts,
  listFinancialTransactions,
  loadFinancialTransactionById,
  mergeFinancialTransactions,
  updateFinancialAccount,
  updateFinancialTransactionContext,
} from "../storage/financial-transaction-repository.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

const contextSchema = z.object({
  category: z.string().trim().max(120).nullable().optional(),
  accountId: z.string().trim().max(200).nullable().optional(),
  destinationAccountId: z.string().trim().max(200).nullable().optional(),
  destinationAmount: z.number().positive().nullable().optional(),
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
  if (!value.destinationAmount || value.destinationAmount <= 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["destinationAmount"], message: "A positive destination amount is required for transfers" });
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

export const registerFinancialTransactionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/financial/categories", async () => ({ categories: FINANCIAL_CATEGORIES }));

  app.get("/financial/accounts", async () => ({ accounts: await listFinancialAccounts() }));

  app.post("/financial/accounts", async (request, reply) => {
    const parsed = accountSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_financial_account", issues: parsed.error.flatten() });
    return reply.status(201).send(await createFinancialAccount(parsed.data));
  });

  app.patch("/financial/accounts/:id", async (request, reply) => {
    const params = request.params as { id?: string };
    const parsed = accountSchema.safeParse(request.body);
    if (!params.id?.trim() || !parsed.success) return reply.status(400).send({ error: "invalid_financial_account", issues: parsed.success ? undefined : parsed.error.flatten() });
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
    const result = await deleteFinancialAccount(id);
    if (!result) return reply.status(404).send({ error: "financial_account_not_found" });
    return result;
  });

  app.post("/financial/accounts/:id/adjustments", async (request, reply) => {
    const params = request.params as { id?: string };
    const parsed = adjustmentSchema.safeParse(request.body);
    if (!params.id?.trim() || !parsed.success) return reply.status(400).send({ error: "invalid_balance_adjustment", issues: parsed.success ? undefined : parsed.error.flatten() });
    try {
      const transaction = await createBalanceAdjustment({ accountId: params.id.trim(), ...parsed.data });
      return reply.status(201).send(transaction);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create balance adjustment";
      return reply.status(message.includes("not found") ? 404 : 409).send({ error: "balance_adjustment_failed", message });
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
      from: parsed.data.from,
      to: parsed.data.to,
    });
    return {
      count: items.length,
      items,
    };
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

    const transaction = await loadFinancialTransactionById(pool, id);
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
    const deleted = await hideFinancialTransaction(params.id.trim());
    if (!deleted) return reply.status(404).send({ error: "financial_transaction_not_found" });
    return reply.status(204).send();
  });
};
