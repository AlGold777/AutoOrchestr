'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const presets=require('../disput/pipeline-presets');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
test('Circle is a registered distinct enabled pipeline with existing Basic unchanged',()=>{
 const circle=presets.BUILTIN_PIPELINE_DEFINITIONS.find(x=>x.name==='Circle');
 assert.equal(circle.presetId,'CIRCLE');assert.equal(presets.getPipelinePreset('CIRCLE').runner,'circle');
 assert.equal(presets.getPipelinePreset('CUSTOM').runner,'custom');
 assert.equal(presets.isPresetEnabled('CIRCLE'),true);
});
test('normal pipeline dispatch routes Circle to its own runner, not Classic',async()=>{
 const source=read('results.js');
 const start=source.indexOf("            if (selectedPreset?.runner === 'circle')");
 const custom=source.indexOf("            if (selectedPreset?.runner === 'custom')",start);
 assert.ok(start>0&&custom>start);
 const dispatch=new Function('selectedPreset','moderatorEntryText','pipelineNameText','runCircleFromPage',source.slice(start,custom)+'\nreturn null;');
 const seen=[];
 const circle=arg=>{seen.push(['circle',arg]);return 'circle';};
 assert.equal(dispatch(presets.getPipelinePreset('CIRCLE'),'Task','Fallback',circle),'circle');
 // The custom preset is not taken by the Circle branch: it falls through to the Basic branch below.
 assert.equal(dispatch(presets.getPipelinePreset('CUSTOM'),'Task','Fallback',circle),null);
 assert.deepEqual(seen,[['circle',{task:'Task'}]]);
});
test('Circle controls and stop route are wired in the real page',()=>{
 const source=read('results.js'),html=read('result_new.html');
 assert.match(html,/data-name="Circle"/);assert.match(html,/id="circle-call-budget"/);
 assert.match(html,/src="disput\/thecycle\/circle-runtime.js"/);
 assert.match(source,/if \(circlePageRunner\) \{\s+const bridgeRun = theCycleBridgeRunId;\s+await circlePageRunner\.stop\(\);/);
 assert.match(source,/circlePageRunner\.start\(\{ task, maxCalls, onProgress: showCircleStatus \}\)/);
});
