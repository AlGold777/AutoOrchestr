/** @jest-environment node */
// Locks the exact RESET_WORKING_SESSION message handler: sender authorization,
// reset ordering, storage failure handling and preservation of saved history.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROUTER_SRC = fs.readFileSync(path.join(__dirname, '..', 'background', 'message-router.js'), 'utf8');
const TELEMETRY_SRC = fs.readFileSync(path.join(__dirname, '..', 'background', 'telemetry-logs.js'), 'utf8');

function extractResetWorkingSessionBody() {
  const marker = "case 'RESET_WORKING_SESSION': {";
  const start = ROUTER_SRC.indexOf(marker);
  const end = ROUTER_SRC.indexOf("case 'REGISTER_RESULTS_TAB':", start);
  if (start < 0 || end < 0) throw new Error('RESET_WORKING_SESSION handler was not found');
  return ROUTER_SRC.slice(start + marker.length, end).replace(/\s*\}\s*$/, '\n');
}

function extractDeliveryAppendBlock() {
  const marker = "if (message?.type === 'DELIVERY_JOURNAL_APPEND') {";
  const start = ROUTER_SRC.indexOf(marker);
  const end = ROUTER_SRC.indexOf("if (message?.type === 'DELIVERY_JOURNAL_SNAPSHOT')", start);
  if (start < 0 || end < 0) throw new Error('DELIVERY_JOURNAL_APPEND block was not found');
  return ROUTER_SRC.slice(start, end);
}

function extractDiagEventBody() {
  const marker = "case 'DIAG_EVENT': {";
  const start = ROUTER_SRC.indexOf(marker);
  const end = ROUTER_SRC.indexOf("case 'GET_RUN_OUTCOME_SUMMARY':", start);
  if (start < 0 || end < 0) throw new Error('DIAG_EVENT handler was not found');
  return ROUTER_SRC.slice(start + marker.length, end).replace(/\s*\}\s*$/, '\n');
}

function makeTelemetryHarness({ cutoff = 0, session = null, mutate } = {}) {
  const self = { __workingSessionStartedAt: cutoff };
  const telemetryPrelude = TELEMETRY_SRC.slice(
    TELEMETRY_SRC.indexOf('function isPreviousWorkingSessionEvent(event = {}) {'),
    TELEMETRY_SRC.indexOf('self.discardPendingDiagnostics = discardPendingDiagnostics;')
  );
  const persistStart = TELEMETRY_SRC.indexOf('async function persistDiagnosticEvent(');
  const persistEnd = TELEMETRY_SRC.indexOf('\nfunction dispatchTelemetry(', persistStart);
  if (persistStart < 0 || persistEnd < 0) throw new Error('persistDiagnosticEvent was not found');
  const persistSource = TELEMETRY_SRC.slice(persistStart, persistEnd);
  const sandbox = {
    self,
    jobState: { session },
    resolveLlmName: (name) => name,
    shouldIgnorePostTerminalDiagnostic: () => false,
    mutateDiagnosticsEventsConsistent: mutate || (async (fn) => fn([])),
    trimDiagnosticsBuffer: (entries) => entries,
    dropOldestUnpinned: (entries) => entries.slice(1),
    DIAGNOSTICS_EVENTS_MAX_ITEMS: 4000,
    DIAGNOSTICS_EVENTS_MAX_BYTES: 1_000_000
  };
  vm.createContext(sandbox);
  vm.runInContext(`${telemetryPrelude}\n${persistSource}\nglobalThis.testHooks = { isPreviousWorkingSessionEvent, persistDiagnosticEvent };`, sandbox);
  return { self, hooks: sandbox.testHooks };
}

