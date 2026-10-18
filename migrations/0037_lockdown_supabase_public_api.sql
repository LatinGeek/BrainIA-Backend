-- BrainIA is accessed only through the Vercel backend's private Postgres
-- connection. Prevent Supabase's public Data API roles from reading or
-- modifying the knowledge and financial records directly.
do $$
declare
  table_name text;
begin
  for table_name in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename <> 'schema_migrations'
  loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end;
$$;

alter table public.schema_migrations enable row level security;

-- Resolve the Supabase advisor warning while retaining the function's
-- intended access to BrainIA's private tables.
alter function public.next_sequence_value(text) set search_path = public, pg_temp;
