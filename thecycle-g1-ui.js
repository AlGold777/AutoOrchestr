'use strict';
// G1 operator surface embedded in the existing results page, not a second engine.
(function(){
 const root=window,el=id=>document.getElementById(id);
 const out=el('thecycle-g1-output'),startBtn=el('thecycle-g1-start');
 const stopBtn=el('thecycle-g1-stop');
 if(!out||!root.TheCycleG1)return;
 let runner=null;
 const getRunner=()=>{
  if(!runner){
   if(!root.TheCycleMainPageBridge)throw new Error('BASIC_BRIDGE_NOT_READY');
   runner=root.TheCycleG1.createG1Runner({bridge:root.TheCycleMainPageBridge});
  }
  return runner;
 };
 let selectedId=null;
 const show=value=>{out.textContent=typeof value==='string'?value:JSON.stringify(value,null,2);};
 const brief=s=>{
  const report=s.report||null;
  const accepted=(report?.steps||[]).flatMap(step=>
   Object.entries(step.outcome||{}).filter(([,v])=>v?.ok).map(([model,v])=>({model,answer:v.text})));
  return {researchId:s.researchId,database:s.database,phase:s.state?.phase,
   stateVersion:s.state?.stateVersion,cycle:s.state?.lastCommittedPacket,
   backupRequiredCycle:s.state?.backupRequiredCycleId,
   budget:s.state?.budget,packetStatus:s.packet?.status,
   runStatus:report?.status,answers:accepted};
 };
 async function status(){
  selectedId=selectedId||await getRunner().latest();
  if(!selectedId){show('Нет исследований TheCycle G1.');return;}
  show(brief(await getRunner().snapshot(selectedId)));
 }
 async function action(fn){
  try{await fn();}catch(e){show('Ошибка: '+String(e?.message||e));console.error('[TheCycle G1]',e);}
 }
 startBtn.addEventListener('click',()=>action(async()=>{
  const task=el('thecycle-g1-task').value.trim();
  const maxCalls=Number(el('thecycle-g1-budget').value);
  if(!task)throw new Error('Введите задачу');
  if(getRunner().isRunning())throw new Error('Исследование уже выполняется');
  startBtn.disabled=true;
  show('Basic запущен. Исследование сохраняется в IndexedDB. Не закрывайте страницу в G1.');
  try{
   const result=await getRunner().start({task,maxCalls,maxCallsPerCycle:maxCalls});
   selectedId=result.researchId;
   show({outcomes:result.outcomes,...brief(result)});
  }finally{startBtn.disabled=false;}
 }));
 stopBtn.addEventListener('click',()=>action(async()=>show(await getRunner().stop())));
 el('thecycle-g1-status').addEventListener('click',()=>action(status));
 if(root.TheCycleMainPageBridge)void action(status);
 else root.addEventListener('thecycle:basic-bridge-ready',()=>{void action(status);},{once:true});
})();
