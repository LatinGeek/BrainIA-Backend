import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/brainia_test";

type QueryResult<T> = {
  rows: T[];
  rowCount: number;
};

type Queryable = {
  query: <T>(sql: string, params?: readonly unknown[]) => Promise<QueryResult<T>>;
};

function createQueuedDb(responses: Array<QueryResult<any>>): Queryable {
  let index = 0;
  return {
    async query<T>() {
      const response = responses[index++];
      if (!response) {
        throw new Error(`Unexpected query at index ${index}`);
      }
      return response as QueryResult<T>;
    },
  };
}

const { mergeEntities, resolveEntityMatches, upsertEntity } = await import("../src/storage/entity-repository.ts");
const { buildEventSearchQuery } = await import("../src/storage/search-repository.ts");

test("upsert entity returns the canonical root when the row is merged", async () => {
  const db = createQueuedDb([
    { rows: [{ id: "entity_2" }], rowCount: 1 },
    {
      rows: [
        {
          id: "entity_2",
          type: "merchant",
          value: "Spotify",
          normalizedValue: "spotify",
          metadata: {},
          createdAt: "2026-07-13T00:00:00.000Z",
          canonicalEntityId: "entity_1",
          isCanonical: false,
          aliasCount: 0,
          mergeReason: "manual_merge",
          mergeConfidence: 1,
        },
      ],
      rowCount: 1,
    },
    {
      rows: [
        {
          id: "entity_1",
          type: "merchant",
          value: "Spotify",
          normalizedValue: "spotify",
          metadata: {},
          createdAt: "2026-07-13T00:00:00.000Z",
          canonicalEntityId: "entity_1",
          isCanonical: true,
          aliasCount: 1,
          mergeReason: null,
          mergeConfidence: null,
        },
      ],
      rowCount: 1,
    },
  ]);

  const entity = await upsertEntity(db, {
    type: "merchant",
    value: "Spotify",
    normalizedValue: "spotify",
    metadata: {
      source: "heuristic",
    },
  });

  assert.equal(entity.id, "entity_1");
  assert.equal(entity.canonicalEntityId, "entity_1");
  assert.equal(entity.isCanonical, true);
});

test("resolve entity matches deduplicates aliases into the canonical root", async () => {
  const db = createQueuedDb([
    {
      rows: [
        {
          id: "entity_2",
          type: "merchant",
          value: "Spotify",
          normalizedValue: "spotify",
          metadata: {},
          createdAt: "2026-07-13T00:00:00.000Z",
          canonicalEntityId: "entity_1",
          isCanonical: false,
          aliasCount: 0,
          mergeReason: "manual_merge",
          mergeConfidence: 1,
        },
        {
          id: "entity_1",
          type: "merchant",
          value: "Spotify",
          normalizedValue: "spotify",
          metadata: {},
          createdAt: "2026-07-13T00:00:00.000Z",
          canonicalEntityId: "entity_1",
          isCanonical: true,
          aliasCount: 1,
          mergeReason: null,
          mergeConfidence: null,
        },
      ],
      rowCount: 2,
    },
    {
      rows: [
        {
          id: "entity_1",
          type: "merchant",
          value: "Spotify",
          normalizedValue: "spotify",
          metadata: {},
          createdAt: "2026-07-13T00:00:00.000Z",
          canonicalEntityId: "entity_1",
          isCanonical: true,
          aliasCount: 1,
          mergeReason: null,
          mergeConfidence: null,
        },
      ],
      rowCount: 1,
    },
  ]);

  const matches = await resolveEntityMatches(db, { q: "spotify" });

  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.id, "entity_1");
  assert.equal(matches[0]?.matchedEntityId, "entity_2");
  assert.equal(matches[0]?.isCanonical, true);
});

test("merge entities materializes same_as provenance and keeps canonical roots deterministic", async () => {
  const db = createQueuedDb([
    {
      rows: [
        {
          id: "entity_4",
          type: "merchant",
          value: "Spotify Inc.",
          normalizedValue: "spotify inc",
          metadata: {},
          createdAt: "2026-07-13T00:00:00.000Z",
          canonicalEntityId: "entity_4",
          isCanonical: true,
          aliasCount: 0,
          mergeReason: null,
          mergeConfidence: null,
        },
      ],
      rowCount: 1,
    },
    {
      rows: [
        {
          id: "entity_1",
          type: "merchant",
          value: "Spotify",
          normalizedValue: "spotify",
          metadata: {},
          createdAt: "2026-07-13T00:00:00.000Z",
          canonicalEntityId: "entity_1",
          isCanonical: true,
          aliasCount: 0,
          mergeReason: null,
          mergeConfidence: null,
        },
      ],
      rowCount: 1,
    },
    {
      rows: [
        {
          id: "entity_4",
          type: "merchant",
          value: "Spotify Inc.",
          normalizedValue: "spotify inc",
          metadata: {},
          createdAt: "2026-07-13T00:00:00.000Z",
          canonicalEntityId: "entity_4",
          isCanonical: true,
          aliasCount: 0,
          mergeReason: null,
          mergeConfidence: null,
        },
      ],
      rowCount: 1,
    },
    {
      rows: [
        {
          id: "entity_1",
          type: "merchant",
          value: "Spotify",
          normalizedValue: "spotify",
          metadata: {},
          createdAt: "2026-07-13T00:00:00.000Z",
          canonicalEntityId: "entity_1",
          isCanonical: true,
          aliasCount: 0,
          mergeReason: null,
          mergeConfidence: null,
        },
      ],
      rowCount: 1,
    },
    { rows: [], rowCount: 1 },
    {
      rows: [
        {
          id: "relation_1",
          relationType: "same_as",
          label: "es la misma entidad que",
          description: "Spotify Inc. es la misma entidad que Spotify",
          confidence: 1,
        },
      ],
      rowCount: 1,
    },
  ]);

  const merge = await mergeEntities(db, "entity_4", "entity_1", {
    reason: "manual cleanup",
    confidence: 1,
  });

  assert.equal(merge.aliasEntityId, "entity_4");
  assert.equal(merge.canonicalEntityId, "entity_1");
  assert.equal(merge.alreadyMerged, false);
  assert.equal(merge.sameAsRelation?.relationType, "same_as");
});

test("search relevance filters are translated into deterministic query clauses", () => {
  const built = buildEventSearchQuery("spotify", {
    source: "tasker",
    kind: "notification",
    from: "2026-07-01T00:00:00.000Z",
    to: "2026-07-31T23:59:59.999Z",
  });

  assert.equal(built.eventParams[0], "%spotify%");
  assert.equal(built.eventParams[1], "tasker");
  assert.equal(built.eventParams[2], "notification");
  assert.equal(built.eventParams[3], "2026-07-01T00:00:00.000Z");
  assert.equal(built.eventParams[4], "2026-07-31T23:59:59.999Z");
  assert.match(built.eventWhereClause, /lower\(coalesce\(r\.source, ''\)\) = \$2/);
  assert.match(built.eventWhereClause, /lower\(coalesce\(r\.kind, ''\)\) = \$3/);
  assert.match(built.eventWhereClause, /coalesce\(r\.timestamp, r\.created_at\) >= \$4::timestamptz/);
  assert.match(built.eventWhereClause, /coalesce\(r\.timestamp, r\.created_at\) <= \$5::timestamptz/);
});
