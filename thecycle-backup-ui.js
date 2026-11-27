'use strict';
const message=document.getElementById('message'),status=document.getElementById('status');
async function refresh(){
 const value=await chrome.storage.local.get(['thecycleBackupEnabled','thecycleBackupStatus']);
 status.textContent=JSON.stringify(value,null,2);
}
async function action(work){
 message.className='';message.textContent='';
 try{await work();await refresh();}
 catch(error){message.className='error';message.textContent=String(error?.message||error);}
}
document.getElementById('choose').addEventListener('click',()=>action(async()=>{
 await TheCycleBackupSetup.configureBackupDirectory();
 message.textContent='Каталог сохранён. Резервирование включено.';
}));
document.getElementById('disable').addEventListener('click',()=>action(async()=>{
 await chrome.storage.local.set({thecycleBackupEnabled:false});
 message.textContent='Резервирование отключено.';
}));
document.getElementById('run').addEventListener('click',()=>action(async()=>{
 const manager=await TheCycleDirectoryHandleManager.createDirectoryHandleManager();
 let store,registry;
 try{
  registry=await TheCycleRecoveryRepositories.createRecoveryRepositories();
  const pointer=await registry.activation.read();
  const directory=await manager.load('thecycle-backups');
  store=await TheCycleStateStore.createStateStore({name:pointer.activeDatabase});
  const sink=TheCycleDirectorySink.createDirectorySink({directory});
  const service=TheCycleBackup.createBackupService({store,sink});
  const key='thecycle-manual-'+Date.now()+'-'+crypto.randomUUID().replace(/-/g,'');
  const result=await service.save(key);
  if(!result.verified)throw new Error('BACKUP_UNVERIFIED');
  await chrome.storage.local.set({thecycleBackupStatus:{
   state:'VERIFIED',key,sha256:result.sha256,database:pointer.activeDatabase,at:Date.now()
  }});
  message.textContent='Резервная копия проверена: '+result.key;
 }catch(error){
  await chrome.storage.local.set({thecycleBackupStatus:{
   state:'FAILED',reason:String(error?.message||error),at:Date.now()
  }});
  throw error;
 }finally{store?.close();registry?.close();manager.close();}
}));
document.getElementById('refresh').addEventListener('click',()=>action(async()=>{}));
void refresh().catch(error=>{message.textContent=String(error);});

document.getElementById('inspect').addEventListener('click',()=>action(async()=>{
 const key=document.getElementById('backup-key').value.trim();
 const result=await TheCycleBackupInspector.inspectBackup({key});
 document.getElementById('inspection').textContent=JSON.stringify(result,null,2);
 message.textContent='Целостность и структура копии подтверждены. Активация заблокирована.';
}));
