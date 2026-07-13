import { randomUUID } from "node:crypto";
import { pool } from "./postgres.js";

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
};

export type InsightRunInput = {
  toolName: string;
  query?: string | null;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  summary?: string | null;
  model?: string | null;
};

export async function insertInsightRun(db: Queryable, input: InsightRunInput) {
  const id = `insight_${randomUUID()}`;
  const result = await db.query<InsightRunRecord>(
    `
      insert into insight_runs (
        id,
        tool_name,
        query,
        request,
        response,
        summary,
        model
      ) values (
        $1, $2, $3, $4::jsonb, $5::jsonb, $6, $7
      )
      returning
        id,
        tool_name as "toolName",
        query,
        request,
        response,
        summary,
        model,
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
    ],
  );

  return result.rows[0] ?? null;
}

export async function listInsightRuns(limit: number) {
  const result = await pool.query<InsightRunRecord>(
    `
      select
        id,
        tool_name as "toolName",
        query,
        request,
        response,
        summary,
        model,
        created_at as "createdAt"
      from insight_runs
      order by created_at desc
      limit $1
    `,
    [limit],
  );

  return result.rows;
}

export async function loadInsightRunById(id: string) {
  const result = await pool.query<InsightRunRecord>(
    `
      select
        id,
        tool_name as "toolName",
        query,
        request,
        response,
        summary,
        model,
        created_at as "createdAt"
      from insight_runs
      where id = $1
      limit 1
    `,
    [id],
  );

  return result.rows[0] ?? null;
}
