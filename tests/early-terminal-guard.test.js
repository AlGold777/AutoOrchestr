const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JOB_ORCHESTRATOR_PATH = path.join(__dirname, '..', 'background', 'job-orchestrator.js');
const JOB_ORCHESTRATOR_SOURCE = fs.readFileSync(JOB_ORCHESTRATOR_PATH, 'utf8');
const STATUS_CONTRACT_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'status-contract.js'), 'utf8');
const ANSWER_PROOF_NORMALIZATION_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'answer-proof-normalization.js'), 'utf8');
const ANSWER_EVIDENCE_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'answer-evidence.js'), 'utf8');
const ANSWER_LENGTH_POLICY_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'answer-length-policy.js'), 'utf8');
const FINALIZATION_CONTROLLER_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'finalization-controller.js'), 'utf8');
const RECOVERY_INTENT_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'recovery-intent.js'), 'utf8');
const ANSWER_CONTENT_CLASSIFIER = require('../shared/answer-content-classifier');

function createSandbox() {
  const logs = [];
  const stateUpdates = [];
  const partialMessages = [];

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
    AnswerContentClassifier: ANSWER_CONTENT_CLASSIFIER,
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
        startTime: 1778621552201,
        totalModels: 1,
        completed: 0,
        failed: 0
      },
      llms: {
        GPT: {
          tabId: 101,
          requestId: 'req-gpt',
          lastDispatchMeta: { dispatchId: 'dispatch-gpt' }
        },
        Perplexity: {
          tabId: 202,
          requestId: 'req-pplx',
          lastDispatchMeta: { dispatchId: 'dispatch-pplx' }
        },
        Qwen: {
          tabId: 303,
          requestId: 'req-qwen',
          lastDispatchMeta: { dispatchId: 'dispatch-qwen' }
        },
        'Z.ai': {
          tabId: 404,
          requestId: 'req-zai',
          lastDispatchMeta: { dispatchId: 'dispatch-zai' }
        }
      }
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
    sendMessageToResultsTab: jest.fn((payload) => partialMessages.push(payload)),
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
    isValidTabId: (tabId) => Number.isInteger(tabId) && tabId > 0,
    getBoundTabId: (llmName, entry) => entry?.tabId || context.jobState.llms?.[llmName]?.tabId || null,
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

  return { context, logs, stateUpdates, partialMessages };
}

