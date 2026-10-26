import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { createKnowledgeDigest } from "./digests.js";
import { insertDigestRun } from "./digest-repository.js";
import { generateNaturalLanguageSummary } from "./deepseek.js";
import { authorizeModelDispatch, listDeniedEgressSources, stillAuthorized } from "./privacy.js";
import { buildInsightContent, INSIGHT_JSON_PROMPT, parseInsightContent, type StructuredInsightContent } from "./generated-content.js";
import { upsertEmbedding } from "./embeddings.js";
import { insertInsightRun } from "./insight-repository.js";
import { pool, withTransaction } from "./postgres.js";
import { TAXONOMY_VERSION, categoryByKey } from "../domain/ontology.js";
import { verifyGeneratedContent } from "./decision-verification.js";
import type { DecisionVerificationStatus, EvidenceItem, VerificationOutcome } from "../domain/decision-policy.js";

type Queryable = Pick<typeof pool, "query">;

export type InsightCandidateDraft = {
  detector: string;
  dedupeKey: string;
  title: string;
  explanation: string;
  suggestedAction?: string | null;
  evidence: Record<string, unknown>;
  novelty: number;
  impact: number;
  confidence: number;
  recurrence: number;
  utility: number;
  severity: "info" | "low" | "medium" | "high" | "critical";
  windowFrom: string;
  windowTo: string;
  expiresAt: string;
};

export type StoredInsightCandidate = InsightCandidateDraft & {
  id: string;
  clientId: string | null;
  status: "pending" | "selected" | "delivered" | "dismissed" | "expired";
  score: number;
  deliveredAt: string | null;
  feedbackStatus: string | null;
  createdAt: string;
  updatedAt: string;
};

export function scoreInsightCandidate(candidate: Pick<InsightCandidateDraft, "novelty" | "impact" | "confidence" | "recurrence" | "utility">) {
  const bounded = (value: number) => Math.min(1, Math.max(0, value));
  return Number((0.22 * bounded(candidate.novelty)
    + 0.25 * bounded(candidate.impact)
    + 0.23 * bounded(candidate.confidence)
    + 0.12 * bounded(candidate.recurrence)
    + 0.18 * bounded(candidate.utility)).toFixed(6));
}

const ACTIONABLE_DETECTORS = new Set([
  "spending_variation",
  "recurrence_subscription",
  "entity_taxonomy_spending_variation",
]);

const MIN_DELIVERABLE_INSIGHT_SCORE = 0.72;

function evidenceCount(candidate: Pick<InsightCandidateDraft, "evidence">) {
  const evidence = candidate.evidence as { transactionIds?: unknown; eventIds?: unknown };
  const ids = Array.isArray(evidence.transactionIds) ? evidence.transactionIds : Array.isArray(evidence.eventIds) ? evidence.eventIds : [];
  return new Set(ids.filter((id): id is string => typeof id === "string" && Boolean(id))).size;
}

// Detection is deliberately conservative: counts of notifications, taxonomy
// changes and graph writes are operational telemetry, not a conclusion about
// the user's life. A user-facing insight needs independent evidence plus a
// material enough score to justify interrupting them.
export function isDeliverableInsightCandidate(candidate: InsightCandidateDraft & { score?: number }) {
  if (!ACTIONABLE_DETECTORS.has(candidate.detector)) return false;
  const score = candidate.score ?? scoreInsightCandidate(candidate);
  if (score < MIN_DELIVERABLE_INSIGHT_SCORE) return false;
  if (candidate.detector === "spending_variation") return evidenceCount(candidate) >= 2;
  if (candidate.detector === "entity_taxonomy_spending_variation") return evidenceCount(candidate) >= 2 && candidate.confidence >= 0.85;
  if (candidate.detector === "recurrence_subscription") return evidenceCount(candidate) >= 4 && candidate.confidence >= 0.85;
  return false;
}

