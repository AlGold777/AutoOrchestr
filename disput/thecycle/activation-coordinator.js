// Refuse activation while a runtime has not explicitly released its writer
// lease. Activation is an administrative action, not an automatic recovery step.
(function(root){'use strict';
function createActivationCoordinator({registry,inspectDatabase,verifyQuiescence,
 activeWriters,activationManager=root.TheCycleDatabaseActivation}={}){
 if(!registry||typeof activeWriters!=='function'||!activationManager?.createDatabaseActivationManager)
  throw new Error('ACTIVATION_COORDINATOR_DEPENDENCIES_INVALID');
 const manager=activationManager.createDatabaseActivationManager({
  registry,inspectDatabase,verifyQuiescence:async()=>{
   const writers=await activeWriters();
   if(writers!==0)throw new Error('ACTIVATION_WRITERS_PRESENT');
   const evidence=await verifyQuiescence();
   if(evidence?.verified!==true||evidence?.quiescent!==true||
      typeof evidence.source!=='string'||!evidence.source||
      typeof evidence.reference!=='string'||!evidence.reference)
    throw new Error('ACTIVATION_TRANSPORT_UNVERIFIED');
   return evidence;
  }
 });
 return Object.freeze({activate:options=>manager.activate(options)});
}
const api=Object.freeze({createActivationCoordinator});
root.TheCycleActivationCoordinator=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