describe('early terminal success guard', () => {
  test('late-upgrade production path passes turnAnchor and never backfills incoming identity from the entry', () => {
    const { context } = createSandbox();
    const entry = context.jobState.llms.GPT;
    Object.assign(entry, {
      status: 'SUCCESS',
      finalStatus: 'SUCCESS',
      finalStatusRecorded: true,
      finalizedAt: Date.now() - 1000,
      promptSubmittedAt: Date.now() - 5000,
      answer: 'short terminal answer',
      generationEpoch: 7,
      preDispatchAnswerNodeCount: 3
    });
    const canAutoUpgrade = jest.fn(() => ({ ok: false, reasons: ['test_stop'] }));
    context.AnswerVerification = { canAutoUpgrade, appendRevision: jest.fn() };

    const accepted = context.acceptLateCollectResult('GPT', {
      ok: true,
      text: `${entry.answer} with a verified appended continuation that is safely longer`,
      source: 'post_success_answer_audit'
    }, {
      source: 'post_success_answer_audit',
      responseMeta: { answerVerification: { verified: true, state: 'verified', generationActive: false } }
    });

    expect(accepted).toBe(false);
    expect(canAutoUpgrade).toHaveBeenCalledTimes(1);
    const [previous, incoming] = canAutoUpgrade.mock.calls[0];
    expect(previous).toEqual(expect.objectContaining({
      runSessionId: 1778621552201,
      dispatchId: 'dispatch-gpt',
      generationEpoch: 7,
      turnAnchor: 3
    }));
    expect(incoming).toEqual(expect.objectContaining({
      runSessionId: null,
      dispatchId: null,
      generationEpoch: null,
      turnAnchor: null
    }));
  });

  test('late-upgrade production path forwards all incoming identity fields when explicitly supplied', () => {
    const { context } = createSandbox();
    const entry = context.jobState.llms.GPT;
    Object.assign(entry, {
      status: 'SUCCESS', finalStatus: 'SUCCESS', finalStatusRecorded: true,
      finalizedAt: Date.now() - 1000, promptSubmittedAt: Date.now() - 5000,
      answer: 'short terminal answer', generationEpoch: 7, preDispatchAnswerNodeCount: 3
    });
    const canAutoUpgrade = jest.fn(() => ({ ok: false, reasons: ['test_stop'] }));
    context.AnswerVerification = { canAutoUpgrade, appendRevision: jest.fn() };

    context.acceptLateCollectResult('GPT', {
      ok: true,
      text: `${entry.answer} with a verified appended continuation that is safely longer`,
      source: 'post_success_answer_audit'
    }, {
      source: 'post_success_answer_audit',
      runSessionId: 1778621552201,
      dispatchId: 'dispatch-gpt',
      generationEpoch: 7,
      turnAnchor: 3,
      responseMeta: { answerVerification: { verified: true, state: 'verified', generationActive: false } }
    });

    expect(canAutoUpgrade.mock.calls[0][1]).toEqual(expect.objectContaining({
      runSessionId: 1778621552201,
      dispatchId: 'dispatch-gpt',
      generationEpoch: 7,
      turnAnchor: 3
    }));
  });

  test('defers risky terminal success before lifecycle ready', () => {
    const { context, logs, stateUpdates, partialMessages } = createSandbox();
    const entry = context.jobState.llms.Perplexity;
    const answer = 'x'.repeat(339);

    const deferred = context.maybeDeferEarlyTerminalSuccess('Perplexity', entry, {
      trimmedAnswer: answer,
      normalizedAnswer: answer,
      normalizedHtml: '<p>partial</p>',
      responseSource: 'dom_snapshot_recovery',
      completionReason: 'dom_snapshot_recovery',
      metaObj: { dispatchId: 'dispatch-pplx' }
    });

    expect(deferred).toBe(true);
    expect(entry.earlyTerminalGuard).toEqual(
      expect.objectContaining({
        dispatchId: 'dispatch-pplx',
        answerLength: 339,
        responseSource: 'dom_snapshot_recovery'
      })
    );
    expect(stateUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ llmName: 'Perplexity', status: 'RECEIVING' })
      ])
    );
    expect(partialMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'LLM_PARTIAL_RESPONSE',
          llmName: 'Perplexity'
        })
      ])
    );
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          llmName: 'Perplexity',
          entry: expect.objectContaining({ label: 'Terminal success deferred (await lifecycle)' })
        })
      ])
    );
  });

  test('allows risky terminal success after repeated stable long answer', () => {
    const { context } = createSandbox();
    const entry = context.jobState.llms.GPT;
    const answer = 'y'.repeat(1900);
    const signature = context.buildEarlyTerminalGuardSignature(answer);
    entry.earlyTerminalGuard = {
      dispatchId: 'dispatch-gpt',
      startedAt: Date.now() - 5000,
      lastSeenAt: Date.now() - 3000,
      signature,
      answerLength: answer.length,
      responseSource: 'deferred_finalization',
      completionReason: 'generation_inactive'
    };

    const deferred = context.maybeDeferEarlyTerminalSuccess('GPT', entry, {
      trimmedAnswer: answer,
      normalizedAnswer: answer,
      normalizedHtml: '<p>full</p>',
      responseSource: 'deferred_finalization',
      completionReason: 'generation_inactive',
      metaObj: { dispatchId: 'dispatch-gpt' }
    });

    expect(deferred).toBe(false);
    expect(entry.earlyTerminalGuard).toBeFalsy();
  });

  test('allows changed long answer after guard max wait to avoid stale lifecycle lock', () => {
    const { context, logs } = createSandbox();
    const entry = context.jobState.llms.Qwen;
    const previousAnswer = 'previous qwen answer '.repeat(600);
    const nextAnswer = `${previousAnswer}final paragraph changed`;
    entry.earlyTerminalGuard = {
      dispatchId: 'dispatch-qwen',
      startedAt: Date.now() - 25000,
      lastSeenAt: Date.now() - 500,
      signature: context.buildEarlyTerminalGuardSignature(previousAnswer),
      answerLength: previousAnswer.length,
      responseSource: 'deferred_finalization',
      completionReason: 'generation_inactive'
    };

    const deferred = context.maybeDeferEarlyTerminalSuccess('Qwen', entry, {
      trimmedAnswer: nextAnswer,
      normalizedAnswer: nextAnswer,
      normalizedHtml: '<p>long changed qwen answer</p>',
      responseSource: 'deferred_finalization',
      completionReason: 'generation_inactive',
      metaObj: { dispatchId: 'dispatch-qwen' }
    });

    expect(deferred).toBe(false);
    expect(entry.earlyTerminalGuard).toBeFalsy();
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          llmName: 'Qwen',
          entry: expect.objectContaining({ label: 'Terminal success guard max wait elapsed' })
        })
      ])
    );
  });

  test('defers Qwen terminal success after generation-inactive probe until lifecycle or stable guard', () => {
    const { context, stateUpdates } = createSandbox();
    const entry = context.jobState.llms.Qwen;
    const answer = 'q'.repeat(420);

    const deferred = context.maybeDeferEarlyTerminalSuccess('Qwen', entry, {
      trimmedAnswer: answer,
      normalizedAnswer: answer,
      normalizedHtml: '<p>partial qwen</p>',
      responseSource: 'deferred_finalization',
      completionReason: 'generation_inactive',
      metaObj: { dispatchId: 'dispatch-qwen' }
    });

    expect(deferred).toBe(true);
    expect(entry.earlyTerminalGuard).toEqual(
      expect.objectContaining({
        dispatchId: 'dispatch-qwen',
        answerLength: 420,
        responseSource: 'deferred_finalization'
      })
    );
    expect(stateUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ llmName: 'Qwen', status: 'RECEIVING' })
      ])
    );
  });

  test('allows repeated stable short answer after guard max wait', () => {
    const { context } = createSandbox();
    const entry = context.jobState.llms.Qwen;
    const answer = 'short but complete answer from qwen'.repeat(4);
    const signature = context.buildEarlyTerminalGuardSignature(answer);
    entry.earlyTerminalGuard = {
      dispatchId: 'dispatch-qwen',
      startedAt: Date.now() - 25000,
      lastSeenAt: Date.now() - 3000,
      signature,
      answerLength: answer.length,
      responseSource: 'deferred_finalization',
      completionReason: 'generation_inactive'
    };

    const deferred = context.maybeDeferEarlyTerminalSuccess('Qwen', entry, {
      trimmedAnswer: answer,
      normalizedAnswer: answer,
      normalizedHtml: '<p>short</p>',
      responseSource: 'deferred_finalization',
      completionReason: 'generation_inactive',
      metaObj: { dispatchId: 'dispatch-qwen' }
    });

    expect(deferred).toBe(false);
    expect(entry.earlyTerminalGuard).toBeNull();
  });

  test('defers Z.ai suspect-short success even if lifecycle says complete', () => {
    const { context, logs, stateUpdates } = createSandbox();
    const entry = context.jobState.llms['Z.ai'];
    entry.lifecycleReadyAt = Date.now();
    entry.lifecycleReadyMeta = { state: 'COMPLETE' };
    const answer = 'Answer loading...';

    const deferred = context.maybeDeferEarlyTerminalSuccess('Z.ai', entry, {
      trimmedAnswer: answer,
      normalizedAnswer: answer,
      normalizedHtml: '<div></div>',
      responseSource: 'deferred_finalization',
      completionReason: 'generation_inactive',
      metaObj: { dispatchId: 'dispatch-zai' }
    });

    expect(deferred).toBe(true);
    expect(entry.earlyTerminalGuard).toEqual(
      expect.objectContaining({
        dispatchId: 'dispatch-zai',
        answerLength: answer.length
      })
    );
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          llmName: 'Z.ai',
          entry: expect.objectContaining({ label: 'Terminal success deferred (suspect short answer)' })
        })
      ])
    );
    expect(stateUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ llmName: 'Z.ai', status: 'RECEIVING' })
      ])
    );
  });

  test('does not publish Z.ai MODEL_FINAL when pre-terminal recovery evidence is rejected', () => {
    const { context, stateUpdates, partialMessages } = createSandbox();
    const entry = context.jobState.llms['Z.ai'];
    entry.promptSubmittedAt = Date.now() - 20000;
    entry.submitSource = 'content';
    entry.lastDispatchAt = Date.now() - 21000;

    context.handleLLMResponse('Z.ai', 'Answer loading...', null, {
      dispatchId: 'dispatch-zai',
      preTerminalMaterialize: true,
      responseMeta: {
        source: 'deferred_finalization',
        completionReason: 'generation_inactive',
        preTerminalMaterialize: true
      }
    });

    expect(entry.finalStatus).not.toBe('SUCCESS');
    expect(entry.finalStatus).toBeFalsy();
    expect(entry.pendingFinalAnswer).toBe('Answer loading...');
    expect(entry.modelRunState).toEqual(expect.objectContaining({
      executionStatus: 'running'
    }));
    expect(entry.modelRunState.terminalStatus).toBeFalsy();
    expect(stateUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        llmName: 'Z.ai',
        status: 'RECEIVING',
        meta: expect.objectContaining({ message: 'awaiting_stronger_answer_evidence' })
      })
    ]));
    expect(partialMessages).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'LLM_PARTIAL_RESPONSE',
        metadata: expect.objectContaining({ status: 'SUCCESS' })
      })
    ]));
  });

  test('does not publish recovered PARTIAL explicitly classified as unconfirmed complete', () => {
    const { context, stateUpdates, partialMessages } = createSandbox();
    const entry = context.jobState.llms.GPT;
    entry.promptSubmittedAt = Date.now() - 20000;
    entry.confirmedDispatchId = 'dispatch-gpt';
    entry.submitSource = 'content';
    entry.lastDispatchAt = Date.now() - 21000;

    context.handleLLMResponse('GPT', 'Answer is still being generated. '.repeat(80), null, {
      dispatchId: 'dispatch-gpt',
      preTerminalMaterialize: true,
      responseMeta: {
        source: 'preserved_pending',
        completionReason: 'materialize_recovered_unconfirmed_complete',
        partial: true,
        preTerminalMaterialize: true
      }
    });

    expect(entry.finalStatusRecorded).not.toBe(true);
    expect(entry.finalStatus).toBeFalsy();
    expect(entry.pendingFinalAnswer).toContain('Answer is still being generated.');
    expect(stateUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        llmName: 'GPT',
        status: 'RECEIVING',
        meta: expect.objectContaining({ message: 'awaiting_stronger_answer_evidence' })
      })
    ]));
    expect(stateUpdates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ llmName: 'GPT', status: 'PARTIAL' })
    ]));
    expect(partialMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'LLM_PARTIAL_RESPONSE',
        metadata: expect.objectContaining({ terminal: false })
      })
    ]));
  });

  test('infers Qwen submit confirmation from a growing post-dispatch answer', () => {
    const { context, logs } = createSandbox();
    const entry = context.jobState.llms.Qwen;
    entry.lastDispatchAt = Date.now() - 45000;
    entry.awaitingSubmitConfirmation = true;
    entry.awaitingSubmitConfirmationDispatchId = 'dispatch-qwen';
    entry.pendingFinalAnswer = 'q'.repeat(2576);
    const grownAnswer = 'q'.repeat(3977);

    const inferred = context.inferPromptSubmittedFromAnswerEvidence('Qwen', entry, {
      trimmedAnswer: grownAnswer,
      responseSource: 'deferred_finalization',
      responseMeta: {
        source: 'deferred_finalization',
        completionReason: 'generation_inactive'
      },
      metaObj: { dispatchId: 'dispatch-qwen' }
    });

    expect(inferred).toBe(true);
    expect(entry.promptSubmittedAt).toBeTruthy();
    expect(entry.submitSource).toBe('inferred_answer_evidence');
    expect(entry.awaitingSubmitConfirmation).toBe(false);
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        llmName: 'Qwen',
        entry: expect.objectContaining({ label: 'Submit confirmation inferred from answer evidence' })
      })
    ]));
  });

  test('does not defer explicit user late collect terminal success', async () => {
    const { context, stateUpdates, partialMessages } = createSandbox();
    const entry = context.jobState.llms.Qwen;
    entry.status = 'RECOVERABLE_ERROR';
    const answer = 'recovered qwen answer '.repeat(190);

    const accepted = context.acceptLateCollectResult('Qwen', {
      ok: true,
      status: 'success',
      text: answer,
      html: '<p>recovered qwen answer</p>',
      source: 'inline_executeScript',
      candidateCount: 2
    }, {
      source: 'collect_responses_staged_late_collect',
      dispatchId: 'dispatch-qwen',
      responseMeta: {
        source: 'collect_responses_staged_late_collect',
        manualRecovery: true,
        completionReason: 'user_collect_late_collect',
        lateCollectFinal: true,
        forceTerminalSuccess: true
      }
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(accepted).toBe(true);
    expect(entry.earlyTerminalGuard).toBeFalsy();
    expect(entry.finalStatusRecorded).toBe(true);
    expect(entry.finalStatus).toBe('SUCCESS');
    expect(stateUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ llmName: 'Qwen', status: 'SUCCESS' })
      ])
    );
    expect(partialMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'LLM_PARTIAL_RESPONSE',
          llmName: 'Qwen',
          metadata: expect.objectContaining({ status: 'SUCCESS' })
        })
      ])
    );
  });

  test('updates cached terminal answer when manual late collect finds longer text', async () => {
    const { context, partialMessages, logs } = createSandbox();
    const entry = context.jobState.llms.Qwen;
    entry.status = 'PARTIAL';
    entry.finalStatus = 'PARTIAL';
    entry.finalStatusRecorded = true;
    entry.finalizedAt = Date.now();
    entry.answer = 'short terminal answer '.repeat(20);
    const previousLength = entry.answer.trim().length;
    const improved = 'longer terminal answer from manual late collect '.repeat(120);

    const accepted = context.acceptLateCollectResult('Qwen', {
      ok: true,
      status: 'success',
      text: improved,
      html: '<p>longer terminal answer</p>',
      source: 'inline_executeScript',
      candidateCount: 4
    }, {
      source: 'manual_ping_late_collect',
      dispatchId: 'dispatch-qwen',
      manualRecovery: true,
      responseMeta: {
        source: 'manual_ping_late_collect',
        completionReason: 'manual_ping_late_collect',
        manualRecovery: true,
        manualOverride: true,
        lateCollectFinal: true
      }
    });
    await Promise.resolve();

    expect(accepted).toBe(true);
    expect(entry.finalStatus).toBe('SUCCESS');
    expect(entry.answer.length).toBeGreaterThan(previousLength);
    expect(entry.answer).toBe(improved.trim());
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entry: expect.objectContaining({ label: 'Terminal answer improved after late collect' })
      })
    ]));
    expect(partialMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'LLM_PARTIAL_RESPONSE',
        llmName: 'Qwen',
        answer: improved.trim(),
        metadata: expect.objectContaining({
          reason: 'improved_after_terminal',
          improvedAfterTerminal: true
        })
      })
    ]));
  });

  test('does not auto-upgrade Qwen false NO_SEND from answer-inferred submission evidence', async () => {
    const { context, stateUpdates, partialMessages, logs } = createSandbox();
    const entry = context.jobState.llms.Qwen;

    context.handleLLMResponse(
      'Qwen',
      'Error: prompt_not_confirmed_before_round4',
      { type: 'no_send', message: 'Prompt submission not confirmed before round4' },
      {
        dispatchId: 'dispatch-qwen',
        preTerminalMaterializeFinal: true,
        responseMeta: {
          failureClass: 'dispatch',
          source: 'round4_gate'
        }
      }
    );
    await Promise.resolve();

    expect(entry.finalStatusRecorded).toBe(true);
    expect(entry.finalStatus).toBe('NO_SEND');
    expect(entry.promptSubmittedAt).toBeFalsy();
    expect(entry.answer || '').toBe('');

    const answer = 'late recovered qwen answer '.repeat(120);
    const accepted = context.acceptLateCollectResult('Qwen', {
      ok: true,
      status: 'success',
      text: answer,
      html: '<p>late recovered qwen answer</p>',
      source: 'inline_executeScript',
      candidateCount: 3,
      anchorApplied: true,
      freshTurnEvidence: true
    }, {
      source: 'materialize_latest_retry:no_send',
      dispatchId: 'dispatch-qwen',
      preTerminalMaterialize: true,
      responseMeta: {
        source: 'materialize_latest_retry:no_send',
        completionReason: 'late_collect',
        recovered: true,
        freshTurnEvidence: true,
        lateCollectFinal: true,
        forceTerminalSuccess: true
      }
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(accepted).toBe(true);
    expect(entry.finalStatusRecorded).toBe(true);
    expect(entry.finalStatus).toBe('NO_SEND');
    expect(entry.promptSubmittedAt).toBeTruthy();
    expect(entry.submitSource).toBe('inferred_answer_evidence');
    expect(stateUpdates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ llmName: 'Qwen', status: 'SUCCESS' })
    ]));
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          llmName: 'Qwen',
          entry: expect.objectContaining({ label: 'Submit confirmation inferred from answer evidence' })
        })
      ])
    );
  });

  test('stores a UI-scaffolding extraction failure with an empty answer field', () => {
    const { context } = createSandbox();
    const entry = context.jobState.llms['Z.ai'];

    context.handleLLMResponse(
      'Z.ai',
      'Refer to the following content:',
      null,
      {
        dispatchId: 'dispatch-zai-ui-noise',
        preTerminalMaterializeFinal: true,
        responseMeta: { source: 'pipeline' }
      }
    );

    expect(entry.finalStatusRecorded).toBe(true);
    expect(entry.finalStatus).toBe('EXTRACT_FAILED');
    expect(entry.answer || '').toBe('');
    expect(entry.pendingFinalAnswer || '').toBe('');
  });

  test('does not upgrade GPT NO_SEND from an unconfirmed dispatch via manual late collect', async () => {
    const { context, partialMessages, logs } = createSandbox();
    const entry = context.jobState.llms.GPT;
    entry.status = 'NO_SEND';
    entry.finalStatus = 'NO_SEND';
    entry.finalStatusRecorded = true;
    entry.finalizedAt = Date.now();
    entry.answer = 'Error: ChatGPT send not confirmed';

    const stalePreviousAnswer = 'previous session GPT answer '.repeat(300);
    const accepted = context.acceptLateCollectResult('GPT', {
      ok: true,
      status: 'success',
      text: stalePreviousAnswer,
      html: '<p>previous session GPT answer</p>',
      source: 'inline_executeScript',
      candidateCount: 3
    }, {
      source: 'manual_ping_late_collect',
      dispatchId: 'dispatch-gpt',
      manualRecovery: true,
      responseMeta: {
        source: 'manual_ping_late_collect',
        manualRecovery: true,
        manualOverride: true,
        lateCollectFinal: true,
        forceTerminalSuccess: true
      }
    });

    expect(accepted).toBe(false);
    expect(entry.finalStatus).toBe('NO_SEND');
    expect(entry.answer).toBe('Error: ChatGPT send not confirmed');
    expect(partialMessages).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ llmName: 'GPT', answer: stalePreviousAnswer.trim() })
    ]));
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        llmName: 'GPT',
        entry: expect.objectContaining({ label: 'Terminal upgrade blocked (submit unconfirmed)' })
      })
    ]));
  });

  test('manual latest recovery can repair locked Grok NO_SEND with a fresh latest answer', async () => {
    const { context, stateUpdates, partialMessages, logs } = createSandbox();
    context.jobState.llms.Grok = {
      tabId: 505,
      requestId: 'req-grok',
      lastDispatchMeta: { dispatchId: 'dispatch-grok' },
      status: 'NO_SEND',
      finalStatus: 'NO_SEND',
      finalStatusRecorded: true,
      finalizedAt: Date.now(),
      answer: 'Error: Grok submission was not confirmed'
    };
    const answer = 'fresh grok answer recovered by status indicator double click '.repeat(80);

    const accepted = context.acceptLateCollectResult('Grok', {
      ok: true,
      status: 'success',
      text: answer,
      html: '<p>fresh grok answer</p>',
      source: 'inline_executeScript',
      candidateCount: 2
    }, {
      source: 'manual_latest_recovery',
      dispatchId: 'dispatch-grok',
      manualRecovery: true,
      responseMeta: {
        source: 'manual_latest_recovery',
        completionReason: 'manual_latest_recovery',
        manualRecovery: true,
        manualOverride: true,
        manualLatestRecovery: true,
        lateCollectFinal: true,
        forceTerminalSuccess: true
      }
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(accepted).toBe(true);
    expect(context.jobState.llms.Grok.finalStatus).toBe('SUCCESS');
    expect(context.jobState.llms.Grok.answer).toBe(answer.trim());
    expect(stateUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({ llmName: 'Grok', status: 'SUCCESS' })
    ]));
    expect(partialMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'LLM_PARTIAL_RESPONSE',
        llmName: 'Grok',
        answer: answer.trim()
      })
    ]));
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        llmName: 'Grok',
        entry: expect.objectContaining({ label: 'Terminal answer improved after late collect' })
      })
    ]));
  });

  test('defense-in-depth rejects direct GPT success after locked unconfirmed NO_SEND', () => {
    const { context, stateUpdates } = createSandbox();
    const entry = context.jobState.llms.GPT;
    entry.status = 'NO_SEND';
    entry.finalStatus = 'NO_SEND';
    entry.finalStatusRecorded = true;
    entry.finalizedAt = Date.now();

    context.handleLLMResponse('GPT', 'previous answer '.repeat(400), null, {
      dispatchId: 'dispatch-gpt',
      manualRecovery: true,
      responseMeta: {
        source: 'manual_ping_late_collect',
        manualRecovery: true,
        manualOverride: true,
        lateCollectFinal: true,
        forceTerminalSuccess: true
      }
    });

    expect(entry.finalStatus).toBe('NO_SEND');
    expect(stateUpdates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ llmName: 'GPT', status: 'SUCCESS' })
    ]));
  });

  test('keeps Qwen non-terminal while page still reports active generation', async () => {
    const { context, partialMessages, logs } = createSandbox();
    context.chrome.scripting.executeScript = jest.fn(() => Promise.resolve([
      { result: { active: true, stopVisible: true, busyVisible: false } }
    ]));
    const answer = 'qwen partial answer'.repeat(40);

    context.handleLLMResponse('Qwen', answer, null, {
      dispatchId: 'dispatch-qwen',
      responseMeta: {
        source: 'dom',
        completionReason: 'ok'
      }
    });
    await Promise.resolve();

    expect(context.jobState.llms.Qwen.finalStatusRecorded).toBeFalsy();
    expect(partialMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'LLM_PARTIAL_RESPONSE',
          llmName: 'Qwen',
          metadata: expect.objectContaining({ status: 'GENERATING' })
        })
      ])
    );
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          llmName: 'Qwen',
          entry: expect.objectContaining({ label: 'Finalization deferred (generation active)' })
        })
      ])
    );
  });

  test('does not auto-finalize long stable pending answer without structural proof', async () => {
    jest.useFakeTimers();
    try {
      const { context, logs } = createSandbox();
      const entry = context.jobState.llms.Qwen;
      entry.pendingFinalAnswer = 'stable qwen answer '.repeat(700);
      entry.pendingFinalAnswerHtml = '<p>stable qwen answer</p>';
      entry.finalizationDeferStartedAt = Date.now() - 35000;
      context.chrome.scripting.executeScript = jest.fn(() => Promise.resolve([
        { result: { active: true, stopVisible: false, busyVisible: true } }
      ]));

      const scheduled = context.scheduleStablePendingAutoFinalization('Qwen', 303, {
        dispatchId: 'dispatch-qwen',
        responseMeta: { source: 'deferred_finalization' }
      }, 'test_stable_pending');

      expect(scheduled).toBe(true);
      await jest.advanceTimersByTimeAsync(600);
      await Promise.resolve();
      await Promise.resolve();

      expect(entry.finalStatusRecorded).toBeFalsy();
    } finally {
      jest.useRealTimers();
    }
  });

  test('does not auto-finalize long stable pending answer while stop button is visible', async () => {
    jest.useFakeTimers();
    try {
      const { context, logs } = createSandbox();
      const entry = context.jobState.llms.Qwen;
      entry.pendingFinalAnswer = 'still generating qwen answer '.repeat(700);
      entry.finalizationDeferStartedAt = Date.now() - 35000;
      context.chrome.scripting.executeScript = jest.fn(() => Promise.resolve([
        { result: { active: true, stopVisible: true, busyVisible: false } }
      ]));

      const scheduled = context.scheduleStablePendingAutoFinalization('Qwen', 303, {
        dispatchId: 'dispatch-qwen',
        responseMeta: { source: 'deferred_finalization' }
      }, 'test_stop_visible');

      expect(scheduled).toBe(true);
      await jest.advanceTimersByTimeAsync(600);
      await Promise.resolve();

      expect(entry.finalStatusRecorded).toBeFalsy();
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            llmName: 'Qwen',
            entry: expect.objectContaining({ label: 'Stable pending auto-finalization deferred (stop visible)' })
          })
        ])
      );
    } finally {
      jest.useRealTimers();
    }
  });

  test('does not let manual recovery force success while page is still generating', async () => {
    const { context, partialMessages, logs, stateUpdates } = createSandbox();
    context.chrome.scripting.executeScript = jest.fn(() => Promise.resolve([
      { result: { active: true, stopVisible: true, busyVisible: true } }
    ]));
    const entry = context.jobState.llms.GPT;
    const answer = 'manual partial gpt answer '.repeat(80);

    context.handleLLMResponse('GPT', answer, null, {
      dispatchId: 'dispatch-gpt',
      manualRecovery: true,
      responseMeta: {
        source: 'manual_ping',
        completionReason: 'manual_ping_late_collect',
        manualRecovery: true,
        manualOverride: true,
        lateCollectFinal: true,
        forceTerminalSuccess: true
      }
    });
    await Promise.resolve();

    expect(entry.finalStatusRecorded).toBeFalsy();
    expect(stateUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ llmName: 'GPT', status: 'RECEIVING' })
      ])
    );
    expect(partialMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'LLM_PARTIAL_RESPONSE',
          llmName: 'GPT',
          metadata: expect.objectContaining({ status: 'GENERATING' })
        })
      ])
    );
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          llmName: 'GPT',
          entry: expect.objectContaining({ label: 'Finalization deferred (generation active)' })
        })
      ])
    );
  });

  test('forces finalization for long stable answer when only busy indicator remains', async () => {
    const { context, logs, stateUpdates } = createSandbox();
    context.chrome.scripting.executeScript = jest.fn(() => Promise.resolve([
      { result: { active: true, stopVisible: false, busyVisible: true } }
    ]));
    const entry = context.jobState.llms.GPT;
    entry.finalizationDeferStartedAt = Date.now() - 35000;
    const answer = 'stable completed answer '.repeat(90);

    context.handleLLMResponse('GPT', answer, null, {
      dispatchId: 'dispatch-gpt',
      responseMeta: {
        source: 'manual_ping_late_collect',
        manualRecovery: true,
        completionReason: 'manual_ping_late_collect',
        lateCollectFinal: true,
        forceTerminalSuccess: true
      }
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(entry.finalStatusRecorded).toBe(true);
    expect(stateUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ llmName: 'GPT', status: 'SUCCESS' })
      ])
    );
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          llmName: 'GPT',
          entry: expect.objectContaining({ label: 'Finalization forced (stable answer evidence)' })
        })
      ])
    );
  });

  test('records active generation at streaming max as partial, not success', async () => {
    const { context, partialMessages } = createSandbox();
    context.chrome.scripting.executeScript = jest.fn(() => Promise.resolve([
      { result: { active: true, stopVisible: false, busyVisible: true } }
    ]));
    const entry = context.jobState.llms.GPT;
    entry.finalizationDeferStartedAt = Date.now() - 461000;
    const answer = 'long answer still streaming '.repeat(90);

    context.handleLLMResponse('GPT', answer, null, {
      dispatchId: 'dispatch-gpt',
      attemptId: 'streaming-attempt-1',
      responseMeta: {
        source: 'manual_ping',
        completionReason: 'manual_ping_late_collect',
        lateCollectFinal: true,
        forceTerminalSuccess: true
      }
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(entry.finalStatusRecorded).toBe(true);
    expect(entry.finalStatus).toBe('PARTIAL');
    expect(entry.answerCommitEvidence).toEqual(expect.objectContaining({
      dispatchId: 'dispatch-gpt',
      attemptId: 'streaming-attempt-1',
      payloadEvidenceId: expect.any(String),
      outcome: 'accepted'
    }));
    expect(context.emitTelemetry).toHaveBeenCalledWith(
      'GPT',
      'ANSWER_COMMIT_EVALUATED',
      expect.objectContaining({ meta: expect.objectContaining({ attemptId: 'streaming-attempt-1' }) })
    );
    expect(partialMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'LLM_PARTIAL_RESPONSE',
          llmName: 'GPT',
          metadata: expect.objectContaining({
            status: 'PARTIAL',
            completionReason: 'streaming_incomplete'
          })
        })
      ])
    );
  });

  test('does not treat unverified Round2 lifecycle activity as confirmation signal', () => {
    const { context } = createSandbox();
    const entry = context.jobState.llms.GPT;
    entry.pendingFinalAnswer = 'Recovered answer evidence. '.repeat(8);
    entry.lifecycleReadyAt = Date.now();
    entry.lifecycleReadyMeta = { dispatchId: 'dispatch-gpt' };

    expect(context.hasRound2SubmitOrAnswerEvidence(entry)).toBe(false);
    expect(context.getRound2SubmitConfirmationState('GPT', 'dispatch-gpt')).toEqual(
      expect.objectContaining({
        ok: false,
        reason: 'not_confirmed'
      })
    );
  });

  test('treats dispatch-matched verified Round2 answer evidence as confirmation', () => {
    const { context } = createSandbox();
    const entry = context.jobState.llms.GPT;
    entry.pendingFinalAnswer = 'Verified recovered answer evidence. '.repeat(8);
    entry.lastDispatchMeta = { dispatchId: 'dispatch-gpt' };
    entry.answerVerification = {
      state: 'verified',
      verified: true,
      resolution: 'exact',
      structuralComplete: true,
      generationActive: false,
      dispatchId: 'dispatch-gpt'
    };

    expect(context.hasRound2SubmitOrAnswerEvidence(entry)).toBe(true);
    expect(context.getRound2SubmitConfirmationState('GPT', 'dispatch-gpt')).toEqual(
      expect.objectContaining({
        ok: true,
        reason: 'answer_evidence'
      })
    );
  });

  test('does not treat a baseline-only Round2 candidate as submit confirmation', () => {
    const { context } = createSandbox();
    const entry = context.jobState.llms.GPT;
    const baseline = 'Old response already on the page. '.repeat(8);
    entry.pendingFinalAnswer = baseline;
    entry.preDispatchAnswerSignature = baseline.replace(/\s+/g, ' ').trim().toLowerCase();
    entry.preDispatchAnswerDispatchId = 'dispatch-gpt';

    expect(context.hasRound2SubmitOrAnswerEvidence(entry)).toBe(false);
    expect(context.getRound2SubmitConfirmationState('GPT', 'dispatch-gpt')).toEqual(
      expect.objectContaining({ ok: false, reason: 'not_confirmed' })
    );
  });

  test('keeps delayed Round2 dispatch pending instead of hard not-confirmed', async () => {
    const { context } = createSandbox();
    const entry = context.jobState.llms.GPT;
    entry.messageSent = true;
    entry.awaitingSubmitConfirmation = true;
    entry.lastDispatchMeta = { dispatchId: 'dispatch-gpt' };

    const immediate = context.getRound2SubmitConfirmationState('GPT', 'dispatch-gpt');
    expect(immediate).toEqual(
      expect.objectContaining({
        ok: false,
        reason: 'dispatch_pending'
      })
    );

    const waited = await context.waitForRound2SubmitConfirmation('GPT', 'dispatch-gpt', 1);
    expect(waited).toEqual(
      expect.objectContaining({
        ok: false,
        reason: 'dispatch_pending'
      })
    );
    expect(context.isRound2DelayedConfirmationState(waited)).toBe(true);
  });

  test('rejects snapshot cache answer when current dispatch is unconfirmed', () => {
    const { context, logs, stateUpdates } = createSandbox();
    const entry = context.jobState.llms.GPT;
    entry.promptSubmittedAt = null;
    entry.submitSource = null;
    entry.messageSent = true;
    entry.awaitingSubmitConfirmation = true;

    const accepted = context.acceptLateCollectResult('GPT', {
      ok: true,
      status: 'partial_from_snapshot',
      source: 'snapshot_cache',
      text: 'Previous answer from an older Gemini/GPT tab. '.repeat(8),
      html: '<p>previous</p>'
    }, {
      dispatchId: 'dispatch-gpt',
      source: 'manual_ping_late_collect',
      responseMeta: {
        source: 'snapshot_cache',
        completionReason: 'soft_timeout',
        partial: true
      }
    });

    expect(accepted).toBe(false);
    expect(entry.finalStatusRecorded).not.toBe(true);
    expect(stateUpdates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ llmName: 'GPT', status: 'PARTIAL' })
      ])
    );
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          llmName: 'GPT',
          entry: expect.objectContaining({ label: 'Late collect stale answer rejected' })
        })
      ])
    );
  });
});

