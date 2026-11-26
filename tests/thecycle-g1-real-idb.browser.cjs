'use strict';
// Executable Chrome/Chromium G1 acceptance: real IndexedDB, real Basic engine,
// actual controller and adapter, controlled provider stub. This is NOT proof
// of authenticated provider availability or real extension transport.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const scripts = [
 'disput/custom-engine.js',
 'disput/basic-schema.js',
 'disput/thecycle/state-store.js',
 'disput/thecycle/recovery-repositories.js',
 'disput/thecycle/active-state-store.js',
 'disput/thecycle/basic-adapter.js',
 'disput/thecycle/controller.js',
 'disput/thecycle/g1-runtime.js'
];
async function load(page) {
 for(const name of scripts) await page.addScriptTag({path:path.join(ROOT,name)});
}
test('G1 real browser: Basic Engine → durable IDB journal/packet → reload → status; exactly one send', async t => {
 const server=http.createServer((req,res)=>{
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
  res.end('<!doctype html><title>TheCycle G1 test origin</title>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const browser=await chromium.launch({headless:true});
 t.after(()=>browser.close());
 const page=await browser.newPage();
 const url='http://127.0.0.1:'+server.address().port+'/';
 await page.goto(url);
 await load(page);
 const original=await page.evaluate(async()=>{
  const storage={
   async get(key){const keys=Array.isArray(key)?key:[key];const out={};
    for(const k of keys){const raw=localStorage.getItem(k);if(raw!==null)out[k]=JSON.parse(raw);}
    return out;
   },
   async set(rows){for(const [k,v] of Object.entries(rows))localStorage.setItem(k,JSON.stringify(v));}
  };
  let sends=0,activeRun=null;
  const bridge={
   capture:()=>({models:['GPT'],errors:[],policy:'manual',schema:{
    schemaVersion:1,origin:'user',run:{policy:'manual'},
    steps:[{ref:'r1',kind:'round',models:[{name:'GPT'}]}]
   }}),
   roleText:()=>'',accept:()=>({ok:true}),
   begin({runId}){if(activeRun)throw Error('CONCURRENT_RUN');activeRun=runId;},
   end({runId}){if(activeRun!==runId)throw Error('RUN_MISMATCH');activeRun=null;},
   async send(models,prompts,meta){
    if(!activeRun||meta.runId!==activeRun)throw Error('UNEXPECTED_RUN');
    sends++;
    return {byModel:{GPT:{text:'Chrome IndexedDB accepted this provider response',
     status:'SUCCESS',answered:true,attribution:'verified',
     transportRequestId:'browser-fixture-1'}}};
   }
  };
  const runner=TheCycleG1.createG1Runner({bridge,storage});
  const result=await runner.start({task:'Verify one Basic invocation',maxCalls:4});
  const persisted=await runner.snapshot(result.researchId);
  return {sends,runId:result.researchId,phase:result.state.phase,packet:result.packet,
   report:result.report,persistedPhase:persisted.state.phase,persistedReport:persisted.report,
   outcomes:result.outcomes};
 });
 assert.equal(original.sends,1);
 assert.equal(original.phase,'PAUSED');
 assert.equal(original.persistedPhase,'PAUSED');
 assert.equal(original.packet.status,'RECORDED_RESULT');
 assert.equal(original.report.status,'PIPELINE_COMPLETE');
 assert.equal(original.report.answers[0],'Chrome IndexedDB accepted this provider response');
 assert.equal(original.persistedReport.answers[0],original.report.answers[0]);
 assert.deepEqual(original.outcomes, ['RUN_RETURNED','PACKET_COMMITTED','DECISION','G1_SINGLE_CYCLE_STOP']);
 await page.reload();
 await load(page);
 const recovered=await page.evaluate(async id=>{
  const active=await TheCycleActiveStateStore.createActiveStateStore();
  try{
   const state=await active.store.load(id);
   const packet=await active.store.getPacket(id,1);
   const rows=await active.store.getEvents(id,packet.runId);
   const report=rows.find(e=>e.eventId===packet.resultEventId)?.payload?.report;
   const intents=rows.filter(e=>e.payload.type==='DISPATCH_INTENT').length;
   const responses=rows.filter(e=>e.payload.type==='DISPATCH_RESPONSE').length;
   const owner=await active.store.getOwnership();
   return {state,packet,report,intents,responses,owner};
  }finally{active.close();}
 },original.runId);
 assert.equal(recovered.state.phase,'PAUSED');
 assert.equal(recovered.state.lastCommittedPacket,1);
 assert.equal(recovered.packet.status,'RECORDED_RESULT');
 assert.equal(recovered.report.status,'PIPELINE_COMPLETE');
 assert.equal(recovered.report.answers[0],original.report.answers[0]);
 assert.equal(recovered.intents,1);
 assert.equal(recovered.responses,1);
 assert.equal(recovered.owner.ownerId,null);
});
