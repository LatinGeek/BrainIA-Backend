import { pool } from './postgres.js';
import { eventKindSchema, type ClassifiedEvent } from '../domain/event.js';
type DB=Pick<typeof pool,'query'>;
export async function correctionSnapshot(db:DB,eventId:string){
  const classification=(await db.query('select inferred_kind,confidence::text,entities,model_metadata from classified_events where raw_event_id=$1 for update',[eventId])).rows[0] ?? null;
  const financial=(await db.query('select id,kind,category,merchant_label,excluded_from_reports,amount::text,currency,account_id,destination_account_id from financial_transactions where anchor_event_id=$1 order by id for update',[eventId])).rows;
  return {classification,financial};
}
export async function restoreCorrectionSnapshot(db:DB,eventId:string,snapshot:Awaited<ReturnType<typeof correctionSnapshot>>){
  if(snapshot.classification){const c=snapshot.classification;
    await db.query('update classified_events set inferred_kind=$2,confidence=$3,entities=$4,model_metadata=$5 where raw_event_id=$1',
      [eventId,c.inferred_kind,c.confidence,JSON.stringify(c.entities),JSON.stringify(c.model_metadata)]);
  }
  for(const f of snapshot.financial)await db.query('update financial_transactions set kind=$2,category=$3,merchant_label=$4,excluded_from_reports=$5,amount=$6,currency=$7,account_id=$8,destination_account_id=$9,updated_at=now() where id=$1',
    [f.id,f.kind,f.category,f.merchant_label,f.excluded_from_reports,f.amount,f.currency,f.account_id,f.destination_account_id]);
}
export async function applyCorrectionProjection(db:DB,eventId:string,field:string,value:string){
  if(field==='inferredKind'){
    if(value==='transfer'){
      const invalid=await db.query('select id from financial_transactions where anchor_event_id=$1 and (account_id is null or destination_account_id is null or account_id=destination_account_id)',[eventId]);
      if(invalid.rows.length)throw new Error('transfer_requires_accounts');
    }
    await db.query('update classified_events set inferred_kind=$2,confidence=1 where raw_event_id=$1',[eventId,value]);
    if(['expense','income','transfer'].includes(value))await db.query('update financial_transactions set kind=$2,excluded_from_reports=false,updated_at=now() where anchor_event_id=$1',[eventId,value]);
    else await db.query('update financial_transactions set excluded_from_reports=true,updated_at=now() where anchor_event_id=$1',[eventId]);
  }
  if(field==='merchant'){
    await db.query(`update classified_events set entities=coalesce((select jsonb_agg(e) from jsonb_array_elements(entities) e where e->>'type'<>'merchant'),'[]')||$2::jsonb where raw_event_id=$1`,[eventId,JSON.stringify([{type:'merchant',value}])]);
    await db.query('update financial_transactions set merchant_label=$2,updated_at=now() where anchor_event_id=$1',[eventId,value]);
  }
  if(field==='category')await db.query('update financial_transactions set category=$2,updated_at=now() where anchor_event_id=$1',[eventId,value]);
  if(field==='financialCategory')await db.query('update financial_transactions set category=$2,updated_at=now() where anchor_event_id=$1',[eventId,value]);
  if(field==='eventCategory'||field==='humanExplanation')await db.query(
    `update classified_events
     set model_metadata=jsonb_set(coalesce(model_metadata,'{}'::jsonb),array[$2],to_jsonb($3::text),true)
     where raw_event_id=$1`,[eventId,field,value]);
}

// Exact event overlays are durable user decisions; learning flags control reuse
// across events, never whether a user's own correction survives rebuilding.
async function activeCorrections(db: DB, eventId: string) {
  return (await db.query<{field: string; value: string}>(`
    select distinct on (c.field) c.field,c.value from classification_corrections c
    join raw_events r on r.id=c.event_id and r.client_id is not distinct from c.client_id
    where c.event_id=$1 and c.revoked_at is null order by c.field,c.created_at desc,c.id desc
  `, [eventId])).rows;
}

export async function preserveCorrectionOverlay(db: DB, eventId: string, inferred: ClassifiedEvent): Promise<ClassifiedEvent> {
  const result = {...inferred, entities: [...inferred.entities], modelMetadata: {...inferred.modelMetadata}};
  for (const c of await activeCorrections(db, eventId)) {
    if (c.field === 'inferredKind') { result.inferredKind=eventKindSchema.parse(c.value); result.confidence=1; }
    if (c.field === 'merchant') result.entities=[...result.entities.filter(e=>e.type!=='merchant'),{type:'merchant',value:c.value}];
    if (['eventCategory','humanExplanation','financialCategory','category'].includes(c.field)) {
      result.modelMetadata[c.field]=c.value;
    }
  }
  return result;
}

export async function reapplyCorrectionOverlay(db: DB, eventId: string) {
  for (const c of await activeCorrections(db,eventId)) {
    // Kind teaching originally updates the ledger explicitly. Replaying it
    // must not reset a later exclusion/balance-adjustment decision.
    if (c.field === 'inferredKind') await db.query(
      'update classified_events set inferred_kind=$2,confidence=1 where raw_event_id=$1',[eventId,c.value]);
    else await applyCorrectionProjection(db,eventId,c.field,c.value);
  }
}
