// Patience rule: the app does not declare "no answer" while the model's page still generates.
// (1) job-orchestrator: the 240 s generation wait cap is a verdict only when the page shows no generation;
//     the ceiling is 60 minutes.
// (2) message-router: the deferred uncertain terminal at its cap asks the page first; while it generates,
//     the deferral goes on; a token-marked answer is finalized without the probe.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const JOB_ORCHESTRATOR_SOURCE = read('background/job-orchestrator.js');
const ROUTER = read('background/message-router.js');
const DISPATCH_COORDINATOR_SOURCE = read('background/dispatch-coordinator.js');
const STATUS_CONTRACT_SOURCE = read('shared/status-contract.js');
const ANSWER_PROOF_NORMALIZATION_SOURCE = read('shared/answer-proof-normalization.js');
const ANSWER_EVIDENCE_SOURCE = read('shared/answer-evidence.js');
const ANSWER_LENGTH_POLICY_SOURCE = read('shared/answer-length-policy.js');
const FINALIZATION_CONTROLLER_SOURCE = read('shared/finalization-controller.js');
const RECOVERY_INTENT_SOURCE = read('shared/recovery-intent.js');
const Classifier = require('../shared/answer-content-classifier');
const Proof = require('../shared/answer-proof-normalization');

const GENERATION_WAIT_CAP_MS = 240000;
const GENERATION_WAIT_EXTEND_MS = 15000;
const GENERATION_WAIT_CEILING_MS = 3600000;
const UNCERTAIN_TERMINAL_CAP_MS = 180000;
const UNCERTAIN_TERMINAL_POLL_MS = 5000;
const TAG = '[[AO-abc123]]';
const TOKEN = '[[AO-abc123]]';

const activeResult = (active) => async () => [{ result: { active } }];

