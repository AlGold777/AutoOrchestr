const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../background/job-orchestrator'), 'utf8');
const start = source.indexOf('async function runPreCollectScrollNudge');
const functionSource = source.slice(start, source.indexOf('\nasync function ', start + 10));

function setup() {
  const c = {
    jobState: { llms: { GPT: {} } }, isValidTabId: () => true,
    isSessionActive: () => true, isFinalizedEntry: e => !!e.finalizedAt,
    emitTelemetry: jest.fn(), activateTabForDispatch: jest.fn(async () => {}),
    orchestratorSleepMs: async () => {}, PRECOLLECT_NUDGE_STABILIZE_MS: 250,
    document, window, getComputedStyle, Event, setTimeout, Date,
    chrome: { scripting: { executeScript: jest.fn(async ({ func, args }) => [{ result: await func(...args) }]) } }
  };
  c.self = c;
  vm.createContext(c);
  vm.runInContext(functionSource, c);
  return c;
}

function scroller(parent, height = 1000, width = 800) {
  const el = document.createElement('div');
  el.style.overflowY = 'auto';
  parent.appendChild(el);
  Object.defineProperties(el, {
    clientHeight: { value: 500 }, clientWidth: { value: width },
    scrollHeight: { get: () => height }
  });
  el.getClientRects = () => [{}];
  el.scrollTo = jest.fn(({ top }) => { el.scrollTop = top; });
  return { el, grow: n => { height = n; } };
}

beforeEach(() => { jest.useFakeTimers(); document.body.innerHTML = ''; });
afterEach(() => jest.useRealTimers());

test.each([false,true])('manual dwell includes render time except the explicit two-second batch pause: %s', async batchDwell => {
  const c=setup();
  c.chrome.scripting.executeScript=async()=>{jest.setSystemTime(Date.now()+900);return [{result:{settled:true}}];};
  c.orchestratorSleepMs=jest.fn(async()=>{});
  c.getTabSafe=async()=>null;c.isAppUiTab=()=>false;
  await c.runPreCollectScrollNudge('GPT',1,1,'manual',{getIt:true,returnToTabId:99,batchDwell});
  expect(c.orchestratorSleepMs).toHaveBeenCalledTimes(1);
  expect(c.orchestratorSleepMs).toHaveBeenCalledWith(batchDwell ? 2000 : 1600);
});

test.each(['valid', 'closed', 'navigated', 'update_failed', 'batch', 'unsettled'])('manual bottom return: %s', async mode => {
  const c = setup();
  const events = [];
  c.chrome.scripting.executeScript = jest.fn(async () => [{ result: { settled: mode !== 'unsettled' } }]);
  c.orchestratorSleepMs = jest.fn(async ms => { events.push(`sleep:${ms}`); });
  c.getTabSafe = jest.fn(async () => mode === 'closed' ? null : { id: 99, windowId: 7, app: mode !== 'navigated' });
  c.isAppUiTab = tab => !!tab?.app;
  c.chrome.tabs = { update: jest.fn(async () => {
    events.push('return');
    if (mode === 'update_failed') throw new Error('Tab closed');
  }) };
  c.chrome.windows = { update: jest.fn(async () => {}) };
  c.withPromptDispatchFocusLock = async fn => { events.push('lock'); const result = await fn(); events.push('unlock'); return result; };
  const result = await c.runPreCollectScrollNudge('GPT', 1, 1, 'get_it_precollect', {
    getIt: true, returnToTabId: mode === 'batch' ? null : 99
  });
  expect(result).toBe(mode !== 'unsettled');
  if (mode === 'valid') {
    expect(events).toEqual(['lock', 'sleep:2500', 'return', 'unlock']);
    expect(c.chrome.tabs.update).toHaveBeenCalledWith(99, { active: true });
    expect(c.chrome.windows.update).toHaveBeenCalledWith(7, { focused: true });
  } else if (mode !== 'update_failed' && mode !== 'unsettled') {
    expect(c.chrome.tabs.update).not.toHaveBeenCalled();
  }
  if (mode === 'batch') {
    expect(c.getTabSafe).not.toHaveBeenCalled();
    expect(c.orchestratorSleepMs).not.toHaveBeenCalledWith(2500);
  }
});

test('finds an unnamed chat scroller after sidebar decoys and follows lazy growth to the new bottom', async () => {
  const nav = document.createElement('nav'); document.body.appendChild(nav);
  const decoys = Array.from({ length: 6 }, () => scroller(nav));
  const main = document.createElement('main'); document.body.appendChild(main);
  const chat = scroller(main);
  let grown = false;
  chat.el.scrollTo.mockImplementation(({ top, behavior }) => {
    expect(behavior).toBe('instant');
    chat.el.scrollTop = top;
    if (!grown) {
      grown = true;
      setTimeout(() => { chat.grow(2400); chat.el.textContent = 'Full answer including its final paragraph'; }, 80);
    }
  });
  const c = setup(); const result = c.runPreCollectScrollNudge('GPT', 1, 1);
  await jest.runAllTimersAsync();
  expect(await result).toBe(true);
  expect(chat.el.scrollTop).toBe(1900);
  expect(decoys.every(d => d.el.scrollTo.mock.calls.length === 0)).toBe(true);
  expect(c.emitTelemetry).toHaveBeenCalledWith('GPT', 'PRECOLLECT_NUDGE', expect.objectContaining({
    meta: expect.objectContaining({ scrollPreparation: expect.objectContaining({ settled: true }) })
  }));
});

