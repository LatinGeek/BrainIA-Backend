-- Planned income and expenses live outside the posted ledger. This keeps
-- account balances and reporting based exclusively on executed movements.
create table if not exists pending_financial_transactions (
  id text primary key,
  title text not null,
  kind text not null check (kind in ('expense', 'income')),
  amount numeric(18,2) not null check (amount > 0),
  currency text not null check (upper(currency) in ('UYU', 'USD')),
  category text,
  account_id text references financial_accounts (id) on delete set null,
  estimated_execution_date date not null,
  status text not null default 'pending' check (status in ('pending', 'executed', 'cancelled')),
  executed_at timestamptz,
  cancelled_at timestamptz,
  executed_transaction_id text references financial_transactions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'pending' and executed_at is null and cancelled_at is null and executed_transaction_id is null)
    or (status = 'executed' and executed_at is not null and cancelled_at is null and executed_transaction_id is not null)
    or (status = 'cancelled' and executed_at is null and cancelled_at is not null and executed_transaction_id is null)
  )
);

create index if not exists pending_financial_transactions_active_due_idx
  on pending_financial_transactions (estimated_execution_date asc, created_at desc)
  where status = 'pending';
