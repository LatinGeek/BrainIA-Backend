import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { runAsk, type AskStreamEvent } from "../src/storage/ask.js";
import { refreshEventEmbeddings } from "../src/storage/embeddings.js";
import { getFinancialSummary } from "../src/storage/financial-transaction-repository.js";
import { pool } from "../src/storage/postgres.js";
import { upsertSourceProcessingPolicy } from "../src/storage/privacy.js";

const OWNER = "ask-a";
const NOW = new Date("2026-10-31T01:38:00Z"); // 2026-10-30 22:38 in Montevideo

async function event(id: string, owner: string, source: string, title: string, body: string, at: string, displayTitle?: string) {
  await pool.query(
    "insert into raw_events(id,source,kind,title,body,client_id,owner_id,dedupe_key,timestamp) values($1,$2,'notification',$3,$4,$5,$5,$1,$6)",
    [id, source, title, body, owner, at],
  );
  await pool.query("insert into classified_events(id,raw_event_id,inferred_kind,confidence,display_title) values($1,$2,'expense',.9,$3)", [`c_${id}`, id, displayTitle ?? title]);
}

async function tx(id: string, owner: string, input: {
  kind?: string; amount: string; currency: string; merchant: string; category?: string; at: string;
  anchor?: string | null; amountConfirmed?: boolean;
}) {
  await pool.query(`insert into financial_transactions (id,owner_id,kind,amount,currency,merchant_label,normalized_merchant,
      observed_at,window_start,window_end,primary_source,anchor_event_id,category,amount_confirmed)
    values ($1,$2,$3,$4,$5,$6,lower($6),$7,$7,$7,'test',$8,$9,$10)`,
  [id, owner, input.kind ?? "expense", input.amount, input.currency, input.merchant, input.at, input.anchor ?? null, input.category ?? null, input.amountConfirmed ?? true]);
  if (input.anchor) await link(id, input.anchor, owner, input);
}

async function link(transactionId: string, eventId: string, owner: string, input: { amount: string; merchant: string; at: string; kind?: string }) {
  await pool.query(`insert into financial_transaction_events (id,owner_id,transaction_id,raw_event_id,source,kind,amount,merchant_label,normalized_merchant,observed_at,match_reason)
    values ($1,$2,$3,$4,'test',$5,$6,$7,lower($7),$8,'test')`, [`l_${transactionId}_${eventId}`, owner, transactionId, eventId, input.kind ?? "expense", input.amount, input.merchant, input.at]);
}

async function collect(question: string, history: Array<{ role: "user" | "assistant"; content: string }> = []) {
  const events: AskStreamEvent[] = [];
  await runAsk({ ownerId: OWNER, question, history, now: NOW, emit: (item) => events.push(item) });
  const of = <T extends AskStreamEvent["type"]>(type: T) => events.filter((item) => item.type === type) as Array<Extract<AskStreamEvent, { type: T }>>;
  return { events, plan: of("plan")[0]!, sources: of("sources")[0]!, done: of("done")[0], deltas: of("delta"), error: of("error")[0] };
}

