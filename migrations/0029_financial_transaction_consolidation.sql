-- A financial projection can be intentionally hidden by the user, either because
-- it is incorrect or because its evidence was consolidated into another record.
-- Keeping the row (and its evidence links) prevents a later event reprocess from
-- recreating an intentionally dismissed duplicate.
alter table financial_transactions
  add column if not exists hidden_at timestamptz,
  add column if not exists merged_into_transaction_id text references financial_transactions (id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'financial_transactions_merge_requires_hidden'
      and conrelid = 'financial_transactions'::regclass
  ) then
    alter table financial_transactions
      add constraint financial_transactions_merge_requires_hidden
      check (merged_into_transaction_id is null or hidden_at is not null);
  end if;
end
$$;

create index if not exists financial_transactions_visible_reporting_idx
  on financial_transactions (hidden_at, excluded_from_reports, observed_at desc);

create index if not exists financial_transactions_merged_into_idx
  on financial_transactions (merged_into_transaction_id)
  where merged_into_transaction_id is not null;
