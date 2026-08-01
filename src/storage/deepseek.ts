type DeepSeekChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

import {
  estimateTokens,
  modelRequestFingerprint,
  recordModelCallAudit,
} from "./model-audit.js";
import { DEFAULT_SOURCE_POLICY, redactForModel, type SourceProcessingPolicy } from "./privacy.js";

export async function generateNaturalLanguageSummary(input: {
  apiKey?: string;
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  jsonMode?: boolean;
  audit?: {
    clientId?: string | null;
    eventId?: string | null;
    operation: string;
    promptVersion: string;
    attempt?: number;
  };
  redaction?: Pick<SourceProcessingPolicy, "redactEmails" | "redactFinancialIdentifiers">;
}) {
  if (!input.apiKey) {
    return null;
  }

  const model = input.model ?? "deepseek-v4-flash";
  const systemPrompt = input.systemPrompt;
  const userPrompt = redactForModel(input.userPrompt, input.redaction ?? DEFAULT_SOURCE_POLICY);
  const fingerprint = modelRequestFingerprint({ model, systemPrompt, userPrompt });
  const startedAt = Date.now();
  const inputTokensEstimate = estimateTokens(systemPrompt) + estimateTokens(userPrompt);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch(process.env.DEEPSEEK_API_URL ?? "https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
      body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ] satisfies DeepSeekChatMessage[],
      thinking: { type: "disabled" },
      ...(input.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    await recordModelCallAudit({
      clientId: input.audit?.clientId,
      eventId: input.audit?.eventId,
      provider: "deepseek",
      operation: input.audit?.operation ?? "natural_language_summary",
      model,
      promptVersion: input.audit?.promptVersion ?? "unversioned",
      status: error instanceof DOMException && error.name === "AbortError" ? "cancelled" : "failed",
      attempt: input.audit?.attempt,
      inputTokens: inputTokensEstimate,
      outputTokens: 0,
      latencyMs: Date.now() - startedAt,
      requestFingerprint: fingerprint,
      errorCode: error instanceof DOMException && error.name === "AbortError" ? "timeout" : "request_error",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text();
    await recordModelCallAudit({
      clientId: input.audit?.clientId,
      eventId: input.audit?.eventId,
      provider: "deepseek",
      operation: input.audit?.operation ?? "natural_language_summary",
      model,
      promptVersion: input.audit?.promptVersion ?? "unversioned",
      status: "failed",
      attempt: input.audit?.attempt,
      inputTokens: inputTokensEstimate,
      outputTokens: estimateTokens(text),
      latencyMs: Date.now() - startedAt,
      requestFingerprint: fingerprint,
      resultMetadata: { httpStatus: response.status },
      errorCode: `http_${response.status}`,
      errorMessage: text,
    });
    throw new Error(`DeepSeek request failed: ${response.status} ${text.slice(0, 500)}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  const content = json.choices?.[0]?.message?.content ?? null;
  await recordModelCallAudit({
    clientId: input.audit?.clientId,
    eventId: input.audit?.eventId,
    provider: "deepseek",
    operation: input.audit?.operation ?? "natural_language_summary",
    model,
    promptVersion: input.audit?.promptVersion ?? "unversioned",
    status: "succeeded",
    attempt: input.audit?.attempt,
    inputTokens: json.usage?.prompt_tokens ?? inputTokensEstimate,
    outputTokens: json.usage?.completion_tokens ?? estimateTokens(content ?? ""),
    latencyMs: Date.now() - startedAt,
    requestFingerprint: fingerprint,
    resultMetadata: { totalTokens: json.usage?.total_tokens ?? null, emptyResponse: !content },
  });
  return content;
}
