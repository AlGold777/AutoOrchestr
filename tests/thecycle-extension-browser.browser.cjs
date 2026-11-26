'use strict';
// G1 installed-extension smoke, not a real-LLM provider acceptance.
// Chrome MV3 must load the actual background and results page; Circle and
// Classic must coexist while Basic Engine stays untouched.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'..');

test('TheCycle G1 installs in Chromium MV3 and exposes Circle beside unchanged Basic',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'thecycle-g1-extension-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const context=await chromium.launchPersistentContext(directory,{
  channel:'chromium',headless:true,
  args:['--disable-extensions-except='+ROOT,'--load-extension='+ROOT]
 });
 t.after(()=>context.close());
 let worker=context.serviceWorkers()[0];
 if(!worker)worker=await context.waitForEvent('serviceworker',{timeout:45000});
 const id=new URL(worker.url()).host;
 assert.match(id,/^[a-p]{32}$/);
 const page=await context.newPage();
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const response=await page.goto('chrome-extension://'+id+'/result_new.html',{waitUntil:'domcontentloaded',timeout:45000});
 assert.equal(response?.status(),200);
 await page.waitForFunction(()=>
   !!window.PipelinePresets?.getPipelinePreset&&
   !!window.TheCycleG1?.createG1Runner&&
   !!window.TheCycleCircle?.createCircleRunner&&
   !!window.TheCycleMainPageBridge?.capture,
 null,{timeout:60000});
 const state=await page.evaluate(()=>{
  const custom=PipelinePresets.getPipelinePreset('CUSTOM');
  const circle=PipelinePresets.getPipelinePreset('CIRCLE');
  const registered=PipelinePresets.BUILTIN_PIPELINE_DEFINITIONS
   .filter(d=>['Basic','Circle'].includes(d.name))
   .map(d=>({name:d.name,presetId:d.presetId}));
  return {
   basicRunner:custom.runner,
   circleRunner:circle.runner,
   circleEnabled:PipelinePresets.isPresetEnabled('CIRCLE'),
   registered,
   basicEngineLoaded:typeof CustomEngine?.run==='function',
   hasCircleRunControls:!!document.querySelector('#circle-call-budget'),
   hasG1Start:!!document.querySelector('#thecycle-g1-start')
  };
 });
 assert.equal(state.basicRunner,'custom');
 assert.equal(state.circleRunner,'circle');
 assert.equal(state.circleEnabled,true);
 assert.equal(state.basicEngineLoaded,true);
 assert.equal(state.hasCircleRunControls,true);
 assert.equal(state.hasG1Start,true);
 assert.deepEqual(state.registered.map(x=>x.name).sort(),['Basic','Circle']);
 const fatal=errors.filter(x=>/TheCycle|Circle|BasicSchema|CustomEngine/i.test(x));
 assert.deepEqual(fatal,[], 'Browser script errors: '+fatal.join(' | '));

 // A real installed extension runs its genuine UI, Basic Engine, Controller,
 // and IndexedDB. Only the external LLM response is replaced with a deterministic
 // fixture; this is not an authenticated-provider acceptance.
 await page.evaluate(()=>{
  let activeRun=null;
  window.TheCycleMainPageBridge=Object.freeze({
   capture(){return {models:['GPT'],errors:[],policy:'manual',
    schema:{schemaVersion:1,origin:'user',run:{policy:'manual'},
     steps:[{ref:'r1',kind:'round',models:[{name:'GPT'}]}]}};},
   roleText:()=>'',accept:()=>({ok:true}),
   begin({runId}){if(activeRun)throw Error('SMOKE_CONCURRENT_RUN');activeRun=runId;},
   end({runId}){if(activeRun!==runId)throw Error('SMOKE_RUN_MISMATCH');activeRun=null;},
   async send(models,prompts,meta){
    if(meta.runId!==activeRun)throw Error('SMOKE_INCORRECT_RUN');
    const stored=await chrome.storage.local.get('thecycle.g1.smoke.sends');
    await chrome.storage.local.set({'thecycle.g1.smoke.sends':(stored['thecycle.g1.smoke.sends']||0)+1});
    return {byModel:{GPT:{text:'G1_EXTENSION_UI_BROWSER_RESPONSE',
     status:'SUCCESS',answered:true,attribution:'verified',
     transportRequestId:'g1-extension-smoke-1'}}};
   }
  });
 });
 await page.locator('#thecycle-g1 summary').click();
 await page.locator('#thecycle-g1-task').fill('Run one Basic cycle through the extension UI');
 await page.locator('#thecycle-g1-budget').fill('3');
 await page.locator('#thecycle-g1-start').click();
 await page.waitForFunction(()=>{
  const text=document.querySelector('#thecycle-g1-output')?.textContent||'';
  return text.includes('G1_SINGLE_CYCLE_STOP')&&text.includes('G1_EXTENSION_UI_BROWSER_RESPONSE');
 },null,{timeout:60000});
 const first=JSON.parse(await page.locator('#thecycle-g1-output').textContent());
 assert.equal(first.phase,'PAUSED');
 assert.equal(first.packetStatus,'RECORDED_RESULT');
 assert.equal(first.runStatus,'PIPELINE_COMPLETE');
 assert.equal(first.answers[0]?.answer,'G1_EXTENSION_UI_BROWSER_RESPONSE');
 const firstSends=await page.evaluate(async()=>(
  await chrome.storage.local.get('thecycle.g1.smoke.sends'))['thecycle.g1.smoke.sends']);
 assert.equal(firstSends,1,'Exactly one transport dispatch');

 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>!!window.TheCycleMainPageBridge?.capture,null,{timeout:60000});
 await page.locator('#thecycle-g1 summary').click();
 await page.locator('#thecycle-g1-status').click();
 await page.waitForFunction(()=>
  (document.querySelector('#thecycle-g1-output')?.textContent||'')
   .includes('G1_EXTENSION_UI_BROWSER_RESPONSE'),null,{timeout:30000});
 const restored=JSON.parse(await page.locator('#thecycle-g1-output').textContent());
 assert.equal(restored.researchId,first.researchId);
 assert.equal(restored.packetStatus,'RECORDED_RESULT');
 assert.equal(restored.answers[0]?.answer,first.answers[0]?.answer);
 const afterReloadSends=await page.evaluate(async()=>(
  await chrome.storage.local.get('thecycle.g1.smoke.sends'))['thecycle.g1.smoke.sends']);
 assert.equal(afterReloadSends,1,'Reload must not dispatch again');
});
