/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../results'), 'utf8');
const start = source.indexOf('function bindGetItButton(');
const handler = source.slice(start, source.indexOf('function getSelectedJudgeSystemPrompt', start));

test('forced status double-click requests bottom preparation independently of the batch button', () => {
  expect(source).toContain("getIt: options.source === 'status_indicator_dblclick'");
  const router = fs.readFileSync(require.resolve('../background/message-router'), 'utf8');
  const request = router.slice(router.indexOf("case 'REQUEST_LLM_RESPONSE'"));
  expect(request).toContain('getIt: message.getIt === true');
});

test('manual recovery prefers the run-bound tab and does not silently switch a missing tab', async () => {
  const orch = fs.readFileSync(require.resolve('../background/job-orchestrator'), 'utf8');
  const from = orch.indexOf('async function handleManualResponsePing');
  const c = { jobState: { llms: { GPT: { tabId: 11 } } }, TabMapManager: { get: () => 22 },
    getTabSafe: jest.fn(async id => ({ id })), isEligibleTabForLlm: () => true };
  vm.createContext(c);
  vm.runInContext(orch.slice(from, orch.indexOf('  if (!tabId) {', from)) + 'return {tabId};\n}', c);
  expect((await c.handleManualResponsePing('GPT')).tabId).toBe(11);
  c.getTabSafe.mockResolvedValue(null);
  expect((await c.handleManualResponsePing('GPT')).status).toBe('manual_ping_failed');
});

test('Get it can re-read an unchanged current answer while still excluding the pre-dispatch answer', () => {
  const orch = fs.readFileSync(require.resolve('../background/job-orchestrator'), 'utf8');
  const from = orch.indexOf('const buildManualLatestRecoveryOptions =');
  const c = { normalizeAnswerSignatureBg: v => v.trim(), MANUAL_RECOVERY_STRATEGIES: [{ id: 'bottom_most' }] };
  vm.createContext(c);
  vm.runInContext(orch.slice(from, orch.indexOf('const markLastManualCandidateRejected', from)), c);
  const result = vm.runInContext("buildManualLatestRecoveryOptions({answer:'current', pendingFinalAnswer:'partial', preDispatchAnswerSignature:'old'}, 'GPT', null, {keepCurrentAnswer:true})", c);
  expect(Array.from(result.excludeTextSignatures)).toEqual(['old']);
});

test('Get it hands the entire queue to the background in one message', async () => {
  jest.useFakeTimers();
  let click, finishFirst;
  const order = [];
  const c = {
    console, setTimeout, clearTimeout, getItButton: { dataset: {}, addEventListener: (name, fn) => { if(name === 'click') click = fn; } },
    getSelectedLLMs: () => ['GPT', 'Qwen', 'Claude'],
    pendingResponses: { GPT: 'old' }, updateLLMPanelOutput: () => order.push('old'),
    checkCompareButtonState: jest.fn(), showNotification: jest.fn(),
    chrome: { runtime: { sendMessage: jest.fn(message => {
      order.push(message.type);
      return new Promise(resolve => { finishFirst = resolve; });
    }) } }
  };
  vm.runInNewContext(handler, c);
  click({detail:1});
  await jest.advanceTimersByTimeAsync(600);
  click({detail:1});
  await jest.advanceTimersByTimeAsync(600); // A duplicate click cannot start a competing focus sequence.
  expect(order).toEqual(['old', 'GET_IT_BATCH']);
  finishFirst({ results: [{ llmName: 'GPT', status: 'manual_ping_failed', error: 'bottom unavailable' }] });
  await jest.advanceTimersByTimeAsync(0);
  expect(c.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
  expect(c.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'GET_IT_BATCH', llmNames: ['GPT', 'Qwen', 'Claude'] });
  expect(c.showNotification).toHaveBeenCalledWith('GPT: bottom unavailable');
  expect(c.getItButton.dataset.collecting).toBeUndefined();
  jest.useRealTimers();
});

function batchSetup() {
  const orch = fs.readFileSync(require.resolve('../background/job-orchestrator'), 'utf8');
  const from = orch.indexOf('let getItBatchInFlight =');
  const c = {
    jobState: { llms: { GPT: {}, Qwen: {}, Claude: {} } }, LLM_TARGETS: {},
    getActiveSessionId: () => 1, isSessionActive: () => true,
    handleManualResponsePing: jest.fn(async () => ({ status: 'manual_ping_sent' }))
  };
  vm.createContext(c);
  vm.runInContext(orch.slice(from, orch.indexOf('async function handleManualResponsePing', from)), c);
  return c;
}

