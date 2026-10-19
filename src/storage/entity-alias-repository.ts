import { randomUUID } from "node:crypto";
import { pool } from "./postgres.js";
import { mergeEntities, resolveCanonicalEntityId, upsertEntity } from "./entity-repository.js";
import { semanticMergeSkipReason } from "./semantic-repository.js";

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
  financialKind: "expense" | "income" | "transfer" | null;
};

function normalizeAlias(alias: string) {
  return alias.trim().toLowerCase();
}

function normalizeCategoryPath(categoryPath?: string[] | null) {
  return (categoryPath ?? [])
    .map((part) => part.trim())
    .filter(Boolean);
}

const LEGAL_NAME_SUFFIXES = new Set([
  "srl",
  "sa",
  "sas",
  "spa",
  "llc",
  "inc",
  "ltd",
  "corp",
  "co",
  "company",
  "gmbh",
  "plc",
  "bv",
  "ag",
  "pty",
  "sl",
]);

export function shouldQueueMerchantReview(originalValue: string) {
  const value = originalValue.trim();
  const normalized = normalizeAlias(value);

  if (!normalized) {
    return false;
  }

  if (normalized.includes("@")) {
    return false;
  }

  if (/[/*|:#\\]/.test(value)) {
    return true;
  }

  const words = value.split(/\s+/).filter(Boolean);
  if (words.length >= 3) {
    return true;
  }

  const letters = value.replace(/[^\p{L}]/gu, "");
  if (letters.length >= 5 && letters === letters.toLocaleUpperCase() && letters !== letters.toLocaleLowerCase()) {
    return true;
  }

  return words.some((word) => LEGAL_NAME_SUFFIXES.has(normalizeAlias(word)));
}

export async function listEntityAliases(db: Queryable, entityId?: string, ownerId?: string) {
  const result = await db.query<EntityAliasRecord>(
    `
      select
        alias.id,
        alias.entity_id as "entityId",
        alias.alias,
        alias.normalized_alias as "normalizedAlias",
        alias.category_path as "categoryPath",
        alias.notes,
        alias.created_at as "createdAt",
        alias.updated_at as "updatedAt"
      from entity_aliases alias
      join entities entity on entity.id = alias.entity_id
      where ($1::text is null or alias.entity_id = $1)
        and ($2::text is null or alias.owner_id = $2 or (alias.owner_id is null and entity.owner_id = $2))
      order by alias.created_at asc
    `,
    [entityId ?? null, ownerId ?? null],
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
  const canonicalEntityId = await resolveCanonicalEntityId(db, input.entityId);
  if (!canonicalEntityId) {
    throw new Error("Entity must exist before an alias can be saved");
  }
  const normalizedAlias = normalizeAlias(input.alias);
  const categoryPath = normalizeCategoryPath(input.categoryPath);
  const existing = await findEntityAliasByNormalizedAlias(db, normalizedAlias);
  const existingCanonicalEntityId = existing ? await resolveCanonicalEntityId(db, existing.entityId) : null;
  if (existing && existingCanonicalEntityId !== canonicalEntityId) {
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
    [randomUUID(), canonicalEntityId, input.alias.trim(), normalizedAlias, categoryPath, input.notes ?? null],
  );

  return result.rows[0];
}

export async function listEntityReviewQueue(db: Queryable, status?: EntityReviewQueueRecord["status"], ownerId?: string) {
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
        e.type as "entityType",
        financial.kind as "financialKind"
      from entity_review_queue q
      join entities e on e.id = q.entity_id
      left join lateral (
        select transaction.kind
        from financial_transaction_events evidence
        join financial_transactions transaction on transaction.id = evidence.transaction_id
        where evidence.raw_event_id = q.event_id and transaction.hidden_at is null
        order by transaction.observed_at desc
        limit 1
      ) financial on true
      where ($1::text is null or q.status = $1)
        and ($2::text is null or q.owner_id = $2 or (q.owner_id is null and e.owner_id = $2))
      order by q.created_at desc
    `,
    [status ?? null, ownerId ?? null],
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
  if (!shouldQueueMerchantReview(input.originalValue)) {
    return null;
  }

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
        null::text as "entityType",
        null::text as "financialKind"
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
    targetEntityId?: string | null;
  },
) {
  const queue = await db.query<{
    id: string;
    entityId: string;
    status: string;
    normalizedValue: string;
  }>(
    `
      select
        id,
        entity_id as "entityId",
        status,
        normalized_value as "normalizedValue"
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

  const existingAlias = await findEntityAliasByNormalizedAlias(db, normalizeAlias(input.alias));
  const skipMerge = async (reason: string) => {
    await db.query(`update entity_review_queue set reason = $2, updated_at = now() where id = $1`, [reviewId, reason]);
    return { reviewId, entityId: review.entityId, alias: null, status: "pending" as const, alreadyResolved: false, skipReason: reason };
  };
  // Validate every participating identity before the first merge. In particular,
  // an existing alias may collide even when the explicitly selected target fits.
  for (const targetId of [input.targetEntityId, existingAlias?.entityId]) {
    if (!targetId) continue;
    const reason = await semanticMergeSkipReason(db, review.entityId, targetId);
    if (reason) return skipMerge(reason);
  }
  let aliasEntityId = review.entityId;
  const targetSelected = Boolean(input.targetEntityId);

  if (input.targetEntityId) {
    const reviewCanonicalId = await resolveCanonicalEntityId(db, review.entityId);
    const targetCanonicalId = await resolveCanonicalEntityId(db, input.targetEntityId);

    if (!reviewCanonicalId || !targetCanonicalId) {
      throw new Error("Both the review entity and selected entity must exist before an alias can be unified");
    }

    aliasEntityId = targetCanonicalId;

    const targetEntity = await db.query<{ type: string; value: string; description: string; ownerId: string | null }>(
      `select type, value, description, owner_id as "ownerId" from entities where id = $1`,
      [targetCanonicalId],
    );
    const current = targetEntity.rows[0];
    let friendlyEntity: Awaited<ReturnType<typeof upsertEntity>> | null = null;
    if (current && normalizeAlias(current.value) !== normalizeAlias(input.alias)) {
      const existingFriendly = await db.query<{ id: string }>(`
        select id from entities where type = $1 and normalized_value = $2 limit 1
      `, [current.type, normalizeAlias(input.alias)]);
      if (existingFriendly.rows[0]) {
        const reason = await semanticMergeSkipReason(db, targetCanonicalId, existingFriendly.rows[0].id);
        if (reason) return skipMerge(reason);
      }
      friendlyEntity = await upsertEntity(db, {
        type: current.type,
        value: input.alias.trim(),
        normalizedValue: normalizeAlias(input.alias),
        description: current.description,
        identitySource: "user",
        metadata: { source: "review_friendly_name", preferred: true },
      }, { ownerId: current.ownerId });
      if (friendlyEntity.id !== targetCanonicalId) {
        const reason = await semanticMergeSkipReason(db, targetCanonicalId, friendlyEntity.id);
        if (reason) return skipMerge(reason);
      }
    }
    if (reviewCanonicalId !== targetCanonicalId) {
      await mergeEntities(db, reviewCanonicalId, targetCanonicalId, {
        reason: "review_entity_match",
        confidence: 0.96,
      });
    }
    if (friendlyEntity) {
      if (friendlyEntity.id !== targetCanonicalId) await mergeEntities(db, targetCanonicalId, friendlyEntity.id, {
        reason: "review_friendly_name",
        confidence: 1,
      });
      aliasEntityId = friendlyEntity.id;
    }
  }

  if (existingAlias && existingAlias.entityId !== aliasEntityId && targetSelected) {
    const existingCanonicalId = await resolveCanonicalEntityId(db, existingAlias.entityId);
    if (!existingCanonicalId) {
      throw new Error("The existing alias entity must exist before it can be unified");
    }

    if (existingCanonicalId !== aliasEntityId) {
      await mergeEntities(db, existingCanonicalId, aliasEntityId, {
        reason: "review_entity_match",
        confidence: 0.96,
      });
    }

    await db.query(
      `update entity_aliases set entity_id = $2, updated_at = now() where id = $1`,
      [existingAlias.id, aliasEntityId],
    );
  } else if (existingAlias && existingAlias.entityId !== aliasEntityId) {
    const reviewCanonicalId = await resolveCanonicalEntityId(db, review.entityId);
    const existingCanonicalId = await resolveCanonicalEntityId(db, existingAlias.entityId);

    if (!reviewCanonicalId || !existingCanonicalId) {
      throw new Error("Both entities must exist before an alias can be unified");
    }

    const reviewMatchesAlias = normalizeAlias(review.normalizedValue) === normalizeAlias(input.alias);
    const canonicalEntityId = reviewMatchesAlias ? reviewCanonicalId : existingCanonicalId;
    const duplicateEntityId = canonicalEntityId === reviewCanonicalId ? existingCanonicalId : reviewCanonicalId;

    if (canonicalEntityId !== duplicateEntityId) {
      await mergeEntities(db, duplicateEntityId, canonicalEntityId, {
        reason: "shared_alias",
        confidence: 0.98,
      });
    }

    await db.query(
      `update entity_aliases set entity_id = $2, updated_at = now() where id = $1`,
      [existingAlias.id, canonicalEntityId],
    );
    aliasEntityId = canonicalEntityId;
  }

  const createdAlias = await createEntityAlias(db, {
    entityId: aliasEntityId,
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
        null::text as "entityType",
        null::text as "financialKind"
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
        null::text as "entityType",
        null::text as "financialKind"
    `,
    [reviewId, notes ?? null],
  );

  return result.rows[0] ?? null;
}
