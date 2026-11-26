'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createG1Runner}=require('../disput/thecycle/g1-runtime.js');
const realController=require('../disput/thecycle/controller.js');
const realAdapter=require('../disput/thecycle/basic-adapter.js');
const realSchema=require('../disput/basic-schema.js');
const realEngine=require('../disput/custom-engine.js');

const clone=v=>JSON.parse(JSON.stringify(v));
function harness({valid=true}={}){
 const data=new Map(),storage={
  async get(k){const out={};for(const key of (Array.isArray(k)?k:[k]))if(data.has(key))out[key]=data.get(key);return out;},
  async set(rows){for(const [k,v] of Object.entries(rows))data.set(k,clone(v));}
 };
 let state=null,packet=null,report=null,owner=null,sends=0,bridgeActive=null;
 const events=[],store={
  async createResearch({researchId,task,pipelineRef,maxCalls}){
   state={researchId,task,pipelineRef,stateVersion:0,phase:'READY',nextCycle:1,
    activeRunId:null,lastCommittedPacket:null,backupRequiredCycleId:null,
    stopRequested:false,budget:{maxCalls,usedCalls:0}};
   return clone(state);
  },
  async load(id){assert.equal(id,state.researchId);return clone(state);},
  async acquire({researchId,ownerId}){owner={researchId,ownerId,epoch:1};return clone(owner);},
  async getOwnership(){return clone(owner);},
  async release(){owner=null;return true;},
  async prepareRun(token,{runId}){
   state.activeRunId=runId;state.phase='INTENT';state.stateVersion++;return clone(state);
  },
  journalFor(){return async event=>{
   events.push({eventId:event.type,payload:clone(event)});
   if(event.type==='RUN_INTENT')state.phase='RUNNING';
   if(event.type==='DISPATCH_INTENT')state.budget.usedCalls+=event.models.length;
   if(event.type==='RUN_RESULT'){report=clone(event.report);state.phase='COMMIT';}
   state.stateVersion++;
  };},
  async commitPacket(token,{runId}){
   packet={researchId:state.researchId,cycleId:1,runId,resultEventId:'RUN_RESULT',
    status:'RECORDED_RESULT',usedCalls:state.budget.usedCalls};
   state.phase='EVALUATE';state.lastCommittedPacket=1;state.backupRequiredCycleId=1;
   state.nextCycle=2;state.activeRunId=null;state.stateVersion++;
   return {state:clone(state),packet:clone(packet)};
  },
  async getRun(){return {researchId:state.researchId,runId:state.researchId+':cycle:1',phase:state.phase};},
  async getPacket(){return packet?clone(packet):null;},
  async getEvents(){return clone(events);},
  async decide(token,{action}){
   state.phase=action==='PAUSE'?'PAUSED':action==='CONTINUE'?'READY':'COMPLETED';
   state.stateVersion++;return clone(state);
  },
  async requestStop(id){state.stopRequested=true;if(!state.activeRunId)state.phase='PAUSED';state.stateVersion++;return clone(state);}
 };
 const bridge={
  capture:()=>({models:['GPT'],policy:'manual',errors:[],
   schema:{schemaVersion:1,run:{policy:'manual'},steps:[{ref:'r1',kind:'round',models:[{name:'GPT'}]}]}}),
  roleText:()=>'',accept:()=>({ok:true}),
  begin({runId}){assert.equal(bridgeActive,null);bridgeActive=runId;},
  end({runId}){assert.equal(bridgeActive,runId);bridgeActive=null;},
  async send(models,prompts,meta){
   assert.equal(meta.runId,bridgeActive);sends++;
   return {byModel:{GPT:{text:'Answer from provider',status:'SUCCESS',answered:true}}};
  }
 };
 const adapterApi={
  createBasicAdapter({journal,send}){
   return {validate:schema=>({ok:valid&&schema.run?.policy==='auto',errors:valid&&schema.run?.policy==='auto'?[]:['invalid schema']}),
    async execute({researchId,runId,cycleId}){
     await journal({researchId,runId,cycleId,type:'RUN_INTENT'});
     await journal({researchId,runId,cycleId,type:'DISPATCH_INTENT',batchId:'b1',models:['GPT']});
     const response=await send(['GPT'],{GPT:'Question'},{researchId,runId,cycleId,batchId:'b1'});
     await journal({researchId,runId,cycleId,type:'DISPATCH_RESPONSE',batchId:'b1',response});
     const result={researchId,runId,cycleId,status:'PIPELINE_COMPLETE',
      unresolvedBatchIds:[],steps:[{outcome:{GPT:{ok:true,text:response.byModel.GPT.text}}}]};
     await journal({researchId,runId,cycleId,type:'RUN_RESULT',report:result});
     return result;
    },cancel:()=>true};
  }
 };
 const activeStore={async createActiveStateStore(){return {store,database:'auto-orchestr-thecycle',
  close(){}};}};
 const runner=createG1Runner({bridge,storage,activeStore,controllerApi:realController,adapterApi,uuid:()=>{
  return '00000000-0000-4000-8000-'+String(Date.now()).slice(-12);
 }});
 return {runner,sends:()=>sends,events,state:()=>state};
}
test('G1 dispatches once, commits result, evaluates and durably pauses',async()=>{
 const x=harness();
 const result=await x.runner.start({task:'Solve this',maxCalls:4,maxCallsPerCycle:4});
 assert.deepEqual(result.outcomes,['RUN_RETURNED','PACKET_COMMITTED','DECISION','G1_SINGLE_CYCLE_STOP']);
 assert.equal(x.sends(),1);
 assert.equal(result.state.phase,'PAUSED');
 assert.equal(result.state.lastCommittedPacket,1);
 assert.equal(result.report.status,'PIPELINE_COMPLETE');
 assert.equal(result.report.steps[0].outcome.GPT.text,'Answer from provider');
 assert.deepEqual(x.events.map(e=>e.eventId),
  ['RUN_INTENT','DISPATCH_INTENT','DISPATCH_RESPONSE','RUN_RESULT']);
 assert.equal(await x.runner.latest(),result.researchId);
 const restored=await x.runner.snapshot(result.researchId);
 assert.equal(restored.report.steps[0].outcome.GPT.text,'Answer from provider');
 assert.equal(restored.state.backupRequiredCycleId,1);
});
test('G1 rejects invalid Basic plan without dispatch',async()=>{
 const x=harness({valid:false});
 await assert.rejects(x.runner.start({task:'Solve this'}),/G1_ADAPTER_REJECTED_SCHEMA/);
 assert.equal(x.sends(),0);
});
test('production G1 entrypoint is wired to the existing results page',()=>{
 const html=fs.readFileSync(path.join(__dirname,'..','result_new.html'),'utf8');
 const page=fs.readFileSync(path.join(__dirname,'..','results.js'),'utf8');
 assert.match(html,/id="thecycle-g1-start"/);
 for(const script of ['basic-adapter.js','controller.js','g1-runtime.js','thecycle-g1-ui.js'])
  assert.ok(html.includes(script),script);
 assert.match(page,/window\.TheCycleMainPageBridge\s*=/);
 assert.match(page,/await runModelBatch\(\{/);
});

test('G1 Basic Adapter reaches the actual finite Basic Engine with one dispatch',async()=>{
 const journal=[];
 let dispatched=0;
 const instance=realAdapter.createBasicAdapter({
  schemaApi:realSchema,engine:realEngine,availableModels:['GPT'],
  isRole:()=>true,roleText:()=>'',accept:()=>({ok:true}),
  journal:async event=>journal.push(event),
  send:async(models,prompts,meta)=>{
   dispatched++;
   assert.deepEqual(models,['GPT']);
   assert.match(prompts.GPT,/Solve problem/);
   assert.equal(meta.runId,'research:cycle:1');
   return {byModel:{GPT:{text:'Answer from provider',status:'SUCCESS',answered:true}}};
  }
 });
 const schema={schemaVersion:1,origin:'user',run:{policy:'auto'},
  steps:[{ref:'r1',kind:'round',models:[{name:'GPT'}]}]};
 assert.deepEqual(instance.validate(schema),{ok:true,errors:[]});
 const result=await instance.execute({researchId:'research',runId:'research:cycle:1',
  cycleId:1,schema,task:'Solve problem',maxCalls:4,maxPromptChars:20000});
 assert.equal(result.status,'PIPELINE_COMPLETE');
 assert.equal(dispatched,1);
 assert.deepEqual(journal.map(e=>e.type),
  ['RUN_INTENT','DISPATCH_INTENT','DISPATCH_RESPONSE','RUN_RESULT']);
 assert.equal(result.answers[0],'Answer from provider');
});
