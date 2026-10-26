import { pool, withTransaction } from "../storage/postgres.js";
import { resolveSemanticCandidate, SemanticCandidateConflictError } from "../storage/semantic-repository.js";

const apply = process.argv.includes("--apply");
const clientArgument = process.argv.find((argument) => argument.startsWith("--client="));
const clientId = clientArgument ? clientArgument.slice("--client=".length) : null;

const result = await pool.query<{
  id: string; clientId: string | null; subjectType: string | null; targetValue: string; targetEntityId: string | null;
}>(`
  select candidate.id, candidate.client_id as "clientId", subject.type as "subjectType",
    candidate.target_value as "targetValue",
    (select canonical.id from entities matched
      left join entity_merges merged on merged.alias_entity_id = matched.id
      join entities canonical on canonical.id = coalesce(merged.canonical_entity_id, matched.id)
      where matched.normalized_value = candidate.target_normalized_value and matched.type = candidate.target_type
      order by case canonical.type when 'domain' then 0 when 'concept' then 1 else 2 end, canonical.created_at asc
      limit 1) as "targetEntityId"
  from semantic_candidates candidate
  left join entities subject on subject.id = candidate.subject_entity_id
  where candidate.status = 'pending'
    and candidate.action_kind = 'assign_existing_category'
    and candidate.decision_kind = 'reuse'
    and candidate.verification_status in ('verified', 'not_required')
    and subject.type in ('activity_instance', 'financial_event', 'email_message')
    and ($1::text is null or candidate.client_id is not distinct from $1)
  order by candidate.created_at
`, [clientId]);

const eligible = result.rows.filter((row) => row.targetEntityId);
console.log(JSON.stringify({ dryRun: !apply, pending: result.rows.length, eligible: eligible.length, skippedMissingTarget: result.rows.length - eligible.length }, null, 2));
if (!apply) {
  await pool.end();
  process.exit(0);
}

let approved = 0;
let conflicted = 0;
for (const row of eligible) {
  try {
    const resolved = await withTransaction((db) => resolveSemanticCandidate(db, row.id, {
      action: "approve",
      clientId: row.clientId,
      createRule: false,
    }));
    if (resolved) approved += 1;
  } catch (error) {
    conflicted += 1;
    const reason = error instanceof SemanticCandidateConflictError ? `${error.code}: ${error.message}` : String(error);
    await pool.query(`
      update semantic_candidates set status = 'superseded',
        verification = verification || jsonb_build_object('supersededReason', 'verified_assignment_not_applicable', 'supersededDetail', $2::text),
        change_explanation = coalesce(change_explanation, 'Asignación verificada que ya no aplica al estado actual del grafo.'),
        updated_at = now()
      where id = $1 and status = 'pending'
    `, [row.id, reason.slice(0, 500)]);
  }
}
console.log(JSON.stringify({ approved, conflicted, remaining: eligible.length - approved - conflicted }, null, 2));
await pool.end();
