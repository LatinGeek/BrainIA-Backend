-- The teach endpoint persists these three explicit user decisions alongside
-- the inferred kind. The original intelligence migration predated them.
alter table classification_corrections
  drop constraint if exists classification_corrections_field_check;

alter table classification_corrections
  add constraint classification_corrections_field_check
  check(field in (
    'inferredKind', 'merchant', 'category', 'entity',
    'financialCategory', 'eventCategory', 'humanExplanation'
  ));
