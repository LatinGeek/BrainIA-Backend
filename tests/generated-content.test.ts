import assert from "node:assert/strict";
import test from "node:test";
import { buildDigestContent, buildInsightContent, parseDigestContent, parseInsightContent } from "../src/storage/generated-content.js";

test("structured insight harness accepts exact JSON and fenced JSON", () => {
  const value = parseInsightContent('```json\n{"version":3,"title":"Spending changed","summary":"Weekly spending increased.","whyItMatters":"The increase may affect your budget.","takeaways":["Most of the change came from one week."],"recommendedAction":"Review the largest transactions.","cards":[{"title":"Weekly spending increased","summary":"Spending rose compared with last week.","recommendedAction":"Review the largest transactions."}]}\n```');
  assert.equal(value?.title, "Spending changed");
  assert.equal(value?.takeaways.length, 1);
  assert.equal(value?.cards.length, 1);
});

test("structured insight harness rejects prose and falls back cleanly", () => {
  assert.equal(parseInsightContent("- a long unstructured answer"), null);
  const fallback = buildInsightContent([{ title: "Spending increased", explanation: "This week was higher than last week.", severity: "high", suggestedAction: "Review the largest transactions." }]);
  assert.equal(fallback.version, 3);
  assert.equal(fallback.recommendedAction, "Review the largest transactions.");
  assert.equal(fallback.cards.length, 1);
});

test("structured digest harness validates friendly compact content", () => {
  const generated = parseDigestContent('{"version":3,"title":"Today at a glance","summary":"Fourteen items were captured today.","highlights":["Home activity was most frequent."],"recommendedAction":null,"cards":[{"title":"Home activity","summary":"Home activity was most frequent.","recommendedAction":null}]}');
  assert.equal(generated?.highlights[0], "Home activity was most frequent.");
  assert.equal(generated?.cards[0]?.title, "Home activity");
  const fallback = buildDigestContent({ totalEvents: 14, topSource: { source: "Xiaomi Home", count: 6 }, topKind: { kind: "notification", count: 13 }, highlights: [] });
  assert.match(fallback.summary, /14 items/);
  assert.doesNotMatch(fallback.highlights.join(" "), /T\d\d:/);
  assert.ok(fallback.cards.length > 0);
});
