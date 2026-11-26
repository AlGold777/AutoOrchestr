// MV3 bootstrap: register the TheCycle alarm, but do not claim a backup
// until a persistent directory handle and research runtime are configured.
(function(root){'use strict';
if(!root.chrome?.alarms||!root.TheCycleAlarmScheduler)return;
const scheduler=root.TheCycleAlarmScheduler.createAlarmScheduler({
 alarms:root.chrome.alarms,
 onBackupDue:async()=>{
  // A document context must supply the authorized directory handle and
  // perform the actual readback-verified backup. Never silently mark success.
  const configured=await root.chrome.storage.local.get('thecycleBackupEnabled');
  if(configured.thecycleBackupEnabled!==true)return;
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
  }finally{store?.close();manager.close();}
 },
 onFailure:async error=>{
  await root.chrome.storage.local.set({thecycleBackupStatus:{
   state:'FAILED',reason:String(error?.message||error),at:Date.now()
  }});
 }
});
root.chrome.alarms.onAlarm.addListener(alarm=>{
 void scheduler.dispatch(alarm).catch(error=>console.error('[TheCycle alarm]',error));
});
root.chrome.runtime.onInstalled.addListener(()=>{void scheduler.register().catch(console.error);});
root.chrome.runtime.onStartup.addListener(()=>{void scheduler.register().catch(console.error);});
void scheduler.register().catch(console.error);
})(self);
