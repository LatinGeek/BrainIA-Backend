import { createHash } from 'node:crypto';
import { pool } from './postgres.js';
import { redactForModel } from './privacy.js';
import type { Evidence } from '../domain/intelligence.js';
import { hybridRetrieve } from './hybrid-retrieval.js';

export const evidenceFingerprint = (text:string) => createHash('sha256').update(text).digest('hex');
export async function collectIntelligenceEvidence(clientId:string|null,queries:string[],days=30) {
  const evidence:Evidence[]=[];
  const seen = new Set<string>();
  // Source-balanced retrieval; transport noise cannot consume the entire context.
  for (const query of queries.slice(0,3)) {
    const retrieved=query?await hybridRetrieve(query,{clientId,objectTypes:['event'],limit:20,includeGraph:false}):null;
    const candidateIds=retrieved?.results?.map((r:{objectId:string})=>r.objectId) ?? [];
    const {rows}=await pool.query(`with eligible as (
      select e.id,e.source,e.title,e.body,coalesce(e.timestamp,e.created_at) as occurred_at,
        p.redact_emails,p.redact_financial_identifiers,
        row_number() over(partition by e.source order by ts_rank(e.search_vector,websearch_to_tsquery('simple',$2)) desc,e.created_at desc) as source_rank
      from raw_events e left join source_processing_policies p
        on p.client_scope=coalesce(e.client_id,'anonymous') and lower(p.source)=lower(e.source)
      where e.client_id is not distinct from $1 and e.privacy_status='standard' and e.processing_allowed
        and coalesce(p.enabled,true) and coalesce(p.send_to_llm,true)
        and e.created_at >= now()-make_interval(days=>$3)
        and ($2='' or e.id=any($4) or e.search_vector @@ websearch_to_tsquery('simple',$2) or concat(e.title,' ',e.body) ilike '%'||$2||'%')
    ) select * from eligible where source_rank<=5 order by source_rank,occurred_at desc limit 25`,[clientId,query,days,candidateIds]);
    for (const row of rows) {
      if (seen.has(row.id) || evidence.length>=25) continue;
      seen.add(row.id);
      const text=redactForModel(`${row.title ?? ''}\n${row.body ?? ''}`.slice(0,5000),{redactEmails:row.redact_emails ?? true,redactFinancialIdentifiers:row.redact_financial_identifiers ?? true});
      evidence.push({id:`event:${row.id}`,eventIds:[row.id],source:row.source,title:redactForModel(row.title ?? row.source),text,occurredAt:new Date(row.occurred_at).toISOString(),fingerprint:evidenceFingerprint(text)});
    }
  }
  const {rows:totals}=await pool.query(`select t.currency,t.kind,
      sum(t.amount) filter(where t.observed_at>=now()-interval '7 days')::text as current,
      sum(t.amount) filter(where t.observed_at<now()-interval '7 days')::text as previous,
      (coalesce(sum(t.amount) filter(where t.observed_at>=now()-interval '7 days'),0)-coalesce(sum(t.amount) filter(where t.observed_at<now()-interval '7 days'),0))::text as change,
      count(*)::int as count,array_agg(distinct e.id) as ids
    from financial_transactions t join raw_events e on e.id=t.anchor_event_id
    left join source_processing_policies p on p.client_scope=coalesce(e.client_id,'anonymous') and lower(p.source)=lower(e.source)
    where e.client_id is not distinct from $1 and e.privacy_status='standard' and e.processing_allowed
      and coalesce(p.enabled,true) and coalesce(p.send_to_llm,true)
      and t.hidden_at is null and t.merged_into_transaction_id is null and not t.excluded_from_reports
      and t.currency_status in ('explicit','account_confirmed','user_confirmed')
      and t.amount_confirmed = true
      and upper(t.currency) <> 'UNKNOWN'
      and t.observed_at>=now()-interval '14 days'
    group by t.currency,t.kind order by t.currency,t.kind limit 5`,[clientId]);
  for (const row of totals) {
    const text=JSON.stringify({currency:row.currency,kind:row.kind,last7Days:row.current ?? '0',previous7Days:row.previous ?? '0',change:row.change,transactionCount:row.count,coverage:'Solo transacciones capturadas; no representa necesariamente el total real.'});
    evidence.push({id:`aggregate:${row.currency}:${row.kind}`,eventIds:row.ids,source:'Cálculo verificado',title:`${row.currency} · ${row.kind}`,text,occurredAt:new Date().toISOString(),fingerprint:evidenceFingerprint(text)});
  }
  return evidence;
}

export async function evidenceStillAllowed(clientId:string|null,evidence:Evidence[]) {
  const ids=[...new Set(evidence.flatMap(e=>e.eventIds))];
  if (!ids.length) return true;
  const {rows}=await pool.query(`select e.id from raw_events e left join source_processing_policies p
    on p.client_scope=coalesce(e.client_id,'anonymous') and lower(p.source)=lower(e.source)
    where e.id=any($1) and e.client_id is not distinct from $2 and e.privacy_status='standard'
      and e.processing_allowed and coalesce(p.enabled,true) and coalesce(p.send_to_llm,true)`,[ids,clientId]);
  return rows.length===ids.length;
}
