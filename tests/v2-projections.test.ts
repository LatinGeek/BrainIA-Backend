import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { pool } from '../src/storage/postgres.ts';
import { classifyCapturedEvent, reprocessEvent, correlateFinancialEvent } from '../src/storage/event-store.ts';
import { persistSemanticDecision } from '../src/storage/semantic-resolver.ts';
import { insertRawEvent, countEventEvidence, replaceSemanticProjection, replaceClassificationFacts } from '../src/storage/event-repository.ts';
import { applyCorrectionProjection, correctionSnapshot, restoreCorrectionSnapshot } from '../src/storage/correction-projection.ts';
import { recordCorrection } from '../src/storage/correction-memory.ts';
import { mergeFinancialTransactions } from '../src/storage/financial-transaction-repository.ts';
import { SEMANTIC_GOVERNANCE_VERSION, SEMANTIC_PROMPT_VERSION, TAXONOMY_VERSION } from '../src/domain/ontology.ts';
import { classifyEvent } from '../src/domain/classification.ts';
import { deriveKnowledgeFacts } from '../src/storage/knowledge-fact-repository.ts';

process.env.DEEPSEEK_API_KEY='';
process.env.BRAINIA_LEARNING_ENABLED='false';

async function raw(clientId=randomUUID(), merchant=`Shop ${randomUUID()}`, timestamp='2026-10-15T10:00:00Z', reference?: string) {
  const event={id:randomUUID(),source:'capture.wallet',contractVersion:1,kind:'expense' as const,
    title:merchant,body:`Compra en ${merchant} por UYU 321`,timestamp,
    raw:{amount:321,currency:'UYU',merchant,transactionType:'expense',...(reference?{reference}:{})},tags:[]};
  await insertRawEvent(pool,event,clientId,`${clientId}:${event.id}`);
  return {event,clientId};
}
async function finance(eventId:string) {
  return (await pool.query(`select t.* from financial_transactions t join financial_transaction_events e
    on e.transaction_id=t.id where e.raw_event_id=$1`,[eventId])).rows[0];
}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// All database tests run against the explicitly preloaded isolated test engine.
test('B04 canonical finance identity and every user ledger field survive classification, semantics and retries',async()=>{
  const {event,clientId}=await raw();
  await classifyCapturedEvent(event.id);
  const first=await finance(event.id);
  assert.ok(first?.id);
  const account=randomUUID(), destination=randomUUID();
  await pool.query(`insert into financial_accounts(id,name,type,currency) values
    ($1,'Source','bank','UYU'),($2,'Destination','bank','UYU')`,[account,destination]);
  const fields={merchant:'User merchant',financialCategory:'User category',eventCategory:'User event',humanExplanation:'User explanation',inferredKind:'expense'};
  for(const [field,value] of Object.entries(fields)) {
    await recordCorrection(pool,{clientId,eventId:event.id,field,value});
    await applyCorrectionProjection(pool,event.id,field,value);
  }
  await pool.query(`update financial_transactions set amount=999,currency='USD',account_id=$2,
    destination_account_id=$3,destination_amount=998,destination_currency='UYU',excluded_from_reports=true where id=$1`,
    [first.id,account,destination]);
  const active=(row:any)=>[row.id,row.kind,row.amount,row.currency,row.merchant_label,row.category,row.account_id,
    row.destination_account_id,row.destination_amount,row.destination_currency,row.excluded_from_reports,row.hidden_at,row.merged_into_transaction_id];
  const before=active(await finance(event.id));
  const classificationBefore=(await pool.query('select * from classified_events where raw_event_id=$1',[event.id])).rows;
  await reprocessEvent(event.id,{reuseClassification:true,skipFinancial:true,ensureOntology:false});
  assert.deepEqual((await pool.query(`select id,inferred_kind,confidence,entities,model_metadata from classified_events where raw_event_id=$1`,[event.id])).rows,
    classificationBefore.map(({id,inferred_kind,confidence,entities,model_metadata})=>({id,inferred_kind,confidence,entities,model_metadata})));
  await classifyCapturedEvent(event.id);
  await correlateFinancialEvent(event.id);
  await reprocessEvent(event.id,{reuseClassification:true,skipFinancial:true,ensureOntology:false});
  assert.deepEqual(active(await finance(event.id)),before);
  const c=(await pool.query('select * from classified_events where raw_event_id=$1',[event.id])).rows[0];
  assert.equal(c.model_metadata.eventCategory,fields.eventCategory);
  assert.equal(c.model_metadata.humanExplanation,fields.humanExplanation);
  assert.equal(c.entities.find((e:any)=>e.type==='merchant').value,fields.merchant);
  assert.equal((await countEventEvidence(pool,event.id)).evidenceCount,1);
});

