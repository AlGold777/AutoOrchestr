const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.join(__dirname, '..');
const MESSAGE_ROUTER_SOURCE = fs.readFileSync(path.join(repoRoot, 'background', 'message-router.js'), 'utf8');
const JOB_ORCHESTRATOR_SOURCE = fs.readFileSync(path.join(repoRoot, 'background', 'job-orchestrator.js'), 'utf8');
const DISPATCH_COORDINATOR_SOURCE = fs.readFileSync(path.join(repoRoot, 'background', 'dispatch-coordinator.js'), 'utf8');

const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const sliceBetween = (source, startNeedle, endNeedle) => {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

const listFiles = (dir) => {
  const absolute = path.join(repoRoot, dir);
  return fs.readdirSync(absolute)
    .filter((name) => fs.statSync(path.join(absolute, name)).isFile())
    .map((name) => path.join(dir, name));
};

function createRouterSandbox() {
  let onMessageListener = null;
  const storageData = {};
  const sentTabMessages = [];
  const activatedTabs = [];
  const context = {
    console,
    Promise,
    Map,
    Set,
    Date,
    Math,
    Array,
    Object,
    Number,
    String,
    Boolean,
    RegExp,
    JSON,
    setTimeout,
    clearTimeout,
    TERMINAL_STATUSES: ['SUCCESS', 'PARTIAL', 'ERROR', 'NO_SEND', 'EXTRACT_FAILED', 'EXTERNAL_LLM_FAILURE', 'USER_ACTION_REQUIRED', 'UNCERTAIN'],
    jobState: {
      session: { startTime: 12345 },
      llms: {
        GPT: { status: 'GENERATING' }
      }
    },
    CompressedStorage: {
      get: jest.fn(() => Promise.resolve([])),
      set: jest.fn(() => Promise.resolve()),
      migrate: jest.fn(() => Promise.resolve()),
      pruneIfNeeded: jest.fn(() => Promise.resolve())
    },
    clearDiagnosticsRuntimeLogs: jest.fn(() => false),
    saveJobState: jest.fn(),
    loadJobState: jest.fn(() => Promise.resolve()),
    loadResolutionMetrics: jest.fn(() => Promise.resolve()),
    loadCircuitBreakerState: jest.fn(() => Promise.resolve()),
    startProcess: jest.fn(() => Promise.resolve()),
    stopAllProcesses: jest.fn(),
    writeDiagnosticsEventsToStorage: jest.fn(() => Promise.resolve()),
    TabMapManager: {
      load: jest.fn(() => Promise.resolve()),
      get: jest.fn((llmName) => (llmName === 'GPT' ? 101 : null)),
      getNameByTabId: jest.fn((tabId) => (tabId === 101 ? 'GPT' : null)),
      entries: jest.fn(() => []),
      removeByName: jest.fn()
    },
    activateTabForDispatch: jest.fn((tabId) => {
      activatedTabs.push(tabId);
      return Promise.resolve(true);
    }),
    withPromptDispatchFocusLock: jest.fn((fn) => fn()),
    chrome: {
      runtime: {
        lastError: null,
        onMessage: { addListener: (fn) => { onMessageListener = fn; } },
        onStartup: { addListener: () => {} },
        onInstalled: { addListener: () => {} },
        getManifest: () => ({ version: 'test' })
      },
      storage: {
        local: {
          get: jest.fn((key, callback) => {
            const payload = Array.isArray(key)
              ? key.reduce((acc, item) => ({ ...acc, [item]: storageData[item] }), {})
              : { [key]: storageData[key] };
            if (typeof callback === 'function') callback(payload);
            return Promise.resolve(payload);
          }),
          set: jest.fn((value) => {
            Object.assign(storageData, value || {});
            return Promise.resolve();
          })
        },
        session: {
          get: jest.fn(() => Promise.resolve({})),
          set: jest.fn(() => Promise.resolve())
        },
        onChanged: { addListener: () => {} }
      },
      tabs: {
        onRemoved: { addListener: () => {} },
        onUpdated: { addListener: () => {} },
        onActivated: { addListener: () => {} },
        sendMessage: jest.fn((tabId, message) => {
          sentTabMessages.push({ tabId, message });
          return Promise.resolve();
        }),
        update: jest.fn((tabId, _update, callback) => {
          activatedTabs.push(tabId);
          if (typeof callback === 'function') callback();
        }),
        query: jest.fn(() => Promise.resolve([]))
      },
      windows: { onFocusChanged: { addListener: () => {} } },
      alarms: {
        create: () => {},
        clear: () => {},
        onAlarm: { addListener: () => {} }
      },
      action: { onClicked: { addListener: () => {} } }
    },
    self: null
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(MESSAGE_ROUTER_SOURCE, context, { filename: 'background/message-router.js' });
  return {
    context,
    sentTabMessages,
    activatedTabs,
    sendMessage(message, sender = { tab: { id: 101 } }) {
      return new Promise((resolve) => {
        const handled = onMessageListener(message, sender, resolve);
        if (handled !== true) {
          setTimeout(() => resolve(undefined), 0);
        }
      });
    }
  };
}

function createOrchestratorSandbox({ exposeTriggerResponseCollectionPing = false } = {}) {
  const context = {
    console,
    Promise,
    Map,
    Set,
    Date,
    Math,
    Array,
    Object,
    Number,
    String,
    Boolean,
    RegExp,
    JSON,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    SUCCESS_STATUSES: ['COPY_SUCCESS', 'SUCCESS', 'DONE', 'COMPLETE', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN'],
    FAILURE_STATUSES: ['ERROR', 'CRITICAL_ERROR', 'RECOVERABLE_ERROR', 'UNRESPONSIVE', 'CIRCUIT_OPEN', 'API_FAILED', 'NO_SEND', 'EXTRACT_FAILED', 'STREAM_TIMEOUT'],
    TERMINAL_STATUSES: ['COPY_SUCCESS', 'SUCCESS', 'DONE', 'COMPLETE', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN', 'ERROR', 'CRITICAL_ERROR', 'RECOVERABLE_ERROR', 'UNRESPONSIVE', 'CIRCUIT_OPEN', 'API_FAILED', 'NO_SEND', 'EXTRACT_FAILED', 'STREAM_TIMEOUT'],
    jobState: {
      session: { startTime: 12345, selectedModels: [] },
      llms: {}
    },
    chrome: {
      runtime: { lastError: null, getManifest: () => ({ version: 'test' }) },
      storage: {
        local: {
          set: jest.fn(() => Promise.resolve()),
          get: jest.fn(() => Promise.resolve({})),
          remove: jest.fn(() => Promise.resolve())
        }
      },
      tabs: {
        sendMessage: jest.fn(() => Promise.resolve()),
        remove: jest.fn((_, callback) => { if (typeof callback === 'function') callback(); })
      },
      alarms: {
        create: jest.fn(),
        clear: jest.fn()
      }
    },
    CompressedStorage: {
      set: jest.fn(() => Promise.resolve()),
      get: jest.fn(() => Promise.resolve(null)),
      remove: jest.fn(() => Promise.resolve())
    },
    TabMapManager: {
      entries: jest.fn(() => []),
      clear: jest.fn(() => Promise.resolve()),
      get: jest.fn(() => null),
      removeByName: jest.fn()
    },
    self: null,
    pendingPings: new Map(),
    pendingPingByTabId: new Map(),
    healthCheckFailuresByTabId: new Map(),
    lastHealthCheckReportAtByTabId: new Map(),
    llmActivityMap: {},
    evaluatorTabId: null,
    jobMetadata: new Map(),
    llmRequestMap: {},
    postSuccessScrollTimers: new Map(),
    deferredAnswerTimers: {},
    rateLimitState: new Map(),
    rateLimitTimers: new Map(),
    stopHumanPresenceLoop: jest.fn(),
    stopHeartbeatMonitor: jest.fn(),
    clearActiveListeners: jest.fn(),
    clearPingState: jest.fn(),
    clearLateAnswerSnapshotCache: jest.fn(() => Promise.resolve()),
    closePingWindowForTab: jest.fn(),
    clearBudgetPhases: jest.fn(),
    broadcastGlobalState: jest.fn(),
    isValidTabId: (tabId) => Number.isInteger(tabId) && tabId > 0
  };
  context.self = context;
  vm.createContext(context);
  const source = exposeTriggerResponseCollectionPing
    ? JOB_ORCHESTRATOR_SOURCE.replace(
      'const triggerResponseCollectionPing =',
      'const triggerResponseCollectionPing = self.triggerResponseCollectionPingForTest ='
    )
    : JOB_ORCHESTRATOR_SOURCE;
  vm.runInContext(source, context, { filename: 'background/job-orchestrator.js' });
  return context;
}

function createDispatchCoordinatorSandbox(entry = {}) {
  const tabGetCallbacks = [];
  const sentMessages = [];
  const context = {
    console,
    Promise,
    Map,
    Set,
    Date,
    Math,
    Array,
    Object,
    Number,
    String,
    Boolean,
    RegExp,
    JSON,
    setTimeout,
    clearTimeout,
    MutexManager: class { clear() {} },
    TimingConfig: { getTiming: (_name, fallback) => fallback },
    TERMINAL_STATUSES: ['SUCCESS', 'PARTIAL', 'ERROR', 'NO_SEND', 'EXTRACT_FAILED', 'STOPPED'],
    jobState: {
      session: { startTime: 12345 },
      llms: { GPT: entry }
    },
    TabMapManager: { get: jest.fn(() => 101) },
    appendLogEntry: jest.fn(),
    extendPingWindowForTab: jest.fn(),
    isValidTabId: (tabId) => Number.isInteger(tabId) && tabId > 0,
    AUTO_PING_WINDOW_MS: 1000,
    chrome: {
      runtime: { lastError: null },
      tabs: {
        get: jest.fn((_tabId, callback) => tabGetCallbacks.push(callback)),
        sendMessage: jest.fn((tabId, message, callback) => {
          sentMessages.push({ tabId, message });
          callback?.({ accepted: true });
        })
      }
    },
    self: null
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(DISPATCH_COORDINATOR_SOURCE, context, { filename: 'background/dispatch-coordinator.js' });
  return { context, tabGetCallbacks, sentMessages };
}

describe('session stability validation guards', () => {
  test('content-side focus requests require active session and active request', () => {
    const contentUtils = read('content-scripts/content-utils.js');
    const focusBlock = sliceBetween(
      contentUtils,
      'const requestFocusFromBackground =',
      'const readInputValue ='
    );

    expect(focusBlock).toContain('if (!storedSessionId) return false;');
    expect(focusBlock).toContain('if (sessionExpired) return false;');
    expect(focusBlock).toContain('if (!hasActiveRequest()) return false;');
    expect(focusBlock).toContain("type: 'NEED_FOCUS'");
    expect(focusBlock).toContain('sessionId: storedSessionId');

    const contentScriptFiles = listFiles('content-scripts')
      .filter((file) => /^content-scripts\/content-.*\.js$/.test(file));
    const focusCallers = contentScriptFiles.filter((file) => (
      read(file).includes('requestFocusFromBackground')
    ));
    expect(focusCallers).toEqual(['content-scripts/content-utils.js']);
  });

  test('background rejects stale NEED_FOCUS before activating any tab', () => {
    const router = read('background/message-router.js');
    const needFocusBlock = sliceBetween(
      router,
      "case 'NEED_FOCUS':",
      "case 'HUMANOID_EVENT':"
    );

    const staleCheck = needFocusBlock.indexOf('requestSessionId !== currentSessionId');
    const sessionExpiredNotice = needFocusBlock.indexOf("type: 'SESSION_EXPIRED'");
    const llmCheck = needFocusBlock.indexOf('const llmName =');
    const tabMapCheck = needFocusBlock.indexOf('const expectedTabId = TabMapManager.get(llmName);');
    const entryCheck = needFocusBlock.indexOf('const entry = jobState?.llms?.[llmName];');
    const terminalCheck = needFocusBlock.indexOf('if (isTerminalRouterEntry(entry))');
    const activation = needFocusBlock.indexOf('activateTabForDispatch');

    expect(staleCheck).toBeGreaterThanOrEqual(0);
    expect(sessionExpiredNotice).toBeGreaterThan(staleCheck);
    expect(llmCheck).toBeGreaterThan(sessionExpiredNotice);
    expect(tabMapCheck).toBeGreaterThan(llmCheck);
    expect(entryCheck).toBeGreaterThan(tabMapCheck);
    expect(terminalCheck).toBeGreaterThan(entryCheck);
    expect(activation).toBeGreaterThan(terminalCheck);
    expect(needFocusBlock).not.toContain('chrome.tabs.update(');
    expect(needFocusBlock).toContain('self.withPromptDispatchFocusLock(focus)');
    expect(needFocusBlock).toContain("sendResponse({ status: 'focus_denied_stale' });");
  });

  test('message router denies stale NEED_FOCUS without activating the tab', async () => {
    const { sentTabMessages, activatedTabs, sendMessage } = createRouterSandbox();

    const response = await sendMessage({
      type: 'NEED_FOCUS',
      sessionId: 99999,
      reason: 'stale_tab'
    });

    expect(response).toEqual({ status: 'focus_denied_stale' });
    expect(activatedTabs).toEqual([]);
    expect(sentTabMessages).toEqual([
      {
        tabId: 101,
        message: {
          type: 'SESSION_EXPIRED',
          currentSessionId: 12345
        }
      }
    ]);
  });

  test('message router grants NEED_FOCUS only after session, model, tab and status checks pass', async () => {
    const { context, activatedTabs, sendMessage } = createRouterSandbox();

    const response = await sendMessage({
      type: 'NEED_FOCUS',
      sessionId: 12345,
      reason: 'active_request'
    });

    expect(response).toEqual({ status: 'focus_granted' });
    expect(context.TabMapManager.getNameByTabId).toHaveBeenCalledWith(101);
    expect(context.TabMapManager.get).toHaveBeenCalledWith('GPT');
    expect(context.activateTabForDispatch).toHaveBeenCalledWith(101);
    expect(context.withPromptDispatchFocusLock).toHaveBeenCalledTimes(1);
    expect(activatedTabs).toEqual([101]);
  });

  test('stop/start timer boundary keeps session timers registered and observable', () => {
    const orchestrator = read('background/job-orchestrator.js');
    const stopBlock = sliceBetween(
      orchestrator,
      'function stopAllProcesses(',
      'async function startProcess'
    );
    const clearBlock = sliceBetween(
      orchestrator,
      'function clearSessionTimers()',
      'function hasOpenModelRuns'
    );

    expect(orchestrator).toContain('const sessionTimers = new Set();');
    expect(orchestrator).toContain('const sessionTimerMetadata = new Map();');
    expect(orchestrator).toContain('function registerSessionTimer(timerId)');
    expect(orchestrator).toContain('function deregisterSessionTimer(timerId)');
    expect(clearBlock).toContain('console.warn(`[BACKGROUND] clearSessionTimers clearing ${sessionTimers.size} session timers`');
    expect(clearBlock).toContain('sessionTimers.clear();');
    expect(clearBlock).toContain('sessionTimerMetadata.clear();');
    expect(stopBlock).toContain('clearSessionTimers();');

    expect(read('background/dispatch-coordinator.js')).toContain('self.registerSessionTimer');
    expect(read('background/message-router.js')).toContain('self.registerSessionTimer');
    expect(read('background/health-monitor.js')).toContain('self.registerSessionTimer');
  });

  test('stopping an unfinished start releases the reservation without letting the old start resume', async () => {
    const context = createOrchestratorSandbox();
    const reads = [];
    context.chrome.storage.local.get = jest.fn(key => key === 'tos_acknowledged_v1'
      ? new Promise(resolve => reads.push(resolve)) : Promise.resolve({}));
    const oldStart = context.startProcess('Old', ['GPT'], 909);
    const beforeStop = context.getOrchestratorStopGeneration();
    context.stopAllProcesses('pause');
    expect(context.getOrchestratorStopGeneration()).toBe(beforeStop + 1);
    const nextStart = context.startProcess('Next', ['GPT'], 909);
    expect(reads).toHaveLength(2);
    reads[0]({ tos_acknowledged_v1: true });
    expect(await oldStart).toMatchObject({ ok: false, errorCode: 'RUN_CANCELLED' });
    expect(await context.startProcess('Duplicate', ['GPT'], 909)).toMatchObject({ ok: false, errorCode: 'RUN_ALREADY_ACTIVE' });
    reads[1]({ tos_acknowledged_v1: false });
    expect(await nextStart).toMatchObject({ ok: false, errorCode: 'TOS_ACK_REQUIRED' });
  });

  test('start cancelled during proof-ledger admission cannot continue into a replacement run', async () => {
    const context = createOrchestratorSandbox();
    const pendingAdmissions = [];
    const admissionReached = [];
    const createdStates = [];
    context.chrome.storage.local.get = jest.fn((key) => key === 'tos_acknowledged_v1'
      ? Promise.resolve({ tos_acknowledged_v1: true })
      : Promise.resolve({}));
    context.PipelineRunState = {
      create: ({ prompt, selectedModels, startedAt }) => {
        const state = { prompt, session: { startTime: startedAt, selectedModels }, llms: {} };
        createdStates.push(state);
        return state;
      }
    };
    context.resultsTabId = null;
    context.TELEMETRY_SAMPLE_RATE = 0.1;
    context.llmStartChains = {};
    context.promptSubmitWaiters = new Map();
    context.dispatchMutexManager = { clear: jest.fn() };
    context.resolveTelemetrySampling = () => false;
    context.ProofTelemetryLedger = {
      beginRun: jest.fn((sessionId) => new Promise((resolve) => {
        pendingAdmissions.push(resolve);
        admissionReached[pendingAdmissions.length - 1]?.(sessionId);
      }))
    };
    const firstAdmission = new Promise((resolve) => { admissionReached[0] = resolve; });
    const oldStart = context.startProcess('Old', ['GPT'], 909);
    await Promise.race([
      firstAdmission,
      oldStart.then(() => { throw new Error('old start returned before proof-ledger admission'); })
    ]);

    context.stopAllProcesses('replace_run');
    const secondAdmission = new Promise((resolve) => { admissionReached[1] = resolve; });
    const nextStart = context.startProcess('Next', ['GPT'], 909);
    await Promise.race([
      secondAdmission,
      nextStart.then(() => { throw new Error('replacement start returned before proof-ledger admission'); })
    ]);
    const replacementState = createdStates[1];
    expect(replacementState.llms).toEqual({});
    expect(replacementState.session.runMode).toBeUndefined();

    pendingAdmissions[0]();
    await expect(oldStart).resolves.toMatchObject({ ok: false, errorCode: 'RUN_CANCELLED' });
    expect(context.jobState).toBe(replacementState);
    expect(replacementState.llms).toEqual({});
    expect(replacementState.session.runMode).toBeUndefined();

    context.stopAllProcesses('finish_test');
    pendingAdmissions[1]();
    await expect(nextStart).resolves.toMatchObject({ ok: false, errorCode: 'RUN_CANCELLED' });
  });

  test.each([
    ['Stop', (context) => { context.jobState.session.startTime = null; }],
    ['completed card', (context) => { context.jobState.llms.GPT.cardAnswerComplete = true; }],
    ['replaced dispatch', (context) => { context.jobState.llms.GPT.lastDispatchMeta.dispatchId = 'dispatch-new'; }]
  ])('queued GET_ANSWER is not sent after %s while tabs.get is pending', (_label, invalidate) => {
    const entry = { status: 'GENERATING', tabId: 101, lastDispatchMeta: { dispatchId: 'dispatch-old' } };
    const { context, tabGetCallbacks, sentMessages } = createDispatchCoordinatorSandbox(entry);
    const settled = jest.fn();

    context.sendMessageSafely(101, 'GPT', {
      type: 'GET_ANSWER',
      meta: { runSessionId: 12345, dispatchId: 'dispatch-old' }
    }, 2, settled);
    expect(tabGetCallbacks).toHaveLength(1);

    invalidate(context);
    tabGetCallbacks[0]({ id: 101 });

    expect(sentMessages).toEqual([]);
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  test('completed card rejects a new GET_ANSWER before tab lookup', () => {
    const entry = { status: 'GENERATING', cardAnswerComplete: true, tabId: 101, lastDispatchMeta: { dispatchId: 'dispatch-old' } };
    const { context, tabGetCallbacks, sentMessages } = createDispatchCoordinatorSandbox(entry);
    const settled = jest.fn();

    context.sendMessageSafely(101, 'GPT', {
      type: 'GET_ANSWER',
      meta: { runSessionId: 12345, dispatchId: 'dispatch-old' }
    }, 2, settled);

    expect(tabGetCallbacks).toHaveLength(0);
    expect(sentMessages).toEqual([]);
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ terminal: true, reason: 'model_terminal' }));
  });

  test('current GET_ANSWER still sends after the tab lookup resolves', () => {
    const entry = { status: 'GENERATING', tabId: 101, lastDispatchMeta: { dispatchId: 'dispatch-current' } };
    const { context, tabGetCallbacks, sentMessages } = createDispatchCoordinatorSandbox(entry);
    const settled = jest.fn();
    const message = { type: 'GET_ANSWER', meta: { runSessionId: 12345, dispatchId: 'dispatch-current' } };

    context.sendMessageSafely(101, 'GPT', message, 2, settled);
    tabGetCallbacks[0]({ id: 101 });

    expect(sentMessages).toEqual([{ tabId: 101, message }]);
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  test('queued passive probes are not sent after Stop while tabs.get is pending', () => {
    const entry = { status: 'GENERATING', tabId: 101, lastDispatchMeta: { dispatchId: 'dispatch-old' } };
    const { context, tabGetCallbacks, sentMessages } = createDispatchCoordinatorSandbox(entry);
    const onSuccess = jest.fn();

    context.sendPassiveMessageWithRetries(101, 'GPT', {
      action: 'getResponses',
      meta: { runSessionId: 12345, dispatchId: 'dispatch-old' }
    }, { onSuccess });
    expect(tabGetCallbacks).toHaveLength(1);

    context.jobState.session.startTime = null;
    tabGetCallbacks[0]({ id: 101 });

    expect(sentMessages).toEqual([]);
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ status: 'ignored_stale' }));
  });

  test('LLM_JOB_CREATED carries the producer request identity', () => {
    const context = createOrchestratorSandbox();
    const sendMessage = jest.fn();
    context.sendMessageToResultsTab = sendMessage;
    context.jobState.session.sourceView = 'main';
    context.jobState.session.pipelineRunId = 'pipeline-1';
    context.jobState.llms.GPT = { transportRequestId: 'transport-1' };

    context.initRequestMetadata('GPT', 101, 'https://provider.test');

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'LLM_JOB_CREATED',
      llmName: 'GPT',
      transportRequestId: 'transport-1',
      sourceView: 'main',
      pipelineRunId: 'pipeline-1'
    }));
  });

  test('terminal response-collection callback does not recover or mutate a completed card', () => {
    const context = createOrchestratorSandbox({ exposeTriggerResponseCollectionPing: true });
    const entry = {
      status: 'GENERATING',
      cardAnswerComplete: false,
      pingTransportErrorCount: 4,
      lastDispatchMeta: { dispatchId: 'dispatch-current' }
    };
    let pingOptions;
    const recover = jest.fn(() => Promise.resolve());
    context.jobState.llms.GPT = entry;
    context.sendPassiveMessageWithRetries = jest.fn((_tabId, _llmName, _message, options) => {
      pingOptions = options;
    });
    context.extendPingWindowForLLM = jest.fn();
    context.recoverAnswerViaDomSnapshot = recover;

    context.triggerResponseCollectionPingForTest('GPT', 101, 'test', { forceEmitOnUnchanged: true });
    expect(pingOptions).toBeDefined();

    entry.cardAnswerComplete = true;
    pingOptions.onSuccess({ status: 'ignored_terminal' });

    expect(entry.pingTransportErrorCount).toBe(4);
    expect(recover).not.toHaveBeenCalled();
  });

  test('automatic completion stops the session while preserving answers', () => {
    const context = createOrchestratorSandbox();
    context.jobState.llms.GPT = { answer: 'Complete answer', status: 'SUCCESS', cardAnswerComplete: true };
    context.stopAllProcesses('answer_cards_complete', { preserveResults: true });
    expect(context.jobState.session.startTime).toBeNull();
    expect(context.jobState.session.roundsInProgress).toBe(false);
    expect(context.jobState.llms.GPT).toMatchObject({ answer: 'Complete answer', status: 'SUCCESS', cardAnswerComplete: true });
    expect(context.stopHeartbeatMonitor).toHaveBeenCalled();
  });

  test('stopAllProcesses clears registered session timers before they can fire', () => {
    jest.useFakeTimers();
    try {
      const context = createOrchestratorSandbox();
      const callback = jest.fn();
      const timerId = context.registerSessionTimer(setTimeout(callback, 1000));

      expect(timerId).toBeTruthy();
      context.stopAllProcesses('test_stop', { closeTabs: false });
      jest.advanceTimersByTime(1500);

      expect(callback).not.toHaveBeenCalled();
      expect(context.TabMapManager.clear).toHaveBeenCalled();
      expect(context.broadcastGlobalState).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
