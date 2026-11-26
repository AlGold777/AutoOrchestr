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
 adapterApi=root.TheCycleBasicAdapter,contextApi=root.TheCycleCircleContext,
 createBackup=openBackup,telemetry=root.TheCycleTelemetry,uuid=()=>root.crypto.randomUUID()}={}){
 if(!bridge||!['capture','send','begin','end','accept','roleText'].every(k=>typeof bridge[k]==='function')||
 !storage?.get||!storage?.set||!activeStore?.createActiveStateStore||!controllerApi?.createController||
 !adapterApi?.createBasicAdapter||!contextApi?.buildTask||typeof createBackup!=='function')throw Error('CIRCLE_DEPENDENCIES_MISSING');
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
   return {researchId:id,database:active.database,state,packet,report,configured:source};
  }finally{active.close();}
 }
 async function start({task,maxCalls=24,maxCallsPerCycle=maxCalls,maxPromptChars=20000,onProgress=()=>{}}={}){
  if(running)throw Error('CIRCLE_ALREADY_RUNNING');
  if(typeof task!=='string'||!task.trim()||task.length>10000||!pos(maxCalls)||maxCalls>10000||
   !pos(maxCallsPerCycle)||maxCallsPerCycle>maxCalls||!pos(maxPromptChars)||maxPromptChars<2000)
   throw Error('CIRCLE_INPUT_INVALID');
  const session={researchId:'circle-'+uuid(),controller:null,stopRequested:false};
  running=session;
  let active,backup,bridgeRun=null,created=false,held=false;
  const id=session.researchId, outcomes=[];
  const emit=async(type,data={})=>{try{await telemetry?.append(type,{researchId:id,...data});}catch(error){console.warn("[TheCycle telemetry]",error);}};
  session.emit=emit;
  const record=async result=>{
   const item={outcome:result.outcome,phase:result.state?.phase,cycle:result.state?.lastCommittedPacket,decision:result.decision,reason:result.reason,error:result.error};
   outcomes.push(item);
   await emit(result.outcome,{state:result.state,packet:result.packet,report:result.report,runId:result.runId,outcome:result.outcome,decision:result.decision,reason:result.reason,error:result.error,errors:result.errors});
   try{onProgress(copy(item));}catch(_){}
   return result;
  };
  try{
   // Keeps Basic and a second Circle out of the page for the whole research, gaps between cycles included.
   if(typeof bridge.hold==='function'){bridge.hold({stop});held=true;}
   await emit("RESEARCH_START",{budget:{maxCalls},maxCallsPerCycle,maxPromptChars});
   const selected=bridge.capture();
   if(selected?.errors?.length){await emit('SCHEMA_INVALID',{errors:selected.errors});throw Error('CIRCLE_BASIC_SCHEMA_INVALID');}
   const models=[...new Set(selected?.models||[])];
   if(!models.length||models.some(m=>typeof m!=='string'||!m.trim()))throw Error('CIRCLE_NO_MODELS');
   await emit("MODELS_SELECTED",{models});
   const schema=copy(selected.schema);
   schema.run={...(schema.run||{}),policy:'auto'};
   const ref='thecycle:circle:'+id+':schema:1';
   active=await activeStore.createActiveStateStore();
   const store=active.store;
   await emit('SCHEMA_CAPTURED',{schema,database:active.database,pipelineRef:ref});
   const makeAdapter=({journal,fence})=>adapterApi.createBasicAdapter({
    send:async(modelNames,prompts,meta)=>{
     // A failure of this pre-check happens before the transport is called: the adapter journals it as NOT_SENT.
     const notSent=(error)=>Object.assign(error instanceof Error?error:new Error(String(error)),{notSent:true});
     let owner;
     try{owner=await store.getOwnership();}catch(error){throw notSent(error);}
     try{await emit('TRANSPORT_FENCE',{owner,runId:meta.runId,cycleId:meta.cycleId,batchId:meta.batchId,step:meta.step});}catch(error){throw notSent(error);}
     if(owner?.researchId!==fence.researchId||owner?.ownerId!==fence.ownerId||owner?.epoch!==fence.epoch||meta.runId!==bridgeRun)
      throw notSent(new Error('CIRCLE_STALE_OWNER'));
     return bridge.send(modelNames,prompts,meta);
    },accept:bridge.accept,journal:async event=>{const saved=await journal(event);let state;try{state=await store.load(id);}catch(_){}await emit(event.type,{event,state});return saved;},availableModels:models,isRole:()=>true,roleText:bridge.roleText
   });
   const checked=makeAdapter({journal:async()=>{},fence:{}}).validate(schema);
   if(!checked.ok){await emit('SCHEMA_INVALID',{errors:checked.errors});throw Error('CIRCLE_ADAPTER_REJECTED_SCHEMA');}
   // Require real independent backup storage before any provider request.
   await emit("BACKUP_OPEN");
   backup=await createBackup({stateStore:store,storage,onDiagnostic:emit});
   if(!backup?.gate?.persist||!backup.gate.assertCanStartCycle)throw Error('CIRCLE_BACKUP_UNAVAILABLE');
   if(session.stopRequested)return {researchId:id,outcomes,state:{phase:'PAUSED'},reason:'OWNER_STOP'};
   await storage.set({[key(id)]:{schema,pipelineRef:ref,models,createdAt:new Date().toISOString(),database:active.database}});
   await store.createResearch({researchId:id,task,pipelineRef:ref,maxCalls});created=true;
   await storage.set({'thecycle.circle.latest':id});
   const gate=backup.gate;
   const observedGate={...gate};
   for(const method of ['requireCommit','persist','assertCanStartCycle']){
    if(typeof gate[method]!=='function')continue;
    observedGate[method]=async(...args)=>{
     const started=Date.now();
     try{const result=await gate[method](...args);await emit('BACKUP_GATE_'+method.toUpperCase(),{backup:result&&typeof result==='object'?result:undefined,durationMs:Date.now()-started,reason:args[1]});return result;}
     catch(error){await emit('BACKUP_GATE_ERROR',{reason:method,error,durationMs:Date.now()-started});throw error;}
    };
   }
   const controller=controllerApi.createController({
    store,makeAdapter,loadPipeline:async value=>value===ref?{ref,schema}:null,
    resolveTask:async({state,store})=>{try{let context;const task=await contextApi.buildTask({state,store,maxChars:Math.floor(maxPromptChars*0.8),onContext:v=>{context=v;}});await emit("CONTEXT_READY",{cycleId:state.nextCycle,state,contextChars:task.length,context});return task;}catch(error){await emit("CONTEXT_ERROR",{state,error});throw error;}},
    maxCallsPerCycle,maxPromptChars,ownerId:'circle-controller-'+uuid(),backupGate:observedGate
   });
   session.controller=controller;
   // Initial checkpoint; gate starts blocked by design.
   await emit('BACKUP_START',{reason:'initial'});
   await observedGate.persist(id,'manual');
   await emit('BACKUP_VERIFIED',{reason:'initial'});
   for(;;){
    let state=await store.load(id);
    if(session.stopRequested&&!state.stopRequested){await controller.stop(id);state=await store.load(id);}
    if(state.phase==='READY'){
     bridgeRun=id+':cycle:'+state.nextCycle;
     let began=false;const cycleStarted=Date.now();
     await emit("CYCLE_START",{cycleId:state.nextCycle,runId:bridgeRun,state});
     try{
      bridge.begin({runId:bridgeRun,schema});began=true;
      const result=await record(await controller.tick(id));
      if(result.outcome!=='RUN_RETURNED')break;
     }finally{try{if(began)bridge.end({runId:bridgeRun});}finally{await emit("CYCLE_END",{cycleId:state.nextCycle,runId:bridgeRun,durationMs:Date.now()-cycleStarted});bridgeRun=null;}}
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
   const final=await snapshot(id);
   await emit("RESEARCH_END",{state:final.state,outcome:outcomes.at(-1)?.outcome});
   return {...final,outcomes};
  }catch(error){
   await emit("RESEARCH_ERROR",{error,runId:bridgeRun});
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
 async function stop(){
  if(!running)return {status:'NOT_RUNNING'};
  const session=running;
  session.stopRequested=true;
  if(session.controller)await session.controller.stop(session.researchId);
  await session.emit?.("STOP_REQUESTED");
  return {status:'STOP_REQUESTED',researchId:session.researchId};
 }
 async function latest(){return (await storage.get('thecycle.circle.latest'))['thecycle.circle.latest']||null;}
 return Object.freeze({start,stop,snapshot,latest,isRunning:()=>Boolean(running)});
}
const api=Object.freeze({createCircleRunner});
root.TheCycleCircle=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
