import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type Fixture = {
  name: string;
  event: { id: string; source: string; kind: string; title?: string; body?: string; raw: Record<string, unknown>; tags: string[] };
  expected: {
    kind: string;
    kindAlternatives?: string[];
    amount?: string;
    categoryPrefixes: string[];
    prohibitedCategoryPrefixes?: string[];
    requiredFacets?: string[];
    maxNewCategories?: number;
    liveOnlyCategory?: boolean;
  };
};

const mode = process.argv.includes("--live") ? "live" : "offline";
const recordArgument = process.argv.find((argument) => argument.startsWith("--record="));
const recordPath = recordArgument?.slice("--record=".length);
process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/brainia_harness";

const [{ classifyEvent }, { buildEntityDrafts }, { semanticInstanceDraft }, semantic, assistant] = await Promise.all([
  import("../domain/classification.js"),
  import("../domain/entities.js"),
  import("../domain/ontology.js"),
  import("../storage/semantic-enrichment.js"),
  import("../storage/classification-assistant.js"),
]);

const fixtureText = await readFile(resolve("tests/fixtures/semantic-events.jsonl"), "utf8");
const fixtures = fixtureText.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as Fixture);
const results: Array<Record<string, unknown>> = [];
let failures = 0;

function check(condition: boolean, fixture: Fixture, message: string, errors: string[]) {
  if (condition) return;
  failures += 1;
  errors.push(message);
  console.error(`FAIL ${fixture.name}: ${message}`);
}

for (const fixture of fixtures) {
  const base = classifyEvent(fixture.event as Parameters<typeof classifyEvent>[0]);
  const classified = mode === "live"
    ? await assistant.maybeEnhanceClassification({ event: fixture.event as Parameters<typeof classifyEvent>[0], base, clientId: null, auditEventId: null })
    : base;
  const drafts = buildEntityDrafts({ ...classified, raw: classified.raw });
  drafts.push(semanticInstanceDraft({ eventId: classified.id, inferredKind: classified.inferredKind, source: classified.source, title: classified.title, body: classified.body }));
  const decision = await semantic.buildModelSemanticDecision({
    entities: drafts, source: classified.source, inferredKind: classified.inferredKind,
    title: classified.title, body: classified.body, clientId: null, allowModel: mode === "live", auditEventId: null,
  });
  const errors: string[] = [];
  const acceptedKinds = [fixture.expected.kind, ...(mode === "live" ? fixture.expected.kindAlternatives ?? [] : [])];
  check(acceptedKinds.includes(classified.inferredKind), fixture, `expected kind ${acceptedKinds.join(" or ")}, received ${classified.inferredKind}`, errors);
  if (fixture.expected.amount) {
    check(classified.entities.some((entity) => entity.type === "amount" && entity.value === fixture.expected.amount), fixture, `protected amount ${fixture.expected.amount} was not preserved`, errors);
  }
  const shouldCheckCategory = mode === "live" || !fixture.expected.liveOnlyCategory;
  if (shouldCheckCategory && fixture.expected.categoryPrefixes.length) {
    const primaryCategoryKey = decision.primaryCategoryKey;
    check(Boolean(primaryCategoryKey && fixture.expected.categoryPrefixes.some((prefix) => primaryCategoryKey === prefix || primaryCategoryKey.startsWith(`${prefix}.`))), fixture, `category ${primaryCategoryKey ?? "null"} is outside ${fixture.expected.categoryPrefixes.join(", ")}`, errors);
  }
  for (const prefix of fixture.expected.prohibitedCategoryPrefixes ?? []) {
    check(!decision.primaryCategoryKey?.startsWith(prefix), fixture, `prohibited category ${prefix} was selected`, errors);
  }
  for (const type of fixture.expected.requiredFacets ?? []) {
    check(decision.facets.some((facet) => facet.type === type), fixture, `required facet ${type} is missing`, errors);
  }
  const created = decision.paths.filter((path) => path.action === "create").length;
  check(created <= (fixture.expected.maxNewCategories ?? 0), fixture, `created ${created} categories; maximum is ${fixture.expected.maxNewCategories ?? 0}`, errors);
  check(decision.paths.every((path) => path.hierarchyPath.length > 0 && path.hierarchyPath[0] === path.domain), fixture, "one or more semantic paths are not rooted", errors);
  results.push({ fixture: fixture.name, mode, classifiedKind: classified.inferredKind, primaryCategoryKey: decision.primaryCategoryKey, facets: decision.facets, status: decision.status, createdCategories: created, errors });
  if (!errors.length) console.log(`PASS ${fixture.name} -> ${decision.primaryCategoryKey ?? "review/unclassified"}`);
}

if (recordPath) await writeFile(resolve(recordPath), `${JSON.stringify({ mode, createdAt: new Date().toISOString(), results }, null, 2)}\n`, "utf8");
console.log(`SEMANTIC_HARNESS mode=${mode} fixtures=${fixtures.length} failures=${failures}`);
if (failures) process.exitCode = 1;
