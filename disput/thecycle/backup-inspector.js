// Read-only recovery inspection. No restore or activation without transport proof.
(function(root){'use strict';
async function inspectBackup({key,indexedDB=root.indexedDB}={}){
 if(typeof key!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,180}$/.test(key))
  throw new Error('INVALID_BACKUP_KEY');
 const required=[root.TheCycleDirectoryHandleManager,root.TheCycleDirectorySink,
 root.TheCycleBackup,root.TheCycleStateStore,root.TheCycleRestore,
 root.TheCycleRecoveryRepositories];
 if(required.some(x=>!x))throw new Error('RECOVERY_MODULES_MISSING');
 const handles=await root.TheCycleDirectoryHandleManager.createDirectoryHandleManager({indexedDB});
 let store,registry;
 try{
  registry=await root.TheCycleRecoveryRepositories.createRecoveryRepositories({indexedDB});
  const pointer=await registry.activation.read();
  const directory=await handles.load('thecycle-backups');
  store=await root.TheCycleStateStore.createStateStore({indexedDB,name:pointer.activeDatabase});
  const sink=root.TheCycleDirectorySink.createDirectorySink({directory});
  const service=root.TheCycleBackup.createBackupService({store,sink});
  const envelope=await service.getVerifiedEnvelope(key);
  const snapshot=root.TheCycleRestore.validate(await store.verifyBackup(envelope));
  return Object.freeze({key,sha256:envelope.sha256,activeDatabase:pointer.activeDatabase,
   researchCount:snapshot.stores.research.length,
   pendingRuns:snapshot.stores.research.filter(s=>s.activeRunId!==null).length,
   counts:Object.fromEntries(Object.entries(snapshot.stores).map(([k,v])=>[k,v.length])),
   canActivate:false,reason:'TRANSPORT_QUIESCENCE_NOT_VERIFIED'});
 }finally{store?.close();registry?.close();handles.close();}
}
const api=Object.freeze({inspectBackup});
root.TheCycleBackupInspector=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
