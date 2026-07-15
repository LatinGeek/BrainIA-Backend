create table if not exists financial_accounts (
  id text primary key,
  name text not null,
  type text not null default 'bank',
  mask text,
  external_ref text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table financial_transactions
  add column if not exists category text,
  add column if not exists account_id text references financial_accounts (id) on delete set null;

create index if not exists financial_transactions_category_idx on financial_transactions (category);
create index if not exists financial_transactions_account_id_idx on financial_transactions (account_id);
