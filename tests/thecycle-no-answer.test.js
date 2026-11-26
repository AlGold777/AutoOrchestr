'use strict';
// A participant without an answer is handled as in Basic: reread the page, wait by the Basic settings,
// skip the participant and go on. Nothing is sent again.
const test=require('node:test');
const assert=require('node:assert/strict');
require('../disput/custom-engine.js');
require('../disput/basic-schema.js');
const {createBasicAdapter}=require('../disput/thecycle/basic-adapter.js');
const schema={schemaVersion:1,origin:'user',run:{policy:'auto'},steps:[
 {ref:'r1',kind:'round',models:[{name:'GPT'},{name:'Claude'}]},
 {ref:'r2',kind:'round',input:'previous',models:[{name:'GPT'},{name:'Claude'}]}]};
const GOOD='A sufficiently long answer with substance.';
// empty: models whose first request gives no text; later requests (round 2) are answered
const setup=({empty,pageAnswer,settings={waitMinutes:0.01,skipNoAnswer:false},noReread=false})=>{
 const sent=[],rereads=[],journal=[];
 const send=async(models,prompts,meta)=>{
  models.forEach(m=>sent.push({m,step:meta.step}));
  return {byModel:Object.fromEntries(models.map(m=>{
   const dead=empty.includes(m)&&meta.step===0;
   return [m,{text:dead?'':GOOD+' '+m,answered:!dead,status:dead?'NO_RESPONSE':'SUCCESS',attribution:dead?'':'verified',
    sentPrompt:'P:'+m+':'+meta.step}];
  }))};
 };
 const reread=async(request)=>{
  rereads.push(request.modelName);
  const text=pageAnswer?.[request.modelName];
  return text?{found:true,text,status:'SUCCESS',completion:'complete'}:{found:false,reason:'no_reply'};
 };
 const adapter=createBasicAdapter({availableModels:['GPT','Claude'],isRole:()=>true,roleText:()=>'',
  accept:({text})=>({ok:String(text).length>10}),journal:async e=>journal.push(e),send,
  ...(noReread?{}:{reread,settings:()=>settings})});
 const exec=()=>adapter.execute({researchId:'r',runId:'r:cycle:1',cycleId:1,schema,task:'Task',maxCalls:8,maxPromptChars:20000});
 return {sent,rereads,journal,exec};
};
test('the answer found on the page by the reread is accepted and round 2 goes on',async()=>{
 const x=setup({empty:['Claude'],pageAnswer:{Claude:GOOD+' from the page'}});
 const report=await x.exec();
 assert.equal(report.steps[0].outcome.Claude.ok,true);
 assert.equal(report.steps.length,2);
 assert.equal(report.status,'PIPELINE_COMPLETE');
 assert.ok(x.rereads.includes('Claude'));
 assert.equal(x.sent.filter(s=>s.m==='Claude'&&s.step===0).length,1);
});
test('no answer on the page after the wait: the participant is skipped, round 2 goes on without it',async()=>{
 const x=setup({empty:['Claude']});
 const report=await x.exec();
 assert.equal(report.steps.length,2);
 assert.equal(report.steps[0].outcome.GPT.ok,true);
 assert.equal(report.steps[0].outcome.Claude.ok,false);
 assert.notEqual(report.stopReason,'stopped');
 assert.ok(x.rereads.length>=1);
 assert.equal(x.sent.filter(s=>s.step===0&&s.m==='Claude').length,1);
});
test('every participant empty: the run stops as in Basic, without a wait loop',async()=>{
 const x=setup({empty:['GPT','Claude']});
 const started=Date.now();
 const report=await x.exec();
 assert.ok(Date.now()-started<15000);
 assert.notEqual(report.status,'PIPELINE_COMPLETE');
 assert.notEqual(report.status,'UNKNOWN');
 assert.equal(x.sent.filter(s=>s.step===0).length,2);
});
test('skipNoAnswer: the participant is skipped at once, no more requests than before',async()=>{
 const x=setup({empty:['Claude'],settings:{waitMinutes:20,skipNoAnswer:true}});
 const report=await x.exec();
 assert.equal(report.steps.length,2);
 assert.equal(report.steps[0].outcome.Claude.ok,false);
 assert.equal(x.sent.filter(s=>s.step===0).length,2);
});
test('without a reread callback the old behaviour stays: the run stops',async()=>{
 const x=setup({empty:['Claude'],noReread:true});
 const report=await x.exec();
 assert.equal(report.basicStopReason,'stopped');
 assert.equal(report.status,'PARTIAL');
});
test('requests are never more than one per participant per round',async()=>{
 const x=setup({empty:['Claude']});
 await x.exec();
 const counts={};
 x.sent.forEach(s=>{const k=s.m+s.step;counts[k]=(counts[k]||0)+1;});
 assert.ok(Object.values(counts).every(n=>n===1),JSON.stringify(counts));
});
