import { z } from "zod";
import { generateNaturalLanguageSummary } from "./deepseek.js";
import { mergeEntities } from "./entity-repository.js";
import { invalidateGraphTraversalCache } from "./graph-cache.js";
import { pool, withSemanticMaterializationLock, withTransaction } from "./postgres.js";
import { rootEventEvidenceFromAnchors, settleSatisfiedSemanticCandidates } from "./semantic-repository.js";

const AUTO_RECONCILE_CONFIDENCE = 0.95;

const reconciliationSchema = z.object({
  merges: z.array(z.object({
    canonicalId: z.string().min(1),
    duplicateIds: z.array(z.string().min(1)).min(1),
    rationale: z.string().min(1).max(2000),
    confidence: z.number().min(0).max(1),
  })).default([]),
  demotions: z.array(z.object({
    id: z.string().min(1),
    rationale: z.string().min(1).max(2000),
    confidence: z.number().min(0).max(1),
  })).default([]),
});

const verificationSchema = z.object({
  mergeVerdicts: z.array(z.object({
    canonicalId: z.string().min(1),
    duplicateId: z.string().min(1),
    sameIdentity: z.boolean(),
    rationale: z.string().min(1).max(2000),
    confidence: z.number().min(0).max(1),
  })).default([]),
  demotionVerdicts: z.array(z.object({
    id: z.string().min(1),
    shouldDemote: z.boolean(),
    rationale: z.string().min(1).max(2000),
    confidence: z.number().min(0).max(1),
  })).default([]),
});

type ReconciliationNode = {
  id: string;
  type: string;
  value: string;
  description: string;
  identitySource: string;
  parentId: string | null;
  parentType: string | null;
  parentValue: string | null;
  evidenceCount: number;
};

export function selectVerifiedReconciliationActions(
  nodes: ReconciliationNode[],
  parsed: z.infer<typeof reconciliationSchema>,
  verification: z.infer<typeof verificationSchema>,
) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const mergeVerdicts = new Map(verification.mergeVerdicts.map((verdict) => [`${verdict.canonicalId}|${verdict.duplicateId}`, verdict]));
  const acceptedMerges = parsed.merges.flatMap((proposal) => {
    const canonical = byId.get(proposal.canonicalId);
    if (!canonical || proposal.confidence < AUTO_RECONCILE_CONFIDENCE) return [];
    const duplicateIds = proposal.duplicateIds.filter((id) => {
      const duplicate = byId.get(id);
      const verdict = mergeVerdicts.get(`${proposal.canonicalId}|${id}`);
      if (!duplicate || duplicate.type !== canonical.type || duplicate.identitySource === "user") return false;
      if (!verdict?.sameIdentity || verdict.confidence < AUTO_RECONCILE_CONFIDENCE) return false;
      const rationale = `${proposal.rationale} ${verdict.rationale}`;
      if (canonical.type === "app" && /\b(component|connector|integration)\b/iu.test(rationale)) return false;
      if (canonical.type === "merchant" && /\b(company|subscription|product)\b/iu.test(rationale)) return false;
      return canonical.type !== "concept" || duplicate.parentId === canonical.parentId;
    });
    return duplicateIds.length ? [{ ...proposal, duplicateIds }] : [];
  });
  const mergeIds = new Set(acceptedMerges.flatMap((proposal) => proposal.duplicateIds));
  const demotionVerdicts = new Map(verification.demotionVerdicts.map((verdict) => [verdict.id, verdict]));
  const acceptedDemotions = parsed.demotions.filter((proposal) => {
    const node = byId.get(proposal.id);
    const verdict = demotionVerdicts.get(proposal.id);
    return Boolean(node && node.type === "concept" && node.identitySource === "ai"
      && proposal.confidence >= AUTO_RECONCILE_CONFIDENCE && verdict?.shouldDemote
      && verdict.confidence >= AUTO_RECONCILE_CONFIDENCE && !mergeIds.has(proposal.id));
  });
  return { acceptedMerges, acceptedDemotions };
}

function parseJson(content: string) {
  const text = content.trim().replace(/^```json\s*|\s*```$/gim, "");
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}

async function requestStructured<T>(input: {
  schema: { safeParse(value: unknown): z.SafeParseReturnType<unknown, T> };
  systemPrompt: string;
  userPrompt: string;
}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await generateNaturalLanguageSummary({
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
      jsonMode: true,
      systemPrompt: `${input.systemPrompt}${attempt ? "\nYour previous response failed validation. Return every required array and use the exact JSON shape." : ""}`,
      userPrompt: input.userPrompt,
    });
    if (!response) continue;
    try {
      const parsed = input.schema.safeParse(parseJson(response));
      if (parsed.success) return parsed.data;
    } catch {
      // A malformed model response is retryable and must never mutate the graph.
    }
  }
  return null;
}

async function loadReconciliationNodes(): Promise<ReconciliationNode[]> {
  const result = await pool.query<ReconciliationNode>(`
    select entity.id, entity.type, entity.value, entity.description,
      entity.identity_source as "identitySource",
      parent.id as "parentId", parent.type as "parentType", parent.value as "parentValue",
      count(distinct evidence.id)::int as "evidenceCount"
    from entities entity
    left join entity_merges merged on merged.alias_entity_id = entity.id
    left join relations hierarchy on hierarchy.source_entity_id = entity.id
      and hierarchy.relation_type in ('part_of','belongs_to_domain')
    left join entities parent on parent.id = hierarchy.target_entity_id
    left join relations evidence_relation on evidence_relation.target_entity_id = entity.id
      and evidence_relation.relation_type in ('part_of','belongs_to_domain')
    left join entities evidence on evidence.id = evidence_relation.source_entity_id
      and evidence.type in ('activity_instance','financial_event','email_message')
    where merged.alias_entity_id is null
      and entity.type in ('concept','app','merchant','sender','recipient')
      and entity.identity_source in ('ai','user')
      and length(btrim(entity.description)) > 0
    group by entity.id, parent.id
    order by entity.type, parent.value nulls first, entity.value
    limit 300
  `);
  return result.rows;
}