describe('stable answer at streaming max (run 1782940321214 GPT case)', () => {
  test('text stability alone cannot finalize SUCCESS without structural proof', async () => {
    const { context, stateUpdates } = createSandbox();
    context.chrome.scripting.executeScript = jest.fn(() => Promise.resolve([
      { result: { active: true, stopVisible: false, busyVisible: true } }
    ]));
    const entry = context.jobState.llms.GPT;
    const answer = 'stable completed answer body '.repeat(140);

    // Accumulate observed stability while the defer budget is still open: the
    // same text re-enters the defer path several times without changing.
    entry.finalizationDeferStartedAt = Date.now() - 10000;
    for (let i = 0; i < 3; i += 1) {
      context.handleLLMResponse('GPT', answer, null, { dispatchId: 'dispatch-gpt' });
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(entry.finalStatusRecorded).toBeFalsy();
    expect(Number(entry.pendingFinalAnswerStableCount || 0)).toBeGreaterThanOrEqual(2);

    // Now the defer budget is exhausted (streaming max), the Stop button is
    // gone and only a stuck busy indicator remains — the stable evidence wins.
    // The early-terminal guard still demands one re-observation of the same
    // text after its stability window before releasing the SUCCESS.
    entry.finalizationDeferStartedAt = Date.now() - 461000;
    context.handleLLMResponse('GPT', answer, null, { dispatchId: 'dispatch-gpt' });
    await new Promise((resolve) => setTimeout(resolve, 2600));
    context.handleLLMResponse('GPT', answer, null, { dispatchId: 'dispatch-gpt' });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(entry.finalStatusRecorded).toBeFalsy();
    expect(stateUpdates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ llmName: 'GPT', status: 'SUCCESS' })
    ]));
  });

  test('single long snapshot at streaming max still finalizes PARTIAL (no observed stability)', async () => {
    const { context } = createSandbox();
    context.chrome.scripting.executeScript = jest.fn(() => Promise.resolve([
      { result: { active: true, stopVisible: false, busyVisible: true } }
    ]));
    const entry = context.jobState.llms.GPT;
    entry.finalizationDeferStartedAt = Date.now() - 461000;

    context.handleLLMResponse('GPT', 'long answer still streaming '.repeat(90), null, {
      dispatchId: 'dispatch-gpt'
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(entry.finalStatusRecorded).toBe(true);
    expect(entry.finalStatus).toBe('PARTIAL');
  });
});

