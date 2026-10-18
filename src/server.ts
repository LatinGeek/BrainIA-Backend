import { buildApp } from "./app.js";
import { config } from "./config.js";
import { applyDeletionTombstonesAfterRestore } from "./storage/backup-verification.js";

// Restore mode is an explicit, pre-traffic deployment step. A restored copy
// must not be served just because it starts cleanly: the tombstone ledger has
// to be applied first. An absent/empty ledger is not treated as safe unless
// the operator explicitly asserts both that the restored copy was verified and
// that the live ledger is complete for the backup.
if (process.env.BRAINIA_RESTORE_MODE?.trim() === "true") {
  const gate = await applyDeletionTombstonesAfterRestore({
    restoreVerified: process.env.BRAINIA_RESTORE_VERIFIED?.trim() === "true",
    ledgerComplete: process.env.BRAINIA_RESTORE_LEDGER_COMPLETE?.trim() === "true",
  });
  if (!gate.trafficBlocked) {
    console.error("deletion restore gate blocked traffic", {
      tombstones: gate.tombstones,
      applied: gate.applied,
      expiredBackups: gate.expiredBackups.length,
      reason: gate.reason,
    });
    process.exitCode = 1;
    throw new Error(`deletion_restore_gate_blocked:${gate.reason}`);
  }
  console.log("deletion restore gate passed", { tombstones: gate.tombstones, applied: gate.applied });
}

const app = await buildApp();
await app.listen({ port: config.port, host: config.host });
