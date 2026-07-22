alter table financial_transactions
  add column if not exists destination_account_id text references financial_accounts (id) on delete set null;

create index if not exists financial_transactions_destination_account_id_idx
  on financial_transactions (destination_account_id);
