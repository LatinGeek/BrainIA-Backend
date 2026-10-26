-- Non-unique indexes deliberately preserve legacy duplicate identities. Such
-- ambiguous identities fail closed (409) until explicitly reconciled.
create index if not exists raw_events_source_external_identity_idx
  on raw_events (source, external_id, client_id) where external_id is not null;
create index if not exists raw_events_source_retry_identity_idx
  on raw_events (source, idempotency_key, client_id) where idempotency_key is not null;