test.before(async () => {
  for (const source of ["bank", "email", "mobile", "private-chat"]) {
    await upsertSourceProcessingPolicy(pool, { clientId: OWNER, ownerId: OWNER, source, enabled: true, sendToLlm: true });
  }
  // One purchase arrives twice (notification + email) and is consolidated.
  await event("e_pya", OWNER, "bank", "Compra aprobada", "Compra PEDIDOSYA UYU 1.250,00", "2026-10-05T23:10:00Z", "Pedido en PedidosYa");
  await event("e_pya_mail", OWNER, "email", "Tu pedido de PedidosYa", "Gracias por tu pedido. Total $ 1.250", "2026-10-05T23:11:00Z", "Pedido en PedidosYa");
  await tx("t_pya", OWNER, { amount: "1250.00", currency: "UYU", merchant: "PedidosYa", category: "Food / Delivery", at: "2026-10-05T23:10:00Z", anchor: "e_pya" });
  await link("t_pya", "e_pya_mail", OWNER, { amount: "1250.00", merchant: "PedidosYa", at: "2026-10-05T23:11:00Z" });
  await event("e_uber", OWNER, "bank", "Compra aprobada", "UBER *TRIP UYU 300,50", "2026-10-12T14:00:00Z", "Viaje en Uber");
  await tx("t_uber", OWNER, { amount: "300.50", currency: "UYU", merchant: "Uber", category: "Transport", at: "2026-10-12T14:00:00Z", anchor: "e_uber" });
  await tx("t_spotify", OWNER, { amount: "20.00", currency: "USD", merchant: "Spotify", category: "Subscriptions", at: "2026-10-15T12:00:00Z" });
  await tx("t_unconfirmed", OWNER, { amount: "999.00", currency: "UYU", merchant: "Ilegible", at: "2026-10-20T12:00:00Z", amountConfirmed: false });
  await tx("t_salary", OWNER, { kind: "income", amount: "50000.00", currency: "UYU", merchant: "Empresa", category: "Salary", at: "2026-10-01T15:00:00Z" });
  await tx("t_pya_sep", OWNER, { amount: "700.00", currency: "UYU", merchant: "PedidosYa", category: "Food / Delivery", at: "2026-09-10T23:00:00Z" });
  await event("e_private", OWNER, "private-chat", "Pago a Juan", "Le pagué 400 a Juan por la cena", "2026-10-25T22:00:00Z");
  await tx("t_private", OWNER, { amount: "400.00", currency: "UYU", merchant: "Juan", category: "Going Out", at: "2026-10-25T22:00:00Z", anchor: "e_private" });
  await event("e_note", OWNER, "mobile", "Reunión con Martina", "Revisamos el proyecto Atlas: lanzamiento en diciembre y presupuesto pendiente.", "2026-10-22T13:00:00Z", "Reunión con Martina sobre Atlas");
  // Another owner's data must never appear.
  await event("e_other", "ask-b", "bank", "Compra aprobada", "PEDIDOSYA UYU 5.000", "2026-10-06T23:00:00Z", "Pedido en PedidosYa");
  await tx("t_other", "ask-b", { amount: "5000.00", currency: "UYU", merchant: "PedidosYa", category: "Food / Delivery", at: "2026-10-06T23:00:00Z", anchor: "e_other" });
  for (const id of ["e_pya", "e_pya_mail", "e_uber", "e_private", "e_note", "e_other"]) await refreshEventEmbeddings(pool, id);
});

test("finance totals equal the Money summary for the same window", async () => {
  delete process.env.DEEPSEEK_API_KEY;
  const { plan, sources, done } = await collect("¿Cuánto gasté este mes?");
  assert.equal(plan.period?.fromDate, "2026-10-01");
  const totals = sources.cards.find((card) => card.type === "totals");
  assert.ok(totals && totals.type === "totals");
  const summary = await getFinancialSummary({ from: plan.period!.fromDate + "T03:00:00.000Z", to: "2026-10-31T02:59:59.999Z", ownerId: OWNER });
  for (const row of summary.totals) {
    const chat = totals.rows.find((item) => item.currency === row.currency);
    assert.equal(chat?.expense, row.expense, `expense ${row.currency}`);
  }
  assert.equal(totals.rows.find((row) => row.currency === "UYU")?.expense, "1950.50"); // 1250 + 300.50 + 400; 999 unconfirmed excluded
  assert.equal(totals.rows.find((row) => row.currency === "USD")?.expense, "20.00"); // currencies never mixed
  assert.equal(totals.excludedCount, 1);
  assert.equal(done?.mode, "deterministic"); // no model configured
  // Another owner's 5.000 never reaches the evidence.
  assert.ok(!JSON.stringify(sources).includes("5000"));
});

test("breakdown, comparison and merchant filters are exact", async () => {
  const breakdown = await collect("¿En qué gasté más este mes?");
  const card = breakdown.sources.cards.find((item) => item.type === "breakdown" && item.currency === "UYU");
  assert.ok(card && card.type === "breakdown");
  assert.deepEqual(card.items.map((item) => [item.label, item.amount]), [["Comida / Delivery", "1250.00"], ["Salidas", "400.00"], ["Transporte", "300.50"]]);

  const compare = await collect("¿Gasté más en delivery el mes pasado comparado con el anterior?");
  const totals = compare.sources.cards.find((item) => item.type === "totals");
  assert.ok(totals && totals.type === "totals");
  assert.equal(compare.plan.period?.fromDate, "2026-09-01");
  assert.equal(totals.rows[0]?.expense, "700.00");
  assert.equal(totals.rows[0]?.previous?.label, "agosto 2026");
});

test("privacy: a source denied for LLM egress drops out of totals and evidence", async () => {
  await upsertSourceProcessingPolicy(pool, { clientId: OWNER, ownerId: OWNER, source: "private-chat", enabled: true, sendToLlm: false });
  try {
    const { sources } = await collect("¿Cuánto gasté este mes?");
    const totals = sources.cards.find((card) => card.type === "totals");
    assert.ok(totals && totals.type === "totals");
    assert.equal(totals.rows.find((row) => row.currency === "UYU")?.expense, "1550.50");
    const knowledge = await collect("¿Qué pasó con Juan y la cena?");
    assert.ok(!knowledge.sources.sources.some((source) => source.route?.params.id === "e_private"));
  } finally {
    await upsertSourceProcessingPolicy(pool, { clientId: OWNER, ownerId: OWNER, source: "private-chat", enabled: true, sendToLlm: true });
  }
});

