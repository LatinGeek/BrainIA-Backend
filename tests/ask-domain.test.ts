import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOrTsQuery,
  canonicalCategories,
  checkNumericGrounding,
  defaultFinancePeriod,
  heuristicPlan,
  previousPeriod,
  reciprocalRankFusion,
  resolvePeriodExpression,
  sanitizeCitations,
  sanitizePlan,
  zonedInstant,
} from "../src/domain/ask.js";

const TZ = "America/Montevideo";
// Friday 2026-10-30, 22:38 in Montevideo (01:38 UTC on the 31st).
const NOW = new Date("2026-10-31T01:38:00Z");
const context = { timeZone: TZ, now: NOW, categories: canonicalCategories(["Mascotas"]), accounts: [{ id: "acc_itau", name: "Itaú" }] };

test("relative dates resolve in the user's time zone, not UTC", () => {
  // At 01:38 UTC it is still the 30th in Montevideo: "hoy" must be the 30th.
  const today = resolvePeriodExpression("¿cuánto gasté hoy?", TZ, NOW)!;
  assert.equal(today.fromDate, "2026-10-30");
  assert.equal(today.from, "2026-10-30T03:00:00.000Z");
  assert.equal(today.to, "2026-10-31T02:59:59.999Z");
  assert.equal(zonedInstant({ year: 2026, month: 10, day: 1 }, TZ), "2026-10-01T03:00:00.000Z");
});

test("calendar expressions match how people mean them", () => {
  const cases: Array<[string, string, string]> = [
    ["el mes pasado", "2026-09-01", "2026-09-30"],
    ["esta semana", "2026-10-26", "2026-10-30"], // weeks start on Monday
    ["la semana pasada", "2026-10-19", "2026-10-25"],
    ["ayer", "2026-10-29", "2026-10-29"],
    ["en octubre", "2026-10-01", "2026-10-30"], // capped at today
    ["en diciembre", "2025-12-01", "2025-12-31"], // future month without year → last year
    ["setiembre", "2026-09-01", "2026-09-30"], // Uruguayan spelling
    ["marzo del año pasado", "2025-03-01", "2025-03-31"],
    ["los últimos 15 días", "2026-10-16", "2026-10-30"],
    ["este año", "2026-01-01", "2026-10-30"],
  ];
  for (const [text, from, to] of cases) {
    const period = resolvePeriodExpression(text, TZ, NOW);
    assert.ok(period, text);
    assert.deepEqual([period.fromDate, period.toDate], [from, to], text);
  }
  assert.equal(resolvePeriodExpression("¿quién es Martina?", TZ, NOW), null);
});

test("comparison windows: whole month vs previous month, month-to-date vs same days", () => {
  const september = resolvePeriodExpression("el mes pasado", TZ, NOW)!;
  assert.deepEqual([previousPeriod(september, TZ).fromDate, previousPeriod(september, TZ).toDate], ["2026-08-01", "2026-08-31"]);
  const monthToDate = resolvePeriodExpression("este mes", TZ, NOW)!;
  assert.deepEqual([previousPeriod(monthToDate, TZ).fromDate, previousPeriod(monthToDate, TZ).toDate], ["2026-09-01", "2026-09-30"]);
  const fifteen = resolvePeriodExpression("últimos 15 días", TZ, NOW)!;
  assert.deepEqual([previousPeriod(fifteen, TZ).fromDate, previousPeriod(fifteen, TZ).toDate], ["2026-10-01", "2026-10-15"]);
});