async function persistCandidate(db: Queryable, clientId: string | null, draft: InsightCandidateDraft) {
  const score = scoreInsightCandidate(draft);
  const result = await db.query<StoredInsightCandidate>(`
    insert into insight_candidates (
      id, client_id, detector, score, novelty, impact, confidence,
      recurrence, utility, evidence, dedupe_key, window_from, window_to,
      severity, title, explanation, suggested_action, expires_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18)
    on conflict ((coalesce(client_id, '')), dedupe_key) do update set
      detector = excluded.detector, score = excluded.score, novelty = excluded.novelty,
      impact = excluded.impact, confidence = excluded.confidence,
      recurrence = excluded.recurrence, utility = excluded.utility,
      evidence = excluded.evidence, window_from = excluded.window_from,
      window_to = excluded.window_to, severity = excluded.severity,
      title = excluded.title, explanation = excluded.explanation,
      suggested_action = excluded.suggested_action, expires_at = excluded.expires_at,
      status = case when insight_candidates.expires_at <= now() then 'pending' else insight_candidates.status end,
      updated_at = now()
    returning id, client_id as "clientId", detector, status, score::float8,
      novelty::float8, impact::float8, confidence::float8, recurrence::float8,
      utility::float8, evidence, dedupe_key as "dedupeKey",
      window_from as "windowFrom", window_to as "windowTo", severity,
      title, explanation, suggested_action as "suggestedAction",
      expires_at as "expiresAt", delivered_at as "deliveredAt",
      feedback_status as "feedbackStatus", created_at as "createdAt", updated_at as "updatedAt"
  `, [
    `insight_candidate_${randomUUID()}`, clientId, draft.detector, score,
    draft.novelty, draft.impact, draft.confidence, draft.recurrence,
    draft.utility, JSON.stringify(draft.evidence), draft.dedupeKey,
    draft.windowFrom, draft.windowTo, draft.severity, draft.title,
    draft.explanation, draft.suggestedAction ?? null, draft.expiresAt,
  ]);
  return result.rows[0]!;
}

function windows(now = new Date()) {
  const to = now.toISOString();
  const day = 86_400_000;
  return {
    to,
    dayAgo: new Date(now.getTime() - day).toISOString(),
    weekAgo: new Date(now.getTime() - 7 * day).toISOString(),
    fortnightAgo: new Date(now.getTime() - 14 * day).toISOString(),
    monthAgo: new Date(now.getTime() - 30 * day).toISOString(),
    quarterAgo: new Date(now.getTime() - 90 * day).toISOString(),
    expiresAt: new Date(now.getTime() + 14 * day).toISOString(),
  };
}

