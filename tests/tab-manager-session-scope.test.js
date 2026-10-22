const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TAB_MANAGER_PATH = path.join(__dirname, '..', 'background', 'tab-manager.js');
const TAB_MANAGER_SOURCE = fs.readFileSync(TAB_MANAGER_PATH, 'utf8');

function createTabManagerSandbox({
  queryTabs = [],
  storageInitial = {},
  healthPingReady = false,
  surfaceByTabId = {},
  createDelayMs = 0
} = {}) {
  const telemetry = [];
  const storageState = { ...storageInitial };
  const listeners = {
    tabUpdated: [],
    tabRemoved: [],
    tabActivated: [],
    windowFocus: [],
    actionClicked: [],
    installed: [],
    startup: []
  };

  const chrome = {
    storage: {
      local: {
        get(key, cb) {
          if (typeof cb === 'function') {
            cb({ [key]: storageState[key] });
            return undefined;
          }
          return Promise.resolve({ [key]: storageState[key] });
        },
        set(obj) {
          Object.assign(storageState, obj || {});
          return Promise.resolve();
        }
      }
    },
    tabs: {
      query(queryInfo, cb) {
        cb(queryTabs.map((tab) => ({ ...tab })));
      },
      get(tabId, cb) {
        const tab = queryTabs.find((entry) => entry.id === tabId) || null;
        cb(tab ? { ...tab } : null);
      },
      create(_options, cb) {
        const created = { id: 999, url: 'https://chatgpt.com/', windowId: 1, index: 0, status: 'complete' };
        if (createDelayMs > 0) setTimeout(() => cb(created), createDelayMs);
        else cb(created);
      },
      update(_tabId, _options, cb) {
        if (typeof cb === 'function') cb();
      },
      reload(_tabId, cb) {
        if (typeof cb === 'function') cb();
      },
      sendMessage(_tabId, message, cb) {
        if (typeof cb === 'function') {
          cb(healthPingReady && message?.type === 'HEALTH_CHECK_PING'
            ? { type: 'HEALTH_CHECK_PONG', llmName: 'Perplexity' }
            : null);
        }
        return Promise.resolve();
      },
      onUpdated: {
        addListener(fn) {
          listeners.tabUpdated.push(fn);
        },
        removeListener(fn) {
          listeners.tabUpdated = listeners.tabUpdated.filter((entry) => entry !== fn);
        }
      },
      onRemoved: {
        addListener(fn) {
          listeners.tabRemoved.push(fn);
        }
      },
      onActivated: {
        addListener(fn) {
          listeners.tabActivated.push(fn);
        }
      }
    },
    windows: {
      update(_windowId, _options, cb) {
        if (typeof cb === 'function') cb();
      },
      WINDOW_ID_NONE: -1,
      onFocusChanged: {
        addListener(fn) {
          listeners.windowFocus.push(fn);
        }
      }
    },
    action: {
      onClicked: {
        addListener(fn) {
          listeners.actionClicked.push(fn);
        }
      }
    },
    scripting: {
      executeScript: jest.fn(async ({ target }) => [{
        result: surfaceByTabId[target.tabId]
          || { composerHasDraft: false, stopVisible: false, modalVisible: false }
      }])
    },
    runtime: {
      lastError: null,
      getURL(file) {
        return `chrome-extension://test/${file}`;
      },
      onInstalled: {
        addListener(fn) {
          listeners.installed.push(fn);
        }
      },
      onStartup: {
        addListener(fn) {
          listeners.startup.push(fn);
        }
      }
    }
  };

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
    navigator: { deviceMemory: 8 },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    chrome,
    self: {},
    TimingConfig: {
      getTiming(_key, fallback) {
        return fallback;
      }
    },
    sessionTabIds: new Set(),
    SESSION_TAB_IDS_KEY: 'llm_session_tab_ids_v1',
    sessionTabsLoaded: false,
    llmTabMap: {},
    jobState: {
      session: {
        boundTabIds: [1001]
      },
      llms: {
        GPT: { tabId: null, url: 'https://chatgpt.com/' }
      }
    },
    LLM_TARGETS: {
      GPT: {
        queryPatterns: ['*://chatgpt.com/*'],
        attachUrlAllowPrefixes: ['https://chatgpt.com/']
      },
      Perplexity: {
        queryPatterns: ['*://www.perplexity.ai/*'],
        attachUrlAllowPrefixes: ['https://www.perplexity.ai/']
      }
    },
    emitTelemetry(llmName, label, payload = {}) {
      telemetry.push({ llmName, label, payload });
    },
    prepareTabForUse: jest.fn(() => Promise.resolve()),
    initRequestMetadata: jest.fn(),
    broadcastHumanVisitStatus: jest.fn(),
    broadcastGlobalState: jest.fn(),
    removeActiveListenerForTab: jest.fn(),
    dispatchPromptToTab: jest.fn(),
    saveJobState: jest.fn(),
    activeListeners: new Map(),
    pingWindowByTabId: {},
    pingStartByTabId: {},
    resultsTabId: null,
    resultsWindowId: null,
    autoFocusNewTabsEnabled: false,
    promptDispatchInProgress: 0
  };
  context.self = context;

  vm.createContext(context);
  vm.runInContext(TAB_MANAGER_SOURCE, context, { filename: 'background/tab-manager.js' });

  return { context, telemetry };
}

