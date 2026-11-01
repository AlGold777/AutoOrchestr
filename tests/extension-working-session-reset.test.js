const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX_SRC = fs.readFileSync(path.join(__dirname, '..', 'background', 'index.js'), 'utf8');
const PRELUDE_MARKER = '// Resolve which panel to open';
const PRELUDE_END = INDEX_SRC.indexOf(PRELUDE_MARKER);
if (PRELUDE_END < 0) throw new Error(`Missing background lifecycle prelude boundary: ${PRELUDE_MARKER}`);
const LIFECYCLE_PRELUDE = INDEX_SRC.slice(0, PRELUDE_END);
const EPOCH_KEY = '__llm_extension_runtime_epoch_v1';

class ManualClock {
  constructor(startAt = 10000) {
    this.now = startAt;
    this.nextId = 1;
    this.timers = new Map();
  }

  setTimeout = (callback, delay = 0) => {
    const id = this.nextId++;
    this.timers.set(id, { callback, at: this.now + Math.max(0, Number(delay) || 0) });
    return id;
  };

  clearTimeout = (id) => this.timers.delete(id);

  advance = (duration) => {
    const end = this.now + duration;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      const [id, timer] = next;
      this.timers.delete(id);
      this.now = timer.at;
      timer.callback();
    }
    this.now = end;
  };
}

function makeLifecycleHarness({ local = {}, session = {}, faults = {}, delays = {} } = {}) {
  const clock = new ManualClock();
  const localData = new Map(Object.entries(local));
  const sessionData = new Map(Object.entries(session));
  const installedListeners = [];
  const pendingLocalRemovals = [];
  const calls = [];
  const runtime = { lastError: null, onInstalled: { addListener: (listener) => installedListeners.push(listener) } };
  const finishStorageCall = (callback, error, mutate) => {
    if (!error && mutate) mutate();
    runtime.lastError = error ? { message: error } : null;
    callback?.();
    runtime.lastError = null;
  };
  const chrome = {
    runtime,
    storage: {
      local: {
        set(values, callback) {
          calls.push(['local.set', { ...values }]);
          clock.setTimeout(() => finishStorageCall(callback, faults.localSet, () => {
            Object.entries(values).forEach(([key, value]) => localData.set(key, value));
          }), delays.localSet || 0);
        },
        remove(keys, callback) {
          const normalizedKeys = Array.isArray(keys) ? keys.slice() : [keys];
          calls.push(['local.remove', normalizedKeys]);
          const complete = () => finishStorageCall(callback, faults.localRemove, () => normalizedKeys.forEach((key) => localData.delete(key)));
          if (delays.localRemoveManual) pendingLocalRemovals.push(complete);
          else clock.setTimeout(complete, delays.localRemove || 0);
        }
      },
      session: {
        get(key, callback) {
          calls.push(['session.get', key]);
          const result = { [key]: sessionData.get(key) };
          clock.setTimeout(() => finishStorageCall(callback, faults.sessionGet, () => {}), delays.sessionGet || 0);
          if (!faults.sessionGet) {
            const callbackAt = clock.now + (delays.sessionGet || 0);
            clock.setTimeout(() => callback(result), delays.sessionGet || 0);
          }
        },
        clear(callback) {
          calls.push(['session.clear']);
          clock.setTimeout(() => finishStorageCall(callback, faults.sessionClear, () => sessionData.clear()), delays.sessionClear || 0);
        },
        set(values, callback) {
          calls.push(['session.set', { ...values }]);
          clock.setTimeout(() => finishStorageCall(callback, faults.sessionSet, () => {
            Object.entries(values).forEach(([key, value]) => sessionData.set(key, value));
          }), delays.sessionSet || 0);
        }
      }
    }
  };
  // Replace session.get with a callback that carries the value and runtime.lastError atomically.
  chrome.storage.session.get = (key, callback) => {
    calls.push(['session.get', key]);
    const result = { [key]: sessionData.get(key) };
    clock.setTimeout(() => {
      runtime.lastError = faults.sessionGet ? { message: faults.sessionGet } : null;
      callback(result);
      runtime.lastError = null;
    }, delays.sessionGet || 0);
  };

  const self = {};
  const context = {
    self,
    chrome,
    Date: class TestDate extends Date { static now() { return clock.now; } },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    console: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
    importScripts: jest.fn(() => { throw new Error('lifecycle prelude crossed its boundary'); })
  };
  vm.runInNewContext(LIFECYCLE_PRELUDE, context, { filename: 'background/index.js:lifecycle-prelude' });
  return {
    self, localData, sessionData, calls, pendingLocalRemovals, installedListeners, clock,
    async flush() { for (let index = 0; index < 12; index += 1) await Promise.resolve(); },
    async drainCurrentTimers() {
      for (let index = 0; index < 8; index += 1) {
        clock.advance(0);
        for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
      }
    },
    installUpdate() { installedListeners.forEach((listener) => listener({ reason: 'update' })); },
    completeLocalRemovals() { pendingLocalRemovals.splice(0).forEach((complete) => complete()); }
  };
}

const dirtyLocalState = () => ({
  __diagnostics_events__: [{ event: 'stale telemetry' }],
  'messageDelivery.journal.v2.local': { version: 2, events: [{ eventId: 'stale-local' }] },
  llmComparatorCrossViewUiState: { views: { main: { promptText: 'stale prompt' } } },
  llmComparatorCrossViewNavigationIntent: { targetView: 'pipeline', savedAt: 9000 },
  jobState: { session: { startTime: 1 }, llms: { GPT: { status: 'SUCCESS' } } },
  'aoEngineState.v1': { status: 'RUNNING', runId: 'stale-run' },
  'llmComparatorSelectedModelsByView.main': ['GPT'],
  'llmComparatorSelectedModelsByView.pipeline': ['Claude'],
  llmTabMap: { GPT: 41 },
  llmParticipantTabMap: { 'p-1': 42 },
  llm_saved_sessions_v1: [{ id: 'stale-working-session' }],
  llmComparatorPipelines: { saved: { schema: { schemaVersion: 2 } } },
  'customRunRecords.index': { runIds: ['archived-1'] },
  'customRunRecord.archived-1': { runId: 'archived-1', status: 'completed' }
});

