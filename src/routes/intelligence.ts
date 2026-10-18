import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ownerScope, type AuthConfig } from '../auth.js';
import { artifactKindSchema } from '../domain/intelligence.js';
import { eventKindSchema } from '../domain/event.js';
import { createArtifact,getArtifact,listArtifacts,refreshArtifact,intelligenceEnabled } from '../storage/intelligence.js';
import { pool,withTransaction } from '../storage/postgres.js';
import { correctionSnapshot,restoreCorrectionSnapshot,applyCorrectionProjection as applyCorrection } from '../storage/correction-projection.js';
import { recordCorrection,learningDescriptor } from '../storage/correction-memory.js';
import { enqueueBackgroundJob } from '../storage/job-repository.js';
import { correlateFinancialEventWithDb } from '../storage/event-store.js';

const createSchema=z.object({kind:artifactKindSchema,objective:z.string().trim().min(3).max(2000),parentId:z.string().optional(),conversationId:z.string().optional()}).strict();
const correctionSchema=z.object({eventId:z.string().min(1),field:z.enum(['inferredKind','merchant','category']),value:z.string().trim().min(1).max(160),reusable:z.boolean().default(true)}).strict()
  .refine(v=>v.field!=='inferredKind'||eventKindSchema.safeParse(v.value).success,'Invalid event kind');
const teachSchema=z.object({
  eventId:z.string().min(1),
  kind:eventKindSchema,
  financialCategory:z.string().trim().min(1).max(120).optional(),
  eventCategory:z.string().trim().min(1).max(120).optional(),
  explanation:z.string().trim().min(2).max(1000).optional(),
}).strict().superRefine((value, context)=>{
  const financial=['expense','income','transfer'].includes(value.kind);
  if(financial && value.eventCategory) context.addIssue({code:z.ZodIssueCode.custom,path:['eventCategory'],message:'Event category is only for non-financial activity'});
  if(!financial && value.financialCategory) context.addIssue({code:z.ZodIssueCode.custom,path:['financialCategory'],message:'Financial category requires a transaction'});
});
const interactionSchema=z.object({events:z.array(z.object({
  id:z.string().max(100),sessionId:z.string().max(100),
  screen:z.enum(['today','explore','money','review','capture','detail','settings','intelligence']),
  action:z.enum(['view','search','open','capture','correct','review','ask','feedback','error']),
  outcome:z.enum(['success','failure','cancelled']).optional(),durationMs:z.number().int().min(0).max(86400000).optional(),occurredAt:z.string().datetime(),
}).strict()).max(50)}).strict();
const learningEnabled=()=>process.env.BRAINIA_LEARNING_ENABLED==='true';

async function enqueueCorrectionFollowups(db:Pick<typeof pool,'query'>,eventId:string,clientId:string|null,key:string){
  await enqueueBackgroundJob(db,{clientId,eventId,jobType:'semantic_enrichment',idempotencyKey:`correction-semantic:${eventId}:${key}`,payload:{eventId},priority:30,provider:'deepseek'});
}