function createSandbox() {
  const context = {
    console, Promise, Map, Set, Date, Math, Array, Object, Number, String, Boolean, RegExp, JSON, URL,
    AbortController, setTimeout, clearTimeout, setInterval, clearInterval,
    AnswerContentClassifier: Classifier,
    SUCCESS_STATUSES: ['COPY_SUCCESS', 'SUCCESS', 'DONE', 'COMPLETE', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN'],
    FAILURE_STATUSES: ['ERROR', 'CRITICAL_ERROR', 'RECOVERABLE_ERROR', 'UNRESPONSIVE', 'CIRCUIT_OPEN', 'API_FAILED', 'NO_SEND', 'EXTRACT_FAILED', 'STREAM_TIMEOUT'],
    TERMINAL_STATUSES: ['COPY_SUCCESS', 'SUCCESS', 'DONE', 'COMPLETE', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN', 'ERROR', 'CRITICAL_ERROR', 'RECOVERABLE_ERROR', 'UNRESPONSIVE', 'CIRCUIT_OPEN', 'API_FAILED', 'NO_SEND', 'EXTRACT_FAILED', 'STREAM_TIMEOUT'],
    jobState: {
      prompt: 'test prompt',
      attachments: [],
      responsesCollected: 0,
      session: { startTime: 1778621552201, totalModels: 1, completed: 0, failed: 0 },
      llms: { Claude: { tabId: 501, requestId: 'req-claude', lastDispatchMeta: { dispatchId: 'dispatch-claude', generationEpoch: 3 } } }
    },
    chrome: {
      tabs: { sendMessage: jest.fn(() => Promise.resolve()) },
      scripting: { executeScript: jest.fn(activeResult(false)) },
      storage: { local: { set: jest.fn(() => Promise.resolve()), get: jest.fn(() => Promise.resolve({})) } },
      runtime: { lastError: null }
    },
    CompressedStorage: { set: jest.fn(() => Promise.resolve()), get: jest.fn(() => Promise.resolve(null)) },
    TabMapManager: { get: jest.fn(() => 501), entries: jest.fn(() => []), removeByName: jest.fn() },
    appendLogEntry: jest.fn(),
    updateModelState: jest.fn(),
    sendMessageToResultsTab: jest.fn(),
    getLogSnapshot: jest.fn(() => []),
    broadcastGlobalState: jest.fn(),
    broadcastHumanVisitStatus: jest.fn(),
    saveJobState: jest.fn(),
    emitTelemetry: jest.fn(),
    broadcastDiagnostic: jest.fn(),
    clearDeferredAnswerTimer: jest.fn(),
    clearPostSuccessScrollAudit: jest.fn(),
    clearClaudeRetryTimers: jest.fn(),
    resolvePromptSubmitted: jest.fn(),
    executeApiFallback: jest.fn(() => Promise.resolve(false)),
    setRateLimit: jest.fn(),
    getRecentPipelineErrorReason: jest.fn(() => ''),
    scheduleClaudeHardTimeoutRetry: jest.fn(() => false),
    clearBudgetPhases: jest.fn(),
    clearAdaptiveCollectTimer: jest.fn(),
    resolveModelFinalStatus: jest.fn(() => 'SUCCESS'),
    resolveModelDoneReason: jest.fn(() => 'ok'),
    completeHumanPresenceForModel: jest.fn(),
    downgradePipelineHardTimeoutLogs: jest.fn(),
    downgradePipelineHardTimeoutStorage: jest.fn(),
    closePingWindowForLLM: jest.fn(),
    extendPingWindowForLLM: jest.fn(),
    sendPassiveMessageWithRetries: jest.fn(),
    getTabSafe: jest.fn(() => Promise.resolve(null)),
    isValidTabId: (tabId) => Number.isInteger(tabId) && tabId > 0,
    getBoundTabId: (llmName, entry) => entry?.tabId || null,
    self: null
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(STATUS_CONTRACT_SOURCE, context, { filename: 'shared/status-contract.js' });
  vm.runInContext(ANSWER_PROOF_NORMALIZATION_SOURCE, context, { filename: 'shared/answer-proof-normalization.js' });
  vm.runInContext(ANSWER_EVIDENCE_SOURCE, context, { filename: 'shared/answer-evidence.js' });
  vm.runInContext(ANSWER_LENGTH_POLICY_SOURCE, context, { filename: 'shared/answer-length-policy.js' });
  vm.runInContext(FINALIZATION_CONTROLLER_SOURCE, context, { filename: 'shared/finalization-controller.js' });
  vm.runInContext(RECOVERY_INTENT_SOURCE, context, { filename: 'shared/recovery-intent.js' });
  vm.runInContext(JOB_ORCHESTRATOR_SOURCE, context, { filename: 'background/job-orchestrator.js' });
  const tokenStart = DISPATCH_COORDINATOR_SOURCE.indexOf('function answerHasDeliveryToken(');
  const tokenEnd = DISPATCH_COORDINATOR_SOURCE.indexOf('// Commit the text the model already produced', tokenStart);
  context.answerHasDeliveryToken = new Function('self', 'jobState',
    `${DISPATCH_COORDINATOR_SOURCE.slice(tokenStart, tokenEnd)}\nreturn answerHasDeliveryToken;`
  )(context, context.jobState);
  return context;
}

function armClaudeSubmit(context) {
  const entry = context.jobState.llms.Claude;
  entry.promptSubmittedAt = Date.now();
  entry.submitSource = 'content';
  entry.lastDispatchMeta = { dispatchId: 'dispatch-claude', generationEpoch: 3 };
  return entry;
}

describe('generation patience: job-orchestrator wait cap (empty answer while the page generates)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('at the 240 s cap an active page extends the wait instead of a terminal; the terminal comes once generation stops', async () => {
    const context = createSandbox();
    context.triggerResponseCollectionPing = jest.fn();
    const executeScript = context.chrome.scripting.executeScript;
    executeScript.mockImplementation(activeResult(true));
    const entry = armClaudeSubmit(context);

    context.handleLLMResponse('Claude', '', { type: 'empty_answer', message: 'no answer text' }, { dispatchId: 'dispatch-claude', responseMeta: { source: 'pipeline' } }, '');

    await jest.advanceTimersByTimeAsync(GENERATION_WAIT_CAP_MS - 1000);
    expect(executeScript).not.toHaveBeenCalled();

    // The cap is reached: the page is asked, it still generates, so no terminal.
    await jest.advanceTimersByTimeAsync(1000);
    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(entry.finalStatusRecorded).not.toBe(true);
    expect(context.emitTelemetry).toHaveBeenCalledWith('Claude', 'ANSWER_GENERATION_WAIT_EXTENDED', expect.anything());

    // The cap repeats every 15 s while the page keeps generating.
    for (let i = 1; i <= 4; i += 1) {
      await jest.advanceTimersByTimeAsync(GENERATION_WAIT_EXTEND_MS);
      expect(executeScript).toHaveBeenCalledTimes(1 + i);
      expect(entry.finalStatusRecorded).not.toBe(true);
    }

    // Generation is over: the next check gives the terminal as before.
    executeScript.mockImplementation(activeResult(false));
    await jest.advanceTimersByTimeAsync(GENERATION_WAIT_EXTEND_MS + 120000);
    expect(entry.finalStatusRecorded).toBe(true);
    expect(entry.finalStatus).toBeDefined();
    expect(['SUCCESS', 'COMPLETE', 'DONE', 'COPY_SUCCESS', 'PARTIAL']).not.toContain(String(entry.finalStatus).toUpperCase());
  });

  test('an active page past the 60 minute ceiling gets the terminal, with no probe at or after the ceiling', async () => {
    const context = createSandbox();
    context.triggerResponseCollectionPing = jest.fn();
    const executeScript = context.chrome.scripting.executeScript;
    executeScript.mockImplementation(activeResult(true));
    const entry = armClaudeSubmit(context);

    context.handleLLMResponse('Claude', '', { type: 'empty_answer', message: 'no answer text' }, { dispatchId: 'dispatch-claude', responseMeta: { source: 'pipeline' } }, '');

    await jest.advanceTimersByTimeAsync(GENERATION_WAIT_CEILING_MS - 1000);
    expect(entry.finalStatusRecorded).not.toBe(true);
    expect(context.emitTelemetry.mock.calls.map((c) => c[1])).not.toContain('MATERIALIZE_RECOVERY_CONTEXT');
    const probesBeforeCeiling = executeScript.mock.calls.length;
    expect(probesBeforeCeiling).toBeGreaterThan(1);

    // At the ceiling the wait ends without another probe; the terminal then follows the usual path.
    await jest.advanceTimersByTimeAsync(1000 + 120000);
    expect(context.emitTelemetry.mock.calls.map((c) => c[1])).toContain('MATERIALIZE_RECOVERY_CONTEXT');
    expect(entry.finalStatusRecorded).toBe(true);
    expect(executeScript.mock.calls.length).toBe(probesBeforeCeiling);
  });
});

