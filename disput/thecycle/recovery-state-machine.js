// Durable recovery phases; caller persists transitions before side effects.
(function(root){'use strict';
const transitions={
 IDLE:['QUIESCING'], QUIESCING:['VERIFYING','BLOCKED'],
 VERIFYING:['RESTORING','BLOCKED'], RESTORING:['VALIDATING','BLOCKED'],
 VALIDATING:['AWAITING_ACTIVATION','BLOCKED'],
 AWAITING_ACTIVATION:['ACTIVATING','BLOCKED'],
 ACTIVATING:['PAUSED','BLOCKED'], PAUSED:['QUIESCING'], BLOCKED:['QUIESCING']
};
function createRecoveryStateMachine({repository}={}){
 if(!repository||typeof repository.load!=='function'||typeof repository.compareAndSet!=='function')
  throw new Error('RECOVERY_REPOSITORY_REQUIRED');
 async function transition(id,expectedRevision,to,details={}){
  if(typeof id!=='string'||!id||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)
   throw new Error('INVALID_RECOVERY_TRANSITION');
  const current=await repository.load(id)||{phase:'IDLE',revision:0};
  if(current.revision!==expectedRevision)throw new Error('RECOVERY_STALE_REVISION');
  if(!(transitions[current.phase]||[]).includes(to))throw new Error('RECOVERY_ILLEGAL_TRANSITION');
  const next={...current,phase:to,revision:current.revision+1,details};
  if(await repository.compareAndSet(id,expectedRevision,next)!==true)throw new Error('RECOVERY_CONFLICT');
  return next;
 }
 return Object.freeze({transition,load:id=>repository.load(id)});
}
const api=Object.freeze({createRecoveryStateMachine,transitions});
root.TheCycleRecoveryStateMachine=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
