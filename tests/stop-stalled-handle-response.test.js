/** @jest-environment node */
// The stop_stalled terminal is delivered to handleLLMResponse as an uncertain
// error that still carries the collected text. The model run must end UNCERTAIN,
// keep the text, and never be marked as a success.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const JOB_ORCHESTRATOR_SOURCE = read('background/job-orchestrator.js');
const STATUS_CONTRACT_SOURCE = read('shared/status-contract.js');
const ANSWER_EVIDENCE_SOURCE = read('shared/answer-evidence.js');
const FINALIZATION_CONTROLLER_SOURCE = read('shared/finalization-controller.js');
const RUN_SESSION_ID = 1781134505984;
const DISPATCH_ID = 'Claude:1781134505984:1';

function createSandbox(llms) {
  const telemetryEvents = [];
  const context = {
    console, Promise, Map, Set, Date, Math, Array, Object, Number, String, Boolean, RegExp, JSON, URL,
    setTimeout, clearTimeout, AbortController,
    SUCCESS_STATUSES: ['COPY_SUCCESS', 'SUCCESS', 'DONE', 'COMPLETE', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN'],
    FAILURE_STATUSES: ['ERROR', 'CRITICAL_ERROR', 'RECOVERABLE_ERROR', 'UNRESPONSIVE', 'CIRCUIT_OPEN', 'API_FAILED', 'NO_SEND', 'EXTRACT_FAILED', 'STREAM_TIMEOUT', 'UNCERTAIN'],
    TERMINAL_STATUSES: ['COPY_SUCCESS', 'SUCCESS', 'DONE', 'COMPLETE', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN', 'ERROR', 'CRITICAL_ERROR', 'RECOVERABLE_ERROR', 'UNRESPONSIVE', 'CIRCUIT_OPEN', 'API_FAILED', 'NO_SEND', 'EXTRACT_FAILED', 'STREAM_TIMEOUT', 'UNCERTAIN'],
    jobState: {
      prompt: 'test prompt', attachments: [], responsesCollected: 0,
      session: { startTime: RUN_SESSION_ID, totalModels: 1, selectedModels: Object.keys(llms), completed: 0, failed: 0 },
      llms
    },
    chrome: {
      tabs: { sendMessage: () => Promise.resolve() },
      scripting: { executeScript: () => Promise.resolve([]) },
      storage: { local: { set: () => Promise.resolve(), get: () => Promise.resolve({}) } },
      runtime: { lastError: null }
    },
    CompressedStorage: { set: () => Promise.resolve(), get: () => Promise.resolve(null) },
    TabMapManager: { get: () => null, entries: () => [], removeByName: () => {} },
    appendLogEntry: () => {},
    updateModelState: () => {},
    sendMessageToResultsTab: () => {},
    getLogSnapshot: () => [],
    broadcastGlobalState: () => {},
    broadcastHumanVisitStatus: () => {},
    saveJobState: () => {},
    emitTelemetry: (llmName, event, payload = {}) => telemetryEvents.push({ llmName, event, payload }),
    broadcastDiagnostic: () => {},
    clearDeferredAnswerTimer: () => {},
    clearPostSuccessScrollAudit: () => {},
    clearClaudeRetryTimers: () => {},
    resolvePromptSubmitted: () => {},
    executeApiFallback: () => Promise.resolve(false),
    setRateLimit: () => {},
    getRecentPipelineErrorReason: () => '',
    scheduleClaudeHardTimeoutRetry: () => false,
    clearBudgetPhases: () => {},
    clearAdaptiveCollectTimer: () => {},
    resolveModelFinalStatus: () => 'UNCERTAIN',
    resolveModelDoneReason: () => 'uncertain',
    completeHumanPresenceForModel: () => {},
    downgradePipelineHardTimeoutLogs: () => {},
    downgradePipelineHardTimeoutStorage: () => {},
    closePingWindowForLLM: () => {},
    isValidTabId: (tabId) => Number.isInteger(tabId) && tabId > 0,
    getBoundTabId: (llmName, entry) => entry?.tabId || null,
    self: null
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(STATUS_CONTRACT_SOURCE, context, { filename: 'shared/status-contract.js' });
  vm.runInContext(ANSWER_EVIDENCE_SOURCE, context, { filename: 'shared/answer-evidence.js' });
  vm.runInContext(FINALIZATION_CONTROLLER_SOURCE, context, { filename: 'shared/finalization-controller.js' });
  vm.runInContext(JOB_ORCHESTRATOR_SOURCE, context, { filename: 'background/job-orchestrator.js' });
  return { context, telemetryEvents };
}

const liveEntry = () => ({
  tabId: 404,
  status: 'GENERATING',
  promptSubmittedAt: RUN_SESSION_ID + 1000,
  submitSource: 'content',
  confirmedDispatchId: DISPATCH_ID,
  lastDispatchMeta: { dispatchId: DISPATCH_ID, generationEpoch: 1 },
  dispatchId: DISPATCH_ID,
  generationEpoch: 1
});

const PARTIAL_TEXT = 'Первая часть ответа, которую модель успела написать до того, как Stop остался видимым без роста текста и дедлайн сработал.';

describe('stop_stalled uncertain terminal in handleLLMResponse', () => {
  test('non-empty text with an uncertain stop_stalled error ends UNCERTAIN and keeps the text', async () => {
    const { context } = createSandbox({ Claude: liveEntry() });
    context.handleLLMResponse('Claude', PARTIAL_TEXT, { type: 'uncertain', message: 'stop_stalled' }, {
      dispatchId: DISPATCH_ID,
      runSessionId: RUN_SESSION_ID,
      sessionId: RUN_SESSION_ID,
      stopStalled: true,
      completionTerminalResult: { status: 'STALLED', reason: 'stop_stalled' },
      completionRolloutMode: 'enforced'
    }, '');
    await new Promise((resolve) => setTimeout(resolve, 300));

    const entry = context.jobState.llms.Claude;
    expect(entry.finalStatus).toBe('UNCERTAIN');
    expect(entry.finalStatus).not.toMatch(/SUCCESS|PARTIAL|COMPLETE/);
    expect(String(entry.answer || '')).toContain(PARTIAL_TEXT);
  });

  test('without text the same terminal is still UNCERTAIN, not a success', async () => {
    const { context } = createSandbox({ Claude: liveEntry() });
    context.handleLLMResponse('Claude', '', { type: 'uncertain', message: 'stop_stalled' }, {
      dispatchId: DISPATCH_ID, runSessionId: RUN_SESSION_ID, sessionId: RUN_SESSION_ID, stopStalled: true
    }, '');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(context.jobState.llms.Claude.finalStatus).toBe('UNCERTAIN');
  });
});
