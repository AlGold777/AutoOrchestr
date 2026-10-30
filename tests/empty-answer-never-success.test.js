// Review C4: an answer that is empty or holds only transport marks must never become SUCCESS.
// Chain under test: content side (answer text) -> AnswerContentClassifier -> MessageDelivery
// (panel journal) -> background handleLLMResponse (acceptance). The delivery tag
// [[AO-xxxxxx]] is a transport mark; it is not answer text.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const JOB_ORCHESTRATOR_SOURCE = fs.readFileSync(path.join(ROOT, 'background', 'job-orchestrator.js'), 'utf8');
const DISPATCH_COORDINATOR_SOURCE = fs.readFileSync(path.join(ROOT, 'background', 'dispatch-coordinator.js'), 'utf8');
const STATUS_CONTRACT_SOURCE = fs.readFileSync(path.join(ROOT, 'shared', 'status-contract.js'), 'utf8');
const ANSWER_PROOF_NORMALIZATION_SOURCE = fs.readFileSync(path.join(ROOT, 'shared', 'answer-proof-normalization.js'), 'utf8');
const ANSWER_EVIDENCE_SOURCE = fs.readFileSync(path.join(ROOT, 'shared', 'answer-evidence.js'), 'utf8');
const ANSWER_LENGTH_POLICY_SOURCE = fs.readFileSync(path.join(ROOT, 'shared', 'answer-length-policy.js'), 'utf8');
const FINALIZATION_CONTROLLER_SOURCE = fs.readFileSync(path.join(ROOT, 'shared', 'finalization-controller.js'), 'utf8');
const RECOVERY_INTENT_SOURCE = fs.readFileSync(path.join(ROOT, 'shared', 'recovery-intent.js'), 'utf8');
const CONTENT_CLAUDE_SOURCE = fs.readFileSync(path.join(ROOT, 'content-scripts', 'content-claude.js'), 'utf8');
const Classifier = require('../shared/answer-content-classifier');
const MessageDelivery = require('../shared/message-delivery');