test("knowledge retrieval: accent-tolerant, deduplicated, owner-scoped", async () => {
  const { plan, sources } = await collect("¿Qué hablé con Martina sobre el proyecto Atlas?");
  assert.equal(plan.intent, "knowledge");
  assert.equal(sources.sources[0]?.route?.params.id, "e_note");
  const pedidos = await collect("pedidos de pedidosya");
  const pedidosEvents = pedidos.sources.sources.filter((source) => source.kind === "event");
  // Notification + email for the same consolidated purchase count once.
  assert.equal(pedidosEvents.filter((source) => ["e_pya", "e_pya_mail"].includes(source.route?.params.id ?? "")).length, 1);
  assert.ok(!pedidosEvents.some((source) => source.route?.params.id === "e_other"));
});

test("model path: plan, streamed answer, citations and figure check", async () => {
  process.env.DEEPSEEK_API_KEY = "test-key";
  const originalFetch = globalThis.fetch;
  const prompts: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    prompts.push(JSON.stringify(body.messages));
    if (!String(url).includes("chat/completions")) throw new Error(`unexpected fetch ${url}`);
    if (!body.stream) {
      // Planner: the model gets the month wrong on purpose.
      const plan = { standalone: "¿Cuánto gasté en PedidosYa el mes pasado?", intent: "finance", period: { from: "2026-09-05", to: "2026-10-04" },
        finance: { mode: "total", kind: "expense", merchants: ["PedidosYa"], categories: [] }, searchQueries: ["pedidosya delivery"] };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }), { status: 200 });
    }
    const answer = "Gastaste UYU 700,00 en PedidosYa en septiembre 2026 [S1][S9]. Eso es un 40% menos que antes.";
    const frames = answer.match(/.{1,12}/g)!.map((part) => `data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
    frames.push(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 20 } })}\n\ndata: [DONE]\n\n`);
    return new Response(new ReadableStream({ start(controller) { for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame)); controller.close(); } }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await collect("¿y el mes pasado?", [
      { role: "user", content: "¿Cuánto gasté en PedidosYa este mes?" },
      { role: "assistant", content: "Gastaste UYU 1.250,00 [S1]." },
    ]);
    assert.equal(result.plan.period?.fromDate, "2026-09-01"); // deterministic window beats the model's arithmetic
    assert.ok(result.deltas.length > 1, "answer is streamed");
    assert.equal(result.done?.mode, "model");
    assert.ok(!result.done?.answer.includes("[S9]"), "citation to a missing source removed");
    assert.deepEqual(result.done?.grounding, { status: "unverified", unverified: ["40%"] });
    assert.ok(result.done?.citations.includes("S1"));
    const answerPrompt = prompts.at(-1)!;
    assert.ok(answerPrompt.includes("CÁLCULO EXACTO") && answerPrompt.includes("700,00"));
    assert.ok(!answerPrompt.includes("5.000"), "no other-owner evidence in the prompt");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.DEEPSEEK_API_KEY;
  }
});

test("HTTP: NDJSON stream and JSON mode, owner from credentials", async () => {
  const app = await buildApp({ authConfig: { globalApiKey: null, clientKeys: new Map([[OWNER, "secret"]]) } });
  const headers = { "x-brainia-client-id": OWNER, "x-brainia-api-key": "secret" };
  try {
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/ask", payload: { question: "hola" } })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/ask", headers, payload: { question: "x" } })).statusCode, 400);
    const streamed = await app.inject({ method: "POST", url: "/api/v1/ask", headers, payload: { question: "¿Cuánto gasté esta semana?" } });
    assert.equal(streamed.statusCode, 200);
    assert.match(String(streamed.headers["content-type"]), /application\/x-ndjson/);
    const lines = streamed.body.trim().split("\n").map((line) => JSON.parse(line) as AskStreamEvent);
    assert.deepEqual(lines.map((line) => line.type).filter((type) => type !== "status"), ["plan", "sources", "done"]);
    const json = await app.inject({ method: "POST", url: "/api/v1/ask", headers, payload: { question: "¿Cuánto gasté este mes?", stream: false } });
    assert.equal(json.statusCode, 200);
    assert.ok(Array.isArray(json.json().cards));
    const capabilities = await app.inject({ method: "GET", url: "/api/v1/ask/capabilities", headers });
    assert.equal(capabilities.json().enabled, true);
  } finally {
    await app.close();
  }
});
