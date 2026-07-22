import { listEvents, reprocessEvent } from "../storage/event-store.js";
import { pool, withTransaction } from "../storage/postgres.js";
import { ensureOntology } from "../storage/semantic-repository.js";
import { SEMANTIC_GOVERNANCE_VERSION } from "../domain/ontology.js";
import { reconcileSemanticGraph } from "../storage/semantic-reconciler.js";

const sourceFilter = process.argv.slice(2).find((argument) => argument.startsWith("--source="))?.slice("--source=".length).trim().toLowerCase();
const eventFilter = process.argv.slice(2).find((argument) => argument.startsWith("--event="))?.slice("--event=".length).trim();
const eventContains = process.argv.slice(2).find((argument) => argument.startsWith("--event-contains="))?.slice("--event-contains=".length).trim();
const limit = Number.parseInt(process.argv.slice(2).find((argument) => argument.startsWith("--limit="))?.slice("--limit=".length) ?? "0", 10);
const offset = Number.parseInt(process.argv.slice(2).find((argument) => argument.startsWith("--offset="))?.slice("--offset=".length) ?? "0", 10);
const requestedConcurrency = Number.parseInt(process.argv.slice(2).find((argument) => argument.startsWith("--concurrency="))?.slice("--concurrency=".length) ?? "1", 10);
const unsafeConcurrency = process.argv.includes("--unsafe-concurrency");
const skipReconciliation = process.argv.includes("--skip-reconciliation");
const missingOnly = process.argv.includes("--missing-only");
const missingInterpretation = process.argv.includes("--missing-interpretation");
const interpretationStatus = process.argv.slice(2).find((argument) => argument.startsWith("--interpretation-status="))?.slice("--interpretation-status=".length).trim();
const staleSinceEpoch = Number.parseInt(process.argv.slice(2).find((argument) => argument.startsWith("--stale-since-epoch="))?.slice("--stale-since-epoch=".length) ?? "0", 10);
const decisionRows = missingOnly || staleSinceEpoch > 0
  ? (await pool.query<{ eventId: string; updatedEpoch: number }>(`select event_id as "eventId", extract(epoch from updated_at)::float8 as "updatedEpoch" from semantic_event_decisions where governance_version = $1`, [SEMANTIC_GOVERNANCE_VERSION])).rows
  : [];
const decided = new Map(decisionRows.map((row) => [row.eventId, row.updatedEpoch]));
const allEvents = (await listEvents()).filter((event) =>
  (!sourceFilter || event.source.toLowerCase().includes(sourceFilter))
  && (!eventFilter || event.id === eventFilter)
  && (!eventContains || event.id.includes(eventContains))
  && (!missingInterpretation || !event.displayTitle)
  && (!interpretationStatus || event.interpretationStatus === interpretationStatus)
  && (!missingOnly || !decided.has(event.id))
  && (!(staleSinceEpoch > 0) || (decided.get(event.id) ?? 0) < staleSinceEpoch));
const events = allEvents.slice(Math.max(0, offset), Number.isFinite(limit) && limit > 0 ? Math.max(0, offset) + limit : undefined);
for (const clientId of new Set(events.map((event) => event.clientId))) await withTransaction((db) => ensureOntology(db, clientId));
let processed = 0;
const failed: string[] = [];
const concurrency = unsafeConcurrency
  ? Math.min(4, Math.max(1, Number.isFinite(requestedConcurrency) ? requestedConcurrency : 1), Math.max(1, events.length))
  : 1;
let cursor = 0;

await Promise.all(Array.from({ length: concurrency }, async () => {
  while (true) {
    const index = cursor;
    cursor += 1;
    const event = events[index];
    if (!event) return;
    try {
      if (await reprocessEvent(event.id, { ensureOntology: false })) processed += 1;
      console.log(`${index + 1}/${events.length} ${event.id}`);
    } catch (error) {
      failed.push(event.id);
      console.error(`FAILED ${event.id}`, error instanceof Error ? error.stack ?? error.message : String(error));
    }
  }
}));

const reconciliation = skipReconciliation
  ? { status: "skipped" as const }
  : failed.length
    ? { status: "awaiting_failed_event_retry" as const }
    : await reconcileSemanticGraph();
console.log(JSON.stringify({ processed, selected: events.length, available: allEvents.length, offset: Math.max(0, offset), concurrency, requestedConcurrency, unsafeConcurrency, sourceFilter: sourceFilter ?? null, eventFilter: eventFilter ?? null, eventContains: eventContains ?? null, missingOnly, missingInterpretation, interpretationStatus: interpretationStatus ?? null, staleSinceEpoch: staleSinceEpoch || null, failed, reconciliation }));
await pool.end();