export async function detectInsightCandidates(input: { clientId?: string | null; now?: Date } = {}) {
  const clientId = input.clientId ?? null;
  const time = windows(input.now);
  const drafts: InsightCandidateDraft[] = [];

  const spending = await pool.query<{ currency: string; currentTotal: number; previousTotal: number; transactionIds: string[] }>(`
    select transaction.currency,
      coalesce(sum(transaction.amount) filter (where transaction.observed_at >= $2), 0)::float8 as "currentTotal",
      coalesce(sum(transaction.amount) filter (where transaction.observed_at >= $1 and transaction.observed_at < $2), 0)::float8 as "previousTotal",
      array_agg(transaction.id order by transaction.observed_at desc) filter (where transaction.observed_at >= $2) as "transactionIds"
    from financial_transactions transaction
    left join raw_events event on event.id = transaction.anchor_event_id
    where transaction.kind = 'expense' and not transaction.excluded_from_reports and transaction.hidden_at is null
      and transaction.currency_status in ('explicit', 'account_confirmed', 'user_confirmed')
      and transaction.amount_confirmed = true
      and upper(transaction.currency) <> 'UNKNOWN'
      and transaction.observed_at >= $1 and transaction.observed_at <= $3
      and ($4::text is null or event.client_id is not distinct from $4)
    group by transaction.currency
  `, [time.fortnightAgo, time.weekAgo, time.to, clientId]);
  for (const row of spending.rows) {
    const previous = Number(row.previousTotal);
    const current = Number(row.currentTotal);
    if (previous <= 0 || current <= 0) continue;
    const change = (current - previous) / previous;
    if (Math.abs(change) < 0.2) continue;
    drafts.push({
      detector: "spending_variation", dedupeKey: `spending:${row.currency}:${time.weekAgo.slice(0, 10)}`,
      title: `${row.currency} spending ${change > 0 ? "increased" : "decreased"} ${Math.round(Math.abs(change) * 100)}%`,
      explanation: `Expense totals changed from ${previous.toFixed(2)} to ${current.toFixed(2)} ${row.currency} between adjacent seven-day windows.`,
      suggestedAction: change > 0 ? "Review the transactions driving the increase." : "Check whether the lower spending reflects a lasting change.",
      evidence: { transactionIds: row.transactionIds ?? [], current, previous, currency: row.currency },
      novelty: 0.85, impact: Math.min(1, Math.abs(change)), confidence: 0.95,
      recurrence: 0.5, utility: 0.9, severity: Math.abs(change) >= 0.75 ? "high" : "medium",
      windowFrom: time.fortnightAgo, windowTo: time.to, expiresAt: time.expiresAt,
    });
  }

  const recurring = await pool.query<{ merchant: string; currency: string; count: number; transactionIds: string[]; averageAmount: number }>(`
    select transaction.normalized_merchant as merchant, transaction.currency,
      count(*)::int as count, array_agg(transaction.id order by transaction.observed_at desc) as "transactionIds",
      avg(transaction.amount)::float8 as "averageAmount"
    from financial_transactions transaction left join raw_events event on event.id = transaction.anchor_event_id
    where transaction.kind = 'expense' and not transaction.excluded_from_reports and transaction.hidden_at is null
      and transaction.currency_status in ('explicit', 'account_confirmed', 'user_confirmed')
      and transaction.amount_confirmed = true
      and upper(transaction.currency) <> 'UNKNOWN'
      and transaction.observed_at >= $1 and ($2::text is null or event.client_id is not distinct from $2)
    group by transaction.normalized_merchant, transaction.currency having count(*) >= 4
  `, [time.quarterAgo, clientId]);
  for (const row of recurring.rows) drafts.push({
    detector: "recurrence_subscription", dedupeKey: `recurring:${row.merchant}:${row.currency}`,
    title: `Repeated spending at ${row.merchant}`,
    explanation: `${row.count} ${row.currency} expenses at this merchant were observed in the last 90 days (average ${Number(row.averageAmount).toFixed(2)}). This is repeated activity, not proof of a subscription.`,
    suggestedAction: "Review whether these repeated purchases are expected and worth budgeting for.",
    evidence: { merchant: row.merchant, currency: row.currency, transactionIds: row.transactionIds, averageAmount: row.averageAmount },
    novelty: 0.65, impact: 0.6, confidence: Math.min(0.98, 0.65 + row.count * 0.06),
    recurrence: Math.min(1, row.count / 6), utility: 0.85, severity: "medium",
    windowFrom: time.quarterAgo, windowTo: time.to, expiresAt: time.expiresAt,
  });

  // This is where entity curation becomes user value: a confirmed business
  // type (for example Food establishments or Pharmacies) can explain changes
  // across many merchants without relying on a fragile merchant-name heuristic.
  const taggedSpending = await pool.query<{ taxonomyKey: string; currency: string; currentTotal: number; previousTotal: number; transactionIds: string[] }>(`
    select tag.taxonomy_key as "taxonomyKey", transaction.currency,
      coalesce(sum(transaction.amount) filter (where transaction.observed_at >= $2), 0)::float8 as "currentTotal",
      coalesce(sum(transaction.amount) filter (where transaction.observed_at >= $1 and transaction.observed_at < $2), 0)::float8 as "previousTotal",
      array_agg(transaction.id order by transaction.observed_at desc) filter (where transaction.observed_at >= $2) as "transactionIds"
    from financial_transactions transaction
    join entity_semantic_profiles profile on profile.entity_id = transaction.merchant_entity_id
    cross join lateral unnest(profile.taxonomy_keys) as tag(taxonomy_key)
    left join raw_events event on event.id = transaction.anchor_event_id
    where transaction.kind = 'expense' and not transaction.excluded_from_reports and transaction.hidden_at is null
      and transaction.currency_status in ('explicit', 'account_confirmed', 'user_confirmed')
      and transaction.amount_confirmed = true
      and upper(transaction.currency) <> 'UNKNOWN'
      and transaction.observed_at >= $1 and transaction.observed_at <= $3
      and ($4::text is null or event.client_id is not distinct from $4)
    group by tag.taxonomy_key, transaction.currency
  `, [time.fortnightAgo, time.weekAgo, time.to, clientId]);
  for (const row of taggedSpending.rows) {
    const previous = Number(row.previousTotal);
    const current = Number(row.currentTotal);
    if (previous <= 0 || current <= 0) continue;
    const change = (current - previous) / previous;
    if (Math.abs(change) < 0.25 || (row.transactionIds ?? []).length < 2) continue;
    const label = categoryByKey(row.taxonomyKey)?.label ?? row.taxonomyKey.replace(/[._]/g, ' ');
    drafts.push({
      detector: "entity_taxonomy_spending_variation", dedupeKey: `taxonomy-spending:${row.taxonomyKey}:${row.currency}:${time.weekAgo.slice(0, 10)}`,
      title: `${label} spending ${change > 0 ? "increased" : "decreased"} ${Math.round(Math.abs(change) * 100)}%`,
      explanation: `Confirmed ${label.toLowerCase()} entities account for ${current.toFixed(2)} ${row.currency} this week versus ${previous.toFixed(2)} in the prior week.`,
      suggestedAction: `Review the ${label.toLowerCase()} entities and transactions behind this change.`,
      evidence: { taxonomyVersion: TAXONOMY_VERSION, taxonomyKey: row.taxonomyKey, currency: row.currency, current, previous, transactionIds: row.transactionIds ?? [] },
      novelty: 0.9, impact: Math.min(1, Math.abs(change)), confidence: 0.92,
      recurrence: 0.55, utility: 0.92, severity: Math.abs(change) >= 0.75 ? "high" : "medium",
      windowFrom: time.fortnightAgo, windowTo: time.to, expiresAt: time.expiresAt,
    });
  }

  const activity = await pool.query<{ source: string; currentCount: number; previousCount: number; eventIds: string[] }>(`
    select event.source,
      count(*) filter (where coalesce(event.timestamp, event.created_at) >= $2)::int as "currentCount",
      count(*) filter (where coalesce(event.timestamp, event.created_at) >= $1 and coalesce(event.timestamp, event.created_at) < $2)::int as "previousCount",
      array_agg(event.id order by coalesce(event.timestamp, event.created_at) desc) filter (where coalesce(event.timestamp, event.created_at) >= $2) as "eventIds"
    from raw_events event where coalesce(event.timestamp, event.created_at) >= $1
      and event.privacy_status <> 'hidden' and ($3::text is null or event.client_id is not distinct from $3)
    group by event.source
  `, [time.fortnightAgo, time.weekAgo, clientId]);
  for (const row of activity.rows) {
    if (row.currentCount < 3 || row.currentCount < Math.max(3, row.previousCount * 2)) continue;
    drafts.push({
      detector: "source_activity_change", dedupeKey: `activity:${row.source}:${time.weekAgo.slice(0, 10)}`,
      title: `Activity increased for ${row.source}`,
      explanation: `${row.currentCount} events arrived in the current week versus ${row.previousCount} in the previous week.`,
      suggestedAction: "Inspect the new activity and confirm that this source is still useful.",
      evidence: { source: row.source, currentCount: row.currentCount, previousCount: row.previousCount, eventIds: row.eventIds ?? [] },
      novelty: 0.8, impact: Math.min(1, row.currentCount / Math.max(1, row.previousCount * 3)), confidence: 0.9,
      recurrence: 0.4, utility: 0.7, severity: "low", windowFrom: time.fortnightAgo,
      windowTo: time.to, expiresAt: time.expiresAt,
    });
  }

  const categoryActivity = await pool.query<{ categoryKey: string; categoryLabel: string; currentCount: number; previousCount: number; eventIds: string[] }>(`
    select decision.primary_category_key as "categoryKey", category.value as "categoryLabel",
      count(*) filter (where coalesce(event.timestamp, event.created_at) >= $2)::int as "currentCount",
      count(*) filter (where coalesce(event.timestamp, event.created_at) >= $1 and coalesce(event.timestamp, event.created_at) < $2)::int as "previousCount",
      array_agg(event.id order by coalesce(event.timestamp, event.created_at) desc) filter (where coalesce(event.timestamp, event.created_at) >= $2) as "eventIds"
    from semantic_event_decisions decision
    join raw_events event on event.id = decision.event_id
    join entities category on category.taxonomy_key = decision.primary_category_key
    where decision.primary_category_key is not null and coalesce(event.timestamp, event.created_at) >= $1
      and event.privacy_status <> 'hidden' and ($3::text is null or event.client_id is not distinct from $3)
    group by decision.primary_category_key, category.value
  `, [time.fortnightAgo, time.weekAgo, clientId]);
  for (const row of categoryActivity.rows) {
    if (row.currentCount < 3 || row.currentCount < Math.max(3, row.previousCount * 2)) continue;
    drafts.push({
      detector: "category_activity_change", dedupeKey: `category-activity:${row.categoryKey}:${time.weekAgo.slice(0, 10)}`,
      title: `${row.categoryLabel} activity increased`,
      explanation: `${row.currentCount} categorized events occurred in the current week versus ${row.previousCount} in the previous week.`,
      suggestedAction: "Open this category to inspect the activity behind the change.",
      evidence: { taxonomyVersion: TAXONOMY_VERSION, categoryKey: row.categoryKey, currentCount: row.currentCount, previousCount: row.previousCount, eventIds: row.eventIds ?? [] },
      novelty: 0.82, impact: Math.min(1, row.currentCount / Math.max(1, row.previousCount * 3)), confidence: 0.92,
      recurrence: 0.55, utility: 0.82, severity: "low", windowFrom: time.fortnightAgo,
      windowTo: time.to, expiresAt: time.expiresAt,
    });
  }

  const correlations = await pool.query<{ domainA: string; domainB: string; pairCount: number; eventIds: string[] }>(`
    select least(domain_a.value, domain_b.value) as "domainA",
      greatest(domain_a.value, domain_b.value) as "domainB",
      count(*)::int as "pairCount",
      (array_agg(distinct anchor_a.event_id) || array_agg(distinct anchor_b.event_id)) as "eventIds"
    from event_semantic_anchors anchor_a
    join event_semantic_anchors anchor_b on anchor_a.event_id < anchor_b.event_id
      and anchor_a.domain_entity_id <> anchor_b.domain_entity_id
    join entities domain_a on domain_a.id = anchor_a.domain_entity_id
    join entities domain_b on domain_b.id = anchor_b.domain_entity_id
    join raw_events event_a on event_a.id = anchor_a.event_id
    join raw_events event_b on event_b.id = anchor_b.event_id
    where anchor_a.role = 'primary' and anchor_b.role = 'primary'
      and coalesce(event_a.timestamp, event_a.created_at) >= $1
      and abs(extract(epoch from (coalesce(event_a.timestamp, event_a.created_at) - coalesce(event_b.timestamp, event_b.created_at)))) <= 7200
      and event_a.privacy_status = 'standard' and event_b.privacy_status = 'standard'
      and ($2::text is null or (event_a.client_id is not distinct from $2 and event_b.client_id is not distinct from $2))
    group by least(domain_a.value, domain_b.value), greatest(domain_a.value, domain_b.value)
    having count(*) >= 2
    order by count(*) desc limit 5
  `, [time.monthAgo, clientId]);
  for (const row of correlations.rows) drafts.push({
    detector: "cross_domain_temporal_correlation", dedupeKey: `cross-domain:${row.domainA}:${row.domainB}:${time.monthAgo.slice(0, 7)}`,
    title: `${row.domainA} and ${row.domainB} activity repeatedly occurred close together`,
    explanation: `${row.pairCount} event pairs from the two domains occurred within two hours during the last 30 days. This is a correlation, not proof of causation.`,
    suggestedAction: "Review the paired evidence before deciding whether the pattern is meaningful.",
    evidence: { domains: [row.domainA, row.domainB], pairCount: row.pairCount, eventIds: [...new Set(row.eventIds ?? [])] },
    novelty: 0.9, impact: 0.55, confidence: Math.min(0.9, 0.55 + row.pairCount * 0.08),
    recurrence: Math.min(1, row.pairCount / 6), utility: 0.7, severity: "info",
    windowFrom: time.monthAgo, windowTo: time.to, expiresAt: time.expiresAt,
  });

  const tasks = await pool.query<{ count: number; eventIds: string[] }>(`
    select count(*)::int as count, array_agg(event.id order by coalesce(event.timestamp, event.created_at)) as "eventIds"
    from raw_events event join classified_events classified on classified.raw_event_id = event.id
    where classified.inferred_kind = 'task' and event.privacy_status = 'standard'
      and coalesce(event.timestamp, event.created_at) >= $1
      and coalesce(event.raw->>'completed', 'false') not in ('true','1','yes')
      and ($2::text is null or event.client_id is not distinct from $2)
  `, [time.monthAgo, clientId]);
  if ((tasks.rows[0]?.count ?? 0) > 0) drafts.push({
    detector: "pending_tasks", dedupeKey: `pending-tasks:${time.to.slice(0, 10)}`,
    title: `${tasks.rows[0]!.count} captured tasks may still be pending`,
    explanation: "Recent task events do not contain a completion marker.",
    suggestedAction: "Review or complete the pending tasks.",
    evidence: { eventIds: tasks.rows[0]!.eventIds ?? [] }, novelty: 0.6, impact: 0.5,
    confidence: 0.75, recurrence: 0.7, utility: 0.9, severity: "medium",
    windowFrom: time.monthAgo, windowTo: time.to, expiresAt: time.expiresAt,
  });

  const pending = await pool.query<{ count: number; candidateIds: string[] }>(`
    select count(*)::int as count, array_agg(candidate.id order by candidate.created_at) as "candidateIds"
    from semantic_candidates candidate where candidate.status = 'pending'
      and ($1::text is null or candidate.client_id is not distinct from $1)
  `, [clientId]);
  if ((pending.rows[0]?.count ?? 0) > 0) drafts.push({
    detector: "pending_review", dedupeKey: "semantic-review-pending",
    title: `${pending.rows[0]!.count} semantic decisions need review`,
    explanation: "Ambiguous merges or hierarchy placements are waiting for an explicit decision.",
    suggestedAction: "Review the pending semantic proposals.", evidence: { candidateIds: pending.rows[0]!.candidateIds ?? [] },
    novelty: 0.55, impact: 0.45, confidence: 1, recurrence: 0.6, utility: 0.95,
    severity: "medium", windowFrom: time.monthAgo, windowTo: time.to, expiresAt: time.expiresAt,
  });

  const graphChanges = await pool.query<{ relationIds: string[]; entityIds: string[]; count: number }>(`
    select
      (select array_agg(relation.id order by relation.created_at desc) from relations relation
        where relation.created_at >= $1 and relation.confidence >= 0.9 and relation.relation_type not in ('same_as','evidence_for')) as "relationIds",
      (select array_agg(entity.id order by entity.created_at desc) from entities entity
        where entity.created_at >= $1 and entity.identity_source in ('ai','user') and entity.visibility = 'visible') as "entityIds",
      ((select count(*) from relations relation where relation.created_at >= $1 and relation.confidence >= 0.9 and relation.relation_type not in ('same_as','evidence_for'))
        + (select count(*) from entities entity where entity.created_at >= $1 and entity.identity_source in ('ai','user') and entity.visibility = 'visible'))::int as count
  `, [time.dayAgo]);
  if ((graphChanges.rows[0]?.count ?? 0) > 0) drafts.push({
    detector: "high_confidence_graph_change", dedupeKey: `graph-change:${time.dayAgo.slice(0, 10)}`,
    title: `${graphChanges.rows[0]!.count} high-confidence knowledge links were added`,
    explanation: "New governed relationships were established from recent evidence.",
    suggestedAction: "Inspect the new knowledge paths if any relationship is unexpected.",
    evidence: { relationIds: graphChanges.rows[0]!.relationIds ?? [], entityIds: graphChanges.rows[0]!.entityIds ?? [] }, novelty: 0.9,
    impact: 0.5, confidence: 0.95, recurrence: 0.3, utility: 0.6, severity: "info",
    windowFrom: time.dayAgo, windowTo: time.to, expiresAt: time.expiresAt,
  });

  const deliverableDrafts = drafts.filter(isDeliverableInsightCandidate);
  const stored: StoredInsightCandidate[] = [];
  await withTransaction(async (db) => {
    await db.query(`update insight_candidates set status = 'expired', updated_at = now() where status in ('pending','selected') and expires_at <= now()`);
    for (const draft of deliverableDrafts) stored.push(await persistCandidate(db, clientId, draft));
  });
  return stored.sort((left, right) => right.score - left.score);
}

