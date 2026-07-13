alter table raw_events
  add column if not exists contract_version integer not null default 1;

alter table raw_events
  add column if not exists client_id text null;

alter table raw_events
  add column if not exists idempotency_key text null;

alter table raw_events
  add column if not exists dedupe_key text;

update raw_events
set dedupe_key = coalesce(client_id, 'anonymous')
  || ':' || source
  || ':' || contract_version::text
  || ':' || coalesce(nullif(idempotency_key, ''), nullif(external_id, ''), id);

alter table raw_events
  alter column dedupe_key set not null;

create unique index if not exists raw_events_dedupe_key_key on raw_events (dedupe_key);
create index if not exists raw_events_contract_version_idx on raw_events (contract_version);
create index if not exists raw_events_client_id_idx on raw_events (client_id);
create index if not exists raw_events_idempotency_key_idx on raw_events (idempotency_key);

alter table classified_events
  add column if not exists contract_version integer not null default 1;

alter table classified_events
  add column if not exists client_id text null;

alter table classified_events
  add column if not exists classification_version text not null default 'heuristic-v1';

create index if not exists classified_events_contract_version_idx on classified_events (contract_version);
create index if not exists classified_events_client_id_idx on classified_events (client_id);
create index if not exists classified_events_classification_version_idx on classified_events (classification_version);