const dirtySessionState = (epoch = undefined) => ({
  ...(epoch === undefined ? {} : { [EPOCH_KEY]: epoch }),
  'messageDelivery.journal.v2': { version: 2, events: [{ eventId: 'stale-session' }] },
  llm_pipeline_fsm_v1: { state: 'RUNNING', pipelineRunId: 'stale-run' }
});

describe('background extension working-session lifecycle reset', () => {
  test('a missing epoch clears volatile telemetry/runtime state, stamps a new epoch, and preserves archives', async () => {
    const harness = makeLifecycleHarness({ local: dirtyLocalState(), session: dirtySessionState() });

    await harness.drainCurrentTimers();
    const result = await harness.self.__extensionLifecycleReady;

    expect(result.reset).toBe(true);
    expect(result.reason).toBe('new_extension_runtime');
    for (const key of [
      '__diagnostics_events__', 'messageDelivery.journal.v2.local',
      'llmComparatorCrossViewUiState', 'llmComparatorCrossViewNavigationIntent',
      'jobState', 'aoEngineState.v1', 'llmComparatorSelectedModelsByView.main',
      'llmComparatorSelectedModelsByView.pipeline', 'llmTabMap', 'llmParticipantTabMap',
      'llm_saved_sessions_v1'
    ]) expect(harness.localData.has(key)).toBe(false);
    expect(harness.sessionData.has('messageDelivery.journal.v2')).toBe(false);
    expect(harness.sessionData.has('llm_pipeline_fsm_v1')).toBe(false);
    expect(harness.sessionData.get(EPOCH_KEY)).toBeGreaterThan(0);
    expect(harness.self.__extensionRuntimeResetAt).toBe(harness.clock.now);
    expect(harness.localData.get('llmComparatorPipelines')).toEqual(dirtyLocalState().llmComparatorPipelines);
    expect(harness.localData.get('customRunRecords.index')).toEqual(dirtyLocalState()['customRunRecords.index']);
    expect(harness.localData.get('customRunRecord.archived-1')).toEqual(dirtyLocalState()['customRunRecord.archived-1']);
  });

  test('an update event before the 100 ms normal-wake settle resets even with a retained epoch', async () => {
    const harness = makeLifecycleHarness({ local: dirtyLocalState(), session: dirtySessionState(1234) });
    await harness.drainCurrentTimers();

    harness.installUpdate();
    await harness.drainCurrentTimers();
    const result = await harness.self.__extensionLifecycleReady;

    expect(result).toMatchObject({ reset: true, reason: 'extension_update' });
    expect(harness.localData.has('__diagnostics_events__')).toBe(false);
    expect(harness.sessionData.has('messageDelivery.journal.v2')).toBe(false);
    expect(harness.sessionData.get(EPOCH_KEY)).toBeGreaterThan(1234);
  });

  test('an ordinary worker wake with a retained epoch preserves telemetry and settles without reset', async () => {
    const seed = dirtyLocalState();
    const harness = makeLifecycleHarness({ local: seed, session: dirtySessionState(1234) });
    await harness.drainCurrentTimers();
    let settled = false;
    harness.self.__extensionLifecycleReady.then(() => { settled = true; });

    harness.clock.advance(99);
    await harness.flush();
    expect(settled).toBe(false);
    harness.clock.advance(1);
    await harness.flush();
    const result = await harness.self.__extensionLifecycleReady;

    expect(result).toMatchObject({ reset: false, reason: 'worker_wake' });
    expect(harness.localData.get('__diagnostics_events__')).toEqual(seed.__diagnostics_events__);
    expect(harness.localData.get('messageDelivery.journal.v2.local')).toEqual(seed['messageDelivery.journal.v2.local']);
    expect(harness.sessionData.get(EPOCH_KEY)).toBe(1234);
  });

  test.each([
    ['local volatile-state removal', { localRemove: 'cannot remove telemetry' }],
    ['session epoch write', { sessionSet: 'cannot write epoch' }],
    ['working-session marker write', { localSet: 'cannot persist working-session marker' }]
  ])('%s failure reports reset:false and its error', async (_label, faults) => {
    const harness = makeLifecycleHarness({ local: dirtyLocalState(), session: dirtySessionState(), faults });
    await harness.drainCurrentTimers();
    const result = await harness.self.__extensionLifecycleReady;

    expect(result.reset).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test('the 2 second safety timer cannot expose readiness while volatile removal is still pending', async () => {
    const harness = makeLifecycleHarness({
      local: dirtyLocalState(),
      session: dirtySessionState(),
      delays: { localRemoveManual: true }
    });
    await harness.drainCurrentTimers();
    let settled = false;
    harness.self.__extensionLifecycleReady.then(() => { settled = true; });

    harness.clock.advance(2001);
    await harness.flush();
    expect(settled).toBe(false);
    expect(harness.localData.has('__diagnostics_events__')).toBe(true);

    harness.completeLocalRemovals();
    await harness.drainCurrentTimers();
    await expect(harness.self.__extensionLifecycleReady).resolves.toMatchObject({ reset: true });
    expect(harness.localData.has('__diagnostics_events__')).toBe(false);
  });
});