/**
 * Resolve the evidence sources behind insight candidates so missing or denied
 * source policies fail closed instead of only relying on an owner-wide denied
 * source list. Only owner-scoped rows contribute a source.
 */
async function resolveCandidateEvidenceSources(
  candidates: StoredInsightCandidate[],
  ownerId: string | null,
) {
  if (!ownerId) return [];
  const eventIds = new Set<string>();
  const transactionIds = new Set<string>();
  const collect = (value: unknown, target: Set<string>) => {
    if (!Array.isArray(value)) return;
    for (const item of value) if (typeof item === "string" && item.trim()) target.add(item);
  };
  for (const candidate of candidates) {
    const evidence = candidate.evidence as { eventIds?: unknown; transactionIds?: unknown };
    collect(evidence?.eventIds, eventIds);
    collect(evidence?.transactionIds, transactionIds);
  }
  const sources = new Set<string>();
  if (eventIds.size) {
    const result = await pool.query<{ source: string }>(`
      select distinct source from raw_events
      where id = any($1::text[])
        and (owner_id = $2 or (owner_id is null and client_id = $2))
    `, [[...eventIds], ownerId]);
    for (const row of result.rows) sources.add(row.source);
  }
  if (transactionIds.size) {
    const result = await pool.query<{ source: string }>(`
      select distinct event.source
      from financial_transactions transaction
      join raw_events event on event.id = transaction.anchor_event_id
      where transaction.id = any($1::text[])
        and (event.owner_id = $2 or (event.owner_id is null and event.client_id = $2))
    `, [[...transactionIds], ownerId]);
    for (const row of result.rows) sources.add(row.source);
  }
  return [...sources];
}

