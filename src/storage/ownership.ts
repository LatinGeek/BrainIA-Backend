import { randomUUID } from "node:crypto";
import { pool } from "./postgres.js";

type Queryable = Pick<typeof pool, "query">;

// Tables that carry personal content and therefore require an owner key.
// Public taxonomy tables (ontology seeds inside `entities`) are deliberately
// not owner-scoped.
export const PERSONAL_TABLES = [
  "raw_events",
  "entities",
  "relations",
  "event_entities",
  "event_relations",
  "event_semantic_anchors",
  "entity_aliases",
  "entity_merges",
  "entity_review_queue",
  "financial_transactions",
  "financial_transaction_events",
  "financial_accounts",
  "pending_financial_transactions",
  "knowledge_facts",
  "knowledge_embeddings",
  "knowledge_feedback",
  "background_jobs",
  "classification_corrections",
  "classification_decisions",
  "classified_events",
  "client_diagnostic_logs",
  "client_domain_preferences",
  "data_deletion_audit",
  "entity_semantic_profiles",
  "insight_candidates",
  "intelligence_artifacts",
  "intelligence_feedback",
  "interaction_events",
  "model_call_audits",
  "reclassification_runs",
  "semantic_backfill_runs",
  "semantic_candidates",
  "semantic_event_decisions",
  "semantic_observations",
  "semantic_rules",
  "financial_custom_categories",
  "interaction_daily",
  "source_processing_policies",
] as const;

// Tables whose legacy owner key is `client_id` or `client_scope`.
const CLIENT_ID_TABLES = [
  "background_jobs",
  "classification_corrections",
  "classification_decisions",
  "classified_events",
  "client_diagnostic_logs",
  "data_deletion_audit",
  "insight_candidates",
  "intelligence_artifacts",
  "intelligence_feedback",
  "interaction_events",
  "model_call_audits",
  "reclassification_runs",
  "semantic_backfill_runs",
  "semantic_candidates",
  "semantic_event_decisions",
  "semantic_observations",
  "semantic_rules",
  "knowledge_embeddings",
  "knowledge_feedback",
] as const;
const CLIENT_SCOPE_TABLES = ["financial_custom_categories", "interaction_daily", "source_processing_policies"] as const;

export type OwnerTable = (typeof PERSONAL_TABLES)[number];

export type OwnerInventoryEntry = {
  table: string;
  ownerKey: "owner_id" | "client_id" | "client_scope" | null;
  personal: boolean;
  columns: string[];
};

export type BackfillOptions = {
  dryRun?: boolean;
  // Legacy client_id -> approved owner_id. When omitted, the legacy id is
  // treated as its own owner and the mapping is recorded as provisional.
  mapping?: Record<string, string>;
  approvedBy?: string;
};

export type BackfillResult = {
  dryRun: boolean;
  mappings: number;
  ownersAssigned: Record<string, number>;
  splitEntities: number;
  quarantined: number;
  publicTaxonomyCleared: number;
  unresolved: Record<string, number>;
};

export async function ownerInventory(db: Queryable): Promise<OwnerInventoryEntry[]> {
  const { rows } = await db.query<{ table_name: string; column_name: string }>(`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public' order by table_name, ordinal_position
  `);
  const byTable = new Map<string, string[]>();
  for (const row of rows) {
    const list = byTable.get(row.table_name) ?? [];
    list.push(row.column_name);
    byTable.set(row.table_name, list);
  }
  return [...byTable.entries()].map(([table, columns]) => ({
    table,
    columns,
    personal: (PERSONAL_TABLES as readonly string[]).includes(table),
    ownerKey: columns.includes("owner_id")
      ? "owner_id"
      : columns.includes("client_id")
        ? "client_id"
        : columns.includes("client_scope")
          ? "client_scope"
          : null,
  }));
}

export async function recordOwnerMapping(
  db: Queryable,
  input: { legacyClientId: string; ownerId: string; approvedBy?: string; evidence?: Record<string, unknown> },
) {
  await db.query(`
    insert into client_owner_mappings (legacy_client_id, owner_id, status, approved_by, approved_at, evidence)
    values ($1,$2,'approved',$3,now(),$4::jsonb)
    on conflict (legacy_client_id) do update set
      owner_id = excluded.owner_id,
      status = 'approved',
      approved_by = excluded.approved_by,
      approved_at = now(),
      evidence = client_owner_mappings.evidence || excluded.evidence,
      updated_at = now()
  `, [input.legacyClientId, input.ownerId, input.approvedBy ?? null, JSON.stringify(input.evidence ?? {})]);
}

