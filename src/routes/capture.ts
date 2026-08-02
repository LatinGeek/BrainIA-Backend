import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { resolveAuthContext, type AuthConfig, type AuthResult } from "../auth.js";
import {
  buildCaptureBatchEvents,
  buildEmailCaptureEvent,
  buildNoteCaptureEvent,
  buildNotificationCaptureEvent,
  buildWalletCaptureEvent,
} from "../domain/capture.js";
import type { EventInput } from "../domain/event.js";
import { appendEvent } from "../storage/event-store.js";

type CaptureIngestFn = (event: EventInput, context?: { clientId?: string | null }) => Promise<{
  id: string;
  source: string;
  inferredKind: string;
  dedupeKey: string;
}>;

type CaptureRoutesOptions = {
  authConfig: AuthConfig;
  ingestEvent?: CaptureIngestFn;
};

const commonCaptureSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1).optional(),
  contractVersion: z.number().int().positive().optional(),
  timestamp: z.string().datetime().optional(),
  externalId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  tags: z.array(z.string()).default([]),
  raw: z.record(z.unknown()).default({}),
});

const noteCaptureSchema = commonCaptureSchema.extend({
  title: z.string().optional(),
  body: z.string().optional(),
});

const emailCaptureSchema = commonCaptureSchema.extend({
  provider: z.string().optional(),
  accountId: z.string().optional(),
  messageId: z.string().optional(),
  threadId: z.string().optional(),
  folder: z.string().optional(),
  labels: z.array(z.string()).default([]),
  subject: z.string().optional(),
  snippet: z.string().optional(),
  body: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  cc: z.array(z.string()).default([]),
  bcc: z.array(z.string()).default([]),
});

const notificationCaptureSchema = commonCaptureSchema.extend({
  appName: z.string().optional(),
  packageName: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
});

const walletCaptureSchema = commonCaptureSchema.extend({
  merchant: z.string().optional(),
  amount: z.string().optional(),
  currency: z.string().optional(),
  note: z.string().optional(),
  transactionType: z.enum(["income", "expense", "transfer"]).optional(),
  accountId: z.string().trim().min(1).max(200).optional(),
  destinationAccountId: z.string().trim().min(1).max(200).optional(),
  destinationAmount: z.string().trim().regex(/^\d+(?:[.,]\d{1,2})?$/).optional(),
  destinationCurrency: z.enum(["UYU", "USD"]).optional(),
  category: z.string().trim().min(1).max(120).optional(),
}).superRefine((value, context) => {
  if (value.transactionType !== "transfer") return;
  if (!value.accountId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["accountId"], message: "A source account is required for transfers" });
  }
  if (!value.destinationAccountId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["destinationAccountId"], message: "A destination account is required for transfers" });
  }
  if (!value.destinationAmount) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["destinationAmount"], message: "A destination amount is required for transfers" });
  } else if (Number(value.destinationAmount.replace(",", ".")) <= 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["destinationAmount"], message: "The destination amount must be greater than zero" });
  }
  if (!value.destinationCurrency) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["destinationCurrency"], message: "A destination currency is required for transfers" });
  }
  if (value.accountId && value.destinationAccountId && value.accountId === value.destinationAccountId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["destinationAccountId"], message: "A transfer must use two different accounts" });
  }
});

const captureBatchSchema = z.object({
  batchId: z.string().min(1).optional(),
  captures: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("note"),
        data: noteCaptureSchema,
      }),
      z.object({
        type: z.literal("email"),
        data: emailCaptureSchema,
      }),
      z.object({
        type: z.literal("notification"),
        data: notificationCaptureSchema,
      }),
      z.object({
        type: z.literal("wallet"),
        data: walletCaptureSchema,
      }),
    ]),
  ).min(1),
});

function getAuthClientId(auth: AuthResult) {
  if ("ok" in auth) {
    return null;
  }

  return auth.mode === "disabled" ? null : auth.clientId;
}

