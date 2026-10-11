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
    await context.bindParticipantTab('A', 'GPT', 2002);
    await context.bindParticipantTab('B', 'GPT', 2003);
    expect(context.participantTabOf('A')).toBe(2002);
    expect(context.participantTabOf('B')).toBe(2003);
    expect(context.tabsOfOtherParticipants('GPT', 'A')).toEqual([2003]);
    expect(context.tabsOfOtherParticipants('GPT', 'B')).toEqual([2002]);
    expect(context.tabsOfOtherParticipants('Perplexity', 'A')).toEqual([]);
    const stored = await context.chrome.storage.local.get('llmParticipantTabMap');
    expect(stored.llmParticipantTabMap).toEqual({ A: { modelName: 'GPT', tabId: 2002 }, B: { modelName: 'GPT', tabId: 2003 } });
  });

  test('a participant keeps its own tab even when another tab of the model is newer', async () => {
    const { context } = createTabManagerSandbox({ queryTabs: twoTabs() });
    await context.bindParticipantTab('A', 'GPT', 2002);
    await context.bindParticipantTab('B', 'GPT', 2003);
    expect(await context.tryAttachExistingTab('GPT', 'to A', [], {
      allowGlobalReuse: true, mandatoryReuse: true, preferTabId: 2002, excludeTabIds: [2003]
    })).toBe(true);
    expect(context.dispatchPromptToTab).toHaveBeenCalledWith('GPT', 2002, 'to A', [], 'attach_existing');
  });

  test('a participant whose tab is closed does not take the tab of another participant of the same model', async () => {
    const tabs = twoTabs().filter((tab) => tab.id !== 2002);
    const { context } = createTabManagerSandbox({ queryTabs: tabs });
    await context.bindParticipantTab('A', 'GPT', 2002);
    await context.bindParticipantTab('B', 'GPT', 2003);
    // A's tab (2002) is closed; the only open tab of the model (2003) belongs to B and must not be taken.
    expect(await context.tryAttachExistingTab('GPT', 'to A', [], {
      allowGlobalReuse: true, mandatoryReuse: true, preferTabId: 2002, excludeTabIds: [2003]
    })).toBe(false);
    expect(context.dispatchPromptToTab).not.toHaveBeenCalledWith('GPT', 2003, expect.anything(), expect.anything(), expect.anything());
  });

  test('the model binding of the active participant does not decide the tab of another participant', async () => {
    const { context } = createTabManagerSandbox({ queryTabs: twoTabs() });
    await context.bindParticipantTab('A', 'GPT', 2002);
    await context.bindParticipantTab('B', 'GPT', 2003);
    // The model entry points at B (its wave is the active one); A's request must still go to A's tab.
    await context.setTabBinding('GPT', 2003);
    expect(await context.tryAttachExistingTab('GPT', 'to A', [], {
      allowGlobalReuse: true, mandatoryReuse: true, preferTabId: 2002, excludeTabIds: [2003]
    })).toBe(true);
    expect(context.dispatchPromptToTab).toHaveBeenCalledWith('GPT', 2002, 'to A', [], 'attach_existing');
  });

  test('without participant options the model path is unchanged (name-keyed reuse)', async () => {
    const { context } = createTabManagerSandbox({ queryTabs: twoTabs() });
    await context.bindParticipantTab('A', 'GPT', 2002);
    expect(await context.tryAttachExistingTab('GPT', 'legacy', [], { allowGlobalReuse: true })).toBe(true);
    expect(context.dispatchPromptToTab).toHaveBeenCalledWith('GPT', 2003, 'legacy', [], 'attach_existing');
  });
});
