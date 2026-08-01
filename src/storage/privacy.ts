import { randomUUID } from "node:crypto";
import { pool } from "./postgres.js";

type Queryable = Pick<typeof pool, "query">;

export type SourceProcessingPolicy = {
  enabled: boolean;
  sendToLlm: boolean;
  redactEmails: boolean;
  redactFinancialIdentifiers: boolean;
  retentionDays: number | null;
};

export const DEFAULT_SOURCE_POLICY: SourceProcessingPolicy = {
  enabled: true,
  sendToLlm: true,
  redactEmails: true,
  redactFinancialIdentifiers: true,
  retentionDays: null,
};

function clientScope(clientId: string | null | undefined) {
  return clientId?.trim() || "anonymous";
}

export function redactForModel(
  value: string,
  policy: Pick<SourceProcessingPolicy, "redactEmails" | "redactFinancialIdentifiers"> = DEFAULT_SOURCE_POLICY,
) {
  let redacted = value;
  if (policy.redactEmails) {
    redacted = redacted.replace(
      /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/giu,
      (_match, domain: string) => `[redacted-email]@${domain.toLocaleLowerCase()}`,
    );
  }
  if (policy.redactFinancialIdentifiers) {
    redacted = redacted
      .replace(/\b(?:\d[ -]?){12,19}\b/gu, "[redacted-card]")
      .replace(/\b(?:account|cuenta|acct|iban)\s*(?:n(?:o|ro|umber|úmero)?\.?\s*)?[:#-]?\s*[A-Z0-9-]{6,34}\b/giu, "[redacted-account]")
      .replace(/\b(?:cvv|cvc)\s*[:#-]?\s*\d{3,4}\b/giu, "[redacted-security-code]");
  }
  return redacted;
}

export async function loadSourceProcessingPolicy(
  db: Queryable,
  input: { clientId?: string | null; source: string },
): Promise<SourceProcessingPolicy> {
  const result = await db.query<{
    enabled: boolean;
    sendToLlm: boolean;
    redactEmails: boolean;
    redactFinancialIdentifiers: boolean;
    retentionDays: number | null;
  }>(`
    select enabled, send_to_llm as "sendToLlm", redact_emails as "redactEmails",
      redact_financial_identifiers as "redactFinancialIdentifiers",
      retention_days as "retentionDays"
    from source_processing_policies
    where client_scope = $1 and lower(source) = lower($2)
    limit 1
  `, [clientScope(input.clientId), input.source]);
  return result.rows[0] ?? DEFAULT_SOURCE_POLICY;
}

export async function upsertSourceProcessingPolicy(
  db: Queryable,
  input: { clientId?: string | null; source: string } & Partial<SourceProcessingPolicy>,
) {
  const policy = { ...DEFAULT_SOURCE_POLICY, ...input };
  const result = await db.query(`
    insert into source_processing_policies (
      id, client_scope, source, enabled, send_to_llm, redact_emails,
      redact_financial_identifiers, retention_days
    ) values ($1,$2,$3,$4,$5,$6,$7,$8)
    on conflict (client_scope, source) do update set
      enabled = excluded.enabled, send_to_llm = excluded.send_to_llm,
      redact_emails = excluded.redact_emails,
      redact_financial_identifiers = excluded.redact_financial_identifiers,
      retention_days = excluded.retention_days, updated_at = now()
    returning id, client_scope as "clientScope", source, enabled,
      send_to_llm as "sendToLlm", redact_emails as "redactEmails",
      redact_financial_identifiers as "redactFinancialIdentifiers",
      retention_days as "retentionDays", updated_at as "updatedAt"
  `, [
    `policy_${randomUUID()}`, clientScope(input.clientId), input.source,
    policy.enabled, policy.sendToLlm, policy.redactEmails,
    policy.redactFinancialIdentifiers, policy.retentionDays,
  ]);
  return result.rows[0];
}

