import { pool, withTransaction } from "../storage/postgres.js";
import { consolidateProviderIdentity } from "../storage/semantic-repository.js";

const apps = await pool.query<{ value: string; normalizedValue: string; metadata: Record<string, unknown> }>(`
  select value, normalized_value as "normalizedValue", metadata
  from entities
  where type = 'app'
  order by id asc
`);

let processed = 0;
for (const app of apps.rows) {
  await withTransaction(async (db) => {
    await consolidateProviderIdentity(db, {
      type: "app",
      value: app.value,
      normalizedValue: app.normalizedValue,
      metadata: app.metadata ?? {},
    });
  });
  processed += 1;
}

// A merge can reveal a historical relation whose endpoints resolve to the same
// canonical entity. It has no meaning in the knowledge graph.
const removed = await pool.query(`delete from relations where source_entity_id = target_entity_id`);
console.log(JSON.stringify({ processed, removedSelfRelations: removed.rowCount ?? 0 }));
await pool.end();