test('B04 semantic replacement changes only the selected owner/domain/generation and leaves financial orphans intact',async()=>{
  const {event,clientId}=await raw();
  const other=await raw();
  const domains=[randomUUID(),randomUUID()];
  const names=[`Finance ${randomUUID()}`,`Health ${randomUUID()}`];
  await pool.query(`insert into entities(id,type,value,normalized_value) values
    ($1,'domain',$2,$2),($3,'domain',$4,$4)`,[domains[0],names[0],domains[1],names[1]]);
  const generation=SEMANTIC_GOVERNANCE_VERSION;
  for(const [eventId,owner,domainIndex,version] of [
    [event.id,clientId,0,generation],[event.id,clientId,1,generation],
    [other.event.id,other.clientId,0,generation],[event.id,clientId,0,'older-generation'],
  ] as const) {
    const d=Number(domainIndex);
    await pool.query(`insert into semantic_candidates(id,event_id,client_id,relation_type,target_type,target_value,
      target_normalized_value,domain_value,governance_version) values($1,$2,$3,'part_of','concept',$4,$4,$5,$6)`,
      [randomUUID(),eventId,owner,randomUUID(),names[d],version]);
    await pool.query(`insert into semantic_observations(id,event_id,client_id,proposed_value,proposed_normalized_value,
      parent_entity_id,governance_version,confidence) values($1,$2,$3,$4,$4,$5,$6,0.9)`,
      [randomUUID(),eventId,owner,randomUUID(),domains[d],version]);
  }
  for(const [e,d] of [[event.id,0],[event.id,1],[other.event.id,0]] as const) await pool.query(`insert into
    event_semantic_anchors(event_id,domain_entity_id,anchor_entity_id,role,confidence,governance_version)
    values($1,$2,$2,'secondary',0.9,$3)`,[e,domains[d],generation]);
  await classifyCapturedEvent(other.event.id);
  const orphan=randomUUID();
  await pool.query(`insert into financial_transactions(id,kind,amount,currency,merchant_label,normalized_merchant,
    observed_at,window_start,window_end,evidence_count,match_score,match_strategy,primary_source)
    values($1,'expense',1,'UYU','Orphan','orphan',now(),now(),now(),0,1,'test','test')`,[orphan]);
  const untouched=async()=>({
    candidates:(await pool.query(`select * from semantic_candidates where event_id=any($1::text[])
      and not(event_id=$2 and domain_value=$3 and governance_version=$4) order by id`,[[event.id,other.event.id],event.id,names[0],generation])).rows,
    observations:(await pool.query(`select * from semantic_observations where event_id=any($1::text[])
      and not(event_id=$2 and parent_entity_id=$3 and governance_version=$4) order by id`,[[event.id,other.event.id],event.id,domains[0],generation])).rows,
    anchors:(await pool.query(`select * from event_semantic_anchors where event_id=any($1::text[])
      and not(event_id=$2 and domain_entity_id=$3) order by event_id,domain_entity_id`,[[event.id,other.event.id],event.id,domains[0]])).rows,
    financial:(await pool.query(`select * from financial_transactions where id=$1 or anchor_event_id=$2 order by id`,[orphan,other.event.id])).rows,
  });
  const before=hash(await untouched());
  await replaceSemanticProjection(pool,{eventId:event.id,clientId:'wrong-owner',generation,domains:[names[0]]});
  assert.equal(hash(await untouched()),before);
  await replaceSemanticProjection(pool,{eventId:event.id,clientId,generation,domains:[names[0]]});
  assert.equal(hash(await untouched()),before);
  assert.equal((await pool.query('select * from event_semantic_anchors where event_id=$1 and domain_entity_id=$2',[event.id,domains[0]])).rows.length,0);
  assert.equal((await pool.query('select * from semantic_candidates where event_id=$1 and domain_value=$2 and governance_version=$3',[event.id,names[0],generation])).rows.length,0);
});

