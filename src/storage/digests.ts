import { pool } from "./postgres.js";
import { generateNaturalLanguageSummary } from "./deepseek.js";
import { authorizeModelDispatch, listDeniedEgressSources, stillAuthorized } from "./privacy.js";
import { buildDigestContent, DIGEST_JSON_PROMPT, parseDigestContent, type StructuredDigestContent } from "./generated-content.js";
import { derivedRunReadEligibilitySql } from "./search-repository.js";
import { verifyGeneratedContent } from "./decision-verification.js";
import type { DecisionVerificationStatus, EvidenceItem, VerificationOutcome } from "../domain/decision-policy.js";

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
  /**
   * Additive evidence-policy metadata. Present once a generated candidate was
   * checked; it never weakens the deterministic fallback decision.
   */
  verification?: {
    status: DecisionVerificationStatus;
    verifierModel: string;
    reason: string;
    policyVersion: string;
  };
  /** Exact persisted lineage used for deletion invalidation; stripped from routes. */
  lineage?: {
    eventIds: string[];
    sources: string[];
  };
};

export type DigestVerificationMetadata = NonNullable<KnowledgeDigest["verification"]>;

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

/**
 * Turn the deterministic digest into the exact evidence set the verifier may
 * rely on. Refs are stable and derived only from persisted rows/aggregates, so
 * an invented total cannot be presented as supported activity.
 */
export function buildDigestEvidence(input: {
  window: DigestWindow;
  metrics: KnowledgeDigest["metrics"];
  events: Array<Pick<DigestEventRow, "id" | "source" | "kind" | "title" | "body" | "timestamp">>;
}): EvidenceItem[] {
  const items: EvidenceItem[] = [
    {
      ref: "aggregate:total-events",
      kind: "aggregate",
      label: "Total events",
      text: `total_events=${input.metrics.totalEvents}`,
    },
    {
      ref: "aggregate:window",
      kind: "aggregate",
      label: "Digest window",
      text: `window_from=${input.window.from}\nwindow_to=${input.window.to}`,
    },
    {
      ref: "aggregate:metrics",
      kind: "aggregate",
      label: "Deterministic metrics",
      text: JSON.stringify(input.metrics),
    },
  ];

  const topSource = input.metrics.eventsBySource[0];
  if (topSource) {
    items.push({
      ref: "aggregate:top-source",
      kind: "aggregate",
      label: "Most active source",
      text: `top_source=${topSource.source}\ntop_source_count=${topSource.count}`,
    });
  }

  const topKind = input.metrics.eventsByKind[0];
  if (topKind) {
    items.push({
      ref: "aggregate:top-kind",
      kind: "aggregate",
      label: "Most common kind",
      text: `top_kind=${topKind.kind}\ntop_kind_count=${topKind.count}`,
    });
  }

  for (const event of input.events.slice(0, 10)) {
    const occurredAt = event.timestamp ?? null;
    const title = event.title?.trim();
    if (title) {
      items.push({
        ref: `event:${event.id}:title`,
        kind: "event_title",
        label: title.slice(0, 200),
        text: title.slice(0, 300),
        eventId: event.id,
        source: event.source,
        occurredAt,
      });
    }
    const body = event.body?.trim();
    if (body) {
      items.push({
        ref: `event:${event.id}:body`,
        kind: "event_body",
        label: title?.slice(0, 200) || event.source,
        text: body.slice(0, 500),
        eventId: event.id,
        source: event.source,
        occurredAt,
      });
    }
  }

  return items;
}

/** Field text only: the schema version is not a factual claim. */
export function digestContentText(content: StructuredDigestContent) {
  return [
    content.title,
    content.summary,
    content.recommendedAction ?? "",
    ...content.highlights,
    ...content.cards.flatMap((card) => [card.title, card.summary, card.recommendedAction ?? ""]),
  ].join("\n");
}

/**
 * Publish the generated content only when the shared policy applies it.
 * Rejected/unavailable candidates in enforce mode keep the deterministic
 * digest; shadow mode records the verdict without blocking publication.
 */
export function applyDigestVerification(input: {
  baseContent: StructuredDigestContent;
  candidateContent: StructuredDigestContent | null;
  generatorModel: string | null;
  outcome: VerificationOutcome | null;
}): {
  content: StructuredDigestContent;
  summary: string | null;
  model: string | null;
  summaryAvailable: boolean;
  verification: DigestVerificationMetadata | null;
} {
  const verification = input.outcome
    ? {
        status: input.outcome.verification.status,
        verifierModel: input.outcome.verification.verifierModel,
        reason: input.outcome.verification.reason,
        policyVersion: input.outcome.verification.policyVersion,
      }
    : null;
  const applied = Boolean(input.candidateContent && input.outcome?.applies);
  if (!applied) {
    return {
      content: input.baseContent,
      summary: input.baseContent.summary,
      model: null,
      summaryAvailable: true,
      verification,
    };
  }
  return {
    content: input.candidateContent!,
    summary: input.candidateContent!.summary,
    model: input.generatorModel,
    summaryAvailable: true,
    verification,
  };
}

