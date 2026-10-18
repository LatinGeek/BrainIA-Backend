import { createArtifact, getArtifact, runIntelligenceStep } from '../storage/intelligence.js';
import { pool } from '../storage/postgres.js';
import { generateNaturalLanguageSummary } from '../storage/deepseek.js';
import { intelligenceContentSchema } from '../domain/intelligence.js';

if (process.env.BRAINIA_LIVE_VALIDATION !== 'true') {
  throw new Error('Set BRAINIA_LIVE_VALIDATION=true to run a provider validation.');
}
if (!process.env.DEEPSEEK_API_KEY) {
  throw new Error('DEEPSEEK_API_KEY is required for live intelligence validation.');
}

const startedAt = new Date();
const artifact = process.env.BRAINIA_VALIDATION_ARTIFACT_ID
  ? await getArtifact(process.env.BRAINIA_VALIDATION_ARTIFACT_ID, null)
  : await createArtifact({
    clientId: null,
    kind: 'answer',
    objective: 'Validación de producción: resume únicamente cambios financieros o compromisos explícitos recientes respaldados por la evidencia disponible. Si no hay evidencia suficiente, indícalo.',
  });

if (!artifact) throw new Error('Could not create the validation artifact.');

let current = await getArtifact(artifact.id, null);
for (let step = 0; step < 6 && current && ['queued', 'running'].includes(current.status); step += 1) {
  await runIntelligenceStep(artifact.id, artifact.revision);
  current = await getArtifact(artifact.id, null);
}

const audit = await pool.query<{
  operation: string; status: string; model: string; input_tokens: number; output_tokens: number; latency_ms: number; error_code: string | null;
}>(`select operation,status,model,input_tokens,output_tokens,latency_ms,error_code
    from model_call_audits
    where completed_at >= $1 and operation like 'intelligence_%'
    order by completed_at asc`, [startedAt]);

const providerResponse = await generateNaturalLanguageSummary({
  apiKey: process.env.DEEPSEEK_API_KEY,
  model: process.env.DEEPSEEK_KNOWLEDGE_MODEL ?? 'deepseek-flash',
  thinking: true,
  jsonMode: true,
  maxTokens: 2_000,
  timeoutMs: 55_000,
  systemPrompt: 'Devuelve solamente JSON válido y sin Markdown.',
  userPrompt: JSON.stringify({
    requiredShape: { title: 'texto', summary: 'texto', claims: [{ id: 'c1', kind: 'fact', text: 'texto', citations: [{ evidenceId: 'event:validation', quote: 'Evidencia de prueba' }] }], uncertainty: ['texto'], actions: ['texto'] },
    evidence: [{ id: 'event:validation', text: 'Evidencia de prueba' }],
  }),
  audit: { clientId: null, operation: 'intelligence_provider_contract', promptVersion: 'intelligence-v1' },
});
let providerContractValid = false;
try { intelligenceContentSchema.parse(JSON.parse(providerResponse ?? '')); providerContractValid = true; } catch { /* reported below */ }

console.log(JSON.stringify({
  artifactId: artifact.id,
  status: current?.status ?? 'missing',
  claimCount: current?.content?.claims.length ?? 0,
  evidenceCount: current?.evidence.length ?? 0,
  providerContractValid,
  audit: audit.rows,
}, null, 2));

await pool.end();