describe('generation patience: message-router deferred uncertain terminal at its cap', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function loadDeferral({ entry, jobState, chromeStub }) {
    const ROUTER_START = ROUTER.indexOf('const UNCERTAIN_TERMINAL_QUIET_MS');
    const ROUTER_END = ROUTER.indexOf('const manualRecoveryRequested');
    const context = {
      jobState,
      emitTelemetry: jest.fn(),
      reportDispatchPhase: jest.fn(),
      isTerminalRouterEntry: (e) => Boolean(e?.finalStatusRecorded),
      routerRegisterSessionTimer: (id) => id,
      routerDeregisterSessionTimer: () => {},
      setTimeout,
      answerHasDeliveryToken: (llm, text) => Proof.hasDeliveryTokenTail(text, TAG),
      self: {
        resolveBoundTabIdForOrchestrator: () => 501,
        detectActiveGenerationInPage: () => ({ active: false })
      },
      chrome: chromeStub,
      Date
    };
    // eslint-disable-next-line no-new-func
    const factory = new Function(...Object.keys(context), `${ROUTER.slice(ROUTER_START, ROUTER_END)}\nreturn { deferUncertainCompletionTerminal };`);
    return { ...factory(...Object.values(context)), context };
  }

  function setup(pendingFinalAnswer, probeActive) {
    const entry = { promptSubmittedAt: Date.now(), pendingFinalAnswer, lastDispatchMeta: { dispatchId: 'X:1:1' } };
    const jobState = { session: { startTime: 1 }, llms: { X: entry } };
    const chromeStub = {
      scripting: { executeScript: jest.fn(activeResult(probeActive)) }
    };
    const { deferUncertainCompletionTerminal, context } = loadDeferral({ entry, jobState, chromeStub });
    const finalize = jest.fn();
    deferUncertainCompletionTerminal('X', entry, finalize, { status: 'AMBIGUOUS', reason: 'ownership_conflict' });
    return { entry, finalize, executeScript: chromeStub.scripting.executeScript, emitTelemetry: context.emitTelemetry };
  }

  test('at the cap with the page still generating the deferral goes on and is not finalized', async () => {
    const { finalize, executeScript, emitTelemetry } = setup('paused text', true);

    await jest.advanceTimersByTimeAsync(UNCERTAIN_TERMINAL_CAP_MS - UNCERTAIN_TERMINAL_POLL_MS);
    expect(executeScript).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(UNCERTAIN_TERMINAL_POLL_MS * 2);
    expect(executeScript).toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
    expect(emitTelemetry).toHaveBeenCalledWith('X', 'COMPLETION_UNCERTAIN_TERMINAL_CAP_EXTENDED', expect.anything());

    await jest.advanceTimersByTimeAsync(60000);
    expect(finalize).not.toHaveBeenCalled();
    expect(executeScript.mock.calls.length).toBeGreaterThan(5);
  });

  test('when the page stops generating at the cap the deferral ends as cappedUnproven', async () => {
    const { finalize, executeScript } = setup('paused text', true);

    await jest.advanceTimersByTimeAsync(UNCERTAIN_TERMINAL_CAP_MS + UNCERTAIN_TERMINAL_POLL_MS * 2);
    expect(finalize).not.toHaveBeenCalled();

    executeScript.mockImplementation(activeResult(false));
    await jest.advanceTimersByTimeAsync(UNCERTAIN_TERMINAL_POLL_MS * 2);
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith({ cappedUnproven: true });
  });

  test('the ceiling of 60 minutes ends an active deferral as cappedUnproven', async () => {
    const CEILING = 3600000;
    const { finalize, executeScript } = setup('paused text', true);

    await jest.advanceTimersByTimeAsync(CEILING - UNCERTAIN_TERMINAL_POLL_MS * 2);
    expect(finalize).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(UNCERTAIN_TERMINAL_POLL_MS * 4);
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith({ cappedUnproven: true });
    expect(executeScript).toHaveBeenCalled();
  });

  test('a text with the delivery token at its end is finalized without the generation probe', async () => {
    const { finalize, executeScript } = setup(`Готово.\n${TAG}`, true);

    await jest.advanceTimersByTimeAsync(UNCERTAIN_TERMINAL_CAP_MS + UNCERTAIN_TERMINAL_POLL_MS * 2);
    expect(executeScript).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith({ cappedUnproven: false });
  });
});