export async function quarantineRow(
  db: Queryable,
  input: { table: string; rowId: string; reason: string; ownerCandidate?: string | null; evidence?: Record<string, unknown> },
) {
  await db.query(`
    insert into owner_quarantine (id, table_name, row_id, owner_candidate, reason, status, evidence)
    values ($1,$2,$3,$4,$5,'quarantined',$6::jsonb)
    on conflict (table_name, row_id) do update set
      reason = excluded.reason,
      owner_candidate = coalesce(excluded.owner_candidate, owner_quarantine.owner_candidate),
      status = case when owner_quarantine.status in ('released','remediated') then owner_quarantine.status else 'quarantined' end,
      evidence = owner_quarantine.evidence || excluded.evidence
  `, [randomUUID(), input.table, input.rowId, input.ownerCandidate ?? null, input.reason, JSON.stringify(input.evidence ?? {})]);
}

export async function releaseQuarantinedRow(db: Queryable, input: { table: string; rowId: string }) {
  const result = await db.query(`
    update owner_quarantine set status = 'released', released_at = now()
    where table_name = $1 and row_id = $2 and status = 'quarantined'
  `, [input.table, input.rowId]);
  return result.rowCount ?? 0;
}

const SCOPE_TABLES = new Set<string>(PERSONAL_TABLES);
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

// SQL predicate suitable for an ordinary repository query. The table name is
// validated against the personal-table allowlist; the id expression must be
// qualified with the outer query alias (for example `account.id`) so the
// correlation cannot silently bind to `owner_quarantine.id`.
export function ownerVisiblePredicate(table: OwnerTable, idExpression: string) {
  const parts = idExpression.split(".");
  if (!SCOPE_TABLES.has(table) || parts.length !== 2 || !parts.every((part) => IDENTIFIER.test(part))) {
    throw new Error(`ownerVisiblePredicate: unsupported table or qualified id expression: ${table}.${idExpression}`);
  }
  return `not exists (select 1 from owner_quarantine quarantine where quarantine.table_name = '${table}' and quarantine.row_id = ${idExpression}::text and quarantine.status = 'quarantined')`;
}

export async function isOwnerRowVisible(db: Queryable, input: { table: string; rowId: string }) {
  const result = await db.query<{ visible: boolean }>(
    `select public.owner_row_visible($1, $2::text) as visible`,
    [input.table, input.rowId],
  );
  return result.rows[0]?.visible ?? true;
}

async function scalar(db: Queryable, sql: string, values: unknown[] = []) {
  const result = await db.query<Record<string, unknown>>(sql, values);
  const row = result.rows[0] ?? {};
  const first = Object.values(row)[0];
  return Number(first ?? 0);
}

