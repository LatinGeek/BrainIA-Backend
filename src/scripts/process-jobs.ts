import { config } from "../config.js";
import { processBackgroundJobs } from "../storage/job-worker.js";
import { pool } from "../storage/postgres.js";

try {
  const result = await processBackgroundJobs({ limit: config.workerBatchSize });
  console.log(JSON.stringify(result, null, 2));
  if (result.results.some((item) => item.status === "dead_letter")) process.exitCode = 1;
} finally {
  await pool.end();
}

