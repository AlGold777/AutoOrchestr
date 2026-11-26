// Rotation of directory backups. Only verified, non-protected copies are ever deleted.
// planRetention builds the candidate list; createRetention applies it after every fully verified copy.
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
const LEDGER_KEY='thecycleBackupLedger';
const validEntry=e=>e&&typeof e.key==='string'&&Number.isSafeInteger(e.createdAt);
const codeOf=e=>String(e?.code||e?.name||e?.message||e).slice(0,200);
// Ledger = copies that passed the full check (readback, hash and, for the gate, the required packet).
// A file that is not in the ledger is never deleted; an unknown file is adopted only after verifyBackup.
// Protected: the last confirmed copy (gate lastBackupId) of every research that is not finished or is unknown
// to the active database, plus the copy just written. Failures are reported through onEvent and never thrown.
function createRetention({sink,store,metadata,storage,keep=10,clock=()=>Date.now(),onEvent=async()=>{},
 ledgerKey=LEDGER_KEY,adoptLimit=20}={}){
 if(!sink||typeof sink.list!=='function'||typeof sink.remove!=='function'||typeof sink.get!=='function'||
  !storage?.get||!storage?.set||!Number.isSafeInteger(keep)||keep<2)throw new Error('RETENTION_DEPENDENCIES_MISSING');
 let queue=Promise.resolve();
 const note=async(type,data)=>{try{await onEvent(type,data);}catch(_){}};
 async function readLedger(){
  const value=(await storage.get(ledgerKey))?.[ledgerKey];
  return Array.isArray(value)?value.filter(validEntry):[];
 }
 async function protectedKeys(){
  if(!metadata||typeof metadata.list!=='function')throw new Error('RETENTION_NO_PROTECTION_INFO');
  const keys=[];
  for(const row of await metadata.list()){
   if(!row?.lastBackupId)continue;
   let protect=true;
   try{
    const state=await store.load(row.researchId);
    if(state.phase==='COMPLETED'&&!state.activeRunId&&(state.backupRequiredCycleId===null||state.backupRequiredCycleId===undefined))protect=false;
   }catch(_){protect=true;}
   if(protect)keys.push(row.lastBackupId);
  }
  return keys;
 }
 async function run(entry){
  const fresh={key:entry.key,createdAt:Number.isSafeInteger(entry.createdAt)?entry.createdAt:clock(),sha256:entry.sha256||null};
  let ledger=(await readLedger()).filter(e=>e.key!==fresh.key);
  ledger.push(fresh);
  let files;
  try{files=await sink.list();}
  catch(error){
   await storage.set({[ledgerKey]:ledger});
   await note('RETENTION_SKIPPED',{retention:{key:fresh.key,skipReason:'LISTING_FAILED',code:codeOf(error)}});
   return {ok:false,skipped:'LISTING_FAILED'};
  }
  const modified=new Map(files.map(f=>[f.key,f.lastModified]));
  ledger=ledger.filter(e=>modified.has(e.key)||e.key===fresh.key);
  if(store&&typeof store.verifyBackup==='function'){
   const known=new Set(ledger.map(e=>e.key));
   const unknown=files.filter(f=>!known.has(f.key)).sort((a,b)=>b.lastModified-a.lastModified).slice(0,adoptLimit);
   for(const file of unknown){
    try{
     const envelope=await sink.get(file.key);
     if(!envelope)continue;
     await store.verifyBackup(envelope);
     ledger.push({key:file.key,createdAt:Number.isSafeInteger(file.lastModified)?file.lastModified:0,sha256:envelope.sha256,adopted:true});
    }catch(error){await note('RETENTION_UNVERIFIED_SKIPPED',{retention:{key:file.key,code:codeOf(error)}});}
   }
  }
  await storage.set({[ledgerKey]:ledger});
  let protectedList;
  try{protectedList=await protectedKeys();}
  catch(error){
   await note('RETENTION_SKIPPED',{retention:{key:fresh.key,skipReason:'PROTECTION_UNKNOWN',code:codeOf(error),keep,verifiedTotal:ledger.length}});
   return {ok:false,skipped:'PROTECTION_UNKNOWN'};
  }
  const protectedSet=new Set([...protectedList,fresh.key]);
  const plan=planRetention({keep,protectedKeys:[...protectedSet],
   records:ledger.map(e=>({key:e.key,createdAt:e.createdAt,verified:true,active:e.key===fresh.key,pendingCommit:false}))});
  const deleted=[],failed=[];
  for(const key of plan.deleteCandidates){
   try{
    await sink.remove(key);deleted.push(key);
    await note('RETENTION_DELETED',{retention:{key}});
   }catch(error){
    failed.push({key,code:codeOf(error)});
    await note('RETENTION_DELETE_FAILED',{retention:{key,code:codeOf(error)}});
   }
  }
  if(deleted.length){
   const gone=new Set(deleted);
   await storage.set({[ledgerKey]:ledger.filter(e=>!gone.has(e.key))});
  }
  await note('RETENTION_DONE',{retention:{key:fresh.key,keep,verifiedTotal:ledger.length-deleted.length,
   candidateCount:plan.deleteCandidates.length,protectedCount:protectedSet.size,deleted,failed}});
  return {ok:failed.length===0,deleted,failed};
 }
 function afterVerified(entry){
  if(!entry||typeof entry.key!=='string')return Promise.resolve({ok:false,skipped:'INVALID_ENTRY'});
  const operation=queue.then(()=>run(entry));
  queue=operation.catch(()=>{});
  return operation.catch(async error=>{
   await note('RETENTION_ERROR',{retention:{key:entry.key,code:codeOf(error)},error});
   return {ok:false,error:codeOf(error)};
  });
 }
 return Object.freeze({afterVerified});
}
const api=Object.freeze({planRetention,createRetention,LEDGER_KEY});
root.TheCycleBackupRetention=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
