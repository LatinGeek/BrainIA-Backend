import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { pool } from "../src/storage/postgres.ts";
import { insertRawEvent } from "../src/storage/event-repository.ts";
import {
  activateInterpretationGeneration,
  compareInterpretationGeneration,
  createInterpretationGeneration,
  getInterpretationGeneration,
  stageInterpretationGeneration,
} from "../src/storage/interpretation-generations.ts";

process.env.DEEPSEEK_API_KEY = "";
process.env.BRAINIA_EVIDENCE_POLICY = "enforce";

test("historical generation stages deterministically, compares and activates without a model call", async () => {
  const clientId = randomUUID();
  const event = {
    id: randomUUID(), source: "Xiaomi Home", contractVersion: 1, kind: "notification" as const,
    title: "Motion detected", body: "Motion detected in Living room", raw: {}, tags: [],
    timestamp: "2026-10-20T12:00:00Z",
  };
  await insertRawEvent(pool, event, clientId, `${clientId}:${event.id}`);
  const generation = await createInterpretationGeneration({ label: "test generation", clientId, createdBy: "test" });
  assert.equal(generation.requested, 1);
  const staged = await stageInterpretationGeneration(generation.id, { clientId, batchSize: 1, concurrency: 1 });
  assert.equal(staged.processed, 1);
  assert.equal(staged.remaining, 0);
  assert.equal(staged.generation?.status, "staged");
  const snapshot = await pool.query<{
    status: string; verificationStatus: string; semanticDecision: Record<string, unknown>;
  }>(`select status, verification_status as "verificationStatus", semantic_decision as "semanticDecision"
    from event_interpretation_snapshots where generation_id = $1 and event_id = $2`, [generation.id, event.id]);
  assert.equal(snapshot.rows[0]?.status, "staged");
  assert.equal(snapshot.rows[0]?.verificationStatus, "not_required");
  const paths = (snapshot.rows[0]?.semanticDecision.paths ?? []) as Array<{ hierarchyPath: string[]; action: string }>;
  assert.equal(paths[0]?.action, "reuse");
  assert.equal(paths[0]?.hierarchyPath.at(-1), "Device alerts");

  const comparison = await compareInterpretationGeneration(generation.id, { writeReport: false });
  assert.equal((comparison.counts as { snapshots: number }).snapshots, 1);
  assert.equal((comparison.counts as { abstentions: number }).abstentions, 0);

  const activated = await activateInterpretationGeneration(generation.id, { batchSize: 5 });
  assert.equal(activated.applied, 1);
  assert.equal(activated.generation?.status, "active");
  const relation = await pool.query<{ relationType: string; targetValue: string }>(`
    select relation.relation_type as "relationType", target.value as "targetValue"
    from relations relation
    join entities source on source.id = relation.source_entity_id
    join entities target on target.id = relation.target_entity_id
    where source.metadata ->> 'eventId' = $1 and relation.relation_type in ('part_of','belongs_to_domain')
  `, [event.id]);
  assert.ok(relation.rows.some((row) => row.targetValue === "Device alerts"));
  const applied = await pool.query(`select status, applied_at as "appliedAt" from event_interpretation_snapshots where generation_id = $1 and event_id = $2`, [generation.id, event.id]);
  assert.equal(applied.rows[0]?.status, "applied");
  assert.ok(applied.rows[0]?.appliedAt);
  const reloaded = await getInterpretationGeneration(generation.id);
  assert.equal(reloaded?.status, "active");
  assert.ok(reloaded?.activatedAt);
});

test("staging is idempotent and resumable at an event boundary", async () => {
  const clientId = randomUUID();
  const ids: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    const event = {
      id: randomUUID(), source: "Xiaomi Home", contractVersion: 1, kind: "notification" as const,
      title: "Motion detected", body: `Motion detected in room ${index}`, raw: {}, tags: [],
      timestamp: `2026-10-2${index}T12:00:00Z`,
    };
    ids.push(event.id);
    await insertRawEvent(pool, event, clientId, `${clientId}:${event.id}`);
  }
  const generation = await createInterpretationGeneration({ label: "resumable", clientId });
  const first = await stageInterpretationGeneration(generation.id, { clientId, batchSize: 1, maxEvents: 1, concurrency: 1 });
  assert.equal(first.processed, 1);
  assert.equal(first.remaining, 2);
  const second = await stageInterpretationGeneration(generation.id, { clientId, batchSize: 5, concurrency: 1 });
  assert.equal(second.remaining, 0);
  assert.equal(second.generation?.status, "staged");
  const snaps = await pool.query<{ count: string }>(`select count(*)::text as count from event_interpretation_snapshots where generation_id = $1`, [generation.id]);
  assert.equal(snaps.rows[0]?.count, "3");
  // Re-running staging is a no-op.
  const again = await stageInterpretationGeneration(generation.id, { clientId, batchSize: 5, concurrency: 1 });
  assert.equal(again.processed, 0);
  assert.equal(again.remaining, 0);
});
