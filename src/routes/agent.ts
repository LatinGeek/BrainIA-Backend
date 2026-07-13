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
        rootEntity: { type: ["object", "null"] },
        graph: { type: ["object", "null"] },
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
          rootEntity: { id: "entity_1", type: "merchant", value: "Spotify" },
          graph: {},
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
        kind: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        timestamp: { type: "string", format: "date-time" },
        externalId: { type: "string" },
        raw: { type: "object" },
        tags: { type: "array", items: { type: "string" } },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        source: { type: "string" },
        kind: { type: "string" },
        inferredKind: { type: "string" },
        confidence: { type: "number" },
      },
    },
    examples: [
      {
        input: {
          id: "evt_123",
          source: "tasker",
          kind: "notification",
          title: "Compra en supermercado",
          body: "Visa $12.40",
          timestamp: "2026-07-13T12:00:00.000Z",
          raw: { packageName: "com.example.wallet" },
          tags: ["expense", "mobile"],
        },
        output: {
          id: "evt_123",
          source: "tasker",
          kind: "notification",
          inferredKind: "expense",
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
    name: "search_knowledge",
    description: "Textually search across events, entities, and relations.",
    method: "GET",
    path: "/api/v1/search",
    inputSchema: {
      type: "object",
      required: ["q"],
      properties: {
        q: { type: "string" },
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

export const registerAgentRoutes: FastifyPluginAsync = async (app) => {
  app.get("/agent/tools", async () => ({
    mode: "agent-first",
    protocol: "mcp-like",
    tools,
  }));

  app.get("/agent/mcp", async () => ({
    protocol: "mcp-like",
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      examples: tool.examples,
      expectedErrors: tool.expectedErrors,
    })),
  }));
};
