// Native Telemetry modal tab: diagnostics only, not execution controls.
(function(root){'use strict';
const doc=root.document,api=root.TheCycleTelemetry;
const panel=doc?.getElementById('thecycle-tabpanel');
if(!panel||!api)return;
const status=doc.getElementById('thecycle-telemetry-status'),body=doc.getElementById('thecycle-telemetry-rows');
const md=doc.getElementById('thecycle-export-md'),clear=doc.getElementById('thecycle-clear-telemetry');
let generation=0;
function cell(tr,value){const td=doc.createElement('td');td.textContent=value==null?'—':String(value);tr.appendChild(td);}
async function refresh(){
 const stamp=++generation;
 try{
  const rows=await api.list();if(stamp!==generation)return;
  body.replaceChildren();
  for(const row of rows.slice(-500).reverse()){
   const tr=doc.createElement('tr');
   cell(tr,row.at);cell(tr,row.researchId);cell(tr,row.cycleId);cell(tr,row.type);
   cell(tr,row.phase||row.outcome||row.reportStatus);cell(tr,row.action||row.reason||row.error?.message);
   cell(tr,JSON.stringify(row));body.appendChild(tr);
  }
  status.textContent=rows.length+' events'+(rows.length>500?' · latest 500 shown, MD exports all':'');
 }catch(error){if(stamp===generation)status.textContent='TheCycle telemetry: '+String(error?.message||error);}
}
function visible(){return !panel.hidden;}
doc.addEventListener('devtools-tab-change',e=>{if(e.detail?.targetId==='thecycle-tabpanel')void refresh();});
doc.addEventListener('devtools-visibility-change',e=>{if(e.detail?.visible&&visible())void refresh();});
doc.addEventListener('thecycle:telemetry-change',()=>{if(visible())void refresh();});
md.addEventListener('click',async()=>{
 try{
  const rows=await api.list();
  const url=URL.createObjectURL(new Blob([api.markdown(rows)],{type:'text/markdown;charset=utf-8'}));
  const a=doc.createElement('a');a.href=url;a.download='TheCycle-telemetry-'+new Date().toISOString().replace(/[:.]/g,'-')+'.md';
  doc.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch(error){status.textContent='Export failed: '+String(error?.message||error);}
});
clear.addEventListener('click',async()=>{
 clear.disabled=true;
 try{await api.clear();await refresh();}catch(error){status.textContent='Clear failed: '+String(error?.message||error);}
 finally{clear.disabled=false;}
});
if(visible())void refresh();
})(window);
