// MV3 bootstrap: register the TheCycle alarm, but do not claim a backup
// until a persistent directory handle and research runtime are configured.
(function(root){'use strict';
if(!root.chrome?.alarms||!root.TheCycleAlarmScheduler)return;
// Optional helpers: a missing module disables only its own feature (telemetry, rotation).
for(const path of ['../disput/thecycle/telemetry.js','../disput/thecycle/gate-metadata.js','../disput/thecycle/backup-retention.js']){
 try{root.importScripts?.(path);}catch(error){console.warn('[TheCycle] optional module not loaded:',path,error);}
}
const emit=async(type,data)=>{try{await root.TheCycleTelemetry?.append(type,data);}catch(_){}};
let inFlight=null;
async function performBackupOnce(){

  // A document context must supply the authorized directory handle and
  // perform the actual readback-verified backup. Never silently mark success.
  const configured=await root.chrome.storage.local.get('thecycleBackupEnabled');
  if(configured.thecycleBackupEnabled!==true)throw new Error('BACKUP_NOT_ENABLED');
  const modules=[root.TheCycleDirectoryHandleManager,root.TheCycleStateStore,
    root.TheCycleDirectorySink,root.TheCycleBackup,
    root.TheCycleRecoveryRepositories];
  if(modules.some(x=>!x))throw new Error('THECYCLE_BACKUP_MODULES_MISSING');
  const manager=await root.TheCycleDirectoryHandleManager.createDirectoryHandleManager();
  let store,registry,metadata;
  try{
    registry=await root.TheCycleRecoveryRepositories.createRecoveryRepositories();
    const pointer=await registry.activation.read();
    if(!/^auto-orchestr-thecycle(?:-restore-[a-zA-Z0-9_-]{8,})?$/.test(pointer.activeDatabase))
      throw new Error('BACKUP_ACTIVE_DATABASE_INVALID');
    let directory;
    try{directory=await manager.load('thecycle-backups');}
    catch(error){
     const code=String(error?.message||error);
     await emit('BACKUP_DIRECTORY_PERMISSION',{reason:code,directory:{id:'thecycle-backups',source:'alarm',
      outcome:code==='DIRECTORY_PERMISSION_REQUIRED'?'DENIED':code==='DIRECTORY_HANDLE_NOT_FOUND'?'NOT_CONFIGURED':'ERROR',
      permission:code==='DIRECTORY_PERMISSION_REQUIRED'?'prompt':undefined,requested:false,error:code}});
     throw error;
    }
    store=await root.TheCycleStateStore.createStateStore({name:pointer.activeDatabase});
    // Nothing to save; an empty copy must not push real copies of this directory out of the rotation.
    if(!(await store.listResearch()).length){
      await root.chrome.storage.local.set({thecycleBackupStatus:{
        state:'SKIPPED',reason:'NO_RESEARCH',database:pointer.activeDatabase,at:Date.now()
      }});
      return {skipped:'NO_RESEARCH'};
    }
    const sink=root.TheCycleDirectorySink.createDirectorySink({directory});
    const backup=root.TheCycleBackup.createBackupService({store,sink});
    const key='thecycle-alarm-'+Date.now()+'-'+root.crypto.randomUUID().replace(/-/g,'');
    const result=await backup.save(key);
    if(result.verified!==true)throw new Error('THECYCLE_BACKUP_UNVERIFIED');
    await emit('BACKUP_READBACK_VERIFIED',{database:pointer.activeDatabase,backup:{key,sha256:result.sha256,verified:result.verified},reason:'alarm'});
    // Rotation only after the copy is fully verified; its failure never fails the backup.
    if(root.TheCycleBackupRetention&&root.TheCycleGateMetadata){
     try{
      metadata=await root.TheCycleGateMetadata.createGateMetadata();
      const retention=root.TheCycleBackupRetention.createRetention({sink,store,metadata,storage:root.chrome.storage.local,
       onEvent:(type,data)=>emit(type,{database:pointer.activeDatabase,...data})});
      await retention.afterVerified({key,sha256:result.sha256,createdAt:Date.now()});
     }catch(error){await emit('RETENTION_ERROR',{error,retention:{key}});}
    }else await emit('RETENTION_SKIPPED',{retention:{key,skipReason:'MODULES_MISSING'}});
    await root.chrome.storage.local.set({thecycleBackupStatus:{
      state:'VERIFIED',key,sha256:result.sha256,database:pointer.activeDatabase,at:Date.now()
    }});
    return {key,sha256:result.sha256};
  }catch(error){await emit('BACKUP_FAILED',{reason:'alarm',error});throw error;}
 finally{try{metadata?.close();}catch(_){}store?.close();registry?.close();manager.close();}
}
function performBackup(){
 if(inFlight)return inFlight;
 inFlight=performBackupOnce().finally(()=>{inFlight=null;});
 return inFlight;
}
const scheduler=root.TheCycleAlarmScheduler.createAlarmScheduler({
 alarms:root.chrome.alarms,
 onBackupDue:async()=>{
  const configured=await root.chrome.storage.local.get('thecycleBackupEnabled');
  if(configured.thecycleBackupEnabled!==true)return;
  return performBackup();
 },
 onFailure:async error=>{
  await root.chrome.storage.local.set({thecycleBackupStatus:{
   state:'FAILED',reason:String(error?.message||error),at:Date.now()
  }});
 }
});
root.chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
 if(message?.type!=='THECYCLE_BACKUP_NOW')return false;
 if(sender?.id!==root.chrome.runtime.id){sendResponse({ok:false,error:'UNAUTHORIZED_SENDER'});return false;}
 performBackup().then(result=>sendResponse({ok:true,...result})).catch(async error=>{
  try{await root.chrome.storage.local.set({thecycleBackupStatus:{
   state:'FAILED',reason:String(error?.message||error),at:Date.now()
  }});}catch(_){}
  sendResponse({ok:false,error:String(error?.message||error)});
 });
 return true;
});
// Toolbar badge: a Circle research waits (flag set, no fresh heartbeat of a working page). Only storage is read: no pages, no IndexedDB.
async function updateCircleBadge(){
 const action=root.chrome.action;
 if(!action?.setBadgeText)return;
 try{
  const local=root.chrome.storage.local;
  const pending=(await local.get('thecycle.circle.pending'))['thecycle.circle.pending'];
  let waiting=false;
  if(pending?.researchId){
   const hbKey='thecycle.circle.heartbeat.'+pending.researchId;
   const hb=(await local.get(hbKey))[hbKey];
   waiting=!(hb&&Number.isFinite(hb.at)&&Date.now()-hb.at<=180000);
  }
  await action.setBadgeText({text:waiting?'\u27F3':''});
  await action.setTitle?.({title:waiting?'Незавершённое исследование Circle':''});
 }catch(error){console.warn('[TheCycle badge]',error);}
}
root.chrome.alarms.onAlarm.addListener(alarm=>{
 void updateCircleBadge();
 void scheduler.dispatch(alarm).catch(error=>console.error('[TheCycle alarm]',error));
});
root.chrome.runtime.onInstalled.addListener(()=>{void scheduler.register().catch(console.error);});
root.chrome.runtime.onStartup.addListener(()=>{void scheduler.register().catch(console.error);});
void scheduler.register().catch(console.error);
})(self);
