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
    description: string;
    identitySource: string;
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
    description: string;
    identitySource: string;
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

export type ExploreGraph = {
  communities: Array<{ id: string; label: string; nodeCount: number; leaderEntityId: string }>;
  nodes: Array<{
    id: string;
    type: string;
    value: string;
    description: string;
    importanceScore: number;
    communityId: string;
    hierarchyDepth: number;
    eventId: string | null;
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
  }>;
  stats: { nodesCount: number; relationsCount: number; truncated: boolean };
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

export function parseExploreGraphOptions(input: { limit?: string; includeEvents?: string; includeEventEvidence?: string; from?: string; to?: string; eventKind?: string }) {
  return {
    limit: clampInteger(input.limit, 80, 10, 250),
    // Event instances are evidence, not overview concepts. The former
    // includeEvents flag is intentionally no longer enough to flood the map;
    // evidence expansion must be explicit and can be used by a detail view.
    includeEvents: input.includeEventEvidence === "true",
    from: input.from?.trim() || null,
    to: input.to?.trim() || null,
    eventKind: input.eventKind?.trim() || null,
  };
}

function assignCommunities(nodes: Array<{ id: string }>, relations: Array<{ sourceEntityId: string; targetEntityId: string }>) {
  const neighbors = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  for (const relation of relations) {
    neighbors.get(relation.sourceEntityId)?.add(relation.targetEntityId);
    neighbors.get(relation.targetEntityId)?.add(relation.sourceEntityId);
  }

  let labels = new Map(nodes.map((node) => [node.id, node.id]));
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const next = new Map(labels);
    for (const node of [...nodes].sort((left, right) => left.id.localeCompare(right.id))) {
      const counts = new Map<string, number>();
      for (const neighbor of neighbors.get(node.id) ?? []) {
        const label = labels.get(neighbor) ?? neighbor;
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      const winner = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
      if (winner) next.set(node.id, winner);
    }
    if ([...nodes].every((node) => labels.get(node.id) === next.get(node.id))) break;
    labels = next;
  }
  return labels;
}

function communityLabel(type: string, value: string) {
  const typeLabel = type.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
  const cleaned = value
    .replace(/[\[\]{}]/g, " ")
    .replace(/[^\p{L}\p{N}@.+\-\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter(Boolean).slice(0, 5).join(" ");
  const name = words.length > 42 ? `${words.slice(0, 39).trimEnd()}…` : words || "Untitled";
  return `${typeLabel} · ${name}`;
}

export async function getExploreGraph(options: ReturnType<typeof parseExploreGraphOptions>): Promise<ExploreGraph> {
  const entityResult = await pool.query<{
    id: string;
    type: string;
    value: string;
    description: string;
    importanceScore: number;
    eventId: string | null;
  }>(
    `
      with recursive visible_rooted(entity_id) as (
        select entity.id
        from entities entity
        left join entity_merges merged on merged.alias_entity_id = entity.id
        where entity.type = 'domain'
          and merged.alias_entity_id is null
          and entity.identity_source in ('ai', 'ai_seed', 'user')
          and length(btrim(entity.description)) > 0
        union
        select relation.source_entity_id
        from visible_rooted parent
        join relations relation on relation.target_entity_id = parent.entity_id
          and relation.relation_type in ('part_of', 'belongs_to_domain')
        join entities child on child.id = relation.source_entity_id
        left join entity_merges merged on merged.alias_entity_id = child.id
        where merged.alias_entity_id is null
          and child.type in ('domain', 'concept', 'app', 'merchant', 'sender', 'recipient', 'financial_event', 'email_message', 'activity_instance')
          and child.identity_source in ('ai', 'ai_seed', 'user')
          and length(btrim(child.description)) > 0
      )
      select
        e.id,
        e.type,
        e.value,
        e.description,
        case when e.type in ('financial_event', 'email_message', 'activity_instance') then e.metadata ->> 'eventId' else null end as "eventId",
        (count(r.id) + greatest(0, extract(epoch from now() - e.created_at) / -86400))::float as "importanceScore"
      from entities e
      left join entity_merges merged on merged.alias_entity_id = e.id
      left join relations r on (r.source_entity_id = e.id or r.target_entity_id = e.id)
        and r.relation_type in ('part_of', 'belongs_to_domain')
      where merged.alias_entity_id is null
        and (e.type in ('domain', 'concept', 'app', 'merchant', 'sender', 'recipient')
          or ($2::boolean and e.type in ('financial_event', 'email_message', 'activity_instance')))
        and e.identity_source in ('ai', 'ai_seed', 'user')
        and length(btrim(e.description)) > 0
        -- A node is present only when every hop to its domain is itself a
        -- displayable governed entity. This prevents evidence from appearing
        -- alone when its old parent is an extracted or legacy placeholder.
        and exists (select 1 from visible_rooted where visible_rooted.entity_id = e.id)
        and (e.type not in ('financial_event', 'email_message', 'activity_instance') or exists (
          select 1 from event_entities ee join raw_events event on event.id = ee.event_id
          left join classified_events classified on classified.raw_event_id = event.id
          where ee.entity_id = e.id
            and ($3::timestamptz is null or coalesce(event.timestamp, event.created_at) >= $3::timestamptz)
            and ($4::timestamptz is null or coalesce(event.timestamp, event.created_at) <= $4::timestamptz)
            and ($5::text is null or classified.inferred_kind = $5 or event.kind = $5)
        ))
      group by e.id
      order by
        case when e.type = 'domain' then 0 when e.type = 'concept' then 1 when e.type in ('financial_event', 'email_message', 'activity_instance') then 3 else 2 end,
        count(r.id) desc, e.created_at desc, e.id asc
      limit $1
    `,
    [options.limit, options.includeEvents, options.from, options.to, options.eventKind],
  );
  const selectedIds = entityResult.rows.map((node) => node.id);
  if (!selectedIds.length) return { communities: [], nodes: [], relations: [], stats: { nodesCount: 0, relationsCount: 0, truncated: false } };

  // The initial ranking is intentionally capped, but a cap must never sever a
  // visible node from its semantic lineage. This is most noticeable when
  // evidence is enabled: event instances are numerous and could otherwise win
  // a slot while their canonical meaning or domain is omitted from the map.
  const lineageResult = await pool.query<typeof entityResult.rows[number]>(`
    with recursive lineage(id) as (
      select unnest($1::text[])
      union
      select relation.target_entity_id
      from lineage child
      join relations relation on relation.source_entity_id = child.id
      join entities parent on parent.id = relation.target_entity_id
      left join entity_merges merged on merged.alias_entity_id = parent.id
      where relation.relation_type in ('part_of', 'belongs_to_domain')
        and merged.alias_entity_id is null
        and parent.type in ('domain', 'concept', 'app', 'merchant', 'sender', 'recipient', 'financial_event', 'email_message', 'activity_instance')
        and parent.identity_source in ('ai', 'ai_seed', 'user')
        and length(btrim(parent.description)) > 0
    )
    select e.id, e.type, e.value, e.description,
      case when e.type in ('financial_event', 'email_message', 'activity_instance') then e.metadata ->> 'eventId' else null end as "eventId",
      (count(relation.id) + greatest(0, extract(epoch from now() - e.created_at) / -86400))::float as "importanceScore"
    from entities e
    left join entity_merges merged on merged.alias_entity_id = e.id
    left join relations relation on (relation.source_entity_id = e.id or relation.target_entity_id = e.id)
      and relation.relation_type in ('part_of', 'belongs_to_domain')
    where e.id in (select id from lineage)
      and merged.alias_entity_id is null
      and e.type in ('domain', 'concept', 'app', 'merchant', 'sender', 'recipient', 'financial_event', 'email_message', 'activity_instance')
      and e.identity_source in ('ai', 'ai_seed', 'user')
      and length(btrim(e.description)) > 0
    group by e.id
  `, [selectedIds]);
  const entityRows = [...new Map([...entityResult.rows, ...lineageResult.rows].map((node) => [node.id, node])).values()];
  const graphEntityIds = entityRows.map((node) => node.id);

  const domainResult = await pool.query<{ entityId: string; domainId: string; domainValue: string; hierarchyDepth: number }>(`
    with recursive domain_paths(entity_id, domain_id, domain_value, hierarchy_depth) as (
      select id, id, value, 0 from entities where type = 'domain'
      union all
      select relation.source_entity_id, parent.domain_id, parent.domain_value, parent.hierarchy_depth + 1
      from domain_paths parent join relations relation on relation.target_entity_id = parent.entity_id
      where relation.relation_type in ('part_of', 'belongs_to_domain') and parent.hierarchy_depth < 20
    )
    select distinct on (entity_id)
      entity_id as "entityId", domain_id as "domainId", domain_value as "domainValue", hierarchy_depth as "hierarchyDepth"
    from domain_paths
    where entity_id = any($1::text[])
    order by entity_id, hierarchy_depth asc, domain_value
  `, [graphEntityIds]);
  const semanticDomains = new Map(domainResult.rows.map((row) => [row.entityId, row]));
  const relationResult = await pool.query<ExploreGraph["relations"][number]>(
    `
      select r.id, r.source_entity_id as "sourceEntityId", r.target_entity_id as "targetEntityId",
        r.relation_type as "relationType", r.label, r.description, r.confidence,
        r.confidence::float as "importanceScore"
      from relations r
      where r.source_entity_id = any($1::text[]) and r.target_entity_id = any($1::text[])
      order by r.confidence desc, r.created_at desc, r.id asc
    `,
    [graphEntityIds],
  );
  // The overview is a hierarchy with sparse bridges between life domains.
  // Same-domain associations remain available in entity details, where their
  // meaning and direction can be inspected without looking like extra parents.
  const visibleRelations = relationResult.rows.filter((relation) => {
    if (["part_of", "belongs_to_domain"].includes(relation.relationType)) return true;
    const sourceDomain = semanticDomains.get(relation.sourceEntityId)?.domainId;
    const targetDomain = semanticDomains.get(relation.targetEntityId)?.domainId;
    return Boolean(sourceDomain && targetDomain && sourceDomain !== targetDomain);
  });
  const labels = assignCommunities(entityRows, visibleRelations);
  const grouped = new Map<string, typeof entityResult.rows>();
  for (const node of entityRows) {
    const communityId = semanticDomains.get(node.id)?.domainId ?? labels.get(node.id) ?? node.id;
    grouped.set(communityId, [...(grouped.get(communityId) ?? []), node]);
  }
  const communities = [...grouped.entries()]
    .map(([id, members]) => {
      const leader = members.find((member) => member.id === id)
        ?? [...members].sort((left, right) => right.importanceScore - left.importanceScore || left.value.localeCompare(right.value))[0];
      const domain = semanticDomains.get(members[0].id);
      return { id, label: domain?.domainValue ?? communityLabel(leader.type, leader.value), nodeCount: members.length, leaderEntityId: leader.id };
    })
    .sort((left, right) => right.nodeCount - left.nodeCount || left.label.localeCompare(right.label));
  return {
    communities,
    nodes: entityRows.map((node) => ({
      ...node,
      communityId: semanticDomains.get(node.id)?.domainId ?? labels.get(node.id) ?? node.id,
      hierarchyDepth: semanticDomains.get(node.id)?.hierarchyDepth ?? 0,
    })),
    relations: visibleRelations,
    stats: { nodesCount: entityRows.length, relationsCount: visibleRelations.length, truncated: entityResult.rows.length >= options.limit },
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
        description,
        identity_source as "identitySource",
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
          e.description,
          e.identity_source,
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
          next_e.description,
          next_e.identity_source,
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
        description,
        identity_source as "identitySource",
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
