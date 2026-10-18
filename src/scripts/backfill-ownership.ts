import { pool } from "../storage/postgres.js";
import { backfillOwnership, ownerInventory } from "../storage/ownership.js";

// Additive, idempotent owner backfill. Defaults to a dry run: an operator must
// pass --apply explicitly. Production mapping approval is a separate owner
// decision; unmapped legacy ids are recorded as provisional identity defaults.
const apply = process.argv.includes("--apply");
const mappingArg = process.argv.find((argument) => argument.startsWith("--mapping="));
const mapping: Record<string, string> = {};
if (mappingArg) {
  for (const pair of mappingArg.slice("--mapping=".length).split(",")) {
    const [legacy, owner] = pair.split(":");
    if (legacy && owner) mapping[legacy.trim()] = owner.trim();
  }
}

const inventory = await ownerInventory(pool);
const result = await backfillOwnership(pool, {
  dryRun: !apply,
  mapping,
  approvedBy: mappingArg ? "cli_explicit_mapping" : "cli_identity_default",
});

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  personalTables: inventory.filter((entry) => entry.personal).map((entry) => ({ table: entry.table, ownerKey: entry.ownerKey })),
  personalTablesWithoutOwnerKey: inventory.filter((entry) => entry.personal && !entry.ownerKey).map((entry) => entry.table),
  result,
}, null, 2));

await pool.end();
