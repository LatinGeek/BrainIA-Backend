create table if not exists financial_transactions (
  id text primary key,
  kind text not null,
  amount numeric(18,2) not null,
  currency text not null default 'UNKNOWN',
  merchant_label text not null,
  normalized_merchant text not null,
  merchant_entity_id text references entities (id) on delete set null,
  observed_at timestamptz not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  evidence_count integer not null default 0,
  match_score numeric(5,4) not null default 0,
  match_strategy text not null default 'heuristic',
  primary_source text not null,
  anchor_event_id text references raw_events (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists financial_transactions_kind_amount_currency_idx
  on financial_transactions (kind, amount, currency, observed_at desc);

create index if not exists financial_transactions_normalized_merchant_idx
  on financial_transactions (normalized_merchant);

create index if not exists financial_transactions_merchant_entity_id_idx
  on financial_transactions (merchant_entity_id);

create index if not exists financial_transactions_observed_at_idx
  on financial_transactions (observed_at desc);

create table if not exists financial_transaction_events (
  id text primary key,
  transaction_id text not null references financial_transactions (id) on delete cascade,
  raw_event_id text not null references raw_events (id) on delete cascade,
  source text not null,
  kind text not null,
  amount numeric(18,2) not null,
  currency text not null default 'UNKNOWN',
  merchant_label text not null,
  normalized_merchant text not null,
  observed_at timestamptz not null,
  match_score numeric(5,4) not null default 0,
  match_reason text not null,
  created_at timestamptz not null default now(),
  unique (raw_event_id)
);

create index if not exists financial_transaction_events_transaction_id_idx
  on financial_transaction_events (transaction_id);

create index if not exists financial_transaction_events_raw_event_id_idx
  on financial_transaction_events (raw_event_id);

create index if not exists financial_transaction_events_observed_at_idx
  on financial_transaction_events (observed_at desc);
