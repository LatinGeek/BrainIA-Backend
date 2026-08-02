import { pool } from "../storage/postgres.js";
import { previewEventSemantics, reprocessEvent } from "../storage/event-store.js";
import { TAXONOMY_VERSION } from "../domain/ontology.js";

const apply = process.argv.includes("--apply");
const limitArgument = process.argv.find((argument) => argument.startsWith("--limit="));
const limit = Math.min(10_000, Math.max(1, Number.parseInt(limitArgument?.slice("--limit=".length) ?? "250", 10)));

const events = await pool.query<{ id: string; currentCategoryKey: string | null; currentTaxonomyVersion: string | null }>(`
  select event.id, decision.primary_category_key as "currentCategoryKey", decision.taxonomy_version as "currentTaxonomyVersion"
  from raw_events event
  left join semantic_event_decisions decision on decision.event_id = event.id
  where event.processing_allowed and event.privacy_status <> 'hidden'
    and (decision.taxonomy_version is distinct from $1 or decision.primary_category_key is null)
  order by event.created_at asc
  limit $2
`, [TAXONOMY_VERSION, limit]);

const report = { taxonomyVersion: TAXONOMY_VERSION, mode: apply ? "apply" : "dry-run", requested: events.rows.length, changed: 0, review: 0, unclassified: 0, failed: 0, proposals: [] as Array<Record<string, unknown>> };
for (const event of events.rows) {
  try {
    const preview = await previewEventSemantics(event.id);
    const proposedCategoryKey = preview?.primaryCategoryKey ?? null;
    if (proposedCategoryKey !== event.currentCategoryKey) report.changed += 1;
    if (!proposedCategoryKey) report.unclassified += 1;
    if (preview?.status === "review") report.review += 1;
    report.proposals.push({ eventId: event.id, currentCategoryKey: event.currentCategoryKey, proposedCategoryKey, status: preview?.status ?? "unavailable" });
    if (apply) await reprocessEvent(event.id);
  } catch (error) {
    report.failed += 1;
    report.proposals.push({ eventId: event.id, error: error instanceof Error ? error.message : String(error) });
  }
}
console.log(JSON.stringify(report, null, 2));
await pool.end();
if (report.failed) process.exitCode = 1;
