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
 const end=source.indexOf('            const presetConfig = buildPipelinePresetRuntimeConfig(presetId);',start);
 assert.ok(start>0&&end>start);
 const dispatch=new Function('selectedPreset','moderatorEntryText','pipelineNameText','presetId','runCircleFromPage','runCustomFromPage','runPolishingFromPage','runDeltaFromPage',source.slice(start,end));
 const seen=[];
 const call=name=>arg=>{seen.push([name,arg]);return name;};
 assert.equal(dispatch(presets.getPipelinePreset('CIRCLE'),'Task','Fallback','CIRCLE',call('circle'),call('classic'),call('polishing'),call('delta')),'circle');
 assert.equal(dispatch(presets.getPipelinePreset('CUSTOM'),'Task','Fallback','CUSTOM',call('circle'),call('classic'),call('polishing'),call('delta')),'classic');
 assert.deepEqual(seen,[['circle',{task:'Task'}],['classic',{task:'Task'}]]);
});
test('Circle controls and stop route are wired in the real page',()=>{
 const source=read('results.js'),html=read('result_new.html');
 assert.match(html,/data-name="Circle"/);assert.match(html,/id="circle-call-budget"/);
 assert.match(html,/src="disput\/thecycle\/circle-runtime.js"/);
 assert.match(source,/if \(circlePageRunner\) \{ await circlePageRunner\.stop\(\); return true; \}/);
 assert.match(source,/circlePageRunner\.start\(\{ task, maxCalls, onProgress: showCircleStatus \}\)/);
});