// Idempotent additive owner backfill. It never deletes or re-keys evidence:
// raw event ids, financial transaction ids and classification/decision ids are
// preserved. Rows whose owner cannot be resolved are quarantined, not deleted.
export async function backfillOwnership(db: Queryable, options: BackfillOptions = {}): Promise<BackfillResult> {
  const dryRun = options.dryRun === true;
  const mapping = { ...(options.mapping ?? {}) };
  const result: BackfillResult = {
    dryRun,
    mappings: 0,
    ownersAssigned: {},
    splitEntities: 0,
    quarantined: 0,
    publicTaxonomyCleared: 0,
    unresolved: {},
  };
  const run = async (sql: string, values: unknown[] = []) => {
    if (dryRun) return null;
    return db.query(sql, values);
  };

  // 1. Explicit approved mappings. Unmapped legacy ids keep their own identity;
  // the mapping row records that the default still needs owner confirmation.
  if (!dryRun) {
    const { rows } = await db.query<{ client_id: string }>(`
      select distinct client_id from raw_events where client_id is not null
      union select distinct client_id from knowledge_facts where client_id is not null
    `);
    for (const row of rows) {
      const ownerId = mapping[row.client_id] ?? row.client_id;
      await recordOwnerMapping(db, {
        legacyClientId: row.client_id,
        ownerId,
        approvedBy: options.approvedBy ?? (mapping[row.client_id] ? "explicit_mapping" : "identity_legacy_default"),
        evidence: { source: "surviving client_id", requires_owner_confirmation: !mapping[row.client_id] },
      });
      result.mappings += 1;
    }
  }

  // 2. raw_events owner from client_id via the mapping ledger.
  const rawEventsAssigned = await scalar(db, `
    with candidates as (
      select e.id, coalesce(m.owner_id, e.client_id) as owner_id
      from raw_events e left join client_owner_mappings m on m.legacy_client_id = e.client_id and m.status = 'approved'
      where e.owner_id is null and e.client_id is not null
    )
    select count(*) from candidates
  `);
  await run(`
    update raw_events e set owner_id = coalesce(m.owner_id, e.client_id)
    from client_owner_mappings m
    where e.owner_id is null and e.client_id is not null
      and m.legacy_client_id = e.client_id and m.status = 'approved'
  `);
  await run(`
    update raw_events set owner_id = client_id where owner_id is null and client_id is not null
  `);
  result.ownersAssigned.raw_events = rawEventsAssigned;

  // 2b. Every other table with a legacy client key is mapped the same way.
  for (const table of CLIENT_ID_TABLES) {
    const count = await scalar(db, `
      select count(*) from ${table} where owner_id is null and client_id is not null`);
    await run(`
      update ${table} target set owner_id = coalesce(m.owner_id, target.client_id)
      from client_owner_mappings m
      where target.owner_id is null and target.client_id is not null
        and m.legacy_client_id = target.client_id and m.status = 'approved'`);
    await run(`update ${table} set owner_id = client_id where owner_id is null and client_id is not null`);
    result.ownersAssigned[table] = count;
  }
  for (const table of CLIENT_SCOPE_TABLES) {
    const count = await scalar(db, `
      select count(*) from ${table} where owner_id is null and client_scope is not null and client_scope <> '*'`);
    await run(`
      update ${table} target set owner_id = coalesce(m.owner_id, target.client_scope)
      from client_owner_mappings m
      where target.owner_id is null and target.client_scope is not null and target.client_scope <> '*'
        and m.legacy_client_id = target.client_scope and m.status = 'approved'`);
    await run(`update ${table} set owner_id = client_scope where owner_id is null and client_scope is not null and client_scope <> '*'`);
    result.ownersAssigned[table] = count;
  }

  // 3. Event-scoped children inherit the event owner.
  for (const table of ["event_entities", "event_relations", "event_semantic_anchors"]) {
    const count = await scalar(db, `
      select count(*) from ${table} child join raw_events e on e.id = child.event_id
      where child.owner_id is null and e.owner_id is not null`);
    await run(`
      update ${table} child set owner_id = e.owner_id
      from raw_events e where child.event_id = e.id and child.owner_id is null and e.owner_id is not null`);
    result.ownersAssigned[table] = count;
  }
  const fteCount = await scalar(db, `
    select count(*) from financial_transaction_events fte join raw_events e on e.id = fte.raw_event_id
    where fte.owner_id is null and e.owner_id is not null`);
  await run(`
    update financial_transaction_events fte set owner_id = e.owner_id
    from raw_events e where fte.raw_event_id = e.id and fte.owner_id is null and e.owner_id is not null`);
  result.ownersAssigned.financial_transaction_events = fteCount;

  // 4. Knowledge facts are owner-scoped through their surviving client id.
  const factCount = await scalar(db, `
    select count(*) from knowledge_facts where owner_id is null and client_id is not null`);
  await run(`
    update knowledge_facts f set owner_id = coalesce(m.owner_id, f.client_id)
    from client_owner_mappings m
    where f.owner_id is null and f.client_id is not null and m.legacy_client_id = f.client_id and m.status = 'approved'`);
  await run(`update knowledge_facts set owner_id = client_id where owner_id is null and client_id is not null`);
  result.ownersAssigned.knowledge_facts = factCount;

  // 5. Shared personal entities are split per owner before single-owner
  // assignment. Public taxonomy is never split.
  const shared = (await db.query<{ entity_id: string }>(`
    select entity_id from event_entities
    where owner_id is not null
    group by entity_id having count(distinct owner_id) > 1
  `)).rows;
  for (const row of shared) {
    const owners = (await db.query<{ owner_id: string }>(`
      select distinct owner_id from event_entities where entity_id = $1 and owner_id is not null order by owner_id
    `, [row.entity_id])).rows.map((entry) => entry.owner_id);
    for (const ownerId of owners.slice(1)) {
      if (dryRun) {
        result.splitEntities += 1;
        continue;
      }
      const existing = (await db.query<{ new_entity_id: string }>(`
        select new_entity_id from entity_owner_splits where original_entity_id = $1 and owner_id = $2
      `, [row.entity_id, ownerId])).rows[0];
      if (existing) continue;
      const created = await db.query<{ id: string }>(`
        insert into entities (id, type, value, normalized_value, metadata, description, identity_source, visibility, owner_id)
        select $1, type, value, normalized_value || '::owner:' || md5($2::text),
          metadata || jsonb_build_object('ownerScopedOriginalNormalizedValue', normalized_value, 'ownerScoped', true),
          description, identity_source, visibility, $2
        from entities where id = $3 and type not in ('domain','concept')
        returning id
      `, [randomUUID(), ownerId, row.entity_id]);
      const newId = created.rows[0]?.id;
      if (!newId) continue;
      await db.query(`insert into entity_owner_splits (original_entity_id, owner_id, new_entity_id) values ($1,$2,$3) on conflict do nothing`, [row.entity_id, ownerId, newId]);
      await db.query(`update event_entities set entity_id = $1 where entity_id = $2 and owner_id = $3`, [newId, row.entity_id, ownerId]);
      result.splitEntities += 1;
    }
  }

  // 6. Canonical personal entities receive the single owner proven by their
  // event links. Ambiguous entities are quarantined by step 9.
  const entityCount = await scalar(db, `
    select count(*) from entities entity
    where entity.type not in ('domain','concept') and entity.owner_id is null
      and (select count(distinct ee.owner_id) from event_entities ee where ee.entity_id = entity.id and ee.owner_id is not null) = 1`);
  await run(`
    update entities entity set owner_id = (
      select min(ee.owner_id) from event_entities ee where ee.entity_id = entity.id and ee.owner_id is not null
    )
    where entity.type not in ('domain','concept') and entity.owner_id is null
      and (select count(distinct ee.owner_id) from event_entities ee where ee.entity_id = entity.id and ee.owner_id is not null) = 1
  `);
  result.ownersAssigned.entities = entityCount;

  // 7. Relations belong to one owner only when all their endpoints do; edges
  // inside the public taxonomy remain public (owner_id null).
  const relationCount = await scalar(db, `
    select count(*) from relations r
    where r.owner_id is null
      and (select count(distinct candidate.owner_id) from (
        select source.owner_id from entities source where source.id = r.source_entity_id
        union all select target.owner_id from entities target where target.id = r.target_entity_id
      ) candidate where candidate.owner_id is not null) = 1`);
  await run(`
    update relations r set owner_id = (
      select min(candidate.owner_id) from (
        select source.owner_id from entities source where source.id = r.source_entity_id
        union all select target.owner_id from entities target where target.id = r.target_entity_id
      ) candidate where candidate.owner_id is not null
    )
    where r.owner_id is null
      and (select count(distinct candidate.owner_id) from (
        select source.owner_id from entities source where source.id = r.source_entity_id
        union all select target.owner_id from entities target where target.id = r.target_entity_id
      ) candidate where candidate.owner_id is not null) = 1
  `);
  result.ownersAssigned.relations = relationCount;

  // 8. Finance owner from the evidence links. Ambiguous transactions are left
  // for quarantine rather than guessed.
  const txnCount = await scalar(db, `
    select count(*) from financial_transactions t
    where t.owner_id is null
      and (select count(distinct fte.owner_id) from financial_transaction_events fte where fte.transaction_id = t.id and fte.owner_id is not null) = 1`);
  await run(`
    update financial_transactions t set owner_id = (
      select min(fte.owner_id) from financial_transaction_events fte where fte.transaction_id = t.id and fte.owner_id is not null
    )
    where t.owner_id is null
      and (select count(distinct fte.owner_id) from financial_transaction_events fte where fte.transaction_id = t.id and fte.owner_id is not null) = 1
  `);
  result.ownersAssigned.financial_transactions = txnCount;

  // 9. Public taxonomy must not carry personal content.
  const taxonomyCount = await scalar(db, `
    select count(*) from entities where type in ('domain','concept') and owner_id is not null`);
  if (taxonomyCount > 0 && !dryRun) {
    await db.query(`
      insert into owner_quarantine (id, table_name, row_id, reason, status, evidence)
      select 'taxonomy:' || id, 'entities', id, 'public_taxonomy_owner_removed', 'remediated',
        jsonb_build_object('removed_owner_id', owner_id)
      from entities where type in ('domain','concept') and owner_id is not null
      on conflict (table_name, row_id) do nothing
    `);
  }
  await run(`update entities set owner_id = null where type in ('domain','concept') and owner_id is not null`);
  result.publicTaxonomyCleared = taxonomyCount;

  // 10. Quarantine unresolved personal rows. This is additive and reversible.
  const quarantineTargets: Array<{ table: string; idExpr?: string; where: string; reason: string }> = [
    { table: "raw_events", where: "owner_id is null", reason: "unresolved_event_owner" },
    { table: "knowledge_facts", where: "owner_id is null", reason: "unresolved_fact_owner" },
    { table: "knowledge_embeddings", where: "owner_id is null", reason: "unresolved_embedding_owner" },
    { table: "knowledge_feedback", where: "owner_id is null", reason: "unresolved_feedback_owner" },
    { table: "classified_events", where: "owner_id is null", reason: "unresolved_classification_owner" },
    { table: "classification_decisions", where: "owner_id is null", reason: "unresolved_classification_owner" },
    { table: "classification_corrections", where: "owner_id is null", reason: "unresolved_correction_owner" },
    { table: "financial_transactions", where: "owner_id is null", reason: "unresolved_financial_owner" },
    { table: "financial_accounts", where: "owner_id is null", reason: "unresolved_account_owner" },
    { table: "pending_financial_transactions", where: "owner_id is null", reason: "unresolved_pending_owner" },
    { table: "entity_aliases", where: "owner_id is null", reason: "unresolved_entity_alias_owner" },
    { table: "entity_merges", idExpr: "alias_entity_id", where: "owner_id is null", reason: "unresolved_entity_merge_owner" },
    { table: "entity_review_queue", where: "owner_id is null", reason: "unresolved_review_owner" },
  ];
  for (const target of quarantineTargets) {
    const idExpression = target.idExpr ?? "id";
    const rows = (await db.query<{ id: string }>(`select target.${idExpression} as id from ${target.table} target
      where target.${target.where} and not exists (
        select 1 from owner_quarantine q
        where q.table_name = '${target.table}' and q.row_id = target.${idExpression}::text
      )`)).rows;
    result.unresolved[target.table] = rows.length;
    for (const row of rows) {
      if (!dryRun) await quarantineRow(db, { table: target.table, rowId: row.id, reason: target.reason });
      result.quarantined += 1;
    }
  }

  // Personal entities without a provable single owner are quarantined. Public
  // taxonomy (domain/concept) is never quarantined for ownership reasons.
  const unownedEntities = (await db.query<{ id: string }>(`
    select entity.id from entities entity
    where entity.type not in ('domain','concept') and entity.owner_id is null
      and not exists (
        select 1 from owner_quarantine q where q.table_name = 'entities' and q.row_id = entity.id
      )`)).rows;
  result.unresolved.entities = unownedEntities.length;
  for (const row of unownedEntities) {
    if (!dryRun) await quarantineRow(db, { table: "entities", rowId: row.id, reason: "unresolved_entity_owner" });
    result.quarantined += 1;
  }

  // Relations are unresolved when they connect personal content without a
  // provable single owner. Ambiguous mixed-owner edges get a specific reason.
  const ambiguousRelations = (await db.query<{ id: string }>(`
    select relation.id from relations relation
    where relation.owner_id is null and (
      select count(distinct candidate.owner_id) from (
        select source.owner_id from entities source where source.id = relation.source_entity_id
        union all select target.owner_id from entities target where target.id = relation.target_entity_id
      ) candidate where candidate.owner_id is not null
    ) > 1 and not exists (
      select 1 from owner_quarantine q where q.table_name = 'relations' and q.row_id = relation.id
    )`)).rows;
  for (const row of ambiguousRelations) {
    if (!dryRun) await quarantineRow(db, { table: "relations", rowId: row.id, reason: "ambiguous_multi_owner_relation" });
    result.quarantined += 1;
  }
  const unownedRelations = (await db.query<{ id: string }>(`
    select relation.id from relations relation
    where relation.owner_id is null
      and not (coalesce((select source.type from entities source where source.id = relation.source_entity_id), '') in ('domain','concept')
               and coalesce((select target.type from entities target where target.id = relation.target_entity_id), '') in ('domain','concept'))
      and not exists (
        select 1 from owner_quarantine q where q.table_name = 'relations' and q.row_id = relation.id
      )`)).rows;
  result.unresolved.relations = unownedRelations.length;
  for (const row of unownedRelations) {
    if (!dryRun) await quarantineRow(db, { table: "relations", rowId: row.id, reason: "unresolved_relation_owner" });
    result.quarantined += 1;
  }

  return result;
}