describe('tab-manager session scoping', () => {
  test('resolveTabForLlmName does not fall back to global tabs when run scope is active', async () => {
    const { context, telemetry } = createTabManagerSandbox({
      queryTabs: [
        {
          id: 2002,
          url: 'https://chatgpt.com/c/foreign',
          windowId: 7,
          index: 0,
          status: 'complete',
          lastAccessed: Date.now()
        }
      ]
    });

    const resolved = await new Promise((resolve) => {
      context.resolveTabForLlmName('GPT', resolve);
    });

    expect(resolved).toBeNull();
    expect(telemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          llmName: 'GPT',
          label: 'RUN_SCOPE_BLOCKED'
        })
      ])
    );
  });

  test('tryAttachExistingTab rejects foreign eligible tabs when run scope is active', async () => {
    const { context, telemetry } = createTabManagerSandbox({
      queryTabs: [
        {
          id: 2002,
          url: 'https://chatgpt.com/c/foreign',
          windowId: 7,
          index: 0,
          status: 'complete',
          lastAccessed: Date.now()
        }
      ]
    });

    const attached = await context.tryAttachExistingTab('GPT', 'hello');

    expect(attached).toBe(false);
    expect(context.prepareTabForUse).not.toHaveBeenCalled();
    expect(telemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          llmName: 'GPT',
          label: 'RUN_SCOPE_BLOCKED'
        }),
        expect.objectContaining({
          llmName: 'GPT',
          label: 'ATTACH_REJECTED'
        })
      ])
    );
  });

  test('Round 0 binds a discarded page without reloading or waiting for readiness', async () => {
    const {context} = createTabManagerSandbox({queryTabs: [
      {id:2002,url:'https://chatgpt.com/c/current',status:'loading',discarded:true}
    ]});
    context.jobState.llms.GPT.tabId = 2002;
    context.ensureTabReadyForDispatch = jest.fn(() => new Promise(() => {}));
    expect(await context.tryAttachExistingTab('GPT','hello',[],{allowGlobalReuse:true,deferDispatch:true})).toBe(true);
    expect(context.ensureTabReadyForDispatch).not.toHaveBeenCalled();
    expect(context.prepareTabForUse).not.toHaveBeenCalled();
    expect(context.dispatchPromptToTab).not.toHaveBeenCalled();
    expect(context.jobState.llms.GPT.tabId).toBe(2002);
  });

  test('mapped conversation wins over a newer clean tab during global reuse', async () => {
    const { context } = createTabManagerSandbox({
      queryTabs: [
        { id: 2002, url: 'https://chatgpt.com/c/current', status: 'complete' },
        { id: 2003, url: 'https://chatgpt.com/c/unrelated', status: 'complete' }
      ],
      surfaceByTabId: { 2002: { composerHasDraft: true, stopVisible: true } }
    });
    context.jobState.llms.GPT.tabId = 2002;
    expect(await context.tryAttachExistingTab('GPT', 'follow up', [], { allowGlobalReuse: true })).toBe(true);
    expect(context.dispatchPromptToTab).toHaveBeenCalledWith('GPT', 2002, 'follow up', [], 'attach_existing');
  });

  test('tryAttachExistingTab can globally reuse latest model tab when explicitly allowed', async () => {
    const now = Date.now();
    const { context, telemetry } = createTabManagerSandbox({
      queryTabs: [
        {
          id: 2002,
          url: 'https://chatgpt.com/c/older',
          windowId: 7,
          index: 0,
          status: 'complete',
          lastAccessed: now - 1000
        },
        {
          id: 2003,
          url: 'https://chatgpt.com/c/newer',
          windowId: 7,
          index: 1,
          status: 'complete',
          lastAccessed: now
        }
      ]
    });

    const attached = await context.tryAttachExistingTab('GPT', 'hello', [], { allowGlobalReuse: true });

    expect(attached).toBe(true);
    expect(context.prepareTabForUse).toHaveBeenCalledWith(2003, 'GPT');
    expect(context.dispatchPromptToTab).toHaveBeenCalledWith('GPT', 2003, 'hello', [], 'attach_existing');
    expect(context.jobState.session.boundTabIds).toContain(2003);
    expect(telemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          llmName: 'GPT',
          label: 'TAB_ATTACHED',
          payload: expect.objectContaining({
            meta: expect.objectContaining({
              runScope: 'global'
            })
          })
        })
      ])
    );
  });

  test('global reuse checks every matching tab before falling back to a fresh one', async () => {
    const now = Date.now();
    const tabs = [1, 2, 3, 4].map((offset) => ({
      id: 2100 + offset,
      url: `https://chatgpt.com/c/${offset}`,
      windowId: 7,
      index: offset,
      status: 'complete',
      lastAccessed: now - offset
    }));
    const { context } = createTabManagerSandbox({
      queryTabs: tabs,
      surfaceByTabId: {
        2101: { composerHasDraft: false, stopVisible: false, modalVisible: false },
        2102: { composerHasDraft: true, stopVisible: false, modalVisible: false },
        2103: { composerHasDraft: true, stopVisible: false, modalVisible: false },
        2104: { composerHasDraft: true, stopVisible: false, modalVisible: false }
      }
    });

    const attached = await context.tryAttachExistingTab('GPT', 'hello', [], { allowGlobalReuse: true });

    expect(attached).toBe(true);
    expect(context.prepareTabForUse).toHaveBeenCalledWith(2101, 'GPT');
  });

  test('fresh-tab creation resolves only after the new binding is installed', async () => {
    const { context } = createTabManagerSandbox({ createDelayMs: 20 });

    const creation = context.createNewLlmTab('GPT', 'hello', [], {
      forceCreate: true,
      deferDispatch: true
    });

    expect(creation).toBeInstanceOf(Promise);
    expect(context.TabMapManager.get('GPT')).toBeNull();
    await expect(creation).resolves.toBe(true);
    expect(context.TabMapManager.get('GPT')).toBe(999);
    expect(context.jobState.session.boundTabIds).toContain(999);
  });

  test('resolveTabForLlmName revalidates cached tab before returning it', async () => {
    const { context, telemetry } = createTabManagerSandbox({
      queryTabs: [
        {
          id: 2002,
          url: 'https://example.com/not-chatgpt',
          windowId: 7,
          index: 0,
          status: 'complete',
          lastAccessed: Date.now()
        }
      ]
    });
    context.llmTabMap.GPT = 2002;
    context.jobState.session.boundTabIds = [2002];

    const resolved = await new Promise((resolve) => {
      context.resolveTabForLlmName('GPT', resolve);
    });

    expect(resolved).toBeNull();
    expect(context.llmTabMap.GPT).toBeUndefined();
    expect(telemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          llmName: 'GPT',
          label: 'TAB_READY_FAIL',
          payload: expect.objectContaining({
            details: 'tab_ineligible'
          })
        })
      ])
    );
  });

  test('Perplexity can dispatch when Chrome stays loading but its content script is ready', async () => {
    const { context, telemetry } = createTabManagerSandbox({
      healthPingReady: true,
      queryTabs: [
        {
          id: 4001,
          url: 'https://www.perplexity.ai/',
          windowId: 8,
          index: 0,
          status: 'loading',
          lastAccessed: Date.now()
        }
      ]
    });

    const readiness = await context.ensureTabReadyForDispatch(4001, 'Perplexity', { reason: 'round1' });

    expect(readiness.ok).toBe(true);
    expect(telemetry).toEqual(expect.arrayContaining([
      expect.objectContaining({
        llmName: 'Perplexity',
        label: 'TAB_READY_CONTENT_SCRIPT',
        payload: expect.objectContaining({ details: 'browser_status_loading' })
      })
    ]));
  });

  test('TabMapManager.load drops app UI tabs from persisted llmTabMap', async () => {
    const { context } = createTabManagerSandbox({
      storageInitial: {
        llmTabMap: { GPT: 3001 }
      },
      queryTabs: [
        {
          id: 3001,
          url: 'chrome-extension://test/pipeline_panel.html',
          windowId: 1,
          index: 0,
          status: 'complete'
        }
      ]
    });

    await context.TabMapManager.load();

    expect(context.llmTabMap.GPT).toBeUndefined();
    expect(context.TabMapManager.get('GPT')).toBeNull();
  });
});