export async function reconcileSemanticGraph(input: { dryRun?: boolean } = {}) {
  return withSemanticMaterializationLock(() => reconcileSemanticGraphUnlocked(input));
}

async function reconcileSemanticGraphUnlocked(input: { dryRun?: boolean } = {}) {
  if (!process.env.DEEPSEEK_API_KEY) return { status: "model_unavailable" as const, merged: 0, demoted: 0, review: 0 };
  const nodes = await loadReconciliationNodes();
  if (!nodes.length) return { status: "empty" as const, merged: 0, demoted: 0, review: 0 };
  const parsed = await requestStructured<z.infer<typeof reconciliationSchema>>({
    schema: reconciliationSchema,
    systemPrompt: `Return strict JSON only. Audit canonical durable nodes after a semantic ingestion batch.

Merge only nodes with the same real-world identity or exactly the same reusable meaning. Related concepts are not duplicates. Concepts may auto-merge only when they share the same immediate parent. Apps, merchants, senders, and recipients may merge across parents when they are the same identity. Prefer user-owned identities, then the clearest concise name and description, then the node with more evidence.

Demote only AI concepts that cannot independently represent durable knowledge: raw fragments, one-off occurrences, generic or unspecified notifications, amounts, timestamps, or concepts whose description admits they are an event instance. Never demote apps, merchants, people, accounts, user-owned nodes, seeded ontology, or a specific reusable event class such as motion detection or a device-offline alert.

Return {"merges":[{"canonicalId","duplicateIds":[],"rationale","confidence"}],"demotions":[{"id","rationale","confidence"}]}. Use confidence >= ${AUTO_RECONCILE_CONFIDENCE} only when identity is certain; otherwise still propose it below the threshold for user review.`,
    userPrompt: JSON.stringify(nodes),
  });
  if (!parsed) return { status: "retryable" as const, stage: "proposal" as const, merged: 0, demoted: 0, review: 0 };

  const verification = await requestStructured<z.infer<typeof verificationSchema>>({
    schema: verificationSchema,
    systemPrompt: `Return strict JSON only. Independently challenge a proposed knowledge-graph reconciliation.

For each merge pair, sameIdentity is true only when replacing either node everywhere loses no meaning. A company is not its subscription, an app is not one connector or notification, a person is not their email address, and a platform is not one component. For concepts, differently worded reusable event classes may be identical only when their descriptions and parent context denote the same recurring event meaning.

For each demotion, shouldDemote is true only for a raw fragment, one-off occurrence, unspecified notification, or mislabeled event instance. A specific repeatable event class such as device-offline alerts is durable and must not be demoted.

Return {"mergeVerdicts":[{"canonicalId","duplicateId","sameIdentity","rationale","confidence"}],"demotionVerdicts":[{"id","shouldDemote","rationale","confidence"}]}.`,
    userPrompt: JSON.stringify({ nodes, proposals: parsed }),
  });
  if (!verification) return { status: "retryable" as const, stage: "verification" as const, merged: 0, demoted: 0, review: parsed.merges.length + parsed.demotions.length };

  const { acceptedMerges, acceptedDemotions } = selectVerifiedReconciliationActions(nodes, parsed, verification);
  const review = parsed.merges.length - acceptedMerges.length + parsed.demotions.length - acceptedDemotions.length;
  if (input.dryRun) return {
    status: "preview" as const,
    merged: acceptedMerges.reduce((count, proposal) => count + proposal.duplicateIds.length, 0),
    demoted: acceptedDemotions.length,
    review,
    accepted: { merges: acceptedMerges, demotions: acceptedDemotions },
    proposals: parsed,
    verification,
  };

  let merged = 0;
  let settledCandidates = 0;
  let rootedEvidence = 0;
  await withTransaction(async (db) => {
    const alreadyMerged = new Set<string>();
    for (const proposal of acceptedMerges) {
      for (const duplicateId of proposal.duplicateIds) {
        if (duplicateId === proposal.canonicalId || alreadyMerged.has(duplicateId)) continue;
        await mergeEntities(db, duplicateId, proposal.canonicalId, {
          reason: "llm_post_ingestion_reconciliation",
          confidence: proposal.confidence,
        });
        alreadyMerged.add(duplicateId);
        merged += 1;
      }
    }
    if (acceptedDemotions.length) await db.query(`
      update entities set identity_source = 'evidence',
        metadata = metadata || jsonb_build_object('demotedFromOverview', true, 'demotionReason', 'llm_post_ingestion_reconciliation')
      where id = any($1::text[])
    `, [acceptedDemotions.map((proposal) => proposal.id)]);
    settledCandidates = await settleSatisfiedSemanticCandidates(db);
    rootedEvidence = await rootEventEvidenceFromAnchors(db);
    await db.query(`update semantic_event_decisions decision set status = 'resolved', updated_at = now()
      where decision.status = 'review'
        and not exists (select 1 from semantic_candidates candidate where candidate.event_id = decision.event_id and candidate.status = 'pending')`);
  });
  invalidateGraphTraversalCache();
  return { status: "applied" as const, merged, demoted: acceptedDemotions.length, settledCandidates, rootedEvidence, review };
}