test('re-resolves a replaced virtualized container and bounds a continuously growing answer', async () => {
  const main = document.createElement('main'); document.body.appendChild(main);
  const old = scroller(main);
  let replacement;
  old.el.scrollTo.mockImplementation(() => {
    old.el.remove(); replacement = scroller(main, 1500);
    replacement.el.scrollTo.mockImplementation(({ top }) => {
      replacement.el.scrollTop = top;
      replacement.grow(replacement.el.scrollHeight + 100);
    });
  });
  const c = setup(); const result = c.runPreCollectScrollNudge('GPT', 1, 1);
  await jest.runAllTimersAsync(); await result;
  expect(replacement.el.scrollTo).toHaveBeenCalled();
  expect(c.emitTelemetry).toHaveBeenCalledWith('GPT', 'PRECOLLECT_NUDGE', expect.objectContaining({
    meta: expect.objectContaining({ scrollPreparation: expect.objectContaining({ settled: false, passes: 8 }) })
  }));
});

test('keeps focus lock through DOM preparation and settling', async () => {
  const c = setup(); let locked = false;
  c.withPromptDispatchFocusLock = async fn => { locked = true; try { return await fn(); } finally { locked = false; } };
  c.chrome.scripting.executeScript.mockImplementation(async () => { expect(locked).toBe(true); return [{ result: { settled: true } }]; });
  c.orchestratorSleepMs = async () => { expect(locked).toBe(true); };
  expect(await c.runPreCollectScrollNudge('GPT', 1, 1)).toBe(true);
  expect(locked).toBe(false);
});

test.each(['first-pass', 'session-changed', 'finalized', 'focus-expired'])('rechecks %s after waiting for focus lock', async state => {
  const c = setup();
  c.withPromptDispatchFocusLock = async fn => {
    if (state === 'first-pass') c.isInitialPromptPassActive = () => true;
    if (state === 'session-changed') c.isSessionActive = () => false;
    if (state === 'finalized') c.jobState.llms.GPT.finalizedAt = 1;
    if (state === 'focus-expired') c.isActiveFocusAllowedForEntry = () => false;
    return fn();
  };
  expect(await c.runPreCollectScrollNudge('GPT', 1, 1)).toBe(false);
  expect(c.activateTabForDispatch).not.toHaveBeenCalled();
  expect(c.chrome.scripting.executeScript).not.toHaveBeenCalled();
});

test('Qwen uses the explicit bottom button when direct scrolling is ignored', async () => {
  const chat = scroller(document.body);
  chat.el.scrollTo.mockImplementation(() => {});
  const arrow = document.createElement('button');
  arrow.setAttribute('aria-label', 'Scroll to bottom');
  arrow.getClientRects = () => [{}];
  arrow.onclick = () => { chat.el.scrollTop = 500; };
  document.body.appendChild(arrow);
  const c = setup(); c.jobState.llms.Qwen = {};
  const result = c.runPreCollectScrollNudge('Qwen', 1, 1, 'get_it_precollect', { getIt: true });
  await jest.runAllTimersAsync();
  expect(await result).toBe(true);
  expect(chat.el.scrollTop).toBe(500);
});

test('GPT fails the mandatory visit when scrolling does not reach the bottom', async () => {
  const chat = scroller(document.body); chat.el.scrollTo.mockImplementation(() => {});
  const c = setup(); const result = c.runPreCollectScrollNudge('GPT', 1, 1, 'get_it_precollect', { getIt: true });
  await jest.runAllTimersAsync();
  expect(await result).toBe(false);
});

test('GPT reaches zero in a reversed thread and follows lazy answer growth', async () => {
  const main = document.createElement('main'); document.body.appendChild(main);
  const chat = scroller(main);
  chat.el.style.display = 'flex';
  chat.el.style.flexDirection = 'column-reverse';
  chat.el.scrollTop = -500;
  let grown = false;
  chat.el.scrollTo.mockImplementation(({ top }) => {
    // Chromium clamps positive scroll positions to zero in column-reverse.
    chat.el.scrollTop = Math.min(0, top);
    if (!grown) {
      grown = true;
      setTimeout(() => { chat.grow(2400); chat.el.textContent = 'The final paragraph'; }, 80);
    }
  });
  const c = setup(); const result = c.runPreCollectScrollNudge('GPT', 1, 1, 'get_it_precollect', { getIt: true });
  await jest.runAllTimersAsync();
  expect(await result).toBe(true);
  expect(chat.el.scrollTop).toBe(0);
  expect(chat.el.scrollTo.mock.calls.every(([options]) => options.top === 0)).toBe(true);
  expect(c.emitTelemetry).toHaveBeenCalledWith('GPT', 'PRECOLLECT_NUDGE', expect.objectContaining({
    meta: expect.objectContaining({ scrollPreparation: expect.objectContaining({ settled: true }) })
  }));
});