describe('pre-send finalization gate (run 1782945983672 Claude case)', () => {
  test('submission confirmation alone does not replace structural completion proof', async () => {
    const { context } = createSandbox();
    context.chrome.scripting.executeScript = jest.fn(() => Promise.resolve([
      { result: { active: false, stopVisible: false, busyVisible: false } }
    ]));
    const entry = context.jobState.llms.GPT;
    // Round1 command sent, content script still typing the prompt: the only
    // text on the page is the previous conversation's answer.
    entry.awaitingSubmitConfirmation = true;
    entry.promptSubmittedAt = null;
    entry.finalizationDeferStartedAt = Date.now() - 181000;
    const staleAnswer = 'предыдущий ответ на странице '.repeat(100);

    context.handleLLMResponse('GPT', staleAnswer, null, { dispatchId: 'dispatch-gpt' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(entry.finalStatusRecorded).toBeFalsy();

    // The send confirms; the real answer may now finalize normally.
    entry.awaitingSubmitConfirmation = false;
    entry.promptSubmittedAt = Date.now();
    entry.confirmedDispatchId = 'dispatch-gpt';
    entry.lifecycleReadyAt = Date.now();
    context.handleLLMResponse('GPT', staleAnswer, null, { dispatchId: 'dispatch-gpt' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(entry.finalStatus).not.toBe('SUCCESS');
  });

  test('stable pending auto-finalization is blocked while the submit is unconfirmed', async () => {
    const { context, logs } = createSandbox();
    const entry = context.jobState.llms.GPT;
    entry.awaitingSubmitConfirmation = true;
    entry.promptSubmittedAt = null;
    entry.pendingFinalAnswer = 'предыдущий ответ на странице '.repeat(100);
    entry.finalizationDeferStartedAt = Date.now() - 200000;

    const scheduled = context.scheduleStablePendingAutoFinalization('GPT', 404, { dispatchId: 'dispatch-gpt' }, 'early_terminal_guard');
    expect(scheduled).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(entry.finalStatusRecorded).toBeFalsy();
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          llmName: 'GPT',
          entry: expect.objectContaining({ label: 'Stable pending auto-finalization blocked (submit unconfirmed)' })
        })
      ])
    );
  });
});

