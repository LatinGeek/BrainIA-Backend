alter table entities
  add column if not exists description text not null default '',
  add column if not exists identity_source text not null default 'legacy';

create index if not exists entities_graph_identity_idx
  on entities (identity_source, type)
  where length(btrim(description)) > 0;

