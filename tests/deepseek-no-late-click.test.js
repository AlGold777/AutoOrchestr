/** @jest-environment node */
// L-33: a humanoid click started before the send budget ends must not send the prompt after the budget has failed.
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../content-scripts/content-deepseek'), 'utf8');

const slice = (from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error(`slice not found: ${from}`);
  return source.slice(start, end);
};

// Minimal DOM: a window with capture-phase click listeners, and an element whose onclick is the send handler.
function makeWindow() {
  const listeners = [];
  return {
    listeners,
    addEventListener(type, fn, capture) { listeners.push({ type, fn, capture }); },
    removeEventListener(type, fn) {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    }
  };
}

function dispatchClick(win, target) {
  const event = {
    type: 'click',
    target,
    stopped: false,
    preventDefault() {},
    stopImmediatePropagation() { this.stopped = true; }
  };
  for (const l of win.listeners.filter((x) => x.type === 'click' && x.capture)) {
    l.fn(event);
    if (event.stopped) return;
  }
  target.onclick?.(event);
}

function loadSend({ resolveSendButton, humanoidClickDelayMs }) {
  const win = makeWindow();
  const sends = [];
  let prose = 0;
  const sendButton = {
    isConnected: true,
    contains(node) { return node === this; },
    onclick: () => { sends.push('click'); prose = 1; }
  };
  const input = {
    value: 'prompt',
    isConnected: true,
    dispatchEvent() {}
  };
  win.Humanoid = {
    click: async (element) => {
      await new Promise((resolve) => setTimeout(resolve, humanoidClickDelayMs));
      dispatchClick(win, element);
    }
  };
  const context = {
    console,
    setTimeout,
    clearTimeout,
    Date,
    Promise,
    Symbol,
    window: win,
    getHumanoid: () => win.Humanoid,
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    location: { pathname: '/' },
    document: { querySelector: () => null, visibilityState: 'visible', hidden: false },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    getProseNodes: () => Array.from({ length: prose }),
    resolveSendButton: () => resolveSendButton(sendButton)
  };
  vm.createContext(context);
  vm.runInContext([
    slice('function readComposerValue', 'function isCaptchaField'),
    slice('const DEEPSEEK_SEND_BUDGET_MS', '  function getProseNodes()'),
    slice('async function deepseekHumanClick', 'async function fallbackDeepseekType')
  ].join('\n'), context);
  return { win, sends, sendButton, input, sendComposer: vm.runInContext('sendComposer', context), context };
}

describe('DeepSeek send: a click started before the budget ends does not send after it', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('a humanoid click still running when the budget fails is swallowed and sends nothing', async () => {
    // The button is found at ~8.8 s; the humanoid click takes 6 s, so it would land at ~14.8 s, after the 12 s budget.
    const env = loadSend({
      resolveSendButton: async (button) => button,
      humanoidClickDelayMs: 6000
    });
    const run = env.sendComposer(env.input);
    await jest.advanceTimersByTimeAsync(20000);
    await expect(run).resolves.toBe(false);
    expect(env.sends).toEqual([]);
    const outcome = vm.runInContext('lastSendOutcome', env.context);
    expect(outcome.reason).toBe('send_budget_exhausted');
    expect(env.win.listeners.filter((l) => l.type === 'click')).toEqual([]);
  });

  test('a button found after the budget starts no click at all', async () => {
    const env = loadSend({
      resolveSendButton: (button) => new Promise((resolve) => setTimeout(() => resolve(button), 13000)),
      humanoidClickDelayMs: 0
    });
    const run = env.sendComposer(env.input);
    await jest.advanceTimersByTimeAsync(20000);
    await expect(run).resolves.toBe(false);
    expect(env.sends).toEqual([]);
  });

  test('a normal send inside the budget is performed once and reports confirmed', async () => {
    const env = loadSend({
      resolveSendButton: async (button) => button,
      humanoidClickDelayMs: 1000
    });
    const run = env.sendComposer(env.input);
    await jest.advanceTimersByTimeAsync(15000);
    await expect(run).resolves.toBe(true);
    expect(env.sends).toEqual(['click']);
    const outcome = vm.runInContext('lastSendOutcome', env.context);
    expect(outcome.reason).toBe('confirmed');
    expect(env.win.listeners.filter((l) => l.type === 'click')).toEqual([]);
  });
});
