// Isolated, local diagnostic journal. Clearing it never touches research evidence or backups.
(function(root){'use strict';
const DB='auto-orchestr-thecycle-telemetry', STORE='entries';
const str=(v,max=300)=>typeof v==='string'?v.slice(0,max):undefined;
const num=v=>Number.isFinite(v)?v:undefined;
const clone=v=>JSON.parse(JSON.stringify(v));
function errorInfo(e){
 if(!e)return undefined;
 return {code:str(e.code||e.name,100),message:str(typeof e==='string'?e:e.message,1000),stack:str(e.stack,6000),cause:e.cause?{code:str(e.cause.code||e.cause.name,100),message:str(e.cause.message,1000)}:undefined};
}
function project(type,d={}){
 const state=d.state||{}, event=d.event||{}, report=event.report||d.report||{};
 const response=event.response?.byModel||{};
 const budget=state.budget||d.budget||{};
 const decision=d.decision||state.lastDecision||{};
 const models=Array.isArray(d.models||event.models)?(d.models||event.models).filter(x=>typeof x==='string').map(x=>str(x,80)):undefined;
 const schema=d.schema||event.schema;
 const context=d.context;
 const backup=d.backup;
 const owner=d.owner;
 const packet=d.packet;
 const result={
  diagnosticsRevision:2,
  pipelineRef:str(state.pipelineRef||d.pipelineRef),database:str(d.database),
  nextCycle:num(state.nextCycle),activeRunId:str(state.activeRunId),stopRequested:typeof state.stopRequested==='boolean'?state.stopRequested:undefined,
  owner:owner?{researchId:str(owner.researchId),ownerId:str(owner.ownerId),epoch:num(owner.epoch)}:undefined,
  packet:packet?{cycleId:num(packet.cycleId),runId:str(packet.runId),status:str(packet.status),resultEventId:str(packet.resultEventId),journalEventCount:num(packet.journalEventCount),usedCalls:num(packet.usedCalls)}:undefined,
  schema:schema?{schemaVersion:num(schema.schemaVersion),origin:str(schema.origin),run:{policy:str(schema.run?.policy),maxWords:num(schema.run?.maxWords)},steps:(schema.steps||[]).map(s=>({ref:str(s.ref),kind:str(s.kind),order:str(s.order),input:str(s.input),models:(s.models||[]).map(m=>({name:str(m.name,80),enabled:m.enabled!==false,role:str(m.role,80),maxWords:num(m.maxWords),customRequest:typeof m.request==='string'}))}))}:undefined,
  context:context?{originalChars:num(context.originalChars),maxChars:num(context.maxChars),included:(context.included||[]).map(x=>({cycleId:num(x.cycleId),runId:str(x.runId),step:num(x.step),model:str(x.model,80),originalChars:num(x.originalChars),includedChars:num(x.includedChars),truncated:x.truncated===true})),omittedOlderCycles:num(context.omittedOlderCycles)}:undefined,
  backup:backup?{key:str(backup.key),sha256:str(backup.sha256,64),verified:typeof backup.verified==='boolean'?backup.verified:undefined,packetCommitId:str(backup.packetCommitId),revision:num(backup.revision),blocked:typeof backup.blocked==='boolean'?backup.blocked:undefined,lastVerifiedAt:num(backup.lastVerifiedAt),lastBackupId:str(backup.lastBackupId),verifiedCommitId:str(backup.verifiedCommitId),pendingCommitIds:Array.isArray(backup.pendingCommitIds)?backup.pendingCommitIds.map(x=>str(x)):undefined}:undefined,
  validationErrors:Array.isArray(d.errors)?d.errors.map(x=>({path:str(x.path),message:str(x.message,1000)})):undefined,
  step:num(event.meta?.step??d.step),reservedCalls:num(event.reservedCalls??report.reservedCalls),
  promptSizes:event.prompts?Object.entries(event.prompts).map(([model,prompt])=>({model:str(model,80),chars:typeof prompt==='string'?prompt.length:undefined})):undefined,
  stepResults:Array.isArray(report.steps)?report.steps.map(step=>({index:num(step.index),kind:str(step.kind),label:str(step.label),skipped:step.skipped===true,models:Object.entries(step.outcome||{}).map(([model,v])=>({model:str(model,80),accepted:v?.ok===true,reason:str(v?.reason),status:str(v?.status),attempt:num(v?.attempt),transportRequestId:str(v?.transportRequestId),answerChars:typeof v?.text==='string'?v.text.length:0}))})):undefined,
  researchId:str(d.researchId||event.researchId||state.researchId),
  cycleId:num(d.cycleId??event.cycleId??state.lastCommittedPacket),
  runId:str(d.runId||event.runId||state.activeRunId),
  batchId:str(event.batchId||d.batchId),
  phase:str(d.phase||state.phase,80),outcome:str(d.outcome,100),
  reason:str(d.reason||event.reason||decision.reason||report.stopReason,500),
  action:str(decision.action,80),models,
  maxCalls:num(budget.maxCalls??event.maxCalls),usedCalls:num(budget.usedCalls),
  maxCallsPerCycle:num(d.maxCallsPerCycle),maxPromptChars:num(d.maxPromptChars??event.maxPromptChars),
  contextChars:num(d.contextChars),durationMs:num(d.durationMs),
  stateVersion:num(state.stateVersion),backupRequiredCycle:num(state.backupRequiredCycleId),
  reportStatus:str(report.status,100),stepCount:Array.isArray(report.steps)?report.steps.length:undefined,
  unresolvedBatchIds:Array.isArray(report.unresolvedBatchIds||event.unresolvedBatchIds)?(report.unresolvedBatchIds||event.unresolvedBatchIds).map(x=>str(x)):undefined,
  missingModels:Array.isArray(event.missing)?event.missing.map(x=>str(x,80)):undefined,
  responses:Object.keys(response).length?Object.entries(response).map(([model,row])=>({
   model:str(model,80),status:str(row?.status,100),answered:row?.answered===true,
   completion:str(row?.completion,100),attribution:str(row?.attribution,100),
   transportRequestId:str(row?.transportRequestId),answerChars:typeof row?.text==='string'?row.text.length:0
  })):undefined,
  error:errorInfo(d.error||((event.type==='RUN_ERROR')?{code:event.code,message:event.message,stack:event.stack}:null))
 };
 return clone(result);
}
function createRepository({indexedDB=root.indexedDB}={}){
 let opening;
 function open(){
  if(!indexedDB?.open)throw Error('THECYCLE_TELEMETRY_IDB_UNAVAILABLE');
  if(!opening)opening=new Promise((resolve,reject)=>{
   const req=indexedDB.open(DB,1);
   req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:'seq',autoIncrement:true});};
   req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>{db.close();opening=null;};resolve(db);};
   req.onerror=()=>reject(req.error||Error('THECYCLE_TELEMETRY_OPEN_FAILED'));
   req.onblocked=()=>reject(Error('THECYCLE_TELEMETRY_OPEN_BLOCKED'));
  }).catch(e=>{opening=null;throw e;});
  return opening;
 }
 async function operation(mode,fn){
  const db=await open();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,mode);
   let value;tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(tx.error||Error('THECYCLE_TELEMETRY_TRANSACTION_ABORTED'));
   try{const req=fn(tx.objectStore(STORE));req.onsuccess=()=>{value=req.result;};req.onerror=()=>{try{tx.abort();}catch(_){}reject(req.error||Error('THECYCLE_TELEMETRY_REQUEST_FAILED'));};}
   catch(e){try{tx.abort();}catch(_){}reject(e);}
  });
 }
 return Object.freeze({append:row=>operation('readwrite',s=>s.add(row)),list:()=>operation('readonly',s=>s.getAll()),clear:()=>operation('readwrite',s=>s.clear())});
}
function createTelemetry({repository,clock=()=>Date.now(),notify=()=>{},version=()=>root.chrome?.runtime?.getManifest?.()?.version||'unknown'}={}){
 if(!repository||!['append','list','clear'].every(k=>typeof repository[k]==='function'))throw Error('THECYCLE_TELEMETRY_DEPENDENCIES');
 const changed=()=>{try{notify();}catch(_){}};
 return Object.freeze({
  async append(type,data={}){const row={at:new Date(clock()).toISOString(),type:str(type,100),version:version(),...project(type,data)};await repository.append(row);changed();return row;},
  async list(){return (await repository.list()).slice().sort((a,b)=>a.seq-b.seq);},
  async clear(){await repository.clear();changed();}
 });
}
function markdown(rows,{exportedAt=new Date().toISOString()}={}){
 // JSON lines are fenced using a delimiter longer than any backtick run in data.
 const json=rows.map(row=>JSON.stringify(row)).join('\n');
 let fenceSize=3;for(const m of json.matchAll(/\x60+/g))fenceSize=Math.max(fenceSize,m[0].length+1);
 const fence='\x60'.repeat(fenceSize);
 const counts={};for(const row of rows)counts[row.type]=(counts[row.type]||0)+1;
 return '# TheCycle diagnostics\n\nExported: '+exportedAt+'\n\nEvents: '+rows.length+'\n\n## Event counts\n\n'+Object.entries(counts).map(([k,v])=>'- '+k+': '+v).join('\n')+'\n\n## Chronological events\n\n'+fence+'jsonl\n'+json+'\n'+fence+'\n';
}
let instance;
function get(){return instance||(instance=createTelemetry({repository:createRepository(),notify:()=>root.document?.dispatchEvent(new root.Event('thecycle:telemetry-change'))}));}
const api=Object.freeze({createRepository,createTelemetry,project,markdown,append:(...args)=>get().append(...args),list:()=>get().list(),clear:()=>get().clear()});
root.TheCycleTelemetry=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
