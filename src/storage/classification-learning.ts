import { pool } from "./postgres.js";

type Queryable = Pick<typeof pool, "query">;

export type ClassificationLesson = {
  source: string;
  observedValue: string;
  canonicalValue: string;
  entityType: string;
  categoryPath: string[];
  taxonomyKeys: string[];
  roles: string[];
};

// Human review is the highest-quality supervision available to the product.
// Keep it scoped to the same client and source: a bank descriptor learned from
// one connector must not silently influence another user's captures.
export async function loadClassificationLessons(
  db: Queryable,
  input: { clientId: string | null; source: string; limit?: number },
) {
  const result = await db.query<ClassificationLesson>(`
    select
      review.source,
      review.original_value as "observedValue",
      coalesce(alias.alias, review.suggested_alias, entity.value) as "canonicalValue",
      entity.type as "entityType",
      coalesce(alias.category_path, review.suggested_category_path, '{}'::text[]) as "categoryPath",
      coalesce(profile.taxonomy_keys, '{}'::text[]) as "taxonomyKeys",
      coalesce(profile.roles, '{}'::text[]) as roles
    from entity_review_queue review
    join raw_events event on event.id = review.event_id
    join entities entity on entity.id = review.entity_id
    left join entity_aliases alias on alias.id = review.alias_id
    left join entity_semantic_profiles profile on profile.entity_id = entity.id
    where review.status = 'resolved'
      and event.client_id is not distinct from $1
      and review.source = $2
    order by review.resolved_at desc nulls last, review.updated_at desc
    limit $3
  `, [input.clientId, input.source, Math.min(12, Math.max(1, input.limit ?? 6))]);
  return result.rows;
}
