/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROUTER_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'message-router.js'),
  'utf8'
);
const TARGETS_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'llm-targets.js'),
  'utf8'
);
const TAB_MANAGER_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'tab-manager.js'),
  'utf8'
);

function createHarness({ reusableTabs = [], createTab, updateTab, updateWindow } = {}) {
  let listener;
  const event = { addListener: jest.fn(), removeListener: jest.fn() };
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
    AbortController,
    setTimeout,
    clearTimeout,
    jobState: { session: null, llms: {} },
    activeListeners: new Map(),
    pendingPings: new Map(),
    pendingPingByTabId: new Map(),
    healthCheckFailuresByTabId: new Map(),
    lastHealthCheckReportAtByTabId: new Map(),
    llmActivityMap: {},
    jobMetadata: new Map(),
    llmRequestMap: {},
    deferredAnswerTimers: {},
    postSuccessScrollTimers: new Map(),
    rateLimitState: new Map(),
    TabMapManager: { load: jest.fn(() => Promise.resolve()) },
    findReusableTabsForLlm: jest.fn(() => Promise.resolve(reusableTabs)),
    loadJobState: jest.fn(() => Promise.resolve()),
    loadResolutionMetrics: jest.fn(() => Promise.resolve()),
    CompressedStorage: {
      get: jest.fn(() => Promise.resolve([])),
      set: jest.fn(() => Promise.resolve()),
      migrate: jest.fn(() => Promise.resolve()),
      pruneIfNeeded: jest.fn(() => Promise.resolve())
    },
    self: null,
    chrome: {
      runtime: {
        lastError: null,
        id: 'test-extension',
        getManifest: () => ({ version: 'test' }),
        getURL: (relativePath) => `chrome-extension://test/${relativePath}`,
        onMessage: { addListener: (fn) => { listener = fn; } }
      },
      storage: {
        local: {
          get: jest.fn((_key, callback) => {
            if (typeof callback === 'function') callback({});
            return Promise.resolve({});
          }),
          set: jest.fn(() => Promise.resolve()),
          remove: jest.fn(() => Promise.resolve())
        },
        session: {
          get: jest.fn(() => Promise.resolve({ responseViewerLegacyCleaned: true })),
          set: jest.fn(() => Promise.resolve()),
          remove: jest.fn(() => Promise.resolve())
        },
        onChanged: event
      },
      tabs: {
        onRemoved: event,
        onUpdated: event,
        onActivated: event,
        query: jest.fn(() => Promise.resolve([])),
        update: jest.fn(updateTab || ((_id, _props) => Promise.resolve({ windowId: 7 }))),
        create: jest.fn(createTab || (() => Promise.resolve({ id: 99, windowId: 7 }))),
        sendMessage: jest.fn(() => Promise.resolve())
      },
      windows: {
        onFocusChanged: event,
        update: jest.fn(updateWindow || (() => Promise.resolve({})))
      },
      debugger: { onEvent: event },
      scripting: { executeScript: jest.fn(() => Promise.resolve([])) },
      alarms: { create: jest.fn(), clear: jest.fn(), onAlarm: event },
      action: { onClicked: event }
    }
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(TARGETS_SOURCE, context, { filename: 'background/llm-targets.js' });
  vm.runInContext(ROUTER_SOURCE, context, { filename: 'background/message-router.js' });

  return {
    context,
    async send(message) {
      // Let the router's initial storage load finish before dispatching, as in
      // the real worker where OPEN_MODEL_CHAT is queued behind startup state.
      await new Promise((resolve) => setImmediate(resolve));
      return new Promise((resolve) => {
        const handled = listener(message, {}, resolve);
        if (handled !== true) resolve(undefined);
      });
    }
  };
}

