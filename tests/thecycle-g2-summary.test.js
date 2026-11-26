const test = require('node:test');
const assert = require('node:assert/strict');
const {buildTask,parseContextTask,validateSummarySchema} = require('../disput/thecycle/circle-context.js');
const researchId='r1';
function fixture({badFinal=false,large=false,partial=false,ambiguous=false}={}) {
 const reads=[];
 const store={
  async getPacket(r,id){reads.push(id);return {researchId:r,cycleId:id,runId:'run-'+id,status:'RECORDED_RESULT',resultEventId:'result-'+id};},
  async getEvents(r,run){const id=Number(run.split('-').at(-1));return [{eventId:'result-'+id,payload:{report:{status:partial?'PARTIAL':'PIPELINE_COMPLETE',unresolvedBatchIds:[],steps:[
   {outcome:{GPT:{ok:true,text:'RAW-'+id},DeepSeek:{ok:true,text:'RAW-DS-'+id}}},
   {outcome:{S:{ok:!badFinal,text:large?'x'.repeat(5000):'SUMMARY-'+id},...(ambiguous?{S2:{ok:true,text:'OTHER'}}:{})}}
  ]}}}];}
 };
 return {store,reads,state:{researchId,task:'Solve task',nextCycle:4,lastCommittedPacket:3}};
}
test('default mode preserves existing full history handoff',async()=>{
 const f=fixture(); const out=await buildTask(f);assert.match(out,/RAW-3/);assert.match(out,/SUMMARY-1/);assert.deepEqual(f.reads,[3,2,1]);
});
test('latest-summary loads only latest committed cycle and final step',async()=>{
 const f=fixture();let metadata;const out=await buildTask({...f,mode:'latest-summary',onContext:v=>metadata=v});
 assert.match(out,/Solve task/);assert.match(out,/SUMMARY-3/);assert.match(out,/cycle=3 run=run-3 step=2 model=S/);
 assert.doesNotMatch(out,/RAW-|SUMMARY-1|SUMMARY-2/);assert.deepEqual(f.reads,[3]);assert.equal(metadata.included.length,1);assert.equal(metadata.omittedOlderCycles,2);assert.equal(metadata.included[0].truncated,false);
});
test('first cycle passes original task without reading old packets',async()=>{
 const f=fixture();assert.equal(await buildTask({...f,state:{...f.state,nextCycle:1,lastCommittedPacket:null},mode:'latest-summary'}),'Solve task');assert.deepEqual(f.reads,[]);
});
test('summary overflow pauses through an error, never truncates or falls back',async()=>{
 await assert.rejects(buildTask({...fixture({large:true}),mode:'latest-summary',maxChars:2000}),/CIRCLE_SUMMARY_CONTEXT_LIMIT/);
});
test('missing or ambiguous final summary is rejected',async()=>{
 for(const options of [{badFinal:true},{ambiguous:true}])await assert.rejects(buildTask({...fixture(options),mode:'latest-summary'}),/CIRCLE_SUMMARY_MISSING_OR_AMBIGUOUS/);
});
test('partial pipeline or missing committed cycle is rejected',async()=>{
 await assert.rejects(buildTask({...fixture({partial:true}),mode:'latest-summary'}),/CIRCLE_RESULT_NOT_SETTLED/);
 const f=fixture();await assert.rejects(buildTask({...f,state:{...f.state,lastCommittedPacket:2},mode:'latest-summary'}),/CIRCLE_CONTEXT_GAP/);
});
test('explicit opt-in is stripped from actual task, default remains unchanged',()=>{
 assert.deepEqual(parseContextTask('Solve task'),{task:'Solve task',mode:'all-evidence'});
 assert.deepEqual(parseContextTask('[CIRCLE_CONTEXT: latest-summary]\nSolve task'),{task:'Solve task',mode:'latest-summary'});
 assert.throws(()=>parseContextTask('[CIRCLE_CONTEXT: invalid]\nSolve task'),/CIRCLE_CONTEXT_MODE_INVALID/);
 assert.throws(()=>parseContextTask('[CIRCLE_CONTEXT: latest-summary]\nSolve task','all-evidence'),/CIRCLE_CONTEXT_MODE_CONFLICT/);
});
test('summary mode demands two rounds and one final enabled summarizer with previous input',()=>{
 const round={kind:'round',models:[{name:'GPT'}]};const summary={kind:'round',input:'previous',models:[{name:'S'},{name:'D',enabled:false}]};
 assert.doesNotThrow(()=>validateSummarySchema({steps:[round,summary]}));
 for(const steps of [[round],[round,{...summary,input:'none'}],[round,{...summary,models:[{name:'S'},{name:'D'}]}],[round,{kind:'owner'}]])assert.throws(()=>validateSummarySchema({steps}),/CIRCLE_SUMMARY_SCHEMA_INVALID/);
});

