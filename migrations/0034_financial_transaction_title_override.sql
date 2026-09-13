alter table financial_transactions
  add column if not exists title_override text;
