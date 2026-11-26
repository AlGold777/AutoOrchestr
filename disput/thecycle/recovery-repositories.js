// Durable CAS repositories for TheCycle recovery and activation.
// All mutations occur in one IndexedDB readwrite transaction.
(function(root){'use strict';
const DB='auto-orchestr-thecycle-recovery-meta';
const req=r=>new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error||new Error('RECOVERY_IDB_FAILED'));});
async function createRecoveryRepositories({indexedDB=root.indexedDB}={}){
 if(!indexedDB?.open)throw new Error('RECOVERY_IDB_UNAVAILABLE');
 const db=await new Promise((ok,no)=>{
  const r=indexedDB.open(DB,1);
  r.onupgradeneeded=()=>{for(const name of ['sessions','activation'])if(!r.result.objectStoreNames.contains(name))r.result.createObjectStore(name,{keyPath:'id'});};
  r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error||new Error('RECOVERY_DB_FAILED'));
  r.onblocked=()=>no(new Error('RECOVERY_DB_BLOCKED'));
 });
 db.onversionchange=()=>db.close();
 async function transact(name,mode,fn){
  const tx=db.transaction(name,mode),store=tx.objectStore(name);
  const done=new Promise((ok,no)=>{tx.oncomplete=ok;tx.onabort=()=>no(tx.error||new Error('RECOVERY_TX_ABORTED'));});
  done.catch(()=>{});
  try{const result=await fn(store);await done;return result;}
  catch(e){try{tx.abort();}catch(_){}throw e;}
 }
 const sessions=Object.freeze({
  load:id=>transact('sessions','readonly',async s=>{const row=await req(s.get(id));return row?.value||null;}),
  compareAndSet:(id,revision,next)=>transact('sessions','readwrite',async s=>{
   const row=await req(s.get(id));const old=row?.value||{phase:'IDLE',revision:0};
   if(old.revision!==revision)return false;
   await req(s.put({id,value:next}));return true;
  })
 });
 const activation=Object.freeze({
  read:()=>transact('activation','readonly',async s=>{
   const row=await req(s.get('active'));return row?.value||{revision:0,activeDatabase:'auto-orchestr-thecycle'};
  }),
  compareAndSet:(revision,next)=>transact('activation','readwrite',async s=>{
   const row=await req(s.get('active'));const old=row?.value||{revision:0,activeDatabase:'auto-orchestr-thecycle'};
   if(old.revision!==revision)return false;
   await req(s.put({id:'active',value:next}));return true;
  })
 });
 return Object.freeze({sessions,activation,close:()=>db.close()});
}
const api=Object.freeze({createRecoveryRepositories});
root.TheCycleRecoveryRepositories=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
