alter table financial_transactions
  add column if not exists destination_amount numeric(18,2),
  add column if not exists destination_currency text;

update financial_transactions
set
  destination_amount = amount,
  destination_currency = currency
where kind = 'transfer'
  and destination_account_id is not null
  and (destination_amount is null or destination_currency is null);
