/** @jest-environment node */
// Every manual pull of an answer goes through ONE preparation (scroll to the end + walk the answer upward + return), exactly once:
// Get answer, indicator click / double click, Get it, recoverable terminal, manual selector recovery. The automatic Get it batch
// prepares in its own visit (skipBottomPreparation), so the single ping does not repeat it.
const fs = require('fs');
const vm = require('vm');

const SRC = fs.readFileSync(require.resolve('../background/job-orchestrator'), 'utf8');
const ROUTER = fs.readFileSync(require.resolve('../background/message-router'), 'utf8');
const sliceFunction = (src, header) => {
  const start = src.indexOf(header);
  expect(start).toBeGreaterThan(-1);
  const open = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced');
};
const code = [
  sliceFunction(SRC, 'function gatePreCollectNudge('),
  SRC.slice(SRC.indexOf('const PRECOLLECT_NUDGE_MAX_PER_DISPATCH'), SRC.indexOf('function gatePreCollectNudge(')),
  sliceFunction(SRC, 'async function runPreCollectScrollNudge('),
  sliceFunction(SRC, 'async function prepareManualCollect('),
  sliceFunction(SRC, 'async function handleManualResponsePing(')
].join('\n');

const setup = ({ finalized = false, status = 'RUNNING' } = {}) => {
  const entry = { tabId: 7, lastDispatchMeta: { dispatchId: 'd1' }, status, answer: '', ...(finalized ? { finalizedAt: Date.now() - 1000 } : {}) };
  const c = {
    jobState: { llms: { Qwen: entry }, session: { startTime: 1 } },
    TabMapManager: { get: () => 7 },
    getTabSafe: jest.fn(async (id) => ({ id })), isEligibleTabForLlm: () => true, isValidTabId: (id) => Number.isInteger(id),
    isSessionActive: () => true, getActiveSessionId: () => 1, isFinalizedEntry: (e) => !!e.finalizedAt,
    isAppUiTab: () => true, emitTelemetry: jest.fn(), broadcastDiagnostic: jest.fn(), saveJobState: jest.fn(),
    ensureManualRecoveryModelEntry: () => entry, getManualRecoveryState: () => ({ attempt: 0, failedStrategyIds: [], failedSelectors: [] }),
    markLastManualCandidateRejected: jest.fn(), resolveManualRecoveryStrategy: () => ({ id: 'bottom_most', index: 0 }),
    MANUAL_RECOVERY_STRATEGIES: [{ id: 'bottom_most' }], RECOVERABLE_TERMINAL_MANUAL_PING_WINDOW_MS: 180000,
    RECOVERABLE_TERMINAL_PING_STATUSES: new Set(['EXTRACT_FAILED', 'NO_SEND', 'ERROR']), MANUAL_PING_WINDOW_MS: 1000,
    extendPingWindowForLLM: jest.fn(), buildManualLatestRecoveryOptions: () => ({ enabled: true, strategyId: 'bottom_most', strategyIndex: 0 }),
    sendPassiveMessageWithRetries: jest.fn(), HARD_STOP_PING_RETRY_DELAYS_MS: [], triggerResponseCollectionPing: jest.fn(),
    runAutomaticLatestCollect: jest.fn(), DOM_SNAPSHOT_RECOVERY_MIN_CHARS: 80, lateCollectAnswer: jest.fn(async () => ({ ok: false })), recoverAnswerViaDomSnapshot: jest.fn(async () => ({})), buildRecoveryBudgetKey: () => 'k', consumeRecoveryBudget: () => ({ ok: true }), orchestratorSleepMs: jest.fn(async () => {}), PRECOLLECT_NUDGE_STABILIZE_MS: 0,
    withPromptDispatchFocusLock: async (fn) => fn(), activateTabForDispatch: jest.fn(async () => true),
    runMaterializeSweepInTab: jest.fn(async () => ({ reason: 'ok' })),
    chrome: { scripting: { executeScript: jest.fn(async () => [{ result: { ok: true, settled: true, reachedBottom: true } }]) },
      tabs: { update: jest.fn(async () => {}) }, windows: { update: jest.fn(async () => {}) }, runtime: { sendMessage: jest.fn() } },
    Date, Number, Math, Set, Map, Array, Boolean, String, Promise, Object, setTimeout, console
  };
  c.self = c;
  vm.createContext(c);
  vm.runInContext(code, c);
  return { c, entry };
};

const run = async (options, fixture) => {
  const { c, entry } = setup(fixture);
  let result;
  try { result = await c.handleManualResponsePing('Qwen', options); } catch (err) { result = { thrown: err.message }; }
  return { c, entry, result };
};