const SUCCESS_LIKE = ['SUCCESS', 'COMPLETE', 'DONE', 'COPY_SUCCESS', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN'];
const TOKEN = '[[AO-abc123]]';
const GENERATION_WAIT_CAP_MS = 240000;

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
      llms: {
        Claude: {
          tabId: 501,
          requestId: 'req-claude',
          lastDispatchMeta: { dispatchId: 'dispatch-claude', generationEpoch: 3 }
        }
      }
    },
    chrome: {
      tabs: { sendMessage: jest.fn(() => Promise.resolve()) },
      scripting: { executeScript: jest.fn(() => Promise.resolve([])) },
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

function armClaudeSubmit(context, dispatchId = 'dispatch-claude') {
  const entry = context.jobState.llms.Claude;
  entry.promptSubmittedAt = Date.now();
  entry.submitSource = 'content';
  entry.lastDispatchMeta = { dispatchId, generationEpoch: 3 };
  context.jobState.session.promptsByModel = { Claude: `Answer the question. ${TOKEN}` };
  return entry;
}

function expectNotSuccess(entry) {
  expect(SUCCESS_LIKE).not.toContain(String(entry.finalStatus || '').toUpperCase());
  expect(SUCCESS_LIKE).not.toContain(String(entry.status || '').toUpperCase());
  expect(String(entry.answer || '').replace(/\[\[AO-[a-z0-9]{6}\]\]/gi, '').trim()).toBe('');
}

describe('empty or mark-only answers never become SUCCESS (review C4)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('AnswerContentClassifier', () => {
    test('a delivery tag alone is an empty answer, not a short valid one', () => {
      for (const text of [TOKEN, `  ${TOKEN}\n`, `${TOKEN}\n${TOKEN}`]) {
        const result = Classifier.classify(text, { prompt: 'Explain the CAP theorem.' });
        expect(result.contentClass).toBe(Classifier.CLASSES.EMPTY);
        expect(result.terminalEligible).toBe(false);
      }
    });

    test('an answer with real text and its tag stays terminal-eligible', () => {
      const result = Classifier.classify(`Да, это так.\n${TOKEN}`, { prompt: 'Explain the CAP theorem.' });
      expect(result.terminalEligible).toBe(true);
    });
  });

  describe('MessageDelivery (panel journal and returned message)', () => {
    test('a final that holds only the tag is recorded as empty and never SUCCESS', () => {
      MessageDelivery.reset?.();
      const requestId = 'req-md-token-only';
      MessageDelivery.prepare({
        prompt: 'Explain.', promptsByModel: { Claude: `Explain.` }, models: ['Claude'],
        requestIds: { Claude: requestId }
      });
      const prepared = MessageDelivery.journal().find((event) => event.kind === 'prepared' && event.requestId === requestId);
      const token = prepared.token;
      const tag = `[[${token}]]`;

      const out = MessageDelivery.receive({
        llmName: 'Claude', answer: tag, status: 'SUCCESS', metadata: { transportRequestId: requestId, status: 'SUCCESS' },
        transportRequestId: requestId
      }, { final: true });

      const finalEvent = MessageDelivery.journal().filter((event) => event.requestId === requestId && event.kind !== 'prepared').pop();
      expect(finalEvent.kind).toBe('empty_answer');
      expect(finalEvent.status).toBe('FAILED');
      expect(out.status).toBe('FAILED');
      expect(out.metadata?.terminal).not.toBe(true);
      expect(out.metadata?.status).not.toBe('SUCCESS');
    });
  });

  describe('background handleLLMResponse', () => {
    test('a Claude final with only the tag is an empty extraction, never a success', () => {
      const context = createSandbox();
      const entry = armClaudeSubmit(context);

      context.handleLLMResponse('Claude', TOKEN, null, {
        dispatchId: 'dispatch-claude',
        preTerminalMaterializeFinal: true,
        responseMeta: { source: 'pipeline' }
      });

      expect(context.emitTelemetry).toHaveBeenCalledWith('Claude', 'ANSWER_GENERATION_WAIT',
        expect.objectContaining({ meta: expect.objectContaining({ reason: 'empty_answer' }) }));
      expectNotSuccess(entry);
    });

    test('a tag-only answer arriving with an error-free empty pipeline result stays open while generating', () => {
      const context = createSandbox();
      const entry = armClaudeSubmit(context);

      context.handleLLMResponse('Claude', { text: TOKEN, html: '' }, null, {
        dispatchId: 'dispatch-claude',
        responseMeta: { source: 'pipeline' }
      });

      expect(entry.finalStatusRecorded).not.toBe(true);
      expectNotSuccess(entry);
    });

    test('a tag-only answer after the 240 s wait cap ends as EXTRACT_FAILED, not SUCCESS', async () => {
      jest.useFakeTimers();
      const context = createSandbox();
      context.triggerResponseCollectionPing = jest.fn();
      const entry = armClaudeSubmit(context);

      context.handleLLMResponse('Claude', TOKEN, null, {
        dispatchId: 'dispatch-claude',
        responseMeta: { source: 'pipeline' }
      });
      expect(entry.finalStatusRecorded).not.toBe(true);

      await jest.advanceTimersByTimeAsync(GENERATION_WAIT_CAP_MS + 60000);

      expect(entry.finalStatusRecorded).toBe(true);
      expect(entry.finalStatus).toBe('EXTRACT_FAILED');
      expectNotSuccess(entry);
    });

    test('a late tag-only answer after an EXTRACT_FAILED terminal does not upgrade it to SUCCESS', () => {
      const context = createSandbox();
      const entry = armClaudeSubmit(context);
      Object.assign(entry, {
        status: 'EXTRACT_FAILED', finalStatus: 'EXTRACT_FAILED', finalStatusRecorded: true,
        finalizedAt: Date.now() - 1000, answer: ''
      });

      context.handleLLMResponse('Claude', TOKEN, null, {
        dispatchId: 'dispatch-claude',
        responseMeta: { source: 'pipeline' }
      });

      expect(entry.finalStatus).toBe('EXTRACT_FAILED');
      expectNotSuccess(entry);
    });
  });

  describe('content-claude answer checks', () => {
    test('the GET_ANSWER and manual-ping paths test answer body without delivery tags', () => {
      expect(CONTENT_CLAUDE_SOURCE).toContain("const answerBodyOf = (text) => String(text || '').replace(/\\[\\[AO-[a-z0-9]{6}\\]\\]/gi, '').trim();");
      expect(CONTENT_CLAUDE_SOURCE).toContain('if (!answerBodyOf(resp?.text)) {');
      expect(CONTENT_CLAUDE_SOURCE).toContain('if (!answerBodyOf(cleaned)) {');
      expect(CONTENT_CLAUDE_SOURCE).toContain('if (!answerBodyOf(cleanedResponse)) {');
    });
  });
});
