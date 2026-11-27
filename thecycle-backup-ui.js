'use strict';
const message=document.getElementById('message'),status=document.getElementById('status');
const copySelect=document.getElementById('restore-copy'),restoreButton=document.getElementById('restore');
async function refresh(){
 const value=await chrome.storage.local.get(['thecycleBackupEnabled','thecycleBackupStatus']);
 status.textContent=JSON.stringify(value,null,2);
}
async function action(work){
 message.className='';message.textContent='';
 try{await work();await refresh();}
 catch(error){message.className='error';message.textContent=String(error?.message||error);}
}
const emit=async(type,data)=>{try{await window.TheCycleTelemetry?.append(type,data);}catch(_){}};
const NO_DIRECTORY='Нет доступа к каталогу копий. Разрешите доступ или выберите каталог заново.';
// The first await of a click: requestPermission needs the user gesture.
async function requireDirectoryAccess(source){
 const access=await TheCycleDirectoryHandleManager.restoreBackupDirectoryAccess({source});
 if(!access.ok)throw new Error(NO_DIRECTORY);
}
async function loadDirectory(){
 const manager=await TheCycleDirectoryHandleManager.createDirectoryHandleManager();
 try{return await manager.load('thecycle-backups');}finally{manager.close();}
}
const two=value=>String(value).padStart(2,'0');
const localTime=ms=>{
 const date=new Date(ms);
 return `${date.getFullYear()}-${two(date.getMonth()+1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
};
// Fills the list of copies, newest first. Without a granted directory the list stays empty until «Обновить».
async function loadCopies(){
 const directory=await loadDirectory();
 let store,registry,copies;
 try{
  registry=await TheCycleRecoveryRepositories.createRecoveryRepositories();
  const pointer=await registry.activation.read();
  store=await TheCycleStateStore.createStateStore({name:pointer.activeDatabase});
  copies=await TheCycleRestoreFlow.listCopies({directory,store});
 }finally{store?.close();registry?.close();}
 const chosen=copySelect.value;
 copySelect.replaceChildren(...copies.map(copy=>{
  const option=document.createElement('option');
  option.value=copy.key;
  option.textContent=localTime(copy.lastModified)+' · '+
   (copy.damaged?'повреждена':'исследований: '+copy.researchCount)+' · '+copy.key;
  return option;
 }));
 if(copies.some(copy=>copy.key===chosen))copySelect.value=chosen;
 restoreButton.disabled=!copies.length;
 return copies.length;
}
function restoreErrorText(error){
 const code=String(error?.code||error?.message||error);
 if(code==='RESTORE_TRANSPORT_BUSY')return 'Восстановление не начато: идёт исследование Circle или оно прервано только что. Остановите его и повторите через 3 минуты.';
 if(code==='RESTORE_COPY_EMPTY')return 'В копии нет исследований. Выберите другую копию.';
 if(code==='BACKUP_NOT_FOUND')return 'Копия не найдена в каталоге. Нажмите «Обновить».';
 if(/DIRECTORY|PERMISSION/.test(code))return NO_DIRECTORY;
 if(/^(BACKUP_FILE_INVALID_JSON|BACKUP_INTEGRITY_FAILED|BACKUP_SCHEMA_MISMATCH|INVALID_BACKUP|INVALID_BACKUP_PAYLOAD|RESTORE_(SCHEMA|ROWS?|RESEARCH|CONTROL|DUPLICATE|ORPHAN|KEY)_)/.test(code))
  return 'Копия повреждена или несовместима ('+code+'). Выберите другую копию.';
 return 'Восстановить не удалось: '+code;
}
document.getElementById('choose').addEventListener('click',()=>action(async()=>{
 await TheCycleBackupSetup.configureBackupDirectory();
 message.textContent='Каталог сохранён. Резервирование включено.';
 await loadCopies();
}));
document.getElementById('disable').addEventListener('click',()=>action(async()=>{
 await chrome.storage.local.set({thecycleBackupEnabled:false});
 message.textContent='Резервирование отключено.';
}));
document.getElementById('run').addEventListener('click',()=>action(async()=>{
 await requireDirectoryAccess('manual');
 const manager=await TheCycleDirectoryHandleManager.createDirectoryHandleManager();
 let store,registry,metadata;
 try{
  registry=await TheCycleRecoveryRepositories.createRecoveryRepositories();
  const pointer=await registry.activation.read();
  const directory=await manager.load('thecycle-backups');
  store=await TheCycleStateStore.createStateStore({name:pointer.activeDatabase});
  // An empty copy must not push real copies of this directory out of the rotation.
  if(!(await store.listResearch()).length){
   message.textContent='Копия не создана: в этом браузере нет исследований.';
   return;
  }
  const sink=TheCycleDirectorySink.createDirectorySink({directory});
  const service=TheCycleBackup.createBackupService({store,sink});
  const key='thecycle-manual-'+Date.now()+'-'+crypto.randomUUID().replace(/-/g,'');
  const result=await service.save(key);
  if(!result.verified)throw new Error('BACKUP_UNVERIFIED');
  await emit('BACKUP_READBACK_VERIFIED',{database:pointer.activeDatabase,backup:{key,sha256:result.sha256,verified:result.verified},reason:'manual'});
  // Rotation only after the copy is fully verified; its failure never fails the backup.
  try{
   metadata=await TheCycleGateMetadata.createGateMetadata();
   const retention=TheCycleBackupRetention.createRetention({sink,store,metadata,storage:chrome.storage.local,
    onEvent:(type,data)=>emit(type,{database:pointer.activeDatabase,...data})});
   await retention.afterVerified({key,sha256:result.sha256,createdAt:Date.now()});
  }catch(error){await emit('RETENTION_ERROR',{error,retention:{key}});}
  await chrome.storage.local.set({thecycleBackupStatus:{
   state:'VERIFIED',key,sha256:result.sha256,database:pointer.activeDatabase,at:Date.now()
  }});
  message.textContent='Резервная копия проверена: '+result.key;
  await loadCopies().catch(()=>{});
 }catch(error){
  await emit('BACKUP_FAILED',{reason:'manual',error});
  await chrome.storage.local.set({thecycleBackupStatus:{
   state:'FAILED',reason:String(error?.message||error),at:Date.now()
  }});
  throw error;
 }finally{try{metadata?.close();}catch(_){}store?.close();registry?.close();manager.close();}
}));
document.getElementById('refresh').addEventListener('click',()=>action(async()=>{
 await requireDirectoryAccess('manual');
 if(!(await loadCopies()))message.textContent='В каталоге нет копий.';
}));
// One action: check the copy and the transport, write a new database, check it, switch to it. No further questions.
restoreButton.addEventListener('click',()=>action(async()=>{
 const backupKey=copySelect.value;
 if(!backupKey)throw new Error('Выберите копию.');
 restoreButton.disabled=true;
 try{
  await requireDirectoryAccess('restore');
  message.textContent='Восстановление…';
  const result=await TheCycleRestoreFlow.restoreFromCopy({backupKey,directory:await loadDirectory()});
  message.textContent='Восстановлено исследований: '+result.researchCount+'. Список на странице Circle обновлён.'+
   (result.requiresManualReconciliation?' Есть запрос с неизвестным исходом: он не отправляется повторно, выберите действие на странице Circle.':'');
 }catch(error){
  throw new Error(restoreErrorText(error)+' Активная база не изменена.');
 }finally{restoreButton.disabled=false;}
}));
void refresh().catch(error=>{message.textContent=String(error);});
// No directory yet or no permission after a browser restart: «Обновить» asks for it.
void loadCopies().catch(()=>{});