describe('stable pending vs longer completed answer (run 1782945983672 Z.ai case)', () => {
  test('timer re-collects instead of finalizing a pending stub shorter than the detected complete answer', async () => {
    const { context, logs } = createSandbox();
    const entry = context.jobState.llms.GPT;
    entry.pendingFinalAnswer = 'обрезанный кусок ответа '.repeat(80); // ~1.9k
    entry.answerCompleteTextLength = 3351;
    entry.finalizationDeferStartedAt = Date.now() - 200000;
    entry.promptSubmittedAt = Date.now() - 60000;

    const scheduled = context.scheduleStablePendingAutoFinalization('GPT', 404, { dispatchId: 'dispatch-gpt' }, 'early_terminal_guard');
    expect(scheduled).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(entry.finalStatusRecorded).toBeFalsy();
    expect(Number(entry.stablePendingCompleteRefreshCount || 0)).toBe(1);
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          llmName: 'GPT',
          entry: expect.objectContaining({ label: 'Stable pending auto-finalization deferred (longer complete answer detected)' })
        })
      ])
    );
  });

  test('after exhausted refresh attempts the stub finalizes as PARTIAL, not SUCCESS', async () => {
    const { context } = createSandbox();
    context.chrome.scripting.executeScript = jest.fn(() => Promise.resolve([
      { result: { active: false, stopVisible: false, busyVisible: false } }
    ]));
    const entry = context.jobState.llms.GPT;
    entry.pendingFinalAnswer = 'обрезанный кусок ответа '.repeat(80);
    entry.answerCompleteTextLength = 3351;
    entry.stablePendingCompleteRefreshCount = 3;
    entry.finalizationDeferStartedAt = Date.now() - 200000;
    entry.promptSubmittedAt = Date.now() - 60000;

    context.scheduleStablePendingAutoFinalization('GPT', 404, { dispatchId: 'dispatch-gpt' }, 'early_terminal_guard');
    await new Promise((resolve) => setTimeout(resolve, 900));

    expect(entry.finalStatusRecorded).toBe(true);
    expect(entry.finalStatus).toBe('PARTIAL');
  });
});

