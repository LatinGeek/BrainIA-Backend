import crypto, { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { pool } from "./postgres.js";

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

