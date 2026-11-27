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
 createBackup=openBackup,telemetry=root.TheCycleTelemetry,uuid=()=>root.crypto.randomUUID()}={}){
 if(!bridge||!['capture','send','begin','end','accept','roleText'].every(k=>typeof bridge[k]==='function')||
 !storage?.get||!storage?.set||!activeStore?.createActiveStateStore||!controllerApi?.createController||
  !adapterApi?.createBasicAdapter||!contextApi?.buildTask||!contextApi?.parseContextTask||
  !contextApi?.validateSummarySchema||typeof createBackup!=='function')throw Error('CIRCLE_DEPENDENCIES_MISSING');
 let running=null;
 const key=id=>'thecycle.circle.research.'+id;
 async function snapshot(id){
  const active=await activeStore.createActiveStateStore();
  try{
   const state=await active.store.load(id);
   const packet=state.lastCommittedPacket==null?null:await active.store.getPacket(id,state.lastCommittedPacket);
   const events=packet?await active.store.getEvents(id,packet.runId):[];
   const report=events.find(e=>e.eventId===packet?.resultEventId)?.payload?.report||null;
   const source=(await storage.get(key(id)))[key(id)]||null;
   // After a reload a run left in flight has an unknown outcome: it is told apart from a live run by "nothing runs in this page".
   const unknown=!running&&Boolean(state.activeRunId)&&['RECONCILE','INTENT','RUNNING'].includes(state.phase);
   const pauseReason=unknown?'UNKNOWN_DISPATCH_AFTER_RELOAD':(['PAUSED','COMPLETED'].includes(state.phase)?(state.lastDecision?.reason||state.closedReason||null):null);
   return {researchId:id,database:active.database,state,packet,report,configured:source,unknown,pauseReason,lastDecision:state.lastDecision||null};
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
 // cfg: the research config saved under thecycle.circle.research.<id>. backupRef.gate is filled once the backup is open.
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
  const makeAdapter=({journal,fence})=>adapterApi.createBasicAdapter({
   send:async(modelNames,prompts,meta)=>{
    // A failure of this pre-check happens before the transport is called: the adapter journals it as NOT_SENT.
    const notSent=(error)=>Object.assign(error instanceof Error?error:new Error(String(error)),{notSent:true});
    let owner;
    try{owner=await store.getOwnership();}catch(error){throw notSent(error);}
    try{await emit('TRANSPORT_FENCE',{owner,runId:meta.runId,cycleId:meta.cycleId,batchId:meta.batchId,step:meta.step});}catch(error){throw notSent(error);}
    if(owner?.researchId!==fence.researchId||owner?.ownerId!==fence.ownerId||owner?.epoch!==fence.epoch||meta.runId!==session.bridgeRun)
     throw notSent(new Error('CIRCLE_STALE_OWNER'));
    return bridge.send(modelNames,prompts,meta);
   },accept:bridge.accept,journal:async event=>{const saved=await journal(event);let state;try{state=await store.load(id);}catch(_){}await emit(event.type,{event,state});return saved;},availableModels:models,isRole:()=>true,roleText:bridge.roleText,
   reread:typeof bridge.reread==='function'?bridge.reread:null,settings:typeof bridge.settings==='function'?bridge.settings:null
  });
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
    // Only finished work cycles are evidence: a partial recovery packet has no report to read.
    const evidenceCycles=async(state,upTo)=>{
     const cycles=[];
     for(let n=1;n<=upTo;n++){const p=await store.getPacket(state.researchId,n);if(p?.status==='RECORDED_RESULT'&&(!policyApi||roleOfRef(p.pipelineRef)==='work'))cycles.push(n);}
     return cycles;
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
        // The analyst reads the last work cycle; after a verification cycle it also sees the verdict.
        let workId=state.lastCommittedPacket,verification;
        const last=await store.getPacket(state.researchId,workId);
        if(roleOfRef(last?.pipelineRef)==='verify'){
         const rec=last.decision?.detail?.verificationRecord;
         if(!rec)throw Error('CIRCLE_VERIFY_RECORD_MISSING');
         verification=policyApi.verificationText(rec);
         workId=null;
         for(let n=state.lastCommittedPacket-1;n>=1;n--){const p=await store.getPacket(state.researchId,n);if(p?.status==='RECORDED_RESULT'&&roleOfRef(p.pipelineRef)==='work'){workId=n;break;}}
         if(workId===null)throw Error('CIRCLE_COMMITTED_PACKET_MISSING');
        }
        const {packet,report,answers}=await contextApi.readCycle(store,state.researchId,workId);
        const current=(await loadPipeline(packet.pipelineRef))?.schema||schema;
        const parts={task:state.task,budget:policyApi.budgetText(state.budget),schema:current,actions:policyApi.ACTIONS,verification};
        let summary=policyApi.summaryFromAnswers(answers,packet.cycleId,contextMode,report.steps.length);
        // Same limit as the work cycle: 0.8 of the prompt minus the template; the summary is cut, never the template.
        const room=Math.floor(maxPromptChars*0.8)-policyApi.buildAnalystTask({...parts,summary:''}).length;
        if(room<256)throw Error('CIRCLE_CONTEXT_LIMIT');
        if(summary.length>room){const mark=' [TRUNCATED]';summary=summary.slice(0,room-mark.length)+mark;}
        const task=policyApi.buildAnalystTask({...parts,summary});
        await emit("CONTEXT_READY",{cycleId:state.nextCycle,state,contextChars:task.length,context:{role:'analyst',cycleId:packet.cycleId}});
        return task;
       }
       // With an analyst, its cycles are not evidence for the work cycle: only finished work cycles (of any strategy) count.
       const cycles=state.lastCommittedPacket!=null?await evidenceCycles(state,state.lastCommittedPacket):[];
       // Nothing finished yet (every earlier cycle was a partial recovery): the work starts from the task again.
       if(state.lastCommittedPacket!=null&&!cycles.length){
        if(state.task.length>Math.floor(maxPromptChars*0.8))throw Error('CIRCLE_CONTEXT_LIMIT');
        await emit("CONTEXT_READY",{cycleId:state.nextCycle,state,contextChars:state.task.length,context:{included:[],omittedOlderCycles:0}});
        return state.task;
       }
       const task=await contextApi.buildTask({state,store,mode:contextMode,cycles:state.lastCommittedPacket!=null?cycles:null,maxChars:Math.floor(maxPromptChars*0.8),onContext:v=>{context=v;}});await emit("CONTEXT_READY",{cycleId:state.nextCycle,state,contextChars:task.length,context});return task;}catch(error){await emit("CONTEXT_ERROR",{state,error});throw error;}},
     maxCallsPerCycle,maxPromptChars,ownerId:'circle-controller-'+uuid(),backupGate:observedGate
    });
    return {controller,observedGate};
   }};
 }
 // The research loop: one bounded transition per iteration, shared by start and resume.
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
   // Stop after a request left the page: its outcome is unknown. Close the research (no resend) and free the transport.
   const stopped=await store.load(id);
   if(stopped.activeRunId&&['RECONCILE','RUNNING','INTENT'].includes(stopped.phase)){
    try{await record(await controller.closeStopped(id));}
    catch(error){await emit('RUN_CLOSE_FAILED',{state:stopped,error});}
   }
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
    await storage.set({[key(id)]:{...cfg,analyst:parts.analyst||undefined,createdAt:new Date().toISOString(),database:active.database}});
   await store.createResearch({researchId:id,task,pipelineRef:ref,maxCalls});created=true;
   await storage.set({'thecycle.circle.latest':id});
   const {controller,observedGate}=parts.build();
   session.controller=controller;
   // Initial checkpoint; gate starts blocked by design.
   await emit('BACKUP_START',{reason:'initial'});
   await observedGate.persist(id,'manual');
   await emit('BACKUP_VERIFIED',{reason:'initial'});
   await drive({id,store,controller,observedGate,loadPipeline:parts.loadPipeline,schema,session,record,emit});
   const final=await snapshot(id);
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
   // Free transport ownership of a settled research so the next Circle starts without a reload; a run needing recovery stays held.
   try{await session.controller?.releaseSettled?.(id);}catch(_){}
   try{backup?.close?.();}finally{try{active?.close();}finally{running=null;if(held)try{bridge.release?.();}catch(_){}}}
  }
 }
 // Human-started continuation of a saved research after a page reload (mode: resume | abandon | close).
 // The outcome of a request that was in flight is never guessed: it pauses for a human choice; nothing is resent.
 async function recover(id,mode,onProgress=()=>{}){
  if(running)throw Error('CIRCLE_ALREADY_RUNNING');
  if(typeof id!=='string'||!id)throw Error('CIRCLE_INPUT_INVALID');
  const session={researchId:id,controller:null,stopRequested:false,bridgeRun:null};
  running=session;
  let active,backup,held=false;
  const {outcomes,emit,record}=makeRecorder(id,onProgress);
  session.emit=emit;
  try{
   if(typeof bridge.hold==='function'){bridge.hold({stop});held=true;}
   const saved=(await storage.get(key(id)))[key(id)];
   if(!saved?.schema||!saved.pipelineRef||!Array.isArray(saved.models))throw Error('CIRCLE_RESEARCH_NOT_FOUND');
   active=await activeStore.createActiveStateStore();
   const store=active.store;
   let state=await store.load(id);
   const cfg={...saved,maxCallsPerCycle:pos(saved.maxCallsPerCycle)?saved.maxCallsPerCycle:state.budget.maxCalls,
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
    await observedGate.persist(id,'manual');
    await emit('BACKUP_VERIFIED',{reason:'resume'});
   }
   const finish=async()=>{const final=await snapshot(id);await emit('RESEARCH_END',{state:final.state,outcome:outcomes.at(-1)?.outcome});return {...final,outcomes};};
   if(state.phase==='COMPLETED'&&state.backupRequiredCycleId==null&&mode!=='close')return await finish();
   // The new controller fences the old writer; a stale owner then gets STALE_OWNER on its next write.
   const owner=await store.getOwnership();
   if(owner?.ownerId){
    if(owner.researchId!==id)throw Object.assign(Error('CIRCLE_TRANSPORT_OWNED'),{code:'TRANSPORT_OWNED'});
    await controller.takeOver(id,owner.epoch);
    await emit('OWNERSHIP_TAKEN_OVER',{owner});
   }
   state=await store.load(id);
   const inFlight=Boolean(state.activeRunId)&&['RECONCILE','INTENT','RUNNING'].includes(state.phase);
   if(mode==='close'){
    await controller.stop(id);
    if(inFlight)await record(await controller.closeStopped(id));
    else await controller.releaseSettled(id);
    return await finish();
   }
   if(mode==='abandon'){
    if(!inFlight)throw Error('CIRCLE_NOTHING_TO_RESOLVE');
    await record(await controller.abandonUnknown(id));
   }else{
    if(inFlight){
     // The request may have gone out before the reload: no pickup of an answer, no resend. A human chooses.
     await record({state,outcome:'PAUSED',reason:'UNKNOWN_DISPATCH_AFTER_RELOAD',runId:state.activeRunId});
     return await finish();
    }
    if(state.phase==='PAUSED'){
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
   try{await session.controller?.releaseSettled?.(id);}catch(_){}
   try{backup?.close?.();}finally{try{active?.close();}finally{running=null;if(held)try{bridge.release?.();}catch(_){}}}
  }
 }
 const resume=(id,options={})=>recover(id,'resume',options.onProgress);
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
 return Object.freeze({start,resume,resolveUnknown,stop,snapshot,latest,isRunning:()=>Boolean(running)});
}
const api=Object.freeze({createCircleRunner});
root.TheCycleCircle=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
