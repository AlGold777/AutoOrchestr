const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');
const { serialize, deserialize } = require('v8');

const repoRoot = path.join(__dirname, '..');
const workerSource = fs.readFileSync(path.join(repoRoot, 'background', 'index.js'), 'utf8');

function createEvent() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) { listeners.push(listener); },
    removeListener(listener) {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    }
  };
}

function createStorageArea(seed = {}) {
  const values = { ...seed };
  const select = (keys) => {
    if (keys == null) return { ...values };
    if (typeof keys === 'string') return keys in values ? { [keys]: values[keys] } : {};
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]]));
    }
    return Object.fromEntries(Object.entries(keys || {}).map(([key, fallback]) => [
      key,
      key in values ? values[key] : fallback
    ]));
  };
  return {
    values,
    get(keys, callback) {
      const result = select(keys);
      callback?.(result);
      return Promise.resolve(result);
    },
    set(items, callback) {
      Object.assign(values, items || {});
      callback?.();
      return Promise.resolve();
    },
    remove(keys, callback) {
      (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete values[key]);
      callback?.();
      return Promise.resolve();
    },
    clear(callback) {
      Object.keys(values).forEach((key) => delete values[key]);
      callback?.();
      return Promise.resolve();
    }
  };
}

function createWorkerRuntime() {
  const local = createStorageArea({ tos_acknowledged_v1: true });
  const session = createStorageArea({ __llm_extension_runtime_epoch_v1: 1 });
  const runtime = {
    id: 'test-extension',
    lastError: null,
    onMessage: createEvent(),
    onStartup: createEvent(),
    onInstalled: createEvent(),
    getManifest: () => ({ version: 'test' }),
    getURL: (file) => `chrome-extension://test-extension/${file}`,
    sendMessage(_message, callback) {
      callback?.();
      return Promise.resolve();
    }
  };
  const tabs = {
    onRemoved: createEvent(),
    onUpdated: createEvent(),
    onActivated: createEvent(),
    sendMessage(_tabId, _message, options, callback) {
      (typeof options === 'function' ? options : callback)?.({ ok: true });
      return Promise.resolve({ ok: true });
    },
    update(tabId, update, callback) {
      const tab = { id: tabId, windowId: 1, url: 'https://chatgpt.com/', ...update };
      callback?.(tab);
      return Promise.resolve(tab);
    },
    query(_queryInfo, callback) {
      callback?.([]);
      return Promise.resolve([]);
    },
    get(tabId, callback) {
      const tab = { id: tabId, windowId: 1, index: 0, url: 'https://chatgpt.com/' };
      callback?.(tab);
      return Promise.resolve(tab);
    },
    create(createProperties, callback) {
      const tab = { id: 101, windowId: 1, index: 0, ...createProperties };
      callback?.(tab);
      return Promise.resolve(tab);
    },
    remove(_tabIds, callback) {
      callback?.();
      return Promise.resolve();
    },
    reload(tabId, _options, callback) {
      callback?.();
      return Promise.resolve(tabId);
    }
  };
  const alarms = {
    onAlarm: createEvent(),
    create: jest.fn(),
    clear: jest.fn(() => Promise.resolve(true)),
    clearAll: jest.fn(() => Promise.resolve(true)),
    get: jest.fn((_name, callback) => { callback?.(null); return Promise.resolve(null); }),
    getAll: jest.fn((callback) => { callback?.([]); return Promise.resolve([]); })
  };
  const chrome = {
    runtime,
    storage: { local, session, onChanged: createEvent() },
    tabs,
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: createEvent(),
      getLastFocused(_options, callback) { callback?.({ id: 1, focused: true }); },
      get(windowId, callback) { callback?.({ id: windowId, focused: true }); },
      update(windowId, update, callback) {
        const window = { id: windowId, ...update };
        callback?.(window);
        return Promise.resolve(window);
      },
      remove(_windowId, callback) { callback?.(); return Promise.resolve(); }
    },
    action: { onClicked: createEvent() },
    alarms,
    scripting: {
      executeScript(_details, callback) { callback?.([]); return Promise.resolve([]); }
    },
    debugger: {
      onEvent: createEvent(),
      onDetach: createEvent(),
      attach(_target, _version, callback) { callback?.(); },
      detach(_target, callback) { callback?.(); },
      sendCommand(_target, _command, _params, callback) { callback?.(); }
    }
  };

  const context = {
    console,
    chrome,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    performance,
    crypto: webcrypto,
    structuredClone: (value) => deserialize(serialize(value)),
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    AbortController,
    Buffer,
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    btoa: (value) => Buffer.from(value, 'binary').toString('base64')
  };
  context.self = context;
  context.importScripts = (...files) => {
    files.forEach((file) => {
      const absolutePath = path.resolve(repoRoot, 'background', file);
      vm.runInContext(fs.readFileSync(absolutePath, 'utf8'), context, { filename: absolutePath });
    });
  };
  vm.createContext(context);
  vm.runInContext(workerSource, context, { filename: 'background/index.js' });

  const routerListener = runtime.onMessage.listeners.find((listener) => listener.toString().includes('runSafely'));
  if (!routerListener) throw new Error('Full worker did not register its message-router listener');
  const sendMessage = (message, sender = {}) => new Promise((resolve) => {
    let responded = false;
    const sendResponse = (response) => {
      if (responded) return;
      responded = true;
      resolve(response);
    };
    let asyncResponse = false;
    runtime.onMessage.listeners.forEach((listener) => {
      if (listener(message, sender, sendResponse) === true) asyncResponse = true;
    });
    if (!asyncResponse && !responded) resolve(undefined);
  });

  return { context, chrome, runtime, sendMessage };
}

