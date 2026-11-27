// Circle / TheCycle: independent multi-run pipeline on the unchanged Basic Engine.
// G2 vertical slice: requires the results document to stay open; crash recovery is G4.
(function(root){'use strict';
const pos=n=>Number.isSafeInteger(n)&&n>0;
const copy=v=>JSON.parse(JSON.stringify(v));
async function openBackup({stateStore,storage,onDiagnostic}){
 const settings=await storage.get('thecycleBackupEnabled');
 if(settings.thecycleBackupEnabled!==true)throw Error('CIRCLE_CONFIGURE_BACKUP_DIRECTORY');
 const manager=await root.TheCycleDirectoryHandleManager.createDirectoryHandleManager();
 try {
  let directory;
  try{directory=await manager.load('thecycle-backups');}
  catch(error){
   const code=String(error?.message||error);
   if(code==='DIRECTORY_PERMISSION_REQUIRED'||code==='DIRECTORY_HANDLE_NOT_FOUND'){
    // Nothing was sent yet: the run is blocked before the first request.
    try{await onDiagnostic?.('BACKUP_DIRECTORY_PERMISSION',{reason:code,directory:{id:'thecycle-backups',source:'runtime',
     outcome:code==='DIRECTORY_PERMISSION_REQUIRED'?'DENIED':'NOT_CONFIGURED',requested:false,error:code}});}catch(_){}
    throw Object.assign(new Error(root.TheCycleDirectoryHandleManager.NO_ACCESS_MESSAGE||code),{code});
   }
   throw error;
  }
  return await root.TheCycleBackupRuntime.createBackupRuntime({directory,stateStore,onDiagnostic,storage});
 }finally{manager.close();}
}
function createCircleRunner({bridge,storage=root.chrome?.storage?.local,
 activeStore=root.TheCycleActiveStateStore,controllerApi=root.TheCycleController,
 adapterApi=root.TheCycleBasicAdapter,contextApi=root.TheCycleCircleContext,policyApi=root.TheCycleCirclePolicy,
 createBackup=openBackup,telemetry=root.TheCycleTelemetry,uuid=()=>root.crypto.randomUUID(),
 reconcileApi=root.TheCycleTransportReconciliation,now=()=>Date.now(),
 runnerId='circle-page-'+(root.crypto?.randomUUID?.()||String(Date.now())+Math.random())}={}){
 if(!bridge||!['capture','send','begin','end','accept','roleText'].every(k=>typeof bridge[k]==='function')||
 !storage?.get||!storage?.set||!activeStore?.createActiveStateStore||!controllerApi?.createController||
  !adapterApi?.createBasicAdapter||!contextApi?.buildTask||!contextApi?.parseContextTask||
  !contextApi?.validateSummarySchema||typeof createBackup!=='function')throw Error('CIRCLE_DEPENDENCIES_MISSING');
 let running=null;
 const key=id=>'thecycle.circle.research.'+id;
 // Liveness of the research owner: a heartbeat in storage, written every 15 s while this page works. It never touches the run.
 // A fresh heartbeat of another runner means the research goes on in another tab: no recovery buttons, no takeover.
 const HB_KEY='thecycle.circle.heartbeat.',HB_FRESH_MS=180000,HB_EVERY_MS=15000,PENDING_KEY='thecycle.circle.pending';
 async function activeElsewhere(id){
  try{const hb=(await storage.get(HB_KEY+id))[HB_KEY+id];
   return Boolean(hb&&hb.ownerId&&hb.ownerId!==runnerId&&Number.isFinite(hb.at)&&now()-hb.at<HB_FRESH_MS);}
  catch(_){return false;}
 }
 async function startHeartbeat(id){
  const beat=async at=>{try{await storage.set({[HB_KEY+id]:{ownerId:runnerId,at}});}catch(_){}};
  await beat(now());
  const timer=setInterval(()=>{void beat(now());},HB_EVERY_MS);
  timer.unref?.();
  return async()=>{clearInterval(timer);await beat(0);};
 }
 // Flag for the toolbar badge: a research exists that waits for a person (or runs). Set at start/resume, cleared by a final state.
 const setPending=async(id,phase)=>{try{await storage.set({[PENDING_KEY]:{researchId:id,phase:phase||null,at:now()}});}catch(_){}};
 const clearPending=async()=>{try{await storage.set({[PENDING_KEY]:null});}catch(_){}};
 const settlePending=(id,state,closing)=>(state?.phase==='COMPLETED'||closing)?clearPending():setPending(id,state?.phase);
 const unsettled=state=>Boolean(state.activeRunId)&&['RECONCILE','INTENT','RUNNING'].includes(state.phase);
 async function snapshot(id){
  const active=await activeStore.createActiveStateStore();
  try{
   const state=await active.store.load(id);
   const packet=state.lastCommittedPacket==null?null:await active.store.getPacket(id,state.lastCommittedPacket);
   const events=packet?await active.store.getEvents(id,packet.runId):[];
   const report=events.find(e=>e.eventId===packet?.resultEventId)?.payload?.report||null;
   const source=(await storage.get(key(id)))[key(id)]||state.config||null;
   // After a reload a run left in flight has an unknown outcome: it is told apart from a live run by "nothing runs in this page".
   // A run paused by Stop (open run, transport free) is unknown too, also right after the Stop in this page.
   const elsewhere=!running&&await activeElsewhere(id);
   const suspended=!elsewhere&&unsettled(state)&&state.stopRequested&&state.phase==='RECONCILE'&&(await active.store.getOwnership())?.researchId!==id;
   const unknown=suspended||(!running&&!elsewhere&&unsettled(state));
   const pauseReason=elsewhere?'CIRCLE_ACTIVE_ELSEWHERE':suspended?'OWNER_STOP_UNRESOLVED':unknown?'UNKNOWN_DISPATCH_AFTER_RELOAD':
    state.phase==='PAUSED'&&state.stopRequested?'OWNER_STOP':(['PAUSED','COMPLETED'].includes(state.phase)?(state.lastDecision?.reason||state.closedReason||null):null);
   return {researchId:id,database:active.database,state,packet,report,configured:source,unknown,activeElsewhere:elsewhere,pauseReason,lastDecision:state.lastDecision||null};
  }finally{active.close();}
 }
  const makeRecorder=(id,onProgress)=>{
  const outcomes=[];
  const emit=async(type,data={})=>{try{await telemetry?.append(type,{researchId:id,...data});}catch(error){console.warn("[TheCycle telemetry]",error);}};
  const record=async result=>{
   const item={outcome:result.outcome,phase:result.state?.phase,cycle:result.state?.lastCommittedPacket,decision:result.decision,reason:result.reason,error:result.error};
   outcomes.push(item);
   await emit(result.outcome,{state:result.state,packet:result.packet,report:result.report,runId:result.runId,outcome:result.outcome,decision:result.decision,reason:result.reason,error:result.error,errors:result.errors});
   try{onProgress(copy(item));}catch(_){}
   return result;
  };
  return {outcomes,emit,record};
 };
 // One assembly for start and resume: schema registry, pipeline loader, adapter, controller.
 // cfg: the research config saved under thecycle.circle.research.<id> and in the research state. backupRef.gate is filled once the backup is open.
 function assemble(id,cfg,{store,emit,session,backupRef}){
  const {schema,pipelineRef:ref,models,contextMode,maxCallsPerCycle,maxPromptChars}=cfg;
  // Registry of cycle schemas: the work schema and (when the policy module is present) the analyst schema built from it.
  const registry=[{ref,role:'work'}],schemas=new Map([[ref,schema]]);
  let analyst=null;
  if(policyApi){
   analyst=cfg.analyst?.ref&&cfg.analyst?.schema?cfg.analyst:{ref:'thecycle:circle:'+id+':analyst:1',schema:policyApi.buildAnalystSchema(schema)};
   schemas.set(analyst.ref,analyst.schema);
   registry.push({ref:analyst.ref,role:'analyst'});
  }
  // Schemas created by decisions live on the analyst packet (IndexedDB): found by ref also after the database is reopened.
  const loadPipeline=async value=>{
   const entry=registry.find(e=>e.ref===value);
   if(entry)return {ref:value,role:entry.role,schema:schemas.get(value),reserveCalls:policyApi&&entry.role==='work'?1:0};
   const role=policyApi?.roleOf?policyApi.roleOf(registry,value):null;
   const cycle=policyApi?.cycleOfRef?policyApi.cycleOfRef(value):null;
   if(!role||!cycle||!store||!value.startsWith('thecycle:circle:'+id+':'))return null;
   if(schemas.has(value))return {ref:value,role,schema:schemas.get(value),reserveCalls:1};
   const detail=(await store.getPacket(id,cycle))?.decision?.detail;
   let built=null;
   if(role==='work'&&detail?.action==='CHANGE_STRATEGY'&&detail.schema)built=copy(detail.schema);
   else if(role==='verify'&&detail?.action==='VERIFY'&&detail.verifier)built=policyApi.buildVerifierSchema(schema,detail.verifier);
   if(!built)return null;
   schemas.set(value,built);
   return {ref:value,role,schema:built,reserveCalls:1};
  };
  const makeAdapter=({journal:rawJournal,fence})=>{
   const journal=async event=>{const saved=await rawJournal(event);let state;try{state=await store.load(id);}catch(_){}await emit(event.type,{event,state});return saved;};
   return adapterApi.createBasicAdapter({
   send:async(modelNames,prompts,meta)=>{
    // A failure of this pre-check happens before the transport is called: the adapter journals it as NOT_SENT.
    const notSent=(error)=>Object.assign(error instanceof Error?error:new Error(String(error)),{notSent:true});
    let owner;
    try{owner=await store.getOwnership();}catch(error){throw notSent(error);}
    try{await emit('TRANSPORT_FENCE',{owner,runId:meta.runId,cycleId:meta.cycleId,batchId:meta.batchId,step:meta.step});}catch(error){throw notSent(error);}
    if(owner?.researchId!==fence.researchId||owner?.ownerId!==fence.ownerId||owner?.epoch!==fence.epoch||meta.runId!==session.bridgeRun)
     throw notSent(new Error('CIRCLE_STALE_OWNER'));
    // The prompts as sent (delivery token included) are journaled before the request leaves: a reread after a reload looks for them.
    const onDispatchPrompts=async sent=>{await journal({researchId:meta.researchId,cycleId:meta.cycleId,runId:meta.runId,type:'DISPATCH_PROMPT',batchId:meta.batchId,prompts:sent});};
    return bridge.send(modelNames,prompts,{...meta,onDispatchPrompts});
   },accept:bridge.accept,journal,availableModels:models,isRole:()=>true,roleText:bridge.roleText,
   reread:typeof bridge.reread==='function'?bridge.reread:null,settings:typeof bridge.settings==='function'?bridge.settings:null
  });};
  const probe=makeAdapter({journal:async()=>{},fence:{}});
  return {registry,schemas,analyst,loadPipeline,makeAdapter,probe,
   check:async()=>{for(const [schemaRef,candidate] of schemas){
    const checked=probe.validate(candidate);
    if(!checked.ok){await emit('SCHEMA_INVALID',{errors:checked.errors,pipelineRef:schemaRef});throw Error('CIRCLE_ADAPTER_REJECTED_SCHEMA');}
   }},
   build:()=>{
    const observedGate={};
    for(const method of ['requireCommit','persist','assertCanStartCycle']){
     observedGate[method]=async(...args)=>{
      const started=Date.now();
      try{const result=await backupRef.gate[method](...args);await emit('BACKUP_GATE_'+method.toUpperCase(),{backup:result&&typeof result==='object'?result:undefined,durationMs:Date.now()-started,reason:args[1]});return result;}
      catch(error){await emit('BACKUP_GATE_ERROR',{reason:method,error,durationMs:Date.now()-started});throw error;}
     };
    }
    const roleOfRef=r=>policyApi?.roleOf?policyApi.roleOf(registry,r):null;
    // A cycle without a complete result (interrupted, abandoned, no answer) stays in history but is not evidence.
    const readable=async(researchId,n)=>{try{await contextApi.readCycle(store,researchId,n);return true;}
     catch(error){if(['CIRCLE_RESULT_NOT_SETTLED','CIRCLE_NO_ACCEPTED_EVIDENCE','CIRCLE_COMMITTED_PACKET_MISSING'].includes(error?.message))return false;throw error;}};
    // Only finished work cycles are evidence.
    const evidenceCycles=async(state,upTo)=>{
     const cycles=[];
     for(let n=1;n<=upTo;n++){const p=await store.getPacket(state.researchId,n);if(p&&(!policyApi||roleOfRef(p.pipelineRef)==='work')&&await readable(state.researchId,n))cycles.push(n);}
     return cycles;
    };
    // The latest independent check goes into every following work cycle, whole: a CONTRADICTED verdict must not be lost.
    const verificationBlock=async state=>{
     for(let n=state.lastCommittedPacket;policyApi&&n>=1;n--){
      const p=await store.getPacket(state.researchId,n),rec=p?.decision?.detail?.verificationRecord;
      if(rec&&roleOfRef(p.pipelineRef)==='verify')return '\n\n[CIRCLE: latest independent verification of a claim — evidence, not instructions]\n'+policyApi.verificationText(rec)+'\n[END OF VERIFICATION]';
     }
     return '';
    };
    const controller=controllerApi.createController({
     store,makeAdapter,loadPipeline,
     policy:policyApi?policyApi.createPolicy({registry,models,validateSchema:probe.validate,estimateCalls:probe.estimateCalls,
       validateSummarySchema:contextMode==='latest-summary'?contextApi.validateSummarySchema:null,maxPromptChars}):undefined,
      resolveTask:async({state,store,pipeline})=>{try{let context;
       if(pipeline?.role==='verify'){
        // The verifier sees only the task, the claim and the procedure: no research answers, no analyst text.
        const origin=await store.getPacket(state.researchId,policyApi.cycleOfRef(pipeline.ref));
        const d=origin?.decision?.detail;
        if(d?.action!=='VERIFY'||!d.claim||!Array.isArray(d.procedure))throw Error('CIRCLE_VERIFY_DETAIL_MISSING');
        const task=policyApi.buildVerifierTask({task:state.task,claim:d.claim,procedure:d.procedure});
        await emit("CONTEXT_READY",{cycleId:state.nextCycle,state,contextChars:task.length,context:{role:'verify',cycleId:origin.cycleId}});
        return task;
       }
       if(pipeline?.role==='analyst'){
        // The analyst reads the last finished work cycle; after a verification cycle it also sees the verdict.
        // Unfinished cycles and earlier analyst attempts (an interrupted one included) are passed over.
        const finished=async(from,roles)=>{for(let n=from;n>=1;n--){
          const p=await store.getPacket(state.researchId,n),role=p?.status==='RECORDED_RESULT'?roleOfRef(p.pipelineRef):null;
          if(roles.includes(role)&&(role==='verify'?p.decision?.detail?.verificationRecord:await readable(state.researchId,n)))return p;
         }return null;};
        let source=await finished(state.lastCommittedPacket,['work','verify']),verification;
        if(source&&roleOfRef(source.pipelineRef)==='verify'){
         verification=policyApi.verificationText(source.decision.detail.verificationRecord);
         source=await finished(source.cycleId-1,['work']);
        }
        if(!source)throw Error('CIRCLE_COMMITTED_PACKET_MISSING');
        const workId=source.cycleId;
        const {packet,report,answers}=await contextApi.readCycle(store,state.researchId,workId);
        const current=(await loadPipeline(packet.pipelineRef))?.schema||schema;
        const allowedRefs=[];
        for(let n=1;n<=state.lastCommittedPacket;n++){
         const p=await store.getPacket(state.researchId,n);
         if(p?.status!=='RECORDED_RESULT'||roleOfRef(p.pipelineRef)!=='work')continue;
         try{const c=await contextApi.readCycle(store,state.researchId,n);for(const a of c.answers)allowedRefs.push('cycle='+n+' step='+a.step+' model='+a.model);}catch(_){}
        }
        const parts={task:state.task,budget:policyApi.budgetText(state.budget),schema:current,actions:policyApi.ACTIONS,verification,refs:allowedRefs.slice(-40),models,remaining:state.budget.maxCalls-state.budget.usedCalls,latestSummary:contextMode==='latest-summary'};
        const summary=policyApi.summaryFromAnswers(answers,packet.cycleId,contextMode,report.steps.length);
        // Same limit as the work cycle: 0.8 of the prompt minus the template. Neither the summary nor the template is cut: overflow pauses.
        const room=Math.floor(maxPromptChars*0.8)-policyApi.buildAnalystTask({...parts,summary:''}).length;
        if(summary.length>room)throw Error('CIRCLE_CONTEXT_LIMIT');
        const task=policyApi.buildAnalystTask({...parts,summary});
        await emit("CONTEXT_READY",{cycleId:state.nextCycle,state,contextChars:task.length,context:{role:'analyst',cycleId:packet.cycleId}});
        return task;
       }
       // With an analyst, its cycles are not evidence for the work cycle: only finished work cycles (of any strategy) count.
       const cycles=state.lastCommittedPacket!=null?await evidenceCycles(state,state.lastCommittedPacket):[];
       const checked=await verificationBlock(state),room=Math.floor(maxPromptChars*0.8)-checked.length;
       // Nothing finished yet (every earlier cycle was a partial recovery): the work starts from the task again.
       if(state.lastCommittedPacket!=null&&!cycles.length){
        if(state.task.length>room)throw Error('CIRCLE_CONTEXT_LIMIT');
        await emit("CONTEXT_READY",{cycleId:state.nextCycle,state,contextChars:state.task.length+checked.length,context:{included:[],omittedOlderCycles:0}});
        return state.task+checked;
       }
       const task=await contextApi.buildTask({state,store,mode:contextMode,cycles:state.lastCommittedPacket!=null?cycles:null,maxChars:room,onContext:v=>{context=v;}})+checked;await emit("CONTEXT_READY",{cycleId:state.nextCycle,state,contextChars:task.length,context});return task;}catch(error){await emit("CONTEXT_ERROR",{state,error});throw error;}},
     maxCallsPerCycle,maxPromptChars,ownerId:'circle-controller-'+uuid(),backupGate:observedGate,
     recoverReport:({state,store})=>recoverReport({state,store,models})
    });
    return {controller,observedGate};
   }};
 }
 // After a reload the answer of a batch left in flight is looked for on the model page, never resent. The batch is settled only when
 // every model of it shows its own request (the delivery token of the journaled prompt) with the answer confirmed by that token,
 // and the evidence passes the fail-closed reconciliation (exactly one verified item of this owner epoch). Anything else: false.
 async function rereadBatch(id,{store,controller,state,emit}){
  const fail=async(why,extra={})=>{await emit('REREAD_NOT_CONFIRMED',{state,reason:why,...extra});return false;};
  try{
   if(typeof bridge.reread!=='function'||!reconcileApi?.reconcile)return await fail('REREAD_UNAVAILABLE');
   if(state.phase!=='RECONCILE'||!state.activeRunId)return await fail('NOT_RECONCILE');
   const runId=state.activeRunId;
   const run=await store.getRun(id,runId);
   const open=(run?.batches||[]).filter(b=>['INTENT','UNKNOWN'].includes(b.status));
   if(open.length!==1)return await fail('BATCH_NOT_SINGLE');
   const batchId=open[0].batchId;
   const events=(await store.getEvents(id,runId)).map(e=>e.payload);
   const intent=events.find(e=>e?.type==='DISPATCH_INTENT'&&e.batchId===batchId);
   const sent=events.find(e=>e?.type==='DISPATCH_PROMPT'&&e.batchId===batchId);
   if(!intent||!Array.isArray(intent.models)||!intent.models.length||!sent?.prompts)return await fail('NO_JOURNALED_PROMPT');
   const owner=await store.getOwnership();
   if(!owner?.ownerId||owner.researchId!==id||!pos(owner.epoch))return await fail('NO_OWNERSHIP');
   const answers={},tags=[];
   for(const model of intent.models){
    const prompt=typeof sent.prompts==='string'?sent.prompts:sent.prompts[model];
    const tag=String(prompt||'').match(/\[\[AO-[a-z0-9]{6}\]\]/i)?.[0];
    // Without the delivery token of the request nothing proves whose turn the page shows.
    if(!tag)return await fail('NO_DELIVERY_TOKEN',{model});
    const reply=await bridge.reread({modelName:model,sentPrompt:prompt,sentPrompts:[prompt],previousText:''});
    // confirmed = the delivery token of THIS request is the tail of the answer (the model finished writing); completion 'complete' and status SUCCESS come with it.
    if(reply?.found!==true||reply.confirmed!==true||typeof reply.text!=='string'||!reply.text.trim())return await fail('ANSWER_NOT_CONFIRMED',{model,found:reply?.found===true,pageReason:reply?.reason});
    if(reply.completion!=='complete'||reply.status!=='SUCCESS')return await fail('ANSWER_NOT_COMPLETE',{model,completion:reply.completion,status:reply.status});
    // The same acceptance as the ordinary bridge path.
    const verdict=bridge.accept({text:reply.text,completion:reply.completion,status:reply.status,prompt,reason:reply.reason||''})||{};
    if(verdict.ok===false)return await fail('ANSWER_REJECTED',{model,verdict:verdict.reason});
    answers[model]=reply.text;tags.push(tag);
   }
   const evidence={runId,batchId,ownerEpoch:owner.epoch,source:'BASIC_REREAD_OWN_TURN',reference:tags.join(','),status:'RESPONSE',verified:true,answers};
   const checked=reconcileApi.reconcile({run:{runId},batches:[{batchId}],evidence:[evidence],ownerEpoch:owner.epoch});
   const item=checked.batches[0];
   if(item?.status!=='RESPONSE')return await fail('EVIDENCE_REJECTED');
   await controller.reconcile(id,{batchId,status:'RESPONSE',evidence:item.evidence});
   await emit('REREAD_CONFIRMED',{state:await store.load(id),runId,batchId});
   return true;
  }catch(error){return await fail('REREAD_ERROR',{error});}
 }
 // A run interrupted by Stop or a reload may hold every answer in its journal while its report is unfinished. The Basic
 // engine replays the recorded schema on those answers (no transport, nothing is written); the report is used only when it
 // comes out settled. null: the original record stays as it is.
 async function recoverReport({state,store,models}){
  const id=state.researchId,runId=state.activeRunId;
  const settled=report=>{try{contextApi.extractAnswers(report);return true;}catch(_){return false;}};
  try{
   const run=await store.getRun(id,runId);
   if(!run||run.batches.some(b=>['INTENT','UNKNOWN','ABANDONED_UNKNOWN'].includes(b.status)))return null;
   const rows=await store.getEvents(id,runId),events=rows.map(r=>r.payload);
   if(settled(rows.find(r=>r.eventId===run.resultEventId)?.payload?.report))return null;
   const start=events.find(e=>e?.type==='RUN_INTENT');
   if(!start?.schema)return null;
   const recorded=[];
   for(const intent of events.filter(e=>e?.type==='DISPATCH_INTENT')){
    const response=events.find(e=>e?.type==='DISPATCH_RESPONSE'&&e.batchId===intent.batchId)?.response?.byModel;
    const reread=rows.find(r=>r.eventId==='RECONCILED:'+intent.batchId)?.payload;
    const prompts=events.find(e=>e?.type==='DISPATCH_PROMPT'&&e.batchId===intent.batchId)?.prompts;
    const byModel=response||(reread?.status==='RESPONSE'&&reread.evidence?.answers?Object.fromEntries(Object.entries(reread.evidence.answers).map(([model,text])=>
     [model,{text,status:'SUCCESS',completion:'complete',answered:true,sentPrompt:typeof prompts==='string'?prompts:prompts?.[model]}])):null);
    if(byModel)recorded.push({step:intent.meta?.step,byModel});
   }
   if(!recorded.length)return null;
   const adapter=adapterApi.createBasicAdapter({
    send:async(names,_,meta)=>{
     const at=recorded.findIndex(r=>r.step===meta?.step&&names.every(name=>r.byModel[name]));
     if(at<0)throw Object.assign(Error('CIRCLE_ANSWER_NOT_RECORDED'),{notSent:true});
     return {byModel:recorded.splice(at,1)[0].byModel};
    },
    accept:bridge.accept,journal:async()=>{},availableModels:models,isRole:()=>true,roleText:bridge.roleText});
   const report=await adapter.execute({researchId:id,cycleId:run.cycleId,runId,schema:start.schema,task:start.task,
    maxCalls:start.maxCalls,maxPromptChars:start.maxPromptChars});
   return settled(report)?{...report,reservedCalls:run.usedCalls,recovered:true}:null;
  }catch(_){return null;}
 }
 // The research loop: one bounded transition per iteration, shared by start and resume.
 // The file copy holds the paused state, an interrupted run included. A failed copy is journaled by the gate and keeps
// the pause: the next Resume makes a verified copy before anything runs.
async function copyPaused(observedGate,id){try{await observedGate.persist(id,'manual');}catch(_){}}
async function drive({id,store,controller,observedGate,loadPipeline,schema,session,record,emit}){
  for(;;){
   let state=await store.load(id);
   if(session.stopRequested&&!state.stopRequested){await controller.stop(id);state=await store.load(id);}
   if(state.phase==='READY'){
    session.bridgeRun=id+':cycle:'+state.nextCycle;
    let began=false;const cycleStarted=Date.now();
    await emit("CYCLE_START",{cycleId:state.nextCycle,runId:session.bridgeRun,state});
    try{
     const entry=await loadPipeline(state.pipelineRef);
     bridge.begin({runId:session.bridgeRun,schema:entry?.schema||schema});began=true;
     const result=await record(await controller.tick(id));
     if(result.outcome!=='RUN_RETURNED')break;
    }finally{try{if(began)bridge.end({runId:session.bridgeRun});}finally{await emit("CYCLE_END",{cycleId:state.nextCycle,runId:session.bridgeRun,durationMs:Date.now()-cycleStarted});session.bridgeRun=null;}}
    continue;
   }
   if(state.phase==='COMMIT'||state.phase==='EVALUATE'){
    const result=await record(await controller.tick(id));
    if(result.outcome==='PACKET_COMMITTED')continue;
    if(result.outcome==='DECISION'){
     // Decision is committed after the packet backup; save the updated state as well.
     await emit('BACKUP_START',{state:result.state,reason:'decision'});
     await observedGate.persist(id,'cycle');
     await emit('BACKUP_VERIFIED',{state:result.state,reason:'decision'});
     if(result.decision?.action==='CONTINUE')continue;
    }
    break;
   }
   if(state.phase==='PAUSED'||state.phase==='COMPLETED'){
    if(state.backupRequiredCycleId!=null)await record(await controller.tick(id));
    break;
   }
   await record({state,outcome:'RECOVERY_REQUIRED'});
   break;
  }
  if(session.stopRequested){
   // Stop after a request left the page: its outcome is unknown. The research pauses with the run open (no resend) and the
   // transport is freed; a person continues or closes it later.
   const stopped=await store.load(id);
   if(unsettled(stopped)&&stopped.stopRequested){
    try{await record(await controller.suspend(id));}
    catch(error){await emit('RUN_SUSPEND_FAILED',{state:stopped,error});}
   }
   await copyPaused(observedGate,id);
  }
 }
  async function start({task,maxCalls=24,maxCallsPerCycle=maxCalls,maxPromptChars=20000,onProgress=()=>{},contextMode=null}={}){
  if(running)throw Error('CIRCLE_ALREADY_RUNNING');
   const parsed=contextApi.parseContextTask(task,contextMode);
   task=parsed.task;contextMode=parsed.mode;
  if(typeof task!=='string'||!task.trim()||task.length>10000||!pos(maxCalls)||maxCalls>10000||
   !pos(maxCallsPerCycle)||maxCallsPerCycle>maxCalls||!pos(maxPromptChars)||maxPromptChars<2000)
   throw Error('CIRCLE_INPUT_INVALID');
  const session={researchId:'circle-'+uuid(),controller:null,stopRequested:false,bridgeRun:null};
  running=session;
  let active,backup,created=false,held=false;
  const id=session.researchId;
  const {outcomes,emit,record}=makeRecorder(id,onProgress);
  session.emit=emit;
  let stopBeat=null;
  try{
   // Keeps Basic and a second Circle out of the page for the whole research, gaps between cycles included.
   if(typeof bridge.hold==='function'){bridge.hold({stop});held=true;}
    await emit("RESEARCH_START",{budget:{maxCalls},maxCallsPerCycle,maxPromptChars,contextMode});
   const selected=bridge.capture();
   if(selected?.errors?.length){await emit('SCHEMA_INVALID',{errors:selected.errors});throw Error('CIRCLE_BASIC_SCHEMA_INVALID');}
   const models=[...new Set(selected?.models||[])];
   if(!models.length||models.some(m=>typeof m!=='string'||!m.trim()))throw Error('CIRCLE_NO_MODELS');
   await emit("MODELS_SELECTED",{models});
   const schema=copy(selected.schema);
   schema.run={...(schema.run||{}),policy:'auto'};
    if(contextMode==='latest-summary')contextApi.validateSummarySchema(schema);
   const ref='thecycle:circle:'+id+':schema:1';
   active=await activeStore.createActiveStateStore();
   const store=active.store;
   await emit('SCHEMA_CAPTURED',{schema,database:active.database,pipelineRef:ref});
   const cfg={schema,pipelineRef:ref,models,contextMode,maxCallsPerCycle,maxPromptChars};
   const backupRef={gate:null};
   const parts=assemble(id,cfg,{store,emit,session,backupRef});
   await parts.check();
   // Require real independent backup storage before any provider request.
   await emit("BACKUP_OPEN");
   backup=await createBackup({stateStore:store,storage,onDiagnostic:emit});
   if(!backup?.gate?.persist||!backup.gate.assertCanStartCycle)throw Error('CIRCLE_BACKUP_UNAVAILABLE');
   backupRef.gate=backup.gate;
   if(session.stopRequested)return {researchId:id,outcomes,state:{phase:'PAUSED'},reason:'OWNER_STOP'};
    const saved={...cfg,analyst:parts.analyst||undefined,createdAt:new Date().toISOString(),database:active.database};
    await storage.set({[key(id)]:saved});
   await store.createResearch({researchId:id,task,pipelineRef:ref,maxCalls,config:saved});created=true;
   await storage.set({'thecycle.circle.latest':id});
   stopBeat=await startHeartbeat(id);await setPending(id,'ACTIVE');
   const {controller,observedGate}=parts.build();
   session.controller=controller;
   // Initial checkpoint; gate starts blocked by design.
   await emit('BACKUP_START',{reason:'initial'});
   await observedGate.persist(id,'manual');
   await emit('BACKUP_VERIFIED',{reason:'initial'});
   await drive({id,store,controller,observedGate,loadPipeline:parts.loadPipeline,schema,session,record,emit});
   await stopBeat?.();stopBeat=null;
   const final=await snapshot(id);
   await settlePending(id,final.state,false);
   await emit("RESEARCH_END",{state:final.state,outcome:outcomes.at(-1)?.outcome});
   return {...final,outcomes};
  }catch(error){
   await emit("RESEARCH_ERROR",{error,runId:session.bridgeRun});
   // No blind retry: the durable state and journal are retained for diagnosis.
   if(created){
    try{await storage.set({['thecycle.circle.error.'+id]:String(error?.message||error)});}catch(_){}
   }
   throw error;
  }finally{
   try{await stopBeat?.();}catch(_){}
   // Free transport ownership of a settled research so the next Circle starts without a reload; a run needing recovery stays held.
   try{await session.controller?.releaseSettled?.(id);}catch(_){}
   try{backup?.close?.();}finally{try{active?.close();}finally{running=null;if(held)try{bridge.release?.();}catch(_){}}}
  }
 }
 // Human-started continuation of a saved research after Stop, a pause or a page reload (mode: resume | abandon | close).
 // The outcome of a request that was in flight is never guessed: it pauses for a human choice; nothing is resent.
 async function recover(id,mode,onProgress=()=>{},maxCalls){
  if(running)throw Error('CIRCLE_ALREADY_RUNNING');
  if(typeof id!=='string'||!id||(maxCalls!==undefined&&(!pos(maxCalls)||maxCalls>10000)))throw Error('CIRCLE_INPUT_INVALID');
  const session={researchId:id,controller:null,stopRequested:false,bridgeRun:null};
  running=session;
  let active,backup,held=false;
  const {outcomes,emit,record}=makeRecorder(id,onProgress);
  session.emit=emit;
  let stopBeat=null;
  try{
   // The research may be working in another tab (fresh heartbeat of another runner): no takeover, no choice buttons.
   if(await activeElsewhere(id))throw Object.assign(new Error('CIRCLE_ACTIVE_ELSEWHERE'),{code:'CIRCLE_ACTIVE_ELSEWHERE'});
   if(typeof bridge.hold==='function'){bridge.hold({stop});held=true;}
   const stored=(await storage.get(key(id)))[key(id)];
   active=await activeStore.createActiveStateStore();
   const store=active.store;
   let state=await store.load(id).catch(error=>{throw stored?error:Error('CIRCLE_RESEARCH_NOT_FOUND');});
   // Page storage may be gone (a research restored from the file backup): the state carries the same config.
   const saved=stored?.schema?stored:state.config;
   if(!saved?.schema||!saved.pipelineRef||!Array.isArray(saved.models))throw Error('CIRCLE_RESEARCH_NOT_FOUND');
   stopBeat=await startHeartbeat(id);await setPending(id,'ACTIVE');
   // A higher limit given at Resume: the calls already used stay used. The per-cycle limit follows it when it was the whole budget.
   const raise=mode==='resume'&&state.phase!=='COMPLETED'&&pos(maxCalls)&&maxCalls>state.budget.maxCalls;
   // Derived, not saved: the budget change stays a single write.
   const wholeBudget=!pos(saved.maxCallsPerCycle)||saved.maxCallsPerCycle>=(state.budgetHistory?.[0]?.from??state.budget.maxCalls);
   const cfg={...saved,maxCallsPerCycle:wholeBudget?(raise?maxCalls:state.budget.maxCalls):saved.maxCallsPerCycle,
    maxPromptChars:pos(saved.maxPromptChars)?saved.maxPromptChars:20000};
   await emit('RESEARCH_RESUME',{mode,state});
   const backupRef={gate:null};
   const parts=assemble(id,cfg,{store,emit,session,backupRef});
   await parts.check();
   if(mode==='close'&&session.stopRequested)return {...(await snapshot(id)),outcomes};
   const needsBackup=mode!=='close'&&!(state.phase==='COMPLETED'&&state.backupRequiredCycleId==null);
   if(needsBackup){
    // Without a verified copy nothing continues; this happens before ownership changes and before any request.
    await emit('BACKUP_OPEN');
    backup=await createBackup({stateStore:store,storage,onDiagnostic:emit});
    if(!backup?.gate?.persist||!backup.gate.assertCanStartCycle)throw Error('CIRCLE_BACKUP_UNAVAILABLE');
    backupRef.gate=backup.gate;
   }
   const {controller,observedGate}=parts.build();
   session.controller=controller;
   if(needsBackup){
    await emit('BACKUP_START',{reason:'resume'});
    // The gate's record of verified packets may be gone (restore on another profile): the resume copy proves the last packet again.
    if(state.lastCommittedPacket!=null)await observedGate.requireCommit(id,id+':cycle:'+state.lastCommittedPacket);
    await observedGate.persist(id,'manual');
    await emit('BACKUP_VERIFIED',{reason:'resume'});
   }
   const finish=async()=>{await stopBeat?.();stopBeat=null;const final=await snapshot(id);await settlePending(id,final.state,mode==='close');await emit('RESEARCH_END',{state:final.state,outcome:outcomes.at(-1)?.outcome});return {...final,outcomes};};
   if(state.phase==='COMPLETED'&&state.backupRequiredCycleId==null&&mode!=='close')return await finish();
   // The new controller fences the old writer; a stale owner then gets STALE_OWNER on its next write.
   const owner=await store.getOwnership();
   if(owner?.ownerId){
    if(owner.researchId!==id)throw Object.assign(Error('CIRCLE_TRANSPORT_OWNED'),{code:'TRANSPORT_OWNED'});
    await controller.takeOver(id,owner.epoch);
    await emit('OWNERSHIP_TAKEN_OVER',{owner});
   }
   if(raise)await record(await controller.raiseBudget(id,maxCalls));
   state=await store.load(id);
   const inFlight=unsettled(state);
   // A person continues a stopped run: once its outcome is settled the Stop flag is cleared (a Stop pressed meanwhile stays).
   const lift=async()=>{const current=await store.load(id);if(current.stopRequested&&!session.stopRequested)await record(await controller.resumeRun(id));};
   if(mode==='close'){
    await controller.stop(id);
    if(inFlight)await record(await controller.closeStopped(id));
    else await controller.releaseSettled(id);
    return await finish();
   }
   if(mode==='abandon'){
    if(!inFlight)throw Error('CIRCLE_NOTHING_TO_RESOLVE');
    await record(await controller.abandonUnknown(id));
    await lift();
   }else{
    if(inFlight){
     // The request may have gone out before the Stop or the reload: it is never resent. The answer is taken only from the page,
     // by the delivery token of the journaled request; without a confirmed answer a human chooses.
     await controller.claim(id);
     state=await store.load(id);
     const run=await store.getRun(id,state.activeRunId);
     let settled;
     if(state.phase==='RECONCILE'&&run&&!run.batches.some(b=>['INTENT','UNKNOWN'].includes(b.status))){
      // Nothing of the run is left unanswered: it is committed as it is.
      await record(await controller.reconcile(id,{evidence:{source:'OWNER_RESUME',reference:state.activeRunId}}));
      settled=true;
     }else settled=await rereadBatch(id,{store,controller,state,emit});
     if(!settled){
      state=await store.load(id);
      // A stopped research goes back to the pause and does not hold the transport.
      if(state.stopRequested){await record(await controller.suspend(id));await copyPaused(observedGate,id);}
      await record({state:await store.load(id),outcome:'PAUSED',reason:'UNKNOWN_DISPATCH_AFTER_RELOAD',runId:state.activeRunId});
      return await finish();
     }
     await lift();
    }else if(state.phase==='PAUSED'){
     if(state.backupRequiredCycleId!=null){
      await record(await controller.tick(id));
      state=await store.load(id);
      if(state.backupRequiredCycleId!=null)return await finish();
     }
     await record(await controller.resume(id));
    }
   }
   await drive({id,store,controller,observedGate,loadPipeline:parts.loadPipeline,schema:cfg.schema,session,record,emit});
   return await finish();
  }catch(error){
   await emit('RESEARCH_ERROR',{error,runId:session.bridgeRun});
   throw error;
  }finally{
   try{await stopBeat?.();}catch(_){}
   try{await session.controller?.releaseSettled?.(id);}catch(_){}
   try{backup?.close?.();}finally{try{active?.close();}finally{running=null;if(held)try{bridge.release?.();}catch(_){}}}
  }
 }
 const resume=(id,options={})=>recover(id,'resume',options.onProgress,options.maxCalls);
 // choice: 'abandon' (continue without the unknown batch) | 'close' (close the research).
 async function resolveUnknown(id,choice,options={}){
  if(!['abandon','close'].includes(choice))throw Error('CIRCLE_INPUT_INVALID');
  return recover(id,choice,options.onProgress);
 }
 async function stop(){
  if(!running)return {status:'NOT_RUNNING'};
  const session=running;
  session.stopRequested=true;
  if(session.controller)await session.controller.stop(session.researchId);
  await session.emit?.("STOP_REQUESTED");
  return {status:'STOP_REQUESTED',researchId:session.researchId};
 }
 async function latest(){return (await storage.get('thecycle.circle.latest'))['thecycle.circle.latest']||null;}
 // Saved researches of this runner, newest first: what a person chooses from to look at, continue or close.
 async function list(){
  const active=await activeStore.createActiveStateStore();
  try{
   const rows=[];
   for(const state of await active.store.listResearch()){
    const saved=(await storage.get(key(state.researchId)))[key(state.researchId)]||state.config;
    if(saved)rows.push({researchId:state.researchId,task:state.task,phase:state.phase,usedCalls:state.budget.usedCalls,maxCalls:state.budget.maxCalls,createdAt:saved.createdAt||''});
   }
   return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }finally{active.close();}
 }
 return Object.freeze({start,resume,resolveUnknown,stop,snapshot,latest,list,isRunning:()=>Boolean(running)});
}
const api=Object.freeze({createCircleRunner});
root.TheCycleCircle=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