test("model plans are sanitised: deterministic dates win, unknown keys are dropped", () => {
  const plan = sanitizePlan({
    standalone: "¿Cuánto gasté en delivery el mes pasado?",
    intent: "finance",
    // The model miscounted the month; the recognised expression must override it.
    period: { from: "2026-09-02", to: "2026-10-01" },
    finance: { mode: "total", kind: "expense", categories: ["food / delivery", "Invented"], accountIds: ["acc_itau", "acc_fake"], merchants: ["PedidosYa"] },
    searchQueries: ["delivery comida"],
  }, "¿y el mes pasado?", context);
  assert.deepEqual([plan.period?.fromDate, plan.period?.toDate], ["2026-09-01", "2026-09-30"]);
  assert.deepEqual(plan.finance?.categories, ["Food / Delivery"]);
  assert.deepEqual(plan.finance?.accountIds, ["acc_itau"]);
  assert.deepEqual(plan.finance?.merchants, ["PedidosYa"]);
  assert.equal(plan.plannedBy, "model");

  // Future end dates are clamped; inverted ranges are rejected.
  const clamped = sanitizePlan({ intent: "finance", period: { from: "2026-10-01", to: "2027-01-01" } }, "gastos", context);
  assert.equal(clamped.period?.toDate, "2026-10-30");
  assert.equal(sanitizePlan({ intent: "finance", period: { from: "2026-10-10", to: "2026-10-01" } }, "gastos", context).period, null);
  // Garbage falls back to the heuristic plan.
  assert.equal(sanitizePlan({ intent: 42 }, "¿cuánto gasté este mes?", context).plannedBy, "heuristic");
});

test("heuristic plan understands Spanish finance questions and custom categories", () => {
  const plan = heuristicPlan("¿En qué gasté más este mes?", context);
  assert.equal(plan.intent, "finance");
  assert.equal(plan.finance?.mode, "breakdown");
  assert.equal(plan.finance?.groupBy, "category");
  assert.equal(plan.period?.fromDate, "2026-10-01");
  assert.ok(heuristicPlan("gastos de mascotas", context).finance?.categories.includes("Mascotas"));
  assert.equal(heuristicPlan("¿qué hablé con Martina?", context).intent, "knowledge");
  // No period stated: totals get an explicit, stated default window.
  const open = heuristicPlan("¿cuánto gasto en Uber?", context);
  assert.equal(defaultFinancePeriod(open, TZ, NOW)?.label, "últimos 90 días");
});

test("full-text query is an accent-tolerant prefix OR, safe for to_tsquery", () => {
  assert.equal(buildOrTsQuery(["café con Martína"]), "café:* | cafe:* | martína:* | martina:*");
  assert.equal(buildOrTsQuery(["'); drop table x; --"]), "drop:* | table:*");
  assert.equal(buildOrTsQuery(["de la y"]), "");
});

test("reciprocal rank fusion rewards agreement between retrievers", () => {
  const fused = reciprocalRankFusion([["a", "b", "c"], ["c", "a", "d"]]);
  assert.equal(fused[0]![0], "a");
  assert.equal(fused[1]![0], "c");
  assert.ok(fused.find(([key]) => key === "d")![1] < fused.find(([key]) => key === "b")![1] + 1e-9);
});

test("figures must be grounded: amounts, percentages and counts", () => {
  const evidence = ["gastos UYU 45.320,50, 87 movimientos; variación +12,3%"];
  assert.deepEqual(checkNumericGrounding("Gastaste UYU 45.320,50 en 87 compras (+12,3%) [S1].", evidence), { status: "verified", unverified: [] });
  // A different total, an invented percentage and the same value in another format.
  const result = checkNumericGrounding("Fueron 45.000 pesos, un 15% más; en total 45320.50 [S1].", evidence);
  assert.equal(result.status, "unverified");
  assert.deepEqual(result.unverified, ["45.000", "15%"]);
  // Days, small counts and years are not material figures.
  // An answer without material figures is not claimed as verified.
  assert.equal(checkNumericGrounding("El 3 de octubre de 2026 hiciste 2 compras.", []).status, "not_applicable");
});

test("citations are normalised and never point at missing sources", () => {
  assert.deepEqual(sanitizeCitations("Total [S1, S3]. Otro [S9][s2].", 3), { text: "Total [S1][S3]. Otro [S2].", citations: [1, 2, 3] });
});
