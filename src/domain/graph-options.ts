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

export function parseExploreGraphOptions(input: { limit?: string; includeEvents?: string; includeEventEvidence?: string; includeIdentities?: string; from?: string; to?: string; eventKind?: string; projection?: string; root?: string; depth?: string }) {
  return {
    limit: clampInteger(input.limit, 80, 10, 250),
    includeEvents: input.includeEventEvidence === "true",
    from: input.from?.trim() || null,
    to: input.to?.trim() || null,
    eventKind: input.eventKind?.trim() || null,
    projection: input.projection === "taxonomy" ? "taxonomy" as const : "network" as const,
    root: input.root?.trim() || null,
    depth: clampInteger(input.depth, 2, 1, 4),
    includeIdentities: input.includeIdentities === "true",
  };
}

export function allocateExploreGraphSlots(limit: number, includeEventEvidence: boolean) {
  if (!includeEventEvidence) return { knowledgeLimit: limit, evidenceLimit: 0 };
  const evidenceLimit = Math.min(20, Math.max(5, Math.floor(limit * 0.25)));
  return { knowledgeLimit: limit - evidenceLimit, evidenceLimit };
}
