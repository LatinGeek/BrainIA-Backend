import { verifyConfiguredBackup } from "../storage/backup-verification.js";
import { pool } from "../storage/postgres.js";

try {
  const result = await verifyConfiguredBackup();
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "verified") process.exitCode = 1;
} finally {
  await pool.end();
}

