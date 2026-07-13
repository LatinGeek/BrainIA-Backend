import { randomUUID } from "node:crypto";
import { pool } from "./postgres.js";

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
};

export async function insertDigestRun(db: Queryable, input: DigestRunInput) {
  const id = `digest_${randomUUID()}`;
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
        model
      ) values (
        $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9
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
    ],
  );

  return result.rows[0] ?? null;
}

export async function listDigestRuns(limit: number) {
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
        created_at as "createdAt"
      from digest_runs
      order by created_at desc
      limit $1
    `,
    [limit],
  );

  return result.rows;
}

export async function loadDigestRunById(id: string) {
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
        created_at as "createdAt"
      from digest_runs
      where id = $1
      limit 1
    `,
    [id],
  );

  return result.rows[0] ?? null;
}
