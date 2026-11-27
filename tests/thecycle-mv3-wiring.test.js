'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
function source(p){return fs.readFileSync(path.join(root,p),'utf8');}
test('MV3 manifest exposes backup settings and required alarms permission',()=>{
 const manifest=JSON.parse(source('manifest.json'));
 assert.equal(manifest.options_page,'thecycle-backup.html');
 assert.ok(manifest.permissions.includes('alarms'));
});
test('MV3 worker loads alarm bootstrap and its dependencies in order',()=>{
 const entry=source('background/index.js');
 const names=['alarm-scheduler.js','directory-handle-manager.js','state-store.js',
 'directory-sink.js','backup-service.js','thecycle-alarm-bootstrap.js'];
 let previous=-1;
 for(const name of names){const at=entry.indexOf(name);assert.ok(at>previous,name);previous=at;}
});
test('alarm bootstrap registers and dispatches without an enabled backup',async()=>{
 const listeners={};
 const storage={thecycleBackupEnabled:false};
 const chrome={
  runtime:{id:'test-extension',onMessage:{addListener:fn=>listeners.message=fn},
   onInstalled:{addListener:fn=>listeners.installed=fn},
   onStartup:{addListener:fn=>listeners.startup=fn}},
  alarms:{get:async()=>null,create:async()=>{},onAlarm:{addListener:fn=>listeners.alarm=fn}},
  storage:{local:{get:async key=>({[key]:storage[key]}),set:async values=>Object.assign(storage,values)}}
 };
 const context={chrome,crypto:{randomUUID:()=> '11111111-1111-1111-1111-111111111111'},
 console,Date,Promise};
 context.self=context;context.globalThis=context;
 vm.runInNewContext(source('disput/thecycle/alarm-scheduler.js'),context);
 vm.runInNewContext(source('background/thecycle-alarm-bootstrap.js'),context);
 assert.equal(typeof listeners.alarm,'function');
 assert.equal(typeof listeners.message,'function');
 const response=await new Promise(resolve=>{
  const asyncResponse=listeners.message({type:'THECYCLE_BACKUP_NOW'},{id:'test-extension'},resolve);
  assert.equal(asyncResponse,true);
 });
 assert.equal(response.ok,false);
 assert.equal(response.error,'BACKUP_NOT_ENABLED');
});
function badgeHarness(initial){
 const listeners={},storage={thecycleBackupEnabled:false,...initial},calls=[];
 const chrome={
  runtime:{id:'test-extension',onMessage:{addListener:fn=>listeners.message=fn},
   onInstalled:{addListener:fn=>listeners.installed=fn},onStartup:{addListener:fn=>listeners.startup=fn}},
  alarms:{get:async()=>null,create:async()=>{},onAlarm:{addListener:fn=>listeners.alarm=fn}},
  action:{setBadgeText:async v=>{calls.push(['text',v.text]);},setTitle:async v=>{calls.push(['title',v.title]);}},
  storage:{local:{get:async key=>({[key]:storage[key]}),set:async values=>Object.assign(storage,values)}}
 };
 const context={chrome,crypto:{randomUUID:()=> '11111111-1111-1111-1111-111111111111'},console,Date,Promise};
 context.self=context;context.globalThis=context;
 vm.runInNewContext(source('disput/thecycle/alarm-scheduler.js'),context);
 vm.runInNewContext(source('background/thecycle-alarm-bootstrap.js'),context);
 const fire=async()=>{calls.length=0;listeners.alarm({name:'other-alarm'});await new Promise(r=>setTimeout(r,20));return calls.slice();};
 return {fire,storage};
}
test('alarm sets the badge for a waiting Circle research without a fresh heartbeat',async()=>{
 const id='circle-1';
 const none=badgeHarness({'thecycle.circle.pending':{researchId:id,phase:'RECONCILE',at:1}});
 assert.deepEqual(await none.fire(),[['text','⟳'],['title','Незавершённое исследование Circle']]);
 const stale=badgeHarness({'thecycle.circle.pending':{researchId:id,phase:'PAUSED',at:1},['thecycle.circle.heartbeat.'+id]:{ownerId:'t',at:Date.now()-181000}});
 assert.deepEqual(await stale.fire(),[['text','⟳'],['title','Незавершённое исследование Circle']]);
 const released=badgeHarness({'thecycle.circle.pending':{researchId:id,phase:'PAUSED',at:1},['thecycle.circle.heartbeat.'+id]:{ownerId:'t',at:0}});
 assert.equal((await released.fire())[0][1],'⟳');
});
test('alarm clears the badge with a fresh heartbeat or without the flag',async()=>{
 const id='circle-1';
 const fresh=badgeHarness({'thecycle.circle.pending':{researchId:id,phase:'ACTIVE',at:1},['thecycle.circle.heartbeat.'+id]:{ownerId:'t',at:Date.now()-5000}});
 assert.deepEqual(await fresh.fire(),[['text',''],['title','']]);
 const slowThrottled=badgeHarness({'thecycle.circle.pending':{researchId:id,phase:'ACTIVE',at:1},['thecycle.circle.heartbeat.'+id]:{ownerId:'t',at:Date.now()-120000}});
 assert.deepEqual(await slowThrottled.fire(),[['text',''],['title','']]);
 const noFlag=badgeHarness({});
 assert.deepEqual(await noFlag.fire(),[['text',''],['title','']]);
 const cleared=badgeHarness({'thecycle.circle.pending':null});
 assert.deepEqual(await cleared.fire(),[['text',''],['title','']]);
});
test('badge needs no new manifest permission (action API is part of the manifest action key)',()=>{
 const manifest=JSON.parse(source('manifest.json'));
 assert.ok(manifest.action);
 assert.ok(!manifest.permissions.includes('action'));
});
