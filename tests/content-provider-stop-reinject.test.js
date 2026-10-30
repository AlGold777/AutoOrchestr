const fs = require('fs');
const path = require('path');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const CLEANUP_REGISTRY = read('utils/cleanup-registry.js');
const CONTENT_UTILS = read('content-scripts/content-utils.js');
const CHATGPT_PROVIDER = read('content-scripts/content-chatgpt.js');
const MANIFEST = JSON.parse(read('manifest.json'));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

describe('loaded provider cleanup and same-page reinjection', () => {
  let originalChrome;
  let originalWindowChrome;
  let runtimeListeners;
  let storageListeners;
  let scopes;
  let createScopeSpy;

  beforeEach(() => {
    jest.useFakeTimers();
    originalChrome = global.chrome;
    originalWindowChrome = window.chrome;
    runtimeListeners = [];
    storageListeners = [];
    scopes = [];
    const chromeMock = {
      runtime: {
        id: 'test-extension',
        lastError: null,
        getManifest: () => ({ version: 'test' }),
        getURL: (file) => `chrome-extension://test/${file}`,
        sendMessage: jest.fn((_message, callback) => {
          callback?.({ success: true });
          return Promise.resolve({ success: true });
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
          get: jest.fn(() => Promise.resolve({})),
          set: jest.fn(() => Promise.resolve())
        },
        onChanged: {
          addListener(listener) { storageListeners.push(listener); },
          removeListener(listener) {
            storageListeners = storageListeners.filter((candidate) => candidate !== listener);
          }
        }
      }
    };
    global.chrome = chromeMock;
    window.chrome = chromeMock;
    document.body.innerHTML = '<textarea id="prompt-textarea"></textarea><button data-testid="send-button"></button>';
    delete window.ContentUtils;
    delete window.HumanoidCleanup;
    delete window.__LLMScrollHardStop;
    delete window.__LLMScrollStopEpoch;
    delete window.chatgptContentScriptLoaded;
    delete window.__humanoidForceStopRegistry;
    window.LLMExtension = { sendScriptReady: jest.fn() };
    const forceStopHandlers = new Set();
    window.__humanoidForceStopRegistry = {
      register(handler) {
        forceStopHandlers.add(handler);
        return () => forceStopHandlers.delete(handler);
      },
      run(reason) { forceStopHandlers.forEach((handler) => handler(reason)); }
    };

    // Match the manifest order: cleanup primitives exist before shared and
    // provider content scripts initialize their scopes.
    window.eval(CLEANUP_REGISTRY);
    window.eval(CONTENT_UTILS);
    const realCreateScope = window.HumanoidCleanup.createScope.bind(window.HumanoidCleanup);
    createScopeSpy = jest.spyOn(window.HumanoidCleanup, 'createScope').mockImplementation((label) => {
      const scope = realCreateScope(label);
      scopes.push(scope);
      return scope;
    });
  });

  afterEach(() => {
    createScopeSpy?.mockRestore();
    jest.clearAllTimers();
    jest.useRealTimers();
    delete window.ContentUtils;
    delete window.HumanoidCleanup;
    delete window.LLMExtension;
    delete window.chatgptContentScriptLoaded;
    delete window.__cleanup_chatgpt;
    delete window.__humanoidForceStopRegistry;
    delete window.__LLMScrollHardStop;
    delete window.__LLMScrollStopEpoch;
    document.body.replaceChildren();
    global.chrome = originalChrome;
    window.chrome = originalWindowChrome;
  });

  test('manifest loads the registry first; Stop removes listeners, reinjection accepts a prompt, and Stop cleans the new scope', async () => {
    const commonScripts = MANIFEST.content_scripts.find((entry) => entry.js.includes('content-scripts/content-utils.js')).js;
    const providerScripts = MANIFEST.content_scripts.find((entry) => entry.js.includes('content-scripts/content-chatgpt.js')).js;
    expect(commonScripts.indexOf('utils/cleanup-registry.js')).toBeLessThan(commonScripts.indexOf('content-scripts/content-utils.js'));
    expect(commonScripts).toContain('content-scripts/content-utils.js');
    expect(providerScripts).toContain('content-scripts/content-chatgpt.js');

    const composer = document.querySelector('#prompt-textarea');
    const sendButton = document.querySelector('[data-testid="send-button"]');
    Object.defineProperty(composer, 'offsetParent', { configurable: true, value: document.body });
    composer.getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, bottom: 20, left: 0, right: 100 });
    const composerFocus = jest.spyOn(composer, 'focus');
    const composerInput = jest.fn();
    composer.addEventListener('input', composerInput);
    const sendButtonClick = jest.spyOn(sendButton, 'click');
    const flushPromiseJobs = async () => {
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    };

    const dispatchProviderMessage = (message) => {
      const responses = [];
      [...runtimeListeners].forEach((listener) => {
        listener(message, {}, (response) => responses.push(response));
      });
      return responses;
    };
    const preparePendingRequest = () => {
      const pendingLookup = deferred();
      window.ContentUtils.findAndCacheElement = jest.fn(() => pendingLookup.promise);
      const unregister = window.__humanoidForceStopRegistry.register(() => {
        pendingLookup.reject(Object.assign(new Error('stopped'), { code: 'background-force-stop' }));
      });
      return unregister;
    };

    window.eval(CHATGPT_PROVIDER);
    expect(runtimeListeners.length).toBeGreaterThanOrEqual(4); // shared stop listeners plus provider
    const firstProviderListenerCount = runtimeListeners.length;
    expect(scopes).toHaveLength(1);
    const firstTimerCount = jest.getTimerCount();
    expect(firstTimerCount).toBeGreaterThan(0); // metrics heartbeat owned by the provider scope

    const removeFirstCancellation = preparePendingRequest();
    const firstAck = dispatchProviderMessage({
      type: 'GET_ANSWER', prompt: 'first prompt', isFireAndForget: true,
      meta: { runSessionId: 'run-1', dispatchId: 'dispatch-1' }
    });
    expect(firstAck).toContainEqual(expect.objectContaining({ accepted: true }));

    dispatchProviderMessage({
      type: 'STOP_AND_CLEANUP',
      meta: { runSessionId: 'run-1', dispatchId: 'dispatch-1' }
    });
    removeFirstCancellation();
    await flushPromiseJobs();
    expect(scopes[0].isCleaned()).toBe(true);
    expect(jest.getTimerCount()).toBeLessThan(firstTimerCount);
    expect(runtimeListeners.length).toBe(firstProviderListenerCount - 1);
    expect(composerFocus).not.toHaveBeenCalled();
    expect(composerInput).not.toHaveBeenCalled();
    expect(composer.value).toBe('');
    expect(sendButtonClick).not.toHaveBeenCalled();

    // The same provider source can be injected into this isolated page again:
    // its guard was cleared and the old runtime listener was disposed.
    window.eval(CHATGPT_PROVIDER);
    expect(scopes).toHaveLength(2);
    expect(runtimeListeners.length).toBe(firstProviderListenerCount);
    const secondTimerCount = jest.getTimerCount();
    expect(secondTimerCount).toBeGreaterThan(0);

    const removeSecondCancellation = preparePendingRequest();
    const secondAck = dispatchProviderMessage({
      type: 'GET_ANSWER', prompt: 'next prompt', isFireAndForget: true,
      meta: { runSessionId: 'run-1', dispatchId: 'dispatch-2' }
    });
    expect(secondAck).toContainEqual(expect.objectContaining({ accepted: true, dispatchId: 'dispatch-2' }));

    // A delayed Stop from the previous dispatch cannot clean the reinjected
    // provider or set the shared hard-stop bit for the current request.
    const stopEpochBeforeStaleDelivery = Number(window.__LLMScrollStopEpoch || 0);
    const listenersBeforeStaleDelivery = runtimeListeners.length;
    const timersBeforeStaleDelivery = jest.getTimerCount();
    dispatchProviderMessage({
      type: 'STOP_AND_CLEANUP',
      meta: { runSessionId: 'run-1', dispatchId: 'dispatch-1' }
    });
    expect(scopes[1].isCleaned()).toBe(false);
    expect(runtimeListeners.length).toBe(listenersBeforeStaleDelivery);
    expect(jest.getTimerCount()).toBe(timersBeforeStaleDelivery);
    expect(window.__LLMScrollHardStop).toBe(false);
    expect(Number(window.__LLMScrollStopEpoch || 0)).toBe(stopEpochBeforeStaleDelivery);

    dispatchProviderMessage({
      type: 'STOP_AND_CLEANUP',
      meta: { runSessionId: 'run-1', dispatchId: 'dispatch-2' }
    });
    removeSecondCancellation();
    await flushPromiseJobs();
    expect(scopes[1].isCleaned()).toBe(true);
    expect(jest.getTimerCount()).toBeLessThan(secondTimerCount);
    expect(runtimeListeners.length).toBe(firstProviderListenerCount - 1);
    expect(window.__LLMScrollHardStop).toBe(true);
    expect(composerFocus).not.toHaveBeenCalled();
    expect(composerInput).not.toHaveBeenCalled();
    expect(composer.value).toBe('');
    expect(sendButtonClick).not.toHaveBeenCalled();
  });
});
