import { pool } from '../storage/postgres.js';
import { eventKindSchema } from '../domain/event.js';
import { authorizeModelDispatch, redactForModel } from '../storage/privacy.js';
import type { z } from 'zod';

type EventKind = z.infer<typeof eventKindSchema>;

// This script sends event text to an evaluation provider. It is not a runtime
// path and must not be usable as an accidental bulk-egress tool. Refuse unless
// an operator explicitly names one approved owner, an external-evaluation
// opt-in, and a documented reason. Even then every row is authorized and
// redacted individually through the same gate as runtime classification.
const approvedOwner = process.env.LAYA_EVALUATION_OWNER?.trim();
const externalApproved = process.env.LAYA_EVALUATION_EXTERNAL_APPROVED?.trim().toLowerCase() === 'true';
const evaluationReason = process.env.LAYA_EVALUATION_REASON?.trim();
if (!approvedOwner || !externalApproved || !evaluationReason || evaluationReason.length < 10) {
  console.error(
    'evaluate-laya refused: set LAYA_EVALUATION_OWNER, LAYA_EVALUATION_EXTERNAL_APPROVED=true and a documented LAYA_EVALUATION_REASON. Raw events are never dispatched without the privacy gate.',
  );
  await pool.end();
  process.exit(1);
}

const baseUrl=(process.env.JEV_BASE_URL ?? 'http://127.0.0.1:8000').replace(/\/+$/,'');
const apiKey=process.env.JEV_API_KEY;
const sampleSize=Math.min(500,Math.max(25,Number(process.env.LAYA_EVALUATION_SAMPLE ?? 240)));
const kinds=[...eventKindSchema.options];
const questions={kind:{type:'choice',instructions:'Clasifica el evento real, no el transporte. Un movimiento financiero completado es gasto, ingreso o transferencia; un aviso sin movimiento confirmado es notification.',criteria:Object.fromEntries(kinds.map(kind=>[kind,kind]))}};
type Row={id:string;title:string|null;body:string|null;source:string;expected:EventKind};
type Answer={choice:EventKind;confidence:number;probabilities:Record<string,number>};

const {rows}=await pool.query<Row>(`select e.id,e.title,e.body,e.source,c.inferred_kind as expected
  from raw_events e join classified_events c on c.raw_event_id=e.id
  where e.privacy_status='standard' and e.processing_allowed
    and coalesce(e.owner_id,e.client_id)=$2
  order by e.created_at desc limit $1`,[sampleSize,approvedOwner]);

const predictions:{expected:EventKind;answer:Answer}[]=[];
for(const row of rows){
  const authorization=await authorizeModelDispatch(pool,{
    ownerId:approvedOwner,
    purpose:'event_classification',
    sources:[row.source],
    eventIds:[row.id],
  });
  if(!authorization.allowed)continue;
  const safeTitle=redactForModel(row.title ?? '',authorization.redaction);
  const safeBody=redactForModel(row.body ?? '',authorization.redaction).slice(0,4000);
  const response=await fetch(`${baseUrl}/v1/systemone`,{method:'POST',headers:{...(apiKey?{Authorization:`Bearer ${apiKey}`}:{ }),'Content-Type':'application/json'},body:JSON.stringify({model:process.env.JEV_MODEL ?? 'multilingual',state:{source:row.source,title:safeTitle || null,body:safeBody || null},questions}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)continue;
  const payload=await response.json() as {answers?:{kind?:Answer}};
  const answer=payload.answers?.kind;
  if(answer && kinds.includes(answer.choice))predictions.push({expected:row.expected,answer});
}

const nll=(temperature:number)=>predictions.reduce((sum,item)=>{
  const weights=kinds.map(kind=>Math.pow(Math.max(item.answer.probabilities[kind] ?? 0,1e-9),1/temperature));
  const total=weights.reduce((a,b)=>a+b,0);
  return sum-Math.log(Math.max(weights[kinds.indexOf(item.expected)]/total,1e-9));
},0)/Math.max(predictions.length,1);
let bestTemperature=1;for(let t=.5;t<=5.0001;t+=.05)if(nll(t)<nll(bestTemperature))bestTemperature=Number(t.toFixed(2));
const calibrated=(item:{answer:Answer})=>{const weights=kinds.map(kind=>Math.pow(Math.max(item.answer.probabilities[kind] ?? 0,1e-9),1/bestTemperature));const total=weights.reduce((a,b)=>a+b,0);return Object.fromEntries(kinds.map((kind,i)=>[kind,weights[i]/total]));};
const rawCorrect=predictions.filter(item=>item.answer.choice===item.expected).length;
const byKind=Object.fromEntries(kinds.map(kind=>{const items=predictions.filter(item=>item.answer.choice===kind);const correct=items.filter(item=>item.expected===kind).length;return [kind,{support:items.length,precision:items.length?correct/items.length:null,meanConfidence:items.length?items.reduce((s,item)=>s+item.answer.confidence,0)/items.length:null}]}));
console.log(JSON.stringify({labelSource:'existing_classified_events_not_human_ground_truth',requested:rows.length,evaluated:predictions.length,rawAccuracy:predictions.length?rawCorrect/predictions.length:null,bestTemperature,nllAtOne:nll(1),nllAfter:nll(bestTemperature),byPredictedKind:byKind,activationRecommendation:'Keep shadow mode. Collect confirmed inferredKind corrections and rerun on a held-out sample before enabling any class.'},null,2));
await pool.end();
