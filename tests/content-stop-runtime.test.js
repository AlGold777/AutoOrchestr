const fs = require('fs');
const path = require('path');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const CONTENT_UTILS = read('content-scripts/content-utils.js');
const PRAGMATIST_BUDGETS = read('shared/budgets.js');
const PRAGMATIST_CORE = read('content-scripts/pragmatist-core.js');
const PRAGMATIST_RUNNER = read('content-scripts/pragmatist-runner.js');

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

describe('content Stop runtime delivery', () => {
  let originalChrome;
  let originalWindowChrome;
  let runtimeListeners;
  let settingsRead;

  beforeEach(() => {
    originalChrome = global.chrome;
    originalWindowChrome = window.chrome;
    runtimeListeners = [];
    settingsRead = deferred();
    const chromeMock = {
      runtime: {
        id: 'test-extension',
        lastError: null,
        getURL: (file) => `chrome-extension://test/${file}`,
        sendMessage: jest.fn((_message, callback) => {
          callback?.();
          return Promise.resolve({});
        }),
        onMessage: {
          addListener(listener) { runtimeListeners.push(listener); },
          removeListener(listener) {
            runtimeListeners = runtimeListeners.filter((candidate) => candidate !== listener);
          }
        }
      },
      storage: {
        local: {
          get: jest.fn((keys) => (
            Array.isArray(keys) && keys.includes('settings')
              ? settingsRead.promise
              : Promise.resolve({})
          )),
          set: jest.fn(() => Promise.resolve())
        },
        onChanged: {
          addListener: jest.fn(),
          removeListener: jest.fn()
        }
      }
    };
    global.chrome = chromeMock;
    window.chrome = chromeMock;
    document.body.replaceChildren();
    window.__LLMLateAnswerSnapshotObserverStarted = true;
    delete window.ContentUtils;
    delete window.PragmatistCore;
    delete window.__pragmatistRunner;
    delete window.__LLMScrollHardStop;
    delete window.__LLMScrollStopEpoch;
    delete window.__PRAGMATIST_BUDGETS;

    window.eval(CONTENT_UTILS);
    window.eval(PRAGMATIST_BUDGETS);
    window.eval(PRAGMATIST_CORE);
    window.eval(PRAGMATIST_RUNNER);
  });

  afterEach(() => {
    delete window.ContentUtils;
    delete window.PragmatistCore;
    delete window.__pragmatistRunner;
    delete window.__LLMLateAnswerSnapshotObserverStarted;
    delete window.__LLMScrollHardStop;
    delete window.__LLMScrollStopEpoch;
    delete window.__PRAGMATIST_BUDGETS;
    document.body.replaceChildren();
    global.chrome = originalChrome;
    window.chrome = originalWindowChrome;
  });

  test('Stop reaches the early runner listener and cancels boot even if a new request clears hard-stop', async () => {
    const runner = window.__pragmatistRunner;
    expect(runner).toBeDefined();
    expect(runtimeListeners.length).toBeGreaterThan(4);

    const streamDisconnect = jest.spyOn(runner.streamWatcher, 'disconnect');
    const runnerRestore = jest.spyOn(runner.stateManager, 'restore');
    const streamConnect = jest.spyOn(runner.streamWatcher, 'connect');
    const commandStart = jest.spyOn(runner.commandExecutor, 'start');
    const navigationStart = jest.spyOn(runner.navigationDetector, 'start');
    const broadcastStart = jest.spyOn(runner.broadcastListener, 'start');

    // Simulate Chrome's actual multi-listener delivery while runner boot is
    // awaiting settings storage.
    for (const listener of [...runtimeListeners]) {
      listener({
        type: 'STOP_AND_CLEANUP',
        meta: { runSessionId: 'run-1', dispatchId: 'dispatch-1' }
      }, {}, () => {});
    }
    expect(window.__LLMScrollHardStop).toBe(true);
    expect(window.__LLMScrollStopEpoch).toBeGreaterThan(0);
    expect(streamDisconnect).toHaveBeenCalled();

    // An old completion collection and a duplicate dispatch cannot lift Stop.
    for (const listener of [...runtimeListeners]) {
      listener({
        type: 'GET_FINAL_ANSWER', prompt: 'old completion',
        meta: { runSessionId: 'run-1', dispatchId: 'dispatch-2' }
      }, {}, () => {});
      listener({
        type: 'GET_ANSWER', prompt: 'duplicate request',
        meta: { runSessionId: 'run-1', dispatchId: 'dispatch-1' }
      }, {}, () => {});
    }
    expect(window.__LLMScrollHardStop).toBe(true);

    // Only a real new dispatch can clear the visible hard-stop bit; the old
    // boot remains cancelled because its captured stop epoch is obsolete.
    for (const listener of [...runtimeListeners]) {
      listener({
        type: 'GET_ANSWER', prompt: 'next request',
        meta: { runSessionId: 'run-1', dispatchId: 'dispatch-2' }
      }, {}, () => {});
    }
    expect(window.__LLMScrollHardStop).toBe(false);
    settingsRead.resolve({ settings: {} });
    await Promise.resolve();
    await Promise.resolve();

    expect(runnerRestore).not.toHaveBeenCalled();
    expect(streamConnect).not.toHaveBeenCalled();
    expect(commandStart).not.toHaveBeenCalled();
    expect(navigationStart).not.toHaveBeenCalled();
    expect(broadcastStart).not.toHaveBeenCalled();
  });
});
