create table if not exists semantic_candidates (
  id text primary key,
  client_id text,
  event_id text references raw_events (id) on delete cascade,
  subject_entity_id text references entities (id) on delete cascade,
  relation_type text not null,
  target_type text not null,
  target_value text not null,
  target_normalized_value text not null,
  confidence numeric(5,4) not null default 0,
  rationale text,
  extractor text not null default 'semantic-v1',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  resolved_target_entity_id text references entities (id) on delete set null,
  rule_id text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (event_id, subject_entity_id, relation_type, target_type, target_normalized_value)
);

create index if not exists semantic_candidates_client_status_idx
  on semantic_candidates (client_id, status, created_at desc);
create index if not exists semantic_candidates_event_idx
  on semantic_candidates (event_id);

create table if not exists semantic_rules (
  id text primary key,
  client_id text,
  source_type text not null,
  source_normalized_value text not null,
  relation_type text not null,
  target_entity_id text not null references entities (id) on delete cascade,
  created_from_candidate_id text references semantic_candidates (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, source_type, source_normalized_value, relation_type)
);

create table if not exists client_domain_preferences (
  client_id text not null,
  domain_entity_id text not null references entities (id) on delete cascade,
  hidden boolean not null default false,
  custom boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (client_id, domain_entity_id)
);