test('B04 resolved semantic path preserves an unrelated-domain or older-generation primary anchor',async()=>{
  const {event,clientId}=await raw();
  const generation=SEMANTIC_GOVERNANCE_VERSION;
  const financeName=`Finance ${randomUUID()}`, healthName=`Health ${randomUUID()}`;
  const financeDomain=randomUUID(), healthDomain=randomUUID();
  await pool.query(`insert into entities(id,type,value,normalized_value) values
    ($1,'domain',$2,$3),($4,'domain',$5,$6)`,[financeDomain,financeName,financeName.toLowerCase(),healthDomain,healthName,healthName.toLowerCase()]);
  // Existing primary anchor from a different domain and older generation.
  await pool.query(`insert into event_semantic_anchors(event_id,domain_entity_id,anchor_entity_id,role,confidence,governance_version)
    values($1,$2,$2,'primary',0.9,'older-generation')`,[event.id,healthDomain]);
  const beforeAnchors=hash((await pool.query(`select * from event_semantic_anchors where event_id=$1 order by domain_entity_id`,[event.id])).rows);
  // The rebuild is scoped to the newly resolved Finance domain only.
  await replaceSemanticProjection(pool,{eventId:event.id,clientId,generation,domains:[financeName]});
  assert.equal(hash((await pool.query(`select * from event_semantic_anchors where event_id=$1 order by domain_entity_id`,[event.id])).rows),beforeAnchors);
  const subject={type:'financial_event' as const,value:`Event ${event.id}`,normalizedValue:`event ${event.id}`.toLowerCase(),
    metadata:{instance:true,eventId:event.id}};
  const result=await persistSemanticDecision(pool,{eventId:event.id,clientId,drafts:[],decision:{
    paths:[{subject,role:'primary',domain:financeName,action:'reuse',hierarchyPath:[financeName],steps:[],
      confidence:1,rationale:'Regression: resolved path must not delete an unrelated primary anchor.',eventAnchor:true}],
    associations:[],rootAlternatives:[{value:financeName,confidence:1}],
    governanceVersion:generation,promptVersion:SEMANTIC_PROMPT_VERSION,model:'test-model',status:'resolved',
    source:'deepseek',taxonomyVersion:TAXONOMY_VERSION,primaryCategoryKey:null,secondaryCategoryKeys:[],facets:[],
  }});
  assert.equal(result.appliedPaths,0);
  assert.equal(result.reviewPaths,1);
  const after=(await pool.query(`select * from event_semantic_anchors where event_id=$1 order by domain_entity_id`,[event.id])).rows;
  assert.equal(after.length,1);
  assert.equal(after[0].domain_entity_id,healthDomain);
  assert.equal(hash(after),beforeAnchors);
  const review=(await pool.query(`select * from semantic_candidates where event_id=$1 and domain_value=$2`,[event.id,financeName])).rows;
  assert.ok(review.length>=1);
  assert.ok(review.every((candidate:any)=>candidate.governance_version===generation));
});

