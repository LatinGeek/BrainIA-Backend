type DeepSeekChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

import {
  estimateTokens,
  modelRequestFingerprint,
  recordModelCallAudit,
} from "./model-audit.js";
import {
  acquireProviderSlot,
  DEFAULT_SOURCE_POLICY,
  logPrivacyDenial,
  redactForModel,
  stillAuthorized,
  type PrivacyAuthorization,
  type PrivacyDenial,
  type SourceProcessingPolicy,
} from "./privacy.js";

export async function generateNaturalLanguageSummary(input: {
  apiKey?: string;
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  jsonMode?: boolean;
  thinking?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
  audit?: {
    clientId?: string | null;
    eventId?: string | null;
    operation: string;
    promptVersion: string;
    attempt?: number;
  };
  redaction?: Pick<SourceProcessingPolicy, "redactEmails" | "redactFinancialIdentifiers">;
  /**
   * Server-resolved owner/purpose/evidence authorization. Required for every
   * external dispatch; absent or denied authorization never reaches fetch().
   */
  privacy?: PrivacyAuthorization | PrivacyDenial | null;
}) {
  if (!input.apiKey) {
    return null;
  }
  const authorization = input.privacy;
  if (!authorization?.allowed) {
    logPrivacyDenial(authorization ? authorization.reason : "missing_owner", {
      purpose: input.audit?.operation ?? "natural_language_summary",
    });
    return null;
  }

  const model = input.model ?? "deepseek-v4-flash";
  const systemPrompt = input.systemPrompt;
  const userPrompt = redactForModel(input.userPrompt, input.redaction ?? authorization.redaction ?? DEFAULT_SOURCE_POLICY);
  const fingerprint = modelRequestFingerprint({ model, systemPrompt, userPrompt });
  const startedAt = Date.now();
  const inputTokensEstimate = estimateTokens(systemPrompt) + estimateTokens(userPrompt);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 15_000);
  const release = await acquireProviderSlot(authorization.ownerId);
  let response: Response;
  try {
    // Re-check after the semaphore wait: a revocation while queued must not
    // dispatch, and a changed policy version invalidates this work.
    if (!(await stillAuthorized(authorization))) {
      logPrivacyDenial("policy_version_changed", { purpose: authorization.purpose });
      return null;
    }
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
        thinking: { type: input.thinking ? "enabled" : "disabled" },
        ...(input.thinking ? { reasoning_effort: "high" } : {}),
        ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
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
      // Metadata only: transport error names never contain prompt contents.
      resultMetadata: { errorName: error instanceof Error ? error.name : "Error" },
    });
    throw error;
  } finally {
    clearTimeout(timeout);
    release();
  }

  if (!response.ok) {
    // Never persist or log a provider error body: it can echo the prompt.
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
      outputTokens: 0,
      latencyMs: Date.now() - startedAt,
      requestFingerprint: fingerprint,
      resultMetadata: { httpStatus: response.status },
      errorCode: `http_${response.status}`,
    });
    throw new Error(`DeepSeek request failed with HTTP ${response.status}`);
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
  const publishable = await stillAuthorized(authorization);
  await recordModelCallAudit({
    clientId: input.audit?.clientId,
    eventId: input.audit?.eventId,
    provider: "deepseek",
    operation: input.audit?.operation ?? "natural_language_summary",
    model,
    promptVersion: input.audit?.promptVersion ?? "unversioned",
    status: publishable ? "succeeded" : "cancelled",
    attempt: input.audit?.attempt,
    inputTokens: json.usage?.prompt_tokens ?? inputTokensEstimate,
    outputTokens: json.usage?.completion_tokens ?? estimateTokens(content ?? ""),
    latencyMs: Date.now() - startedAt,
    requestFingerprint: fingerprint,
    resultMetadata: { totalTokens: json.usage?.total_tokens ?? null, emptyResponse: !content },
  });
  if (!publishable) {
    logPrivacyDenial("policy_version_changed", { purpose: authorization.purpose });
    return null;
  }
  return content;
}