export const registerCaptureRoutes = (options: CaptureRoutesOptions): FastifyPluginAsync => {
  const ingestEvent = options.ingestEvent ?? appendEvent;

  return async (app) => {
    app.post("/capture/note", async (request, reply) => {
      const parsed = noteCaptureSchema.safeParse(request.body);
      if (!parsed.success) {
        request.log.warn({ path: "/capture/note", issues: parsed.error.flatten() }, "invalid capture payload");
        return reply.status(400).send({ error: "invalid_note_capture", issues: parsed.error.flatten() });
      }

      const auth = resolveAuthContext(request.headers, options.authConfig);
      if ("ok" in auth && !auth.ok) {
        return reply.status(auth.statusCode).send({ error: auth.error, message: auth.message });
      }

      const stored = await ingestEvent(
        buildNoteCaptureEvent({
          ...parsed.data,
          raw: parsed.data.raw,
        }),
        { clientId: getAuthClientId(auth) },
      );

      return reply.status(201).send(stored);
    });

    app.post("/capture/email", async (request, reply) => {
      const parsed = emailCaptureSchema.safeParse(request.body);
      if (!parsed.success) {
        request.log.warn({ path: "/capture/email", issues: parsed.error.flatten() }, "invalid capture payload");
        return reply.status(400).send({ error: "invalid_email_capture", issues: parsed.error.flatten() });
      }

      const auth = resolveAuthContext(request.headers, options.authConfig);
      if ("ok" in auth && !auth.ok) {
        return reply.status(auth.statusCode).send({ error: auth.error, message: auth.message });
      }

      const stored = await ingestEvent(
        buildEmailCaptureEvent({
          ...parsed.data,
        }),
        { clientId: getAuthClientId(auth) },
      );

      return reply.status(201).send(stored);
    });

    app.post("/capture/notification", async (request, reply) => {
      const parsed = notificationCaptureSchema.safeParse(request.body);
      if (!parsed.success) {
        request.log.warn({ path: "/capture/notification", issues: parsed.error.flatten() }, "invalid capture payload");
        return reply.status(400).send({ error: "invalid_notification_capture", issues: parsed.error.flatten() });
      }

      const auth = resolveAuthContext(request.headers, options.authConfig);
      if ("ok" in auth && !auth.ok) {
        return reply.status(auth.statusCode).send({ error: auth.error, message: auth.message });
      }

      const stored = await ingestEvent(
        buildNotificationCaptureEvent({
          ...parsed.data,
          raw: parsed.data.raw,
        }),
        { clientId: getAuthClientId(auth) },
      );

      return reply.status(201).send(stored);
    });

    app.post("/capture/wallet", async (request, reply) => {
      const parsed = walletCaptureSchema.safeParse(request.body);
      if (!parsed.success) {
        request.log.warn({ path: "/capture/wallet", issues: parsed.error.flatten() }, "invalid capture payload");
        return reply.status(400).send({ error: "invalid_wallet_capture", issues: parsed.error.flatten() });
      }

      const auth = resolveAuthContext(request.headers, options.authConfig);
      if ("ok" in auth && !auth.ok) {
        return reply.status(auth.statusCode).send({ error: auth.error, message: auth.message });
      }

      const stored = await ingestEvent(
        buildWalletCaptureEvent({
          ...parsed.data,
          raw: parsed.data.raw,
        }),
        { clientId: getAuthClientId(auth) },
      );

      return reply.status(201).send(stored);
    });

    app.post("/capture/batch", async (request, reply) => {
      const parsed = captureBatchSchema.safeParse(request.body);
      if (!parsed.success) {
        request.log.warn({ path: "/capture/batch", issues: parsed.error.flatten() }, "invalid capture payload");
        return reply.status(400).send({ error: "invalid_capture_batch", issues: parsed.error.flatten() });
      }

      const auth = resolveAuthContext(request.headers, options.authConfig);
      if ("ok" in auth && !auth.ok) {
        return reply.status(auth.statusCode).send({ error: auth.error, message: auth.message });
      }

      const events = buildCaptureBatchEvents({
        batchId: parsed.data.batchId,
        captures: parsed.data.captures,
      });

      const stored = [];
      for (const event of events) {
        stored.push(
          await ingestEvent(event, {
            clientId: getAuthClientId(auth),
          }),
        );
      }

      return reply.status(201).send({
        batchId: parsed.data.batchId ?? null,
        count: stored.length,
        items: stored,
      });
    });
  };
};