test('double-click cancels ordinary Get it and requests only failed models', async () => {
  jest.useFakeTimers();
  const handlers = {};
  const c = {console,setTimeout,clearTimeout,getItButton:{disabled:true,dataset:{},addEventListener:(name,fn)=>handlers[name]=fn},
    getSelectedLLMs:()=>['GPT','Qwen'],pendingResponses:{},updateLLMPanelOutput:jest.fn(),
    checkCompareButtonState:jest.fn(),chrome:{runtime:{sendMessage:jest.fn(async()=>({results:[]}))}}};
  vm.runInNewContext(handler,c);
  expect(c.getItButton.disabled).toBe(false);
  handlers.click({detail:1});handlers.click({detail:2});handlers.dblclick();
  await jest.advanceTimersByTimeAsync(700);
  expect(c.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
  expect(c.chrome.runtime.sendMessage).toHaveBeenCalledWith({type:'GET_IT_BATCH',llmNames:['GPT','Qwen'],failedOnly:true});
  jest.useRealTimers();
});

test('failed-page route skips success, moves despite pending collection and returns before collection finishes', async () => {
  const c=batchSetup();const order=[];const releases=[];
  Object.assign(c,{self:{},getTabSafe:async id=>({id,windowId:7}),isEligibleTabForLlm:(_name,tab)=>tab.id!==4,
    isAppUiTab:tab=>tab.id===99,
    runPreCollectScrollNudge:jest.fn(async name=>{order.push(name);return true;}),
    chrome:{tabs:{update:async id=>order.push(`return:${id}`)},windows:{update:async()=>{}}}});
  c.jobState.llms={GPT:{tabId:1,status:'SUCCESS',answer:'complete'},Qwen:{tabId:2,status:'UNCERTAIN'},Claude:{tabId:3,status:'PARTIAL',answer:'partial'},Missing:{tabId:4,status:'ERROR'}};
  c.handleManualResponsePing.mockImplementation(()=>new Promise(resolve=>releases.push(()=>resolve({status:'manual_ping_sent'}))));
  const pending=c.collectGetItBatch(['GPT','Qwen','Missing','Claude'],{failedOnly:true,returnToTabId:99});
  for(let i=0;i<30;i++) await Promise.resolve();
  expect(order).toEqual(['Qwen','Claude','return:99']);
  expect(c.runPreCollectScrollNudge).toHaveBeenCalledWith('Qwen',2,1,'get_it_failed_batch',{getIt:true,batchDwell:true});
  expect(c.handleManualResponsePing).toHaveBeenCalledWith('Qwen',expect.objectContaining({skipBottomPreparation:true}));
  releases.forEach(fn=>fn());
  expect((await pending).results).toContainEqual(expect.objectContaining({llmName:'Missing',status:'manual_ping_failed'}));
});

test('a restored page with no selected buttons still recovers failed models from the current run', async () => {
  const c=batchSetup();
  c.jobState.llms={GPT:{tabId:1,status:'SUCCESS',answer:'done'},Qwen:{tabId:2,status:'UNCERTAIN'}};
  Object.assign(c,{self:{},getTabSafe:async id=>({id}),isEligibleTabForLlm:()=>true,isAppUiTab:()=>false,
    runPreCollectScrollNudge:jest.fn(async()=>true)});
  const result=await c.collectGetItBatch([],{failedOnly:true});
  expect(result.status).toBe('get_it_completed');
  expect(c.runPreCollectScrollNudge).toHaveBeenCalledTimes(1);
  expect(c.handleManualResponsePing).toHaveBeenCalledWith('Qwen',expect.anything());
});

test('an initial send pass explains why recovery cannot start', async () => {
  const c=batchSetup();c.self={isInitialPromptPassActive:()=>true};
  const result=await c.collectGetItBatch([],{failedOnly:true});
  expect(result).toMatchObject({status:'get_it_busy',error:expect.any(String)});
  expect(c.handleManualResponsePing).not.toHaveBeenCalled();
});

test('background advances through the whole queue without any further UI message or callback', async () => {
  const c = batchSetup(); let finishFirst;
  c.handleManualResponsePing.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
  const batch = c.collectGetItBatch(['GPT', 'Qwen', 'Claude', 'GPT']);
  expect(c.collectGetItBatch(['GPT'])).toBe(batch);
  expect(c.handleManualResponsePing).toHaveBeenCalledTimes(1);
  finishFirst({ status: 'manual_ping_sent' });
  const result = await batch;
  expect(c.handleManualResponsePing.mock.calls.map(([name]) => name)).toEqual(['GPT', 'Qwen', 'Claude']);
  expect(result.results).toHaveLength(3);
  expect(c.handleManualResponsePing).toHaveBeenLastCalledWith('Claude', expect.objectContaining({ getIt: true, manualLatestRecovery: true }));
});

test('one model failing does not hold the remaining queue', async () => {
  const c = batchSetup(); c.handleManualResponsePing.mockRejectedValueOnce(new Error('closed tab'));
  const result = await c.collectGetItBatch(['GPT', 'Qwen']);
  expect(result.results[0].status).toBe('manual_ping_failed');
  expect(result.results[1].llmName).toBe('Qwen');
  await c.collectGetItBatch(['Claude']);
  expect(c.handleManualResponsePing).toHaveBeenCalledTimes(3);
});

test('a new session stops the old batch before the next page', async () => {
  const c = batchSetup();
  c.handleManualResponsePing.mockImplementationOnce(async () => { c.isSessionActive = () => false; return {}; });
  expect((await c.collectGetItBatch(['GPT', 'Qwen'])).status).toBe('get_it_cancelled');
  expect(c.handleManualResponsePing).toHaveBeenCalledTimes(1);
});

test('Get it inline collection skips the health round-trip but validates the tab', async () => {
  const orch = fs.readFileSync(require.resolve('../background/job-orchestrator'), 'utf8');
  const from = orch.indexOf('async function classifyLateCollectState');
  const c = { getTabSafe: async () => ({ id: 1 }), isEligibleTabForLlm: () => true,
    buildTabSnapshot: tab => tab, sendTabMessageForLateCollect: jest.fn() };
  vm.createContext(c);
  vm.runInContext(orch.slice(from, orch.indexOf('async function runInlineLateExtract', from)), c);
  expect((await c.classifyLateCollectState(1, 'GPT', { inlineOnly: true })).state).toBe('REINJECTABLE');
  expect(c.sendTabMessageForLateCollect).not.toHaveBeenCalled();
  c.isEligibleTabForLlm = () => false;
  expect((await c.classifyLateCollectState(1, 'GPT', { inlineOnly: true })).reason).toBe('tab_ineligible');
});

function automaticSetup() {
  const c=batchSetup();
  c.jobState.session={};
  c.jobState.llms={GPT:{tabId:1,status:'SUCCESS',answer:'partial'},Qwen:{tabId:2,status:'UNCERTAIN'},Claude:{tabId:3}};
  Object.assign(c,{self:{},saveJobState:jest.fn(),resultsTabId:9,
    getTabSafe:async id=>({id,windowId:1}),isEligibleTabForLlm:()=>true,isAppUiTab:t=>t?.id===9,
    chrome:{tabs:{update:jest.fn()},windows:{update:jest.fn()}},
    openOrFocusResultsTab:jest.fn(),runPreCollectScrollNudge:jest.fn(async()=>true)});
  return c;
}
test('automatic pass visits selected successful and failed models once, manual repeat remains available',async()=>{
  const c=automaticSetup();
  await c.runAutomaticGetItPass(['GPT','Qwen'],1);
  expect(c.handleManualResponsePing.mock.calls.map(([name])=>name)).toEqual(['GPT','Qwen']);
  expect(c.runPreCollectScrollNudge).toHaveBeenCalledWith('GPT',1,1,'automatic_get_it_batch',{getIt:true,batchDwell:true});
  expect(c.chrome.tabs.update).toHaveBeenCalledWith(9,{active:true});
  await c.runAutomaticGetItPass(['GPT','Qwen'],1);
  expect(c.handleManualResponsePing).toHaveBeenCalledTimes(2);
  await c.collectGetItBatch(['GPT']);
  expect(c.handleManualResponsePing).toHaveBeenCalledTimes(3);
});
test('automatic route advances and returns before slow extraction completes',async()=>{
  const c=automaticSetup();let finish;
  c.handleManualResponsePing.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));
  const pending=c.runAutomaticGetItPass(['GPT','Qwen'],1);
  for(let i=0;i<30;i++) await Promise.resolve();
  expect(c.handleManualResponsePing).toHaveBeenCalledTimes(2);
  expect(c.chrome.tabs.update).toHaveBeenCalledWith(9,{active:true});
  finish({status:'manual_ping_sent'});await pending;
});
test('cancelled automatic pass does not visit the next model or steal focus back',async()=>{
  const c=automaticSetup();let active=true;c.isSessionActive=()=>active;
  c.runPreCollectScrollNudge.mockImplementationOnce(async()=>{active=false;return true;});
  await c.runAutomaticGetItPass(['GPT','Qwen'],1);
  expect(c.runPreCollectScrollNudge).toHaveBeenCalledTimes(1);
  expect(c.handleManualResponsePing).not.toHaveBeenCalled();
  expect(c.chrome.tabs.update).not.toHaveBeenCalled();
  expect(c.openOrFocusResultsTab).not.toHaveBeenCalled();
});
test('automatic pass waits for an existing manual batch without losing the all-model pass',async()=>{
  const c=automaticSetup();let finish;
  c.handleManualResponsePing.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));
  const manual=c.collectGetItBatch(['Qwen']);
  const automatic=c.runAutomaticGetItPass(['GPT','Qwen'],1);
  expect(c.runPreCollectScrollNudge).not.toHaveBeenCalled();
  finish({status:'manual_ping_sent'});await manual;await automatic;
  expect(c.handleManualResponsePing.mock.calls.map(([name])=>name)).toEqual(['Qwen','GPT','Qwen']);
});