describe('automation deadline terminal contract', () => {
  test('stops automation and preserves an available answer as terminal PARTIAL', () => {
    const { context } = createSandbox();
    const entry = context.jobState.llms.GPT;
    entry.status = 'RECEIVING';
    entry.pendingFinalAnswer = 'Ответ уже виден в карточке, но генерация провайдера может продолжаться.';
    entry.pendingFinalAnswerHtml = '<p>Ответ уже виден в карточке.</p>';

    const applied = context.finalizeAutomationDeadline('GPT', 'generation', 180000, {
      source: 'test_deadline'
    });

    expect(applied).toBe(true);
    expect(entry.automationDeadlineReached).toBe(true);
    expect(entry.skipHumanLoop).toBe(true);
    expect(entry.finalStatusRecorded).toBe(true);
    expect(entry.finalStatus).toBe('PARTIAL');
    expect(entry.answer).toContain('Ответ уже виден');
    expect(context.closePingWindowForLLM).toHaveBeenCalledWith('GPT');
    expect(context.completeHumanPresenceForModel).toHaveBeenCalledWith('GPT', 'automation_deadline');
    expect(context.chrome.tabs.sendMessage).toHaveBeenCalledWith(
      101,
      expect.objectContaining({ type: 'HUMANOID_FORCE_STOP' })
    );
    expect(context.chrome.tabs.sendMessage).toHaveBeenCalledWith(
      101,
      expect.objectContaining({
        type: 'STOP_AND_CLEANUP',
        reason: 'automation_deadline'
      })
    );
  });

  test('uses terminal STREAM_TIMEOUT when the deadline has no answer candidate', () => {
    const { context } = createSandbox();
    const entry = context.jobState.llms.GPT;
    entry.status = 'GENERATING';

    const applied = context.finalizeAutomationDeadline('GPT', 'generation', 180000, {
      source: 'test_deadline_empty'
    });

    expect(applied).toBe(true);
    expect(entry.finalStatusRecorded).toBe(true);
    expect(entry.finalStatus).toBe('STREAM_TIMEOUT');
    expect(entry.skipHumanLoop).toBe(true);
  });

  test('does not let an early content lifecycle timeout shorten the background deadline', () => {
    const { context } = createSandbox();
    const entry = context.jobState.llms.GPT;
    entry.status = 'GENERATING';
    entry.promptSubmittedAt = Date.now() - 1000;
    entry.budgetTimers = {
      generation: {
        startedAt: entry.promptSubmittedAt,
        deadlineAt: Date.now() + 60000,
        budgetMs: 180000,
        timerId: null
      }
    };

    const applied = context.finalizeAutomationDeadline('GPT', 'generation', null, {
      contentLifecycleSignal: true,
      reportedBudgetMs: 180000
    });

    expect(applied).toBe(false);
    expect(entry.finalStatusRecorded).toBeFalsy();
    expect(entry.skipHumanLoop).not.toBe(true);
  });
});

