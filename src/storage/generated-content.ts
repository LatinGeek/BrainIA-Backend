import { z } from "zod";

const conciseText = (max: number) => z.string().trim().min(1).max(max);

const contentCardSchema = z.object({
  title: conciseText(90),
  summary: conciseText(240),
  recommendedAction: conciseText(180).nullable(),
}).strict();

export const insightContentSchema = z.object({
  version: z.literal(3).default(3),
  title: conciseText(90),
  summary: conciseText(320),
  whyItMatters: conciseText(240),
  takeaways: z.array(conciseText(180)).min(1).max(3),
  recommendedAction: conciseText(180).nullable(),
  cards: z.array(contentCardSchema).min(1).max(3),
}).strict();

export const digestContentSchema = z.object({
  version: z.literal(3).default(3),
  title: conciseText(90),
  summary: conciseText(320),
  highlights: z.array(conciseText(180)).min(1).max(4),
  recommendedAction: conciseText(180).nullable(),
  cards: z.array(contentCardSchema).min(1).max(4),
}).strict();

export type StructuredInsightContent = z.infer<typeof insightContentSchema>;
export type StructuredDigestContent = z.infer<typeof digestContentSchema>;

function extractJson(value: string) {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

export function parseInsightContent(value: string | null | undefined) {
  if (!value) return null;
  try {
    return insightContentSchema.safeParse(JSON.parse(extractJson(value))).data ?? null;
  } catch {
    return null;
  }
}

export function parseDigestContent(value: string | null | undefined) {
  if (!value) return null;
  try {
    return digestContentSchema.safeParse(JSON.parse(extractJson(value))).data ?? null;
  } catch {
    return null;
  }
}

export type InsightContentCandidate = {
  title: string;
  explanation: string;
  severity: string;
  suggestedAction?: string | null;
};

export function buildInsightContent(candidates: InsightContentCandidate[]): StructuredInsightContent {
  const primary = candidates[0]!;
  return {
    version: 3,
    title: primary.title.slice(0, 90),
    summary: primary.explanation.slice(0, 320),
    whyItMatters: primary.severity === "high"
      ? "This change is large enough to deserve a closer look."
      : "This change may help you notice a useful pattern early.",
    takeaways: candidates.slice(0, 3).map((candidate) => candidate.title.slice(0, 180)),
    recommendedAction: primary.suggestedAction?.slice(0, 180) ?? null,
    cards: candidates.slice(0, 3).map((candidate) => ({
      title: candidate.title.slice(0, 90),
      summary: candidate.explanation.slice(0, 240),
      recommendedAction: candidate.suggestedAction?.slice(0, 180) ?? null,
    })),
  };
}

export function buildDigestContent(input: {
  totalEvents: number;
  topSource?: { source: string; count: number };
  topKind?: { kind: string; count: number };
  highlights: string[];
}): StructuredDigestContent {
  const activity = input.totalEvents === 0
    ? "No new activity was captured in this period."
    : `${input.totalEvents} ${input.totalEvents === 1 ? "item was" : "items were"} captured in this period.`;
  const highlights = [
    input.topSource ? `${input.topSource.source} was the most active source with ${input.topSource.count} items.` : null,
    input.topKind ? `${input.topKind.kind} was the most common activity type.` : null,
    ...input.highlights.filter((value) => !/\d{4}-\d{2}-\d{2}T/.test(value) && value.length <= 180).slice(1, 2),
  ].filter((value): value is string => Boolean(value)).slice(0, 4);

  return {
    version: 3,
    title: "Your activity digest",
    summary: activity,
    highlights: highlights.length ? highlights.map((value) => value.slice(0, 180)) : [activity],
    recommendedAction: input.totalEvents ? "Open the activity that matters most and review its context." : null,
    cards: (highlights.length ? highlights : [activity]).map((summary, index) => ({
      title: index === 0 ? "Activity at a glance" : "Worth noticing",
      summary: summary.slice(0, 240),
      recommendedAction: index === 0 && input.totalEvents ? "Open the activity that matters most and review its context." : null,
    })),
  };
}

export const INSIGHT_JSON_PROMPT = `Return one JSON object with exactly these fields: version (always 3), title, summary, whyItMatters, takeaways, recommendedAction, cards. This is a decision brief, not an event log: include only changes that matter, state the practical implication, and omit routine notification counts unless they imply a concrete decision. title <= 60 characters and must not repeat summary. summary is one concise plain-language sentence <= 160 characters. whyItMatters is one concise sentence <= 160 characters. takeaways is 1-3 distinct strings <= 120 characters each. recommendedAction is one specific string <= 120 characters or null. cards is 1-3 distinct objects, each with exactly title, summary, recommendedAction; every card title <= 60 characters, summary is one concise sentence <= 160 characters, and recommendedAction is <= 120 characters or null. Make each card independently useful and supported by one supplied candidate; do not combine multiple candidates into one card. Do not use Markdown, bullets, IDs, timestamps, raw field names, event-by-event recaps, or repeat information. Preserve uncertainty and use only supplied evidence.`;

export const DIGEST_JSON_PROMPT = `Return one JSON object with exactly these fields: version (always 3), title, summary, highlights, recommendedAction, cards. Write a calm, concise decision brief rather than an inventory of events. Prioritize money changes, unresolved review work, and meaningful changes; treat routine notifications and source volume as background unless they require attention. title <= 60 characters and must not repeat summary. summary is one concise plain-language sentence <= 160 characters. highlights is 1-3 distinct strings <= 120 characters each. recommendedAction is one specific string <= 120 characters or null. cards is 1-3 distinct objects, each with exactly title, summary, recommendedAction; every card title <= 60 characters, summary is one concise sentence <= 160 characters, and recommendedAction is <= 120 characters or null. Each card must express a separate, supported conclusion with an implication, not a list of events. Do not use Markdown, bullets, IDs, ISO timestamps, raw field names, event-by-event recaps, or repeat information. Describe only the supplied aggregate activity.`;