describe('tab-manager participants of one model (T07, mock transport)', () => {
  const twoTabs = () => [
    { id: 2002, url: 'https://chatgpt.com/c/participant-a', windowId: 7, index: 0, status: 'complete', lastAccessed: Date.now() - 1000 },
    { id: 2003, url: 'https://chatgpt.com/c/participant-b', windowId: 7, index: 1, status: 'complete', lastAccessed: Date.now() }
  ];

  test('a participant binding is kept apart from the model binding and survives in storage', async () => {
    const { context } = createTabManagerSandbox({ queryTabs: twoTabs() });
    await context.bindParticipantChat('run-1', 'A', 'GPT', 2002, {});
    await context.bindParticipantChat('run-1', 'B', 'GPT', 2003, {});
    expect(context.participantChatOf('run-1', 'A').tabId).toBe(2002);
    expect(context.participantChatOf('run-1', 'B').tabId).toBe(2003);
    expect(context.tabsOfOtherParticipants('GPT', 'run-1', 'A')).toEqual([2003]);
    expect(context.tabsOfOtherParticipants('GPT', 'run-1', 'B')).toEqual([2002]);
    expect(context.tabsOfOtherParticipants('Perplexity', 'run-1', 'A')).toEqual([]);
    const stored = await context.chrome.storage.local.get('llmParticipantTabMap');
    expect(stored.llmParticipantTabMap).toEqual({ 'run-1': {
      A: expect.objectContaining({ modelName: 'GPT', tabId: 2002 }),
      B: expect.objectContaining({ modelName: 'GPT', tabId: 2003 })
    } });
  });

  test('a participant keeps its own tab even when another tab of the model is newer', async () => {
    const { context } = createTabManagerSandbox({ queryTabs: twoTabs() });
    await context.bindParticipantChat('run-1', 'A', 'GPT', 2002, {});
    await context.bindParticipantChat('run-1', 'B', 'GPT', 2003, {});
    expect(await context.tryAttachExistingTab('GPT', 'to A', [], {
      allowGlobalReuse: true, mandatoryReuse: true, preferTabId: 2002, excludeTabIds: [2003]
    })).toBe(true);
    expect(context.dispatchPromptToTab).toHaveBeenCalledWith('GPT', 2002, 'to A', [], 'attach_existing');
  });

  test('a participant whose tab is closed does not take the tab of another participant of the same model', async () => {
    const tabs = twoTabs().filter((tab) => tab.id !== 2002);
    const { context } = createTabManagerSandbox({ queryTabs: tabs });
    await context.bindParticipantChat('run-1', 'A', 'GPT', 2002, {});
    await context.bindParticipantChat('run-1', 'B', 'GPT', 2003, {});
    // A's tab (2002) is closed; the only open tab of the model (2003) belongs to B and must not be taken.
    expect(await context.tryAttachExistingTab('GPT', 'to A', [], {
      allowGlobalReuse: true, mandatoryReuse: true, preferTabId: 2002, excludeTabIds: [2003]
    })).toBe(false);
    expect(context.dispatchPromptToTab).not.toHaveBeenCalledWith('GPT', 2003, expect.anything(), expect.anything(), expect.anything());
  });

  test('the model binding of the active participant does not decide the tab of another participant', async () => {
    const { context } = createTabManagerSandbox({ queryTabs: twoTabs() });
    await context.bindParticipantChat('run-1', 'A', 'GPT', 2002, {});
    await context.bindParticipantChat('run-1', 'B', 'GPT', 2003, {});
    // The model entry points at B (its wave is the active one); A's request must still go to A's tab.
    await context.setTabBinding('GPT', 2003);
    expect(await context.tryAttachExistingTab('GPT', 'to A', [], {
      allowGlobalReuse: true, mandatoryReuse: true, preferTabId: 2002, excludeTabIds: [2003]
    })).toBe(true);
    expect(context.dispatchPromptToTab).toHaveBeenCalledWith('GPT', 2002, 'to A', [], 'attach_existing');
  });

  test('without participant options the model path is unchanged (name-keyed reuse)', async () => {
    const { context } = createTabManagerSandbox({ queryTabs: twoTabs() });
    await context.bindParticipantChat('run-1', 'A', 'GPT', 2002, {});
    expect(await context.tryAttachExistingTab('GPT', 'legacy', [], { allowGlobalReuse: true })).toBe(true);
    expect(context.dispatchPromptToTab).toHaveBeenCalledWith('GPT', 2003, 'legacy', [], 'attach_existing');
  });
});

