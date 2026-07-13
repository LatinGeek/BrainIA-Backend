import type { FastifyPluginAsync } from "fastify";

type ToolManifest = {
  name: string;
  description: string;
  method: "GET" | "POST";
  path: string;
  inputSchema: unknown;
  outputSchema: unknown;
  examples: Array<{
    input: unknown;
    output: unknown;
  }>;
  expectedErrors: Array<{
    code: string;
    description: string;
  }>;
};

const tools: ToolManifest[] = [
  {
    name: "inspect_knowledge",
    description: "Resolve, expand, and summarize a knowledge target in one request.",
    method: "GET",
    path: "/api/v1/agent/inspect",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        q: { type: "string" },
        depth: { type: "number", minimum: 1, maximum: 5, default: 2 },
        maxNodes: { type: "number", minimum: 1, maximum: 500, default: 100 },
        maxRelations: { type: "number", minimum: 1, maximum: 500, default: 100 },
      },
      oneOf: [{ required: ["id"] }, { required: ["q"] }],
    },
    outputSchema: {
      type: "object",
      properties: {
        query: { type: ["string", "null"] },
        resolution: {
          type: "object",
          properties: {
            requestedEntityId: { type: ["string", "null"] },
            requestedQuery: { type: ["string", "null"] },
            matchedEntityId: { type: ["string", "null"] },
            canonicalEntityId: { type: ["string", "null"] },
            mode: { type: "string" },
            explanation: { type: "string" },
          },
        },
        rootEntity: { type: ["object", "null"] },
        graph: { type: ["object", "null"] },
        graphSummary: { type: ["object", "null"] },
        searchResult: { type: "object" },
        summary: { type: ["string", "null"] },
        model: { type: ["string", "null"] },
        summaryAvailable: { type: "boolean" },
      },
    },
    examples: [
      {
        input: {
          q: "spotify",
          depth: 2,
          maxNodes: 100,
          maxRelations: 100,
        },
        output: {
          query: "spotify",
          resolution: {
            requestedEntityId: null,
            requestedQuery: "spotify",
            matchedEntityId: "entity_1",
            canonicalEntityId: "entity_1",
            mode: "search_match",
            explanation: "The query matched a canonical entity through textual retrieval.",
          },
          rootEntity: { id: "entity_1", type: "merchant", value: "Spotify" },
          graph: {},
          graphSummary: {
            rootEntityId: "entity_1",
            resolvedFromEntityId: null,
            nodesCount: 1,
            relationsCount: 0,
            maxDepthReached: 0,
            truncated: false,
            depthRequested: 2,
            depthReturned: 2,
            pathCount: 0,
          },
          searchResult: {},
          summary: "Spotify appears as a merchant connected to several expense events.",
          model: "deepseek-v4-flash",
          summaryAvailable: true,
        },
      },
    ],
    expectedErrors: [
      {
        code: "invalid_inspect_query",
        description: "The query must include either id or q.",
      },
    ],
  },
  {
    name: "generate_insight",
    description: "Generate a structured insight from a knowledge target with takeaways and supporting evidence.",
    method: "GET",
    path: "/api/v1/insights",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        q: { type: "string" },
        depth: { type: "number", minimum: 1, maximum: 5, default: 2 },
        maxNodes: { type: "number", minimum: 1, maximum: 500, default: 100 },
        maxRelations: { type: "number", minimum: 1, maximum: 500, default: 100 },
      },
      oneOf: [{ required: ["id"] }, { required: ["q"] }],
    },
    outputSchema: {
      type: "object",
      properties: {
        query: { type: ["string", "null"] },
        resolution: { type: "object" },
        summary: { type: ["string", "null"] },
        takeaways: { type: "array" },
        graphSummary: { type: ["object", "null"] },
        supportingEntities: { type: "array" },
        supportingRelations: { type: "array" },
        model: { type: ["string", "null"] },
        summaryAvailable: { type: "boolean" },
        audit: {
          type: ["object", "null"],
          properties: {
            id: { type: "string" },
            createdAt: { type: "string" },
            model: { type: ["string", "null"] },
            toolName: { type: "string" },
          },
        },
      },
    },
    examples: [
      {
        input: {
          q: "spotify",
          depth: 2,
          maxNodes: 100,
          maxRelations: 100,
        },
        output: {
          query: "spotify",
          resolution: {
            requestedEntityId: null,
            requestedQuery: "spotify",
            matchedEntityId: "entity_1",
            canonicalEntityId: "entity_1",
            mode: "search_match",
            explanation: "The query matched a canonical entity through textual retrieval.",
          },
          summary: "Spotify is a merchant entity linked to expense activity.",
          takeaways: [
            "Spotify is a merchant entity linked to expense activity.",
            "The graph expands to 3 nodes and 2 relations.",
          ],
          graphSummary: {
            rootEntityId: "entity_1",
            resolvedFromEntityId: null,
            nodesCount: 3,
            relationsCount: 2,
            maxDepthReached: 1,
            truncated: false,
            depthRequested: 2,
            depthReturned: 1,
            pathCount: 2,
          },
          supportingEntities: [],
          supportingRelations: [],
          model: "deepseek-v4-flash",
          summaryAvailable: true,
          audit: {
            id: "insight_1",
            createdAt: "2026-07-13T12:05:00.000Z",
            model: "deepseek-v4-flash",
            toolName: "generate_insight",
          },
        },
      },
    ],
    expectedErrors: [
      {
        code: "invalid_insight_query",
        description: "The query must include either id or q.",
      },
    ],
  },
  {
    name: "list_insight_runs",
    description: "List stored insight generations and their audit snapshots.",
    method: "GET",
    path: "/api/v1/insights/history",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", minimum: 1, maximum: 100, default: 25 },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
        count: { type: "number" },
        runs: { type: "array" },
      },
    },
    examples: [
      {
        input: {
          limit: 25,
        },
        output: {
          limit: 25,
          count: 1,
          runs: [
            {
              id: "insight_1",
              toolName: "generate_insight",
              query: "spotify",
              summary: "Spotify is a merchant entity linked to expense activity.",
              model: "deepseek-v4-flash",
              createdAt: "2026-07-13T12:05:00.000Z",
              request: {
                id: null,
                q: "spotify",
                depth: 2,
                maxNodes: 100,
                maxRelations: 100,
              },
              response: {},
            },
          ],
        },
      },
    ],
    expectedErrors: [],
  },
  {
    name: "get_insight_run",
    description: "Load one stored insight generation by id, including its request and response snapshot.",
    method: "GET",
    path: "/api/v1/insights/history/:id",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        toolName: { type: "string" },
        query: { type: ["string", "null"] },
        request: { type: "object" },
        response: { type: "object" },
        summary: { type: ["string", "null"] },
        model: { type: ["string", "null"] },
        createdAt: { type: "string" },
      },
    },
    examples: [
      {
        input: {
          id: "insight_1",
        },
        output: {
          id: "insight_1",
          toolName: "generate_insight",
          query: "spotify",
          request: {
            id: null,
            q: "spotify",
            depth: 2,
            maxNodes: 100,
            maxRelations: 100,
          },
          response: {},
          summary: "Spotify is a merchant entity linked to expense activity.",
          model: "deepseek-v4-flash",
          createdAt: "2026-07-13T12:05:00.000Z",
        },
      },
    ],
    expectedErrors: [
      {
        code: "insight_run_not_found",
        description: "No stored insight run matches the provided id.",
      },
    ],
  },
  {
    name: "generate_digest",
    description: "Generate a time-window digest over recent events, related insights, and aggregate metrics.",
    method: "GET",
    path: "/api/v1/digests",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", format: "date-time" },
        to: { type: "string", format: "date-time" },
        days: { type: "number", minimum: 1, maximum: 365, default: 7 },
        source: { type: "string" },
        kind: { type: "string" },
        eventLimit: { type: "number", minimum: 1, maximum: 500, default: 100 },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        scope: { type: "string" },
        window: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
          },
        },
        filters: {
          type: "object",
          properties: {
            source: { type: ["string", "null"] },
            kind: { type: ["string", "null"] },
          },
        },
        metrics: {
          type: "object",
          properties: {
            totalEvents: { type: "number" },
            classifiedEvents: { type: "number" },
            uniqueEntities: { type: "number" },
            uniqueRelations: { type: "number" },
            eventsBySource: { type: "array" },
            eventsByKind: { type: "array" },
            eventsByInferredKind: { type: "array" },
          },
        },
        recentEvents: { type: "array" },
        relatedInsights: { type: "array" },
        highlights: { type: "array" },
        summary: { type: ["string", "null"] },
        model: { type: ["string", "null"] },
        summaryAvailable: { type: "boolean" },
        audit: {
          type: ["object", "null"],
          properties: {
            id: { type: "string" },
            createdAt: { type: "string" },
            model: { type: ["string", "null"] },
            toolName: { type: "string" },
          },
        },
      },
    },
    examples: [
      {
        input: {
          days: 7,
          source: "tasker",
          eventLimit: 50,
        },
        output: {
          scope: "window 2026-07-06T00:00:00.000Z -> 2026-07-13T00:00:00.000Z, source=tasker",
          window: {
            from: "2026-07-06T00:00:00.000Z",
            to: "2026-07-13T00:00:00.000Z",
          },
          filters: {
            source: "tasker",
            kind: null,
          },
          metrics: {
            totalEvents: 12,
            classifiedEvents: 12,
            uniqueEntities: 8,
            uniqueRelations: 4,
            eventsBySource: [{ source: "tasker", count: 12 }],
            eventsByKind: [{ kind: "notification", count: 9 }],
            eventsByInferredKind: [{ kind: "expense", count: 5 }],
          },
          recentEvents: [],
          relatedInsights: [],
          highlights: [
            "Captured 12 events between 2026-07-06T00:00:00.000Z and 2026-07-13T00:00:00.000Z.",
            "Most active source: tasker (12).",
          ],
          summary: "Tasker produced 12 events in the requested window.",
          model: "deepseek-v4-flash",
          summaryAvailable: true,
          audit: {
            id: "digest_1",
            createdAt: "2026-07-13T12:20:00.000Z",
            model: "deepseek-v4-flash",
            toolName: "generate_digest",
          },
        },
      },
    ],
    expectedErrors: [
      {
        code: "invalid_digest_query",
        description: "The digest query is missing required format constraints.",
      },
      {
        code: "invalid_digest_window",
        description: "The from timestamp must be before or equal to the to timestamp.",
      },
    ],
  },
  {
    name: "list_digest_runs",
    description: "List stored digest generations and their audit snapshots.",
    method: "GET",
    path: "/api/v1/digests/history",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", minimum: 1, maximum: 100, default: 25 },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
        count: { type: "number" },
        runs: { type: "array" },
      },
    },
    examples: [
      {
        input: {
          limit: 25,
        },
        output: {
          limit: 25,
          count: 1,
          runs: [
            {
              id: "digest_1",
              toolName: "generate_digest",
              scope: "window 2026-07-06T00:00:00.000Z -> 2026-07-13T00:00:00.000Z",
              windowFrom: "2026-07-06T00:00:00.000Z",
              windowTo: "2026-07-13T00:00:00.000Z",
              summary: "Tasker produced 12 events in the requested window.",
              model: "deepseek-v4-flash",
              createdAt: "2026-07-13T12:20:00.000Z",
              request: {},
              response: {},
            },
          ],
        },
      },
    ],
    expectedErrors: [],
  },
  {
    name: "get_digest_run",
    description: "Load one stored digest generation by id, including its request and response snapshot.",
    method: "GET",
    path: "/api/v1/digests/history/:id",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        toolName: { type: "string" },
        scope: { type: ["string", "null"] },
        windowFrom: { type: ["string", "null"] },
        windowTo: { type: ["string", "null"] },
        request: { type: "object" },
        response: { type: "object" },
        summary: { type: ["string", "null"] },
        model: { type: ["string", "null"] },
        createdAt: { type: "string" },
      },
    },
    examples: [
      {
        input: {
          id: "digest_1",
        },
        output: {
          id: "digest_1",
          toolName: "generate_digest",
          scope: "window 2026-07-06T00:00:00.000Z -> 2026-07-13T00:00:00.000Z",
          windowFrom: "2026-07-06T00:00:00.000Z",
          windowTo: "2026-07-13T00:00:00.000Z",
          request: {},
          response: {},
          summary: "Tasker produced 12 events in the requested window.",
          model: "deepseek-v4-flash",
          createdAt: "2026-07-13T12:20:00.000Z",
        },
      },
    ],
    expectedErrors: [
      {
        code: "digest_run_not_found",
        description: "No stored digest run matches the provided id.",
      },
    ],
  },
  {
    name: "resolve_entity",
    description: "Resolve a canonical entity from an id or search hint and return merge-aware matches.",
    method: "GET",
    path: "/api/v1/entities/resolve",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        q: { type: "string" },
      },
      oneOf: [{ required: ["id"] }, { required: ["q"] }],
    },
    outputSchema: {
      type: "object",
      properties: {
        matches: { type: "array" },
      },
    },
    examples: [
      {
        input: {
          q: "spotify",
        },
        output: {
          matches: [
            {
              id: "entity_1",
              matchedEntityId: "entity_4",
              canonicalEntityId: "entity_1",
              isCanonical: true,
            },
          ],
        },
      },
    ],
    expectedErrors: [
      {
        code: "invalid_entity_query",
        description: "The query must include either id or q.",
      },
    ],
  },
  {
    name: "merge_entity",
    description: "Merge an alias entity into a canonical root and materialize a same_as relation.",
    method: "POST",
    path: "/api/v1/entities/:id/merge",
    inputSchema: {
      type: "object",
      required: ["canonicalEntityId"],
      properties: {
        canonicalEntityId: { type: "string" },
        reason: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 1, default: 1 },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        aliasEntityId: { type: "string" },
        canonicalEntityId: { type: "string" },
        reason: { type: "string" },
        confidence: { type: "number" },
        alreadyMerged: { type: "boolean" },
        sameAsRelation: { type: ["object", "null"] },
      },
    },
    examples: [
      {
        input: {
          canonicalEntityId: "entity_1",
          reason: "manual cleanup",
        },
        output: {
          aliasEntityId: "entity_4",
          canonicalEntityId: "entity_1",
          reason: "manual cleanup",
          confidence: 1,
          alreadyMerged: false,
          sameAsRelation: {},
        },
      },
    ],
    expectedErrors: [
      {
        code: "entity_not_found",
        description: "Both entities must exist before they can be merged.",
      },
    ],
  },
  {
    name: "ingest_event",
    description: "Store a generic event, classify it, extract entities and relations, and persist the result.",
    method: "POST",
    path: "/api/v1/events",
    inputSchema: {
      type: "object",
      required: ["id", "source"],
      properties: {
        id: { type: "string" },
        source: { type: "string" },
        contractVersion: { type: "number", minimum: 1, default: 1 },
        kind: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        timestamp: { type: "string", format: "date-time" },
        externalId: { type: "string" },
        idempotencyKey: { type: "string" },
        raw: { type: "object" },
        tags: { type: "array", items: { type: "string" } },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        source: { type: "string" },
        contractVersion: { type: "number" },
        kind: { type: "string" },
        inferredKind: { type: "string" },
        classificationVersion: { type: "string" },
        confidence: { type: "number" },
      },
    },
    examples: [
      {
        input: {
          id: "evt_123",
          source: "tasker",
          contractVersion: 1,
          kind: "notification",
          title: "Compra en supermercado",
          body: "Visa $12.40",
          timestamp: "2026-07-13T12:00:00.000Z",
          raw: { packageName: "com.example.wallet" },
          idempotencyKey: "notif-abc-123",
          tags: ["expense", "mobile"],
        },
        output: {
          id: "evt_123",
          source: "tasker",
          contractVersion: 1,
          kind: "notification",
          inferredKind: "expense",
          classificationVersion: "heuristic-v1",
          confidence: 0.9,
        },
      },
    ],
    expectedErrors: [
      {
        code: "invalid_event",
        description: "The event payload is missing required fields or does not match the contract.",
      },
    ],
  },
  {
    name: "reprocess_event",
    description: "Rebuild the derived knowledge for a stored event using the current heuristics.",
    method: "POST",
    path: "/api/v1/events/:id/reprocess",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        source: { type: "string" },
        inferredKind: { type: "string" },
        classificationVersion: { type: "string" },
      },
    },
    examples: [
      {
        input: {
          id: "evt_123",
        },
        output: {
          id: "evt_123",
          source: "tasker",
          inferredKind: "expense",
          classificationVersion: "heuristic-v1",
        },
      },
    ],
    expectedErrors: [
      {
        code: "event_not_found",
        description: "The stored event id does not exist.",
      },
    ],
  },
  {
    name: "list_events",
    description: "List stored events in append order.",
    method: "GET",
    path: "/api/v1/events",
    inputSchema: {
      type: "null",
    },
    outputSchema: {
      type: "array",
    },
    examples: [
      {
        input: {},
        output: [],
      },
    ],
    expectedErrors: [],
  },
  {
    name: "view_metrics",
    description: "Inspect the current storage and knowledge counts for basic observability.",
    method: "GET",
    path: "/api/v1/metrics",
    inputSchema: {
      type: "null",
    },
    outputSchema: {
      type: "object",
      properties: {
        rawEventsCount: { type: "number" },
        classifiedEventsCount: { type: "number" },
        entitiesCount: { type: "number" },
        relationsCount: { type: "number" },
        eventEntitiesCount: { type: "number" },
        eventRelationsCount: { type: "number" },
      },
    },
    examples: [
      {
        input: {},
        output: {
          rawEventsCount: 10,
          classifiedEventsCount: 10,
          entitiesCount: 24,
          relationsCount: 11,
          eventEntitiesCount: 34,
          eventRelationsCount: 11,
        },
      },
    ],
    expectedErrors: [],
  },
  {
    name: "search_knowledge",
    description: "Textually search across events, entities, and relations.",
    method: "GET",
    path: "/api/v1/search",
    inputSchema: {
      type: "object",
      required: ["q"],
      properties: {
        q: { type: "string" },
        source: { type: "string" },
        kind: { type: "string" },
        from: { type: "string", format: "date-time" },
        to: { type: "string", format: "date-time" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        events: { type: "array" },
        entities: { type: "array" },
        relations: { type: "array" },
      },
    },
    examples: [
      {
        input: {
          q: "spotify",
        },
        output: {
          events: [],
          entities: [],
          relations: [],
        },
      },
    ],
    expectedErrors: [
      {
        code: "invalid_search_query",
        description: "The q query parameter is missing or empty.",
      },
    ],
  },
];

