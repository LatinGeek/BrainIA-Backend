import { Pool } from "pg";
import { resolveRuntimeDatabaseUrl } from "../storage/database-url.js";

type CleanupPreset = "smoke";

type CleanupOptions = {
  apply: boolean;
  fullPurge: boolean;
  pruneOrphans: boolean;
  includeRuns: boolean;
  preset: CleanupPreset | null;
  since: string | null;
  before: string | null;
  sources: string[];
  sourcePrefixes: string[];
  idPrefixes: string[];
  kinds: string[];
  tags: string[];
  tools: string[];
  contains: string[];
};

type MatchSpec = {
  sql: string;
  params: unknown[];
};

type Queryable = Pick<Pool, "query">;

type CleanupCounts = {
  rawEvents: number;
  classifiedEvents: number;
  eventEntities: number;
  eventRelations: number;
  reviewQueue: number;
  financialTransactionEvents: number;
  financialTransactions: number;
  insightRuns: number;
  digestRuns: number;
};

type CleanupDeletes = CleanupCounts & {
  orphanRelations: number;
  orphanEntities: number;
};

function usage() {
  return [
    "Usage:",
    "  npm run cleanup:test-data -- --preset smoke --apply",
    "  npm run cleanup:test-data -- --tag test --since 2026-07-13T00:00:00.000Z --before 2026-07-14T00:00:00.000Z --apply",
    "  npm run cleanup:test-data -- --full-purge --apply",
    "",
    "Flags:",
    "  --apply                Execute the delete instead of dry-run",
    "  --full-purge           Remove all application tables except schema_migrations",
    "  --prune-orphans        Remove orphan relations and entities after deleting matched events",
    "  --no-prune-orphans     Skip orphan pruning",
    "  --include-runs         Also clean matching insight_runs and digest_runs",
    "  --preset smoke         Apply the built-in smoke markers for smoke/test runs",
    "  --since <iso>          Match rows created at or after the timestamp",
    "  --before <iso>         Match rows created before the timestamp",
    "  --source <value>       Match raw_events.source exactly; repeatable or comma-separated",
    "  --source-prefix <v>    Match raw_events.source by prefix; repeatable or comma-separated",
    "  --id-prefix <v>        Match raw_events.id by prefix; repeatable or comma-separated",
    "  --kind <value>         Match raw_events.kind exactly; repeatable or comma-separated",
    "  --tag <value>          Match raw_events.tags; repeatable or comma-separated",
    "  --tool <value>         Match audit run tool_name exactly; repeatable or comma-separated",
    "  --contains <value>     Match text fields across events and runs; repeatable or comma-separated",
    "  --help                 Show this message",
  ].join("\n");
}

