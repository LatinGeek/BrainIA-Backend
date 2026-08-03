import { pool } from "./postgres.js";
import { generateNaturalLanguageSummary } from "./deepseek.js";
import { buildDigestContent, DIGEST_JSON_PROMPT, parseDigestContent, type StructuredDigestContent } from "./generated-content.js";

type Queryable = Pick<typeof pool, "query">;

export type DigestFilters = {
  source?: string | null;
  kind?: string | null;
};

export type DigestWindow = {
  from: string;
  to: string;
};

export type DigestEventRow = {
  id: string;
  source: string;
  kind: string;
  title: string | null;
  body: string | null;
  timestamp: string | null;
  createdAt: string;
  inferredKind: string | null;
  confidence: number | null;
};

export type DigestInsightRow = {
  id: string;
  query: string | null;
  summary: string | null;
  model: string | null;
  createdAt: string;
};

export type KnowledgeDigest = {
  scope: string;
  window: DigestWindow;
  filters: DigestFilters;
  metrics: {
    totalEvents: number;
    classifiedEvents: number;
    uniqueEntities: number;
    uniqueRelations: number;
    eventsBySource: Array<{ source: string; count: number }>;
    eventsByKind: Array<{ kind: string; count: number }>;
    eventsByInferredKind: Array<{ kind: string; count: number }>;
  };
  recentEvents: Array<{
    id: string;
    source: string;
    kind: string;
    title: string | null;
    inferredKind: string | null;
    confidence: number | null;
    timestamp: string | null;
    createdAt: string;
  }>;
  relatedInsights: Array<{
    id: string;
    query: string | null;
    summary: string | null;
    model: string | null;
    createdAt: string;
  }>;
  highlights: string[];
  content: StructuredDigestContent;
  summary: string | null;
  model: string | null;
  summaryAvailable: boolean;
};

export type DigestBuildContext = {
  window: DigestWindow;
  filters: DigestFilters;
  scope: string;
  events: DigestEventRow[];
  relatedInsights: DigestInsightRow[];
  uniqueEntities: number;
  uniqueRelations: number;
  summary: string | null;
  model: string | null;
};

