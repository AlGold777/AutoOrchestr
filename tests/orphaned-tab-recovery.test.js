// M-4: a provider tab orphaned by an extension reload (CONTEXT_LOST, context_invalidated) is restored
// before the deferred terminal's Get It nudges, the attempt is not finalized as failed at once, and
// the reinject is allowed while the prompt is confirmed (the page has nothing to preserve).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const ROUTER = read('background/message-router.js');
const HEALTH = read('background/health-monitor.js');

function loadDeferral({ entry, jobState, recover, getIt }) {
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
    answerHasDeliveryToken: () => false,
    self: {
      resolveBoundTabIdForOrchestrator: () => 7,
      recoverOrphanedProviderTab: recover,
      runAutomaticGetItForModel: getIt
    },
    Date
  };
  // eslint-disable-next-line no-new-func
  const factory = new Function(...Object.keys(context), `${ROUTER.slice(start, end)}\nreturn { deferUncertainCompletionTerminal };`);
  return { ...factory(...Object.values(context)), timers };
}

const flush = () => new Promise((resolve) => globalThis.setTimeout(resolve, 0));

describe('orphaned provider tab recovery (M-4)', () => {
  test('CONTEXT_LOST restores the tab once, before any Get It nudge, and does not finalize', async () => {
    const entry = { promptSubmittedAt: Date.now(), pendingFinalAnswer: 'partial', lastDispatchMeta: { dispatchId: 'GPT:1:1' } };
    const jobState = { session: { startTime: 1 }, llms: { GPT: entry } };
    const order = [];
    const recover = jest.fn(async () => { order.push('recover'); return true; });
    const getIt = jest.fn(async () => { order.push('getIt'); return { status: 'ok' }; });
    const finalize = jest.fn();
    const { deferUncertainCompletionTerminal, timers } = loadDeferral({ entry, jobState, recover, getIt });

    deferUncertainCompletionTerminal('GPT', entry, finalize, { status: 'CONTEXT_LOST', reason: 'context_invalidated' });
    timers.shift().fn();
    await flush();
    await flush();

    expect(recover).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledWith(7, 'GPT');
    expect(entry.deferredUncertainTerminal.tabRecoveryAt).toEqual(expect.any(Number));
    expect(finalize).not.toHaveBeenCalled();
    // Further checks re-run the deferral without a second recovery.
    for (let i = 0; i < 3 && timers.length; i += 1) { timers.shift().fn(); await flush(); }
    expect(recover).toHaveBeenCalledTimes(1);
    expect(order[0]).toBe('recover');
  });

  test('AMBIGUOUS keeps the existing behaviour: no tab recovery', async () => {
    const entry = { promptSubmittedAt: Date.now(), pendingFinalAnswer: 'x', lastDispatchMeta: { dispatchId: 'GPT:1:1' } };
    const jobState = { session: { startTime: 1 }, llms: { GPT: entry } };
    const recover = jest.fn(async () => true);
    const { deferUncertainCompletionTerminal, timers } = loadDeferral({ entry, jobState, recover, getIt: jest.fn() });
    deferUncertainCompletionTerminal('GPT', entry, jest.fn(), { status: 'AMBIGUOUS', reason: 'x' });
    timers.shift().fn();
    await flush();
    expect(recover).not.toHaveBeenCalled();
  });

  test('health monitor: the reinject opt-in exists and the recovery reports the outcome', () => {
    expect(HEALTH).toMatch(/async function reinjectScript\(tabId, llmName, options = \{\}\)/);
    expect(HEALTH).toMatch(/confirmedActiveRun && options\.allowActiveRun !== true/);
    expect(HEALTH).toMatch(/self\.recoverOrphanedProviderTab = recoverOrphanedProviderTab/);
    expect(HEALTH).toMatch(/'CONTEXT_LOST_TAB_RECOVERED'/);
  });
});
