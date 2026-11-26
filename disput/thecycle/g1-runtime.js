// G1 vertical slice: one real Basic run via the existing results-page transport.
// No autonomous replay: G2 owns the multi-cycle scheduler.
(function(root){'use strict';
const nonempty = s => typeof s === 'string' && s.trim().length > 0;
const copy = v => JSON.parse(JSON.stringify(v));
function createG1Runner({bridge,storage=root.chrome?.storage?.local,
 activeStore=root.TheCycleActiveStateStore,
 controllerApi=root.TheCycleController,adapterApi=root.TheCycleBasicAdapter,
 uuid=()=>root.crypto.randomUUID()}={}){
 if(!bridge||!['capture','send','begin','end','accept','roleText'].every(k=>typeof bridge[k]==='function')||
 !storage?.get||!storage?.set||!activeStore?.createActiveStateStore||
 !controllerApi?.createController||!adapterApi?.createBasicAdapter)
 throw new Error('G1_DEPENDENCIES_MISSING');
 let running=null;
 const key=id=>'thecycle.g1.research.'+id;
 async function snapshot(id){
  const active=await activeStore.createActiveStateStore();
  try{
   const state=await active.store.load(id);
   const packet=state.lastCommittedPacket==null?null:
    await active.store.getPacket(id,state.lastCommittedPacket);
   const events=packet?await active.store.getEvents(id,packet.runId):[];
   const report=events.find(e=>e.eventId===packet?.resultEventId)?.payload?.report||null;
   const source=(await storage.get(key(id)))[key(id)]||null;
   return {researchId:id,database:active.database,state,packet,report,
    configured:source?{createdAt:source.createdAt,models:source.models,pipelineRef:source.pipelineRef}:null};
  }finally{active.close();}
 }
 async function start({task,maxCalls=24,maxCallsPerCycle=24,maxPromptChars=20000}={}){
  if(running)throw new Error('G1_ALREADY_RUNNING');
  if(!nonempty(task)||task.length>10000)throw new Error('G1_TASK_INVALID');
  if(!Number.isSafeInteger(maxCalls)||maxCalls<1||maxCalls>10000||
   !Number.isSafeInteger(maxCallsPerCycle)||maxCallsPerCycle<1||maxCallsPerCycle>maxCalls||
   !Number.isSafeInteger(maxPromptChars)||maxPromptChars<1000)
   throw new Error('G1_BUDGET_INVALID');
  const selected=bridge.capture();
  if(selected?.errors?.length)throw new Error('G1_BASIC_SCHEMA_INVALID: '+JSON.stringify(selected.errors));
  // TheCycle is autonomous even when the editor's Basic default is manual.
  const models=[...new Set(selected.models||[])];
  if(!models.length||models.some(m=>!nonempty(m)))throw new Error('G1_NO_MODELS');
  const schema=copy(selected.schema);
  schema.run={...(schema.run||{}),policy:'auto'};
  const researchId='g1-'+uuid();
  const runId=researchId+':cycle:1';
  const pipelineRef='thecycle:g1:'+researchId+':schema:1';
  const active=await activeStore.createActiveStateStore();
  const store=active.store;
  const makeAdapter=({journal,fence})=>adapterApi.createBasicAdapter({
   send:async(modelNames,prompts,meta)=>{
    // A failure of this pre-check happens before the transport is called: the adapter journals it as NOT_SENT.
    const notSent=(error)=>Object.assign(error instanceof Error?error:new Error(String(error)),{notSent:true});
    let current;
    try{current=await store.getOwnership();}catch(error){throw notSent(error);}
    if(current?.researchId!==fence.researchId||current?.ownerId!==fence.ownerId||
       current?.epoch!==fence.epoch)throw notSent(new Error('G1_STALE_OWNER'));
    return bridge.send(modelNames,prompts,meta);
   },
   accept:bridge.accept,journal,availableModels:models,
   isRole:()=>true,roleText:bridge.roleText
  });
  let controller,bridgeStarted=false,held=false;
  try{
   if(typeof bridge.hold==='function'){bridge.hold({stop});held=true;}
   const validation=makeAdapter({journal:async()=>{},fence:{}}).validate(schema);
   if(!validation.ok)throw new Error('G1_ADAPTER_REJECTED_SCHEMA: '+JSON.stringify(validation.errors));
   await storage.set({[key(researchId)]:{
    schema,pipelineRef,models,createdAt:new Date().toISOString(),database:active.database
   }});
   await store.createResearch({researchId,task,pipelineRef,maxCalls});
   await storage.set({'thecycle.g1.latest':researchId});
   controller=controllerApi.createController({
    store,makeAdapter,loadPipeline:async ref=>ref===pipelineRef?{ref,schema}:null,
    maxCallsPerCycle,maxPromptChars,ownerId:'g1-controller-'+uuid(),backupGate:null
   });
   running={researchId,controller};
   bridge.begin({runId,schema});bridgeStarted=true;
   const outcomes=[];
   // G1 executes exactly one Basic pipeline. COMMIT and EVALUATE are
   // state-only ticks; do not dispatch a second Basic run here.
   const run=await controller.tick(researchId);
   outcomes.push(run.outcome);
   if(run.outcome==='RUN_RETURNED'){
    const afterRun=await store.load(researchId);
    if(afterRun.phase==='COMMIT'){
     const commit=await controller.tick(researchId);outcomes.push(commit.outcome);
    }
    const afterCommit=await store.load(researchId);
    if(afterCommit.phase==='EVALUATE'){
     const decision=await controller.tick(researchId);outcomes.push(decision.outcome);
    }
    const post=await store.load(researchId);
    if(post.phase==='READY'){
     await controller.stop(researchId);
     outcomes.push('G1_SINGLE_CYCLE_STOP');
    }
   }
   const final=await store.load(researchId);
   const packet=final.lastCommittedPacket==null?null:
    await store.getPacket(researchId,final.lastCommittedPacket);
   const events=packet?await store.getEvents(researchId,packet.runId):[];
   const report=events.find(e=>e.eventId===packet?.resultEventId)?.payload?.report||null;
   return {researchId,runId,outcomes,database:active.database,state:final,packet,report};
  }finally{
   try{
    try{if(bridgeStarted)bridge.end({runId});}
    finally{
     try{await controller?.releaseSettled?.(researchId);}catch(_){}
    }
   }finally{
    running=null;
    try{active.close();}
    finally{
     if(held)try{bridge.release?.();}catch(_){}
    }
   }
  }
 }
 async function stop(){
  if(!running)return {status:'NOT_RUNNING'};
  const id=running.researchId;
  await running.controller.stop(id);
  return {status:'STOP_REQUESTED',researchId:id};
 }
 async function latest(){
  const data=await storage.get('thecycle.g1.latest');
  return data['thecycle.g1.latest']||null;
 }
 return Object.freeze({start,stop,snapshot,latest,isRunning:()=>Boolean(running)});
}
const api=Object.freeze({createG1Runner});
root.TheCycleG1=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