function createFinderHarness(openTabs) {
  const context = {
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
    URL,
    jobState: { session: null, llms: {} },
    TabMapManager: { get: jest.fn(() => null) },
    chrome: {
      runtime: { lastError: null },
      tabs: {
        query: jest.fn((_query, callback) => callback(openTabs))
      }
    },
    self: null
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(TARGETS_SOURCE, context, { filename: 'background/llm-targets.js' });
  const helpersStart = TAB_MANAGER_SOURCE.indexOf('const URL_MATCH_BOUNDARY');
  const helpersEnd = TAB_MANAGER_SOURCE.indexOf('\nfunction resolveTabForLlmName', helpersStart);
  const queryPatternsStart = TAB_MANAGER_SOURCE.indexOf('function getQueryPatternsForLLM');
  const queryPatternsEnd = TAB_MANAGER_SOURCE.indexOf('\nfunction detachExistingTab', queryPatternsStart);
  const eligibilityStart = TAB_MANAGER_SOURCE.indexOf('function getAttachAllowPrefixes');
  const eligibilityEnd = TAB_MANAGER_SOURCE.indexOf('\nfunction buildTabSnapshot', eligibilityStart);
  const helperSources = [
    TAB_MANAGER_SOURCE.slice(helpersStart, helpersEnd),
    TAB_MANAGER_SOURCE.slice(queryPatternsStart, queryPatternsEnd),
    TAB_MANAGER_SOURCE.slice(eligibilityStart, eligibilityEnd)
  ].join('\n');
  vm.runInContext(helperSources, context, {
    filename: 'background/tab-manager.js#reusable-tabs'
  });
  return context;
}

describe('OPEN_MODEL_CHAT', () => {
  test('activates and focuses the first reusable chat for the requested model', async () => {
    const harness = createHarness({
      reusableTabs: [{ id: 42, windowId: 8 }],
      updateTab: jest.fn(() => Promise.resolve({ windowId: 8 }))
    });

    await expect(harness.send({ type: 'OPEN_MODEL_CHAT', llmName: 'Le Chat' }))
      .resolves.toEqual({ success: true });
    expect(harness.context.findReusableTabsForLlm).toHaveBeenCalledWith('Le Chat');
    expect(harness.context.chrome.tabs.update).toHaveBeenCalledWith(42, { active: true });
    expect(harness.context.chrome.windows.update).toHaveBeenCalledWith(8, { focused: true });
    expect(harness.context.chrome.tabs.create).not.toHaveBeenCalled();
  });

  test('opens Le Chat at its configured URL when no reusable tab exists', async () => {
    const harness = createHarness();

    await expect(harness.send({ type: 'OPEN_MODEL_CHAT', llmName: 'Le Chat' }))
      .resolves.toEqual({ success: true });
    expect(harness.context.chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://chat.mistral.ai/chat/',
      active: true
    });
    expect(harness.context.chrome.windows.update).not.toHaveBeenCalled();
  });

  test('returns failure for an unknown model without opening a tab', async () => {
    const harness = createHarness();

    await expect(harness.send({ type: 'OPEN_MODEL_CHAT', llmName: 'Unknown model' }))
      .resolves.toEqual({ success: false });
    expect(harness.context.chrome.tabs.create).not.toHaveBeenCalled();
    expect(harness.context.chrome.tabs.update).not.toHaveBeenCalled();
  });

  test('returns failure when Chrome rejects opening the configured model URL', async () => {
    const harness = createHarness({
      createTab: jest.fn(() => Promise.reject(new Error('tabs.create failed')))
    });

    await expect(harness.send({ type: 'OPEN_MODEL_CHAT', llmName: 'Le Chat' }))
      .resolves.toEqual({ success: false, error: 'tabs.create failed' });
    expect(harness.context.chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://chat.mistral.ai/chat/',
      active: true
    });
  });
});

describe('findReusableTabsForLlm with configured provider URLs', () => {
  test('finds Le Chat chat URLs and Qwen URLs using the real LLM_TARGETS filters', async () => {
    const openTabs = [
      { id: 123, url: 'https://chat.mistral.ai/chat/123', lastAccessed: 30 },
      { id: 122, url: 'https://chat.mistral.ai/chat/', lastAccessed: 20 },
      { id: 121, url: 'https://chat.mistral.ai.evil.example/chat/123', lastAccessed: 40 },
      { id: 223, url: 'https://chat.qwen.ai/', lastAccessed: 30 },
      { id: 222, url: 'https://chat.qwen.ai/chat/123', lastAccessed: 20 },
      { id: 221, url: 'https://qwen.ai/chat/123', lastAccessed: 40 }
    ];
    const context = createFinderHarness(openTabs);

    const leChatTabs = await context.findReusableTabsForLlm('Le Chat');
    const qwenTabs = await context.findReusableTabsForLlm('Qwen');

    expect(leChatTabs.map((tab) => tab.id)).toEqual([123, 122]);
    expect(qwenTabs.map((tab) => tab.id)).toEqual([223, 222]);
    expect(context.chrome.tabs.query).toHaveBeenCalledTimes(2);
  });
});
