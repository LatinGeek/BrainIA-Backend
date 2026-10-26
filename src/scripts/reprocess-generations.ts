import {
  activateInterpretationGeneration,
  captureBaselineInterpretationGeneration,
  compareInterpretationGeneration,
  createInterpretationGeneration,
  currentInterpretationGeneration,
  getInterpretationGeneration,
  listInterpretationGenerations,
  rollbackInterpretationGeneration,
  stageInterpretationGeneration,
} from "../storage/interpretation-generations.js";
import { decisionPolicyMode } from "../domain/decision-policy.js";
import { pool } from "../storage/postgres.js";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numberArgument(name: string) {
  const value = argument(name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function main() {
  const command = process.argv[2];
  if (!command || command === "help") {
    console.log(`Usage:
  reprocess-generations create [--label <text>] [--client <id>] [--created-by <id>]
  reprocess-generations baseline [--label <text>] [--client <id>] [--created-by <id>]
  reprocess-generations stage --generation <id> [--batch <n>] [--max <n>] [--concurrency <n>] [--client <id>] [--shard-index <n> --shard-count <n>]
  reprocess-generations compare --generation <id> [--no-report]
  reprocess-generations activate --generation <id> [--batch <n>] [--max <n>] [--concurrency <n>] [--shard-index <n> --shard-count <n>]
  reprocess-generations rollback [--to <generation-id>]
  reprocess-generations status [--generation <id>]
  reprocess-generations list [--limit <n>]

Set BRAINIA_EVIDENCE_POLICY=enforce to stage with the evidence policy active.`);
    await pool.end();
    return;
  }
  if (command !== "status" && command !== "list") {
    console.error(JSON.stringify({ policyMode: decisionPolicyMode(), warning: decisionPolicyMode() === "enforce" ? null : "staging without enforce mode records observations but does not block unverified decisions" }));
  }
  if (command === "create") {
    const generation = await createInterpretationGeneration({
      label: argument("label") ?? null,
      clientId: argument("client") ?? null,
      createdBy: argument("created-by") ?? null,
    });
    console.log(JSON.stringify({ generation }, null, 2));
  } else if (command === "baseline") {
    const generation = await captureBaselineInterpretationGeneration({
      label: argument("label") ?? null,
      clientId: argument("client") ?? null,
      createdBy: argument("created-by") ?? null,
    });
    console.log(JSON.stringify({ generation }, null, 2));
  } else if (command === "stage") {
    const generationId = argument("generation");
    if (!generationId) throw new Error("--generation is required");
    const result = await stageInterpretationGeneration(generationId, {
      batchSize: numberArgument("batch"),
      maxEvents: numberArgument("max"),
      concurrency: numberArgument("concurrency"),
      shardIndex: numberArgument("shard-index"),
      shardCount: numberArgument("shard-count"),
      clientId: argument("client") ?? null,
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "compare") {
    const generationId = argument("generation");
    if (!generationId) throw new Error("--generation is required");
    const comparison = await compareInterpretationGeneration(generationId, { writeReport: !process.argv.includes("--no-report") });
    console.log(JSON.stringify(comparison, null, 2));
  } else if (command === "activate") {
    const generationId = argument("generation");
    if (!generationId) throw new Error("--generation is required");
    const result = await activateInterpretationGeneration(generationId, {
      batchSize: numberArgument("batch"),
      maxEvents: numberArgument("max"),
      concurrency: numberArgument("concurrency"),
      shardIndex: numberArgument("shard-index"),
      shardCount: numberArgument("shard-count"),
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "rollback") {
    const result = await rollbackInterpretationGeneration({ toGenerationId: argument("to") });
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "status") {
    const id = argument("generation");
    const generation = id ? await getInterpretationGeneration(id) : null;
    console.log(JSON.stringify({ control: await currentInterpretationGeneration(), generation }, null, 2));
  } else if (command === "list") {
    console.log(JSON.stringify({ items: await listInterpretationGenerations(numberArgument("limit") ?? 20) }, null, 2));
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
  await pool.end();
}

await main().catch(async (error) => {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
});
