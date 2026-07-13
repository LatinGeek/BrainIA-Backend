import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { pool } from "../storage/postgres.js";
import { listFinancialTransactions, loadFinancialTransactionById } from "../storage/financial-transaction-repository.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const registerFinancialTransactionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/financial/transactions", async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      request.log.warn({ path: "/financial/transactions", issues: parsed.error.flatten() }, "invalid financial transaction query");
      return reply.status(400).send({
        error: "invalid_financial_transaction_query",
        issues: parsed.error.flatten(),
      });
    }

    const items = await listFinancialTransactions(parsed.data.limit);
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
};
