// Circle / TheCycle: independent multi-run pipeline on the unchanged Basic Engine.
// G2 vertical slice: requires the results document to stay open; crash recovery is G4.
(function(root){'use strict';
const pos=n=>Number.isSafeInteger(n)&&n>0;
const copy=v=>JSON.parse(JSON.stringify(v));
async function openBackup({stateStore,storage}){
 const settings=await storage.get('thecycleBackupEnabled');
 if(settings.thecycleBackupEnabled!==true)throw Error('CIRCLE_CONFIGURE_BACKUP_DIRECTORY');
 const manager=await root.TheCycleDirectoryHandleManager.createDirectoryHandleManager();
 try {
  const directory=await manager.load('thecycle-backups');
  return await root.TheCycleBackupRuntime.createBackupRuntime({directory,stateStore});
 }finally{manager.close();}
}
function createCircleRunner({bridge,storage=root.chrome?.storage?.local,
 activeStore=root.TheCycleActiveStateStore,controllerApi=root.TheCycleController,
 adapterApi=root.TheCycleBasicAdapter,contextApi=root.TheCycleCircleContext,
 createBackup=openBackup,uuid=()=>root.crypto.randomUUID()}={}){
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
  let active,backup,bridgeRun=null,created=false;
  const id=session.researchId, outcomes=[];
  const record=async result=>{
   const item={outcome:result.outcome,phase:result.state?.phase,cycle:result.state?.lastCommittedPacket,decision:result.decision,reason:result.reason,error:result.error};
   outcomes.push(item);
   try{onProgress(copy(item));}catch(_){}
   return result;
  };
  try{
   const selected=bridge.capture();
   if(selected?.errors?.length)throw Error('CIRCLE_BASIC_SCHEMA_INVALID');
   const models=[...new Set(selected?.models||[])];
   if(!models.length||models.some(m=>typeof m!=='string'||!m.trim()))throw Error('CIRCLE_NO_MODELS');
   const schema=copy(selected.schema);
   schema.run={...(schema.run||{}),policy:'auto'};
   const ref='thecycle:circle:'+id+':schema:1';
   active=await activeStore.createActiveStateStore();
   const store=active.store;
   const makeAdapter=({journal,fence})=>adapterApi.createBasicAdapter({
    send:async(modelNames,prompts,meta)=>{
     const owner=await store.getOwnership();
     if(owner?.researchId!==fence.researchId||owner?.ownerId!==fence.ownerId||owner?.epoch!==fence.epoch||meta.runId!==bridgeRun)
      throw Error('CIRCLE_STALE_OWNER');
     return bridge.send(modelNames,prompts,meta);
    },accept:bridge.accept,journal,availableModels:models,isRole:()=>true,roleText:bridge.roleText
   });
   if(!makeAdapter({journal:async()=>{},fence:{}}).validate(schema).ok)throw Error('CIRCLE_ADAPTER_REJECTED_SCHEMA');
   // Require real independent backup storage before any provider request.
   backup=await createBackup({stateStore:store,storage});
   if(!backup?.gate?.persist||!backup.gate.assertCanStartCycle)throw Error('CIRCLE_BACKUP_UNAVAILABLE');
   if(session.stopRequested)return {researchId:id,outcomes,state:{phase:'PAUSED'},reason:'OWNER_STOP'};
   await storage.set({[key(id)]:{schema,pipelineRef:ref,models,createdAt:new Date().toISOString(),database:active.database}});
   await store.createResearch({researchId:id,task,pipelineRef:ref,maxCalls});created=true;
   await storage.set({'thecycle.circle.latest':id});
   const controller=controllerApi.createController({
    store,makeAdapter,loadPipeline:async value=>value===ref?{ref,schema}:null,
    resolveTask:({state,store})=>contextApi.buildTask({state,store,maxChars:Math.floor(maxPromptChars*0.8)}),
    maxCallsPerCycle,maxPromptChars,ownerId:'circle-controller-'+uuid(),backupGate:backup.gate
   });
   session.controller=controller;
   // Initial checkpoint; gate starts blocked by design.
   await backup.gate.persist(id,'manual');
   for(;;){
    let state=await store.load(id);
    if(session.stopRequested&&!state.stopRequested){await controller.stop(id);state=await store.load(id);}
    if(state.phase==='READY'){
     bridgeRun=id+':cycle:'+state.nextCycle;
     let began=false;
     try{
      bridge.begin({runId:bridgeRun,schema});began=true;
      const result=await record(await controller.tick(id));
      if(result.outcome!=='RUN_RETURNED')break;
     }finally{try{if(began)bridge.end({runId:bridgeRun});}finally{bridgeRun=null;}}
     continue;
    }
    if(state.phase==='COMMIT'||state.phase==='EVALUATE'){
     const result=await record(await controller.tick(id));
     if(result.outcome==='PACKET_COMMITTED')continue;
     if(result.outcome==='DECISION'){
      // Decision is committed after the packet backup; save the updated state as well.
      await backup.gate.persist(id,'cycle');
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
   return {...await snapshot(id),outcomes};
  }catch(error){
   // No blind retry: the durable state and journal are retained for diagnosis.
   if(created){
    try{await storage.set({['thecycle.circle.error.'+id]:String(error?.message||error)});}catch(_){}
   }
   throw error;
  }finally{
   try{backup?.close?.();}finally{try{active?.close();}finally{running=null;}}
  }
 }
 async function stop(){
  if(!running)return {status:'NOT_RUNNING'};
  running.stopRequested=true;
  if(running.controller)await running.controller.stop(running.researchId);
  return {status:'STOP_REQUESTED',researchId:running.researchId};
 }
 async function latest(){return (await storage.get('thecycle.circle.latest'))['thecycle.circle.latest']||null;}
 return Object.freeze({start,stop,snapshot,latest,isRunning:()=>Boolean(running)});
}
const api=Object.freeze({createCircleRunner});
root.TheCycleCircle=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
