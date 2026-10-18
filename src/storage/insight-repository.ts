import { randomUUID } from "node:crypto";
import { pool } from "./postgres.js";
import { derivedRunReadEligibilitySql } from "./search-repository.js";

type Queryable = Pick<typeof pool, "query">;

export type InsightRunRecord = {
  id: string;
  toolName: string;
  query: string | null;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  summary: string | null;
  model: string | null;
  createdAt: string;
  candidateIds?: string[];
  evidence?: Array<Record<string, unknown>>;
  confidence?: number | null;
  suggestedAction?: string | null;
  deliveryStatus?: string;
  deliveredAt?: string | null;
  expiresAt?: string | null;
  feedbackStatus?: string | null;
  promptVersion?: string | null;
  policyVersion?: number | null;
  /** True when an owner source policy changed after this run was derived. */
  stale?: boolean;
};

export type InsightRunInput = {
  toolName: string;
  query?: string | null;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  summary?: string | null;
  model?: string | null;
  candidateIds?: string[];
  evidence?: Array<Record<string, unknown>>;
  confidence?: number | null;
  suggestedAction?: string | null;
  deliveryStatus?: "generated" | "pending" | "delivered" | "dismissed";
  deliveredAt?: string | null;
  expiresAt?: string | null;
  feedbackStatus?: string | null;
  promptVersion?: string | null;
  policyVersion?: number | null;
};

async function currentOwnerPolicyVersion(db: Queryable, ownerId: string | null) {
  if (!ownerId) return null;
  const result = await db.query<{ version: number }>(`
    select coalesce(max(policy_version), 0)::int as version
    from source_processing_policies
    where owner_id = $1 or (owner_id is null and client_scope = $1)
  `, [ownerId]);
  return result.rows[0]?.version ?? 0;
}

export async function insertInsightRun(db: Queryable, input: InsightRunInput & { ownerId?: string }) {
  const id = `insight_${randomUUID()}`;
  const policyVersion = input.policyVersion ?? await currentOwnerPolicyVersion(db, input.ownerId ?? null);
  const result = await db.query<InsightRunRecord>(
    `
      insert into insight_runs (
        id,
        tool_name,
        query,
        request,
        response,
        summary,
        model,
        candidate_ids,
        evidence,
        confidence,
        suggested_action,
        delivery_status,
        delivered_at,
        expires_at,
        feedback_status,
        prompt_version,
        owner_id,
        policy_version
      ) values (
        $1, $2, $3, $4::jsonb, $5::jsonb, $6, $7,
        $8::text[], $9::jsonb, $10, $11, $12, $13, $14, $15, $16, $17, $18
      )
      returning
        id,
        tool_name as "toolName",
        query,
        request,
        response,
        summary,
        model,
        candidate_ids as "candidateIds",
        evidence,
        confidence::float8 as confidence,
        suggested_action as "suggestedAction",
        delivery_status as "deliveryStatus",
        delivered_at as "deliveredAt",
        expires_at as "expiresAt",
        feedback_status as "feedbackStatus",
        prompt_version as "promptVersion",
        policy_version as "policyVersion",
        created_at as "createdAt"
    `,
    [
      id,
      input.toolName,
      input.query ?? null,
      JSON.stringify(input.request),
      JSON.stringify(input.response),
      input.summary ?? null,
      input.model ?? null,
      input.candidateIds ?? [],
      JSON.stringify(input.evidence ?? []),
      input.confidence ?? null,
      input.suggestedAction ?? null,
      input.deliveryStatus ?? "generated",
      input.deliveredAt ?? null,
      input.expiresAt ?? null,
      input.feedbackStatus ?? null,
      input.promptVersion ?? null,
      input.ownerId ?? null,
      policyVersion,
    ],
  );

  return result.rows[0] ?? null;
}

export async function listInsightRuns(limit: number, ownerId?: string, db: Queryable = pool) {
  const result = await db.query<InsightRunRecord>(
    `
      select
        id,
        tool_name as "toolName",
        query,
        request,
        response,
        summary,
        model,
        candidate_ids as "candidateIds",
        evidence,
        confidence::float8 as confidence,
        suggested_action as "suggestedAction",
        delivery_status as "deliveryStatus",
        delivered_at as "deliveredAt",
        expires_at as "expiresAt",
        feedback_status as "feedbackStatus",
        prompt_version as "promptVersion",
        policy_version as "policyVersion",
        case when insight_runs.policy_version is null then false else exists (
          select 1 from source_processing_policies policy
          where (policy.owner_id = insight_runs.owner_id
              or (policy.owner_id is null and policy.client_scope = insight_runs.owner_id))
            and coalesce(policy.policy_version, 0) > insight_runs.policy_version
        ) end as stale,
        created_at as "createdAt"
      from insight_runs
      where ($2::text is null or owner_id is not distinct from $2)
        and ${derivedRunReadEligibilitySql("insight_runs", "insight_runs")}
      order by created_at desc
      limit $1
    `,
    [limit, ownerId ?? null],
  );

  return result.rows;
}

export async function loadInsightRunById(id: string, ownerId?: string, db: Queryable = pool) {
  const result = await db.query<InsightRunRecord>(
    `
      select
        id,
        tool_name as "toolName",
        query,
        request,
        response,
        summary,
        model,
        candidate_ids as "candidateIds",
        evidence,
        confidence::float8 as confidence,
        suggested_action as "suggestedAction",
        delivery_status as "deliveryStatus",
        delivered_at as "deliveredAt",
        expires_at as "expiresAt",
        feedback_status as "feedbackStatus",
        prompt_version as "promptVersion",
        policy_version as "policyVersion",
        case when insight_runs.policy_version is null then false else exists (
          select 1 from source_processing_policies policy
          where (policy.owner_id = insight_runs.owner_id
              or (policy.owner_id is null and policy.client_scope = insight_runs.owner_id))
            and coalesce(policy.policy_version, 0) > insight_runs.policy_version
        ) end as stale,
        created_at as "createdAt"
      from insight_runs
      where id = $1 and ($2::text is null or owner_id is not distinct from $2)
        and ${derivedRunReadEligibilitySql("insight_runs", "insight_runs")}
      limit 1
    `,
    [id, ownerId ?? null],
  );

  return result.rows[0] ?? null;
}
