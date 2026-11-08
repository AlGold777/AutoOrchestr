/** @jest-environment node */
// M-19: a participant reads and "Get it"s only its own tab (the one the request was sent to),
// never the most recent tab of the same model domain; a closed tab ends with tab_missing.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const TABS = read('background/tab-manager.js');
const ORCH = read('background/job-orchestrator.js');
const DISPATCH = read('background/dispatch-coordinator.js');

const sliceFunction = (src, name) => {
  let start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`no function ${name}`);
  if (src.slice(start - 6, start) === 'async ') start -= 6;
  const open = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`unbalanced ${name}`);
};

const isValidTabId = (id) => Number.isInteger(id) && id > 0;

// Builds the tab-binding context: real getBoundTabId/markFallbackBinding and handleManualResponsePing,
// with chrome and the rest of the worker stubbed.
const buildContext = ({ mapped = {}, entries = {}, openTabs = [], closed = new Set() } = {}) => {
  const ensured = [];
  const bindings = [];
  const queries = [];
  const context = {
    console,
    isValidTabId,
    jobState: { llms: entries, session: { boundTabIds: null } },
    saveJobState: () => {},
    fallbackRecoveryUsed: new Set(),
    trackSessionTab: () => {},
    trackRunTab: () => {},
    broadcastDiagnostic: () => {},
    TabMapManager: {
      get: (llm) => mapped[llm] || null,
      setTab: (llm, tabId) => { bindings.push([llm, tabId]); mapped[llm] = tabId; return Promise.resolve(); },
      removeByName: () => Promise.resolve()
    },
    getTabSafe: (tabId) => Promise.resolve(closed.has(tabId) ? null : (openTabs.find((t) => t.id === tabId) || null)),
    isEligibleTabForLlm: (llm, tab) => Boolean(tab && /chat\.example/.test(tab.url)),
    setTabBinding: (llm, tabId) => { bindings.push([llm, tabId]); return Promise.resolve(); },
    getQueryPatternsForLLM: () => ['https://chat.example/*'],
    chrome: {
      runtime: { lastError: null },
      tabs: { query: (info, cb) => { queries.push(info); cb(openTabs); } }
    },
    ensureManualRecoveryModelEntry: (llm, tabId) => { ensured.push(tabId); throw new Error('reached_recovery'); }
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(`${sliceFunction(TABS, 'getBoundTabId')};\n${sliceFunction(TABS, 'markFallbackBinding')};\n`, context);
  vm.runInContext(`${sliceFunction(ORCH, 'handleManualResponsePing')};`, context);
  return { context, ensured, bindings, queries };
};

const OLD = { id: 1, url: 'https://chat.example/c/old-topic', lastAccessed: 999 };
const NEW = { id: 2, url: 'https://chat.example/c/current-run', lastAccessed: 10 };

describe('reads use the tab the request was sent to', () => {
  test('two tabs of one model: the bound entry tab wins over the global map', () => {
    const { context } = buildContext({ mapped: { Claude: 1 }, entries: { Claude: { tabId: 2 } } });
    expect(context.getBoundTabId('Claude', context.jobState.llms.Claude)).toBe(2);
  });

  test('without a bound entry tab the global map is not taken from another run', () => {
    const { context } = buildContext({ mapped: { Claude: 1 }, entries: { Claude: {} } });
    expect(context.getBoundTabId('Claude', context.jobState.llms.Claude)).toBe(1);
    context.jobState.session.boundTabIds = [2];
    expect(context.getBoundTabId('Claude', context.jobState.llms.Claude)).toBeNull();
  });
});

describe('Get it never takes an old tab of the same domain', () => {
  test('bound participant: recovery starts on its own tab (2), not the newer-accessed old tab (1)', async () => {
    const { context, ensured } = buildContext({
      mapped: { Claude: 1 }, entries: { Claude: { tabId: 2 } }, openTabs: [OLD, NEW]
    });
    await expect(context.handleManualResponsePing('Claude', {})).rejects.toThrow('reached_recovery');
    expect(ensured).toEqual([2]);
  });

  test('no bound tab: returns tab_missing, searches nothing and rebinds nothing', async () => {
    const { context, ensured, bindings, queries } = buildContext({ entries: { Claude: {} }, openTabs: [OLD, NEW] });
    const out = await context.handleManualResponsePing('Claude', {});
    expect(out).toMatchObject({ status: 'manual_ping_failed', reason: 'tab_missing' });
    expect(out.error).toMatch(/не найдена/);
    expect(queries).toEqual([]);
    expect(bindings).toEqual([]);
    expect(ensured).toEqual([]);
  });

  test('no entry for the model at all (after Reload): takes the most recently used open tab', async () => {
    const { context, ensured } = buildContext({ entries: {}, openTabs: [NEW, OLD] });
    await expect(context.handleManualResponsePing('Claude', {})).rejects.toThrow('reached_recovery');
    expect(ensured).toEqual([1]); // OLD has the larger lastAccessed
  });

  test('closed bound tab: ends with tab_missing and does not switch to another tab', async () => {
    const { context, ensured, bindings } = buildContext({
      mapped: { Claude: 2 }, entries: { Claude: { tabId: 2 } }, openTabs: [OLD], closed: new Set([2])
    });
    const out = await context.handleManualResponsePing('Claude', {});
    expect(out).toMatchObject({ status: 'manual_ping_failed', reason: 'tab_missing' });
    expect(ensured).toEqual([]);
    expect(bindings).toEqual([]);
  });
});

describe('the send path binds the participant to the tab it sent to', () => {
  test('dispatchPromptToTab records entry.tabId before the send starts', () => {
    const body = sliceFunction(DISPATCH, 'dispatchPromptToTab');
    const bind = body.indexOf('entry.tabId = tabId;');
    expect(bind).toBeGreaterThan(-1);
    expect(bind).toBeLessThan(body.indexOf('try {', body.indexOf('checkTabVisibilityForDispatch(')));
  });
});