function makeDeliveryAppendHarness({ initialState, storeAppend } = {}) {
  const self = {};
  const block = extractDeliveryAppendBlock();
  const sandbox = {
    self,
    ensureInitialState: initialState || (() => Promise.resolve()),
    MessageDeliveryStore: { append: storeAppend || (() => Promise.resolve({ ok: true })) },
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(`globalThis.testHandler = function (message, sender, sendResponse) {\n${block}\nreturn false;\n};`, sandbox);
  return { self, handler: sandbox.testHandler };
}

function makeDiagEventHarness({ cutoff = 0, sessionStart = 500, mutate } = {}) {
  const self = {
    __workingSessionStartedAt: cutoff,
    mutateDiagnosticsEventsConsistent: mutate,
    isPreviousWorkingSessionEvent: (event) => {
      const marker = Number(self.__workingSessionStartedAt) || 0;
      const run = Number(event.meta?.runSessionId || event.meta?.sessionId || event.runSessionId || event.sessionId);
      return marker > 0 && run > 0 && run < marker;
    }
  };
  const body = extractDiagEventBody();
  const sandbox = {
    self,
    jobState: { session: { startTime: sessionStart }, llms: { GPT: { tabId: 41 } } },
    TabMapManager: { get: () => 41 },
    resolveLlmName: (name) => name,
    diagTrimDiagnosticsBuffer: (events) => events,
    diagDropOldestUnpinned: (events) => events.slice(1),
    DIAGNOSTICS_EXPORT_MAX_ITEMS: 4000,
    DIAGNOSTICS_EXPORT_MAX_BYTES: 1_000_000,
    writeDiagnosticsEventsToStorage: async () => {},
    readDiagnosticsEventsFromStorage: async () => [],
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(`globalThis.testHandler = function (message, sender, sendResponse) {\n${body}\n};`, sandbox);
  return { self, handler: sandbox.testHandler };
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('Expected reset handler operation was not reached');
}

function makeHarness({
  sender = { id: 'extension-id', url: 'chrome-extension://extension-id/pipeline_panel.html' },
  fsmWrite = Promise.resolve(),
  diagnosticsClear = Promise.resolve(),
  deliveryClear = Promise.resolve(),
  localRemove = Promise.resolve(),
  localSet = Promise.resolve()
} = {}) {
  const calls = [];
  let response = null;
  const jobState = { session: { startTime: 10, pipelineRunId: 'old-run' }, llms: { GPT: { logs: ['old'] } } };
  const tabMapManager = { clear: () => { calls.push(['tabMapClear']); return Promise.resolve(); } };
  const self = {
    stopAllProcesses: (...args) => calls.push(['stopAllProcesses', ...args]),
    clearParticipantRun: (runId) => { calls.push(['clearParticipantRun', runId]); return Promise.resolve(); },
    TabMapManager: tabMapManager,
    PipelineFSM: {
      normalizeControlState: (input) => {
        calls.push(['normalizeControlState', input]);
        return { state: 'IDLE', ...input };
      },
      persistControlState: (state) => {
        calls.push(['persistControlState', state]);
        return fsmWrite;
      }
    },
    MessageDeliveryStore: {
      clear: () => {
        calls.push(['deliveryClear']);
        return deliveryClear;
      }
    }
  };
  const chrome = {
    runtime: {
      id: 'extension-id',
      getURL: (page) => `chrome-extension://extension-id/${page}`
    },
    storage: {
      local: {
        remove: (keys) => {
          calls.push(['localRemove', keys]);
          return localRemove;
        },
        set: (value) => {
          calls.push(['localSet', value]);
          return localSet;
        }
      }
    }
  };
  const body = extractResetWorkingSessionBody();
  const handler = vm.runInNewContext(
    `(function (message, sender, sendResponse) {\n${body}\n})`,
    {
      self,
      chrome,
      jobState,
      TabMapManager: tabMapManager,
      writeDiagnosticsEventsToStorage: (entries) => {
        calls.push(['diagnosticsClear', entries]);
        return diagnosticsClear;
      },
      sendResponse: (value) => { response = value; },
      Date,
      console
    }
  );
  const invoke = (nextSender = sender) => handler({ type: 'RESET_WORKING_SESSION' }, nextSender, (value) => { response = value; });
  return { calls, invoke, response: () => response, self };
}

describe('RESET_WORKING_SESSION background handler', () => {
  test('rejects unauthorized sender before mutating working-session state', () => {
    const harness = makeHarness();

    const handled = harness.invoke({ id: 'other-extension', url: 'chrome-extension://other/result_new.html' });

    expect(handled).toBe(false);
    expect(harness.response()).toEqual({ success: false, error: 'working_session_sender_not_authorized' });
    expect(harness.calls).toEqual([]);
  });

  test('stops the old run without closing provider tabs and persists an IDLE FSM state', async () => {
    const fsmWrite = deferred();
    const harness = makeHarness({ fsmWrite: fsmWrite.promise });

    expect(harness.invoke()).toBe(true);
    await waitUntil(() => harness.calls.some(([name]) => name === 'persistControlState'));

    expect(harness.calls[0]).toEqual(['stopAllProcesses', 'page_reload', { closeTabs: false }]);
    expect(harness.calls).toContainEqual(['clearParticipantRun', 'old-run']);
    expect(harness.calls.indexOf(harness.calls.find(([name]) => name === 'tabMapClear'))).toBe(1);
    expect(harness.calls).toContainEqual(['normalizeControlState', {}]);
    expect(harness.calls.find(([name]) => name === 'persistControlState')[1]).toEqual({ state: 'IDLE' });
    expect(harness.response()).toBeNull();
    fsmWrite.resolve();
    await waitUntil(() => harness.calls.some(([name]) => name === 'diagnosticsClear'));
  });

  test('acknowledges only after serialized telemetry clear, delivery clear and UI storage reset complete', async () => {
    const fsmWrite = deferred();
    const diagnosticsClear = deferred();
    const deliveryClear = deferred();
    const localRemove = deferred();
    const localSet = deferred();
    const harness = makeHarness({
      fsmWrite: fsmWrite.promise,
      diagnosticsClear: diagnosticsClear.promise,
      deliveryClear: deliveryClear.promise,
      localRemove: localRemove.promise,
      localSet: localSet.promise
    });

    harness.invoke();
    await waitUntil(() => harness.calls.some(([name]) => name === 'persistControlState'));
    fsmWrite.resolve();
    await waitUntil(() => harness.calls.some(([name]) => name === 'diagnosticsClear'));
    expect(harness.response()).toBeNull();
    expect(harness.calls).toContainEqual(['diagnosticsClear', []]);

    diagnosticsClear.resolve();
    await waitUntil(() => harness.calls.some(([name]) => name === 'deliveryClear'));
    expect(harness.response()).toBeNull();

    deliveryClear.resolve();
    await waitUntil(() => harness.calls.some(([name]) => name === 'localRemove'));
    const removeKeys = harness.calls.find(([name]) => name === 'localRemove')[1];
    expect(removeKeys).toEqual(expect.arrayContaining([
      'jobState',
      'llmComparatorCrossViewUiState',
      'llmComparatorCrossViewNavigationIntent',
      'llmSidebarPendingSessionView',
      'llmComparatorSelectedModelsByView.main',
      'llmComparatorSelectedModelsByView.pipeline',
      'aoEngineState.v1'
    ]));
    expect(removeKeys).not.toContain('llmComparatorPipelines');
    expect(removeKeys).not.toContain('customRunRecords.index');
    expect(harness.response()).toBeNull();

    localRemove.resolve();
    await waitUntil(() => harness.calls.some(([name]) => name === 'localSet'));
    const marker = harness.calls.find(([name]) => name === 'localSet')[1];
    expect(marker.llmComparatorWorkingSessionStartedAt).toEqual(expect.any(Number));
    expect(harness.response()).toBeNull();

    localSet.resolve();
    await waitUntil(() => harness.response() !== null);
    expect(harness.response()).toEqual({ success: true, startedAt: marker.llmComparatorWorkingSessionStartedAt });
    expect(harness.calls.map(([name]) => name)).toEqual([
      'stopAllProcesses', 'tabMapClear', 'clearParticipantRun', 'normalizeControlState', 'persistControlState',
      'diagnosticsClear', 'deliveryClear', 'localRemove', 'localSet'
    ]);
  });

  test('reports storage rejection as failure and does not acknowledge success', async () => {
    const localRemove = deferred();
    const harness = makeHarness({ localRemove: localRemove.promise });

    harness.invoke();
    await waitUntil(() => harness.calls.some(([name]) => name === 'localRemove'));
    localRemove.reject(new Error('storage quota unavailable'));
    await waitUntil(() => harness.response() !== null);

    expect(harness.response()).toEqual({ success: false, error: 'storage quota unavailable' });
    expect(harness.calls.map(([name]) => name)).toEqual([
      'stopAllProcesses', 'tabMapClear', 'clearParticipantRun', 'normalizeControlState', 'persistControlState',
      'diagnosticsClear', 'deliveryClear', 'localRemove'
    ]);
  });
});

describe('working-session telemetry and delivery gates', () => {
  test('DIAG_EVENT rechecks an old event after it waited in the serialized write queue', async () => {
    let queuedMutator;
    let completeMutation;
    let appendResult;
    const harness = makeDiagEventHarness({
      mutate: (mutator) => new Promise((resolve, reject) => {
        queuedMutator = mutator;
        completeMutation = async (events) => {
          try { appendResult = await mutator(events); resolve(); } catch (err) { reject(err); }
        };
      })
    });
    const persisted = [{ label: 'after-reset' }];
    let response;

    expect(harness.handler({
      type: 'DIAG_EVENT',
      event: { platform: 'GPT', label: 'delayed-old-event', meta: { runSessionId: 500 } }
    }, { tab: { id: 41, url: 'https://chatgpt.com' } }, (value) => { response = value; })).toBe(true);
    await waitUntil(() => typeof queuedMutator === 'function');
    harness.self.__workingSessionStartedAt = 1000;
    await completeMutation(persisted);

    await waitUntil(() => response !== undefined);
    expect(appendResult).toEqual(persisted);
    expect(response).toEqual({ success: true });
  });

  test('DIAG_EVENT rejects an already stale event after clear before queueing a write', async () => {
    const mutate = jest.fn(async (fn) => fn([]));
    const harness = makeDiagEventHarness({ cutoff: 1000, sessionStart: 1000, mutate });
    let response;

    expect(harness.handler({
      type: 'DIAG_EVENT',
      event: { platform: 'GPT', label: 'stale-event', meta: { runSessionId: 999 } }
    }, { tab: { id: 41, url: 'https://chatgpt.com' } }, (value) => { response = value; })).toBe(true);
    await waitUntil(() => response !== undefined);

    expect(response).toEqual({ success: true, dropped: true });
    expect(mutate).not.toHaveBeenCalled();
  });

  test('drops an old DIAG event that was queued before reset but reaches the serialized mutator afterward', async () => {
    let queuedMutator;
    let finishMutation;
    const harness = makeTelemetryHarness({
      mutate: (mutator) => new Promise((resolve, reject) => {
        queuedMutator = mutator;
        finishMutation = (arr) => {
          try { resolve(mutator(arr)); } catch (err) { reject(err); }
        };
      })
    });
    const event = { ts: 500, label: 'old-before-reset', meta: { runSessionId: 500 } };
    const pending = harness.hooks.persistDiagnosticEvent('GPT', event);

    await waitUntil(() => typeof queuedMutator === 'function');
    harness.self.__workingSessionStartedAt = 1000;
    const original = [{ label: 'post-reset' }];
    finishMutation(original);

    await expect(pending).resolves.toBeTruthy();
    expect(await queuedMutator(original)).toEqual(original);
  });

  test('rejects stale post-clear DIAG events and persists current-session events', async () => {
    const writes = [];
    const harness = makeTelemetryHarness({
      cutoff: 1000,
      session: { startTime: 1000 },
      mutate: async (mutator) => {
        const next = await mutator(writes.slice());
        writes.splice(0, writes.length, ...next);
      }
    });

    await expect(harness.hooks.persistDiagnosticEvent('GPT', {
      ts: 1100, label: 'stale-arrived-late', meta: { runSessionId: 999 }
    })).resolves.toBeNull();
    await harness.hooks.persistDiagnosticEvent('GPT', {
      ts: 1100, label: 'current-after-clear', meta: { runSessionId: 1000 }
    });

    expect(writes.map((event) => event.label)).toEqual(['current-after-clear']);
  });

  test('discardPendingDiagnostics cancels the pending ring timer and queued write', () => {
    jest.useFakeTimers();
    const persisted = [];
    const telemetryPrelude = TELEMETRY_SRC.slice(
      TELEMETRY_SRC.indexOf('const DIAGNOSTICS_RING_FLUSH_MS ='),
      TELEMETRY_SRC.indexOf('function resolveEventLlmName(')
    );
    const sandbox = {
      self: {},
      setTimeout,
      clearTimeout,
      console,
      persistDiagnosticEvent: (...args) => { persisted.push(args); return Promise.resolve(); }
    };
    vm.createContext(sandbox);
    vm.runInContext(`${telemetryPrelude}\nglobalThis.testHooks = { queueDiagnosticRingWrite, discardPendingDiagnostics };`, sandbox);
    sandbox.testHooks.queueDiagnosticRingWrite('GPT', { label: 'queued-before-reset' }, {});
    sandbox.testHooks.discardPendingDiagnostics();
    jest.runOnlyPendingTimers();

    expect(persisted).toEqual([]);
    jest.useRealTimers();
  });

  test('DELIVERY_JOURNAL_APPEND drops a stale epoch and appends a matching epoch', async () => {
    const events = [{ eventId: 'evt-1' }];
    const appended = [];
    const appendBarrier = deferred();
    const stale = makeDeliveryAppendHarness({
      initialState: async () => { stale.self.__workingSessionStartedAt = 2000; },
      storeAppend: async (batch) => { appended.push(batch); return { ok: true }; }
    });
    let staleResponse;
    expect(stale.handler({ type: 'DELIVERY_JOURNAL_APPEND', events, workingSessionStartedAt: 1000 }, {}, (res) => { staleResponse = res; })).toBe(true);
    await waitUntil(() => staleResponse !== undefined);
    expect(staleResponse).toEqual({ ok: true, dropped: true });
    expect(appended).toEqual([]);

    let currentResponse;
    const current = makeDeliveryAppendHarness({
      initialState: async () => { current.self.__workingSessionStartedAt = 2000; },
      storeAppend: async (batch) => { appended.push(batch); await appendBarrier.promise; return { ok: true }; }
    });
    expect(current.handler({ type: 'DELIVERY_JOURNAL_APPEND', events, workingSessionStartedAt: 2000 }, {}, (res) => { currentResponse = res; })).toBe(true);
    await waitUntil(() => appended.length === 1);
    expect(appended).toEqual([events]);
    expect(currentResponse).toBeUndefined();
    appendBarrier.resolve();
    await waitUntil(() => currentResponse !== undefined);
    expect(currentResponse).toEqual({ ok: true });
  });
});
