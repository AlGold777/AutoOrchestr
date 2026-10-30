/** @jest-environment node */
// M-3: sendComposer must end within its send budget, by Date.now(), not by iteration count or timer count.
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../content-scripts/content-deepseek'), 'utf8');

const slice = (from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error(`slice not found: ${from}`);
  return source.slice(start, end);
};

// Loads the real sendComposer with the real budget constant. Timers and Date are the fake ones.
function loadSendComposer({ sleepFor, resolveSendButton, humanClick }) {
  const keydowns = [];
  let prose = 0;
  const input = {
    value: 'prompt',
    isConnected: true,
    dispatchEvent(event) {
      if (event.type === 'keydown') keydowns.push(event.ctrlKey === true);
    }
  };
  const context = {
    console,
    setTimeout,
    clearTimeout,
    Date,
    Promise,
    Symbol,
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    location: { pathname: '/' },
    document: { querySelector: () => null, visibilityState: 'hidden', hidden: true },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, sleepFor(ms))),
    getProseNodes: () => Array.from({ length: prose }),
    resolveSendButton,
    deepseekHumanClick: humanClick
  };
  // A confirmed send grows the answer count; the scenario decides when that happens.
  context.__enterSends = () => { prose = 1; };
  vm.createContext(context);
  vm.runInContext([
    slice('function readComposerValue', 'function isCaptchaField'),
    slice('const DEEPSEEK_SEND_BUDGET_MS', '  function getProseNodes()')
  ].join('\n'), context);
  return { context, input, keydowns, sendComposer: vm.runInContext('sendComposer', context) };
}

describe('DeepSeek sendComposer send budget', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('the budget constant is the documented 12 s', () => {
    expect(source).toMatch(/const DEEPSEEK_SEND_BUDGET_MS = 12000;/);
  });

  test('a never-resolving send button lookup ends at the budget, not after its own 15 s timeout', async () => {
    const { input, keydowns, sendComposer, context } = loadSendComposer({
      sleepFor: (ms) => ms,
      resolveSendButton: () => new Promise(() => {}),
      humanClick: async () => {}
    });
    const run = sendComposer(input);
    await jest.advanceTimersByTimeAsync(20000);
    await expect(run).resolves.toBe(false);
    const outcome = vm.runInContext('lastSendOutcome', context);
    expect(outcome.reason).toBe('send_budget_exhausted');
    expect(outcome.budgetMs).toBe(12000);
    expect(outcome.elapsedMs).toBeGreaterThanOrEqual(11000);
    expect(outcome.elapsedMs).toBeLessThanOrEqual(12300);
    // Three Enter presses are the strategies that fit the budget; none is started after it ends.
    expect(keydowns).toEqual([true, true, false]);
    expect(outcome.composerConnected).toBe(true);
    expect(outcome.visibilityState).toBe('hidden');
    expect(outcome.hidden).toBe(true);
  });

  test('a frozen tab: the first step after it wakes fails at once and starts no further send', async () => {
    let first = true;
    const { input, keydowns, sendComposer, context } = loadSendComposer({
      sleepFor: (ms) => {
        if (first) { first = false; return ms + 60000; }
        return ms;
      },
      resolveSendButton: async () => null,
      humanClick: async () => {}
    });
    const run = sendComposer(input);
    await jest.advanceTimersByTimeAsync(70000);
    await expect(run).resolves.toBe(false);
    const outcome = vm.runInContext('lastSendOutcome', context);
    expect(outcome.reason).toBe('send_budget_exhausted');
    expect(keydowns).toEqual([]);
    expect(outcome.elapsedMs).toBeGreaterThanOrEqual(60000);
  });

  test('a send that is confirmed within the budget reports confirmed', async () => {
    const { input, keydowns, sendComposer, context } = loadSendComposer({
      sleepFor: (ms) => ms,
      resolveSendButton: async () => null,
      humanClick: async () => {}
    });
    const originalDispatch = input.dispatchEvent;
    input.dispatchEvent = (event) => {
      originalDispatch(event);
      if (event.type === 'keydown') context.__enterSends();
    };
    const run = sendComposer(input);
    await jest.advanceTimersByTimeAsync(5000);
    await expect(run).resolves.toBe(true);
    const outcome = vm.runInContext('lastSendOutcome', context);
    expect(outcome.reason).toBe('confirmed');
    expect(keydowns).toEqual([true]);
  });
});
