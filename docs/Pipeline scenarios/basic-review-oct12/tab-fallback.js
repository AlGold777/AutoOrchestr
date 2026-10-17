const fs=require('fs'),vm=require('vm');
const dir=require('path').resolve(__dirname, '../../..')+'/';
const tabs=fs.readFileSync(dir+'background/tab-manager.js','utf8');
const jobs=fs.readFileSync(dir+'background/job-orchestrator.js','utf8');
const finder=tabs.slice(tabs.indexOf('async function findReusableTabsForLlm('),tabs.indexOf('\nfunction resolveTabForLlmName('));
const runner=jobs.slice(jobs.indexOf('async function runParticipantThroughTabs('),jobs.indexOf('\nasync function runModelThroughTabs('));
(async()=>{
  const sends=[],bindings=[];
  const context={console,getAllOpenTabs:async()=>[{id:22,url:'https://claude.ai/chat/unrelated'}],jobState:{llms:{}},TabMapManager:{get:()=>22},isEligibleTabForLlm:()=>true,matchesQueryPatternUrl:()=>true,compareTabsByOpenRecency:()=>0,participantTabOf:()=>11,tabsOfOtherParticipants:()=>[],bindParticipantTab:async(...args)=>bindings.push(args),setTabBinding:async()=>{},broadcastGlobalState:()=>{},emitTelemetry:()=>{},createNewLlmTab:async()=>{sends.push('new-empty-chat');return true}};
  vm.createContext(context);vm.runInContext(finder,context);
  const candidates=await context.findReusableTabsForLlm('Claude',{preferTabId:11,excludeTabIds:[]});
  context.tryAttachExistingTab=async(_name,_prompt,_attachments,options)=>{const found=await context.findReusableTabsForLlm('Claude',options);if(found.length){sends.push(found[0].id);return true}return false};
  vm.runInContext(runner,context);
  const result=await context.runParticipantThroughTabs('Claude','private follow-up',[],{}, {participantId:'author-A',newChat:false});
  console.log(JSON.stringify({scenario:'bound tab 11 closed; unrelated tab 22 open',candidates,sends,bindings,result},null,2));
  context.getAllOpenTabs=async()=>[];sends.length=0;bindings.length=0;
  const noTabs=await context.runParticipantThroughTabs('Claude','follow-up after close',[],{}, {participantId:'author-A',newChat:false});
  console.log(JSON.stringify({scenario:'bound tab 11 closed; no replacement tabs',sends,bindings,result:noTabs},null,2));
})();
