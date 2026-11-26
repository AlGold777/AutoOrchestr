// Fail-closed evidence validation. UNKNOWN is never treated as NOT_SENT.
(function(root){'use strict';
function reconcile({run,batches,evidence,ownerEpoch}={}){
 if(!run||!Array.isArray(batches)||!Array.isArray(evidence)||
    !Number.isSafeInteger(ownerEpoch)||ownerEpoch<1)throw new Error('RECONCILE_INPUT_INVALID');
 const ids=new Set(),out=[];
 for(const batch of batches){
  if(!batch||typeof batch.batchId!=='string'||!batch.batchId||ids.has(batch.batchId))
   throw new Error('RECONCILE_BATCH_INVALID');
  ids.add(batch.batchId);
  const matching=evidence.filter(e=>e&&e.runId===run.runId&&e.batchId===batch.batchId&&
    e.ownerEpoch===ownerEpoch&&typeof e.source==='string'&&e.source&&
    typeof e.reference==='string'&&e.reference);
  if(matching.length!==1||!['RESPONSE','NOT_SENT'].includes(matching[0].status)||
    matching[0].verified!==true){
   out.push({batchId:batch.batchId,status:'UNKNOWN'});continue;
  }
  out.push({batchId:batch.batchId,status:matching[0].status,evidence:matching[0]});
 }
 return Object.freeze({resolved:out.every(x=>x.status!=='UNKNOWN'),batches:out,
   mayResume:false}); // never auto-resend, even if all batches resolved
}
const api=Object.freeze({reconcile});
root.TheCycleTransportReconciliation=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
