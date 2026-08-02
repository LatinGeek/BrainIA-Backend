-- Stable multi-level taxonomy metadata and queryable event categorization.

alter table entities
  add column if not exists taxonomy_key text generated always as (metadata ->> 'taxonomyKey') stored,
  add column if not exists taxonomy_version text generated always as (metadata ->> 'taxonomyVersion') stored;

create unique index if not exists entities_taxonomy_key_unique_idx
  on entities (taxonomy_key)
  where taxonomy_key is not null;

create index if not exists entities_taxonomy_version_idx
  on entities (taxonomy_version, taxonomy_key)
  where taxonomy_key is not null;

alter table semantic_event_decisions
  add column if not exists taxonomy_version text,
  add column if not exists primary_category_key text,
  add column if not exists secondary_category_keys text[] not null default '{}',
  add column if not exists facets jsonb not null default '[]'::jsonb;

create index if not exists semantic_event_decisions_primary_category_idx
  on semantic_event_decisions (primary_category_key, updated_at desc)
  where primary_category_key is not null;

create index if not exists semantic_event_decisions_facets_gin_idx
  on semantic_event_decisions using gin (facets);
