'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
require('../disput/custom-engine.js');
require('../disput/basic-schema.js');
const {createBasicAdapter}=require('../disput/thecycle/basic-adapter.js');
const {createController}=require('../disput/thecycle/controller.js');
const context=require('../disput/thecycle/circle-context.js');
const {createCircleRunner}=require('../disput/thecycle/circle-runtime.js');
const {createBackupGate}=require('../disput/thecycle/backup-gate.js');
const clone=v=>JSON.parse(JSON.stringify(v));
function fixture({unknownAt=0,failBackupAt=0,stopAt=0}={}){
 let state,owner=null,bridgeRun=null,seq=0,backupCalls=0;
 const events=new Map(),packets=new Map(),values=new Map(),prompts=[],order=[],metadata=new Map();
 const storage={async get(k){return {[k]:values.get(k)};},async set(o){for(const [k,v] of Object.entries(o))values.set(k,clone(v));}};
 const store={
  async createResearch({researchId,task,pipelineRef,maxCalls}){state={researchId,task,pipelineRef,stateVersion:0,phase:'READY',nextCycle:1,activeRunId:null,lastCommittedPacket:null,backupRequiredCycleId:null,stopRequested:false,budget:{maxCalls,usedCalls:0}};},
  async load(){return clone(state);},
  async acquire({researchId,ownerId}){owner={researchId,ownerId,epoch:1};return clone(owner);},
  async getOwnership(){return clone(owner);},
  async release(){owner=null;},
  async prepareRun(token,{runId}){state.activeRunId=runId;state.phase='INTENT';state.stateVersion++;events.set(runId,[]);},
  journalFor(){return async event=>{
   const rows=events.get(event.runId);rows.push({eventId:event.type,payload:clone(event)});
   if(event.type==='RUN_INTENT')state.phase='RUNNING';
   if(event.type==='DISPATCH_INTENT')state.budget.usedCalls+=event.models.length;
   if(event.type==='DISPATCH_UNKNOWN')state.phase='RECONCILE';
   if(event.type==='RUN_RESULT'&&state.phase!=='RECONCILE')state.phase='COMMIT';
   state.stateVersion++;
  };},
  async getRun(){return {runId:state.activeRunId};},
  async getEvents(id,runId){return clone(events.get(runId)||[]);},
  async getPacket(id,cycle){return clone(packets.get(cycle)||null);},
  async commitPacket(token,{runId}){
   const cycleId=state.nextCycle;
   const packet={researchId:state.researchId,cycleId,runId,resultEventId:'RUN_RESULT',status:'RECORDED_RESULT',usedCalls:1};
   packets.set(cycleId,packet);state.lastCommittedPacket=cycleId;state.backupRequiredCycleId=cycleId;state.nextCycle++;
   state.activeRunId=null;state.phase=state.stopRequested?'PAUSED':'EVALUATE';state.stateVersion++;order.push('commit:'+cycleId);
   return {state:clone(state),packet:clone(packet)};
  },
  async acknowledgePacketBackup(token,{cycleId}){assert.equal(cycleId,state.backupRequiredCycleId);state.backupRequiredCycleId=null;state.stateVersion++;return clone(state);},
  async decide(token,{action,reason}){if(state.phase==='EVALUATE')packets.get(state.lastCommittedPacket).decision={action,reason};state.phase=action==='CONTINUE'?'READY':'PAUSED';state.stateVersion++;return clone(state);},
  async requestStop(){state.stopRequested=true;if(!state.activeRunId)state.phase='PAUSED';state.stateVersion++;return clone(state);}
 };
 const bridge={
  capture:()=>({models:['GPT'],errors:[],schema:{schemaVersion:1,origin:'user',run:{policy:'manual'},steps:[{ref:'r1',kind:'round',models:[{name:'GPT'}]}]}}),
  accept:()=>({ok:true}),roleText:()=>'',begin({runId}){assert.equal(bridgeRun,null);bridgeRun=runId;},end({runId}){assert.equal(bridgeRun,runId);bridgeRun=null;},
  async send(models,byModel,meta){assert.equal(meta.runId,bridgeRun);prompts.push(byModel.GPT);order.push('send:'+prompts.length);
   if(stopAt===prompts.length)await runner.stop();
   if(unknownAt===prompts.length)return {byModel:{}};
   return {byModel:{GPT:{text:'Evidence unique '+prompts.length,status:'SUCCESS',answered:true}}};
  }
 };
 const gate=createBackupGate({clock:()=>1000+backupCalls,metadata:{
  async get(id){return metadata.get(id)||null;},async put(id,revision,value){if((metadata.get(id)?.revision||0)!==revision)return false;metadata.set(id,clone(value));return true;}
 },backup:{async save(key,{researchId,requiredCommitId}){
  backupCalls++;order.push('backup:'+backupCalls);
  if(failBackupAt===backupCalls)throw Error('DISK_FAILURE');
  if(requiredCommitId)assert.equal(requiredCommitId,researchId+':cycle:'+state.lastCommittedPacket);
  return {key,verified:true,packetCommitId:requiredCommitId};
 }}});
 const runner=createCircleRunner({bridge,storage,activeStore:{async createActiveStateStore(){return {store,database:'test',close(){}};}},
  controllerApi:{createController},adapterApi:{createBasicAdapter},contextApi:context,
  createBackup:async()=>({gate,close(){}}),uuid:()=>String(++seq)});
 return {runner,prompts,packets,order,state:()=>state};
}
test('Circle: three actual Basic executions, previous evidence, global call budget, verified gate ordering',async()=>{
 const x=fixture();const r=await x.runner.start({task:'Investigate an open problem',maxCalls:3});
 assert.equal(x.prompts.length,3);assert.match(x.prompts[1],/Evidence unique 1/);assert.match(x.prompts[2],/Evidence unique 2/);assert.match(x.prompts[2],/Evidence unique 1/);
 assert.equal(r.state.phase,'PAUSED');assert.equal(r.state.budget.usedCalls,3);assert.equal(r.state.backupRequiredCycleId,null);
 assert.equal(x.packets.get(1).decision.action,'CONTINUE');assert.equal(x.packets.get(3).decision.reason,'BUDGET_EXHAUSTED');
 assert.ok(x.order.indexOf('commit:1')<x.order.indexOf('backup:2'));assert.ok(x.order.indexOf('backup:2')<x.order.indexOf('send:2'));
 assert.equal((await x.runner.snapshot(r.researchId)).report.status,'PIPELINE_COMPLETE');
});
test('Circle: post-commit backup failure blocks next dispatch',async()=>{
 const x=fixture({failBackupAt:2});const r=await x.runner.start({task:'Investigate',maxCalls:3});
 assert.equal(x.prompts.length,1);assert.equal(r.state.backupRequiredCycleId,1);assert.equal(r.outcomes.at(-1).outcome,'BACKUP_REQUIRED');
});
test('Circle: unknown delivery never replays or starts next cycle',async()=>{
 const x=fixture({unknownAt:1});const r=await x.runner.start({task:'Investigate',maxCalls:3});
 assert.equal(x.prompts.length,1);assert.equal(r.state.phase,'RECONCILE');assert.equal(r.outcomes.at(-1).outcome,'RECOVERY_REQUIRED');
});
test('Circle: missing initial backup never dispatches',async()=>{
 const x=fixture({failBackupAt:1});await assert.rejects(x.runner.start({task:'Investigate',maxCalls:3}),/DISK_FAILURE/);assert.equal(x.prompts.length,0);
});
test('Circle: Stop during transport prevents subsequent dispatch',async()=>{
 const x=fixture({stopAt:1});const r=await x.runner.start({task:'Investigate',maxCalls:3});
 assert.equal(x.prompts.length,1);assert.ok(['PAUSED','RECONCILE','COMMIT'].includes(r.state.phase));assert.equal(r.state.stopRequested,true);
});
test('Circle: missing prior packet fails closed; bounded context',async()=>{
 const state={researchId:'r',task:'Original',nextCycle:2,lastCommittedPacket:1};
 await assert.rejects(context.buildTask({state,store:{async getPacket(){return null;}}}),/CIRCLE_COMMITTED_PACKET_MISSING/);
 const store={async getPacket(){return {researchId:'r',cycleId:1,runId:'r:1',status:'RECORDED_RESULT',resultEventId:'result'};},async getEvents(){return [{eventId:'result',payload:{report:{status:'PIPELINE_COMPLETE',steps:[{outcome:{GPT:{ok:true,text:'x'.repeat(5000)}}}]}}}];}};
 const task=await context.buildTask({state,store,maxChars:1024});assert.ok(task.length<=1024);assert.match(task,/TRUNCATED/);
});