function countBy<T extends string>(items: T[]) {
  const counts = new Map<T, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

function buildHighlights(context: DigestBuildContext, metrics: KnowledgeDigest["metrics"]) {
  const highlights: string[] = [];

  if (metrics.totalEvents > 0) {
    highlights.push(
      `Captured ${metrics.totalEvents} events between ${context.window.from} and ${context.window.to}.`,
    );
  } else {
    highlights.push(`No events were captured between ${context.window.from} and ${context.window.to}.`);
  }

  const topSource = metrics.eventsBySource[0];
  if (topSource) {
    highlights.push(`Most active source: ${topSource.source} (${topSource.count}).`);
  }

  const topKind = metrics.eventsByKind[0];
  if (topKind) {
    highlights.push(`Most common kind: ${topKind.kind} (${topKind.count}).`);
  }

  const topInferredKind = metrics.eventsByInferredKind[0];
  if (topInferredKind) {
    highlights.push(`Most common inferred kind: ${topInferredKind.kind} (${topInferredKind.count}).`);
  }

  const latestInsight = context.relatedInsights[0];
  if (latestInsight?.summary) {
    highlights.push(`Latest related insight: ${latestInsight.summary}`);
  } else if (latestInsight?.query) {
    highlights.push(`Latest related insight query: ${latestInsight.query}`);
  }

  return highlights.slice(0, 5);
}

export function buildKnowledgeDigest(context: DigestBuildContext): KnowledgeDigest {
  const eventsBySource = countBy(context.events.map((event) => event.source)).map(({ value, count }) => ({
    source: value,
    count,
  }));
  const eventsByKind = countBy(context.events.map((event) => event.kind)).map(({ value, count }) => ({
    kind: value,
    count,
  }));
  const eventsByInferredKind = countBy(
    context.events.map((event) => event.inferredKind ?? "unclassified"),
  ).map(({ value, count }) => ({
    kind: value,
    count,
  }));

  const metrics = {
    totalEvents: context.events.length,
    classifiedEvents: context.events.filter((event) => Boolean(event.inferredKind)).length,
    uniqueEntities: context.uniqueEntities,
    uniqueRelations: context.uniqueRelations,
    eventsBySource,
    eventsByKind,
    eventsByInferredKind,
  };

  const highlights = buildHighlights(context, metrics);
  const fallbackSummary = metrics.totalEvents
    ? `Digest for ${context.scope} covers ${metrics.totalEvents} events, ${metrics.uniqueEntities} entities, and ${metrics.uniqueRelations} relations.`
    : `Digest for ${context.scope} did not find any events in the requested window.`;

  const content = buildDigestContent({
    totalEvents: metrics.totalEvents,
    topSource: metrics.eventsBySource[0],
    topKind: metrics.eventsByKind[0],
    highlights,
  });

  return {
    scope: context.scope,
    window: context.window,
    filters: context.filters,
    metrics,
    recentEvents: context.events.slice(0, 10).map((event) => ({
      id: event.id,
      source: event.source,
      kind: event.kind,
      title: event.title,
      inferredKind: event.inferredKind,
      confidence: event.confidence,
      timestamp: event.timestamp,
      createdAt: event.createdAt,
    })),
    relatedInsights: context.relatedInsights.slice(0, 10).map((insight) => ({
      id: insight.id,
      query: insight.query,
      summary: insight.summary,
      model: insight.model,
      createdAt: insight.createdAt,
    })),
    highlights,
    content,
    summary: context.summary ?? fallbackSummary,
    model: context.model,
    summaryAvailable: Boolean(context.summary ?? fallbackSummary),
  };
}

function buildTimeClause(filters: DigestFilters, window: DigestWindow) {
  const clauses = [
    "coalesce(r.timestamp, r.created_at) >= $1::timestamptz",
    "coalesce(r.timestamp, r.created_at) <= $2::timestamptz",
  ];
  const params: Array<string | null> = [window.from, window.to];

  if (filters.source) {
    params.push(filters.source);
    clauses.push(`lower(coalesce(r.source, '')) = lower($${params.length})`);
  }

  if (filters.kind) {
    params.push(filters.kind);
    clauses.push(`lower(coalesce(r.kind, '')) = lower($${params.length})`);
  }

  return {
    whereClause: clauses.join(" and "),
    params,
  };
}

export async function loadDigestData(
  db: Queryable,
  context: { window: DigestWindow; filters: DigestFilters; eventLimit: number; insightLimit: number },
) {
  const { whereClause, params } = buildTimeClause(context.filters, context.window);

  const eventsResult = await db.query<DigestEventRow>(
    `
      select
        r.id,
        r.source,
        r.kind,
        r.title,
        r.body,
        r.timestamp,
        r.created_at as "createdAt",
        c.inferred_kind as "inferredKind",
        c.confidence
      from raw_events r
      left join classified_events c on c.raw_event_id = r.id
      where ${whereClause}
      order by coalesce(r.timestamp, r.created_at) desc
      limit $${params.length + 1}
    `,
    [...params, context.eventLimit],
  );

  const metricsResult = await db.query<{
    uniqueEntities: string;
    uniqueRelations: string;
  }>(
    `
      select
        count(distinct ee.entity_id)::text as "uniqueEntities",
        count(distinct er.relation_id)::text as "uniqueRelations"
      from raw_events r
      left join event_entities ee on ee.event_id = r.id
      left join event_relations er on er.event_id = r.id
      where ${whereClause}
    `,
    params,
  );

  const relatedInsightsResult = await db.query<DigestInsightRow>(
    `
      select
        id,
        query,
        summary,
        model,
        created_at as "createdAt"
      from insight_runs
      where created_at >= $1::timestamptz and created_at <= $2::timestamptz
      order by created_at desc
      limit $3
    `,
    [context.window.from, context.window.to, context.insightLimit],
  );

  return {
    events: eventsResult.rows,
    relatedInsights: relatedInsightsResult.rows,
    uniqueEntities: Number(metricsResult.rows[0]?.uniqueEntities ?? 0),
    uniqueRelations: Number(metricsResult.rows[0]?.uniqueRelations ?? 0),
  };
}

export async function createKnowledgeDigest(input: {
  from?: string;
  to?: string;
  days?: number;
  source?: string;
  kind?: string;
  eventLimit?: number;
  insightLimit?: number;
  apiKey?: string;
  model?: string;
}) {
  const to = input.to ?? new Date().toISOString();
  const from = input.from ?? new Date(Date.parse(to) - (input.days ?? 7) * 24 * 60 * 60 * 1000).toISOString();
  const scopeParts = [`window ${from} -> ${to}`];
  if (input.source) scopeParts.push(`source=${input.source}`);
  if (input.kind) scopeParts.push(`kind=${input.kind}`);

  const context = await loadDigestData(pool, {
    window: { from, to },
    filters: {
      source: input.source ?? null,
      kind: input.kind ?? null,
    },
    eventLimit: input.eventLimit ?? 100,
    insightLimit: input.insightLimit ?? 10,
  });

  const baseDigest = buildKnowledgeDigest({
    window: { from, to },
    filters: {
      source: input.source ?? null,
      kind: input.kind ?? null,
    },
    scope: scopeParts.join(", "),
    events: context.events,
    relatedInsights: context.relatedInsights,
    uniqueEntities: context.uniqueEntities,
    uniqueRelations: context.uniqueRelations,
    summary: null,
    model: null,
  });

  const generated = await generateNaturalLanguageSummary({
    apiKey: input.apiKey,
    model: input.model,
    systemPrompt: `You summarize personal activity for a calm mobile interface. ${DIGEST_JSON_PROMPT}`,
    userPrompt: JSON.stringify(
      {
        scope: baseDigest.scope,
        window: baseDigest.window,
        filters: baseDigest.filters,
        metrics: baseDigest.metrics,
        highlights: baseDigest.highlights,
        recentEvents: baseDigest.recentEvents,
        relatedInsights: baseDigest.relatedInsights.map((insight) => ({ query: insight.query, summary: insight.summary })),
      },
      null,
      2,
    ),
    jsonMode: true,
    audit: { operation: "knowledge_digest_synthesis", promptVersion: "knowledge-digest-v3" },
  });

  const content = parseDigestContent(generated) ?? baseDigest.content;

  return {
    ...baseDigest,
    content,
    highlights: content.highlights,
    summary: content.summary,
    model: generated && parseDigestContent(generated) ? input.model ?? "deepseek-v4-flash" : null,
    summaryAvailable: true,
  };
}