test('GPT does not accept a reversed thread still showing older messages', async () => {
  const chat = scroller(document.body);
  chat.el.style.flexDirection = 'column-reverse';
  chat.el.scrollTop = -200;
  chat.el.scrollTo.mockImplementation(() => {});
  const c = setup(); const result = c.runPreCollectScrollNudge('GPT', 1, 1, 'get_it_precollect', { getIt: true });
  await jest.runAllTimersAsync();
  expect(await result).toBe(false);
});

test.each([500, 520])('a short conversation with height %s remains the target beside a lazy sidebar', async height => {
  const sidebar = scroller(document.body, 1000, 240);
  sidebar.el.scrollTo.mockImplementation(({ top }) => {
    sidebar.el.scrollTop = top;
    sidebar.grow(sidebar.el.scrollHeight + 100);
  });
  const main = document.createElement('main'); document.body.appendChild(main);
  const chat = scroller(main, height);
  chat.el.style.flexDirection = 'column-reverse';
  chat.el.textContent = 'A short complete answer';
  const c = setup(); const result = c.runPreCollectScrollNudge('GPT', 1, 1, 'get_it_precollect', { getIt: true });
  await jest.runAllTimersAsync();
  expect(await result).toBe(true);
  expect(chat.el.scrollTo).toHaveBeenCalled();
  expect(sidebar.el.scrollTo).not.toHaveBeenCalled();
});

test('a main without a nested scroller uses the fitting document rather than a sidebar', async () => {
  const sidebar = scroller(document.body, 1000, 240);
  document.body.insertAdjacentHTML('beforeend', '<main><p>A short complete answer</p></main>');
  Object.defineProperties(document.documentElement, {
    clientHeight: { configurable: true, value: 500 },
    scrollHeight: { configurable: true, value: 500 }
  });
  window.scrollTo = jest.fn();
  const c = setup(); const result = c.runPreCollectScrollNudge('GPT', 1, 1, 'get_it_precollect', { getIt: true });
  await jest.runAllTimersAsync();
  expect(await result).toBe(true);
  expect(sidebar.el.scrollTo).not.toHaveBeenCalled();
  expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });
  delete document.documentElement.clientHeight;
  delete document.documentElement.scrollHeight;
});

test.each(['column', 'column-reverse'])('Get it can reach the end of a long %s conversation while its content keeps changing', async direction => {
  const main = document.createElement('main'); document.body.appendChild(main);
  const chat = scroller(main, 3000);
  chat.el.style.flexDirection = direction;
  chat.el.textContent = 'A long rendered answer. '.repeat(300);
  let updates = 0;
  chat.el.scrollTo.mockImplementation(({ top }) => {
    chat.el.scrollTop = top;
    // Composer/disclosure updates do not mean navigation failed. Streaming
    // grows the reversed viewport without moving its latest end away from 0.
    chat.el.append(` update ${++updates}`);
    if (direction === 'column-reverse') chat.grow(chat.el.scrollHeight + 100);
  });
  const c = setup(); const result = c.runPreCollectScrollNudge('GPT', 1, 1, 'get_it_precollect', { getIt: true });
  await jest.runAllTimersAsync();
  expect(await result).toBe(true);
  expect(updates).toBe(8);
  expect(c.emitTelemetry).toHaveBeenCalledWith('GPT', 'PRECOLLECT_NUDGE', expect.objectContaining({
    meta: expect.objectContaining({ scrollPreparation: expect.objectContaining({ settled: false, reachedBottom: true, passes: 8 }) })
  }));
});

test.each(['GPT', 'Qwen', 'Claude', 'Gemini', 'Grok', 'DeepSeek', 'Le Chat', 'Perplexity', 'Z.ai', 'Kimi'])('Get it can prepare finalized %s after its automatic focus budget expires', async model => {
  const c = setup(); c.jobState.llms[model] = { finalizedAt: 1 };
  c.isActiveFocusAllowedForEntry = () => false;
  scroller(document.body);
  const result = c.runPreCollectScrollNudge(model, 1, 1, 'get_it_precollect', { getIt: true });
  await jest.runAllTimersAsync();
  expect(await result).toBe(true);
  expect(c.activateTabForDispatch).toHaveBeenCalledTimes(1);
});

test('automatic collection neither clicks the bottom button nor requires successful scrolling', async () => {
  const chat = scroller(document.body); chat.el.scrollTo.mockImplementation(() => {});
  const button = document.createElement('button');
  button.setAttribute('aria-label', 'Scroll to bottom'); button.getClientRects = () => [{}];
  button.onclick = jest.fn(); document.body.appendChild(button);
  const c = setup(); const result = c.runPreCollectScrollNudge('GPT', 1, 1);
  await jest.runAllTimersAsync();
  expect(await result).toBe(true);
  expect(button.onclick).not.toHaveBeenCalled();
});
