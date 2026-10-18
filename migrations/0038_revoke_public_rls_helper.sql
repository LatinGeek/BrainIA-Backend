-- The application uses a private Postgres connection through the Vercel
-- backend. The Supabase REST roles must not invoke this SECURITY DEFINER
-- helper directly.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