/**
 * Streaming chat completion with the same privacy contract as
 * generateNaturalLanguageSummary: authorization is required before dispatch and
 * re-checked after the provider slot wait and once the stream ends. Content is
 * forwarded through onDelta as it arrives; the caller must discard what it
 * showed if the function returns null (authorization revoked mid-flight).
 * Every non-system message is redacted under the authorization's policy.
 */
export async function streamChatCompletion(input: {
  apiKey?: string;
  model?: string;
  messages: DeepSeekChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  audit: { clientId?: string | null; operation: string; promptVersion: string };
  privacy?: PrivacyAuthorization | PrivacyDenial | null;
  onDelta: (text: string) => void;
}): Promise<{ content: string; inputTokens: number; outputTokens: number } | null> {
  if (!input.apiKey) return null;
  const authorization = input.privacy;
  if (!authorization?.allowed) {
    logPrivacyDenial(authorization ? authorization.reason : "missing_owner", { purpose: input.audit.operation });
    return null;
  }
  const model = input.model ?? "deepseek-v4-flash";
  const messages = input.messages.map((message) => message.role === "system"
    ? message
    : { ...message, content: redactForModel(message.content, authorization.redaction ?? DEFAULT_SOURCE_POLICY) });
  const promptText = messages.map((message) => message.content).join("\n");
  const fingerprint = modelRequestFingerprint({ model, systemPrompt: messages[0]?.content ?? "", userPrompt: promptText });
  const inputTokensEstimate = estimateTokens(promptText);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 45_000);
  const release = await acquireProviderSlot(authorization.ownerId);
  let content = "";
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
  const audit = (status: "succeeded" | "failed" | "cancelled", extra: { errorCode?: string; resultMetadata?: Record<string, unknown> } = {}) => recordModelCallAudit({
    clientId: input.audit.clientId, eventId: null, provider: "deepseek", operation: input.audit.operation,
    model, promptVersion: input.audit.promptVersion, status,
    inputTokens: usage?.prompt_tokens ?? inputTokensEstimate,
    outputTokens: usage?.completion_tokens ?? estimateTokens(content),
    latencyMs: Date.now() - startedAt, requestFingerprint: fingerprint,
    ...extra,
  });
  try {
    if (!(await stillAuthorized(authorization))) {
      logPrivacyDenial("policy_version_changed", { purpose: authorization.purpose });
      return null;
    }
    const response = await fetch(process.env.DEEPSEEK_API_URL ?? "https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify({
        model, messages, stream: true, stream_options: { include_usage: true },
        thinking: { type: "disabled" },
        ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      // Never persist a provider error body: it can echo the prompt.
      await audit("failed", { errorCode: `http_${response.status}`, resultMetadata: { httpStatus: response.status } });
      throw new Error(`DeepSeek request failed with HTTP ${response.status}`);
    }
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string | null } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          if (parsed.usage) usage = parsed.usage;
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            content += delta;
            input.onDelta(delta);
          }
        } catch {
          // Ignore keep-alive or partial frames; the provider resends full events.
        }
      }
    }
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError";
    if (!(error instanceof Error && error.message.startsWith("DeepSeek request failed"))) {
      await audit(aborted ? "cancelled" : "failed", {
        errorCode: aborted ? "timeout" : "request_error",
        resultMetadata: { errorName: error instanceof Error ? error.name : "Error", partial: content.length > 0 },
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    release();
  }
  const publishable = await stillAuthorized(authorization);
  await audit(publishable ? "succeeded" : "cancelled", { resultMetadata: { emptyResponse: !content, streamed: true } });
  if (!publishable) {
    logPrivacyDenial("policy_version_changed", { purpose: authorization.purpose });
    return null;
  }
  return { content, inputTokens: usage?.prompt_tokens ?? inputTokensEstimate, outputTokens: usage?.completion_tokens ?? estimateTokens(content) };
}
