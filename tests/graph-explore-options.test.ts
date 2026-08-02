import assert from "node:assert/strict";
import test from "node:test";

import { allocateExploreGraphSlots, parseExploreGraphOptions } from "../src/domain/graph-options.js";

test("event evidence must be explicitly enabled", () => {
  assert.equal(parseExploreGraphOptions({ includeEvents: "true" }).includeEvents, false);
  assert.equal(parseExploreGraphOptions({ includeEventEvidence: "true" }).includeEvents, true);
});

test("explore graph reserves bounded capacity for event evidence", () => {
  assert.deepEqual(allocateExploreGraphSlots(80, false), { knowledgeLimit: 80, evidenceLimit: 0 });
  assert.deepEqual(allocateExploreGraphSlots(80, true), { knowledgeLimit: 60, evidenceLimit: 20 });
  assert.deepEqual(allocateExploreGraphSlots(10, true), { knowledgeLimit: 5, evidenceLimit: 5 });
  assert.deepEqual(allocateExploreGraphSlots(250, true), { knowledgeLimit: 230, evidenceLimit: 20 });
});

test("taxonomy projection uses bounded progressive depth", () => {
  assert.deepEqual(parseExploreGraphOptions({ projection: "taxonomy", root: "finances.spending", depth: "99" }), {
    limit: 80,
    includeEvents: false,
    from: null,
    to: null,
    eventKind: null,
    projection: "taxonomy",
    root: "finances.spending",
    depth: 4,
    includeIdentities: false,
  });
});