export type InsightVerificationMetadata = {
  status: DecisionVerificationStatus;
  verifierModel: string;
  reason: string;
  policyVersion: string;
};

/**
 * Candidate title/explanation/evidence are the only facts the verifier may use.
 * Detector scores, confidence and ranking are deliberately excluded: they are
 * prioritization metadata, not evidence that a claim happened.
 */
export function buildInsightEvidence(
  candidates: Array<Pick<StoredInsightCandidate, "id" | "detector" | "title" | "explanation" | "evidence" | "severity" | "windowFrom" | "windowTo">>,
): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  for (const candidate of candidates) {
    const occurredAt = candidate.windowTo ?? null;
    items.push({
      ref: `candidate:${candidate.id}:title`,
      kind: "canonical_context",
      label: `Candidate ${candidate.detector} title`,
      text: candidate.title.slice(0, 300),
      source: candidate.detector,
      occurredAt,
    });
    items.push({
      ref: `candidate:${candidate.id}:explanation`,
      kind: "canonical_context",
      label: `Candidate ${candidate.detector} explanation`,
      text: candidate.explanation.slice(0, 800),
      source: candidate.detector,
      occurredAt,
    });
    items.push({
      ref: `candidate:${candidate.id}:evidence`,
      kind: "aggregate",
      label: `Candidate ${candidate.detector} deterministic evidence`,
      text: JSON.stringify(candidate.evidence),
      source: candidate.detector,
      occurredAt,
    });
  }
  return items;
}

