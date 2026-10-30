/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../background/dispatch-coordinator'), 'utf8');
function setup(states = ['missing','ready']) {
  let active = true;
  const c = {Date,Promise,setTimeout,clearTimeout,
    dispatchSleepMs:ms => new Promise(resolve => setTimeout(resolve,ms)),
    getTabSafe:jest.fn(async () => ({status:'complete',url:'https://claude.ai/chat/existing'})),
    isEligibleTabForLlm:() => true, emitTelemetry:jest.fn(),
    chrome:{runtime:{},tabs:{reload:jest.fn((id,options,cb) => cb()),sendMessage:jest.fn((id,msg,cb) => {
      const state = states.length > 1 ? states.shift() : states[0];
      if (state === 'silent') return;
      if (state === 'missing') c.chrome.runtime.lastError = {message:'Could not establish connection. Receiving end does not exist.'};
      cb(state === 'ready' ? {type:'HEALTH_CHECK_PONG',llmName:'Claude'} : null);
      delete c.chrome.runtime.lastError;
    })}}};
  vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('async function prepareReusableTabReceiver'),source.indexOf('async function dispatchSimpleFirstPass')),c);
  return {c,run:() => c.prepareReusableTabReceiver(12,'Claude',() => active),stop:() => {active=false;}};
}
beforeEach(() => {jest.useFakeTimers();jest.setSystemTime(1000);});
afterEach(() => jest.useRealTimers());
test('healthy existing conversation is immediately reusable without reload', async () => {
  const {c,run}=setup(['ready']);
  expect(await run()).toMatchObject({ok:true,reloaded:false});
  expect(c.chrome.tabs.reload).not.toHaveBeenCalled();
});
test('a slow healthy renderer is accepted without repeatedly discarding its PONG', async () => {
  const {c,run}=setup();
  c.chrome.tabs.sendMessage.mockImplementation((_id,_msg,cb) => {
    setTimeout(() => cb({type:'HEALTH_CHECK_PONG',llmName:'Claude'}),1600);
  });
  const pending=run();await jest.advanceTimersByTimeAsync(1800);
  expect(await pending).toMatchObject({ok:true,reloaded:false});
  expect(c.chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
  expect(c.chrome.tabs.reload).not.toHaveBeenCalled();
});
test('a PONG after the overall deadline cannot revive preparation', async () => {
  const {c,run}=setup();let reply;
  c.chrome.tabs.sendMessage.mockImplementation((_id,_msg,cb) => {reply=cb;});
  const pending=run();await jest.advanceTimersByTimeAsync(21000);
  expect(await pending).toMatchObject({ok:false,reason:'receiver_timeout'});
  reply({type:'HEALTH_CHECK_PONG',llmName:'Claude'});
  expect(c.chrome.tabs.reload).not.toHaveBeenCalled();
});
test('Stop releases a silent receiver wait promptly', async () => {
  const {c,run,stop}=setup(['silent']);
  const pending=run();stop();await jest.advanceTimersByTimeAsync(100);
  expect(await pending).toMatchObject({ok:false,reason:'session_changed'});
  expect(c.chrome.tabs.reload).not.toHaveBeenCalled();
});
test('orphan page reloads once at its current address and waits for the actual listener', async () => {
  const {c,run}=setup(['missing','missing','missing','ready']);
  const pending=run();await jest.advanceTimersByTimeAsync(1000);
  expect(await pending).toMatchObject({ok:true,reloaded:true});
  expect(c.chrome.tabs.reload).toHaveBeenCalledTimes(1);
  expect(c.chrome.tabs.reload).toHaveBeenCalledWith(12,{},expect.any(Function));
  expect(c.chrome.tabs.sendMessage.mock.calls.every(([,msg]) => msg.type === 'HEALTH_CHECK_PING')).toBe(true);
});
test.each(['empty', 'closed_port'])('a settled page with %s health response restores its removed provider immediately', async mode => {
  const {c,run}=setup();
  c.chrome.tabs.sendMessage.mockImplementation((_id,_msg,cb) => {
    if (c.chrome.tabs.reload.mock.calls.length) {
      cb({type:'HEALTH_CHECK_PONG',llmName:'Claude'});
      return;
    }
    if (mode === 'closed_port') {
      c.chrome.runtime.lastError={message:'The message port closed before a response was received.'};
    }
    cb(undefined);delete c.chrome.runtime.lastError;
  });
  const pending=run();await jest.advanceTimersByTimeAsync(21000);
  expect(await pending).toMatchObject({ok:true,reloaded:true});
  expect(c.chrome.tabs.reload).toHaveBeenCalledTimes(1);
  expect(c.emitTelemetry.mock.calls.at(-1)[2].meta.durationMs).toBeLessThan(2000);
});
test('a loading page with only shared listeners waits for its provider without reloading', async () => {
  const {c,run}=setup(['empty','ready']);
  c.getTabSafe.mockResolvedValue({status:'loading'});
  const pending=run();await jest.advanceTimersByTimeAsync(300);
  expect(await pending).toMatchObject({ok:true,reloaded:false});
  expect(c.chrome.tabs.reload).not.toHaveBeenCalled();
});
test('another model health reply cannot trigger a reload or prove readiness', async () => {
  const {c,run}=setup();
  c.chrome.tabs.sendMessage.mockImplementation((_id,_msg,cb) => cb({type:'HEALTH_CHECK_PONG',llmName:'GPT'}));
  const pending=run();await jest.advanceTimersByTimeAsync(21000);
  expect(await pending).toMatchObject({ok:false,reason:'receiver_timeout'});
  expect(c.chrome.tabs.reload).not.toHaveBeenCalled();
});
test('slow startup beyond the old 1.8s cutoff still becomes ready before dispatch', async () => {
  const {run}=setup([...Array(16).fill('missing'),'ready']);
  const pending=run();await jest.advanceTimersByTimeAsync(5000);
  expect(await pending).toMatchObject({ok:true,reloaded:true});
});
test('silent receiver is never reloaded on a timeout and preparation is bounded', async () => {
  const {c,run}=setup(['silent']);const pending=run();
  await jest.advanceTimersByTimeAsync(21000);
  expect(await pending).toMatchObject({ok:false,reason:'receiver_timeout'});
  expect(c.chrome.tabs.reload).not.toHaveBeenCalled();
});
test('Stop prevents a reload after an asynchronous tab lookup', async () => {
  const {c,run,stop}=setup();let release;
  c.getTabSafe.mockImplementation(() => new Promise(resolve => {release=resolve;}));
  const pending=run();await jest.advanceTimersByTimeAsync(1);stop();release({status:'complete'});
  expect(await pending).toMatchObject({ok:false,reason:'session_changed'});
  expect(c.chrome.tabs.reload).not.toHaveBeenCalled();
});
test('a navigating page waits for natural registration without reloading', async () => {
  const {c,run}=setup(['missing','ready']);
  c.getTabSafe.mockResolvedValue({status:'loading'});
  const pending=run();await jest.advanceTimersByTimeAsync(300);
  expect(await pending).toMatchObject({ok:true,reloaded:false});
});
test.each(['delayed', 'silent'])('reload %s acknowledgement does not reject a receiver that becomes ready', async mode => {
  const {c,run}=setup(['missing','missing','missing','missing','missing','missing','missing','missing','ready']);
  c.chrome.tabs.reload.mockImplementation((_id,_options,cb) => {
    if (mode === 'delayed') setTimeout(cb, 3000);
  });
  const pending=run();await jest.advanceTimersByTimeAsync(2500);
  expect(await pending).toMatchObject({ok:true,reloaded:true});
  expect(c.chrome.tabs.reload).toHaveBeenCalledTimes(1);
});
test('an explicit reload API error remains a failure', async () => {
  const {c,run}=setup(['missing']);
  c.chrome.tabs.reload.mockImplementation((_id,_options,cb) => {
    c.chrome.runtime.lastError={message:'No tab with id: 12'};cb();delete c.chrome.runtime.lastError;
  });
  expect(await run()).toMatchObject({ok:false,reason:'reload_failed',reloadError:'No tab with id: 12'});
});
test('a reload with no acknowledgement and no receiver stays bounded and is not retried', async () => {
  const {c,run}=setup(['missing']);
  c.chrome.tabs.reload.mockImplementation(()=>{});
  const pending=run();await jest.advanceTimersByTimeAsync(21000);
  expect(await pending).toMatchObject({ok:false,reason:'receiver_timeout'});
  expect(c.chrome.tabs.reload).toHaveBeenCalledTimes(1);
});

test('a hung tab lookup cannot hang bootstrap or reload later', async () => {
  const {c,run}=setup(['missing']);let release;
  c.getTabSafe.mockImplementation(() => new Promise(resolve => {release=resolve;}));
  const pending=run();await jest.advanceTimersByTimeAsync(21000);
  expect(await pending).toMatchObject({ok:false,reason:'tab_lookup_timeout'});
  expect(c.getTabSafe).toHaveBeenCalledTimes(1);
  release({status:'complete'});await jest.advanceTimersByTimeAsync(100);
  expect(c.chrome.tabs.reload).not.toHaveBeenCalled();
});
test('a valid old tab returned after one second is recovered in the same visit', async () => {
  const {c,run}=setup(['missing','missing','ready']);
  c.getTabSafe.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({status:'complete'}), 1600)));
  const pending=run();await jest.advanceTimersByTimeAsync(3000);
  expect(await pending).toMatchObject({ok:true,reloaded:true});
  expect(c.getTabSafe).toHaveBeenCalledTimes(1);
  expect(c.chrome.tabs.reload).toHaveBeenCalledTimes(1);
});
test.each(['tab_missing', 'tab_ineligible'])('real %s still prevents reload', async reason => {
  const {c,run}=setup(['missing']);
  c.getTabSafe.mockResolvedValue(reason === 'tab_missing' ? null : {url:'https://other.example/'});
  c.isEligibleTabForLlm=() => false;
  expect(await run()).toMatchObject({ok:false,reason});
  expect(c.chrome.tabs.reload).not.toHaveBeenCalled();
});
test('Round 0 binds reused pages without waiting on receiver recovery or touching an issued command', async () => {
  const {c}=setup();
  const orch=fs.readFileSync(require.resolve('../background/job-orchestrator'),'utf8');
  Object.assign(c, {
    jobState:{session:{startTime:1},llms:{Claude:{tabId:12},GPT:{tabId:13},Gemini:{tabId:14,lastDispatchMeta:{dispatchId:'sent'}}}},
    isValidTabId:Number.isInteger, resolveBoundTabIdForOrchestrator:(_,entry)=>entry?.tabId,
    startModelForLLM:jest.fn(),waitForRound0Binding:jest.fn(),ROUND0_BIND_WAIT_TIMEOUT_MS:20000
  });
  const started=[];
  c.prepareReusableTabReceiver=jest.fn(async id => {
    started.push([id,Date.now()]);await new Promise(resolve => setTimeout(resolve,4000));return {ok:true,tabId:id};
  });
  vm.runInContext(orch.slice(orch.indexOf('async function openTabsSequentially'),orch.indexOf('async function recoverRound1TabReadiness')),c);
  const pending=c.openTabsSequentially(['Claude','GPT','Gemini'],'8 / 4',false,[],1,{resume:true});
  await jest.advanceTimersByTimeAsync(4000);
  expect(await pending).toBe(true);
  expect(started).toEqual([]);
  expect(c.prepareReusableTabReceiver).not.toHaveBeenCalled();
  expect(c.startModelForLLM).not.toHaveBeenCalled();
});
