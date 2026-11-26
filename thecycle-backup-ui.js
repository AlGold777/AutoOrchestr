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
 const result=await chrome.runtime.sendMessage({type:'THECYCLE_BACKUP_NOW'});
 if(!result?.ok)throw new Error(result?.error||'BACKUP_FAILED');
 message.textContent='Резервная копия проверена: '+result.key;
}));
document.getElementById('refresh').addEventListener('click',()=>action(async()=>{}));
void refresh().catch(error=>{message.textContent=String(error);});
