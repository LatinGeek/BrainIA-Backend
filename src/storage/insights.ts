import { inspectKnowledge } from "./agent-inspect.js";
import { pool } from "./postgres.js";

export type InsightSnapshot = {
  query: string | null;
  resolution: {
    requestedEntityId: string | null;
    requestedQuery: string | null;
    matchedEntityId: string | null;
    canonicalEntityId: string | null;
    mode: string;
    explanation: string;
  };
  summary: string | null;
  graphSummary: {
    rootEntityId: string;
    resolvedFromEntityId: string | null;
    nodesCount: number;
    relationsCount: number;
    maxDepthReached: number;
    truncated: boolean;
    depthRequested: number;
    depthReturned: number;
    pathCount: number;
  } | null;
  graph?: {
    nodes: Array<{
      id: string;
      value: string;
      type: string;
    }>;
    relations: Array<{
      id: string;
      relationType: string;
      label: string;
      description: string;
      importanceScore: number;
    }>;
  } | null;
};

export type KnowledgeInsight = {
  query: string | null;
  resolution: {
    requestedEntityId: string | null;
    requestedQuery: string | null;
    matchedEntityId: string | null;
    canonicalEntityId: string | null;
    mode: string;
    explanation: string;
  };
  summary: string | null;
  takeaways: string[];
  graphSummary: {
    rootEntityId: string;
    resolvedFromEntityId: string | null;
    nodesCount: number;
    relationsCount: number;
    maxDepthReached: number;
    truncated: boolean;
    depthRequested: number;
    depthReturned: number;
    pathCount: number;
  } | null;
  supportingEntities: Array<{
    id: string;
    value: string;
    type: string;
  }>;
  supportingRelations: Array<{
    id: string;
    relationType: string;
    label: string;
    description: string;
    importanceScore: number;
  }>;
  model: string | null;
  summaryAvailable: boolean;
  /** Exact persisted lineage used for deletion invalidation; stripped from routes. */
  lineage?: {
    eventIds: string[];
    sources: string[];
  };
};

export function buildKnowledgeInsight(snapshot: InsightSnapshot): KnowledgeInsight {
  const supportingEntities = (snapshot.graph?.nodes ?? []).slice(0, 5).map((node) => ({
    id: node.id,
    value: node.value,
    type: node.type,
  }));

  const supportingRelations = (snapshot.graph?.relations ?? []).slice(0, 5).map((relation) => ({
    id: relation.id,
    relationType: relation.relationType,
    label: relation.label,
    description: relation.description,
    importanceScore: relation.importanceScore,
  }));

  const takeaways = [
    snapshot.summary ? snapshot.summary : "No natural-language summary was available.",
    snapshot.graphSummary
      ? `The graph expands to ${snapshot.graphSummary.nodesCount} nodes and ${snapshot.graphSummary.relationsCount} relations.`
      : "No graph expansion was available for the requested target.",
  ];

  return {
    query: snapshot.query,
    resolution: snapshot.resolution,
    summary: snapshot.summary,
    takeaways,
    graphSummary: snapshot.graphSummary,
    supportingEntities,
    supportingRelations,
    model: null,
    summaryAvailable: Boolean(snapshot.summary),
  };
}

export async function createKnowledgeInsight(input: {
  id?: string;
  q?: string;
  clientId?: string;
  depth?: number;
  maxNodes?: number;
  maxRelations?: number;
}) {
  const inspect = await inspectKnowledge({
    id: input.id,
    q: input.q,
    clientId: input.clientId,
    depth: input.depth ?? 2,
    maxNodes: input.maxNodes ?? 100,
    maxRelations: input.maxRelations ?? 100,
  });

  const insight = buildKnowledgeInsight({
    query: inspect.query,
    resolution: inspect.resolution,
    summary: inspect.summary,
    graphSummary: inspect.graphSummary,
    graph: inspect.graph,
  });

  const entityIds = [...new Set([
    inspect.resolution.canonicalEntityId,
    ...insight.supportingEntities.map((entity) => entity.id),
    ...(inspect.graph?.nodes.map((node) => node.id) ?? []),
  ].filter((id): id is string => Boolean(id)))];
  const lineageEvents = entityIds.length
    ? await pool.query<{ id: string; source: string | null }>(`
        with lineage as (
          select link.event_id from event_entities link where link.entity_id = any($1::text[])
          union
          select link.event_id from event_relations link
          join relations relation on relation.id = link.relation_id
          where relation.source_entity_id = any($1::text[]) or relation.target_entity_id = any($1::text[])
        )
        select distinct event.id, event.source
        from lineage
        join raw_events event on event.id = lineage.event_id
        where event.privacy_status <> 'hidden' and event.processing_allowed
          and ($2::text is null or coalesce(event.owner_id, event.client_id) = $2)
          and not exists (
            select 1 from deletion_tombstones tombstone
            where tombstone.target_type = 'event' and tombstone.target_id = event.id
          )
        order by event.id
      `, [entityIds, input.clientId ?? null])
    : { rows: [] as Array<{ id: string; source: string | null }> };
  const searchedEvents = (inspect as {
    searchResult?: { events?: Array<{ id: string; source?: string | null }> };
  }).searchResult?.events ?? [];
  const lineage = {
    eventIds: [...new Set([
      ...searchedEvents.map((event) => event.id),
      ...lineageEvents.rows.map((event) => event.id),
    ])],
    sources: [...new Set([
      ...searchedEvents.map((event) => event.source ?? null),
      ...lineageEvents.rows.map((event) => event.source),
    ].filter((source): source is string => Boolean(source)))],
  };

  return {
    ...insight,
    model: inspect.model,
    summaryAvailable: inspect.summaryAvailable,
    lineage,
  };
}
