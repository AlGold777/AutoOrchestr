// Backup catalog backed by caller-provided durable compare-and-set repository.
(function(root){'use strict';
function createBackupCatalog({repository}={}){
 if(!repository||typeof repository.get!=='function'||typeof repository.putIfAbsent!=='function'||
 typeof repository.list!=='function')throw new Error('CATALOG_REPOSITORY_INVALID');
 const hex=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
 async function register(record){
  if(!record||typeof record.key!=='string'||!record.key||
   typeof record.researchId!=='string'||!record.researchId||
   !hex(record.sha256)||!Number.isSafeInteger(record.createdAt)||record.createdAt<0||
   record.verified!==true)throw new Error('CATALOG_RECORD_INVALID');
  const saved=Object.freeze({...record});
  if(await repository.putIfAbsent(saved.key,saved)!==true)throw new Error('CATALOG_DUPLICATE');
  return saved;
 }
 return Object.freeze({register,get:key=>repository.get(key),
  list:researchId=>repository.list(researchId)});
}
const api=Object.freeze({createBackupCatalog});
root.TheCycleBackupCatalog=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
