import { inspectKnowledge } from "./agent-inspect.js";

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
  depth?: number;
  maxNodes?: number;
  maxRelations?: number;
}) {
  const inspect = await inspectKnowledge({
    id: input.id,
    q: input.q,
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

  return {
    ...insight,
    model: inspect.model,
    summaryAvailable: inspect.summaryAvailable,
  };
}
