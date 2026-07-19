alter table semantic_candidates
  add column if not exists parent_target_value text,
  add column if not exists parent_target_normalized_value text;