function toMcpToolManifest(tool: ToolManifest) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    examples: tool.examples,
    expectedErrors: tool.expectedErrors,
  };
}

function buildMcpError(id: unknown, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message,
      data,
    },
  };
}

export const registerAgentRoutes: FastifyPluginAsync = async (app) => {
  app.get("/agent/tools", async () => ({
    mode: "agent-first",
    protocol: "mcp-like",
    tools,
  }));

  app.get("/agent/mcp", async () => ({
    protocol: "mcp-like",
    tools: tools.map(toMcpToolManifest),
  }));

  app.post("/agent/mcp", async (request, reply) => {
    const body = request.body as {
      jsonrpc?: string;
      id?: string | number | null;
      method?: string;
      params?: {
        cursor?: string;
      };
    } | null;

    if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
      return reply.status(400).send(buildMcpError(null, -32600, "Invalid Request"));
    }

    if (body.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id: body.id ?? null,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: {
            name: "BrainIA",
            version: "0.1.0",
          },
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
        },
      };
    }

    if (body.method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id: body.id ?? null,
        result: {
          tools: tools.map(toMcpToolManifest),
          nextCursor: body.params?.cursor ?? null,
        },
      };
    }

    return reply.status(400).send(
      buildMcpError(body.id ?? null, -32601, "Method not found", {
        method: body.method,
      }),
    );
  });
};
