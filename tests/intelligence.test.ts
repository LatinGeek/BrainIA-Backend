import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { pool } from '../src/storage/postgres.js';
import { buildApp } from '../src/app.js';
import { createArtifact,runIntelligenceStep,getArtifact } from '../src/storage/intelligence.js';
import { collectIntelligenceEvidence } from '../src/storage/intelligence-evidence.js';
import { scheduleWindow,validateCitations,intelligenceContentSchema } from '../src/domain/intelligence.js';
import { applyConfirmedCorrections } from '../src/storage/correction-memory.js';
import { parseJevDecision,mayApplyJev } from '../src/storage/jev.js';
import { classifyEvent } from '../src/domain/classification.js';
import { requestSemanticJson } from '../src/storage/semantic-enrichment.js';
import { applyCorrectionProjection,correctionSnapshot,restoreCorrectionSnapshot } from '../src/storage/correction-projection.js';
import { upsertSourceProcessingPolicy } from '../src/storage/privacy.js';

async function seed(clientId:string|null=null){
  const id=randomUUID();
  await pool.query("insert into raw_events(id,source,kind,title,body,client_id,dedupe_key) values($1,'test-source','note','Compra de café','Compra de café confirmada.', $2,$1)",[id,clientId]);
  await pool.query("insert into classified_events(id,raw_event_id,inferred_kind,confidence) values($1,$2,'note',.7)",[randomUUID(),id]);
  return id;
}
test('migration keeps new tables private from public API roles',async()=>{
  const {rows}=await pool.query("select relrowsecurity,has_table_privilege('anon',oid,'SELECT') as anon from pg_class where relname='intelligence_artifacts'");
  assert.equal(rows[0].relrowsecurity,true);assert.equal(rows[0].anon,false);
});
test('evidence enforces exact legacy scope and source privacy',async()=>{
  const own=await seed();const other=await seed('other');
  const evidence=await collectIntelligenceEvidence(null,['café']);
  assert.ok(evidence.some(e=>e.eventIds.includes(own)));assert.ok(!evidence.some(e=>e.eventIds.includes(other)));
  await pool.query("update raw_events set privacy_status='private' where id=$1",[own]);
  assert.ok(!(await collectIntelligenceEvidence(null,['café'])).some(e=>e.eventIds.includes(own)));
});
test('daily schedule respects Montevideo time and Monday weekly boundary',()=>{
  assert.equal(scheduleWindow(new Date('2026-09-21T10:59:00Z')).due,false);
  assert.deepEqual(scheduleWindow(new Date('2026-09-21T11:00:00Z')),{date:'2026-09-21',due:true,weekly:true});
});
test('citations reject fabricated references, quotes and uncomputed arithmetic',()=>{
  const draft=intelligenceContentSchema.parse({title:'Café',summary:'Café',claims:[{id:'c',kind:'calculation',text:'100',citations:[{evidenceId:'missing',quote:'invented'}]}],uncertainty:[],actions:[]});
  const fabricatedErrors=validateCitations(draft,[]);assert.ok(fabricatedErrors.includes('unknown_evidence:missing'));assert.ok(fabricatedErrors.includes('unverified_calculation:c'));
  const calculated=intelligenceContentSchema.parse({title:'Cambio',summary:'Cambio',claims:[{id:'c2',kind:'calculation',text:'El cambio fue 50%.',citations:[{evidenceId:'aggregate:UYU:expense',quote:'"change":"100"'}]}],uncertainty:[],actions:[]});
  const aggregate={id:'aggregate:UYU:expense',eventIds:[],source:'Cálculo',title:'UYU',text:'{"change":"100"}',occurredAt:new Date().toISOString(),fingerprint:'x'};
  assert.ok(validateCitations(calculated,[aggregate]).some(error=>error.startsWith('unsupported_number')));
});
test('Jev fails closed and cannot override declined payments or unvalidated classes',()=>{
  const probabilities=Object.fromEntries(['email','expense','income','note','notification','task','transfer','other'].map(k=>[k,k==='expense'?1:0]));
  const decision=parseJevDecision({model:'jev-test',answers:{kind:{choice:'expense',confidence:1,probabilities}}});
  const event={id:'x',source:'bank',kind:'notification' as const,title:'Transacción rechazada tarjeta',contractVersion:1,raw:{},tags:[]};
  process.env.JEV_VALIDATED_KINDS='expense';assert.equal(mayApplyJev(event,classifyEvent(event),decision),false);
  delete process.env.JEV_VALIDATED_KINDS;assert.equal(mayApplyJev({...event,title:'x'},classifyEvent({...event,title:'x'}),decision),false);
  assert.throws(()=>parseJevDecision({model:'x',answers:{kind:{choice:'expense',confidence:1,probabilities:{expense:2}}}}));
});
test('generation checkpoints validate citations, complete, and respect later privacy changes',async()=>{
  process.env.BRAINIA_INTELLIGENCE_ENABLED='true';process.env.DEEPSEEK_API_KEY='test-key';
  // External dispatch now fails closed without an explicit source policy.
  await upsertSourceProcessingPolicy(pool,{clientId:'generation',ownerId:'generation',source:'test-source',enabled:true,sendToLlm:true});
  const event=await seed('generation');const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(_url,init)=>{
    const request=JSON.parse(String(init?.body));assert.equal(request.thinking.type,'enabled');assert.equal(request.reasoning_effort,'high');calls++;
    const data=JSON.parse(request.messages[1].content);
    const content=calls===1?{queries:['café']}:calls===2?{title:'Compra registrada',summary:'Hay una compra de café registrada.',claims:[{id:'c1',kind:'inference',text:'La compra podría relacionarse con una rutina.',citations:[{evidenceId:`event:${event}`,quote:'Compra de café confirmada.'}]}],uncertainty:['Una compra aislada no confirma un hábito.'],actions:[]}:{supported:true,errors:[]};
    if(calls===2)assert.ok(data.evidence.some((e:{id:string})=>e.id===`event:${event}`));
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}],usage:{prompt_tokens:100,completion_tokens:50}}),{status:200});
  };
  try{
    const a=(await createArtifact({clientId:'generation',kind:'answer',objective:'¿Qué compré?'}))!;
    for(let i=0;i<3;i++)await runIntelligenceStep(a.id,1);
    const ready=await getArtifact(a.id,'generation');assert.equal(ready?.status,'ready');assert.equal(ready?.content?.claims.length,1);assert.equal(calls,3);
    const app=await buildApp({authConfig:{globalApiKey:null,clientKeys:new Map([['generation','secret']])}});
    const headers={'x-brainia-client-id':'generation','x-brainia-api-key':'secret'};
    try{
      assert.equal((await app.inject({method:'POST',url:`/api/v1/intelligence/artifacts/${a.id}/confirm`,headers,payload:{claimId:'c1',revision:2,confirmed:true}})).statusCode,409);
      assert.equal((await app.inject({method:'POST',url:`/api/v1/intelligence/artifacts/${a.id}/confirm`,headers,payload:{claimId:'c1',revision:1,confirmed:true}})).statusCode,200);
      assert.deepEqual((await getArtifact(a.id,'generation') as typeof ready & {confirmedClaims:string[]}).confirmedClaims,['c1']);
    }finally{await app.close();}
    assert.equal(await getArtifact(a.id,null),null);
    await pool.query("update raw_events set privacy_status='hidden' where id=$1",[event]);
    const hidden=await getArtifact(a.id,'generation');assert.equal(hidden?.status,'stale');assert.equal(hidden?.content,null);assert.deepEqual(hidden?.evidence,[]);
    assert.equal((await pool.query('select count(*)::int n from intelligence_confirmations where artifact_id=$1',[a.id])).rows[0].n,0);
  }finally{globalThis.fetch=original;process.env.DEEPSEEK_API_KEY='';process.env.BRAINIA_INTELLIGENCE_ENABLED='false';}
});
test('correction applies, learns, and undoes without overwriting concurrent edits',async()=>{
  process.env.BRAINIA_LEARNING_ENABLED='true';
  const eventId=await seed('correction');
  const app=await buildApp({authConfig:{globalApiKey:null,clientKeys:new Map([['correction','secret']])}});
  const headers={'x-brainia-client-id':'correction','x-brainia-api-key':'secret'};
  try{
    const response=await app.inject({method:'POST',url:'/api/v1/classification/corrections',headers,payload:{eventId,field:'merchant',value:'Café real'}});
    assert.equal(response.statusCode,200,response.body);const {id}=response.json();
    const event={id:'future',source:'test-source',title:'Compra de café',body:'Compra de café confirmada.',kind:'note' as const,contractVersion:1,raw:{},tags:[]};
    const learned=await applyConfirmedCorrections(event,classifyEvent(event),'correction');assert.equal(learned.entities.find(e=>e.type==='merchant')?.value,'Café real');
    assert.equal((await app.inject({method:'POST',url:`/api/v1/classification/corrections/${id}/undo`,headers})).statusCode,200);
    const undone=await applyConfirmedCorrections(event,classifyEvent(event),'correction');assert.ok(!undone.entities.some(e=>e.value==='Café real'));
  }finally{await app.close();process.env.BRAINIA_LEARNING_ENABLED='false';}
});
test('teaching a transaction persists its category and explanation',async()=>{
  process.env.BRAINIA_LEARNING_ENABLED='true';
  const eventId=await seed('teach');
  const app=await buildApp({authConfig:{globalApiKey:null,clientKeys:new Map([['teach','secret']])}});
  const headers={'x-brainia-client-id':'teach','x-brainia-api-key':'secret'};
  try{
    const response=await app.inject({method:'POST',url:'/api/v1/classification/teach',headers,payload:{
      eventId,kind:'expense',financialCategory:'Subscriptions',explanation:'Suscripción a ChatGPT Plus',
    }});
    assert.equal(response.statusCode,200,response.body);
    const fields=(await pool.query('select field from classification_corrections where event_id=$1 order by field',[eventId])).rows.map(row=>row.field);
    assert.deepEqual(fields,['financialCategory','humanExplanation','inferredKind']);
  }finally{await app.close();process.env.BRAINIA_LEARNING_ENABLED='false';}
});
test('historical preview rejects revoked learning and concurrent projection edits',async()=>{
  process.env.BRAINIA_LEARNING_ENABLED='true';
  const eventId=await seed('preview');const target=await seed('preview');
  const app=await buildApp({authConfig:{globalApiKey:null,clientKeys:new Map([['preview','secret']])}});
  const headers={'x-brainia-client-id':'preview','x-brainia-api-key':'secret'};
  try{
    const correction=(await app.inject({method:'POST',url:'/api/v1/classification/corrections',headers,payload:{eventId,field:'merchant',value:'Café confirmado'}})).json();
    const preview=await app.inject({method:'POST',url:`/api/v1/classification/corrections/${correction.id}/preview`,headers});
    assert.equal(preview.statusCode,200,preview.body);
    const run=preview.json();assert.ok(run.changes.some((c:{eventId:string})=>c.eventId===target));
    await pool.query("update classified_events set confidence=.8 where raw_event_id=$1",[target]);
    const stale=await app.inject({method:'POST',url:`/api/v1/classification/reclassification/${run.id}/apply`,headers,payload:{eventIds:[target]}});
    assert.equal(stale.statusCode,409);assert.equal(stale.json().error,'preview_stale');
    await pool.query('update classification_corrections set revoked_at=now() where id=$1',[correction.id]);
    const revoked=await app.inject({method:'POST',url:`/api/v1/classification/reclassification/${run.id}/apply`,headers,payload:{eventIds:[target]}});
    assert.equal(revoked.statusCode,409);assert.equal(revoked.json().error,'correction_revoked');
  }finally{await app.close();process.env.BRAINIA_LEARNING_ENABLED='false';}
});
test('financial correction restores report inclusion and exact undo snapshot',async()=>{
  const eventId=await seed('projection');const transactionId=randomUUID();
  await pool.query(`insert into financial_transactions(id,kind,amount,currency,merchant_label,normalized_merchant,observed_at,window_start,window_end,primary_source,anchor_event_id,excluded_from_reports)
    values($1,'expense',10,'UYU','Café','cafe',now(),now(),now(),'test-source',$2,true)`,[transactionId,eventId]);
  const before=await correctionSnapshot(pool,eventId);
  await pool.query('update financial_transactions set amount=20 where id=$1',[transactionId]);
  assert.notDeepEqual(await correctionSnapshot(pool,eventId),before);
  await applyCorrectionProjection(pool,eventId,'inferredKind','expense');
  assert.equal((await pool.query('select excluded_from_reports from financial_transactions where id=$1',[transactionId])).rows[0].excluded_from_reports,false);
  await restoreCorrectionSnapshot(pool,eventId,before);
  assert.deepEqual(await correctionSnapshot(pool,eventId),before);
  assert.equal((await pool.query('select excluded_from_reports from financial_transactions where id=$1',[transactionId])).rows[0].excluded_from_reports,true);
});
test('telemetry is idempotent and rejects raw content',async()=>{
  const app=await buildApp({authConfig:{globalApiKey:null,clientKeys:new Map()}});
  try{
    const event={id:randomUUID(),sessionId:'session',screen:'today',action:'view',occurredAt:new Date().toISOString()};
    for(let i=0;i<2;i++)assert.equal((await app.inject({method:'POST',url:'/api/v1/interactions/batch',payload:{events:[event]}})).statusCode,200);
    assert.equal((await pool.query('select count(*)::int n from interaction_events where id=$1',[event.id])).rows[0].n,1);
    assert.equal((await app.inject({method:'POST',url:'/api/v1/interactions/batch',payload:{events:[{...event,body:'secret'}]}})).statusCode,400);
  }finally{await app.close();}
});
test('semantic repair receives validation errors instead of repeating the same prompt',async()=>{
  const prompts:string[]=[];
  const result=await requestSemanticJson({apiKey:'fake',model:'fake',systemPrompt:'schema',userPrompt:'evidence',clientId:null,eventId:null,
    policy:{enabled:true,sendToLlm:true,redactEmails:true,redactFinancialIdentifiers:true,retentionDays:null},
    completion:async input=>{prompts.push(input.userPrompt);return prompts.length===1?'{}':'{"rootAlternatives":[{"value":"Finance","confidence":1}],"paths":[]}';}});
  assert.ok(result);assert.match(prompts[1]!,/rootAlternatives/);assert.notEqual(prompts[0],prompts[1]);
});
