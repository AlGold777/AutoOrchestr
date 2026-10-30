// Completion: silence alone does not end an answer; a complete manual answer beats an INTERRUPTED
// terminal; Claude's raw snapshot without the delivery token is not committed; the incomplete
// commit is not forced to success; Claude's extraction drops navigation and editable chrome.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const ROUTER = read('background/message-router.js');
const ORCH = read('background/job-orchestrator.js');
const COORD = read('background/dispatch-coordinator.js');
const CLAUDE = read('content-scripts/content-claude.js');

describe('uncertain terminal: silence without the delivery token is not an end', () => {
  function loadDeferral({ entry, jobState, token = false }) {
    const start = ROUTER.indexOf('const UNCERTAIN_TERMINAL_QUIET_MS');
    const end = ROUTER.indexOf('const manualRecoveryRequested');
    const timers = [];
    const context = {
      jobState,
      emitTelemetry: jest.fn(),
      reportDispatchPhase: jest.fn(),
      isTerminalRouterEntry: (e) => Boolean(e?.finalStatusRecorded),
      routerRegisterSessionTimer: (id) => id,
      routerDeregisterSessionTimer: () => {},
      setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
      answerHasDeliveryToken: () => token,
      self: { runAutomaticGetItForModel: undefined, resolveBoundTabIdForOrchestrator: () => null },
      Date
    };
    // eslint-disable-next-line no-new-func
    const factory = new Function(...Object.keys(context), `${ROUTER.slice(start, end)}\nreturn { deferUncertainCompletionTerminal };`);
    return { ...factory(...Object.values(context)), timers, context };
  }

  test('quiet text without the token is not finalized before the cap', () => {
    const entry = { promptSubmittedAt: Date.now(), pendingFinalAnswer: 'paused text', lastDispatchMeta: { dispatchId: 'X:1:1' } };
    const jobState = { session: { startTime: 1 }, llms: { X: entry } };
    const { deferUncertainCompletionTerminal, timers, context } = loadDeferral({ entry, jobState });
    const finalize = jest.fn();
    const realNow = Date.now;
    deferUncertainCompletionTerminal('X', entry, finalize, { status: 'AMBIGUOUS', reason: 'ownership_conflict' });
    try {
      let offset = 0;
      // 120 s of silence: well past the old 30 s quiet, still short of the 180 s cap.
      for (let i = 0; i < 24; i += 1) {
        offset += 5000;
        Date.now = () => realNow() + offset;
        timers.shift().fn();
      }
      expect(finalize).not.toHaveBeenCalled();
      // The cap ends it.
      for (let i = 0; i < 20 && !finalize.mock.calls.length; i += 1) {
        offset += 5000;
        Date.now = () => realNow() + offset;
        timers.shift().fn();
      }
    } finally {
      Date.now = realNow;
    }
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(context.reportDispatchPhase).toHaveBeenCalledWith('X', entry, 'terminal_deferral_ended', expect.objectContaining({ reason: 'max_defer_reached' }));
  });

  test('the delivery token plus a short quiet finalizes with delivery_token_seen', () => {
    const entry = { promptSubmittedAt: Date.now(), pendingFinalAnswer: 'answer AO', lastDispatchMeta: { dispatchId: 'X:1:1' } };
    const jobState = { session: { startTime: 1 }, llms: { X: entry } };
    const { deferUncertainCompletionTerminal, timers, context } = loadDeferral({ entry, jobState, token: true });
    const finalize = jest.fn();
    const realNow = Date.now;
    deferUncertainCompletionTerminal('X', entry, finalize, { status: 'CONTEXT_LOST', reason: 'context_invalidated' });
    try {
      let offset = 0;
      for (let i = 0; i < 6 && !finalize.mock.calls.length; i += 1) {
        offset += 5000;
        Date.now = () => realNow() + offset;
        timers.shift().fn();
      }
    } finally {
      Date.now = realNow;
    }
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(context.reportDispatchPhase).toHaveBeenCalledWith('X', entry, 'terminal_deferral_ended', expect.objectContaining({ reason: 'delivery_token_seen' }));
  });
});

