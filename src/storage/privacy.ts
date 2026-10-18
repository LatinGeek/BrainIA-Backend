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

/**
 * Every externally dispatched model/embedding call must declare a purpose.
 * The list is intentionally closed: an unknown purpose is a policy denial, not
 * an implicit "internal" call.
 */
export const PRIVACY_PURPOSES = [
  "event_classification",
  "semantic_enrichment",
  "semantic_event_identity",
  "semantic_reconciliation",
  "retrieval_query",
  "embedding",
  "agent_inspect",
  "intelligence_plan",
  "intelligence_synthesis",
  "knowledge_digest_synthesis",
  "proactive_insight_synthesis",
] as const;

export type PrivacyPurpose = (typeof PRIVACY_PURPOSES)[number];

export type PrivacyDenialReason =
  | "missing_owner"
  | "missing_purpose"
  | "unknown_purpose"
  | "source_disabled"
  | "source_llm_denied"
  | "source_policy_missing"
  | "evidence_missing"
  | "cross_owner_evidence"
  | "legacy_unowned_evidence"
  | "evidence_not_standard"
  | "evidence_processing_denied"
  | "target_tombstoned"
  | "policy_version_changed";

export type EvidenceEligibility = {
  eventId?: string | null;
  source?: string | null;
  ownerId?: string | null;
};

export type PrivacyAuthorization = {
  allowed: true;
  ownerId: string;
  purpose: PrivacyPurpose;
  policyVersion: number;
  sources: string[];
  eventIds: string[];
  redaction: Pick<SourceProcessingPolicy, "redactEmails" | "redactFinancialIdentifiers">;
  /** Re-evaluates the live policy. False means the authorization was revoked. */
  recheck: () => Promise<boolean>;
};

export type PrivacyDenial = {
  allowed: false;
  ownerId: string | null;
  purpose: string | null;
  reason: PrivacyDenialReason;
  sources: string[];
};

export type PrivacyDecision = PrivacyAuthorization | PrivacyDenial;

