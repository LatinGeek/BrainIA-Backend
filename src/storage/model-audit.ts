import crypto, { randomUUID } from "node:crypto";
import { pool } from "./postgres.js";

export type ModelCallAuditInput = {
  clientId?: string | null;
  eventId?: string | null;
  provider: string;
  operation: string;
  model: string;
  promptVersion: string;
  status: "succeeded" | "failed" | "cancelled";
  attempt?: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  requestFingerprint: string;
  resultMetadata?: Record<string, unknown>;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export function estimateTokens(text: string) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(Array.from(text).length / 4));
}

export function modelRequestFingerprint(input: { model: string; systemPrompt: string; userPrompt: string }) {
  return crypto.createHash("sha256")
    .update(input.model)
    .update("\0")
    .update(input.systemPrompt)
    .update("\0")
    .update(input.userPrompt)
    .digest("hex");
}

export function estimateModelCost(inputTokens: number, outputTokens: number, provider = 'deepseek') {
  const prefix = provider === 'typesafe' ? 'JEV' : 'DEEPSEEK';
  const inputRate = Number(process.env[`${prefix}_INPUT_USD_PER_MILLION_TOKENS`] ?? 0);
  const outputRate = Number(process.env[`${prefix}_OUTPUT_USD_PER_MILLION_TOKENS`] ?? 0);
  return (inputTokens * (Number.isFinite(inputRate) ? inputRate : 0)
    + outputTokens * (Number.isFinite(outputRate) ? outputRate : 0)) / 1_000_000;
}

export async function recordModelCallAudit(input: ModelCallAuditInput) {
  try {
    await pool.query(`
      insert into model_call_audits (
        id, client_id, event_id, provider, operation, model, prompt_version,
        status, attempt, input_tokens, output_tokens, estimated_cost_usd,
        latency_ms, request_fingerprint, result_metadata, error_code,
        error_message, completed_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,now())
    `, [
      `model_call_${randomUUID()}`, input.clientId ?? null, input.eventId ?? null,
      input.provider, input.operation, input.model, input.promptVersion,
      input.status, input.attempt ?? 1, input.inputTokens, input.outputTokens,
      estimateModelCost(input.inputTokens, input.outputTokens, input.provider), input.latencyMs,
      input.requestFingerprint, JSON.stringify(input.resultMetadata ?? {}),
      input.errorCode ?? null, input.errorMessage?.slice(0, 2000) ?? null,
    ]);
  } catch (error) {
    // Audit storage must never hide the provider result. Surface the failure to
    // operations without logging prompt contents or secrets.
    console.error("model_call_audit_failed", error instanceof Error ? error.message : String(error));
  }
}
