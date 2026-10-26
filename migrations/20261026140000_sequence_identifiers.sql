-- Replace the row-locked counter table with native sequences. Concurrent
-- graph materialization previously serialized on `entity_sequences`; a
-- sequence allocation does not hold a row lock and preserves the existing
-- `entity_<n>` / `relation_<n>` identifier format.
create sequence if not exists entity_id_seq;
create sequence if not exists relation_id_seq;

select setval(
  'entity_id_seq',
  greatest(
    coalesce((select value from entity_sequences where name = 'entity'), 0),
    coalesce((select max(substring(id from 8)::bigint) from entities where id ~ '^entity_[0-9]+$'), 0)
  ) + 1,
  false
);
select setval(
  'relation_id_seq',
  greatest(
    coalesce((select value from entity_sequences where name = 'relation'), 0),
    coalesce((select max(substring(id from 10)::bigint) from relations where id ~ '^relation_[0-9]+$'), 0)
  ) + 1,
  false
);

create or replace function next_sequence_value(sequence_name text)
returns text
language plpgsql
as $$
begin
  if sequence_name = 'entity' then
    return 'entity_' || nextval('entity_id_seq')::text;
  end if;
  if sequence_name = 'relation' then
    return 'relation_' || nextval('relation_id_seq')::text;
  end if;
  raise exception 'unknown sequence %', sequence_name;
end;
$$;
