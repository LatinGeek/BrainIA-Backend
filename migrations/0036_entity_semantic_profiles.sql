-- User-confirmed semantic facts must be first-class knowledge. Alias paths are
-- useful evidence, but they are not an entity's durable type or relationships.
create table if not exists entity_semantic_profiles (
  entity_id text primary key references entities (id) on delete cascade,
  client_id text,
  taxonomy_keys text[] not null default '{}'::text[],
  roles text[] not null default '{}'::text[],
  notes text,
  source text not null default 'entity_review',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists entity_semantic_profiles_client_idx
  on entity_semantic_profiles (client_id, updated_at desc);
create index if not exists entity_semantic_profiles_taxonomy_idx
  on entity_semantic_profiles using gin (taxonomy_keys);
create index if not exists entity_semantic_profiles_roles_idx
  on entity_semantic_profiles using gin (roles);
