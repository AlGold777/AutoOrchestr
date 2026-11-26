// Only verified, non-protected backups can be proposed for deletion.
// Deletion itself is intentionally a separate, audited operation.
(function(root){'use strict';
function planRetention({records,keep=10,protectedKeys=[]}={}){
 if(!Array.isArray(records)||!Array.isArray(protectedKeys)||
 !Number.isSafeInteger(keep)||keep<2)throw new Error('RETENTION_INPUT_INVALID');
 const protectedSet=new Set(protectedKeys);
 const sorted=[...records].sort((a,b)=>b.createdAt-a.createdAt);
 const retained=new Set(sorted.slice(0,keep).map(x=>x.key));
 const deleteCandidates=[];
 for(const r of sorted){
  if(!r||typeof r.key!=='string'||!Number.isSafeInteger(r.createdAt))
   throw new Error('RETENTION_RECORD_INVALID');
  if(!retained.has(r.key)&&!protectedSet.has(r.key)&&r.verified===true&&
    r.active!==true&&r.pendingCommit!==true)deleteCandidates.push(r.key);
 }
 return Object.freeze({deleteCandidates,requiresExplicitApproval:true});
}
const api=Object.freeze({planRetention});
root.TheCycleBackupRetention=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
