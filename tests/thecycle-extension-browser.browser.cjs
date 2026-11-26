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
});
