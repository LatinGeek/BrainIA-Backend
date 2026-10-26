import { isRedundantProviderOrHeadingConcept, semanticActionKind } from "../domain/decision-policy.js";
import { pool } from "../storage/postgres.js";

type Row = {
  id: string;
  clientId: string | null;
  eventId: string | null;
  subjectEntityId: string | null;
  subjectValue: string | null;
  subjectType: string | null;
  relationType: string;
  targetType: string;
  targetValue: string;
  decisionKind: string | null;
  policyVersion: string | null;
  verificationStatus: string;
  rationale: string | null;
  proposedPath: string[] | null;
  title: string | null;
  body: string | null;
  source: string | null;
};

const apply = process.argv.includes("--apply");
const rows = await pool.query<Row>(`
  select candidate.id, candidate.client_id as "clientId", candidate.event_id as "eventId",
    candidate.subject_entity_id as "subjectEntityId", subject.value as "subjectValue", subject.type as "subjectType",
    candidate.relation_type as "relationType", candidate.target_type as "targetType",
    candidate.target_value as "targetValue", candidate.decision_kind as "decisionKind",
    candidate.policy_version as "policyVersion", candidate.verification_status as "verificationStatus",
    candidate.rationale, candidate.proposed_path as "proposedPath",
    event.title, event.body, event.source
  from semantic_candidates candidate
  left join entities subject on subject.id = candidate.subject_entity_id
  left join raw_events event on event.id = candidate.event_id
  where candidate.status = 'pending'
  order by candidate.created_at desc
`);

const findings: Array<{ id: string; reason: string; label: string }> = [];
for (const row of rows.rows) {
  const actionKind = semanticActionKind({
    decisionKind: row.decisionKind,
    subjectType: row.subjectType,
    targetType: row.targetType,
  });
  const label = row.targetValue;
  const reasons: string[] = [];
  // Every pending proposal from the pre-policy generation lacks verifier and
  // evidence contracts. It is superseded rather than silently approved.
  if (!row.policyVersion) reasons.push("legacy_policy_without_verification");
  if (row.verificationStatus === "rejected" || row.verificationStatus === "unavailable") reasons.push("verification_not_accepted");
  if (row.subjectValue && row.targetValue
    && row.subjectValue.trim().toLocaleLowerCase("es") === row.targetValue.trim().toLocaleLowerCase("es")
    && actionKind !== "associate_entities") {
    reasons.push("tautological_identical_endpoints");
  }
  if (["activity_instance", "financial_event", "email_message"].includes(row.subjectType ?? "")
    && ["create_category", "assign_existing_category"].includes(actionKind)
    && isRedundantProviderOrHeadingConcept({
      proposedValue: row.targetValue,
      source: row.source,
      eventTitle: row.title,
      subjectValue: row.subjectValue,
      supportedNames: [],
    })) {
    reasons.push("concept_restates_provider_or_heading");
  }
  if (actionKind === "associate_entities" && /^(?:both|ambos|ambas|las dos|los dos)\b/iu.test((row.rationale ?? "").trim())
    && /(?:same|mismo|misma|igual)\s+(?:app|aplicaci[oó]n|platform|plataforma|source|fuente|channel|canal)/iu.test(row.rationale ?? "")
    && !/\b(?:orders?|pedidos?|purchases?|compras?|deliver(?:y|ies)|entregas?|paid|pagos?)\b/iu.test(row.rationale ?? "")) {
    reasons.push("association_supported_only_by_shared_channel");
  }
  if (reasons.length) findings.push({ id: row.id, reason: reasons.join(","), label });
}

console.log(JSON.stringify({ dryRun: !apply, pending: rows.rows.length, supersede: findings.length, findings }, null, 2));
if (apply && findings.length) {
  await pool.query(`
    update semantic_candidates candidate
    set status = 'superseded',
      policy_version = coalesce(candidate.policy_version, 'legacy-pre-evidence'),
      verification_status = 'unavailable',
      verification = candidate.verification || jsonb_build_object('supersededReason', 'legacy_policy_backfill', 'supersededAt', now()::text),
      change_explanation = coalesce(candidate.change_explanation, 'Propuesta anterior a la política de evidencia; se reemplazará por una decisión verificada.'),
      superseded_by_candidate_id = null,
      updated_at = now()
    where candidate.id = any($1::text[]) and candidate.status = 'pending'
  `, [findings.map((finding) => finding.id)]);
}
await pool.end();
