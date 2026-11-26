'use strict';
// G3.1: schemas with Basic features the Circle path does not support are refused before sending.
const test=require('node:test');
const assert=require('node:assert/strict');
require('../disput/custom-engine.js');
require('../disput/basic-schema.js');
const {createBasicAdapter}=require('../disput/thecycle/basic-adapter.js');
const base=()=>({schemaVersion:1,origin:'user',run:{policy:'auto'},steps:[
 {ref:'r1',kind:'round',models:[{name:'GPT'},{name:'Claude'}]}]});
const make=(extra={})=>createBasicAdapter({availableModels:['GPT','Claude'],isRole:()=>true,roleText:()=>'',
 accept:()=>({ok:true}),journal:async()=>{},send:async()=>({byModel:{}}),...extra});
const refused=(mutate,path)=>{
 const s=base();mutate(s);
 const r=make().validate(s);
 assert.equal(r.ok,false);
 assert.ok(r.errors.some(e=>String(e.path).includes(path)),JSON.stringify(r.errors));
};
test('base schema is valid',()=>assert.equal(make().validate(base()).ok,true));
test('run.stopMarks refused',()=>refused(s=>{s.run.stopMarks=['STOP'];},'run.stopMarks'));
test('run.repeat refused',()=>refused(s=>{s.run.repeat={carry:{step:'r1',participant:'GPT',artifact:'answer'},carryMarker:'X'};},'run.repeat'));
test('step.files refused',()=>refused(s=>{s.steps[0].files=[{id:'f1',name:'a.txt',content:'x'}];},'r1.files'));
test('model.files refused',()=>refused(s=>{s.steps[0].models[0].files=[{id:'f1',name:'a.txt',content:'x'}];},'models.GPT.files'));
test('chat new refused',()=>refused(s=>{s.steps[0].chat='new';},'r1.chat'));
test('two roles of one model refused',()=>refused(s=>{s.steps[0].models=[{name:'GPT',id:'a'},{name:'GPT',id:'b'}];},'models.GPT'));
test('runStrictLength and runMaxWords reach engine.run',async()=>{
 let got=null;
 const fake={run:async(o)=>{got=o;return {steps:[],history:[],answers:{},stopReason:'cancelled'};}};
 const s=base();s.run.strictLength=true;s.run.maxWords=500;
 const a=make({engine:fake});
 await a.execute({researchId:'r',runId:'r:1',cycleId:1,schema:s,task:'T',maxCalls:4,maxPromptChars:20000});
 assert.equal(got.runStrictLength,true);
 assert.equal(got.runMaxWords,500);
});
