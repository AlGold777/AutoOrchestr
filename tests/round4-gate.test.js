const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JOB_ORCHESTRATOR_PATH = path.join(__dirname, '..', 'background', 'job-orchestrator.js');
const JOB_ORCHESTRATOR_SOURCE = fs.readFileSync(JOB_ORCHESTRATOR_PATH, 'utf8');
const STATUS_CONTRACT_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'status-contract.js'), 'utf8');
const ANSWER_EVIDENCE_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'answer-evidence.js'), 'utf8');
const FINALIZATION_CONTROLLER_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'finalization-controller.js'), 'utf8');

const RUN_SESSION_ID = 1781134505984;

function createSandbox({ llms } = {}) {
  const logs = [];
  const stateUpdates = [];
  const telemetryEvents = [];

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
    AbortController,
    setTimeout,
    clearTimeout,
    SUCCESS_STATUSES: ['COPY_SUCCESS', 'SUCCESS', 'DONE', 'COMPLETE', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN'],
    FAILURE_STATUSES: ['ERROR', 'CRITICAL_ERROR', 'RECOVERABLE_ERROR', 'UNRESPONSIVE', 'CIRCUIT_OPEN', 'API_FAILED', 'NO_SEND', 'EXTRACT_FAILED', 'STREAM_TIMEOUT'],
    TERMINAL_STATUSES: ['COPY_SUCCESS', 'SUCCESS', 'DONE', 'COMPLETE', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN', 'ERROR', 'CRITICAL_ERROR', 'RECOVERABLE_ERROR', 'UNRESPONSIVE', 'CIRCUIT_OPEN', 'API_FAILED', 'NO_SEND', 'EXTRACT_FAILED', 'STREAM_TIMEOUT'],
    jobState: {
      prompt: 'test prompt',
      attachments: [],
      responsesCollected: 0,
      session: {
        startTime: RUN_SESSION_ID,
        totalModels: Object.keys(llms || {}).length || 1,
        selectedModels: Object.keys(llms || {}),
        completed: 0,
        failed: 0
      },
      llms: llms || {}
    },
    chrome: {
      tabs: { sendMessage: jest.fn(() => Promise.resolve()) },
      scripting: { executeScript: jest.fn(() => Promise.resolve([])) },
      storage: { local: { set: jest.fn(() => Promise.resolve()), get: jest.fn(() => Promise.resolve({})) } },
      runtime: { lastError: null }
    },
    CompressedStorage: {
      set: jest.fn(() => Promise.resolve()),
      get: jest.fn(() => Promise.resolve(null))
    },
    TabMapManager: {
      get: jest.fn((name) => context.jobState.llms?.[name]?.tabId || null),
      entries: jest.fn(() => []),
      removeByName: jest.fn()
    },
    appendLogEntry: jest.fn((llmName, entry) => logs.push({ llmName, entry })),
    updateModelState: jest.fn((llmName, status, meta) => stateUpdates.push({ llmName, status, meta })),
    sendMessageToResultsTab: jest.fn(),
    getLogSnapshot: jest.fn(() => []),
    broadcastGlobalState: jest.fn(),
    broadcastHumanVisitStatus: jest.fn(),
    saveJobState: jest.fn(),
    emitTelemetry: jest.fn((llmName, event, payload = {}) => telemetryEvents.push({ llmName, event, payload })),
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
    isValidTabId: (tabId) => Number.isInteger(tabId) && tabId > 0,
    getBoundTabId: (llmName, entry) => entry?.tabId || context.jobState.llms?.[llmName]?.tabId || null,
    self: null
  };
  context.self = context;

  vm.createContext(context);
  const coordinatorSource = fs.readFileSync(path.join(__dirname, '..', 'background', 'dispatch-coordinator.js'), 'utf8');
  vm.runInContext(coordinatorSource.slice(coordinatorSource.indexOf('function answerHasNoBodyYet'),
    coordinatorSource.indexOf('\nfunction commitIncompleteAnswer')), context);
  vm.runInContext(STATUS_CONTRACT_SOURCE, context, { filename: 'shared/status-contract.js' });
  vm.runInContext(ANSWER_EVIDENCE_SOURCE, context, { filename: 'shared/answer-evidence.js' });
  vm.runInContext(FINALIZATION_CONTROLLER_SOURCE, context, { filename: 'shared/finalization-controller.js' });
  vm.runInContext(JOB_ORCHESTRATOR_SOURCE, context, { filename: 'background/job-orchestrator.js' });

  return { context, logs, stateUpdates, telemetryEvents };
}

const forceFinalEvents = (telemetryEvents, details) => telemetryEvents.filter((evt) => (
  evt.event === 'ROUND4_FORCE_FINAL' && (!details || evt.payload?.details === details)
));

const isEntryFinalized = (entry) => Boolean(entry?.finalStatusRecorded || entry?.finalStatus);

describe('round1 dispatch ordering', () => {
  test('preserves the configured model order for the simple first pass', () => {
    const { context } = createSandbox({ llms: {} });
    expect(Array.from(context.orderRound1Models([
      'GPT', 'Gemini', 'Claude', 'Grok', 'Z.ai', 'Qwen', 'DeepSeek', 'Le Chat', 'Perplexity'
    ]))).toEqual([
      'GPT', 'Gemini', 'Claude', 'Grok', 'Z.ai', 'Qwen', 'DeepSeek', 'Le Chat', 'Perplexity'
    ]);
  });
});

describe('round4 gate force-final idempotency', () => {
  test.each(['IDLE', 'ERROR'])('an idle unconfirmed Gemini dispatch expires instead of holding the next run (%s)', async dispatchState => {
    const now = Date.now();
    const { context, telemetryEvents } = createSandbox({ llms: { Gemini: {
      tabId: 303, dispatchAttempts: 1, status: 'IDLE', dispatchState,
      lastDispatchAt: now - 181000,
      lastDispatchMeta: { dispatchId: 'Gemini:stalled:1' },
      awaitingSubmitConfirmation: true, awaitingSubmitConfirmationAt: now - 176000,
      dispatchInFlight: false,
      providerComposerTransactionActive: true,
      providerComposerTransactionActiveAt: now - 181000,
      providerDispatchStage: 'command_accepted',
      providerDispatchStageDispatchId: 'Gemini:stalled:1',
      providerDispatchStageAt: now - 181000
    } } });
    expect(context.finalizeNoSendModelIfStalled('Gemini', RUN_SESSION_ID)).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(context.jobState.llms.Gemini.finalStatus).toBe('NO_SEND');
    expect(forceFinalEvents(telemetryEvents, 'no_send_stall')).toHaveLength(1);
  });

  test('fresh provider progress still protects a slow unconfirmed dispatch', () => {
    const now = Date.now();
    const { context } = createSandbox({ llms: { Gemini: {
      tabId: 303, dispatchAttempts: 1, dispatchState: 'IDLE',
      lastDispatchAt: now - 181000, lastDispatchMeta: { dispatchId: 'Gemini:slow:1' },
      awaitingSubmitConfirmation: true,
      providerDispatchStageDispatchId: 'Gemini:slow:1', providerDispatchStageAt: now - 1000
    } } });
    expect(context.finalizeNoSendModelIfStalled('Gemini', RUN_SESSION_ID)).toBe(false);
  });

  test.each([
    { dispatchInFlight: true },
    { dispatchState: 'SUBMITTING' },
    { status: 'RECEIVING' },
    { lastRuntimeActivityAt: Date.now() - 1000 },
    { lastDispatchAt: Date.now() - 179000 }
  ])('active or recent unconfirmed work is protected (%j)', overrides => {
    const now = Date.now();
    const { context } = createSandbox({ llms: { Gemini: {
      tabId: 303, dispatchAttempts: 1, dispatchState: 'IDLE', status: 'IDLE',
      lastDispatchAt: now - 181000, lastDispatchMeta: { dispatchId: 'Gemini:protected:1' },
      awaitingSubmitConfirmation: true, ...overrides
    } } });
    expect(context.finalizeNoSendModelIfStalled('Gemini', RUN_SESSION_ID)).toBe(false);
  });

  test('progress from a different dispatch cannot keep a stalled confirmation alive', () => {
    const now = Date.now();
    const { context } = createSandbox({ llms: { Gemini: {
      tabId: 303, dispatchAttempts: 1, dispatchState: 'IDLE', status: 'IDLE',
      lastDispatchAt: now - 181000, lastDispatchMeta: { dispatchId: 'Gemini:current:1' },
      awaitingSubmitConfirmation: true,
      providerDispatchStageDispatchId: 'Gemini:previous:1', providerDispatchStageAt: now
    } } });
    expect(context.finalizeNoSendModelIfStalled('Gemini', RUN_SESSION_ID)).toBe(true);
  });

  test('no_send stall force-final fires once per dispatch while recovery is deferred', async () => {
    const { context, telemetryEvents } = createSandbox({
      llms: {
        Qwen: {
          tabId: 303,
          requestId: 'req-qwen',
          dispatchAttempts: 1,
          lastDispatchAt: Date.now() - 60000,
          lastDispatchMeta: { dispatchId: 'Qwen:1781134505984:1' }
        }
      }
    });

    const first = context.finalizeNoSendModelIfStalled('Qwen', RUN_SESSION_ID);
    expect(first).toBe(true);
    // Real failure mode from run 1781134505984: handleLLMResponse defers terminal into
    // async materialize recovery, so the entry is still open when the next gate poll fires.
    expect(isEntryFinalized(context.jobState.llms.Qwen)).toBe(false);

    for (let i = 0; i < 7; i += 1) {
      expect(context.finalizeNoSendModelIfStalled('Qwen', RUN_SESSION_ID)).toBe(false);
    }
    expect(forceFinalEvents(telemetryEvents, 'no_send_stall')).toHaveLength(1);

    // The single accepted force-final must still drive the model to a terminal outcome.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(isEntryFinalized(context.jobState.llms.Qwen)).toBe(true);
    expect(context.jobState.llms.Qwen.finalStatus).toBe('NO_SEND');
  });

  test('a new dispatch re-arms the no_send force-final', () => {
    const { context, telemetryEvents } = createSandbox({
      llms: {
        Qwen: {
          tabId: 303,
          dispatchAttempts: 1,
          lastDispatchAt: Date.now() - 60000,
          lastDispatchMeta: { dispatchId: 'Qwen:1:1' }
        }
      }
    });

    expect(context.finalizeNoSendModelIfStalled('Qwen', RUN_SESSION_ID)).toBe(true);
    expect(context.finalizeNoSendModelIfStalled('Qwen', RUN_SESSION_ID)).toBe(false);

    context.jobState.llms.Qwen.lastDispatchMeta = { dispatchId: 'Qwen:1:2' };
    context.jobState.llms.Qwen.lastDispatchAt = Date.now() - 60000;
    expect(context.finalizeNoSendModelIfStalled('Qwen', RUN_SESSION_ID)).toBe(true);
    expect(forceFinalEvents(telemetryEvents, 'no_send_stall')).toHaveLength(2);
  });

  test('prompt-confirmed model is never finalized as no_send by the stall gate', () => {
    const { context, telemetryEvents } = createSandbox({
      llms: {
        Grok: {
          tabId: 404,
          dispatchAttempts: 1,
          promptSubmittedAt: Date.now() - 120000,
          lastDispatchAt: Date.now() - 120000,
          lastDispatchMeta: { dispatchId: 'Grok:1781134505984:1' }
        }
      }
    });

    expect(context.finalizeNoSendModelIfStalled('Grok', RUN_SESSION_ID)).toBe(false);
    expect(forceFinalEvents(telemetryEvents)).toHaveLength(0);
    expect(isEntryFinalized(context.jobState.llms.Grok)).toBe(false);
  });

  test('pending provider dispatch is not finalized as no_send before the bounded gate timeout', () => {
    const { context, telemetryEvents } = createSandbox({
      llms: {
        Perplexity: {
          tabId: 505,
          dispatchAttempts: 1,
          lastDispatchAt: Date.now() - 120000,
          lastDispatchMeta: { dispatchId: 'Perplexity:1781134505984:1' },
          awaitingSubmitConfirmation: true,
          dispatchInFlight: true,
          dispatchState: 'SUBMITTING'
        }
      }
    });

    for (let i = 0; i < 5; i += 1) {
      expect(context.finalizeNoSendModelIfStalled('Perplexity', RUN_SESSION_ID)).toBe(false);
    }

    expect(isEntryFinalized(context.jobState.llms.Perplexity)).toBe(false);
    expect(forceFinalEvents(telemetryEvents, 'no_send_stall')).toHaveLength(0);
    expect(telemetryEvents.filter((evt) => evt.event === 'ROUND4_NO_SEND_DEFERRED')).toHaveLength(1);
  });
});

describe('round4 gate timeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('gate timeout finalizes confirmed-but-stuck model once as extract_failed and emits wait telemetry', async () => {
    const { context, telemetryEvents } = createSandbox({
      llms: {
        Grok: {
          tabId: 404,
          dispatchAttempts: 1,
          promptSubmittedAt: Date.now() - 120000,
          lastDispatchAt: Date.now() - 120000,
          lastDispatchMeta: { dispatchId: 'Grok:1781134505984:1' }
        }
      }
    });

    const gatePromise = context.waitForRound4Gate(['Grok'], RUN_SESSION_ID);
    await jest.advanceTimersByTimeAsync(505000);
    const result = await gatePromise;

    expect(result.timedOut).toBe(true);

    const timeoutEvents = forceFinalEvents(telemetryEvents, 'gate_timeout');
    expect(timeoutEvents).toHaveLength(1);
    expect(timeoutEvents[0].payload?.meta?.errorType).toBe('extract_failed');
    expect(forceFinalEvents(telemetryEvents, 'no_send_stall')).toHaveLength(0);

    const gateWaitEvents = telemetryEvents.filter((evt) => evt.event === 'ROUND4_GATE_WAIT');
    expect(gateWaitEvents.length).toBeGreaterThanOrEqual(2);
    expect(gateWaitEvents[0].payload?.details).toBe('extraction_pending');

    // Drain the deferred recovery path so the terminal outcome lands.
    await jest.advanceTimersByTimeAsync(5000);
    expect(isEntryFinalized(context.jobState.llms.Grok)).toBe(true);
  });

  test('a second gate run does not re-finalize the same timed-out dispatch', async () => {
    const { context, telemetryEvents } = createSandbox({
      llms: {
        Grok: {
          tabId: 404,
          dispatchAttempts: 1,
          promptSubmittedAt: Date.now() - 120000,
          lastDispatchAt: Date.now() - 120000,
          lastDispatchMeta: { dispatchId: 'Grok:1781134505984:1' }
        }
      }
    });

    const firstGate = context.waitForRound4Gate(['Grok'], RUN_SESSION_ID);
    await jest.advanceTimersByTimeAsync(505000);
    await firstGate;

    const secondGate = context.waitForRound4Gate(['Grok'], RUN_SESSION_ID);
    await jest.advanceTimersByTimeAsync(505000);
    await secondGate;

    expect(forceFinalEvents(telemetryEvents, 'gate_timeout')).toHaveLength(1);
  });

  test('gate resolves ready immediately when every tracked model is terminal', async () => {
    const { context } = createSandbox({
      llms: {
        GPT: {
          tabId: 101,
          dispatchAttempts: 1,
          finalStatus: 'SUCCESS',
          finalStatusRecorded: true,
          lastDispatchMeta: { dispatchId: 'GPT:1781134505984:1' }
        }
      }
    });

    const gatePromise = context.waitForRound4Gate(['GPT'], RUN_SESSION_ID);
    await jest.advanceTimersByTimeAsync(10);
    const result = await gatePromise;
    expect(result.ready).toBe(true);
    expect(result.timedOut).toBe(false);
  });
});
