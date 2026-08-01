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
  candidateIds?: string[];
  evidence?: Array<Record<string, unknown>>;
  confidence?: number | null;
  suggestedAction?: string | null;
  deliveryStatus?: string;
  deliveredAt?: string | null;
  expiresAt?: string | null;
  feedbackStatus?: string | null;
  promptVersion?: string | null;
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
        model,
        candidate_ids,
        evidence,
        confidence,
        suggested_action,
        delivery_status,
        delivered_at,
        expires_at,
        feedback_status,
        prompt_version
      ) values (
        $1, $2, $3, $4::jsonb, $5::jsonb, $6, $7,
        $8::text[], $9::jsonb, $10, $11, $12, $13, $14, $15, $16
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
        candidate_ids as "candidateIds",
        evidence,
        confidence::float8 as confidence,
        suggested_action as "suggestedAction",
        delivery_status as "deliveryStatus",
        delivered_at as "deliveredAt",
        expires_at as "expiresAt",
        feedback_status as "feedbackStatus",
        prompt_version as "promptVersion",
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
        candidate_ids as "candidateIds",
        evidence,
        confidence::float8 as confidence,
        suggested_action as "suggestedAction",
        delivery_status as "deliveryStatus",
        delivered_at as "deliveredAt",
        expires_at as "expiresAt",
        feedback_status as "feedbackStatus",
        prompt_version as "promptVersion",
        created_at as "createdAt"
      from insight_runs
      where id = $1
      limit 1
    `,
    [id],
  );

  return result.rows[0] ?? null;
}