test('B04 distinct observations and decision revisions are counted separately including consolidation retries',async()=>{
  const merchant=`Evidence ${randomUUID()}`;
  const reference=`same-${randomUUID()}`;
  const a=await raw(undefined,merchant,undefined,reference),b=await raw(a.clientId,merchant,undefined,reference);
  await classifyCapturedEvent(a.event.id);
  await classifyCapturedEvent(b.event.id);
  const canonical=await finance(a.event.id);
  assert.equal((await finance(b.event.id)).id,canonical.id);
  for(let i=0;i<3;i++) await pool.query(`insert into classification_decisions(id,event_id,client_id,provider,model,policy_version,result)
    values($1,$2,$3,'test','test','test','{}')`,[randomUUID(),a.event.id,a.clientId]);
  for(let i=0;i<3;i++) await classifyCapturedEvent(a.event.id);
  assert.deepEqual(await countEventEvidence(pool,a.event.id),{evidenceCount:2,revisionCount:3});
  assert.equal(Number((await finance(a.event.id)).evidence_count),2);
  const c=await raw(a.clientId,`${merchant} duplicate`,'2026-10-10T10:00:00Z');
  await classifyCapturedEvent(c.event.id);
  const duplicate=await finance(c.event.id);
  await mergeFinancialTransactions(canonical.id,duplicate.id);
  const before=hash(await finance(c.event.id));
  await classifyCapturedEvent(c.event.id);
  await correlateFinancialEvent(c.event.id);
  assert.equal(hash(await finance(c.event.id)),before);
  assert.deepEqual(await countEventEvidence(pool,a.event.id),{evidenceCount:3,revisionCount:3});
  assert.equal(Number((await finance(a.event.id)).evidence_count),3);
});

test('B04 classification facts preserve other domains and extractor generations; snapshot restore never deletes new canonical rows',async()=>{
  const {event,clientId}=await raw();
  const facts=deriveKnowledgeFacts({event,classified:classifyEvent(event),entities:[]});
  await replaceClassificationFacts(pool,{eventId:event.id,clientId,facts});
  await pool.query(`insert into knowledge_facts(id,client_id,event_id,fact_type,value,normalized_value,confidence,evidence,extractor_version)
    values($1,$2,$3,'health_observation','{}','health',1,'{}','user-v1'),
      ($4,$2,$3,'event_classification','{}','other-generation',1,'{}','older-v1')`,[randomUUID(),clientId,event.id,randomUUID()]);
  const unrelated=async()=>(await pool.query("select * from knowledge_facts where event_id=$1 and extractor_version<>'knowledge-fact-v1' order by id",[event.id])).rows;
  const before=hash(await unrelated());
  await replaceClassificationFacts(pool,{eventId:event.id,clientId,facts});
  assert.equal(hash(await unrelated()),before);
  const snapshot=await correctionSnapshot(pool,event.id);
  await classifyCapturedEvent(event.id);
  const id=(await finance(event.id)).id;
  await restoreCorrectionSnapshot(pool,event.id,snapshot);
  assert.equal((await finance(event.id)).id,id);
});



test('B04 identical observations from another owner cannot consolidate or mutate the original owner',async()=>{
  const merchant=`Owner ${randomUUID()}`;
  const a=await raw(undefined,merchant),b=await raw(undefined,merchant);
  await classifyCapturedEvent(a.event.id);
  const before=hash(await finance(a.event.id));
  await classifyCapturedEvent(b.event.id);
  assert.notEqual((await finance(a.event.id)).id,(await finance(b.event.id)).id);
  assert.equal(hash(await finance(a.event.id)),before);
  assert.deepEqual(await countEventEvidence(pool,a.event.id),{evidenceCount:1,revisionCount:0});
  assert.deepEqual(await countEventEvidence(pool,b.event.id),{evidenceCount:1,revisionCount:0});
});
