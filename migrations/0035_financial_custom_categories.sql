create table if not exists financial_custom_categories (
  id bigserial primary key,
  client_scope text not null,
  kind text not null check (kind in ('expense', 'income')),
  name text not null,
  normalized_name text not null,
  created_at timestamptz not null default now(),
  unique (client_scope, kind, normalized_name)
);

create index if not exists financial_custom_categories_scope_kind_idx
  on financial_custom_categories (client_scope, kind, created_at);
