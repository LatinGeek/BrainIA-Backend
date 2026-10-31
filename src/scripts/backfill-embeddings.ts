import { EMBEDDING_VERSION, embeddingProvider, refreshEventEmbeddings } from "../storage/embeddings.js";
import { pool } from "../storage/postgres.js";

// Re-embeds visible events (and their linked entities) for the configured
// EMBEDDING_VERSION. Idempotent: unchanged text already embedded by the current
// model is skipped inside upsertEmbedding, so a rerun only pays for new or
// changed rows. Defaults to a dry run; pass --apply to call the provider.
//
//   npm run backfill:embeddings -- --apply [--owner=<ownerId>] [--limit=5000] [--concurrency=4]
const apply = process.argv.includes("--apply");
const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const owner = arg("owner") ?? null;
const limit = Math.max(1, Number(arg("limit") ?? 5000));
const concurrency = Math.min(8, Math.max(1, Number(arg("concurrency") ?? 4)));
const model = embeddingProvider()?.model ?? null;

const pending = await pool.query<{ id: string }>(`
  select event.id
  from raw_events event
  where event.privacy_status = 'standard'
    and ($1::text is null or coalesce(event.owner_id, event.client_id) = $1)
    and not exists (
      select 1 from knowledge_embeddings embedding
      where embedding.object_type = 'event' and embedding.object_id = event.id
        and embedding.embedding_version = $2 and embedding.model = coalesce($3, embedding.model)
    )
  order by coalesce(event.timestamp, event.created_at) desc
  limit $4
`, [owner, EMBEDDING_VERSION, model, limit]);

const summary = {
  mode: apply ? "apply" : "dry-run",
  embeddingVersion: EMBEDDING_VERSION,
  externalProvider: model,
  candidates: pending.rows.length,
  processed: 0,
  written: 0,
  failed: 0,
};

if (apply) {
  const queue = [...pending.rows];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      try {
        const stored = await refreshEventEmbeddings(pool, next.id);
        summary.written += stored.length;
      } catch {
        // Metadata only: never log event text or ids of personal data.
        summary.failed += 1;
      }
      summary.processed += 1;
      if (summary.processed % 100 === 0) console.error(`processed ${summary.processed}/${summary.candidates}`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}

console.log(JSON.stringify(summary, null, 2));
await pool.end();
