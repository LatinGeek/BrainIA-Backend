import { pool } from "./postgres.js";
import type { EntityDraft } from "../domain/entities.js";

type StoredEntity = {
  id: string;
  type: string;
  value: string;
  normalizedValue: string;
};

export async function upsertEntity(draft: EntityDraft): Promise<StoredEntity> {
  const result = await pool.query<StoredEntity>(
    `
      insert into entities (
        id,
        type,
        value,
        normalized_value,
        metadata
      ) values (
        next_sequence_value('entity'),
        $1,
        $2,
        $3,
        $4::jsonb
      )
      on conflict (type, normalized_value)
      do update set
        value = excluded.value,
        metadata = entities.metadata || excluded.metadata
      returning
        id,
        type,
        value,
        normalized_value as "normalizedValue"
    `,
    [draft.type, draft.value, draft.normalizedValue, JSON.stringify(draft.metadata ?? {})],
  );

  return result.rows[0];
}

export async function listEntities() {
  const result = await pool.query(`
    select
      id,
      type,
      value,
      normalized_value as "normalizedValue",
      metadata,
      created_at as "createdAt"
    from entities
    order by created_at asc
  `);

  return result.rows;
}