test('in a pipeline stage the automatic pass visits only models that need recovery; main page and manual passes still re-read everyone', async () => {
  const mk = () => {
    const c = batchSetup();
    Object.assign(c, { self: {}, getTabSafe: async (id) => ({ id }), isEligibleTabForLlm: () => true, isAppUiTab: () => false,
      runPreCollectScrollNudge: jest.fn(async () => true) });
    c.jobState.llms = { GPT: { tabId: 1, status: 'SUCCESS', finalStatus: 'SUCCESS', answer: 'done' }, Qwen: { tabId: 2, status: 'UNCERTAIN' }, Claude: { tabId: 3, status: 'SUCCESS', finalStatus: 'SUCCESS', answer: '' } };
    c.jobState.session = { pipelineContext: { pipelineRunId: 'run-1' } };
    return c;
  };
  const auto = mk();
  const r = await auto.collectGetItBatch(['GPT', 'Qwen', 'Claude'], { failedOnly: true, allModels: true, automatic: true });
  expect(r.status).toBe('get_it_completed');
  expect(auto.runPreCollectScrollNudge.mock.calls.map(([name]) => name)).toEqual(['Qwen', 'Claude']);

  const allGreen = mk();
  allGreen.jobState.llms = { GPT: { tabId: 1, status: 'SUCCESS', finalStatus: 'SUCCESS', answer: 'a' }, Claude: { tabId: 3, status: 'SUCCESS', finalStatus: 'SUCCESS', answer: 'b' } };
  expect((await allGreen.collectGetItBatch(['GPT', 'Claude'], { failedOnly: true, allModels: true, automatic: true })).status).toBe('get_it_empty');
  expect(allGreen.runPreCollectScrollNudge).not.toHaveBeenCalled();

  const manual = mk();
  await manual.collectGetItBatch(['GPT', 'Qwen', 'Claude'], { failedOnly: true, allModels: true });
  expect(manual.runPreCollectScrollNudge.mock.calls.map(([name]) => name)).toEqual(['GPT', 'Qwen', 'Claude']);

  // The main page (no pipeline run) keeps the all-model automatic pass.
  const main = mk();
  main.jobState.session = {};
  await main.collectGetItBatch(['GPT', 'Qwen', 'Claude'], { failedOnly: true, allModels: true, automatic: true });
  expect(main.runPreCollectScrollNudge.mock.calls.map(([name]) => name)).toEqual(['GPT', 'Qwen', 'Claude']);
});
