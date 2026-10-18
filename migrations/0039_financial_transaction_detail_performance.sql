-- Keep detail and Money-list evidence lookups fast as capture history grows.
create index if not exists financial_transactions_anchor_event_id_idx
  on financial_transactions (anchor_event_id)
  where anchor_event_id is not null;

create index if not exists financial_transaction_events_transaction_created_idx
  on financial_transaction_events (transaction_id, created_at asc);
