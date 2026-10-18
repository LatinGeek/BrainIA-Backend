-- B06: owner scope for saved insight and digest runs. These tables are written
-- by cron and request handlers, so they need the same owner isolation as the
-- rest of the personal knowledge surface.

alter table insight_runs add column if not exists owner_id text;
alter table digest_runs add column if not exists owner_id text;

create index if not exists insight_runs_owner_idx on insight_runs (owner_id, created_at desc);
create index if not exists digest_runs_owner_idx on digest_runs (owner_id, created_at desc);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['insight_runs', 'digest_runs'] loop
    execute format('alter table %I enable row level security', table_name);
    execute format('drop policy if exists owner_isolation on %I', table_name);
    execute format(
      'create policy owner_isolation on %I using (owner_id = public.brainia_current_owner()) with check (owner_id = public.brainia_current_owner())',
      table_name
    );
  end loop;
end $$;
