const fs = require('fs');
const vm = require('vm');
const read = p => fs.readFileSync(require('path').join(__dirname, '..', p), 'utf8');
const orch = read('background/job-orchestrator.js');
const router = read('background/message-router.js');

function runtimeSandbox(executeScript) {
  const c = { Date, setTimeout, clearTimeout, console, emitTelemetry: jest.fn(), chrome: {
    runtime: { getManifest: () => ({ version: 'test' }) },
    scripting: { executeScript }, tabs: { sendMessage: jest.fn(async () => ({})) }
  }};
  c.self = c;
  vm.createContext(c);
  vm.runInContext(router.slice(router.indexOf('const completionRuntimeByTab'), router.indexOf('try {\n    chrome.tabs?.onRemoved')), c);
  return c;
}
const healthy = {buildVersion:'test', detectorVersion:'2.3.1', protocolVersion:require('../shared/completion-protocol').version, completionSessionAvailable:true};

describe('runtime readiness deadline', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  test('loading document is probed immediately and repaired immediately', async () => {
    const execute = jest.fn(async args => {
      if (!args.injectImmediately) return new Promise(() => {});
      return args.files ? [] : [{ result: execute.mock.calls.length === 1 ? {} : healthy }];
    });
    const c = runtimeSandbox(execute);
    expect((await c.ensureCompletionRuntimeInTab(10, 'Gemini')).ok).toBe(true);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(jest.getTimerCount()).toBe(0);
  });
  test('hung renderer releases readiness flight so another model proceeds', async () => {
    const c = runtimeSandbox(jest.fn(({target}) => target.tabId === 10 ? new Promise(() => {}) : Promise.resolve([{result:healthy}])));
    const hung = c.ensureCompletionRuntimeInTab(10, 'Gemini');
    await jest.advanceTimersByTimeAsync(12001);
    expect((await hung).ok).toBe(false);
    expect((await c.ensureCompletionRuntimeInTab(11, 'Grok')).ok).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
  test('lost ready announcement cannot hold a healthy runtime indefinitely', async () => {
    const c = runtimeSandbox(jest.fn(async () => [{result:healthy}]));
    c.chrome.tabs.sendMessage.mockImplementation(() => new Promise(() => {}));
    const result = c.ensureCompletionRuntimeInTab(10, 'Gemini');
    await jest.advanceTimersByTimeAsync(1001);
    expect((await result).ok).toBe(true);
  });
  test('recent verified runtime avoids repeated injection and expires after 30 seconds', async () => {
    const execute = jest.fn(async () => [{result:healthy}]);
    const c = runtimeSandbox(execute);
    await c.ensureCompletionRuntimeInTab(10, 'GPT');
    expect((await c.ensureCompletionRuntimeInTab(10, 'GPT')).cached).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(30001);
    await c.ensureCompletionRuntimeInTab(10, 'GPT');
    expect(execute).toHaveBeenCalledTimes(2);
  });
  test('navigation invalidates a warm runtime before its expiry', async () => {
    const execute = jest.fn(async () => [{result:healthy}]);
    const c = runtimeSandbox(execute);
    let onUpdated;
    c.chrome.tabs.onUpdated = { addListener: callback => { onUpdated = callback; } };
    vm.runInContext(router.slice(router.indexOf('try {\n    chrome.tabs?.onRemoved'), router.indexOf('\nfunction withManagedDebuggerSession')), c);
    await c.ensureCompletionRuntimeInTab(10, 'GPT');
    onUpdated(10, {status:'loading'});
    await c.ensureCompletionRuntimeInTab(10, 'GPT');
    expect(execute).toHaveBeenCalledTimes(2);
  });
});

describe('restart after first three providers', () => {
  function sandbox(forceNewTabs) {
    const names = ['Qwen', 'GPT', 'Claude', 'Gemini', 'Grok', 'DeepSeek', 'Le Chat', 'Perplexity', 'Kimi', 'Z.ai'];
    const llms = Object.fromEntries(names.map((n,i) => [n, {tabId:i+1, dispatchAttempts:i<4?1:0,
      ...(i<4 ? {lastDispatchMeta:{dispatchId:n}}:{}),
      ...(i<3 ? {promptSubmittedAt:100}:{}),
      ...(i===3 ? {dispatchCheckpoint:{dispatchId:n,phase:'preparing'}}:{})
    }]));
    const c = { console, Date, setTimeout, clearTimeout, jobState:{prompt:'test', llms, session:{startTime:1, forceNewTabs, roundsInProgress:true, roundPhase:'round1', selectedModels:names}},
      mv3RehydrationInFlight:false, hasOpenModelRuns:()=>true, updateMv3SurvivalAlarm:jest.fn(),
      isFinalizedEntry:e=>!!e.finalizedAt, emitTelemetry:jest.fn(), ensureBudgetStore:()=>({}),
      resolveBoundTabIdForOrchestrator:(_,e)=>e.tabId, isValidTabId:Number.isInteger,
      registerSessionTimer:jest.fn(), llmStartChains:{}, dispatchMutexManager:{clear:jest.fn()},
      runDispatchRounds:jest.fn(), saveJobState:jest.fn(), broadcastGlobalState:jest.fn(),
      schedulePromptDispatchSupervisor:jest.fn() };
    c.self=c; vm.createContext(c);
    vm.runInContext(orch.slice(orch.indexOf('function rehydrateActiveJobRuntime'), orch.indexOf("if (typeof chrome !== 'undefined' && chrome?.alarms")), c);
    return c;
  }
  test.each([true,false])('resumes both tab modes (forceNewTabs=%s) using existing bindings', mode => {
    jest.useFakeTimers();
    const c=sandbox(mode);
    expect(c.rehydrateActiveJobRuntime()).toBe(true);
    expect(c.runDispatchRounds).toHaveBeenCalledWith(c.jobState.session.selectedModels,'test',false,[],{resume:true});
    jest.clearAllTimers(); jest.useRealTimers();
  });
  test('resumed Round 1 sends preparation-only and untouched tail, skips confirmed and uncertain commands', async () => {
    const c=sandbox(true);
    c.jobState.llms.Grok.lastDispatchMeta={dispatchId:'Grok'};
    c.jobState.llms.Grok.dispatchCheckpoint={dispatchId:'Grok',phase:'command_intent'};
    Object.assign(c, {orderRound1Models:n=>n, isSessionActive:()=>true, emitModelRoundTelemetry:jest.fn(),
      endBudgetPhase:jest.fn(),getTabSafe:async()=>({url:'https://example.com'}),initRequestMetadata:jest.fn(),resolvePromptForDispatch:(_,p)=>p,
      dispatchPromptToTab:jest.fn(async()=>{}),orchestratorSleepMs:async()=>{},
      ROUND1_BEFORE_SEND_MS:0,ROUND1_POST_SEND_MS:0,ROUND1_PROGRESS_FOCUS_EXTENSION_MS:0,resolveRound1PostCommandFocusHoldMs:()=>0});
    const start=orch.indexOf('async function dispatchRound1Sequentially');
    const end=orch.indexOf('\nasync function ',start+10);
    vm.runInContext(orch.slice(start,end), c);
    await c.dispatchRound1Sequentially(c.jobState.session.selectedModels,'test',[],1,{resume:true});
    expect(c.dispatchPromptToTab.mock.calls.map(a=>a[0])).toEqual(['Gemini','DeepSeek','Le Chat','Perplexity','Kimi','Z.ai']);
  });
});
