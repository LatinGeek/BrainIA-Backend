import { randomUUID } from "node:crypto";
import { pool } from "./postgres.js";
import { derivedRunReadEligibilitySql } from "./search-repository.js";

type Queryable = Pick<typeof pool, "query">;

export type DigestRunRecord = {
  id: string;
  toolName: string;
  scope: string | null;
  windowFrom: string | null;
  windowTo: string | null;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  summary: string | null;
  model: string | null;
  policyVersion?: number | null;
  /** True when an owner source policy changed after this digest was derived. */
  stale?: boolean;
  createdAt: string;
};

export type DigestRunInput = {
  toolName: string;
  scope?: string | null;
  windowFrom?: string | null;
  windowTo?: string | null;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  summary?: string | null;
  model?: string | null;
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

export async function insertDigestRun(db: Queryable, input: DigestRunInput & { ownerId?: string }) {
  const id = `digest_${randomUUID()}`;
  const policyVersion = input.policyVersion ?? await currentOwnerPolicyVersion(db, input.ownerId ?? null);
  const result = await db.query<DigestRunRecord>(
    `
      insert into digest_runs (
        id,
        tool_name,
        scope,
        window_from,
        window_to,
        request,
        response,
        summary,
        model,
        owner_id,
        policy_version
      ) values (
        $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11
      )
      returning
        id,
        tool_name as "toolName",
        scope,
        window_from as "windowFrom",
        window_to as "windowTo",
        request,
        response,
        summary,
        model,
        policy_version as "policyVersion",
        created_at as "createdAt"
    `,
    [
      id,
      input.toolName,
      input.scope ?? null,
      input.windowFrom ?? null,
      input.windowTo ?? null,
      JSON.stringify(input.request),
      JSON.stringify(input.response),
      input.summary ?? null,
      input.model ?? null,
      input.ownerId ?? null,
      policyVersion,
    ],
  );

  return result.rows[0] ?? null;
}

export async function listDigestRuns(limit: number, ownerId?: string) {
  const result = await pool.query<DigestRunRecord>(
    `
      select
        id,
        tool_name as "toolName",
        scope,
        window_from as "windowFrom",
        window_to as "windowTo",
        request,
        response,
        summary,
        model,
        policy_version as "policyVersion",
        case when digest_runs.policy_version is null then false else exists (
          select 1 from source_processing_policies policy
          where (policy.owner_id = digest_runs.owner_id
              or (policy.owner_id is null and policy.client_scope = digest_runs.owner_id))
            and coalesce(policy.policy_version, 0) > digest_runs.policy_version
        ) end as stale,
        created_at as "createdAt"
      from digest_runs
      where ($2::text is null or owner_id is not distinct from $2)
        and ${derivedRunReadEligibilitySql("digest_runs", "digest_runs")}
      order by created_at desc
      limit $1
    `,
    [limit, ownerId ?? null],
  );

  return result.rows;
}

export async function loadDigestRunById(id: string, ownerId?: string) {
  const result = await pool.query<DigestRunRecord>(
    `
      select
        id,
        tool_name as "toolName",
        scope,
        window_from as "windowFrom",
        window_to as "windowTo",
        request,
        response,
        summary,
        model,
        policy_version as "policyVersion",
        case when digest_runs.policy_version is null then false else exists (
          select 1 from source_processing_policies policy
          where (policy.owner_id = digest_runs.owner_id
              or (policy.owner_id is null and policy.client_scope = digest_runs.owner_id))
            and coalesce(policy.policy_version, 0) > digest_runs.policy_version
        ) end as stale,
        created_at as "createdAt"
      from digest_runs
      where id = $1 and ($2::text is null or owner_id is not distinct from $2)
        and ${derivedRunReadEligibilitySql("digest_runs", "digest_runs")}
      limit 1
    `,
    [id, ownerId ?? null],
  );

  return result.rows[0] ?? null;
}
