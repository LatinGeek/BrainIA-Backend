import { explainEvent, type ExplanationCorrection, type ExplanationLink } from '../domain/event-explanation.js';
import type { StoredEventRecord } from './event-repository.js';
import type { pool } from './postgres.js';

export async function loadEventExplanation(db: Pick<typeof pool, 'query'>, event: StoredEventRecord) {
  if (event.privacyStatus !== 'standard') return explainEvent(event, [], []);
  const ids = Array.isArray(event.modelMetadata?.correctionIds) ? event.modelMetadata.correctionIds.filter((id): id is string => typeof id === 'string') : [];
  const corrections = await db.query<ExplanationCorrection & { id: string }>(`
    select c.id, c.field, c.value, c.created_at as "createdAt", c.event_id as "eventId"
    from classification_corrections c join raw_events origin on origin.id = c.event_id
    where (c.event_id = $1 or c.id = any($2::text[])) and c.revoked_at is null
      and c.client_id is not distinct from $3 and origin.client_id is not distinct from $3
      and origin.privacy_status = 'standard'
    order by c.created_at desc
  `, [event.id, ids, event.clientId]);
  const links = await db.query<ExplanationLink>(`
    select distinct coalesce(canonical.id, own.id) as id, 'transaction' as kind, 'Movimiento vinculado' as label
    from financial_transaction_events link
    join financial_transactions own on own.id = link.transaction_id
    left join financial_transactions canonical on canonical.id = own.merged_into_transaction_id
    where link.raw_event_id = $1 and coalesce(canonical.hidden_at, own.hidden_at) is null
    union
    select e.id, 'entity' as kind, e.value as label from event_entities link
    join entities e on e.id = link.entity_id
    where link.event_id = $1 and e.visibility = 'visible'
  `, [event.id]);
  return explainEvent(event, corrections.rows, links.rows);
}