describe('a complete manual answer over an INTERRUPTED terminal', () => {
  const gate = () => {
    const context = { Date, jobState: { llms: {} }, saveJobState: jest.fn(), completionAuthorityAttempts: new Map() };
    context.self = context;
    vm.createContext(context);
    vm.runInContext(ROUTER.slice(ROUTER.indexOf('const completionAuthorityKey'),
      ROUTER.indexOf('const PERPLEXITY_TRANSIENT_BLOCKER_KIND')), context);
    const registry = context.CompletionAuthorityRegistry;
    registry.recordAttempt('GPT', { dispatchId: 'GPT:1:1', runSessionId: 's1', rolloutMode: 'enforced' });
    return registry;
  };
  const manualMeta = (copyComplete) => ({
    dispatchId: 'GPT:1:1',
    terminalResult: { status: 'INTERRUPTED' },
    manualRecovery: { manualRecovery: true, manualLatestRecovery: true },
    responseMeta: { manualRecovery: true, copyReport: { complete: copyComplete } }
  });

  test('INTERRUPTED with a complete manual answer on the page is delivered', () => {
    expect(gate().validateDelivery('GPT', { answer: 'Полный ответ', meta: manualMeta(true) }))
      .toMatchObject({ ok: true, reason: 'manual_complete_over_interrupted' });
  });

  test('INTERRUPTED with an incomplete manual copy is still rejected', () => {
    expect(gate().validateDelivery('GPT', { answer: 'Частичный', meta: manualMeta(false) }))
      .toMatchObject({ ok: false, reason: 'completion_terminal_failed' });
  });

  test('INTERRUPTED without a manual recovery is still rejected', () => {
    const meta = { dispatchId: 'GPT:1:1', terminalResult: { status: 'INTERRUPTED' }, responseMeta: { copyReport: { complete: true } } };
    expect(gate().validateDelivery('GPT', { answer: 'Полный ответ', meta }))
      .toMatchObject({ ok: false, reason: 'completion_terminal_failed' });
  });
});

describe('incomplete commit and Claude snapshot', () => {
  test('an incomplete answer is not forced to success; the complete one is', () => {
    expect(COORD).toContain('forceTerminalSuccess: complete,');
    expect(COORD).not.toMatch(/forceTerminalSuccess:\s*true,\s*manualRecoveryAvailable/);
  });

  test('the static watch does not commit Claude text without the delivery token', () => {
    const start = ORCH.indexOf('const STATIC_WATCH_TICK_MS');
    const end = ORCH.indexOf('function startStaticAnswerWatchdog(');
    const calls = { commit: [] };
    const context = {
      jobState: { session: { startTime: 7 }, llms: {} },
      isSessionActive: (id) => id === 7,
      isFinalizedEntry: (e) => Boolean(e?.finalStatusRecorded),
      answerHasDeliveryToken: () => false,
      answerHasNoBodyYet: () => false,
      commitIncompleteAnswer: (...args) => { calls.commit.push(args); return true; },
      reportDispatchPhase: () => {},
      runAutomaticGetItForModel: async () => ({ status: 'manual_ping_sent' }),
      Date
    };
    // eslint-disable-next-line no-new-func
    const factory = new Function(...Object.keys(context), `${ORCH.slice(start, end)}\nreturn { runStaticAnswerWatchTick };`);
    const { runStaticAnswerWatchTick } = factory(...Object.values(context));
    const entry = { promptSubmittedAt: 1, answer: 'Sonnet 5.5 Средний Вручную' };
    context.jobState.llms = { Claude: entry, X: { ...entry } };
    const realNow = Date.now;
    const at = (ms, fn) => { Date.now = () => realNow() + ms; try { fn(); } finally { Date.now = realNow; } };
    at(0, () => runStaticAnswerWatchTick(7));
    at(40000, () => runStaticAnswerWatchTick(7));
    expect(calls.commit.map((c) => c[0])).toEqual(['X']);
    expect(calls.commit.find((c) => c[0] === 'Claude')).toBeUndefined();
  });

  test('Claude extraction drops navigation, aside and editable chrome', () => {
    expect(CLAUDE).toContain('nav, aside, [role="navigation"], [contenteditable]');
  });
});
