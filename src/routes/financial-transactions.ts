import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { pool } from "../storage/postgres.js";
import {
  createFinancialAccount,
  listFinancialAccounts,
  listFinancialTransactions,
  loadFinancialTransactionById,
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
  currency: z.enum(["UYU", "USD"]).optional(),
});

const accountSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(40).optional(),
  mask: z.string().trim().max(40).nullable().optional(),
  currency: z.enum(["UYU", "USD"]),
});

export const registerFinancialTransactionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/financial/accounts", async () => ({ accounts: await listFinancialAccounts() }));

  app.post("/financial/accounts", async (request, reply) => {
    const parsed = accountSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_financial_account", issues: parsed.error.flatten() });
    return reply.status(201).send(await createFinancialAccount(parsed.data));
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
};