function buildTimeClause(filters: DigestFilters, window: DigestWindow) {
  const clauses = [
    "coalesce(r.timestamp, r.created_at) >= $1::timestamptz",
    "coalesce(r.timestamp, r.created_at) <= $2::timestamptz",
    "r.privacy_status <> 'hidden'",
    "r.processing_allowed",
    "not exists (select 1 from deletion_tombstones tombstone where tombstone.target_type = 'event' and tombstone.target_id = r.id)",
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
  context: {
    window: DigestWindow;
    filters: DigestFilters;
    eventLimit: number;
    insightLimit: number;
    ownerId?: string | null;
  },
) {
  const { whereClause: timeClause, params } = buildTimeClause(context.filters, context.window);
  let whereClause = timeClause;
  const ownerId = context.ownerId ?? null;
  // A scoped owner must only summarize its own evidence. Legacy rows that have
  // neither owner_id nor client_id never match; an unscoped (admin/disabled)
  // caller keeps the previous global behavior.
  if (ownerId) {
    params.push(ownerId);
    whereClause = `${whereClause} and coalesce(r.owner_id, r.client_id) = $${params.length}`;
  }

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

  const insightParams: Array<string | number> = [context.window.from, context.window.to, context.insightLimit];
  let insightOwnerClause = "";
  if (ownerId) {
    insightParams.push(ownerId);
    insightOwnerClause = `and owner_id = $${insightParams.length}`;
  }
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
        and (summary is not null or query is not null)
        and ${derivedRunReadEligibilitySql("insight_runs", "insight_runs")}
        ${insightOwnerClause}
      order by created_at desc
      limit $3
    `,
    insightParams,
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
  ownerId?: string | null;
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
    ownerId: input.ownerId ?? null,
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

  const digestAuthorization = await authorizeModelDispatch(pool, {
    ownerId: input.ownerId,
    purpose: "knowledge_digest_synthesis",
    sources: [
      ...context.events.map((event: { source?: string | null }) => event.source),
      // Insight runs do not persist a source lineage. A summary that includes
      // them can only be dispatched if every owner source still permits egress.
      ...(context.relatedInsights.length && input.ownerId
        ? await listDeniedEgressSources(pool, input.ownerId)
        : []),
    ],
    evidence: context.events.map((event: { id: string; source?: string | null }) => ({ eventId: event.id, source: event.source })),
  });

  const generated = await generateNaturalLanguageSummary({
    apiKey: input.apiKey,
    model: input.model,
    privacy: digestAuthorization.allowed ? digestAuthorization : null,
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
    audit: { clientId: input.ownerId ?? null, operation: "knowledge_digest_synthesis", promptVersion: "knowledge-digest-v3" },
  });

  const publishable = digestAuthorization.allowed ? await stillAuthorized(digestAuthorization) : false;
  const generatedContent = publishable ? parseDigestContent(generated) : null;
  const generatorModel = input.model ?? "deepseek-v4-flash";
  let outcome: VerificationOutcome | null = null;
  if (generatedContent) {
    try {
      outcome = await verifyGeneratedContent({
        operation: "knowledge_digest_synthesis",
        clientId: input.ownerId ?? null,
        generatorModel,
        generatorPromptVersion: "knowledge-digest-v3",
        evidence: buildDigestEvidence({
          window: baseDigest.window,
          metrics: baseDigest.metrics,
          events: context.events,
        }),
        proposal: generatedContent,
        responseText: digestContentText(generatedContent),
        privacy: digestAuthorization.allowed ? digestAuthorization : null,
        apiKey: input.apiKey,
      });
    } catch (error) {
      // A verifier transport failure must not publish unverified prose or take
      // down the deterministic digest.
      console.error("digest_verification_failed", error instanceof Error ? error.message : String(error));
      outcome = null;
    }
  }
  // Verification is an external dispatch of its own: a revocation during it
  // must invalidate the candidate exactly like any other policy change.
  const stillPublishable = digestAuthorization.allowed
    ? await stillAuthorized(digestAuthorization)
    : false;
  const applied = applyDigestVerification({
    baseContent: baseDigest.content,
    candidateContent: stillPublishable ? generatedContent : null,
    generatorModel,
    outcome: stillPublishable ? outcome : null,
  });

  return {
    ...baseDigest,
    content: applied.content,
    highlights: applied.content.highlights,
    summary: applied.summary,
    model: applied.model,
    summaryAvailable: applied.summaryAvailable,
    ...(applied.verification ? { verification: applied.verification } : {}),
    lineage: {
      eventIds: [...new Set(context.events.map((event) => event.id))],
      sources: [...new Set(context.events.map((event) => event.source).filter((source): source is string => Boolean(source)))],
    },
  };
}
