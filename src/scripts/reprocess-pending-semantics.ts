import { reprocessEvent } from "../storage/event-store.js";
import { pool } from "../storage/postgres.js";
import { reconcileSemanticGraph } from "../storage/semantic-reconciler.js";
import { normalizeEntityValue } from "../domain/entities.js";

const limit = Number.parseInt(process.argv.find((argument) => argument.startsWith("--limit="))?.slice(8) ?? "0", 10);
const inspectOnly = process.argv.includes("--inspect-only");
const maintenanceOnly = process.argv.includes("--maintenance-only");
const skipReconciliation = process.argv.includes("--skip-reconciliation");
const targetFilter = process.argv.find((argument) => argument.startsWith("--target="))?.slice(9).trim();
const pending = await pool.query<{ eventId: string; createdAt: string }>(`
  select candidate.event_id as "eventId", min(candidate.created_at)::text as "createdAt"
  from semantic_candidates candidate
  where candidate.status = 'pending' and candidate.event_id is not null
    and ($1::text is null or candidate.target_normalized_value = $1)
  group by candidate.event_id
  union
  select decision.event_id, decision.updated_at::text
  from semantic_event_decisions decision
  where decision.status in ('retryable','unclassified','model_unavailable')
    and $1::text is null
  order by "createdAt", "eventId"
`, [targetFilter ? normalizeEntityValue(targetFilter) : null]);
const events = inspectOnly || maintenanceOnly ? [] : pending.rows.slice(0, Number.isFinite(limit) && limit > 0 ? limit : undefined);
const failed: Array<{ eventId: string; error: string }> = [];
let processed = 0;

for (const [index, event] of events.entries()) {
  try {
    if (await reprocessEvent(event.eventId)) processed += 1;
    console.log(`${index + 1}/${events.length} ${event.eventId}`);
  } catch (error) {
    failed.push({ eventId: event.eventId, error: error instanceof Error ? error.message : String(error) });
    console.error(`FAILED ${event.eventId}`);
  }
}

const reconciliation = inspectOnly
  ? { status: "inspection_only" as const }
  : skipReconciliation ? { status: "skipped" as const }
  : failed.length ? { status: "awaiting_failed_event_retry" as const } : await reconcileSemanticGraph();
const remaining = await pool.query<{ count: number }>(`select count(*)::int as count from semantic_candidates where status = 'pending'`);
const pendingSummary = await pool.query(`
  select subject.type as "subjectType", candidate.decision_kind as "decisionKind", candidate.relation_type as "relationType",
    candidate.target_type as "targetType", candidate.target_value as target, candidate.proposed_path as path,
    array_agg(distinct subject.value order by subject.value) as subjects,
    count(*)::int as count, min(candidate.confidence)::float8 as "minimumConfidence",
    max(candidate.confidence)::float8 as "maximumConfidence"
  from semantic_candidates candidate left join entities subject on subject.id = candidate.subject_entity_id
  where candidate.status = 'pending'
  group by subject.type, candidate.decision_kind, candidate.relation_type, candidate.target_type, candidate.target_value, candidate.proposed_path
  order by count desc, target
`);
console.log(JSON.stringify({ selected: events.length, processed, failed, remaining: remaining.rows[0]?.count ?? 0, pendingSummary: pendingSummary.rows, reconciliation }));
await pool.end();
