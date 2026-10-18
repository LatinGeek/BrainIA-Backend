-- B08 r2: lock down the service-internal lease and replay ledgers.
--
-- Both tables are written and read only by the background worker through the
-- table-owner/admin connection. No request path or owner-scoped transaction
-- reads them, so they intentionally have no owner column and no owner policy.
-- RLS default-deny applies to every non-owner role; the worker's table-owner
-- session keeps access. brainia_runtime is deliberately not granted: the
-- runtime role must not read or write job scheduling internals.
--
-- The explicit revoke is required because Supabase-style deployments may grant
-- default privileges on new public tables to `anon` and `authenticated`, and
-- RLS being enabled is only a second layer, not a substitute for the revoke.

alter table background_job_leases enable row level security;
alter table background_job_replays enable row level security;

revoke all on table background_job_leases from public;
revoke all on table background_job_replays from public;

do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on table background_job_leases from %I', role_name);
      execute format('revoke all on table background_job_replays from %I', role_name);
    end if;
  end loop;
end $$;
