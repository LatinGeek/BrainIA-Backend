import { pool } from "./postgres.js";
import { loadCanonicalEntityById } from "./entity-repository.js";
import {
  buildGraphTraversalCacheKey,
  readGraphTraversalCache,
  writeGraphTraversalCache,
} from "./graph-cache.js";

export type EntityGraph = {
  resolvedFromEntityId: string | null;
  rootEntity: {
    id: string;
    type: string;
    value: string;
    normalizedValue: string;
    metadata: Record<string, unknown>;
    createdAt: string;
  };
  depthRequested: number;
  depthReturned: number;
  stats: {
    nodesCount: number;
    relationsCount: number;
    maxDepthReached: number;
    truncated: boolean;
  };
  nodes: Array<{
    id: string;
    type: string;
    value: string;
    normalizedValue: string;
    metadata: Record<string, unknown>;
    createdAt: string;
    depth: number;
    rootDistance: number;
  }>;
  relations: Array<{
    id: string;
    sourceEntityId: string;
    targetEntityId: string;
    relationType: string;
    label: string;
    description: string;
    confidence: number;
    importanceScore: number;
    explanation: string;
    metadata: Record<string, unknown>;
    createdAt: string;
    depth: number;
    direction: "outgoing" | "incoming";
  }>;
  paths: Array<{
    nodeIds: string[];
    relationIds: string[];
    summary: string;
    depth: number;
    direction: "outgoing" | "incoming";
  }>;
};

type GraphNode = EntityGraph["nodes"][number];
type GraphRelation = EntityGraph["relations"][number];

export function buildGraphTraversalPaths(
  entityId: string,
  nodes: GraphNode[],
  relations: GraphRelation[],
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));

  return relations.map((relation) => {
    const source = nodeById.get(relation.sourceEntityId);
    const target = nodeById.get(relation.targetEntityId);

    return {
      nodeIds: [entityId, relation.sourceEntityId, relation.targetEntityId].filter(
        (value, index, array) => array.indexOf(value) === index,
      ),
      relationIds: [relation.id],
      summary: relation.explanation,
      depth: relation.depth,
      direction: relation.direction,
      importanceScore: relation.importanceScore,
      sourceLabel: source?.value ?? relation.sourceEntityId,
      targetLabel: target?.value ?? relation.targetEntityId,
    };
  });
}

function clampInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function parseGraphOptions(input: { depth?: string; maxNodes?: string; maxRelations?: string }) {
  return {
    depth: clampInteger(input.depth, 2, 1, 5),
    maxNodes: clampInteger(input.maxNodes, 100, 1, 500),
    maxRelations: clampInteger(input.maxRelations, 100, 1, 500),
  };
}

export async function getEntityGraph(entityId: string, depth: number, maxNodes: number, maxRelations: number): Promise<EntityGraph | null> {
  const canonicalRoot = await loadCanonicalEntityById(pool, entityId);
  if (!canonicalRoot) {
    return null;
  }

  const cacheKey = buildGraphTraversalCacheKey(canonicalRoot.id, depth, maxNodes, maxRelations);
  const cachedGraph = readGraphTraversalCache(cacheKey);
  if (cachedGraph) {
    return cachedGraph;
  }

  const rootResult = await pool.query(
    `
      select
        id,
        type,
        value,
        normalized_value as "normalizedValue",
        metadata,
        created_at as "createdAt"
      from entities
      where id = $1
      limit 1
    `,
    [canonicalRoot.id],
  );

  if (rootResult.rowCount === 0) {
    return null;
  }

  const graphResult = await pool.query(
    `
      with recursive walk as (
        select
          e.id,
          e.type,
          e.value,
          e.normalized_value,
          e.metadata,
          e.created_at,
          0 as depth
        from entities e
        where e.id = $1

        union

        select
          next_e.id,
          next_e.type,
          next_e.value,
          next_e.normalized_value,
          next_e.metadata,
          next_e.created_at,
          walk.depth + 1 as depth
        from walk
        join relations r
          on r.source_entity_id = walk.id or r.target_entity_id = walk.id
        join entities next_e
          on next_e.id = case
            when r.source_entity_id = walk.id then r.target_entity_id
            else r.source_entity_id
          end
        where walk.depth < $2
      )
      select distinct on (id)
        id,
        type,
        value,
        normalized_value as "normalizedValue",
        metadata,
        created_at as "createdAt",
        depth,
        depth as "rootDistance"
      from walk
      order by id, depth asc
    `,
    [canonicalRoot.id, depth],
  );

  const relationResult = await pool.query(
    `
      with recursive walk as (
        select
          e.id,
          0 as depth
        from entities e
        where e.id = $1

        union

        select
          next_e.id,
          walk.depth + 1 as depth
        from walk
        join relations r
          on r.source_entity_id = walk.id or r.target_entity_id = walk.id
        join entities next_e
          on next_e.id = case
            when r.source_entity_id = walk.id then r.target_entity_id
            else r.source_entity_id
          end
        where walk.depth < $2
      )
      select distinct on (r.id)
        r.id,
        r.source_entity_id as "sourceEntityId",
        r.target_entity_id as "targetEntityId",
        r.relation_type as "relationType",
        r.label,
        r.description,
        r.confidence,
        r.metadata,
        r.created_at as "createdAt",
        greatest(ws.depth, wt.depth) as depth,
        case
          when ws.depth <= wt.depth then 'outgoing'
          else 'incoming'
        end as direction
      from relations r
      join walk ws on ws.id = r.source_entity_id
      join walk wt on wt.id = r.target_entity_id
      order by r.id asc, r.confidence desc, depth asc
      limit $3
    `,
    [canonicalRoot.id, depth, maxRelations],
  );

  const nodes = graphResult.rows.slice(0, maxNodes);
  const relations = relationResult.rows.slice(0, maxRelations).map((relation: {
    id: string;
    sourceEntityId: string;
    targetEntityId: string;
    relationType: string;
    label: string;
    description: string;
    confidence: number;
    metadata: Record<string, unknown>;
    createdAt: string;
    depth: number;
    direction: "outgoing" | "incoming";
  }) => {
    const sourceNode = nodes.find((node: { id: string; value: string }) => node.id === relation.sourceEntityId);
    const targetNode = nodes.find((node: { id: string; value: string }) => node.id === relation.targetEntityId);
    const importanceScore = Number((relation.confidence / Math.max(1, relation.depth + 1)).toFixed(4));
    const explanation = `${sourceNode?.value ?? relation.sourceEntityId} ${relation.label} ${targetNode?.value ?? relation.targetEntityId}`;

    return {
      ...relation,
      importanceScore,
      explanation,
    };
  });
  const maxDepthReached = Math.max(
    0,
    ...nodes.map((node: { depth: number }) => node.depth),
    ...relations.map((relation: { depth: number }) => relation.depth),
  );

  const graph = {
    resolvedFromEntityId: canonicalRoot.id === entityId ? null : entityId,
    rootEntity: rootResult.rows[0],
    depthRequested: depth,
    depthReturned: maxDepthReached,
    stats: {
      nodesCount: nodes.length,
      relationsCount: relations.length,
      maxDepthReached,
      truncated: nodes.length >= maxNodes || relations.length >= maxRelations,
    },
    nodes,
    relations,
    paths: buildGraphTraversalPaths(canonicalRoot.id, nodes, relations),
  };

  writeGraphTraversalCache(cacheKey, graph);
  return graph;
}