describe('answer verification recording', () => {
  test('an unverified retry cannot overwrite an already verified proof', () => {
    const { context } = createSandbox();
    const entry = context.jobState.llms.GPT;
    Object.assign(entry, { generationEpoch: 7, preDispatchAnswerNodeCount: 3 });
    context.AnswerVerification = {
      compareIdentity: jest.fn(() => ({ ok: true, missing: [], mismatched: [] })),
      appendTimeline: jest.fn()
    };
    const identity = {
      runSessionId: context.jobState.session.startTime,
      dispatchId: 'dispatch-gpt',
      generationEpoch: 7,
      turnAnchor: 3
    };

    expect(context.recordPipelineAnswerVerification('GPT', {
      ...identity,
      verified: true,
      state: 'verified',
      selectedLength: 500
    }, { tab: { id: 101 } })).toBe(true);
    expect(context.recordPipelineAnswerVerification('GPT', {
      ...identity,
      verified: false,
      state: 'candidate',
      reasons: ['later_retry_unstable'],
      selectedLength: 480
    }, { tab: { id: 101 } })).toBe(true);

    expect(entry.answerVerification).toEqual(expect.objectContaining({
      verified: true,
      selectedLength: 500
    }));
    expect(entry.answerVerificationLast).toEqual(expect.objectContaining({
      verified: false,
      selectedLength: 480,
      reasons: ['later_retry_unstable']
    }));
  });

  test('preserves producer observation time and records background receipt separately', () => {
    const { context } = createSandbox();
    const entry = context.jobState.llms.GPT;
    Object.assign(entry, { generationEpoch: 7, preDispatchAnswerNodeCount: 3 });
    context.AnswerVerification = {
      compareIdentity: jest.fn(() => ({ ok: true, missing: [], mismatched: [] })),
      appendTimeline: jest.fn()
    };

    context.recordPipelineAnswerVerification('GPT', {
      verified: true,
      state: 'verified',
      selectedLength: 500,
      observedAt: 12345,
      runSessionId: context.jobState.session.startTime,
      dispatchId: 'dispatch-gpt',
      generationEpoch: 7,
      turnAnchor: 3
    }, { tab: { id: 101 } });

    expect(entry.answerVerification.observedAt).toBe(12345);
    expect(entry.answerVerification.recordedAt).toBeGreaterThan(12345);
  });
});

test('manual GPT numeric answer remains available for the recovery result payload', async () => {
  const { context } = createSandbox();
  const entry = context.jobState.llms.GPT;
  Object.assign(entry, { status: 'NO_SEND', finalStatus: 'NO_SEND', finalStatusRecorded: true,
    finalizedAt: Date.now(), answer: 'Error: ChatGPT send not confirmed' });
  const answer = '0.0000009386313895162496';
  const result = { ok: true, status: 'success', text: answer, html: `<p>${answer}</p>`, source: 'inline_executeScript' };
  const accepted = context.acceptLateCollectResult('GPT', result, {
    source: 'manual_latest_recovery', dispatchId: 'dispatch-gpt', manualRecovery: true,
    manualLatestRecovery: true, responseMeta: { source: 'manual_latest_recovery',
      manualRecovery: true, manualOverride: true, manualLatestRecovery: true,
      lateCollectFinal: true, forceTerminalSuccess: true }
  });
  await Promise.resolve();
  expect(accepted).toBe(true);
  // The same selection feeds MANUAL_PING_RESULT and therefore the results card.
  expect(String(entry.answer || result.text || '')).toBe(answer);
  expect(entry.finalStatus).toBe('NO_SEND'); // Collection alone does not prove completion.
});
