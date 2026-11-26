// Centralized active-database resolution. Every writer must resolve the same
// activation pointer; direct access to the default DB is legacy-only.
(function(root){'use strict';
const valid=name=>typeof name==='string'&&
 /^auto-orchestr-thecycle(?:-restore-[a-zA-Z0-9_-]{8,})?$/.test(name);
async function createActiveStateStore({indexedDB=root.indexedDB}={}){
 if(!root.TheCycleRecoveryRepositories?.createRecoveryRepositories||
    !root.TheCycleStateStore?.createStateStore)
  throw new Error('ACTIVE_STORE_DEPENDENCIES_MISSING');
 const repositories=await root.TheCycleRecoveryRepositories.createRecoveryRepositories({indexedDB});
 let store;
 try{
  const pointer=await repositories.activation.read();
  if(!pointer||!Number.isSafeInteger(pointer.revision)||pointer.revision<0||
     !valid(pointer.activeDatabase))throw new Error('ACTIVE_DATABASE_POINTER_INVALID');
  store=await root.TheCycleStateStore.createStateStore({indexedDB,name:pointer.activeDatabase});
  const after=await repositories.activation.read();
  if(after.revision!==pointer.revision||after.activeDatabase!==pointer.activeDatabase)
   throw new Error('ACTIVE_DATABASE_CHANGED_DURING_OPEN');
  return Object.freeze({store,database:pointer.activeDatabase,revision:pointer.revision,
   close:()=>{store.close();repositories.close();}});
 }catch(error){store?.close();repositories.close();throw error;}
}
const api=Object.freeze({createActiveStateStore});
root.TheCycleActiveStateStore=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