export const registerIntelligenceRoutes=(authConfig:AuthConfig):FastifyPluginAsync=>async app=>{
  app.setErrorHandler((error,request,reply)=>{
    const conflicts=['preview_stale','correction_changed','manual_override','transfer_requires_accounts','parent_not_found','correction_revoked','invalid_selection'];
    const message=error instanceof Error?error.message:'unknown';
    if(message==='unauthorized')return reply.code(401).send({error:'unauthorized'});
    if(message==='owner_scope_required')return reply.code(403).send({error:'owner_scope_required'});
    if(message==='insufficient_scope')return reply.code(403).send({error:'insufficient_scope'});
    if(conflicts.includes(message))return reply.code(409).send({error:message});
    request.log.error({err:error},'intelligence_request_failed');return reply.code(500).send({error:'intelligence_request_failed'});
  });
  const scope=(request:Parameters<typeof ownerScope>[0])=>{
    return ownerScope(request) ?? null;
  };
  app.get('/intelligence/capabilities',async()=>{
    const storage=await pool.query("select to_regclass('public.intelligence_artifacts') as intelligence_artifacts, to_regclass('public.interaction_events') as interaction_events");
    return {
      enabled:intelligenceEnabled(),learning:learningEnabled(),jev:process.env.BRAINIA_JEV_MODE ?? 'off',
      storageReady:Boolean(storage.rows[0]?.intelligence_artifacts && storage.rows[0]?.interaction_events),
    };
  });
  app.get('/intelligence/artifacts',async request=>({artifacts:intelligenceEnabled()?await listArtifacts(scope(request)):[]}));
  app.post('/intelligence/artifacts',async(request,reply)=>{
    const input=createSchema.safeParse(request.body);if(!input.success)return reply.code(400).send({error:'invalid_generation'});
    if(!intelligenceEnabled())return reply.code(503).send({error:'intelligence_disabled'});
    const artifact=await createArtifact({...input.data,clientId:scope(request)});
    return reply.code(202).send(artifact);
  });
  app.get<{Params:{id:string}}>('/intelligence/artifacts/:id',async(request,reply)=>{
    if(!intelligenceEnabled())return reply.code(503).send({error:'intelligence_disabled'});
    const artifact=await getArtifact(request.params.id,scope(request));
    return artifact ?? reply.code(404).send({error:'not_found'});
  });
  app.post<{Params:{id:string}}>('/intelligence/artifacts/:id/cancel',async(request,reply)=>{
    const {rows}=await pool.query("update intelligence_artifacts set status='cancelled',checkpoint='{}',updated_at=now() where id=$1 and client_id is not distinct from $2 and status in ('queued','running') returning id",[request.params.id,scope(request)]);
    return rows[0] ?? reply.code(409).send({error:'not_running'});
  });
  app.post<{Params:{id:string}}>('/intelligence/artifacts/:id/refresh',async(request,reply)=>{
    if(!intelligenceEnabled())return reply.code(503).send({error:'intelligence_disabled'});
    return await refreshArtifact(request.params.id,scope(request)) ?? reply.code(409).send({error:'not_refreshable'});
  });
  app.patch<{Params:{id:string}}>('/intelligence/artifacts/:id',async(request,reply)=>{
    const input=z.object({saved:z.boolean().optional(),userNotes:z.string().max(20000).optional()}).strict().safeParse(request.body);
    if(!input.success)return reply.code(400).send({error:'invalid_edit'});
    const {rows}=await pool.query(`update intelligence_artifacts set saved=coalesce($3,saved),user_notes=coalesce($4,user_notes),updated_at=now()
      where id=$1 and client_id is not distinct from $2 returning id`,[request.params.id,scope(request),input.data.saved,input.data.userNotes]);
    return rows[0] ?? reply.code(404).send({error:'not_found'});
  });
  app.get<{Params:{id:string}}>('/intelligence/artifacts/:id/revisions',async(request,reply)=>{
    const a=await getArtifact(request.params.id,scope(request));if(!a)return reply.code(404).send({error:'not_found'});
    // Revision content may contain subsequently hidden sources: expose metadata only.
    const {rows}=await pool.query('select revision,created_at from intelligence_revisions where artifact_id=$1 order by revision desc',[a.id]);return {revisions:rows};
  });
  app.post<{Params:{id:string}}>('/intelligence/artifacts/:id/feedback',async(request,reply)=>{
    const input=z.object({value:z.enum(['useful','irrelevant','incorrect','known'])}).strict().safeParse(request.body);
    if(!input.success)return reply.code(400).send({error:'invalid_feedback'});
    const clientId=scope(request);const a=await getArtifact(request.params.id,clientId);if(!a)return reply.code(404).send({error:'not_found'});
    await pool.query('insert into intelligence_feedback(id,artifact_id,client_id,value) values($1,$2,$3,$4)',[randomUUID(),a.id,clientId,input.data.value]);
    return {ok:true};
  });
  app.post<{Params:{id:string}}>('/intelligence/artifacts/:id/confirm',async(request,reply)=>{
    const input=z.object({claimId:z.string(),revision:z.number().int().positive(),confirmed:z.boolean()}).strict().safeParse(request.body);
    if(!input.success)return reply.code(400).send({error:'invalid_confirmation'});
    const a=await getArtifact(request.params.id,scope(request));
    if(!a)return reply.code(404).send({error:'not_found'});
    if(a.status!=='ready'||a.revision!==input.data.revision||!a.content?.claims.some(c=>c.id===input.data.claimId&&c.kind==='inference'))return reply.code(409).send({error:'claim_changed'});
    if(input.data.confirmed)await pool.query('insert into intelligence_confirmations(artifact_id,revision,claim_id) values($1,$2,$3) on conflict do nothing',[a.id,a.revision,input.data.claimId]);
    else await pool.query('delete from intelligence_confirmations where artifact_id=$1 and revision=$2 and claim_id=$3',[a.id,a.revision,input.data.claimId]);
    return {ok:true};
  });
  app.post('/interactions/batch',async(request,reply)=>{
    const input=interactionSchema.safeParse(request.body);if(!input.success)return reply.code(400).send({error:'invalid_interactions'});
    const clientId=scope(request);
    await withTransaction(async db=>{
      for(const e of input.data.events){
        if(Math.abs(Date.now()-Date.parse(e.occurredAt))>7*86400000)continue;
        const result=await db.query(`insert into interaction_events(id,client_id,session_id,screen,action,outcome,duration_ms,occurred_at)
          values($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing returning id`,[e.id,clientId,e.sessionId,e.screen,e.action,e.outcome,e.durationMs,e.occurredAt]);
        if(result.rows.length)await db.query(`insert into interaction_daily(day,client_scope,screen,action,count,total_duration_ms) values($1,$2,$3,$4,1,$5)
          on conflict(day,client_scope,screen,action) do update set count=interaction_daily.count+1,total_duration_ms=interaction_daily.total_duration_ms+excluded.total_duration_ms`,[e.occurredAt.slice(0,10),clientId ?? 'legacy:null',e.screen,e.action,e.durationMs ?? 0]);
      }
    });return {ok:true};
  });
  app.get('/classification/corrections',async request=>({corrections:learningEnabled()?(await pool.query('select id,event_id,field,value,reusable,created_at from classification_corrections where client_id is not distinct from $1 and revoked_at is null order by created_at desc limit 100',[scope(request)])).rows:[]}));
  app.post('/classification/corrections',async(request,reply)=>{
    if(!learningEnabled())return reply.code(503).send({error:'learning_disabled'});
    const input=correctionSchema.safeParse(request.body);if(!input.success)return reply.code(400).send({error:'invalid_correction'});
    const clientId=scope(request);
    const found=await pool.query('select id from raw_events where id=$1 and client_id is not distinct from $2',[input.data.eventId,clientId]);
    if(!found.rows.length)return reply.code(404).send({error:'not_found'});
    return withTransaction(async db=>{
      const before=await correctionSnapshot(db,input.data.eventId);
      const correction=await recordCorrection(db,{...input.data,clientId});
      await applyCorrection(db,input.data.eventId,input.data.field,input.data.value);
      if(input.data.field==='inferredKind')await correlateFinancialEventWithDb(db,input.data.eventId);
      const after=await correctionSnapshot(db,input.data.eventId);
      await db.query('update classification_corrections set previous_value=$2 where id=$1',[correction.id,JSON.stringify({before,after})]);
      await enqueueCorrectionFollowups(db,input.data.eventId,clientId,correction.id);
      return correction;
    });
  });
  // One deliberate human decision may teach kind, the appropriate category,
  // and optional context together. It is stored as exact reusable supervision.
  app.post('/classification/teach',async(request,reply)=>{
    if(!learningEnabled())return reply.code(503).send({error:'learning_disabled'});
    const input=teachSchema.safeParse(request.body);if(!input.success)return reply.code(400).send({error:'invalid_teaching',issues:input.error.flatten()});
    const clientId=scope(request);
    const found=await pool.query('select id from raw_events where id=$1 and client_id is not distinct from $2',[input.data.eventId,clientId]);
    if(!found.rows.length)return reply.code(404).send({error:'not_found'});
    return withTransaction(async db=>{
      const before=await correctionSnapshot(db,input.data.eventId);
      const lessons:[string,string][]=[['inferredKind',input.data.kind]];
      if(input.data.financialCategory)lessons.push(['financialCategory',input.data.financialCategory]);
      if(input.data.eventCategory)lessons.push(['eventCategory',input.data.eventCategory]);
      if(input.data.explanation)lessons.push(['humanExplanation',input.data.explanation]);
      const corrections=[];
      for(const [field,value] of lessons){
        const correction=await recordCorrection(db,{clientId,eventId:input.data.eventId,field,value,reusable:true});
        await applyCorrection(db,input.data.eventId,field,value);
        corrections.push(correction.id);
      }
      if(['expense','income','transfer'].includes(input.data.kind))await correlateFinancialEventWithDb(db,input.data.eventId);
      const after=await correctionSnapshot(db,input.data.eventId);
      for(const correctionId of corrections)await db.query('update classification_corrections set previous_value=$2 where id=$1',[correctionId,JSON.stringify({before,after})]);
      await enqueueCorrectionFollowups(db,input.data.eventId,clientId,corrections.join(':'));
      return {ok:true,correctionIds:corrections};
    });
  });
  app.post<{Params:{id:string}}>('/classification/corrections/:id/undo',async(request,reply)=>{
    if(!learningEnabled())return reply.code(503).send({error:'learning_disabled'});
    const {rows}=await pool.query('select * from classification_corrections where id=$1 and client_id is not distinct from $2 and revoked_at is null',[request.params.id,scope(request)]);
    const correction=rows[0];if(!correction)return reply.code(404).send({error:'not_found'});
    await withTransaction(async db=>{
      const snapshot=JSON.parse(correction.previous_value ?? '{}');
      const current=await correctionSnapshot(db,correction.event_id);
      if(snapshot.after && JSON.stringify(current)!==JSON.stringify(snapshot.after))throw new Error('correction_changed');
      await db.query('update classification_corrections set revoked_at=now() where id=$1',[correction.id]);
      if(snapshot.before)await restoreCorrectionSnapshot(db,correction.event_id,snapshot.before);
    });return {ok:true};
  });
  app.post<{Params:{id:string}}>('/classification/corrections/:id/preview',async(request,reply)=>{
    if(!learningEnabled())return reply.code(503).send({error:'learning_disabled'});
    const clientId=scope(request);
    const correction=(await pool.query('select * from classification_corrections where id=$1 and client_id is not distinct from $2 and revoked_at is null',[request.params.id,clientId])).rows[0];
    if(!correction)return reply.code(404).send({error:'not_found'});
    const {rows}=await pool.query(`select e.id,e.title,e.body,c.inferred_kind,c.entities from raw_events e join classified_events c on c.raw_event_id=e.id
      where e.client_id is not distinct from $1 and e.source=$2 order by e.created_at desc limit 2000`,[clientId,correction.source]);
    const changes=[];
    for(const r of rows.filter(r=>r.id!==correction.event_id&&learningDescriptor(r)===correction.descriptor)) {
      const snapshot=await withTransaction(db=>correctionSnapshot(db,r.id));
      changes.push({eventId:r.id,title:r.title,field:correction.field,value:correction.value,snapshot});
    }
    const id=randomUUID();await pool.query('insert into reclassification_runs(id,client_id,correction_id,changes) values($1,$2,$3,$4)',[id,clientId,correction.id,JSON.stringify(changes)]);
    return {id,changes};
  });
  app.post<{Params:{id:string}}>('/classification/reclassification/:id/apply',async(request,reply)=>{
    if(!learningEnabled())return reply.code(503).send({error:'learning_disabled'});
    const input=z.object({eventIds:z.array(z.string()).max(2000)}).strict().safeParse(request.body);if(!input.success)return reply.code(400).send({error:'invalid_selection'});
    return withTransaction(async db=>{
      const run=(await db.query("select * from reclassification_runs where id=$1 and client_id is not distinct from $2 and status='preview' for update",[request.params.id,scope(request)])).rows[0];
      if(!run)return reply.code(409).send({error:'not_applicable'});
      const correction=await db.query('select id from classification_corrections where id=$1 and revoked_at is null for update',[run.correction_id]);
      if(!correction.rows.length)throw new Error('correction_revoked');
      if(input.data.eventIds.some(id=>!run.changes.some((c:{eventId:string})=>c.eventId===id)))throw new Error('invalid_selection');
      const selected=run.changes.filter((c:{eventId:string})=>input.data.eventIds.includes(c.eventId));
      for(const c of selected) {
        c.snapshotBefore=await correctionSnapshot(db,c.eventId);
        if(JSON.stringify(c.snapshotBefore)!==JSON.stringify(c.snapshot))throw new Error('preview_stale');
        const manual=await db.query('select id from classification_corrections where event_id=$1 and field=$2 and revoked_at is null',[c.eventId,c.field]);
        if(manual.rows.length)throw new Error('manual_override');
        await applyCorrection(db,c.eventId,c.field,c.value);
        if(c.field==='inferredKind')await correlateFinancialEventWithDb(db,c.eventId);
        c.snapshotAfter=await correctionSnapshot(db,c.eventId);
        await enqueueCorrectionFollowups(db,c.eventId,run.client_id,run.id);
      }
      await db.query("update reclassification_runs set status='applied',changes=$2,updated_at=now() where id=$1",[run.id,JSON.stringify(selected)]);return {ok:true,count:selected.length};
    });
  });
  app.post<{Params:{id:string}}>('/classification/reclassification/:id/undo',async(request,reply)=>withTransaction(async db=>{
    if(!learningEnabled())return reply.code(503).send({error:'learning_disabled'});
    const run=(await db.query("select * from reclassification_runs where id=$1 and client_id is not distinct from $2 and status='applied' for update",[request.params.id,scope(request)])).rows[0];
    if(!run)return reply.code(409).send({error:'not_reversible'});
    for(const c of run.changes){
      const current=await correctionSnapshot(db,c.eventId);
      if(JSON.stringify(current)!==JSON.stringify(c.snapshotAfter))throw new Error('correction_changed');
      await restoreCorrectionSnapshot(db,c.eventId,c.snapshotBefore);
    }
    await db.query("update reclassification_runs set status='reverted',updated_at=now() where id=$1",[run.id]);return {ok:true};
  }));
};