describe('Basic participant chats are bound per run and never lost silently (R01)', () => {
  const chatUrl = (id) => `https://chatgpt.com/c/${id}`;
  const liveTab = (id, index = 0) => ({ id, url: chatUrl(id), windowId: 7, index, status: 'complete', lastAccessed: Date.now() });

  function participantSandbox(queryTabs = []) {
    const { context } = createTabManagerSandbox({ queryTabs });
    context.ensureTabReadyForDispatch = jest.fn(async (tabId) => ({ ok: true, tab: { id: tabId, url: chatUrl(tabId) } }));
    context.schedulePromptDispatchSupervisor = jest.fn();
    context.chrome.tabs.create = jest.fn((_options, cb) => {
      const tab = { id: 900 + context.chrome.tabs.create.mock.calls.length, url: 'https://chatgpt.com/', windowId: 7, index: 9, status: 'complete' };
      queryTabs.push(tab);
      cb(tab);
    });
    return { context, queryTabs };
  }
  const visit = (runId, participantId, extra = {}) => ({ runId, participantId, newChat: false, requestId: `req-${participantId}`, stageAttemptId: 'a1', ...extra });

  test('a closed bound tab with a foreign open tab of the same provider: nothing is sent, the request stops before the send', async () => {
    const { context } = participantSandbox([liveTab(2002)]);
    await context.bindParticipantChat('run-1', 'author-A', 'GPT', 2001, { requestId: 'req-1', stageAttemptId: 'a1' });
    const result = await context.openParticipantChat('GPT', visit('run-1', 'author-A', { stageAttemptId: 'a2' }), 'hello', []);
    expect(result.ok).toBe(false);
    expect(result.error.errorCode).toBe('participant_chat_lost');
    expect(result.error.meta).toEqual(expect.objectContaining({ participantId: 'author-A', runId: 'run-1', tabId: 2001 }));
    expect(context.dispatchPromptToTab).not.toHaveBeenCalled();
    expect(context.chrome.tabs.create).not.toHaveBeenCalled();
  });

  test('a bound chat that is not eligible any more (other site) is lost too', async () => {
    const { context } = participantSandbox([{ id: 2001, url: 'https://example.com/', windowId: 7, index: 0, status: 'complete' }]);
    await context.bindParticipantChat('run-1', 'author-A', 'GPT', 2001, {});
    const result = await context.openParticipantChat('GPT', visit('run-1', 'author-A'), 'hello', []);
    expect(result.error.errorCode).toBe('participant_chat_lost');
    expect(context.dispatchPromptToTab).not.toHaveBeenCalled();
  });

  test('a continue sends into its own bound chat and records the binding before the send', async () => {
    const { context } = participantSandbox([liveTab(2001), liveTab(2002, 1)]);
    await context.bindParticipantChat('run-1', 'author-A', 'GPT', 2001, { requestId: 'req-1', stageAttemptId: 'a1' });
    context.dispatchPromptToTab = jest.fn(() => {
      expect(context.participantChatOf('run-1', 'author-A')).toEqual(expect.objectContaining({ tabId: 2001, requestId: 'req-A' }));
    });
    const result = await context.openParticipantChat('GPT', visit('run-1', 'author-A', { requestId: 'req-A' }), 'hello', []);
    expect(result).toEqual({ ok: true, tabId: 2001 });
    expect(context.dispatchPromptToTab).toHaveBeenCalledTimes(1);
    expect(context.dispatchPromptToTab).toHaveBeenCalledWith('GPT', 2001, 'hello', [], 'participant_continue');
  });

  test('two runs with one participant id keep their own bindings', async () => {
    const { context } = participantSandbox([liveTab(2001), liveTab(2002, 1)]);
    await context.bindParticipantChat('run-1', 'author-A', 'GPT', 2001, { stageAttemptId: 'a1' });
    await context.bindParticipantChat('run-2', 'author-A', 'GPT', 2002, { stageAttemptId: 'a1' });
    await context.openParticipantChat('GPT', visit('run-2', 'author-A'), 'run two', []);
    expect(context.dispatchPromptToTab).toHaveBeenCalledWith('GPT', 2002, 'run two', [], 'participant_continue');
    expect(context.participantChatOf('run-1', 'author-A').tabId).toBe(2001);
    expect(context.participantChatOf('run-2', 'author-A').tabId).toBe(2002);
  });

  test('a continue without a binding never takes a chat bound to another participant', async () => {
    const { context } = participantSandbox([liveTab(2002)]);
    await context.bindParticipantChat('run-1', 'author-B', 'GPT', 2002, { stageAttemptId: 'a1' });
    const result = await context.openParticipantChat('GPT', visit('run-1', 'author-A'), 'hello', []);
    expect(result.ok).toBe(true);
    expect(result.tabId).not.toBe(2002);
    expect(context.participantChatOf('run-1', 'author-B').tabId).toBe(2002);
  });

  test('a new visit opens one chat; a repeat inside the same visit goes to that chat without a new tab', async () => {
    const { context } = participantSandbox([]);
    const first = await context.openParticipantChat('GPT', visit('run-1', 'author-A', { newChat: true, stageAttemptId: 'a1' }), 'p1', []);
    expect(first.ok).toBe(true);
    expect(context.chrome.tabs.create).toHaveBeenCalledTimes(1);
    const boundTab = first.tabId;
    const repeat = await context.openParticipantChat('GPT', visit('run-1', 'author-A', { newChat: true, stageAttemptId: 'a1' }), 'p1 again', []);
    expect(repeat).toEqual({ ok: true, tabId: boundTab });
    expect(context.chrome.tabs.create).toHaveBeenCalledTimes(1);
    expect(context.dispatchPromptToTab).toHaveBeenLastCalledWith('GPT', boundTab, 'p1 again', [], 'participant_continue');
  });

  test('a correction inside the visit goes on in the bound chat; the next visit creates its own chat', async () => {
    const { context } = participantSandbox([]);
    const first = await context.openParticipantChat('GPT', visit('run-1', 'author-A', { newChat: true, stageAttemptId: 'a1' }), 'p1', []);
    const correction = await context.openParticipantChat('GPT', visit('run-1', 'author-A', { stageAttemptId: 'a2' }), 'fix', []);
    expect(correction).toEqual({ ok: true, tabId: first.tabId });
    expect(context.chrome.tabs.create).toHaveBeenCalledTimes(1);
    await context.openParticipantChat('GPT', visit('run-1', 'author-A', { newChat: true, stageAttemptId: 'a9' }), 'next', []);
    expect(context.chrome.tabs.create).toHaveBeenCalledTimes(2);
  });

  test('a binding that cannot be written stops the request before the send', async () => {
    const { context } = participantSandbox([]);
    const realSet = context.chrome.storage.local.set;
    context.chrome.storage.local.set = jest.fn((obj) => (obj && obj.llmParticipantTabMap
      ? Promise.reject(new Error('quota exceeded'))
      : realSet(obj)));
    const result = await context.openParticipantChat('GPT', visit('run-1', 'author-A', { newChat: true, stageAttemptId: 'a1' }), 'p1', []);
    expect(result.ok).toBe(false);
    expect(result.error.errorCode).toBe('participant_binding_failed');
    expect(context.dispatchPromptToTab).not.toHaveBeenCalled();
  });

  test('clearing a run removes only its bindings', async () => {
    const { context } = participantSandbox([liveTab(2001), liveTab(2002, 1)]);
    await context.bindParticipantChat('run-1', 'author-A', 'GPT', 2001, {});
    await context.bindParticipantChat('run-2', 'author-A', 'GPT', 2002, {});
    await context.clearParticipantRun('run-1');
    expect(context.participantChatOf('run-1', 'author-A')).toBeNull();
    expect(context.participantChatOf('run-2', 'author-A').tabId).toBe(2002);
  });
});

