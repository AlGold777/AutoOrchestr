// MV3 bootstrap: register the TheCycle alarm, but do not claim a backup
// until a persistent directory handle and research runtime are configured.
(function(root){'use strict';
if(!root.chrome?.alarms||!root.TheCycleAlarmScheduler)return;
let inFlight=null;
async function performBackupOnce(){

  // A document context must supply the authorized directory handle and
  // perform the actual readback-verified backup. Never silently mark success.
  const configured=await root.chrome.storage.local.get('thecycleBackupEnabled');
  if(configured.thecycleBackupEnabled!==true)throw new Error('BACKUP_NOT_ENABLED');
  const modules=[root.TheCycleDirectoryHandleManager,root.TheCycleStateStore,
    root.TheCycleDirectorySink,root.TheCycleBackup];
  if(modules.some(x=>!x))throw new Error('THECYCLE_BACKUP_MODULES_MISSING');
  const manager=await root.TheCycleDirectoryHandleManager.createDirectoryHandleManager();
  let store;
  try{
    const directory=await manager.load('thecycle-backups');
    store=await root.TheCycleStateStore.createStateStore();
    const sink=root.TheCycleDirectorySink.createDirectorySink({directory});
    const backup=root.TheCycleBackup.createBackupService({store,sink});
    const key='thecycle-alarm-'+Date.now()+'-'+root.crypto.randomUUID().replace(/-/g,'');
    const result=await backup.save(key);
    if(result.verified!==true)throw new Error('THECYCLE_BACKUP_UNVERIFIED');
    await root.chrome.storage.local.set({thecycleBackupStatus:{
      state:'VERIFIED',key,sha256:result.sha256,at:Date.now()
    }});
    return {key,sha256:result.sha256};
  }finally{store?.close();manager.close();}
}
function performBackup(){
 if(inFlight)return inFlight;
 inFlight=performBackupOnce().finally(()=>{inFlight=null;});
 return inFlight;
}
const scheduler=root.TheCycleAlarmScheduler.createAlarmScheduler({
 alarms:root.chrome.alarms,
 onBackupDue:performBackup,
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
root.chrome.alarms.onAlarm.addListener(alarm=>{
 void scheduler.dispatch(alarm).catch(error=>console.error('[TheCycle alarm]',error));
});
root.chrome.runtime.onInstalled.addListener(()=>{void scheduler.register().catch(console.error);});
root.chrome.runtime.onStartup.addListener(()=>{void scheduler.register().catch(console.error);});
void scheduler.register().catch(console.error);
})(self);
