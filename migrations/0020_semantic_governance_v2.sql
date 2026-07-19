alter table semantic_candidates
  add column if not exists decision_kind text not null default 'reuse',
  add column if not exists domain_value text,
  add column if not exists anchor_role text check (anchor_role in ('primary', 'secondary')),
  add column if not exists proposed_path jsonb not null default '[]'::jsonb,
  add column if not exists alternatives jsonb not null default '[]'::jsonb,
  add column if not exists associations jsonb not null default '[]'::jsonb,
  add column if not exists recurrence_count integer not null default 1,
  add column if not exists governance_version text not null default 'semantic-governance-v2',
  add column if not exists prompt_version text not null default 'semantic-governance-v2',
  add column if not exists model text;

create table if not exists semantic_event_decisions (
  event_id text primary key references raw_events (id) on delete cascade,
  client_id text,
  status text not null check (status in ('resolved', 'review', 'unclassified', 'model_unavailable')),
  primary_domain_value text,
  decision jsonb not null default '{}'::jsonb,
  governance_version text not null default 'semantic-governance-v2',
  prompt_version text not null default 'semantic-governance-v2',
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists event_semantic_anchors (
  event_id text not null references raw_events (id) on delete cascade,
  domain_entity_id text not null references entities (id) on delete cascade,
  anchor_entity_id text not null references entities (id) on delete cascade,
  role text not null check (role in ('primary', 'secondary')),
  confidence numeric(5,4) not null,
  rationale text,
  governance_version text not null default 'semantic-governance-v2',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, domain_entity_id)
);

create unique index if not exists event_semantic_anchors_one_primary_idx
  on event_semantic_anchors (event_id) where role = 'primary';
create index if not exists event_semantic_anchors_anchor_idx
  on event_semantic_anchors (anchor_entity_id);

create table if not exists semantic_observations (
  id text primary key,
  client_id text,
  event_id text not null references raw_events (id) on delete cascade,
  subject_entity_id text references entities (id) on delete cascade,
  proposed_value text not null,
  proposed_normalized_value text not null,
  parent_entity_id text not null references entities (id) on delete cascade,
  confidence numeric(5,4) not null,
  governance_version text not null default 'semantic-governance-v2',
  created_at timestamptz not null default now(),
  unique (event_id, subject_entity_id, proposed_normalized_value, parent_entity_id)
);

create index if not exists semantic_observations_recurrence_idx
  on semantic_observations (client_id, proposed_normalized_value, parent_entity_id);

create table if not exists semantic_backfill_runs (
  id text primary key,
  client_id text,
  governance_version text not null,
  dry_run boolean not null default false,
  requested integer not null default 0,
  processed integer not null default 0,
  failed integer not null default 0,
  cursor_value text,
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Existing invalid duplicates are reconciled by the v2 backfill before this
-- invariant can be made a partial unique index on relations. Runtime writes are
-- nevertheless serialized and validated by setImmediateHierarchyParent.