describe('Basic participant chat restored from the saved snapshot (R01, resume)', () => {
  const chatUrl = (id) => `https://chatgpt.com/c/${id}`;
  const liveTab = (id, index = 0) => ({ id, url: chatUrl(id), windowId: 7, index, status: 'complete', lastAccessed: Date.now() });
  const saved = (tabId, extra = {}) => ({ tabId, requestId: 'req-saved', stageAttemptId: 'a1', ...extra });
  const visit = (runId, participantId, extra = {}) => ({ runId, participantId, newChat: false, requestId: 'req-now', stageAttemptId: 'a2', ...extra });

  function resumeSandbox(queryTabs = []) {
    const { context } = createTabManagerSandbox({ queryTabs });
    context.ensureTabReadyForDispatch = jest.fn(async (tabId) => ({ ok: true, tab: { id: tabId, url: chatUrl(tabId) } }));
    context.schedulePromptDispatchSupervisor = jest.fn();
    context.chrome.tabs.create = jest.fn((_options, cb) => {
      const tab = { id: 950 + context.chrome.tabs.create.mock.calls.length, url: 'https://chatgpt.com/', windowId: 7, index: 9, status: 'complete' };
      queryTabs.push(tab);
      cb(tab);
    });
    return { context, queryTabs };
  }

  test('no binding in the background: the saved chat is restored and the send goes to it, not to a foreign tab', async () => {
    const { context } = resumeSandbox([liveTab(2001), liveTab(2002, 1)]);
    const result = await context.openParticipantChat('GPT', { ...visit('run-1', 'author-A'), binding: saved(2001) }, 'resume', []);
    expect(result).toEqual({ ok: true, tabId: 2001 });
    expect(context.dispatchPromptToTab).toHaveBeenCalledWith('GPT', 2001, 'resume', [], 'participant_continue');
    expect(context.participantChatOf('run-1', 'author-A')).toEqual(expect.objectContaining({ tabId: 2001, requestId: 'req-now' }));
  });

  test('a saved chat whose tab is gone stops the request: no send, no foreign tab, no new chat', async () => {
    const { context } = resumeSandbox([liveTab(2002, 1)]);
    const result = await context.openParticipantChat('GPT', { ...visit('run-1', 'author-A'), binding: saved(2001) }, 'resume', []);
    expect(result.ok).toBe(false);
    expect(result.error.errorCode).toBe('participant_chat_lost');
    expect(result.error.meta).toEqual(expect.objectContaining({ participantId: 'author-A', runId: 'run-1', tabId: 2001 }));
    expect(context.dispatchPromptToTab).not.toHaveBeenCalled();
    expect(context.chrome.tabs.create).not.toHaveBeenCalled();
    expect(context.participantChatOf('run-1', 'author-A')).toBeNull();
  });

  test('V01: a resumed participant that already sent has no chat on record: nothing is sent, no foreign tab, no new chat', async () => {
    // The chat of run-1 was dropped (another run replaced it); a foreign tab of the provider is open and would be taken by a global attach.
    const { context } = resumeSandbox([liveTab(2003, 1)]);
    const result = await context.openParticipantChat('GPT', { ...visit('run-1', 'author-A'), binding: null, strict: true }, 'resume', []);
    expect(result.ok).toBe(false);
    expect(result.error.errorCode).toBe('participant_chat_lost');
    expect(result.error.meta).toEqual(expect.objectContaining({ participantId: 'author-A', runId: 'run-1', reason: 'binding_missing' }));
    expect(context.dispatchPromptToTab).not.toHaveBeenCalled();
    expect(context.chrome.tabs.create).not.toHaveBeenCalled();
    expect(context.participantChatOf('run-1', 'author-A')).toBeNull();
  });

  test('V01: the first request of a participant (not strict) still may take a chat that no participant is bound to', async () => {
    const { context } = resumeSandbox([liveTab(2003, 1)]);
    const result = await context.openParticipantChat('GPT', { ...visit('run-1', 'author-A'), binding: null }, 'first', []);
    expect(result.ok).toBe(true);
  });

  test('a binding of the background wins over the saved one', async () => {
    const { context } = resumeSandbox([liveTab(2001), liveTab(2002, 1)]);
    await context.bindParticipantChat('run-1', 'author-A', 'GPT', 2002, { stageAttemptId: 'a1' });
    await context.openParticipantChat('GPT', { ...visit('run-1', 'author-A'), binding: saved(2001) }, 'hello', []);
    expect(context.dispatchPromptToTab).toHaveBeenCalledWith('GPT', 2002, 'hello', [], 'participant_continue');
  });

  test('a new visit ignores the saved chat and opens its own chat', async () => {
    const { context } = resumeSandbox([liveTab(2001)]);
    const result = await context.openParticipantChat('GPT', { ...visit('run-1', 'author-A', { newChat: true }), binding: saved(2001) }, 'next visit', []);
    expect(result.ok).toBe(true);
    expect(result.tabId).not.toBe(2001);
    expect(context.chrome.tabs.create).toHaveBeenCalledTimes(1);
  });

  test('a run that another run has replaced goes on from its own saved chat (no shared binding)', async () => {
    const { context } = resumeSandbox([liveTab(2001), liveTab(2003, 1)]);
    await context.bindParticipantChat('run-1', 'author-A', 'GPT', 2001, { stageAttemptId: 'a1' });
    await context.pruneParticipantRuns('run-2');
    await context.bindParticipantChat('run-2', 'author-A', 'GPT', 2003, { stageAttemptId: 'a1' });
    const result = await context.openParticipantChat('GPT', { ...visit('run-1', 'author-A'), binding: saved(2001) }, 'run one', []);
    expect(result).toEqual({ ok: true, tabId: 2001 });
    expect(context.participantChatOf('run-2', 'author-A').tabId).toBe(2003);
  });

  test('the bindings of one run are read back for the page; another run is not in them', async () => {
    const { context } = resumeSandbox([liveTab(2001), liveTab(2002, 1)]);
    await context.bindParticipantChat('run-1', 'author-A', 'GPT', 2001, { requestId: 'req-A', stageAttemptId: 'a1' });
    await context.bindParticipantChat('run-2', 'author-B', 'GPT', 2002, { requestId: 'req-B', stageAttemptId: 'a1' });
    expect(context.participantChatBindingsOf('run-1')).toEqual({
      'author-A': { modelName: 'GPT', tabId: 2001, requestId: 'req-A', stageAttemptId: 'a1' }
    });
  });
});

