import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ownerScope } from "../auth.js";
import { embeddingProvider } from "../storage/embeddings.js";
import { askEnabled, runAsk, type AskStreamEvent } from "../storage/ask.js";

const timeZoneSchema = z.string().max(64).refine((value) => {
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
}, "invalid_time_zone");

const askSchema = z.object({
  question: z.string().trim().min(2).max(1000),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(4000),
  }).strict()).max(12).default([]),
  timeZone: timeZoneSchema.optional(),
  stream: z.boolean().default(true),
}).strict();

export const registerAskRoutes: FastifyPluginAsync = async (app) => {
  app.get("/ask/capabilities", async () => ({
    enabled: askEnabled(),
    answerModelConfigured: Boolean(process.env.DEEPSEEK_API_KEY?.trim()),
    semanticEmbeddings: embeddingProvider()?.model ?? null,
    streaming: true,
  }));

  app.post("/ask", async (request, reply) => {
    if (!askEnabled()) return reply.code(503).send({ error: "ask_disabled" });
    const parsed = askSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_ask", issues: parsed.error.flatten() });
    const ownerId = ownerScope(request) ?? null;
    const { question, history, timeZone, stream } = parsed.data;

    if (!stream) {
      const events: AskStreamEvent[] = [];
      await runAsk({ ownerId, question, history, timeZone, emit: (event) => { if (event.type !== "delta") events.push(event); } });
      const pick = <T extends AskStreamEvent["type"]>(type: T) => events.find((event) => event.type === type) as Extract<AskStreamEvent, { type: T }> | undefined;
      const error = pick("error");
      if (error) return reply.code(409).send({ error: error.code, message: error.message });
      const done = pick("done");
      const sources = pick("sources");
      return { plan: pick("plan") ?? null, sources: sources?.sources ?? [], cards: sources?.cards ?? [], ...done };
    }

    // NDJSON stream: one event per line. Headers set by the app hooks (CORS,
    // request id) are copied because writing to the raw socket bypasses them.
    reply.hijack();
    reply.raw.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>),
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    });
    const write = (event: AskStreamEvent) => {
      if (!reply.raw.writableEnded) reply.raw.write(`${JSON.stringify(event)}\n`);
    };
    try {
      await runAsk({ ownerId, question, history, timeZone, emit: write });
    } catch (error) {
      // Metadata only: never log the question or evidence.
      request.log.error({ errorName: error instanceof Error ? error.name : "Error" }, "ask_failed");
      write({ type: "error", code: "ask_failed", message: "No pude completar la respuesta. Intenta de nuevo." });
    } finally {
      reply.raw.end();
    }
  });
};
