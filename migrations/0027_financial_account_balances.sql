alter table financial_transactions
  add column if not exists excluded_from_reports boolean not null default false,
  add column if not exists adjustment_target_balance numeric(18,2);

create index if not exists financial_transactions_reporting_idx
  on financial_transactions (excluded_from_reports, observed_at desc);