describe('full MV3 worker stop lifecycle', () => {
  test('active run state identifies the owner when older sessions lack sourceView', async () => {
    const { context, sendMessage } = createWorkerRuntime();
    await vm.runInContext('ensureInitialState()', context);
    vm.runInContext('jobState = { session: { startTime: 123, roundsInProgress: true }, llms: {} };', context);
    await expect(sendMessage({ type: 'GET_ACTIVE_RUN_STATE' }))
      .resolves.toMatchObject({ status: 'ok', active: true, sourceView: 'main' });
    vm.runInContext('jobState.session.pipelineRunId = "basic-run";', context);
    await expect(sendMessage({ type: 'GET_ACTIVE_RUN_STATE' }))
      .resolves.toMatchObject({ status: 'ok', active: true, sourceView: 'pipeline' });
    await sendMessage({ type: 'STOP_ALL' });
  });

  test('tab cleanup cancels the real model retry and reports actual retry state', async () => {
    const { context, chrome } = createWorkerRuntime();
    await vm.runInContext('ensureInitialState()', context);
    expect(vm.runInContext('typeof rateLimitTimers', context)).toBe('undefined');

    const llmName = 'GPT';
    const tabId = 102;
    await context.TabMapManager.setTab(llmName, tabId);
    context.setRateLimit(llmName, 60000);
    const retry = jest.fn();
    context.scheduleRateLimitRetry(llmName, retry);
    const alarmHandler = chrome.alarms.onAlarm.listeners.find((listener) =>
      listener.toString().includes('getLlmNameFromRateLimitAlarm'));

    expect(context.buildCleanupSnapshot(tabId, llmName, 'before').rateLimitRetry).toBe(true);
    context.cleanupTabResources(tabId, 'test_cleanup');

    expect(context.isRateLimited(llmName)).toBe(false);
    expect(context.hasRateLimitRetry(llmName)).toBe(false);
    expect(context.buildCleanupSnapshot(tabId, llmName, 'after').rateLimitRetry).toBe(false);
    expect(chrome.alarms.clear).toHaveBeenCalledWith('rate_limit_retry::GPT');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(chrome.storage.session.values['rateLimitUntilByModel.v1']).toEqual({});

    alarmHandler({ name: 'rate_limit_retry::GPT' });
    expect(retry).not.toHaveBeenCalled();
  });

  test('all-green automatic stop, repeated manual stop, and next start use real imported dependencies', async () => {
    const { context, chrome, sendMessage } = createWorkerRuntime();
    await vm.runInContext('ensureInitialState()', context);
    expect(vm.runInContext('typeof rateLimitTimers', context)).toBe('undefined');
    const dispatchId = 'GPT:stop-runtime:1';
    vm.runInContext(`jobState = {
      prompt: 'first prompt',
      attachments: [],
      session: {
        startTime: 12345,
        totalModels: 1,
        selectedModels: ['GPT'],
        sourceView: 'main',
        pipelineRunId: null,
        pipelineControl: PipelineFSM.startRun({ sessionId: 12345, stage: 'dispatch', state: 'STARTING' })
      },
      llms: {
        GPT: {
          llmName: 'GPT',
          status: 'GENERATING',
          tabId: 101,
          transportRequestId: 'request-gpt',
          lastDispatchMeta: { dispatchId: '${dispatchId}' },
          recentDispatchIds: ['${dispatchId}']
        }
      }
    }; resultsTabId = 909;`, context);
    await context.TabMapManager.setTab('GPT', 101);
    const rateLimitRetry = jest.fn();
    const rateLimitAlarmHandler = chrome.alarms.onAlarm.listeners.find((listener) =>
      listener.toString().includes('getLlmNameFromRateLimitAlarm'));
    context.setRateLimit('GPT', 60000);
    context.scheduleRateLimitRetry('GPT', rateLimitRetry);

    await expect(sendMessage({
      type: 'ANSWER_CARD_RENDER_EVALUATED',
      llmName: 'GPT',
      meta: {
        transportRequestId: 'request-gpt',
        dispatchId,
        answerEndMarkerSeen: true,
        usableResult: true
      }
    }, { tab: { id: 909 } })).resolves.toMatchObject({ ok: true });
    expect(vm.runInContext('jobState.session.startTime', context)).toBeNull();
    expect(vm.runInContext('jobState.llms.GPT.cardAnswerComplete', context)).toBe(true);
    expect(vm.runInContext("isRateLimited('GPT')", context)).toBe(false);
    expect(chrome.alarms.clear).toHaveBeenCalledWith('rate_limit_retry::GPT');
    rateLimitAlarmHandler({ name: 'rate_limit_retry::GPT' });
    expect(rateLimitRetry).not.toHaveBeenCalled();

    await expect(sendMessage({ type: 'STOP_ALL' })).resolves.toEqual({ success: true });
    expect(vm.runInContext('Object.keys(jobState)', context)).toEqual([]);
    await expect(sendMessage({ type: 'GET_ACTIVE_RUN_STATE' }))
      .resolves.toMatchObject({ status: 'ok', active: false, sessionId: null });

    await expect(sendMessage({
      type: 'START_FULLPAGE_PROCESS',
      prompt: 'next prompt',
      selectedLLMs: [],
      sourceView: 'main',
      useApiFallback: false
    }, { tab: { id: 909 } })).resolves.toEqual({ status: 'process_started' });
    expect(vm.runInContext('jobState.prompt', context)).toBe('next prompt');
    expect(vm.runInContext('jobState.session.sourceView', context)).toBe('main');

    await sendMessage({ type: 'STOP_ALL' });
    expect(vm.runInContext('Object.keys(jobState)', context)).toEqual([]);
  });
});