describe('Read-only check of an unconfirmed participant request (N04)', () => {
  const chatUrl = (id) => `https://chatgpt.com/c/${id}`;
  const liveTab = (id, index = 0) => ({ id, url: chatUrl(id), windowId: 7, index, status: 'complete', lastAccessed: Date.now() });

  // The page-side extractor is a pure read of the chat; the scripting mock answers with what the chat holds.
  // `proof`: whether the answer ends with the delivery token of the request that was sent (V03).
  function checkSandbox(queryTabs, answer, { proof = true } = {}) {
    const { context } = createTabManagerSandbox({ queryTabs });
    context.answerHasDeliveryToken = jest.fn(() => proof);
    context.extractLatestAssistantSnapshotInPage = () => ({});
    context.chrome.scripting.executeScript = jest.fn(async () => [{ result: answer }]);
    context.ensureTabReadyForDispatch = jest.fn(async (tabId) => ({ ok: true, tab: { id: tabId, url: chatUrl(tabId) } }));
    context.chrome.tabs.create = jest.fn();
    return { context };
  }
  const expectNothingSent = (context) => {
    expect(context.dispatchPromptToTab).not.toHaveBeenCalled();
    expect(context.chrome.tabs.create).not.toHaveBeenCalled();
    expect(context.prepareTabForUse).not.toHaveBeenCalled();
  };
  const check = (context, extra = {}) => context.checkParticipantAnswer({
    llmName: 'GPT', runId: 'run-1', participantId: 'author-A', transportRequestId: 'req-1', ...extra
  });

  test('V03: the last message of the chat with no delivery token of this request is not found: an old answer is never attributed to a new request', async () => {
    const { context } = checkSandbox([liveTab(2001)], { ok: true, text: 'OLD ANSWER of the previous request' }, { proof: false });
    await context.bindParticipantChat('run-1', 'author-A', 'GPT', 2001, { requestId: 'req-1', stageAttemptId: 'a1' });
    const result = await check(context);
    expect(result.ok).toBe(false);
    expect(result.status).toBe('no_answer');
    expect(result.reason).toBe('no_delivery_proof');
    expect(result.text).toBeUndefined();
    expectNothingSent(context);
  });

  test('a found answer in the bound chat is returned as text, with its status of a read', async () => {
    const { context } = checkSandbox([liveTab(2001)], { ok: true, text: 'Ответ участника', html: '<p>Ответ участника</p>', candidateCount: 1 });
    await context.bindParticipantChat('run-1', 'author-A', 'GPT', 2001, { requestId: 'req-1', stageAttemptId: 'a1' });
    const result = await check(context);
    expect(result).toEqual(expect.objectContaining({ ok: true, status: 'found', text: 'Ответ участника', tabId: 2001 }));
    expectNothingSent(context);
  });

  test('a found answer is handed over as it is: its validity is the engine check, not the read', async () => {
    const { context } = checkSandbox([liveTab(2001)], { ok: true, text: 'слишком коротко' });
    await context.bindParticipantChat('run-1', 'author-A', 'GPT', 2001, { requestId: 'req-1', stageAttemptId: 'a1' });
    expect(await check(context)).toEqual(expect.objectContaining({ ok: true, status: 'found', text: 'слишком коротко' }));
  });

  test('no answer in the chat: status no_answer, never a success', async () => {
    const { context } = checkSandbox([liveTab(2001)], { ok: false, length: 0, candidates: 0 });
    await context.bindParticipantChat('run-1', 'author-A', 'GPT', 2001, { requestId: 'req-1', stageAttemptId: 'a1' });
    const result = await check(context);
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 'no_answer', tabId: 2001 }));
    expectNothingSent(context);
  });

  test('the bound tab is closed: chat_unavailable, a foreign open tab of the provider is not read or taken', async () => {
    const { context } = checkSandbox([liveTab(2002, 1)], { ok: true, text: 'чужой ответ' });
    await context.bindParticipantChat('run-1', 'author-A', 'GPT', 2001, { requestId: 'req-1', stageAttemptId: 'a1' });
    const result = await check(context);
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 'chat_unavailable', tabId: 2001 }));
    expect(context.chrome.scripting.executeScript).not.toHaveBeenCalled();
    expectNothingSent(context);
  });

  test('a read that fails is chat_unavailable, never an answer', async () => {
    const { context } = checkSandbox([liveTab(2001)], { ok: true, text: 'не должен попасть' });
    context.chrome.scripting.executeScript = jest.fn(async () => { throw new Error('Cannot access contents of the page'); });
    await context.bindParticipantChat('run-1', 'author-A', 'GPT', 2001, { requestId: 'req-1', stageAttemptId: 'a1' });
    expect(await check(context)).toEqual(expect.objectContaining({ ok: false, status: 'chat_unavailable' }));
  });

  test('the chat was bound to a later request: ambiguous, the answer is not attributed to this request', async () => {
    const { context } = checkSandbox([liveTab(2001)], { ok: true, text: 'ответ другого запроса' });
    await context.bindParticipantChat('run-1', 'author-A', 'GPT', 2001, { requestId: 'req-2', stageAttemptId: 'a2' });
    expect(await check(context)).toEqual(expect.objectContaining({ ok: false, status: 'ambiguous' }));
  });

  test('the chat the page saved differs from the bound one: ambiguous', async () => {
    const { context } = checkSandbox([liveTab(2001), liveTab(2002, 1)], { ok: true, text: 'ответ' });
    await context.bindParticipantChat('run-1', 'author-A', 'GPT', 2002, { requestId: 'req-1', stageAttemptId: 'a1' });
    expect(await check(context, { tabId: 2001 })).toEqual(expect.objectContaining({ ok: false, status: 'ambiguous' }));
  });

  test('after a reload the bound chat is gone from the background: the chat the page saved is read, and only that one', async () => {
    const { context } = checkSandbox([liveTab(2001), liveTab(2002, 1)], { ok: true, text: 'ответ после перезагрузки' });
    expect(await check(context, { tabId: 2001 })).toEqual(expect.objectContaining({ ok: true, status: 'found', tabId: 2001 }));
    expect(context.chrome.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 2001 } }));
    expectNothingSent(context);
  });

  test('no chat at all (no binding, no saved chat): chat_unavailable and nothing is read', async () => {
    const { context } = checkSandbox([liveTab(2001)], { ok: true, text: 'чужой' });
    expect(await check(context)).toEqual(expect.objectContaining({ ok: false, status: 'chat_unavailable', reason: 'no_binding' }));
    expect(context.chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  test('the previous answer of the participant is excluded from the read, so it is not taken as the new one', async () => {
    const { context } = checkSandbox([liveTab(2001)], { ok: false, length: 0, candidates: 0 });
    await context.bindParticipantChat('run-1', 'author-A', 'GPT', 2001, { requestId: 'req-1', stageAttemptId: 'a1' });
    await check(context, { excludeText: 'старый ответ' });
    const args = context.chrome.scripting.executeScript.mock.calls[0][0].args;
    expect(args[2]).toEqual({ excludeTextSignatures: ['старый ответ'] });
  });

  test('a check does not change the binding of the run', async () => {
    const { context } = checkSandbox([liveTab(2001)], { ok: true, text: 'ответ' });
    await context.bindParticipantChat('run-1', 'author-A', 'GPT', 2001, { requestId: 'req-1', stageAttemptId: 'a1' });
    const before = JSON.stringify(context.participantChatBindingsOf('run-1'));
    await check(context);
    expect(JSON.stringify(context.participantChatBindingsOf('run-1'))).toBe(before);
  });
});
