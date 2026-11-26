// Invoke from an extension document in response to a user gesture.
// The service worker can reuse the persisted handle but cannot show a picker.
(function(root){'use strict';
async function configureBackupDirectory({picker=root.showDirectoryPicker,
 indexedDB=root.indexedDB,storage=root.chrome?.storage?.local}={}){
 if(typeof picker!=='function'||!storage?.set)throw new Error('BACKUP_SETUP_UNAVAILABLE');
 const directory=await picker({mode:'readwrite'});
 if(await directory.queryPermission({mode:'readwrite'})!=='granted'){
  if(typeof directory.requestPermission!=='function'||
   await directory.requestPermission({mode:'readwrite'})!=='granted')
   throw new Error('BACKUP_DIRECTORY_PERMISSION_REQUIRED');
 }
 const manager=await root.TheCycleDirectoryHandleManager.createDirectoryHandleManager({indexedDB});
 try{
  await manager.save('thecycle-backups',directory);
  // Enabling only after the durable handle is saved.
  await storage.set({thecycleBackupEnabled:true});
  return {configured:true};
 }finally{manager.close();}
}
const api=Object.freeze({configureBackupDirectory});
root.TheCycleBackupSetup=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