const PATHS = [
  ['GET_IT_BATCH single (get_it_batch)', { getIt: true, manualLatestRecovery: true, manualRecovery: true, reason: 'get_it_batch' }, {}, 1],
  ['automatic Get it for a model', { getIt: true, manualLatestRecovery: true, manualRecovery: true, reason: 'automatic_get_it' }, {}, 1],
  ['MANUAL_RESPONSE_PING manual_button', { manualRecovery: true, reason: 'manual_button', returnToTabId: 99 }, {}, 1],
  ['REQUEST_LLM_RESPONSE single click', { manualLatestRecovery: true, manualRecovery: true, reason: 'status_indicator_click', returnToTabId: 99 }, {}, 1],
  ['REQUEST_LLM_RESPONSE double click', { getIt: true, manualLatestRecovery: true, manualRecovery: true, reason: 'status_indicator_dblclick', returnToTabId: 99 }, {}, 1],
  ['recoverable terminal (finished with EXTRACT_FAILED)', { manualRecovery: false, reason: 'manual_button' }, { finalized: true, status: 'EXTRACT_FAILED' }, 1],
  ['manual selector recovery of a finished answer', { manualRecovery: true, advanceStrategy: true, reason: 'manual_button' }, { finalized: true, status: 'SUCCESS' }, 1],
  ['automatic Get it batch: prepared by its own visit, the ping does not repeat it', { getIt: true, skipBottomPreparation: true, manualLatestRecovery: true, manualRecovery: true, reason: 'automatic_get_it_batch' }, {}, 0]
];

describe('path -> is the upward pass called (exactly once per path)', () => {
  test.each(PATHS)('%s', async (name, options, fixture, calls) => {
    const { c } = await run(options, fixture);
    expect(c.runMaterializeSweepInTab).toHaveBeenCalledTimes(calls);
  });

  test('a manual pull activates the model tab and returns to the results page', async () => {
    const { c } = await run({ manualRecovery: true, reason: 'manual_button', returnToTabId: 99 }, {});
    expect(c.activateTabForDispatch).toHaveBeenCalledWith(7);
    expect(c.chrome.tabs.update).toHaveBeenCalledWith(99, { active: true });
  });

  test('manual preparation is not limited like the automatic visits', async () => {
    const { c } = setup();
    let ran = 0;
    for (let i = 0; i < 8; i += 1) {
      await c.handleManualResponsePing('Qwen', { manualRecovery: true, reason: 'manual_button' });
      ran = c.runMaterializeSweepInTab.mock.calls.length;
    }
    expect(ran).toBe(8);
  });

  test('a failed preparation stops only Get it; the other manual pulls still collect', async () => {
    const failing = (options) => {
      const { c } = setup();
      c.chrome.scripting.executeScript = jest.fn(async () => [{ result: { ok: true, settled: false, reachedBottom: false } }]);
      return c.handleManualResponsePing('Qwen', options);
    };
    expect((await failing({ getIt: true, reason: 'get_it_batch' })).status).toBe('manual_ping_failed');
    expect((await failing({ manualRecovery: true, reason: 'manual_button' })).status).not.toBe('manual_ping_failed');
  });

  test('the router hands the results-page tab to every manual path', () => {
    const ping = ROUTER.slice(ROUTER.indexOf("case 'MANUAL_RESPONSE_PING'"), ROUTER.indexOf("case 'REQUEST_LLM_RESPONSE'"));
    const request = ROUTER.slice(ROUTER.indexOf("case 'REQUEST_LLM_RESPONSE'"), ROUTER.indexOf("case 'LLM_DIAGNOSTIC_EVENT'"));
    expect(ping).toContain('returnToTabId: isAppUiTab(sender?.tab) ? sender.tab.id : null');
    expect(request).toContain('returnToTabId: isAppUiTab(sender?.tab) ? sender.tab.id : null');
  });

  test('the user goes back to the results page only AFTER the upward pass', async () => {
    const { c } = setup();
    const order = [];
    c.runMaterializeSweepInTab = jest.fn(async () => { order.push('sweep'); });
    c.chrome.tabs.update = jest.fn(async () => { order.push('return'); });
    await c.handleManualResponsePing('Qwen', { manualRecovery: true, reason: 'manual_button', returnToTabId: 99 });
    expect(order.indexOf('sweep')).toBeGreaterThan(-1);
    expect(order.indexOf('return')).toBeGreaterThan(order.indexOf('sweep'));
  });

  test('a manual pull that cannot walk leaves a trace: ANSWER_MATERIALIZE_SWEEP not_called with the reason', async () => {
    const { c } = setup();
    c.self.isInitialPromptPassActive = () => true;
    await c.handleManualResponsePing('Qwen', { getIt: true, manualRecovery: true, reason: 'get_it_batch' });
    const calls = c.emitTelemetry.mock.calls.filter(([, type]) => type === 'ANSWER_MATERIALIZE_SWEEP');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][2].meta).toMatchObject({ reason: 'not_called', why: 'initial_prompt_pass_active' });
    expect(c.runMaterializeSweepInTab).not.toHaveBeenCalled();
  });
});
