import { z } from 'zod';

export const artifactKindSchema = z.enum(['answer', 'page', 'daily', 'weekly']);
export const evidenceSchema = z.object({
  id: z.string(), eventIds: z.array(z.string()), source: z.string(),
  title: z.string(), text: z.string(), occurredAt: z.string(), fingerprint: z.string(),
});
export type Evidence = z.infer<typeof evidenceSchema>;
export const intelligenceContentSchema = z.object({
  // This content is read first on a phone. Keep the answer scannable before
  // the user opens its evidence and source-level detail.
  title: z.string().min(1).max(88), summary: z.string().min(1).max(420),
  claims: z.array(z.object({
    id: z.string().min(1), text: z.string().min(1).max(420),
    kind: z.enum(['fact','calculation','inference']),
    citations: z.array(z.object({ evidenceId: z.string(), quote: z.string().min(1).max(2000) })).min(1),
  }).strict()).max(3),
  uncertainty: z.array(z.string().max(220)).max(2),
  actions: z.array(z.string().max(180)).max(2),
}).strict();
export type IntelligenceContent = z.infer<typeof intelligenceContentSchema>;

export function parseModelJson(value: string) {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  return JSON.parse(trimmed);
}

/** Deterministic citation checks precede an independent semantic support check. */
export function validateCitations(content: IntelligenceContent, evidence: Evidence[]) {
  const errors: string[] = [];
  const ids = new Set<string>();
  const normalize = (s: string) => s.normalize('NFKC').replace(/\s+/g,' ').trim();
  for (const claim of content.claims) {
    if (ids.has(claim.id)) errors.push(`duplicate_claim:${claim.id}`);
    ids.add(claim.id);
    for (const citation of claim.citations) {
      const source = evidence.find(item => item.id === citation.evidenceId);
      if (!source) errors.push(`unknown_evidence:${citation.evidenceId}`);
      else if (!normalize(source.text).includes(normalize(citation.quote))) errors.push(`unsupported_quote:${claim.id}`);
    }
    if (claim.kind === 'calculation' && !claim.citations.some(c => c.evidenceId.startsWith('aggregate:'))) {
      errors.push(`unverified_calculation:${claim.id}`);
    }
    if (claim.kind === 'calculation') {
      const citedAggregates=claim.citations.flatMap(c=>evidence.filter(e=>e.id===c.evidenceId&&e.id.startsWith('aggregate:')).map(e=>e.text)).join(' ');
      const supportedNumbers=new Set((citedAggregates.match(/-?\d+(?:[.,]\d+)?/g) ?? []).map(n=>n.replace(',','.')));
      for(const number of claim.text.match(/-?\d+(?:[.,]\d+)?/g) ?? [])if(!supportedNumbers.has(number.replace(',','.')))errors.push(`unsupported_number:${claim.id}:${number}`);
    }
  }
  return errors;
}

export function scheduleWindow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone:'America/Montevideo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23',weekday:'short',
  }).formatToParts(now).map(p => [p.type,p.value]));
  return { date:`${parts.year}-${parts.month}-${parts.day}`, due:Number(parts.hour)>=8, weekly:parts.weekday==='Mon' };
}
