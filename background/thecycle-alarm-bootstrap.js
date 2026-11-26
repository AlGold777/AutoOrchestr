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
  await root.chrome.storage.local.set({thecycleBackupStatus:{
   state:'ACTION_REQUIRED',reason:'DOCUMENT_BACKUP_RUNTIME_NOT_ATTACHED',at:Date.now()
  }});
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
