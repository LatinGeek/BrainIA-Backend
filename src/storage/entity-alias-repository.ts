import { randomUUID } from "node:crypto";
import { pool } from "./postgres.js";

type Queryable = Pick<typeof pool, "query">;

export type EntityAliasRecord = {
  id: string;
  entityId: string;
  alias: string;
  normalizedAlias: string;
  categoryPath: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EntityReviewQueueRecord = {
  id: string;
  entityId: string;
  eventId: string | null;
  source: string;
  originalValue: string;
  normalizedValue: string;
  status: "pending" | "resolved" | "ignored";
  suggestedAlias: string | null;
  suggestedCategoryPath: string[];
  aliasId: string | null;
  reason: string;
  resolvedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  entityValue: string | null;
  entityType: string | null;
};

function normalizeAlias(alias: string) {
  return alias.trim().toLowerCase();
}

function normalizeCategoryPath(categoryPath?: string[] | null) {
  return (categoryPath ?? [])
    .map((part) => part.trim())
    .filter(Boolean);
}

export async function listEntityAliases(db: Queryable, entityId?: string) {
  const result = await db.query<EntityAliasRecord>(
    `
      select
        id,
        entity_id as "entityId",
        alias,
        normalized_alias as "normalizedAlias",
        category_path as "categoryPath",
        notes,
        created_at as "createdAt",
        updated_at as "updatedAt"
      from entity_aliases
      where $1::text is null or entity_id = $1
      order by created_at asc
    `,
    [entityId ?? null],
  );

  return result.rows;
}

export async function findEntityAliasByNormalizedAlias(db: Queryable, normalizedAlias: string) {
  const result = await db.query<EntityAliasRecord>(
    `
      select
        id,
        entity_id as "entityId",
        alias,
        normalized_alias as "normalizedAlias",
        category_path as "categoryPath",
        notes,
        created_at as "createdAt",
        updated_at as "updatedAt"
      from entity_aliases
      where normalized_alias = $1
      limit 1
    `,
    [normalizeAlias(normalizedAlias)],
  );

  return result.rows[0] ?? null;
}

export async function createEntityAlias(
  db: Queryable,
  input: {
    entityId: string;
    alias: string;
    categoryPath?: string[];
    notes?: string | null;
  },
) {
  const normalizedAlias = normalizeAlias(input.alias);
  const categoryPath = normalizeCategoryPath(input.categoryPath);
  const existing = await findEntityAliasByNormalizedAlias(db, normalizedAlias);
  if (existing && existing.entityId !== input.entityId) {
    throw new Error(`Alias "${input.alias}" already belongs to another entity`);
  }

  if (existing) {
    const updated = await db.query<EntityAliasRecord>(
      `
        update entity_aliases
        set
          alias = $2,
          category_path = $3::text[],
          notes = $4,
          updated_at = now()
        where id = $1
        returning
          id,
          entity_id as "entityId",
          alias,
          normalized_alias as "normalizedAlias",
          category_path as "categoryPath",
          notes,
          created_at as "createdAt",
          updated_at as "updatedAt"
      `,
      [existing.id, input.alias.trim(), categoryPath, input.notes ?? null],
    );

    return updated.rows[0] ?? existing;
  }

  const result = await db.query<EntityAliasRecord>(
    `
      insert into entity_aliases (
        id,
        entity_id,
        alias,
        normalized_alias,
        category_path,
        notes
      ) values (
        $1, $2, $3, $4, $5::text[], $6
      )
      returning
        id,
        entity_id as "entityId",
        alias,
        normalized_alias as "normalizedAlias",
        category_path as "categoryPath",
        notes,
        created_at as "createdAt",
        updated_at as "updatedAt"
    `,
    [randomUUID(), input.entityId, input.alias.trim(), normalizedAlias, categoryPath, input.notes ?? null],
  );

  return result.rows[0];
}

export async function listEntityReviewQueue(db: Queryable, status?: EntityReviewQueueRecord["status"]) {
  const result = await db.query<EntityReviewQueueRecord>(
    `
      select
        q.id,
        q.entity_id as "entityId",
        q.event_id as "eventId",
        q.source,
        q.original_value as "originalValue",
        q.normalized_value as "normalizedValue",
        q.status,
        q.suggested_alias as "suggestedAlias",
        q.suggested_category_path as "suggestedCategoryPath",
        q.alias_id as "aliasId",
        q.reason,
        q.resolved_at as "resolvedAt",
        q.notes,
        q.created_at as "createdAt",
        q.updated_at as "updatedAt",
        e.value as "entityValue",
        e.type as "entityType"
      from entity_review_queue q
      join entities e on e.id = q.entity_id
      where $1::text is null or q.status = $1
      order by q.created_at desc
    `,
    [status ?? null],
  );

  return result.rows;
}

export async function enqueueEntityReview(
  db: Queryable,
  input: {
    entityId: string;
    eventId?: string | null;
    source: string;
    originalValue: string;
    suggestedAlias?: string | null;
    suggestedCategoryPath?: string[];
    reason?: string;
  },
) {
  const normalizedValue = normalizeAlias(input.originalValue);
  if (!normalizedValue) {
    return null;
  }

  const existingAlias = await findEntityAliasByNormalizedAlias(db, normalizedValue);
  if (existingAlias) {
    return null;
  }

  const existingPending = await db.query<{ id: string; status: string }>(
    `
      select id, status
      from entity_review_queue
      where entity_id = $1
      limit 1
    `,
    [input.entityId],
  );

  const current = existingPending.rows[0];
  if (current?.status === "resolved" || current?.status === "ignored") {
    return null;
  }

  const result = await db.query<EntityReviewQueueRecord>(
    `
      insert into entity_review_queue (
        id,
        entity_id,
        event_id,
        source,
        original_value,
        normalized_value,
        status,
        suggested_alias,
        suggested_category_path,
        reason
      ) values (
        $1, $2, $3, $4, $5, $6, 'pending', $7, $8::text[], $9
      )
      on conflict (entity_id)
      do update set
        event_id = excluded.event_id,
        source = excluded.source,
        original_value = excluded.original_value,
        normalized_value = excluded.normalized_value,
        suggested_alias = excluded.suggested_alias,
        suggested_category_path = excluded.suggested_category_path,
        reason = excluded.reason,
        updated_at = now()
      where entity_review_queue.status = 'pending'
      returning
        id,
        entity_id as "entityId",
        event_id as "eventId",
        source,
        original_value as "originalValue",
        normalized_value as "normalizedValue",
        status,
        suggested_alias as "suggestedAlias",
        suggested_category_path as "suggestedCategoryPath",
        alias_id as "aliasId",
        reason,
        resolved_at as "resolvedAt",
        notes,
        created_at as "createdAt",
        updated_at as "updatedAt",
        null::text as "entityValue",
        null::text as "entityType"
    `,
    [
      randomUUID(),
      input.entityId,
      input.eventId ?? null,
      input.source,
      input.originalValue.trim(),
      normalizedValue,
      input.suggestedAlias ?? null,
      normalizeCategoryPath(input.suggestedCategoryPath),
      input.reason ?? "merchant_candidate",
    ],
  );

  return result.rows[0] ?? null;
}

export async function resolveEntityReview(
  db: Queryable,
  reviewId: string,
  input: {
    alias: string;
    categoryPath?: string[];
    notes?: string | null;
    reason?: string | null;
  },
) {
  const queue = await db.query<{
    id: string;
    entityId: string;
    status: string;
  }>(
    `
      select
        id,
        entity_id as "entityId",
        status
      from entity_review_queue
      where id = $1
      limit 1
    `,
    [reviewId],
  );

  const review = queue.rows[0];
  if (!review) {
    return null;
  }

  if (review.status !== "pending") {
    const existingAlias = await findEntityAliasByNormalizedAlias(db, input.alias);
    return {
      reviewId,
      entityId: review.entityId,
      alias: existingAlias,
      status: review.status as EntityReviewQueueRecord["status"],
      alreadyResolved: true,
    };
  }

  const createdAlias = await createEntityAlias(db, {
    entityId: review.entityId,
    alias: input.alias,
    categoryPath: input.categoryPath,
    notes: input.notes ?? null,
  });

  const resolved = await db.query<EntityReviewQueueRecord>(
    `
      update entity_review_queue
      set
        status = 'resolved',
        alias_id = $2,
        suggested_alias = coalesce($3, suggested_alias),
        suggested_category_path = coalesce($4::text[], suggested_category_path),
        notes = coalesce($5, notes),
        resolved_at = now(),
        updated_at = now()
      where id = $1
      returning
        id,
        entity_id as "entityId",
        event_id as "eventId",
        source,
        original_value as "originalValue",
        normalized_value as "normalizedValue",
        status,
        suggested_alias as "suggestedAlias",
        suggested_category_path as "suggestedCategoryPath",
        alias_id as "aliasId",
        reason,
        resolved_at as "resolvedAt",
        notes,
        created_at as "createdAt",
        updated_at as "updatedAt",
        null::text as "entityValue",
        null::text as "entityType"
    `,
    [reviewId, createdAlias.id, input.alias.trim(), normalizeCategoryPath(input.categoryPath), input.notes ?? null],
  );

  return {
    review: resolved.rows[0] ?? null,
    alias: createdAlias,
    alreadyResolved: false,
  };
}

export async function ignoreEntityReview(db: Queryable, reviewId: string, notes?: string | null) {
  const result = await db.query<EntityReviewQueueRecord>(
    `
      update entity_review_queue
      set
        status = 'ignored',
        notes = coalesce($2, notes),
        resolved_at = now(),
        updated_at = now()
      where id = $1
      returning
        id,
        entity_id as "entityId",
        event_id as "eventId",
        source,
        original_value as "originalValue",
        normalized_value as "normalizedValue",
        status,
        suggested_alias as "suggestedAlias",
        suggested_category_path as "suggestedCategoryPath",
        alias_id as "aliasId",
        reason,
        resolved_at as "resolvedAt",
        notes,
        created_at as "createdAt",
        updated_at as "updatedAt",
        null::text as "entityValue",
        null::text as "entityType"
    `,
    [reviewId, notes ?? null],
  );

  return result.rows[0] ?? null;
}
