// Activation uses an atomic pointer CAS. Requires paused verified target and no live owner.
(function(root){'use strict';
const valid=n=>typeof n==='string'&&/^auto-orchestr-thecycle-restore-[a-zA-Z0-9_-]{8,}$/.test(n);
function createDatabaseActivationManager({registry,inspectDatabase,verifyQuiescence}={}){
 if(!registry||typeof registry.read!=='function'||typeof registry.compareAndSet!=='function'||
 typeof inspectDatabase!=='function'||typeof verifyQuiescence!=='function')
 throw new Error('ACTIVATION_DEPENDENCIES_INVALID');
 async function activate({targetName,expectedRevision}={}){
  if(!valid(targetName)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)
   throw new Error('ACTIVATION_INPUT_INVALID');
  const [current,inspection,quiescence]=await Promise.all([
   registry.read(),inspectDatabase(targetName),verifyQuiescence()]);
  if(current?.revision!==expectedRevision)throw new Error('ACTIVATION_STALE_POINTER');
  if(!inspection||inspection.verified!==true||inspection.paused!==true||
    inspection.hasActiveOwner!==false||quiescence?.quiescent!==true||
    quiescence?.verified!==true)throw new Error('ACTIVATION_UNSAFE');
  const next={revision:expectedRevision+1,activeDatabase:targetName};
  if(await registry.compareAndSet(expectedRevision,next)!==true)
   throw new Error('ACTIVATION_CONFLICT');
  return next;
 }
 return Object.freeze({activate});
}
const api=Object.freeze({createDatabaseActivationManager});
root.TheCycleDatabaseActivation=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
