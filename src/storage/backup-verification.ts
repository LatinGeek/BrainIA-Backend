import crypto, { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  DELETION_BACKUP_EXPIRY_DAYS,
  replayDeletionTombstone,
  type DeletionMode,
} from "./data-controls.js";
import { pool, withTransactionOnPool } from "./postgres.js";

const TABLES = [
  "raw_events", "classified_events", "knowledge_facts", "entities", "relations",
  "event_entities", "event_relations", "financial_transactions", "insight_runs", "digest_runs",
] as const;

function connectionFingerprint(connectionString: string) {
  return crypto.createHash("sha256").update(connectionString.replace(/:[^:@/]+@/u, ":***@")).digest("hex");
}

async function tableCounts(db: Pick<Pool, "query">) {
  const counts: Record<string, number> = {};
  for (const table of TABLES) {
    const result = await db.query<{ count: number }>(`select count(*)::int as count from ${table}`);
    counts[table] = Number(result.rows[0]?.count ?? 0);
  }
  return counts;
}

type RestoreTombstone = {
  ownerId: string;
  targetType: string;
  targetId: string;
  mode: DeletionMode;
  policy: Record<string, unknown>;
  reason: string | null;
  backupExpiresAt: string;
};

/**
 * Restore gate. Call this against the restored database, with the live
 * tombstone ledger as the source, BEFORE the database is exposed to traffic.
 *
 * Backups older than DELETION_BACKUP_EXPIRY_DAYS (30 days by default) may
 * predate the ledger. They must be blocked for manual privacy review rather
 * than served after this replay. The returned `trafficBlocked` is true only
 * when the restored copy was explicitly marked verified, every ledger row was
 * applied, no ledger row is expired, and no tombstoned event is read-eligible.
 *
 * An empty ledger is NOT implicitly safe: a backup that predates the ledger
 * looks exactly like an empty ledger. Passing `restoreVerified` and
 * `ledgerComplete` is an explicit operator assertion that the restored copy
 * and the live ledger are both complete for the backup taken.
 */
export async function applyDeletionTombstonesAfterRestore(input: {
  target?: Pool;
  ledger?: Pick<Pool, "query">;
  restoreVerified?: boolean;
  ledgerComplete?: boolean;
} = {}) {
  const target = input.target ?? pool;
  const ledger = input.ledger ?? pool;
  const restoreVerified = input.restoreVerified === true;
  const tombstones = await ledger.query<RestoreTombstone>(`
    select owner_id as "ownerId", target_type as "targetType", target_id as "targetId",
      mode, policy, reason, backup_expires_at as "backupExpiresAt"
    from deletion_tombstones
    order by created_at
  `);
  if (!tombstones.rows.length) {
    const safe = restoreVerified && input.ledgerComplete === true;
    return {
      tombstones: 0, applied: 0, trafficBlocked: safe,
      backupExpiryDays: DELETION_BACKUP_EXPIRY_DAYS,
      expiredBackups: [],
      restoreVerified,
      ledgerComplete: input.ledgerComplete === true,
      reason: safe
        ? "empty_ledger_explicitly_verified"
        : "empty_ledger_not_traffic_safe_without_explicit_verification",
    };
  }
  const expiredBackups = tombstones.rows
    .filter((row) => Date.parse(row.backupExpiresAt) < Date.now())
    .map((row) => row.ownerId);
  const applied = await withTransactionOnPool(target, async (db) => {
    let count = 0;
    for (const tombstone of tombstones.rows) {
      await replayDeletionTombstone(db, {
        ownerId: tombstone.ownerId,
        targetType: tombstone.targetType,
        targetId: tombstone.targetId,
        mode: tombstone.mode,
        policy: tombstone.policy,
        reason: tombstone.reason,
        backupExpiresAt: tombstone.backupExpiresAt,
      });
      count += 1;
    }
    return count;
  });
  const eligible = await target.query<{ count: number }>(`
    select count(*)::int as count
    from deletion_tombstones tombstone
    join raw_events event on event.id = tombstone.target_id
    where tombstone.target_type = 'event'
      and (event.privacy_status <> 'hidden' or event.processing_allowed)
  `);
  const ledgerApplied = applied === tombstones.rows.length;
  const trafficBlocked = restoreVerified
    && ledgerApplied
    && expiredBackups.length === 0
    && (eligible.rows[0]?.count ?? 0) === 0;
  return {
    tombstones: tombstones.rows.length,
    applied,
    trafficBlocked,
    backupExpiryDays: DELETION_BACKUP_EXPIRY_DAYS,
    expiredBackups,
    restoreVerified,
    ledgerComplete: ledgerApplied,
    reason: trafficBlocked
      ? "tombstones_applied"
      : expiredBackups.length > 0
        ? "expired_backup_requires_review"
        : !restoreVerified
          ? "restore_not_explicitly_verified"
          : !ledgerApplied
            ? "ledger_not_fully_applied"
            : "tombstoned_event_still_eligible",
  };
}

export async function verifyConfiguredBackup() {
  const backupUrl = process.env.BACKUP_DATABASE_URL?.trim();
  const sourceUrl = process.env.DATABASE_URL?.trim() ?? "configured-runtime-pool";
  const runId = `backup_verify_${randomUUID()}`;
  await pool.query(`
    insert into backup_verification_runs (id, status, source_fingerprint)
    values ($1,'running',$2)
  `, [runId, connectionFingerprint(sourceUrl)]);
  if (!backupUrl) {
    const error = "BACKUP_DATABASE_URL is required to verify a restorable backup";
    await pool.query(`update backup_verification_runs set status = 'failed', error = $2, completed_at = now() where id = $1`, [runId, error]);
    return { id: runId, status: "failed" as const, error };
  }
  const backup = new Pool({ connectionString: backupUrl, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    const [sourceCounts, backupCounts, migration] = await Promise.all([
      tableCounts(pool),
      tableCounts(backup),
      backup.query<{ latest: string | null }>(`select max(version) as latest from schema_migrations`),
    ]);
    const missingTables = TABLES.filter((table) => !(table in backupCounts));
    const impossibleCounts = TABLES.filter((table) => backupCounts[table] < 0);
    const verification = {
      targetFingerprint: connectionFingerprint(backupUrl),
      latestMigration: migration.rows[0]?.latest ?? null,
      missingTables,
      impossibleCounts,
      sourceCounts,
      backupCounts,
      note: "A backup may legitimately trail the live database; this check proves schema readability and row-level restorability.",
    };
    const verified = missingTables.length === 0 && impossibleCounts.length === 0 && Boolean(verification.latestMigration);
    await pool.query(`
      update backup_verification_runs set status = $2, table_counts = $3::jsonb,
        verification = $4::jsonb, error = $5, completed_at = now() where id = $1
    `, [runId, verified ? "verified" : "failed", JSON.stringify(backupCounts), JSON.stringify(verification), verified ? null : "Backup schema verification failed"]);
    return { id: runId, status: verified ? "verified" as const : "failed" as const, verification };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await pool.query(`update backup_verification_runs set status = 'failed', error = $2, completed_at = now() where id = $1`, [runId, message.slice(0, 2000)]);
    return { id: runId, status: "failed" as const, error: message };
  } finally {
    await backup.end();
  }
}

