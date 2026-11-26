'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const telemetry=require('../disput/thecycle/telemetry.js');
const fs=require('node:fs'),path=require('node:path');
test('TheCycle journal preserves diagnostic order, excludes raw prompt/answer, clears only its own rows',async()=>{
 let rows=[],seq=0,notifies=0;const evidence=['original'];
 const t=telemetry.createTelemetry({repository:{async append(r){rows.push({...r,seq:++seq});},async list(){return rows.slice().reverse();},async clear(){rows=[];}},clock:()=>0,notify:()=>notifies++,version:()=>'1.0'});
 await t.append('DISPATCH_INTENT',{event:{researchId:'r',runId:'r:1',cycleId:1,batchId:'b',models:['GPT'],prompts:{GPT:'secret prompt'}}});
 await t.append('DISPATCH_RESPONSE',{event:{researchId:'r',runId:'r:1',cycleId:1,batchId:'b',response:{byModel:{GPT:{text:'secret answer',status:'SUCCESS',attribution:'verified',transportRequestId:'id'}}}}});
 await t.append('DECISION',{researchId:'r',state:{budget:{usedCalls:1,maxCalls:3},phase:'READY'},decision:{action:'CONTINUE',reason:'FIXED_PIPELINE'}});
 const got=await t.list(),md=telemetry.markdown(got);
 assert.equal(got.length,3);assert.equal(got[0].seq,1);assert.equal(got[1].responses[0].answerChars,13);
 assert.match(md,/CONTINUE/);assert.match(md,/transportRequestId/);assert.ok(!md.includes('secret prompt')&&!md.includes('secret answer'));
 await t.clear();assert.equal((await t.list()).length,0);assert.equal(evidence[0],'original');assert.equal(notifies,4);
 await t.append('RESEARCH_ERROR',{researchId:'r',error:Error('DISK_FAILURE')});assert.match(telemetry.markdown(await t.list()),/DISK_FAILURE/);
});
test('TheCycle tab, MD and grey X are wired in real Telemetry modal',()=>{
 const h=fs.readFileSync(path.join(__dirname,'..','result_new.html'),'utf8');
 const v=fs.readFileSync(path.join(__dirname,'..','results/thecycle-telemetry-view.js'),'utf8');
 assert.match(h,/data-tab-target="thecycle-tabpanel"/);assert.match(h,/id="thecycle-export-md"/);assert.match(h,/id="thecycle-clear-telemetry"[^>]*style="color:#808080"><i class="ti ti-x"/);
 assert.match(v,/api\.markdown\(rows\)/);assert.match(v,/await api\.clear\(\)/);
});