test('runtime wires mode through five simulated cycles, persists it, and keeps raw reports',async()=>{
 const {createCircleRunner}=require('../disput/thecycle/circle-runtime.js');
 const contextApi=require('../disput/thecycle/circle-context.js');
 const config={},packets=new Map(),events=new Map(),tasks=[];
 let state;
 const store={
  async createResearch({researchId,task}){state={researchId,task,phase:'READY',nextCycle:1,lastCommittedPacket:null};},
  async load(){return {...state};},
  async getPacket(_,cycle){return packets.get(cycle);},
  async getEvents(_,run){return events.get(run)||[];}
 };
 const bridge={capture:()=>({models:['GPT','S'],schema:{steps:[{kind:'round',models:[{name:'GPT'}]},{kind:'round',input:'previous',models:[{name:'S'}]}]}}),send(){throw Error('Unexpected actual send');},begin(){},end(){},accept(){},roleText(){}};
 const controllerApi={createController({resolveTask}){return {async tick(){
  if(state.phase==='READY'){
   const n=state.nextCycle;tasks.push(await resolveTask({state:{...state},store}));
   const runId='run-'+n, resultEventId='result-'+n;
   packets.set(n,{researchId:state.researchId,cycleId:n,runId,status:'RECORDED_RESULT',resultEventId});
   events.set(runId,[{eventId:resultEventId,payload:{report:{status:'PIPELINE_COMPLETE',unresolvedBatchIds:[],steps:[{outcome:{GPT:{ok:true,text:'RAW-'+n}}},{outcome:{S:{ok:true,text:'SUMMARY-'+n}}}]}}}]);
   state.phase='COMMIT';return {outcome:'RUN_RETURNED',state:{...state}};
  }
  if(state.phase==='COMMIT'){state.lastCommittedPacket=state.nextCycle;state.phase='EVALUATE';return {outcome:'PACKET_COMMITTED',state:{...state}};}
  const action=state.nextCycle===5?'PAUSE':'CONTINUE';state.nextCycle++;state.phase=action==='PAUSE'?'PAUSED':'READY';return {outcome:'DECISION',state:{...state},decision:{action}};
 },async releaseSettled(){}};}};
 const runner=createCircleRunner({bridge,contextApi,controllerApi,uuid:()=> 'fixture',
  storage:{async get(k){return {[k]:config[k]};},async set(v){Object.assign(config,v);}},
  activeStore:{async createActiveStateStore(){return {store,database:'fixture-db',close(){}};}},
  adapterApi:{createBasicAdapter(){return {validate(){return {ok:true};}};}},
  createBackup:async()=>({gate:{async persist(){},async assertCanStartCycle(){}}})
 });
 const result=await runner.start({task:'[CIRCLE_CONTEXT: latest-summary]\nSolve task',maxCalls:10});
 assert.equal(tasks.length,5);assert.equal(tasks[0],'Solve task');
 for(let i=1;i<5;i++){assert.match(tasks[i],new RegExp('SUMMARY-'+i));assert.doesNotMatch(tasks[i],/RAW-/);assert.equal((tasks[i].match(/SUMMARY-\d/g)||[]).length,1);}
 assert.equal(result.configured.contextMode,'latest-summary');assert.equal(result.state.task,'Solve task');assert.equal(packets.size,5);
 for(let i=1;i<=5;i++)assert.equal(events.get('run-'+i)[0].payload.report.steps[0].outcome.GPT.text,'RAW-'+i);
});
test('all-evidence mode in runtime still reports non-empty included history from cycle 2',async()=>{
 const {createCircleRunner}=require('../disput/thecycle/circle-runtime.js');
 const contextApi=require('../disput/thecycle/circle-context.js');
 const packets=new Map(),events=new Map(),tasks=[],contexts=[],config={};
 let state;
 const store={
  async createResearch({researchId,task}){state={researchId,task,phase:'READY',nextCycle:1,lastCommittedPacket:null};},
  async load(){return {...state};},
  async getPacket(_,c){return packets.get(c);},
  async getEvents(_,run){return events.get(run)||[];}
 };
 const bridge={capture:()=>({models:['GPT'],schema:{steps:[{kind:'round',models:[{name:'GPT'}]}]}}),send(){},begin(){},end(){},accept(){},roleText(){}};
 const wrapped={...contextApi,buildTask:o=>contextApi.buildTask({...o,onContext:v=>{contexts.push(v);o.onContext(v);}})};
 const controllerApi={createController({resolveTask}){return {async tick(){
  if(state.phase==='READY'){
   const n=state.nextCycle;tasks.push(await resolveTask({state:{...state},store}));
   packets.set(n,{researchId:state.researchId,cycleId:n,runId:'run-'+n,status:'RECORDED_RESULT',resultEventId:'result-'+n});
   events.set('run-'+n,[{eventId:'result-'+n,payload:{report:{status:'PIPELINE_COMPLETE',unresolvedBatchIds:[],steps:[{outcome:{GPT:{ok:true,text:'RAW-'+n}}}]}}}]);
   state.phase='COMMIT';return {outcome:'RUN_RETURNED',state:{...state}};
  }
  if(state.phase==='COMMIT'){state.lastCommittedPacket=state.nextCycle;state.phase='EVALUATE';return {outcome:'PACKET_COMMITTED',state:{...state}};}
  const pause=state.nextCycle===3;state.nextCycle++;state.phase=pause?'PAUSED':'READY';return {outcome:'DECISION',state:{...state},decision:{action:pause?'PAUSE':'CONTINUE'}};
 },async releaseSettled(){}};}};
 const runner=createCircleRunner({bridge,contextApi:wrapped,controllerApi,uuid:()=>'f',
  storage:{async get(k){return {[k]:config[k]};},async set(v){Object.assign(config,v);}},
  activeStore:{async createActiveStateStore(){return {store,database:'d',close(){}};}},
  adapterApi:{createBasicAdapter(){return {validate(){return {ok:true};}};}},
  createBackup:async()=>({gate:{async persist(){},async assertCanStartCycle(){}}})});
 const result=await runner.start({task:'Solve task',maxCalls:10});
 assert.equal(tasks.length,3);assert.equal(result.configured.contextMode,'all-evidence');
 assert.equal(contexts[1].included.length,1);assert.equal(contexts[2].included.length,2);assert.equal(contexts[2].mode,undefined);
 assert.match(tasks[2],/RAW-1/);assert.match(tasks[2],/RAW-2/);assert.doesNotMatch(tasks[2],/CIRCLE_CONTEXT/);
});
