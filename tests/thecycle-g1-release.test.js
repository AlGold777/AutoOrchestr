'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createG1Runner}=require('../disput/thecycle/g1-runtime.js');

function make({endThrows=false,settledThrows=false,closeThrows=false}={}){
 const data=new Map();
 const storage={async get(k){const o={};for(const key of (Array.isArray(k)?k:[k]))if(data.has(key))o[key]=data.get(key);return o;},
  async set(r){for(const [k,v] of Object.entries(r))data.set(k,v);}};
 const calls=[];
 const store={async createResearch(){},async load(){return {phase:'PAUSED',lastCommittedPacket:null};}};
 const bridge={
  capture:()=>({models:['GPT'],errors:[],schema:{schemaVersion:1,steps:[{ref:'r1',kind:'round',models:[{name:'GPT'}]}]}}),
  send:async()=>({}),accept:()=>({ok:true}),roleText:()=>'',
  hold(){calls.push('hold');},
  begin(){calls.push('begin');},
  end(){calls.push('end');if(endThrows)throw new Error('END_FAILED');},
  release(){calls.push('release');}
 };
 const controllerApi={createController:()=>({
  tick:async()=>({outcome:'NOOP'}),stop:async()=>{},
  releaseSettled:async()=>{calls.push('settled');if(settledThrows)throw new Error('SETTLED_FAILED');}
 })};
 const adapterApi={createBasicAdapter:()=>({validate:()=>({ok:true,errors:[]})})};
 const activeStore={async createActiveStateStore(){return {store,database:'d',
  close(){calls.push('close');if(closeThrows)throw new Error('CLOSE_FAILED');}};}};
 const runner=createG1Runner({bridge,storage,activeStore,controllerApi,adapterApi,uuid:()=>'u1'});
 return {runner,calls};
}

test('G1 releases the bridge on a normal run',async()=>{
 const x=make();
 await x.runner.start({task:'t'});
 assert.deepEqual(x.calls.filter(c=>c==='release'),['release']);
 assert.equal(x.runner.isRunning(),false);
});
test('G1 releases the bridge when bridge.end throws',async()=>{
 const x=make({endThrows:true});
 await assert.rejects(x.runner.start({task:'t'}),/END_FAILED/);
 assert.ok(x.calls.includes('settled'));
 assert.ok(x.calls.includes('close'));
 assert.ok(x.calls.includes('release'));
 assert.equal(x.runner.isRunning(),false);
});
test('G1 releases the bridge when active.close throws',async()=>{
 const x=make({closeThrows:true});
 await assert.rejects(x.runner.start({task:'t'}),/CLOSE_FAILED/);
 assert.ok(x.calls.includes('release'));
 assert.equal(x.runner.isRunning(),false);
});
test('G1 releases the bridge when releaseSettled throws',async()=>{
 const x=make({settledThrows:true});
 await x.runner.start({task:'t'});
 assert.ok(x.calls.includes('release'));
});