/** Field text only: the schema version is not a factual claim. */
export function insightContentText(content: StructuredInsightContent) {
  return [
    content.title,
    content.summary,
    content.whyItMatters,
    content.recommendedAction ?? "",
    ...content.takeaways,
    ...content.cards.flatMap((card) => [card.title, card.summary, card.recommendedAction ?? ""]),
  ].join("\n");
}

export function applyInsightVerification(input: {
  baseContent: StructuredInsightContent;
  candidateContent: StructuredInsightContent | null;
  generatorModel: string | null;
  outcome: VerificationOutcome | null;
}): {
  content: StructuredInsightContent;
  summary: string;
  model: string | null;
  verification: InsightVerificationMetadata | null;
} {
  const verification = input.outcome
    ? {
        status: input.outcome.verification.status,
        verifierModel: input.outcome.verification.verifierModel,
        reason: input.outcome.verification.reason,
        policyVersion: input.outcome.verification.policyVersion,
      }
    : null;
  const applied = Boolean(input.candidateContent && input.outcome?.applies);
  if (!applied) {
    return {
      content: input.baseContent,
      summary: input.baseContent.summary,
      model: null,
      verification,
    };
  }
  return {
    content: input.candidateContent!,
    summary: input.candidateContent!.summary,
    model: input.generatorModel,
    verification,
  };
}

