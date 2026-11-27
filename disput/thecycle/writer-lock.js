// TheCycle: Web Lock between the pages that write the active database and the restore that switches it.
(function(root){'use strict';
const NAME='auto-orchestr-thecycle-writer';
function createWriterLock({locks=root.navigator?.locks}={}){
 // Resolves to a release function, or null when the other side holds the lock. Never waits in a queue.
 const take=mode=>new Promise((ok,no)=>{
  let free;
  const held=new Promise(done=>{free=done;});
  const request=locks.request(NAME,{mode,ifAvailable:true},async lock=>{
   if(!lock){ok(null);return;}
   ok(async()=>{free();await request;});
   await held;
  });
  request.catch(no);
 });
 return Object.freeze({
  // A running research. Without Web Locks (tests outside a browser) there is nothing to guard against.
  shared:()=>locks?.request?take('shared'):Promise.resolve(async()=>{}),
  // The restore fails closed without Web Locks.
  exclusive:()=>locks?.request?take('exclusive'):Promise.reject(Error('THECYCLE_LOCKS_UNAVAILABLE'))
 });
}
const api=Object.freeze({createWriterLock});
root.TheCycleWriterLock=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
