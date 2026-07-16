alter table financial_accounts
  add column if not exists currency text;

alter table financial_accounts
  add constraint financial_accounts_currency_check
  check (currency is null or currency in ('UYU', 'USD'));

create index if not exists financial_accounts_currency_idx on financial_accounts (currency);
