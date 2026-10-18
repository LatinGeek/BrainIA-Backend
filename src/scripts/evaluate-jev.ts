import { pool } from '../storage/postgres.js';

const minimumSupport=Number(process.env.JEV_EVALUATION_MIN_SUPPORT ?? 25);
const minimumPrecision=Number(process.env.JEV_EVALUATION_MIN_PRECISION ?? .95);
const {rows}=await pool.query<{kind:string;predicted:string;expected:string;confidence:string}>(`
  with truth as (
    select distinct on (event_id) event_id,client_id,value as expected,created_at
    from classification_corrections
    where field='inferredKind' and revoked_at is null
      and not exists (select 1 from classification_corrections older
        where older.event_id=classification_corrections.event_id
          and older.field='inferredKind' and older.created_at<classification_corrections.created_at)
    order by event_id,created_at,id
  )
  select d.result->'answers'->'kind'->>'choice' as predicted,t.expected,
    d.result->'answers'->'kind'->>'confidence' as confidence,t.expected as kind
  from truth t join lateral (
    select * from classification_decisions decision
    where decision.event_id=t.event_id and decision.client_id is not distinct from t.client_id
      and decision.created_at<t.created_at
      and decision.provider='typesafe' and decision.policy_version='jev-v1'
      and decision.result->'answers'->'kind'->>'choice' is not null
    order by decision.created_at desc,decision.id desc limit 1
  ) d on true
  order by d.created_at desc
`);
const groups=new Map<string,{support:number;correct:number;confidence:number}>();
for(const row of rows){const group=groups.get(row.predicted) ?? {support:0,correct:0,confidence:0};group.support++;group.correct+=Number(row.predicted===row.expected);group.confidence+=Number(row.confidence);groups.set(row.predicted,group);}
const report=[...groups].map(([kind,value])=>({kind,support:value.support,precision:value.correct/value.support,meanConfidence:value.confidence/value.support,eligible:value.support>=minimumSupport&&value.correct/value.support>=minimumPrecision})).sort((a,b)=>a.kind.localeCompare(b.kind));
console.log(JSON.stringify({evaluationType:'observational_pre_correction',warning:'Correction-selected sample; independent held-out validation is required before activation.',evaluated:rows.length,minimumSupport,minimumPrecision,candidateKinds:report.filter(r=>r.eligible).map(r=>r.kind),classes:report},null,2));
await pool.end();