function parseList(value: string) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeList(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function pushParam(params: unknown[], value: unknown) {
  params.push(value);
  return `$${params.length}`;
}

function parseArgs(argv: string[]): CleanupOptions {
  const options: CleanupOptions = {
    apply: false,
    fullPurge: false,
    pruneOrphans: false,
    includeRuns: false,
    preset: null,
    since: null,
    before: null,
    sources: [],
    sourcePrefixes: [],
    idPrefixes: [],
    kinds: [],
    tags: [],
    tools: [],
    contains: [],
  };

  const readValue = (index: number) => {
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${argv[index]}`);
    }

    return next;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }

    if (arg === "--apply") {
      options.apply = true;
      continue;
    }

    if (arg === "--full-purge") {
      options.fullPurge = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.apply = false;
      continue;
    }

    if (arg === "--prune-orphans") {
      options.pruneOrphans = true;
      continue;
    }

    if (arg === "--no-prune-orphans") {
      options.pruneOrphans = false;
      continue;
    }

    if (arg === "--include-runs") {
      options.includeRuns = true;
      continue;
    }

    const [flag, inlineValue] = arg.split("=", 2);
    switch (flag) {
      case "--preset": {
        const value = inlineValue ?? readValue(i);
        if (!inlineValue) i += 1;
        if (value !== "smoke") {
          throw new Error(`Unsupported preset "${value}"`);
        }

        options.preset = "smoke";
        break;
      }
      case "--since": {
        const value = inlineValue ?? readValue(i);
        if (!inlineValue) i += 1;
        options.since = value;
        break;
      }
      case "--before": {
        const value = inlineValue ?? readValue(i);
        if (!inlineValue) i += 1;
        options.before = value;
        break;
      }
      case "--source": {
        const value = inlineValue ?? readValue(i);
        if (!inlineValue) i += 1;
        options.sources.push(...parseList(value));
        break;
      }
      case "--source-prefix": {
        const value = inlineValue ?? readValue(i);
        if (!inlineValue) i += 1;
        options.sourcePrefixes.push(...parseList(value));
        break;
      }
      case "--id-prefix": {
        const value = inlineValue ?? readValue(i);
        if (!inlineValue) i += 1;
        options.idPrefixes.push(...parseList(value));
        break;
      }
      case "--kind": {
        const value = inlineValue ?? readValue(i);
        if (!inlineValue) i += 1;
        options.kinds.push(...parseList(value));
        break;
      }
      case "--tag": {
        const value = inlineValue ?? readValue(i);
        if (!inlineValue) i += 1;
        options.tags.push(...parseList(value));
        break;
      }
      case "--tool": {
        const value = inlineValue ?? readValue(i);
        if (!inlineValue) i += 1;
        options.tools.push(...parseList(value));
        break;
      }
      case "--contains": {
        const value = inlineValue ?? readValue(i);
        if (!inlineValue) i += 1;
        options.contains.push(...parseList(value));
        break;
      }
      default:
        throw new Error(`Unknown flag "${arg}"`);
    }
  }

  if (options.preset === "smoke") {
    options.sources.push("codex-smoke");
    options.sourcePrefixes.push("smoke-");
    options.idPrefixes.push("smoke_");
    options.tags.push("smoke", "test");
    options.kinds.push("smoke-notification");
  }

  options.sources = normalizeList(options.sources.map((value) => value.toLowerCase()));
  options.sourcePrefixes = normalizeList(options.sourcePrefixes.map((value) => value.toLowerCase()));
  options.idPrefixes = normalizeList(options.idPrefixes.map((value) => value.toLowerCase()));
  options.kinds = normalizeList(options.kinds.map((value) => value.toLowerCase()));
  options.tags = normalizeList(options.tags.map((value) => value.toLowerCase()));
  options.tools = normalizeList(options.tools.map((value) => value.toLowerCase()));
  options.contains = normalizeList(options.contains);

  return options;
}

function buildTextMatchClause(
  fields: string[],
  patterns: string[],
  params: unknown[],
) {
  if (!patterns.length) {
    return null;
  }

  const patternClauses: string[] = [];
  for (const pattern of patterns) {
    const sqlParam = pushParam(params, `%${escapeLike(pattern.toLowerCase())}%`);
    patternClauses.push(`(${fields.map((field) => `lower(coalesce(${field}, '')) like ${sqlParam} escape '\\'`).join(" or ")})`);
  }

  return `(${patternClauses.join(" or ")})`;
}

function buildRawMatchSpec(options: CleanupOptions): MatchSpec {
  const params: unknown[] = [];
  const clauses: string[] = [];

  if (options.since) {
    clauses.push(`created_at >= ${pushParam(params, options.since)}::timestamptz`);
  }

  if (options.before) {
    clauses.push(`created_at < ${pushParam(params, options.before)}::timestamptz`);
  }

  if (options.sources.length) {
    clauses.push(`lower(coalesce(source, '')) = any(${pushParam(params, options.sources)}::text[])`);
  }

  if (options.sourcePrefixes.length) {
    const prefixClauses = options.sourcePrefixes.map((prefix) => `lower(coalesce(source, '')) like ${pushParam(params, `${escapeLike(prefix)}%`)} escape '\\'`);
    clauses.push(`(${prefixClauses.join(" or ")})`);
  }

  if (options.idPrefixes.length) {
    const prefixClauses = options.idPrefixes.map((prefix) => `lower(coalesce(id, '')) like ${pushParam(params, `${escapeLike(prefix)}%`)} escape '\\'`);
    clauses.push(`(${prefixClauses.join(" or ")})`);
  }

  if (options.kinds.length) {
    clauses.push(`lower(coalesce(kind, '')) = any(${pushParam(params, options.kinds)}::text[])`);
  }

  if (options.tags.length) {
    clauses.push(`
      exists (
        select 1
        from unnest(coalesce(tags, '{}'::text[])) as tag(value)
        where lower(tag.value) = any(${pushParam(params, options.tags)}::text[])
      )
    `);
  }

  const textClause = buildTextMatchClause(
    [
      "id",
      "source",
      "kind",
      "coalesce(title, '')",
      "coalesce(body, '')",
      "coalesce(external_id, '')",
      "coalesce(dedupe_key, '')",
      "coalesce(raw::text, '')",
    ],
    options.contains,
    params,
  );

  if (textClause) {
    clauses.push(textClause);
  }

  return {
    sql: clauses.length ? clauses.join("\n    and ") : "true",
    params,
  };
}

function buildRunMatchSpec(options: CleanupOptions): MatchSpec {
  const params: unknown[] = [];
  const clauses: string[] = [];

  if (options.since) {
    clauses.push(`created_at >= ${pushParam(params, options.since)}::timestamptz`);
  }

  if (options.before) {
    clauses.push(`created_at < ${pushParam(params, options.before)}::timestamptz`);
  }

  if (options.tools.length) {
    clauses.push(`lower(coalesce(tool_name, '')) = any(${pushParam(params, options.tools)}::text[])`);
  }

  const textClause = buildTextMatchClause(
    [
      "coalesce(tool_name, '')",
      "coalesce(query, '')",
      "coalesce(scope, '')",
      "coalesce(summary, '')",
      "coalesce(request::text, '')",
      "coalesce(response::text, '')",
    ],
    options.contains,
    params,
  );

  if (textClause) {
    clauses.push(textClause);
  }

  return {
    sql: clauses.length ? clauses.join("\n    and ") : "true",
    params,
  };
}

function hasRunFilters(options: CleanupOptions) {
  return Boolean(options.since || options.before || options.tools.length || options.contains.length);
}

async function getCleanupCounts(db: Queryable, options: CleanupOptions): Promise<CleanupCounts> {
  const rawMatch = buildRawMatchSpec(options);
  const includeRuns = options.includeRuns && hasRunFilters(options);

  const result = await db.query<CleanupCounts>(
    `
      with candidate_raw_events as (
        select id
        from raw_events
        where ${rawMatch.sql}
      ),
      candidate_financial_transactions as (
        select distinct fte.transaction_id
        from financial_transaction_events fte
        join candidate_raw_events r on r.id = fte.raw_event_id
      )
      select
        (select count(*)::int from candidate_raw_events) as "rawEvents",
        (select count(*)::int from classified_events c join candidate_raw_events r on r.id = c.raw_event_id) as "classifiedEvents",
        (select count(*)::int from event_entities ee join candidate_raw_events r on r.id = ee.event_id) as "eventEntities",
        (select count(*)::int from event_relations er join candidate_raw_events r on r.id = er.event_id) as "eventRelations",
        (select count(*)::int from entity_review_queue q join candidate_raw_events r on r.id = q.event_id) as "reviewQueue",
        (select count(*)::int from financial_transaction_events fte join candidate_raw_events r on r.id = fte.raw_event_id) as "financialTransactionEvents",
        (select count(*)::int from financial_transactions ft join candidate_financial_transactions cft on cft.transaction_id = ft.id where not exists (select 1 from financial_transaction_events fte where fte.transaction_id = ft.id and fte.raw_event_id not in (select id from candidate_raw_events))) as "financialTransactions",
        ${includeRuns ? `(select count(*)::int from insight_runs where ${buildRunMatchSpec(options).sql})` : "0::int"} as "insightRuns",
        ${includeRuns ? `(select count(*)::int from digest_runs where ${buildRunMatchSpec(options).sql})` : "0::int"} as "digestRuns"
    `,
    includeRuns ? [...rawMatch.params, ...buildRunMatchSpec(options).params, ...buildRunMatchSpec(options).params] : rawMatch.params,
  );

  return result.rows[0] ?? {
    rawEvents: 0,
    classifiedEvents: 0,
    eventEntities: 0,
    eventRelations: 0,
    reviewQueue: 0,
    financialTransactionEvents: 0,
    financialTransactions: 0,
    insightRuns: 0,
    digestRuns: 0,
  };
}

async function applyCleanup(db: Queryable, options: CleanupOptions): Promise<CleanupDeletes> {
  const rawMatch = buildRawMatchSpec(options);
  const includeRuns = options.includeRuns && hasRunFilters(options);
  const pruneOrphansClause = options.pruneOrphans
    ? `
      ,
      deleted_relations as (
        delete from relations rel
        where not exists (
          select 1
          from event_relations er
          where er.relation_id = rel.id
        )
        returning id
      ),
      deleted_entities as (
        delete from entities e
        where not exists (
          select 1
          from event_entities ee
          where ee.entity_id = e.id
        )
          and not exists (
            select 1
            from relations r
            where r.source_entity_id = e.id
               or r.target_entity_id = e.id
          )
          and not exists (
            select 1
            from entity_merges m
            where m.alias_entity_id = e.id
               or m.canonical_entity_id = e.id
          )
          and not exists (
            select 1
            from entity_aliases a
            where a.entity_id = e.id
          )
          and not exists (
            select 1
            from entity_review_queue q
            where q.entity_id = e.id
          )
        returning id
      )`
    : "";

  await db.query("create temp table cleanup_candidate_raw_events (id text primary key) on commit drop");
  await db.query(
    `
      insert into cleanup_candidate_raw_events (id)
      select id
      from raw_events
      where ${rawMatch.sql}
    `,
    rawMatch.params,
  );
  await db.query("create temp table cleanup_candidate_financial_transactions (transaction_id text primary key) on commit drop");
  await db.query(
    `
      insert into cleanup_candidate_financial_transactions (transaction_id)
      select distinct fte.transaction_id
      from financial_transaction_events fte
      join cleanup_candidate_raw_events r on r.id = fte.raw_event_id
    `,
  );

  const runMatch = includeRuns ? buildRunMatchSpec(options) : null;
  const runDeleteCtes = includeRuns && runMatch
    ? `
      , deleted_insight_runs as (
        delete from insight_runs
        where ${runMatch.sql}
        returning id
      ),
      deleted_digest_runs as (
        delete from digest_runs
        where ${runMatch.sql}
        returning id
      )`
    : "";

  const deletionResult = await db.query<CleanupDeletes>(
    `
      with
      deleted_review_queue as (
        delete from entity_review_queue
        where event_id in (
          select id from cleanup_candidate_raw_events
        )
        returning id
      ),
      deleted_financial_transaction_events as (
        delete from financial_transaction_events
        where raw_event_id in (
          select id from cleanup_candidate_raw_events
        )
        returning id
      ),
      deleted_raw_events as (
        delete from raw_events
        where id in (
          select id from cleanup_candidate_raw_events
        )
        returning id
      ),
      deleted_financial_transactions as (
        delete from financial_transactions ft
        where ft.id in (
          select transaction_id
          from cleanup_candidate_financial_transactions
        )
          and not exists (
            select 1
            from financial_transaction_events fte
            where fte.transaction_id = ft.id
        )
        returning id
      )${runDeleteCtes}${pruneOrphansClause}
      select
        (select count(*)::int from deleted_raw_events) as "rawEvents",
        (select count(*)::int from classified_events c join cleanup_candidate_raw_events r on r.id = c.raw_event_id) as "classifiedEvents",
        (select count(*)::int from event_entities ee join cleanup_candidate_raw_events r on r.id = ee.event_id) as "eventEntities",
        (select count(*)::int from event_relations er join cleanup_candidate_raw_events r on r.id = er.event_id) as "eventRelations",
        (select count(*)::int from deleted_review_queue) as "reviewQueue",
        (select count(*)::int from deleted_financial_transaction_events) as "financialTransactionEvents",
        (select count(*)::int from deleted_financial_transactions) as "financialTransactions",
        ${includeRuns ? '(select count(*)::int from deleted_insight_runs)' : '0::int'} as "insightRuns",
        ${includeRuns ? '(select count(*)::int from deleted_digest_runs)' : '0::int'} as "digestRuns",
        ${options.pruneOrphans ? '(select count(*)::int from deleted_relations) as "orphanRelations",' : '0::int as "orphanRelations",'}
        ${options.pruneOrphans ? '(select count(*)::int from deleted_entities) as "orphanEntities"' : '0::int as "orphanEntities"'}
    `,
    includeRuns && runMatch ? [...runMatch.params, ...runMatch.params] : [],
  );

  return deletionResult.rows[0] ?? {
    rawEvents: 0,
    classifiedEvents: 0,
    eventEntities: 0,
    eventRelations: 0,
    reviewQueue: 0,
    financialTransactionEvents: 0,
    financialTransactions: 0,
    insightRuns: 0,
    digestRuns: 0,
    orphanRelations: 0,
    orphanEntities: 0,
  };
}

function hasAnyFilters(options: CleanupOptions) {
  return Boolean(
    options.fullPurge ||
    options.preset ||
      options.includeRuns ||
      options.since ||
      options.before ||
      options.sources.length ||
      options.sourcePrefixes.length ||
      options.idPrefixes.length ||
      options.kinds.length ||
      options.tags.length ||
      options.tools.length ||
      options.contains.length,
  );
}

async function listApplicationTables(db: Queryable) {
  const result = await db.query<{ tablename: string }>(
    `
      select tablename
      from pg_tables
      where schemaname = 'public'
        and tablename <> 'schema_migrations'
      order by tablename asc
    `,
  );

  return result.rows.map((row) => row.tablename);
}

async function getFullPurgeCounts(db: Queryable) {
  const tables = await listApplicationTables(db);
  const counts = [];

  for (const table of tables) {
    const result = await db.query<{ count: string }>(`select count(*)::text as count from ${table}`);
    counts.push({
      table,
      rows: Number(result.rows[0]?.count ?? 0),
    });
  }

  return {
    tables: counts,
    totalRows: counts.reduce((sum, row) => sum + row.rows, 0),
  };
}

async function applyFullPurge(db: Queryable) {
  const tables = await listApplicationTables(db);
  if (!tables.length) {
    return {
      tables: [],
      totalRows: 0,
    };
  }

  const countBefore = await getFullPurgeCounts(db);
  const tableSql = tables.map((table) => `"${table}"`).join(", ");
  await db.query(`truncate table ${tableSql} restart identity cascade`);
  await db.query(
    `
      insert into entity_sequences (name, value)
      values ('entity', 0), ('relation', 0)
      on conflict (name) do update set value = excluded.value
    `,
  );

  return countBefore;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.includeRuns && !hasRunFilters(options)) {
    console.error(usage());
    throw new Error("Refusing to include audit runs without explicit run filters");
  }

  if (!hasAnyFilters(options)) {
    console.error(usage());
    throw new Error("Refusing to run without filters");
  }

  const connectionString = resolveRuntimeDatabaseUrl();
  if (!connectionString) {
    throw new Error("DATABASE_URL or a compatible Postgres URL is required");
  }

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    await client.query("begin");

    if (options.fullPurge) {
      const summary = options.apply ? await applyFullPurge(client) : await getFullPurgeCounts(client);
      console.log(
        JSON.stringify(
          {
            mode: options.apply ? "apply" : "dry-run",
            fullPurge: true,
            tables: summary.tables,
            totalRows: summary.totalRows,
          },
          null,
          2,
        ),
      );
      await client.query(options.apply ? "commit" : "rollback");
      return;
    }

    const counts = await getCleanupCounts(client, options);
    console.log(
      JSON.stringify(
        {
          mode: options.apply ? "apply" : "dry-run",
          preset: options.preset,
          filters: {
            since: options.since,
            before: options.before,
            sources: options.sources,
            sourcePrefixes: options.sourcePrefixes,
            idPrefixes: options.idPrefixes,
            kinds: options.kinds,
            tags: options.tags,
            tools: options.tools,
            contains: options.contains,
            pruneOrphans: options.pruneOrphans,
          },
          matches: counts,
        },
        null,
        2,
      ),
    );

    if (!options.apply) {
      await client.query("rollback");
      return;
    }

    const deletionCounts = await applyCleanup(client, options);
    console.log(
      JSON.stringify(
        {
          mode: "apply",
          deleted: deletionCounts,
        },
        null,
        2,
      ),
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
