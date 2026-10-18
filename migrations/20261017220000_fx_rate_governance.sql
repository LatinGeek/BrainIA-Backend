-- B10 remediation: fx_rates access lockdown and approved/immutable semantics.
-- Additive only. Existing rate rows are not rewritten or relabelled; a rate that
-- has not been explicitly approved is simply unusable for conversion.

alter table fx_rates
  add column if not exists approved boolean not null default false,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by text;

create index if not exists fx_rates_approved_pair_asof_idx
  on fx_rates (base_currency, quote_currency, as_of desc)
  where approved = true;

-- This table is private to the backend connection, like the rest of the
-- financial schema. The public Supabase roles must not read or mutate rates.
alter table fx_rates enable row level security;

do $$
begin
  revoke all on table fx_rates from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table fx_rates from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table fx_rates from authenticated';
  end if;
end $$;

create or replace function fx_rates_enforce_approval() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.approved then
      raise exception 'approved fx rate % is immutable and cannot be deleted', old.id;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.approved then
    raise exception 'approved fx rate % is immutable and cannot be modified', old.id;
  end if;

  if new.approved and new.approved_at is null then
    new.approved_at := now();
  end if;
  return new;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'fx_rates_enforce_approval'
      and tgrelid = 'fx_rates'::regclass
  ) then
    create trigger fx_rates_enforce_approval
      before insert or update or delete on fx_rates
      for each row execute function fx_rates_enforce_approval();
  end if;
end $$;
