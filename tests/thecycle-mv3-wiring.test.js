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
