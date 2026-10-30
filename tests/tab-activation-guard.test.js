/** @jest-environment node */
// Tab activation guards: an already active model tab must not be activated
// again, and visit-driven switches keep a pause between two switches.
const fs = require('fs');
const vm = require('vm');

const humanSrc = fs.readFileSync(require.resolve('../background/human-presence'), 'utf8');
const tabSrc = fs.readFileSync(require.resolve('../background/tab-manager'), 'utf8');

function sliceBetween(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`marker not found: ${startMarker}`);
  return src.slice(start, end);
}

function makeChrome(tabs) {
  // tabs: { [id]: { id, windowId, active } }; windows: { [id]: { focused } }
  const state = { tabs, windows: { 1: { focused: true } }, updates: [], winUpdates: [] };
  state.chrome = {
    runtime: { lastError: null },
    tabs: {
      get: (id, cb) => setImmediate(() => cb(state.tabs[id] ? { ...state.tabs[id] } : undefined)),
      update: (id, props, cb) => {
        state.updates.push({ id, props });
        Object.keys(state.tabs).forEach((k) => { state.tabs[k].active = Number(k) === id; });
        setImmediate(() => cb && cb({ id, windowId: state.tabs[id].windowId }));
      }
    },
    windows: {
      get: (id, opts, cb) => setImmediate(() => cb({ id, focused: !!state.windows[id]?.focused })),
      update: (id, props, cb) => {
        state.winUpdates.push({ id, props });
        setImmediate(() => cb && cb({ id }));
      }
    }
  };
  return state;
}

describe('activateTabForVisit', () => {
  const src = sliceBetween(humanSrc, 'const VISIT_TAB_SWITCH_MIN_GAP_MS', 'function clearFocusStuckTimer');

  function load(state, marks) {
    const ctx = {
      chrome: state.chrome,
      setTimeout, clearTimeout, Date, console,
      HUMAN_VISIT_DWELL_MS: 3000,
      markProgrammaticTabFocus: (tabId, source) => { marks.push({ tabId, source }); return true; }
    };
    vm.createContext(ctx);
    vm.runInContext(src + '\nglobalThis.activateTabForVisit = activateTabForVisit;', ctx);
    return ctx.activateTabForVisit;
  }

  test('an already active tab is not activated again and produces no focus mark', async () => {
    const state = makeChrome({ 10: { id: 10, windowId: 1, active: true } });
    const marks = [];
    const activate = load(state, marks);
    const ok = await new Promise((resolve) => activate(10, 'automation_visit_activate', 'Claude', resolve));
    expect(ok).toBe(true);
    expect(state.updates).toEqual([]);
    expect(marks).toEqual([]);
  });

  test('an inactive tab is activated once and marked as programmatic', async () => {
    const state = makeChrome({ 10: { id: 10, windowId: 1, active: false }, 11: { id: 11, windowId: 1, active: true } });
    const marks = [];
    const activate = load(state, marks);
    const ok = await new Promise((resolve) => activate(10, 'human_visit_activate', 'Claude', resolve));
    expect(ok).toBe(true);
    expect(state.updates.map((u) => u.id)).toEqual([10]);
    expect(marks).toEqual([{ tabId: 10, source: 'human_visit_activate' }]);
  });

  test('a second switch to another tab waits for the pause between visit switches', async () => {
    jest.useFakeTimers();
    try {
      const state = makeChrome({ 10: { id: 10, windowId: 1, active: false }, 11: { id: 11, windowId: 1, active: false } });
      const marks = [];
      const activate = load(state, marks);
      const first = new Promise((resolve) => activate(10, 'automation_visit_activate', 'Claude', resolve));
      await jest.advanceTimersByTimeAsync(10);
      await first;
      const started = Date.now();
      let secondDone = false;
      const second = new Promise((resolve) => activate(11, 'automation_visit_activate', 'GPT', (ok) => { secondDone = true; resolve(ok); }));
      await jest.advanceTimersByTimeAsync(1000);
      expect(state.updates.map((u) => u.id)).toEqual([10]);
      expect(secondDone).toBe(false);
      await jest.advanceTimersByTimeAsync(5000);
      expect(await second).toBe(true);
      expect(Date.now() - started).toBeGreaterThanOrEqual(2900);
      expect(state.updates.map((u) => u.id)).toEqual([10, 11]);
    } finally {
      jest.useRealTimers();
    }
  });

  test('a missing tab reports failure without any switch', async () => {
    const state = makeChrome({});
    const marks = [];
    const activate = load(state, marks);
    const ok = await new Promise((resolve) => activate(99, 'human_visit_activate', 'Claude', resolve));
    expect(ok).toBe(false);
    expect(state.updates).toEqual([]);
    expect(marks).toEqual([]);
  });
});

describe('activateTabForDispatch', () => {
  // globalThis.knownActiveTab is set by chrome.tabs.onActivated; here the test sets it directly.
  const src = sliceBetween(tabSrc, 'function activateTabForDispatch', 'function probeReadyContentScript');

  function load(state, marks, known = null) {
    const ctx = {
      chrome: state.chrome,
      setTimeout, clearTimeout, console,
      isValidTabId: (id) => Number.isInteger(id) && id > 0,
      self: { markProgrammaticTabFocus: (tabId, source) => { marks.push({ tabId, source }); return true; } },
      knownActiveTab: known,
      jobState: { llms: {} }
    };
    vm.createContext(ctx);
    vm.runInContext(src + '\nglobalThis.activateTabForDispatch = activateTabForDispatch;', ctx);
    return ctx.activateTabForDispatch;
  }

  test('a tab known to be active gets no tabs.update and no focus mark; the window is still raised', async () => {
    const state = makeChrome({ 10: { id: 10, windowId: 1, active: true } });
    state.windows[1] = { focused: false };
    const marks = [];
    const result = await load(state, marks, { tabId: 10, windowId: 1 })(10, 'round1_simple');
    expect(result).toBe(true);
    expect(state.updates).toEqual([]);
    expect(marks).toEqual([]);
    expect(state.winUpdates).toEqual([{ id: 1, props: { focused: true } }]);
  });

  test('a tab not known to be active is activated with a programmatic mark', async () => {
    const state = makeChrome({ 10: { id: 10, windowId: 1, active: false }, 11: { id: 11, windowId: 1, active: true } });
    const marks = [];
    const result = await load(state, marks, { tabId: 11, windowId: 1 })(10, 'round1_simple');
    expect(result).toBe(true);
    expect(state.updates.map((u) => u.id)).toEqual([10]);
    expect(marks).toEqual([{ tabId: 10, source: 'round1_simple' }]);
  });

  test('unknown activation state falls through to a real activation', async () => {
    const state = makeChrome({ 10: { id: 10, windowId: 1, active: true } });
    const marks = [];
    const result = await load(state, marks, null)(10, 'activate_tab_for_dispatch');
    expect(result).toBe(true);
    expect(state.updates.map((u) => u.id)).toEqual([10]);
    expect(marks).toEqual([{ tabId: 10, source: 'activate_tab_for_dispatch' }]);
  });
});
