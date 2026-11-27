// TheCycle: one-action restore from a verified file copy. Composes the existing restore, activation and backup components.
// A failure leaves the active database as it was; the source database is never deleted.
(function(root){'use strict';
const HB_PREFIX='thecycle.circle.heartbeat.',HB_FRESH_MS=180000;
const PENDING_KEY='thecycle.circle.pending',ACTIVATION_KEY='thecycle.activation';
const RESTORED_PHASES=['PAUSED','RECONCILE','COMPLETED'];
const fail=(code,cause)=>Object.assign(Error(code),{code,...(cause?{cause}:{})});
// True when this browser has recorded something the copy does not (a research, a sent request or its answer, a close, a raised
// budget, a human decision): switching to the copy would lose it, and the request could be sent again. State versions are not
// compared: restore and takeover raise them.
function activeIsNewer(active,copy){
 const saved=new Map(copy.stores.research.map(row=>[row.researchId,row]));
 const eventId=row=>JSON.stringify([row.researchId,row.runId,row.eventId]);
 const events=new Set(copy.stores.events.map(eventId));
 // Budget changes and decisions of one research, as comparable records: what the active database holds must all be in the copy.
 const records=(research,packets)=>{
  const out=new Set();
  for(const change of research.budgetHistory||[])out.add('budget:'+JSON.stringify(change));
  if(research.lastDecision)out.add('decision:'+JSON.stringify(research.lastDecision));
  for(const packet of packets.filter(row=>row.researchId===research.researchId)){
   for(const decision of packet.decisionHistory||[])out.add('decision:'+JSON.stringify([packet.cycleId,decision]));
   if(packet.decision)out.add('decision:'+JSON.stringify([packet.cycleId,packet.decision]));
  }
  return out;
 };
 const packetKey=row=>JSON.stringify([row.researchId,row.cycleId]);
 const packets=new Set(copy.stores.packets.map(packetKey));
 return active.stores.research.some(local=>{
   const saved_=saved.get(local.researchId);
   if(!saved_||(local.phase==='COMPLETED'&&saved_.phase!=='COMPLETED'))return true;
   if(Number(local.budget?.maxCalls)>Number(saved_.budget?.maxCalls))return true;
   const known=records(saved_,copy.stores.packets);
   for(const record of records(local,active.stores.packets))if(!known.has(record))return true;
   return false;
  })||
  active.stores.events.some(local=>!events.has(eventId(local)))||
  active.stores.packets.some(local=>!packets.has(packetKey(local)));
}
// A sent request whose outcome the copy does not know: the person chooses what to do with it on the Circle page.
const hasUnknownRequest=snapshot=>snapshot.stores.research.some(research=>research.phase!=='COMPLETED'&&
 snapshot.stores.runs.some(run=>run.researchId===research.researchId&&run.runId===research.activeRunId&&
  run.batches.some(batch=>['INTENT','UNKNOWN'].includes(batch.status))));

async function restoreFromCopy({backupKey,directory,storage=root.chrome?.storage?.local,indexedDB=root.indexedDB,
 writerLock=root.TheCycleWriterLock?.createWriterLock(),uuid=()=>root.crypto.randomUUID(),now=()=>Date.now(),
 telemetry=root.TheCycleTelemetry}={}){
 if(typeof backupKey!=='string'||!backupKey||!directory||!storage?.get||!storage?.set||!indexedDB||!writerLock)
  throw fail('RESTORE_PRECONDITION_FAILED');
 const emit=async(type,data)=>{try{await telemetry?.append(type,data);}catch(_){}};
 // Held for the whole restore: no research of any page of this extension can start or continue meanwhile.
 const release=await writerLock.exclusive();
 if(!release)throw fail('RESTORE_TRANSPORT_BUSY');
 const opened=[];
 const open=async handle=>{const value=await handle;opened.push(value);return value;};
 try{
  // Observed transport state: no page holds the writer lock (above) and no research heartbeat is fresh.
  const observeTransport=async()=>{
   const all=await storage.get(null);
   const fresh=Object.entries(all||{}).filter(([key,beat])=>key.startsWith(HB_PREFIX)&&beat?.ownerId&&
    Number.isFinite(beat.at)&&now()-beat.at<HB_FRESH_MS);
   return {verified:true,quiescent:fresh.length===0,source:'thecycle-observed-transport',
    reference:'writer-lock:exclusive;fresh-heartbeats:'+fresh.length+';at:'+now()};
  };
  if(!(await observeTransport()).quiescent)throw fail('RESTORE_TRANSPORT_BUSY');
  const repositories=await open(root.TheCycleRecoveryRepositories.createRecoveryRepositories({indexedDB}));
  const pointer=await repositories.activation.read();
  const source=await open(root.TheCycleStateStore.createStateStore({indexedDB,name:pointer.activeDatabase}));
  await emit('RESTORE_START',{database:pointer.activeDatabase,backup:{key:backupKey}});
  // An empty copy would hide the researches of this browser behind an empty database.
  const sink=root.TheCycleDirectorySink.createDirectorySink({directory});
  const service=root.TheCycleBackup.createBackupService({store:source,sink});
  // The copy file is read once: the same verified envelope is checked, compared and written into the new database.
  const envelope=await service.getVerifiedEnvelope(backupKey);
  const content=await source.verifyBackup(envelope);
  const info={sha256:envelope.sha256,counts:Object.fromEntries(Object.entries(content.stores).map(([name,rows])=>[name,rows.length]))};
  if(!info.counts.research)throw fail('RESTORE_COPY_EMPTY');
  if(activeIsNewer(await source.exportSnapshot(),content))throw fail('RESTORE_ACTIVE_NEWER');
  // Integrity and compatibility, a new database, written rows read back: all inside the recovery runtime.
  const targetName='auto-orchestr-thecycle-restore-'+String(uuid()).replace(/[^a-zA-Z0-9_-]/g,'');
  const restored=await root.TheCycleRecoveryRuntime.recover({directory,stateStore:source,indexedDB,backupKey,targetName,envelope,
   verifyTransportQuiescence:observeTransport});
  const target=await open(root.TheCycleStateStore.createStateStore({indexedDB,name:targetName}));
  const researches=await target.listResearch();
  // The backup gate's records are shared by all databases: a pending packet of a later state would block the restored one
  // for ever. They restart from this copy, which also protects it from rotation.
  const metadata=await open(root.TheCycleGateMetadata.createGateMetadata({indexedDB}));
  const replaced=[];
  const putRecord=async(researchId,record)=>{
   const current=await metadata.get(researchId);
   const revision=current?.revision||0;
   if(await metadata.put(researchId,revision,{...record,researchId,revision:revision+1})!==true)
    throw fail('RESTORE_BACKUP_METADATA_CONFLICT');
   return current;
  };
  const fresh={pendingCommitIds:[],lastVerifiedAt:null,lastBackupId:backupKey,verifiedCommitId:null,blocked:true};
  let next;
  try{
   for(const {researchId} of researches){
    const before=await putRecord(researchId,fresh);
    if(before)replaced.push(before);
   }
   next=await root.TheCycleActivationCoordinator.createActivationCoordinator({
    registry:repositories.activation,
    activeWriters:async()=>0, // the exclusive writer lock is held
    verifyQuiescence:observeTransport,
    inspectDatabase:async name=>{
     if(name!==targetName)return null;
     const rows=await target.listResearch();
     const owner=await target.getOwnership();
     return {verified:rows.length===restored.researchCount,paused:rows.every(row=>RESTORED_PHASES.includes(row.phase)),
      hasActiveOwner:Boolean(owner?.ownerId)};
    }
   }).activate({targetName,expectedRevision:pointer.revision});
  }catch(error){
   // Nothing was switched: the active database keeps its own backup records.
   for(const record of replaced){try{await putRecord(record.researchId,record);}catch(_){}}
   throw error;
  }
  // The database is switched from here on; the page signals below never turn a finished restore into a failure.
  const unfinished=researches.filter(row=>row.phase!=='COMPLETED');
  const subject=unfinished.find(row=>backupKey.includes(row.researchId))||unfinished[0]||
   researches.find(row=>backupKey.includes(row.researchId))||researches[0];
  try{
   await storage.set({
    'thecycle.circle.latest':subject.researchId,
    [PENDING_KEY]:unfinished.length?{researchId:subject.researchId,phase:subject.phase,at:now()}:null,
    [ACTIVATION_KEY]:{revision:next.revision,activeDatabase:next.activeDatabase,researchId:subject.researchId,at:now()}
   });
  }catch(_){}
  await emit('RESTORE_ACTIVATED',{database:targetName,backup:{key:backupKey,sha256:info.sha256,verified:true}});
  return {backupKey,database:targetName,previousDatabase:pointer.activeDatabase,revision:next.revision,
   researchCount:restored.researchCount,researchId:subject.researchId,
   requiresManualReconciliation:hasUnknownRequest(content)};
 }catch(error){
  await emit('RESTORE_REFUSED',{backup:{key:backupKey},error});
  throw error;
 }finally{
  for(const handle of opened.reverse()){try{handle.close?.();}catch(_){}}
  await release();
 }
}
// Copies of the chosen directory, newest first. A damaged copy stays in the list and is marked.
async function listCopies({directory,store}){
 const sink=root.TheCycleDirectorySink.createDirectorySink({directory});
 const service=root.TheCycleBackup.createBackupService({store,sink});
 const files=(await sink.list()).sort((a,b)=>b.lastModified-a.lastModified);
 const copies=[];
 for(const {key,lastModified} of files){
  try{copies.push({key,lastModified,researchCount:(await service.inspect(key)).counts.research});}
  catch(error){
   const code=String(error?.code||error?.message||error);
   if(code==='BACKUP_DIRECTORY_PERMISSION_REQUIRED')throw error;
   copies.push({key,lastModified,damaged:code});
  }
 }
 return copies;
}
const api=Object.freeze({restoreFromCopy,listCopies});
root.TheCycleRestoreFlow=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
