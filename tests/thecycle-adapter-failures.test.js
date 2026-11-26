'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
require('../disput/custom-engine.js');
require('../disput/basic-schema.js');
const {createBasicAdapter}=require('../disput/thecycle/basic-adapter.js');
const schema={schemaVersion:1,origin:'user',run:{policy:'auto'},
 steps:[{ref:'r1',kind:'round',models:[{name:'GPT'},{name:'Claude'}]}]};
const run=(send)=>{
 const journal=[];
 const adapter=createBasicAdapter({
  availableModels:['GPT','Claude'],isRole:()=>true,roleText:()=>'',accept:()=>({ok:true}),
  journal:async e=>journal.push(e),send
 });
 const exec=()=>adapter.execute({researchId:'r',runId:'r:cycle:1',cycleId:1,schema,task:'Task',maxCalls:4,maxPromptChars:20000});
 return {adapter,journal,exec};
};
test('an error raised before the transport is NOT_SENT, not DISPATCH_UNKNOWN',async()=>{
 const x=run(async()=>{throw Object.assign(new Error('STALE'),{notSent:true});});
 const report=await x.exec();
 assert.equal(report.stopReason,'NOT_SENT');
 assert.deepEqual(report.unresolvedBatchIds,[]);
 assert.equal(report.reservedCalls,0);
 const types=x.journal.map(e=>e.type);
 assert.ok(types.includes('NOT_SENT'));
 assert.ok(!types.includes('DISPATCH_UNKNOWN'));
});
test('an error from the transport itself stays DISPATCH_UNKNOWN',async()=>{
 const x=run(async()=>{throw new Error('socket closed');});
 const report=await x.exec();
 assert.equal(report.status,'UNKNOWN');
 const types=x.journal.map(e=>e.type);
 assert.ok(types.includes('DISPATCH_UNKNOWN'));
 assert.ok(!types.includes('NOT_SENT'));
});
test('a delivered failure of one model is "no answer" of that model, not UNKNOWN of the batch',async()=>{
 const x=run(async()=>({byModel:{
  GPT:{text:'Answer',status:'SUCCESS',answered:true,attribution:'verified'},
  Claude:{text:'',status:'ERROR',answered:false}
 }}));
 const report=await x.exec();
 assert.notEqual(report.status,'UNKNOWN');
 assert.deepEqual(report.unresolvedBatchIds,[]);
 const types=x.journal.map(e=>e.type);
 assert.ok(types.includes('DISPATCH_RESPONSE'));
 assert.ok(!types.includes('DISPATCH_UNKNOWN'));
 assert.equal(report.steps[0].outcome.GPT.ok,true);
 assert.equal(report.steps[0].outcome.Claude.ok,false);
 assert.equal(report.status,'PARTIAL');
});
test('an absent or UNCERTAIN item leaves the batch UNKNOWN',async()=>{
 const x=run(async()=>({byModel:{GPT:{text:'Answer',status:'SUCCESS'},Claude:{text:'',status:'UNCERTAIN'}}}));
 const report=await x.exec();
 assert.equal(report.status,'UNKNOWN');
 assert.ok(x.journal.map(e=>e.type).includes('DISPATCH_UNKNOWN'));
});
test('validate rejects owner steps and drops only defaults.roundTask on input:none',()=>{
 const {adapter}=run(async()=>({}));
 const owner=adapter.validate({schemaVersion:1,origin:'user',run:{policy:'auto'},steps:[
  {ref:'r1',kind:'round',models:[{name:'GPT'}]},{ref:'o1',kind:'owner'}]});
 assert.equal(owner.ok,false);
 assert.match(JSON.stringify(owner.errors),/owner/);
 const written=adapter.validate({schemaVersion:1,origin:'user',run:{policy:'auto'},
  steps:[{ref:'r1',kind:'round',task:'Own task',models:[{name:'GPT',task:'x'}]}]});
 assert.equal(written.ok,true);
 const dropped=adapter.validate({schemaVersion:1,origin:'user',run:{policy:'auto'},defaults:{roundTask:'Default'},
  steps:[{ref:'r1',kind:'round',models:[{name:'GPT'}]}]});
 assert.equal(dropped.ok,false);
});
test('page bridge: Stop aborts in-flight requests and the run controls show Stop',()=>{
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','results.js'),'utf8');
 assert.match(source,/theCycleBridgeAbort = new AbortController\(\)/);
 assert.match(source,/signal: batchSignal/);
 assert.match(source,/if \(theCycleBridgeRunId \|\| theCycleHeld\) \{[\s\S]{0,200}theCycleBridgeAbort\?\.abort\(\)/);
 assert.match(source,/if \(circlePageRunner \|\| theCycleBridgeRunId \|\| theCycleHeld\) return \{ action: 'stop'/);
});

// ---- port items: lock release, budget for the whole cycle, hold between cycles ----
const {createController}=require('../disput/thecycle/controller.js');
function lockStore(over={}){
 const st={researchId:'r',task:'T',pipelineRef:'p',stateVersion:1,phase:'READY',nextCycle:1,activeRunId:null,
  lastCommittedPacket:null,backupRequiredCycleId:null,stopRequested:false,budget:{maxCalls:4,usedCalls:0},...over};
 let lock=null;const calls=[];
 const store={
  async load(){return JSON.parse(JSON.stringify(st));},
  async acquire({researchId,ownerId}){lock={researchId,ownerId,epoch:1};return {...lock};},
  async release(t){if(st.activeRunId)throw Error('RUN_UNSETTLED');lock=null;calls.push('release');return true;},
  async getOwnership(){return lock&&{...lock};},
  async prepareRun(){calls.push('prepareRun');},
  journalFor(){return async()=>{};},
  async decide(t,{action,reason}){calls.push('decide:'+action+':'+(reason||''));st.phase=action==='PAUSE'?'PAUSED':'READY';st.stateVersion++;return JSON.parse(JSON.stringify(st));},
  async getRun(){},async getEvents(){return [];},async getPacket(){return null;},async commitPacket(){},
  async requestStop(){},async getOwnership2(){}
 };
 return {store,st,calls,lock:()=>lock};
}
test('budget: a cycle that the remaining budget cannot cover pauses before any request',async()=>{
 const x=lockStore({budget:{maxCalls:4,usedCalls:2}});// remaining 2, schema needs 3
 let executed=0;
 const adapter={validate:()=>({ok:true}),estimateCalls:()=>3,execute:async()=>{executed++;},cancel(){}};
 const c=createController({store:x.store,makeAdapter:()=>adapter,maxCallsPerCycle:10,maxPromptChars:1000,
  loadPipeline:async ref=>({ref,schema:{}}),ownerId:'o1'});
 const r=await c.tick('r');
 assert.equal(r.outcome,'PAUSED');assert.equal(r.reason,'BUDGET_INSUFFICIENT_FOR_CYCLE');
 assert.equal(executed,0);assert.ok(!x.calls.includes('prepareRun'));
 assert.ok(x.calls.includes('decide:PAUSE:BUDGET_INSUFFICIENT_FOR_CYCLE'));
});
test('budget: the adapter estimate is the sum of enabled participants across rounds',()=>{
 const {adapter}=run(async()=>({}));
 assert.equal(adapter.estimateCalls({steps:[
  {ref:'a',kind:'round',models:[{name:'GPT'},{name:'Claude',enabled:false}]},
  {ref:'b',kind:'round',models:[{name:'GPT'},{name:'Claude'}]}]}),3);
});
test('lock: a settled research releases transport ownership; a run needing recovery or a pending backup does not',async()=>{
 const x=lockStore({phase:'RECONCILE',activeRunId:'r:cycle:1'});
 const c=createController({store:x.store,makeAdapter:()=>({}),maxCallsPerCycle:1,maxPromptChars:1000,loadPipeline:async()=>null,ownerId:'o1'});
 assert.equal((await c.tick('r')).outcome,'RECOVERY_REQUIRED');
 assert.notEqual(x.lock(),null);
 assert.equal(await c.releaseSettled('r'),false);// unsettled run stays held
 assert.notEqual(x.lock(),null);
 x.st.activeRunId=null;x.st.phase='PAUSED';x.st.backupRequiredCycleId=1;
 assert.equal(await c.releaseSettled('r'),false);// pending backup stays held
 x.st.backupRequiredCycleId=null;
 assert.equal(await c.releaseSettled('r'),true);
 assert.equal(x.lock(),null);
});
test('lock: Circle runner frees ownership after finish and releases the page hold',async()=>{
 const {createCircleRunner}=require('../disput/thecycle/circle-runtime.js');
 const log=[];const values=new Map();
 const storage={async get(k){return {[k]:values.get(k)};},async set(o){for(const [k,v] of Object.entries(o))values.set(k,v);}};
 const controller={ownerId:'c',async tick(){return {outcome:'PAUSED',state:{phase:'PAUSED'}};},async stop(){},async releaseSettled(id){log.push('releaseSettled:'+id);return true;}};
 const store={async createResearch(){},async load(){return {phase:'PAUSED',backupRequiredCycleId:null,lastCommittedPacket:null};},async getPacket(){return null;},async getEvents(){return [];},async getOwnership(){return null;}};
 const bridge={capture:()=>({models:['GPT'],errors:[],schema:{schemaVersion:1,origin:'user',steps:[{ref:'r1',kind:'round',models:[{name:'GPT'}]}]}}),
  begin(){},end(){},accept:()=>({ok:true}),roleText:()=>'',send:async()=>({}),
  hold(o){log.push('hold:'+typeof o.stop);},release(){log.push('release');}};
 const runner=createCircleRunner({bridge,storage,activeStore:{async createActiveStateStore(){return {store,database:'d',close(){}};}},
  controllerApi:{createController:()=>controller},adapterApi:{createBasicAdapter:()=>({validate:()=>({ok:true})})},
  contextApi:{...require('../disput/thecycle/circle-context.js'),buildTask:async()=>'t'},createBackup:async()=>({gate:{persist:async()=>({}),assertCanStartCycle:async()=>{},requireCommit:async()=>{}},close(){}}),uuid:()=>'1'});
 await runner.start({task:'Task',maxCalls:2});
 assert.equal(log[0],'hold:function');
 assert.ok(log.some(x=>x.startsWith('releaseSettled:')));
 assert.equal(log.at(-1),'release');
 assert.equal(runner.isRunning(),false);
});
test('hold: the page holds Basic and a second run between cycles (bridge hold/release wired)',()=>{
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','results.js'),'utf8');
 assert.match(source,/hold\(\{ stop = null \} = \{\}\)/);
 assert.match(source,/if \(pipelineRunActive \|\| circlePageRunner \|\| theCycleHeld\) \{\s+showNotification\('Pipeline already running'/);
 assert.match(source,/circlePageRunner \|\| theCycleBridgeRunId \|\| theCycleHeld\) return \{ action: 'stop'/);
});
