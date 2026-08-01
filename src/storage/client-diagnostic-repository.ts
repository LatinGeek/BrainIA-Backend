import { pool } from './postgres.js';

export type ClientDiagnosticInput = {
  id: string;
  clientId: string | null;
  platform: string;
  component: string;
  level: 'debug' | 'info' | 'warning' | 'error';
  event: string;
  message: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
};

export async function storeClientDiagnostics(items: ClientDiagnosticInput[]) {
  if (!items.length) return 0;
  await pool.query(`delete from client_diagnostic_logs where received_at < now() - interval '30 days'`);
  let accepted = 0;
  for (const item of items) {
    const result = await pool.query(
      `
        insert into client_diagnostic_logs (
          id, client_id, platform, component, level, event, message, occurred_at, metadata
        ) values ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::jsonb)
        on conflict (id) do nothing
      `,
      [item.id, item.clientId, item.platform, item.component, item.level, item.event, item.message, item.occurredAt, JSON.stringify(item.metadata)],
    );
    accepted += result.rowCount ?? 0;
  }
  return accepted;
}

export async function listClientDiagnostics(limit = 100) {
  const result = await pool.query(
    `
      select
        id,
        client_id as "clientId",
        platform,
        component,
        level,
        event,
        message,
        occurred_at as "occurredAt",
        received_at as "receivedAt",
        metadata
      from client_diagnostic_logs
      order by occurred_at desc
      limit $1
    `,
    [limit],
  );
  return result.rows;
}
