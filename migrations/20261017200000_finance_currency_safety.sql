-- B10: currency ambiguity and financial evidence safety.
-- Additive only. Existing rows keep working: new columns are nullable or carry
-- safe defaults, amount columns are not narrowed, and no rows are rewritten.
-- `UNKNOWN` remains a stored sentinel for ambiguous evidence but is never used
-- as a currency match wildcard.

alter table financial_transactions
  add column if not exists amount_role text not null default 'posted',
  add column if not exists currency_status text not null default 'explicit',
  add column if not exists currency_provenance text,
  add column if not exists raw_amount_text text,
  add column if not exists amount_confirmed boolean not null default true,
  add column if not exists native_reference text,
  add column if not exists reference_namespace text,
  add column if not exists converted_amount numeric(18,2),
  add column if not exists converted_currency text,
  add column if not exists fx_rate_id text,
  add column if not exists fx_rate numeric(24,12),
  add column if not exists review_reasons jsonb not null default '[]'::jsonb;

alter table financial_transaction_events
  add column if not exists amount_role text not null default 'posted',
  add column if not exists currency_status text not null default 'explicit',
  add column if not exists currency_provenance text,
  add column if not exists raw_amount_text text,
  add column if not exists amount_confirmed boolean not null default true,
  add column if not exists native_reference text,
  add column if not exists reference_namespace text,
  add column if not exists converted_amount numeric(18,2),
  add column if not exists converted_currency text,
  add column if not exists fx_rate_id text,
  add column if not exists fx_rate numeric(24,12),
  add column if not exists review_reasons jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'financial_transactions_currency_status_check'
      and conrelid = 'financial_transactions'::regclass
  ) then
    alter table financial_transactions
      add constraint financial_transactions_currency_status_check
      check (currency_status in ('explicit', 'account_confirmed', 'user_confirmed', 'ambiguous', 'unsupported'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'financial_transaction_events_currency_status_check'
      and conrelid = 'financial_transaction_events'::regclass
  ) then
    alter table financial_transaction_events
      add constraint financial_transaction_events_currency_status_check
      check (currency_status in ('explicit', 'account_confirmed', 'user_confirmed', 'ambiguous', 'unsupported'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'financial_transactions_amount_role_check'
      and conrelid = 'financial_transactions'::regclass
  ) then
    alter table financial_transactions
      add constraint financial_transactions_amount_role_check
      check (amount_role in ('purchase', 'posted', 'authorized', 'balance', 'available_credit',
        'tax', 'fee', 'installment', 'refund', 'transfer_debit', 'transfer_credit',
        'converted', 'destination'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'financial_transaction_events_amount_role_check'
      and conrelid = 'financial_transaction_events'::regclass
  ) then
    alter table financial_transaction_events
      add constraint financial_transaction_events_amount_role_check
      check (amount_role in ('purchase', 'posted', 'authorized', 'balance', 'available_credit',
        'tax', 'fee', 'installment', 'refund', 'transfer_debit', 'transfer_credit',
        'converted', 'destination'));
  end if;
end
$$;

-- Exactly one native reference per owner/namespace/role. Legacy ownerless rows
-- are deliberately excluded: an unknown owner cannot safely own a global
-- uniqueness claim, so those keep the per-owner advisory lock only.
create unique index if not exists financial_transactions_native_reference_uidx
  on financial_transactions (owner_id, reference_namespace, native_reference, amount_role, kind, amount, upper(currency))
  where owner_id is not null
    and native_reference is not null
    and hidden_at is null;

create index if not exists financial_transactions_currency_status_idx
  on financial_transactions (currency_status, observed_at desc);

create index if not exists financial_transaction_events_native_reference_idx
  on financial_transaction_events (reference_namespace, native_reference)
  where native_reference is not null;

-- Explicit, dated FX evidence. No conversion is ever implicit; reports may only
-- use a rate whose id is returned here.
create table if not exists fx_rates (
  id text primary key,
  base_currency text not null,
  quote_currency text not null,
  rate numeric(24,12) not null check (rate > 0),
  as_of timestamptz not null,
  provider text not null,
  recorded_at timestamptz not null default now()
);

create index if not exists fx_rates_pair_asof_idx
  on fx_rates (base_currency, quote_currency, as_of desc);