export type ModelDispatchInput = {
  ownerId?: string | null;
  purpose?: string | null;
  sources?: Array<string | null | undefined>;
  evidence?: EvidenceEligibility[];
  eventIds?: Array<string | null | undefined>;
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

type PolicyRow = SourceProcessingPolicy & { source: string; version: number };

async function loadPolicyRows(
  db: Queryable,
  ownerId: string,
  sources: string[],
): Promise<Map<string, PolicyRow>> {
  if (!sources.length) return new Map();
  const result = await db.query<{
    source: string;
    enabled: boolean;
    sendToLlm: boolean;
    redactEmails: boolean;
    redactFinancialIdentifiers: boolean;
    retentionDays: number | null;
    version: number;
  }>(`
    select distinct on (lower(source))
      lower(source) as source, enabled, send_to_llm as "sendToLlm",
      redact_emails as "redactEmails",
      redact_financial_identifiers as "redactFinancialIdentifiers",
      retention_days as "retentionDays",
      coalesce(policy_version, 0)::int as version
    from source_processing_policies
    where (owner_id = $1 or (owner_id is null and client_scope = $1))
      and lower(source) = any($2::text[])
    order by lower(source), (owner_id is not null) desc, updated_at desc
  `, [ownerId, sources.map((source) => source.toLowerCase())]);
  return new Map(result.rows.map((row) => [row.source, {
    source: row.source,
    enabled: row.enabled,
    sendToLlm: row.sendToLlm,
    redactEmails: row.redactEmails,
    redactFinancialIdentifiers: row.redactFinancialIdentifiers,
    retentionDays: row.retentionDays,
    version: row.version,
  }]));
}

/**
 * Resolves the reusable per-source policy for an owner. The owner id is the
 * server-resolved B06 principal owner; client ids are only used as a legacy
 * fallback when the policy row has no owner.
 */
export async function loadSourceProcessingPolicy(
  db: Queryable,
  input: { ownerId?: string | null; clientId?: string | null; source: string },
): Promise<SourceProcessingPolicy> {
  const ownerId = input.ownerId?.trim() || input.clientId?.trim();
  if (ownerId) {
    const rows = await loadPolicyRows(db, ownerId, [input.source]);
    const row = rows.get(input.source.toLowerCase());
    if (row) return row;
  }
  // Legacy lookups by client_scope keep existing callers working. The owner
  // path above takes precedence whenever a principal is available.
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
    order by updated_at desc
    limit 1
  `, [clientScope(input.clientId), input.source]);
  return result.rows[0] ?? DEFAULT_SOURCE_POLICY;
}

/**
 * Evaluates owner, purpose, source policy, evidence ownership and evidence
 * visibility for one prospective external dispatch. This is the single gate
 * used before any provider fetch.
 */
export async function authorizeModelDispatch(
  db: Queryable,
  input: ModelDispatchInput,
): Promise<PrivacyDecision> {
  const ownerId = input.ownerId?.trim() || null;
  const purpose = input.purpose?.trim() || null;
  const sources = [...new Set((input.sources ?? []).map((source) => source?.trim()).filter((source): source is string => Boolean(source)))];
  if (!ownerId) return { allowed: false, ownerId: null, purpose, reason: "missing_owner", sources };
  if (!purpose) return { allowed: false, ownerId, purpose: null, reason: "missing_purpose", sources };
  if (!(PRIVACY_PURPOSES as readonly string[]).includes(purpose)) {
    return { allowed: false, ownerId, purpose, reason: "unknown_purpose", sources };
  }

  const directEventIds = (input.eventIds ?? []).map((id) => id?.trim()).filter((id): id is string => Boolean(id));
  const evidence = input.evidence ?? [];
  const evidenceEventIds = evidence.map((item) => item.eventId?.trim()).filter((id): id is string => Boolean(id));
  const eventIds = [...new Set([...directEventIds, ...evidenceEventIds])];
  for (const item of evidence) {
    if (item.ownerId && item.ownerId !== ownerId) {
      return { allowed: false, ownerId, purpose: purpose as PrivacyPurpose, reason: "cross_owner_evidence", sources };
    }
    if (item.source) sources.push(item.source);
  }
  const uniqueSources = [...new Set(sources)];

  // A deletion tombstone is an immediate egress barrier, independent of the
  // physical cleanup worker and of the target's current privacy flag.
  if (eventIds.length) {
    const tombstoned = await db.query<{ targetId: string }>(`
      select target_id as "targetId" from deletion_tombstones
      where target_type = 'event' and owner_id = $1 and target_id = any($2::text[])
      limit 1
    `, [ownerId, eventIds]);
    if (tombstoned.rows.length) {
      return {
        allowed: false, ownerId, purpose: purpose as PrivacyPurpose,
        reason: "target_tombstoned", sources: uniqueSources,
      };
    }
  }

  if (eventIds.length) {
    const result = await db.query<{
      id: string;
      source: string;
      ownerId: string | null;
      privacyStatus: string;
      processingAllowed: boolean;
    }>(`
      select id, source, coalesce(owner_id, client_id) as "ownerId",
        privacy_status as "privacyStatus", processing_allowed as "processingAllowed"
      from raw_events
      where id = any($1::text[])
    `, [eventIds]);
    const found = new Map(result.rows.map((row) => [row.id, row]));
    for (const eventId of eventIds) {
      const row = found.get(eventId);
      if (!row) {
        return { allowed: false, ownerId, purpose: purpose as PrivacyPurpose, reason: "evidence_missing", sources: uniqueSources };
      }
      if (!row.ownerId) {
        return { allowed: false, ownerId, purpose: purpose as PrivacyPurpose, reason: "legacy_unowned_evidence", sources: uniqueSources };
      }
      if (row.ownerId !== ownerId) {
        return { allowed: false, ownerId, purpose: purpose as PrivacyPurpose, reason: "cross_owner_evidence", sources: uniqueSources };
      }
      if (row.privacyStatus !== "standard") {
        return { allowed: false, ownerId, purpose: purpose as PrivacyPurpose, reason: "evidence_not_standard", sources: uniqueSources };
      }
      if (!row.processingAllowed) {
        return { allowed: false, ownerId, purpose: purpose as PrivacyPurpose, reason: "evidence_processing_denied", sources: uniqueSources };
      }
      if (!uniqueSources.includes(row.source)) uniqueSources.push(row.source);
    }
  }

  const policies = await loadPolicyRows(db, ownerId, uniqueSources);
  let policyVersion = 0;
  let redactEmails = false;
  let redactFinancialIdentifiers = false;
  for (const source of uniqueSources) {
    // Fail closed when an explicit source has no policy row for this owner.
    // The legacy permissive DEFAULT_SOURCE_POLICY is still used for ingest-time
    // processing decisions, but it must never authorize external egress.
    const row = policies.get(source.toLowerCase());
    if (!row) {
      return { allowed: false, ownerId, purpose: purpose as PrivacyPurpose, reason: "source_policy_missing", sources: uniqueSources };
    }
    const policy = row;
    const version = row.version;
    if (!policy.enabled) {
      return { allowed: false, ownerId, purpose: purpose as PrivacyPurpose, reason: "source_disabled", sources: uniqueSources };
    }
    if (!policy.sendToLlm) {
      return { allowed: false, ownerId, purpose: purpose as PrivacyPurpose, reason: "source_llm_denied", sources: uniqueSources };
    }
    policyVersion = Math.max(policyVersion, version);
    redactEmails = redactEmails || policy.redactEmails;
    redactFinancialIdentifiers = redactFinancialIdentifiers || policy.redactFinancialIdentifiers;
  }

  const authorization: PrivacyAuthorization = {
    allowed: true,
    ownerId,
    purpose: purpose as PrivacyPurpose,
    policyVersion,
    sources: uniqueSources,
    eventIds,
    redaction: { redactEmails, redactFinancialIdentifiers },
    recheck: async () => {
      const refreshed = await evaluateModelDispatch(db, input);
      return refreshed.allowed && refreshed.policyVersion === policyVersion;
    },
  };
  return authorization;
}

async function evaluateModelDispatch(db: Queryable, input: ModelDispatchInput): Promise<PrivacyDecision> {
  // authorizeModelDispatch attaches a recheck closure; calling it directly here
  // would recurse. Re-use the same internal builder with a no-op recheck.
  const decision = await authorizeModelDispatch(db, input);
  if (decision.allowed) return { ...decision, recheck: async () => false };
  return decision;
}

/**
 * Post-wait / pre-publish half of the gate. Callers must use this after a
 * semaphore or queue wait and again before persisting synthesized output.
 */
export async function stillAuthorized(
  authorization: PrivacyAuthorization | null | undefined,
  input?: ModelDispatchInput & { db?: Queryable },
): Promise<boolean> {
  if (!authorization?.allowed) return false;
  if (input?.db) {
    const refreshed = await authorizeModelDispatch(input.db, {
      ownerId: authorization.ownerId,
      purpose: authorization.purpose,
      sources: authorization.sources,
      eventIds: authorization.eventIds,
      evidence: input.evidence,
    });
    return refreshed.allowed && refreshed.policyVersion === authorization.policyVersion;
  }
  try {
    return await authorization.recheck();
  } catch {
    return false;
  }
}

/** Sources whose owner policy denies external model/embedding egress. */
export async function listDeniedEgressSources(db: Queryable, ownerId: string): Promise<string[]> {
  const result = await db.query<{ source: string }>(`
    select distinct lower(source) as source
    from source_processing_policies
    where (owner_id = $1 or (owner_id is null and client_scope = $1))
      and (enabled = false or send_to_llm = false)
  `, [ownerId]);
  return result.rows.map((row) => row.source);
}

export function logPrivacyDenial(reason: PrivacyDenialReason, meta?: { purpose?: string | null; sourceCount?: number }) {  // Metadata only: never log owner ids, query text, prompts, evidence or
  // provider response bodies.
  console.warn("[privacy] dispatch_denied", {
    reason,
    purpose: meta?.purpose ?? null,
    sourceCount: meta?.sourceCount ?? 0,
  });
}

export async function upsertSourceProcessingPolicy(
  db: Queryable,
  input: { clientId?: string | null; ownerId?: string | null; source: string } & Partial<SourceProcessingPolicy>,
) {
  const policy = { ...DEFAULT_SOURCE_POLICY, ...input };
  const ownerId = input.ownerId?.trim() || null;
  const previous = await db.query<{ version: number }>(`
    select coalesce(policy_version, 0)::int as version
    from source_processing_policies
    where (($2::text is not null and owner_id = $2) or ($2::text is null and owner_id is null and client_scope = $1))
      and lower(source) = lower($3::text)
    order by updated_at desc limit 1
  `, [clientScope(input.clientId), ownerId, input.source]);
  const result = await db.query(`
    insert into source_processing_policies (
      id, client_scope, source, enabled, send_to_llm, redact_emails,
      redact_financial_identifiers, retention_days, owner_id
    ) values ($1::text,$2::text,$3::text,$4,$5,$6,$7,$8,$9::text)
    on conflict (client_scope, source) do update set
      enabled = excluded.enabled, send_to_llm = excluded.send_to_llm,
      redact_emails = excluded.redact_emails,
      redact_financial_identifiers = excluded.redact_financial_identifiers,
      retention_days = excluded.retention_days,
      owner_id = coalesce(excluded.owner_id, source_processing_policies.owner_id),
      updated_at = now()
    returning id, client_scope as "clientScope", source, enabled,
      send_to_llm as "sendToLlm", redact_emails as "redactEmails",
      redact_financial_identifiers as "redactFinancialIdentifiers",
      retention_days as "retentionDays", owner_id as "ownerId",
      coalesce(policy_version, 0)::int as "policyVersion", updated_at as "updatedAt"
  `, [
    `policy_${randomUUID()}`, clientScope(input.clientId), input.source,
    policy.enabled, policy.sendToLlm, policy.redactEmails,
    policy.redactFinancialIdentifiers, policy.retentionDays, ownerId,
  ]);
  const row = result.rows[0] as { policyVersion?: number; source?: string } | undefined;
  const previousVersion = previous.rows[0]?.version ?? 0;
  if (row && (row.policyVersion ?? 0) !== previousVersion) {
    await invalidateDerivedWorkForPolicyChange(db, {
      ownerId: ownerId ?? clientScope(input.clientId),
      source: input.source,
      previousVersion,
      nextVersion: row.policyVersion ?? previousVersion + 1,
    });
  }
  return row;
}

/**
 * A policy change invalidates derived work for that owner/source. Embeddings
 * are staged with the new policy version and marked stale; caches drop their
 * in-process generation. Data is never destroyed here.
 */
export async function invalidateDerivedWorkForPolicyChange(
  db: Queryable,
  input: { ownerId: string; source?: string | null; previousVersion: number; nextVersion: number },
) {
  const source = input.source?.trim() || null;
  // Source-attributed embeddings are matched directly. Derived insight/digest
  // embeddings have no persisted source lineage, so they are matched through
  // their joinable run id. Both paths are marked policy-stale; the vector
  // retrieval branch also re-checks the linked run, so either signal alone is
  // enough to keep a stale excerpt out of retrieval.
  await db.query(`
    update knowledge_embeddings stored
    set policy_version = $3::bigint,
      metadata = stored.metadata || jsonb_build_object('policyStale', true, 'policyVersion', $3::bigint)
    where (
        ((stored.owner_id = $1 or (stored.owner_id is null and stored.client_id = $1))
          and ($2::text is null or stored.metadata->>'source' = $2))
        or (
          stored.object_type = 'insight'
          and exists (
            select 1 from insight_runs run
            where run.id = stored.object_id and run.owner_id = $1
              and (run.policy_version is null or run.policy_version < $3::bigint)
          )
        )
        or (
          stored.object_type = 'digest'
          and exists (
            select 1 from digest_runs run
            where run.id = stored.object_id and run.owner_id = $1
              and (run.policy_version is null or run.policy_version < $3::bigint)
          )
        )
      )
  `, [input.ownerId, source, input.nextVersion]);
  await db.query(`
    insert into privacy_policy_changes (id, owner_id, source, previous_version, next_version, created_at)
    values ($1::text,$2::text,$3::text,$4::bigint,$5::bigint,now())
  `, [`policy_change_${randomUUID()}`, input.ownerId, source, input.previousVersion, input.nextVersion]);
  invalidateDerivedCacheGeneration(input.ownerId);
}

const derivedCacheGenerations = new Map<string, number>();

export function derivedCacheGeneration(ownerId: string) {
  return derivedCacheGenerations.get(ownerId) ?? 0;
}

export function invalidateDerivedCacheGeneration(ownerId: string) {
  derivedCacheGenerations.set(ownerId, derivedCacheGeneration(ownerId) + 1);
}

// Provider concurrency: per-owner 1, provider-wide 4 by default. The boundary
// re-checks policy after acquiring a slot so a revocation during the wait never
// reaches the network.
let globalProviderLimit = Number(process.env.BRAINIA_PROVIDER_GLOBAL_CONCURRENCY ?? 4);
let ownerProviderLimit = Number(process.env.BRAINIA_PROVIDER_OWNER_CONCURRENCY ?? 1);
let activeGlobal = 0;
const activeOwners = new Map<string, number>();
type Waiter = { ownerId: string; resolve: (release: () => void) => void };
const providerWaiters: Waiter[] = [];

export function setProviderConcurrencyForTests(globalLimit: number, ownerLimit: number) {
  globalProviderLimit = Math.max(1, Math.trunc(globalLimit));
  ownerProviderLimit = Math.max(1, Math.trunc(ownerLimit));
}

function pumpProviderQueue() {
  while (providerWaiters.length) {
    const waiter = providerWaiters[0]!;
    if (activeGlobal >= globalProviderLimit || (activeOwners.get(waiter.ownerId) ?? 0) >= ownerProviderLimit) return;
    providerWaiters.shift();
    activeGlobal += 1;
    activeOwners.set(waiter.ownerId, (activeOwners.get(waiter.ownerId) ?? 0) + 1);
    let released = false;
    waiter.resolve(() => {
      if (released) return;
      released = true;
      activeGlobal -= 1;
      const remaining = (activeOwners.get(waiter.ownerId) ?? 1) - 1;
      if (remaining <= 0) activeOwners.delete(waiter.ownerId); else activeOwners.set(waiter.ownerId, remaining);
      pumpProviderQueue();
    });
  }
}

export function acquireProviderSlot(ownerId: string): Promise<() => void> {
  return new Promise((resolve) => {
    const waiter: Waiter = { ownerId, resolve };
    if (activeGlobal < globalProviderLimit && (activeOwners.get(ownerId) ?? 0) < ownerProviderLimit) {
      activeGlobal += 1;
      activeOwners.set(ownerId, (activeOwners.get(ownerId) ?? 0) + 1);
      resolve(() => {
        activeGlobal -= 1;
        const remaining = (activeOwners.get(ownerId) ?? 1) - 1;
        if (remaining <= 0) activeOwners.delete(ownerId); else activeOwners.set(ownerId, remaining);
        pumpProviderQueue();
      });
      return;
    }
    providerWaiters.push(waiter);
  });
}
