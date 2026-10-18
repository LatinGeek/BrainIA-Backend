import { randomUUID } from 'node:crypto';
import type { EventInput, ClassifiedEvent } from '../domain/event.js';
import { eventKindSchema } from '../domain/event.js';
import { pool } from './postgres.js';

export function learningDescriptor(event: Pick<EventInput,'title'|'body'>) {
  // Exact contextual reuse; never fuzzy-match financial descriptors or strip amounts.
  return `${event.title ?? ''}\n${event.body ?? ''}`.normalize('NFKC').replace(/\s+/g,' ').trim().toLocaleLowerCase();
}
export async function applyConfirmedCorrections(event: EventInput, base: ClassifiedEvent, clientId: string|null) {
  const {rows} = await pool.query<{id:string;field:string;value:string;event_id:string}>(`
    select id,field,value,event_id from classification_corrections where client_id is not distinct from $1
    and exists(select 1 from raw_events e left join source_processing_policies p
      on p.client_scope=coalesce(e.client_id,'anonymous') and lower(p.source)=lower(e.source)
      where e.id=classification_corrections.event_id and e.privacy_status='standard' and e.processing_allowed
      and coalesce(p.enabled,true))
    and revoked_at is null and (event_id=$2 or (reusable and source=$3 and descriptor=$4))
    order by (event_id=$2) desc,created_at desc limit 50`,[clientId,event.id,event.source,learningDescriptor(event)]);
  const result = {...base,entities:[...base.entities]};
  const used:string[]=[];
  for (const field of ['inferredKind','merchant','financialCategory','eventCategory','humanExplanation','category','entity']) {
    const matches=rows.filter(r=>r.field===field);
    const own=matches.find(r=>r.event_id===event.id);
    if (!own && new Set(matches.map(r=>r.value)).size>1) continue;
    const correction=own ?? matches[0];
    if (!correction) continue;
    if (field==='inferredKind') {
      result.inferredKind=eventKindSchema.parse(correction.value);result.confidence=1;
    } else if (field==='merchant') {
      result.entities=result.entities.filter(e=>e.type!=='merchant');
      result.entities.push({type:'merchant',value:correction.value});
    } else if (field==='financialCategory'||field==='eventCategory'||field==='humanExplanation') {
      result.modelMetadata={...result.modelMetadata,[field]:correction.value};
    }
    used.push(correction.id);
  }
  const financialCategory=rows.find(r=>r.field==='financialCategory'&&r.event_id===event.id) ?? rows.find(r=>r.field==='category'&&r.event_id===event.id);
  return {...result,modelMetadata:{...result.modelMetadata,correctionIds:used,confirmedFinancialCategory:financialCategory?.value}};
}
export async function recordCorrection(db: Pick<typeof pool,'query'>, input:{clientId:string|null;eventId:string;field:string;value:string;reusable?:boolean}) {
  const {rows}=await db.query('select source,title,body from raw_events where id=$1 and client_id is not distinct from $2',[input.eventId,input.clientId]);
  if (!rows[0]) throw new Error('event_not_found');
  await db.query('update classification_corrections set revoked_at=now() where event_id=$1 and field=$2 and revoked_at is null',[input.eventId,input.field]);
  const id=randomUUID();
  await db.query('insert into classification_corrections(id,client_id,event_id,source,descriptor,field,value,reusable) values($1,$2,$3,$4,$5,$6,$7,$8)',
    [id,input.clientId,input.eventId,rows[0].source,learningDescriptor(rows[0]),input.field,input.value,input.reusable ?? true]);
  return {id};
}