export async function synthesizeTopInsightCandidates(input: { clientId?: string | null; limit?: number } = {}) {
  const limit = Math.min(10, Math.max(1, Math.trunc(input.limit ?? 5)));
  const result = await pool.query<StoredInsightCandidate>(`
    select id, client_id as "clientId", detector, status, score::float8,
      novelty::float8, impact::float8, confidence::float8, recurrence::float8,
      utility::float8, evidence, dedupe_key as "dedupeKey", window_from as "windowFrom",
      window_to as "windowTo", severity, title, explanation,
      suggested_action as "suggestedAction", expires_at as "expiresAt",
      delivered_at as "deliveredAt", feedback_status as "feedbackStatus",
      created_at as "createdAt", updated_at as "updatedAt"
    from insight_candidates where status = 'pending' and expires_at > now()
      and ($1::text is null or client_id is not distinct from $1)
      and not exists (
        select 1 from insight_runs run where insight_candidates.id = any(run.candidate_ids)
          and run.created_at >= now() - (($3::int || ' days')::interval)
      )
    order by score desc, created_at asc limit $2
  `, [input.clientId ?? null, limit, Number(process.env.INSIGHT_DEDUPE_DAYS ?? 30)]);
  const candidates = result.rows.filter(isDeliverableInsightCandidate);
  if (!candidates.length) return null;
  const evidence = candidates.map((candidate) => ({
    candidateId: candidate.id, detector: candidate.detector, title: candidate.title,
    explanation: candidate.explanation, score: candidate.score,
    confidence: candidate.confidence, severity: candidate.severity,
    suggestedAction: candidate.suggestedAction, evidence: candidate.evidence,
  }));
  let content = buildInsightContent(candidates);
  let summary = content.summary;
  let model: string | null = null;
  let verification: InsightVerificationMetadata | null = null;
  const insightAuthorization = await authorizeModelDispatch(pool, {
    ownerId: input.clientId ?? null,
    purpose: "proactive_insight_synthesis",
    // Candidate evidence event/transaction anchors provide the explicit source
    // set; any owner source that denies egress is added conservatively. A
    // source with no policy row now fails closed in the shared gate.
    sources: input.clientId
      ? [
          ...await resolveCandidateEvidenceSources(candidates, input.clientId),
          ...await listDeniedEgressSources(pool, input.clientId),
        ]
      : [],
  });
  if (config.deepseekApiKey && insightAuthorization.allowed) {
    const generated = await generateNaturalLanguageSummary({
      apiKey: config.deepseekApiKey, model: config.deepseekModel,
      privacy: insightAuthorization,
      systemPrompt: `You synthesize prioritized personal-knowledge changes for a calm mobile interface. ${INSIGHT_JSON_PROMPT}`,
      userPrompt: JSON.stringify({ candidates: evidence }),
      jsonMode: true,
      audit: { clientId: input.clientId ?? null, operation: "proactive_insight_synthesis", promptVersion: "proactive-insight-v3" },
    });
    const parsed = await stillAuthorized(insightAuthorization) ? parseInsightContent(generated) : null;
    if (parsed) {
      let outcome: VerificationOutcome | null = null;
      try {
        outcome = await verifyGeneratedContent({
          operation: "proactive_insight_synthesis",
          clientId: input.clientId ?? null,
          generatorModel: config.deepseekModel,
          generatorPromptVersion: "proactive-insight-v3",
          evidence: buildInsightEvidence(candidates),
          proposal: parsed,
          responseText: insightContentText(parsed),
          privacy: insightAuthorization.allowed ? insightAuthorization : null,
          apiKey: config.deepseekApiKey,
        });
      } catch (error) {
        // Never publish unverified generated content when the verifier itself
        // is unreachable; the deterministic candidate brief remains available.
        console.error("insight_verification_failed", error instanceof Error ? error.message : String(error));
        outcome = null;
      }
      // The verifier is another external dispatch; re-check the same
      // authorization before publishing the generated candidate.
      const stillPublishable = await stillAuthorized(insightAuthorization);
      const applied = applyInsightVerification({
        baseContent: content,
        candidateContent: stillPublishable ? parsed : null,
        generatorModel: config.deepseekModel,
        outcome: stillPublishable ? outcome : null,
      });
      content = applied.content;
      summary = applied.summary;
      model = applied.model;
      verification = applied.verification;
    }
  }
  const confidence = Math.min(...candidates.map((candidate) => candidate.confidence));
  const suggestedAction = candidates.find((candidate) => candidate.suggestedAction)?.suggestedAction ?? null;
  const expiresAt = candidates.reduce((earliest, candidate) => candidate.expiresAt < earliest ? candidate.expiresAt : earliest, candidates[0]!.expiresAt);
  const run = await insertInsightRun(pool, {
    toolName: "generate_proactive_insight", query: null,
    request: { schedule: "daily", candidateIds: candidates.map((candidate) => candidate.id) },
    response: { content, summary, candidates: evidence, verification }, summary, model,
    candidateIds: candidates.map((candidate) => candidate.id), evidence,
    confidence, suggestedAction, deliveryStatus: "delivered",
    deliveredAt: new Date().toISOString(), expiresAt, promptVersion: "proactive-insight-v3",
    ownerId: input.clientId ?? undefined,
    policyVersion: insightAuthorization.allowed ? insightAuthorization.policyVersion : 0,
  });
  if (!run) return null;
  await pool.query(`
    update insight_candidates set status = 'delivered', delivered_at = now(), updated_at = now()
    where id = any($1::text[])
  `, [candidates.map((candidate) => candidate.id)]);
  // The summary may be derived from deterministic content when LLM synthesis
  // was denied. Reuse the synthesis intersection: if any owner source denies
  // egress the embedding must stay local instead of being independently
  // re-authorized with an empty source set.
  await upsertEmbedding(pool, {
    objectType: "insight", objectId: run.id,
    clientId: input.clientId ?? null, ownerId: input.clientId ?? null,
    content: summary, metadata: { confidence, title: "Proactive insight" },
    authorization: insightAuthorization,
  });
  return run;
}

