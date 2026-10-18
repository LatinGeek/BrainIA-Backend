-- Stable semantic identities; no OIDs, owners, physical storage or row data.
-- One row per object/attribute so omissions cannot hide behind a table sentinel.
select 'relation:'||c.relname as key,
 jsonb_build_object('kind',c.relkind,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity) as definition
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p','v','m','S') and c.relname not in ('schema_migrations','schema_migration_attempts','brainia_disposable_instance')
union all
select 'column:'||c.relname||'.'||a.attname,
 jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated)
from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
where n.nspname='public' and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped and c.relname not in ('schema_migrations','schema_migration_attempts','brainia_disposable_instance')
union all
select 'constraint:'||c.relname||'.'||k.conname, to_jsonb(pg_get_constraintdef(k.oid,true))
from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname not in ('schema_migrations','schema_migration_attempts','brainia_disposable_instance')
union all
select 'index:'||c.relname, jsonb_build_object('sql',pg_get_indexdef(c.oid),'valid',i.indisvalid,'ready',i.indisready)
from pg_index i join pg_class c on c.oid=i.indexrelid join pg_class t on t.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and t.relname not in ('schema_migrations','schema_migration_attempts','brainia_disposable_instance')
union all
select 'trigger:'||c.relname||'.'||t.tgname, jsonb_build_object('sql',pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled)
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and not t.tgisinternal
union all
select 'function:'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', to_jsonb(pg_get_functiondef(p.oid))
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p') and p.proname<>'rls_auto_enable'
union all
select 'policy:'||tablename||'.'||policyname, jsonb_build_object('permissive',permissive,'roles',roles,'cmd',cmd,'qual',qual,'check',with_check)
from pg_policies where schemaname='public'
union all
select 'acl:relation:'||c.relname||':'||coalesce(r.rolname,'PUBLIC')||':'||x.privilege_type, to_jsonb(x.is_grantable)
from pg_class c join pg_namespace n on n.oid=c.relnamespace
cross join lateral aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 's'::"char" else 'r'::"char" end,c.relowner))) x
left join pg_roles r on r.oid=x.grantee
where n.nspname='public' and c.relkind in ('r','p','S','v','m') and x.grantee<>c.relowner and c.relname not in ('schema_migrations','schema_migration_attempts','brainia_disposable_instance')
union all
select 'acl:column:'||c.relname||'.'||a.attname||':'||coalesce(r.rolname,'PUBLIC')||':'||x.privilege_type, to_jsonb(x.is_grantable)
from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
cross join lateral aclexplode(a.attacl) x left join pg_roles r on r.oid=x.grantee
where n.nspname='public' and a.attnum>0 and not a.attisdropped and x.grantee<>c.relowner
and c.relname not in ('schema_migrations','schema_migration_attempts','brainia_disposable_instance')
union all
select 'acl:function:'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||coalesce(r.rolname,'PUBLIC')||':'||x.privilege_type, to_jsonb(x.is_grantable)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x left join pg_roles r on r.oid=x.grantee
where n.nspname='public' and x.grantee<>p.proowner
order by key;
