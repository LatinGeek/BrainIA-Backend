import { z } from "zod";

export const KNOWLEDGE_FACT_EXTRACTOR_VERSION = "knowledge-fact-v1";

export const knowledgeFactSchema = z.object({
  factType: z.string().min(1).max(80),
  value: z.unknown(),
  normalizedValue: z.string().min(1).max(1000),
  confidence: z.number().min(0).max(1),
  evidence: z.object({
    eventId: z.string().min(1),
    source: z.string().min(1),
    fields: z.array(z.string().min(1)).min(1),
  }).passthrough(),
  model: z.string().min(1).nullable().default(null),
  modelVersion: z.string().min(1).nullable().default(null),
  promptVersion: z.string().min(1).nullable().default(null),
  extractorVersion: z.string().min(1).default(KNOWLEDGE_FACT_EXTRACTOR_VERSION),
  visibility: z.enum(["visible", "private", "hidden"]).default("visible"),
});

export type KnowledgeFact = z.infer<typeof knowledgeFactSchema>;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function normalizeFactValue(value: unknown) {
  return canonicalJson(value).normalize("NFKC").trim().toLocaleLowerCase();
}

export function parseKnowledgeFact(input: unknown) {
  return knowledgeFactSchema.parse(input);
}