export async function runDailyKnowledgeEvaluation(input: { clientId?: string | null; now?: Date } = {}) {
  const candidates = await detectInsightCandidates(input);
  const insight = await synthesizeTopInsightCandidates({ clientId: input.clientId ?? null });
  const now = input.now ?? new Date();
  const to = now.toISOString();
  const from = new Date(now.getTime() - 86_400_000).toISOString();
  const digest = await createKnowledgeDigest({
    from, to, days: 1, eventLimit: 200, ownerId: input.clientId ?? null,
    apiKey: config.deepseekApiKey, model: config.deepseekModel,
  });
  let digestRun = null;
  if (digest.metrics.totalEvents > 0 || candidates.length > 0) {
    digestRun = await insertDigestRun(pool, {
      toolName: "generate_daily_digest", scope: digest.scope,
      windowFrom: from, windowTo: to,
      request: { schedule: "daily", from, to }, response: digest,
      summary: digest.summary, model: digest.model, ownerId: input.clientId ?? undefined,
    });
    if (digestRun && digest.summary) {
      // Digest runs do not persist a source intersection. Be conservative: any
      // owner source that denies egress keeps this derived embedding local.
      const embeddingAuthorization = await authorizeModelDispatch(pool, {
        ownerId: input.clientId ?? null,
        purpose: "embedding",
        sources: input.clientId
          ? [
              ...digest.metrics.eventsBySource.map((entry) => entry.source),
              ...await listDeniedEgressSources(pool, input.clientId),
            ]
          : [],
      });
      await upsertEmbedding(pool, {
        objectType: "digest", objectId: digestRun.id,
        clientId: input.clientId ?? null, ownerId: input.clientId ?? null, content: digest.summary,
        metadata: { title: digest.scope, events: digest.metrics.totalEvents },
        authorization: embeddingAuthorization,
      });
    }
  }
  return { evaluatedAt: to, candidatesDetected: candidates.length, insight, digest: digestRun };
}
