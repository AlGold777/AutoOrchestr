const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JOB_ORCHESTRATOR_PATH = path.join(__dirname, '..', 'background', 'job-orchestrator.js');
const JOB_ORCHESTRATOR_SOURCE = fs.readFileSync(JOB_ORCHESTRATOR_PATH, 'utf8');
const STATUS_CONTRACT_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'status-contract.js'), 'utf8');
const ANSWER_EVIDENCE_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'answer-evidence.js'), 'utf8');
const FINALIZATION_CONTROLLER_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'finalization-controller.js'), 'utf8');
const RECOVERY_INTENT_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'recovery-intent.js'), 'utf8');
const RUN_IDENTITY_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'run-identity.js'), 'utf8');
const DECISION_LEDGER_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'decision-ledger.js'), 'utf8');
const ANSWER_VERIFICATION_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'answer-verification.js'), 'utf8');

function createSandbox() {
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
      prompt: 'Explain selector recovery architecture in detail. '.repeat(12),
      attachments: [],
      responsesCollected: 0,
      session: { startTime: 1778621552201, totalModels: 1, completed: 0, failed: 0 },
      llms: {
        Grok: { tabId: 101, requestId: 'req-grok', lastDispatchMeta: { dispatchId: 'dispatch-grok' } },
        Perplexity: { tabId: 202, requestId: 'req-pplx', lastDispatchMeta: { dispatchId: 'dispatch-pplx' } }
      }
    },
    chrome: {
      tabs: { sendMessage: jest.fn(() => Promise.resolve()) },
      scripting: { executeScript: jest.fn(() => Promise.resolve([])) },
      storage: { local: { set: jest.fn(() => Promise.resolve()), get: jest.fn(() => Promise.resolve({})) } },
      alarms: {
        create: jest.fn(),
        clear: jest.fn(),
        onAlarm: { addListener: jest.fn() }
      },
      runtime: { lastError: null }
    },
    CompressedStorage: { set: jest.fn(() => Promise.resolve()), get: jest.fn(() => Promise.resolve(null)) },
    TabMapManager: { get: jest.fn((name) => context.jobState.llms?.[name]?.tabId || null), entries: jest.fn(() => []), removeByName: jest.fn() },
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
  vm.runInContext(STATUS_CONTRACT_SOURCE, context, { filename: 'shared/status-contract.js' });
  vm.runInContext(ANSWER_EVIDENCE_SOURCE, context, { filename: 'shared/answer-evidence.js' });
  vm.runInContext(FINALIZATION_CONTROLLER_SOURCE, context, { filename: 'shared/finalization-controller.js' });
  vm.runInContext(RECOVERY_INTENT_SOURCE, context, { filename: 'shared/recovery-intent.js' });
  vm.runInContext(RUN_IDENTITY_SOURCE, context, { filename: 'shared/run-identity.js' });
  vm.runInContext(DECISION_LEDGER_SOURCE, context, { filename: 'shared/decision-ledger.js' });
  vm.runInContext(ANSWER_VERIFICATION_SOURCE, context, { filename: 'shared/answer-verification.js' });
  vm.runInContext(JOB_ORCHESTRATOR_SOURCE, context, { filename: 'background/job-orchestrator.js' });
  return context;
}

describe('finalization evidence contract', () => {
  test('records normalized source and extraction boundaries in the common response path', () => {
    expect(JOB_ORCHESTRATOR_SOURCE).toContain("emitTelemetry(llmName, 'ANSWER_SOURCE_MATERIALIZED'");
    expect(JOB_ORCHESTRATOR_SOURCE).toContain("emitTelemetry(llmName, 'ANSWER_EXTRACTION_COMPLETED'");
    expect(JOB_ORCHESTRATOR_SOURCE).toContain('entry.lastAnswerMaterializationTelemetryKey !== materializationKey');
    expect(JOB_ORCHESTRATOR_SOURCE).toContain('payloadEvidenceId: acceptedPayloadProof.payloadEvidenceId || null');
    expect(JOB_ORCHESTRATOR_SOURCE).toContain('if (entry && isSuccess && trimmedAnswer && incomingDispatchId && acceptedPayloadProof)');
  });

  test('canonical source alone cannot create automatic verified evidence', () => {
    const context = createSandbox();
    const entry = context.jobState.llms.Grok;
    entry.generationEpoch = 3;
    entry.preDispatchAnswerNodeCount = 2;
    const evidence = context.buildFinalizationEvidence('Grok', entry, {
      trimmedAnswer: 'Canonical answer body. '.repeat(20),
      finalStatus: 'SUCCESS',
      dispatchId: 'dispatch-grok',
      responseMeta: {
        source: 'native_copy',
        runSessionId: context.jobState.session.startTime,
        dispatchId: 'dispatch-grok',
        generationEpoch: 3,
        turnAnchor: 2
      }
    });
    expect(evidence.verificationIdentity.ok).toBe(true);
    expect(evidence.answerVerified).toBe(false);
    expect(evidence.contradictions).toContain('answer_not_verified');
  });

  test('exact complete inactive proof with full identity creates verified evidence', () => {
    const context = createSandbox();
    const entry = context.jobState.llms.Grok;
    entry.lastDispatchAt = 1000;
    entry.promptSubmittedAt = 2000;
    entry.submitSource = 'content';
    entry.confirmedDispatchId = 'dispatch-grok';
    entry.generationEpoch = 3;
    entry.preDispatchAnswerNodeCount = 2;
    const text = 'Structurally verified answer body. '.repeat(20).trim();
    const evidence = context.buildFinalizationEvidence('Grok', entry, {
      trimmedAnswer: text,
      finalStatus: 'SUCCESS',
      dispatchId: 'dispatch-grok',
      responseMeta: {
        source: 'pipeline',
        answerVerification: {
          verified: true,
          state: 'verified',
          resolution: 'exact',
          structuralComplete: true,
          generationActive: false,
          selectedLength: text.length,
          runSessionId: context.jobState.session.startTime,
          dispatchId: 'dispatch-grok',
          generationEpoch: 3,
          turnAnchor: 2
        }
      }
    });
    expect(evidence.verificationIdentity.ok).toBe(true);
    expect(evidence.answerVerified).toBe(true);
    expect(evidence.contradictions).not.toContain('answer_not_verified');
    expect(evidence.automaticSubmissionConfirmed).toBe(true);
  });

  test('automatic finalization fails closed until this dispatch is confirmed submitted', () => {
    const context = createSandbox();
    const entry = context.jobState.llms.Grok;
    entry.generationEpoch = 3;
    entry.preDispatchAnswerNodeCount = 2;
    entry.promptSubmittedAt = null;
    entry.confirmedDispatchId = null;
    const text = 'Stable answer that could still belong to the previous turn. '.repeat(20).trim();
    const evidence = context.buildFinalizationEvidence('Grok', entry, {
      trimmedAnswer: text, finalStatus: 'SUCCESS', dispatchId: 'dispatch-grok',
      responseMeta: { answerVerification: {
        verified: true, state: 'verified', resolution: 'exact', structuralComplete: true,
        generationActive: false, selectedLength: text.length,
        runSessionId: context.jobState.session.startTime, dispatchId: 'dispatch-grok',
        generationEpoch: 3, turnAnchor: 2
      } }
    });
    expect(evidence.answerVerified).toBe(false);
    expect(evidence.accepted).toBe(false);
    expect(evidence.contradictions).toEqual(expect.arrayContaining([
      'answer_not_verified', 'automatic_finalization_before_submit_confirmation'
    ]));
  });

  test('confirmation from another dispatch cannot unlock automatic finalization', () => {
    const context = createSandbox();
    const entry = context.jobState.llms.Grok;
    entry.generationEpoch = 3;
    entry.preDispatchAnswerNodeCount = 2;
    entry.confirmedDispatchId = 'older-dispatch';
    const text = 'Stable answer. '.repeat(30).trim();
    const evidence = context.buildFinalizationEvidence('Grok', entry, {
      trimmedAnswer: text, finalStatus: 'SUCCESS', dispatchId: 'dispatch-grok',
      responseMeta: { answerVerification: {
        verified: true, resolution: 'exact', structuralComplete: true, generationActive: false,
        selectedLength: text.length, runSessionId: context.jobState.session.startTime,
        dispatchId: 'dispatch-grok', generationEpoch: 3, turnAnchor: 2
      } }
    });
    expect(evidence.automaticSubmissionConfirmed).toBe(false);
    expect(evidence.accepted).toBe(false);
  });

  test('captures immutable decision-time proof and checks the B2 end marker diagnostically', () => {
    const context = createSandbox();
    context.jobState.prompt = 'Generate a long answer.\n\nB2-S2-LONG-END-91AC7F';
    const entry = context.jobState.llms.Grok;
    entry.lastDispatchAt = 1000;
    entry.promptSubmittedAt = 2000;
    entry.submitSource = 'content';
    entry.confirmedDispatchId = 'dispatch-grok';
    entry.generationEpoch = 3;
    entry.preDispatchAnswerNodeCount = 2;
    const text = 'Structurally verified answer without its requested final marker. '.repeat(20).trim();
    const evidence = context.buildFinalizationEvidence('Grok', entry, {
      trimmedAnswer: text,
      finalStatus: 'SUCCESS',
      dispatchId: 'dispatch-grok',
      responseMeta: {
        source: 'pipeline',
        answerVerification: {
          verified: true,
          state: 'verified',
          resolution: 'exact',
          structuralComplete: true,
          structuralIssues: [],
          generationActive: false,
          generationSignalKind: 'inactive_controls_absent',
          generationSignalSelector: 'button[aria-label*="Stop" i]',
          selectedLength: text.length,
          messageRootLength: text.length + 12,
          snapshotsCompared: 3,
          observedAt: 12345,
          runSessionId: context.jobState.session.startTime,
          dispatchId: 'dispatch-grok',
          generationEpoch: 3,
          turnAnchor: 2
        }
      }
    });

    expect(evidence.accepted).toBe(true);
    expect(evidence.calibrationEndMarker).toBe('B2-S2-LONG-END-91AC7F');
    expect(evidence.calibrationEndMarkerPresent).toBe(false);
    expect(evidence.decisionSnapshot).toEqual(expect.objectContaining({
      selectedLength: text.length,
      messageRootLength: text.length + 12,
      structuralComplete: true,
      generationActive: false,
      generationSignalKind: 'inactive_controls_absent',
      generationSignalSelector: 'button[aria-label*="Stop" i]',
      calibrationEndMarkerPresent: false
    }));
    expect(Object.isFrozen(evidence.decisionSnapshot)).toBe(true);

    context.emitFinalizationDecision('Grok', evidence);
    expect(context.emitTelemetry).toHaveBeenCalledWith('Grok', 'FINALIZATION_DECISION', expect.objectContaining({
      meta: expect.objectContaining({
        decisionSnapshot: expect.objectContaining({ selectedLength: text.length }),
        calibrationEndMarkerPresent: false
      })
    }));
  });
  test('telemetry summary strips full answer evidence content', () => {
    const context = createSandbox();
    const text = 'Sensitive generated answer. '.repeat(100);
    const summary = context.summarizeFinalizationEvidenceForTelemetry({
      finalStatus: 'SUCCESS',
      answerLength: text.trim().length,
      answerEvidence: {
        text,
        html: `<p>${text}</p>`,
        source: 'lifecycle_complete_snapshot',
        hash: 'abc123',
        terminalEligible: true
      }
    });

    expect(summary.answerEvidence.text).toBeUndefined();
    expect(summary.answerEvidence.html).toBeUndefined();
    expect(summary.answerEvidence.length).toBe(text.trim().length);
    expect(summary.answerEvidence.htmlLength).toBeGreaterThan(text.trim().length);
    expect(summary.answerEvidence.source).toBe('lifecycle_complete_snapshot');
  });

  test('builds AnswerEvidence Lite for timeout, snapshot, panel and materialize sources', () => {
    const context = createSandbox();
    const cases = [
      [{ source: 'dom_snapshot_recovery' }, 'snapshot', 'Accepted answer body. '.repeat(80)],
      [{ source: 'panel_extraction' }, 'panel', 'Accepted answer body. '.repeat(12)],
      [{ source: 'materialize_latest', completionEvidence: true }, 'materialize', 'Accepted answer body. '.repeat(12)],
      [{ source: 'stream_watcher', completionReason: 'hard_timeout' }, 'timeout', 'Accepted answer body. '.repeat(12)]
    ];

    cases.forEach(([responseMeta, sourceKind, baseText]) => {
      const evidence = context.AnswerEvidence.buildAnswerEvidence({
        llmName: 'Perplexity',
        text: baseText,
        responseMeta,
        minChars: 80
      });
      expect(evidence).toEqual(expect.objectContaining({
        llmName: 'Perplexity',
        sourceKind,
        length: baseText.trim().length,
        terminalEligible: true
      }));
      expect(context.AnswerEvidence.shouldFinalizeWithEvidence(evidence).ok).toBe(true);
    });
  });

  test('rejects short materialize evidence without completion proof', () => {
    const context = createSandbox();
    const evidence = context.AnswerEvidence.buildAnswerEvidence({
      llmName: 'Claude',
      text: 'Accepted answer body. '.repeat(12),
      responseMeta: { source: 'materialize_latest' },
      minChars: 80,
      stableMinChars: 1200
    });

    expect(evidence).toEqual(expect.objectContaining({
      sourceKind: 'materialize',
      terminalEligible: false,
      reason: 'materialize_text_without_completion_evidence'
    }));
    expect(context.AnswerEvidence.shouldFinalizeWithEvidence(evidence).ok).toBe(false);
  });

  test('marks timeout-with-text success as partial through evidence policy', () => {
    const context = createSandbox();
    context.handleLLMResponse('Perplexity', 'Timeout answer text. '.repeat(20), null, {
      dispatchId: 'dispatch-pplx',
      responseMeta: {
        source: 'stream_watcher',
        completionReason: 'hard_timeout'
      }
    });

    const entry = context.jobState.llms.Perplexity;
    expect(entry.finalStatusRecorded).toBe(true);
    expect(entry.finalStatus).toBe('PARTIAL');
    expect(entry.finalizationEvidence.answerEvidence).toEqual(expect.objectContaining({
      terminalEligible: true,
      reason: 'timeout_with_text',
      partialAllowed: true
    }));
  });

  test('detects prompt echo candidates', () => {
    const context = createSandbox();
    const prompt = context.jobState.prompt;
    expect(context.isPromptEchoAnswerCandidate(prompt, prompt)).toBe(true);
    expect(context.isPromptEchoAnswerCandidate(`${prompt}\n\nSend`, prompt)).toBe(true);
    expect(context.isPromptEchoAnswerCandidate('This is a real answer with different content and conclusions.', prompt)).toBe(false);
  });

  test('builds stable EvidenceSummary contract fields', () => {
    const context = createSandbox();
    const text = 'Recovered answer body. '.repeat(20);
    const trimmedText = text.trim();
    const validation = context.validateMaterializedAnswerEvidence('Perplexity', text, { source: 'inline_executeScript' });
    const summary = context.buildMaterializedEvidenceSummary('Perplexity', {
      source: 'inline_executeScript',
      text,
      html: '<p>Recovered</p>',
      dispatchId: 'dispatch-pplx',
      sourceRunId: 1778621552201,
      selectorUsed: 'article:last-of-type'
    }, validation);

    expect(summary).toEqual(expect.objectContaining({
      llmName: 'Perplexity',
      source: 'inline_executeScript',
      text: trimmedText,
      html: '<p>Recovered</p>',
      length: trimmedText.length,
      hash: validation.hash,
      answerHash: validation.hash,
      dispatchId: 'dispatch-pplx',
      sourceRunId: 1778621552201,
      valid: true,
      rejectReason: null,
      selectorUsed: 'article:last-of-type'
    }));
    expect(summary.dedupeKey).toBe(context.buildEvidenceDedupeKey({
      llmName: 'Perplexity',
      dispatchId: 'dispatch-pplx',
      sourceRunId: 1778621552201,
      source: 'inline_executeScript',
      hash: validation.hash
    }));
    expect(typeof summary.extractedAt).toBe('number');
  });

  test('enforces recovery budget attempt limits', () => {
    const context = createSandbox();
    const entry = context.jobState.llms.Perplexity;
    const key = context.buildRecoveryBudgetKey({
      dispatchId: 'dispatch-pplx',
      reason: 'materialize_latest:no_send',
      scope: 'materialize_latest'
    });

    const first = context.consumeRecoveryBudget('Perplexity', entry, key, 'inlineDom', {
      limits: { inlineDomAttempts: 2, maxTotalMs: 90000 }
    });
    const second = context.consumeRecoveryBudget('Perplexity', entry, key, 'inlineDom', {
      limits: { inlineDomAttempts: 2, maxTotalMs: 90000 }
    });
    const third = context.consumeRecoveryBudget('Perplexity', entry, key, 'inlineDom', {
      limits: { inlineDomAttempts: 2, maxTotalMs: 90000 }
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(third.ok).toBe(false);
    expect(third.reason).toBe('recovery_budget_inlineDomAttempts');
    expect(entry.recoveryBudgets[key]).toEqual(expect.objectContaining({
      inlineDomAttempts: 2,
      key
    }));
  });

  test('marks extract failure after lifecycle ready as contradictory without pre-final recovery', () => {
    const context = createSandbox();
    const entry = context.jobState.llms.Perplexity;
    entry.lifecycleReadyAt = Date.now();
    entry.answerCompleteTextLength = 1800;
    const evidence = context.buildFinalizationEvidence('Perplexity', entry, {
      finalStatus: 'EXTRACT_FAILED',
      finalReason: 'extract_failed',
      error: { type: 'extract_failed', message: 'Round4 gate timeout' },
      trimmedAnswer: 'Error: extract_failed',
      responseMeta: {}
    });
    expect(evidence.accepted).toBe(false);
    expect(evidence.contradictions).toContain('failure_with_answer_evidence_without_prefinal_recovery');
    expect(evidence.contradictions).toContain('extract_failed_after_lifecycle_ready');
  });

  test('classifies transport failures separately from extraction failures', () => {
    const context = createSandbox();
    const transportFailure = context.classifyFailure({
      type: 'transport_error_after_submit',
      message: 'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received'
    }, {
      responseMeta: { source: 'passive_ping_error' }
    });
    expect(transportFailure).toEqual(expect.objectContaining({
      class: 'transport',
      recoveryFirst: true,
      terminalRequiresEvidenceMiss: true
    }));
    expect(context.deriveFailureFinalStatus({ type: 'transport_error_after_submit' }, null, transportFailure)).toBe('ERROR');

    const extractionFailure = context.classifyFailure({ type: 'extract_failed', message: 'no_answer_extracted' });
    expect(extractionFailure.class).toBe('extraction');
    expect(context.deriveFailureFinalStatus({ type: 'extract_failed' }, null, extractionFailure)).toBe('EXTRACT_FAILED');

    const userActionFailure = context.classifyFailure({ type: 'auth_required', message: 'login required before dispatch' });
    expect(userActionFailure.class).toBe('page_readiness');
    expect(context.deriveFailureFinalStatus({ type: 'auth_required' }, null, userActionFailure)).toBe('USER_ACTION_REQUIRED');

    const externalFailure = context.classifyFailure({ type: 'rate_limit', message: 'provider rate limit' });
    expect(externalFailure.class).toBe('external_llm');
    expect(context.deriveFailureFinalStatus({ type: 'rate_limit' }, null, externalFailure)).toBe('EXTERNAL_LLM_FAILURE');

    const unknownFailure = context.classifyFailure({ type: 'unknown_state', message: 'state cannot be classified' });
    expect(unknownFailure.class).toBe('unknown');
    expect(context.deriveFailureFinalStatus({ type: 'unknown_state' }, null, unknownFailure)).toBe('UNCERTAIN');
  });

  test('send_not_taken (the prompt never left the composer) is NO_SEND and needs no recovery visit', () => {
    const context = createSandbox();
    const failure = context.classifyFailure({ type: 'send_not_taken', message: 'Send stays disabled' });
    expect(failure.class).toBe('dispatch');
    expect(context.deriveFailureFinalStatus({ type: 'send_not_taken' }, null, failure)).toBe('NO_SEND');
    expect(context.shouldMaterializeBeforeTerminal('Claude', 'NO_SEND', 'send_not_taken', { type: 'send_not_taken' }, {})).toBe(false);
  });

  test('records failure class in finalization evidence', () => {
    const context = createSandbox();
    const entry = context.jobState.llms.Perplexity;
    const failureClassification = context.classifyFailure({
      type: 'transport_error_after_submit',
      message: 'message port closed'
    });
    const evidence = context.buildFinalizationEvidence('Perplexity', entry, {
      finalStatus: 'ERROR',
      finalReason: 'transport_error_after_submit',
      error: { type: 'transport_error_after_submit', message: 'message port closed' },
      trimmedAnswer: 'Error: transport_error_after_submit',
      responseMeta: {},
      failureClassification
    });
    expect(evidence.failureClass).toBe('transport');
    expect(evidence.failureRecoveryFirst).toBe(true);
    expect(evidence.terminalRequiresEvidenceMiss).toBe(true);
  });

  test('records model run state and accepts failure after pre-final recovery', () => {
    const context = createSandbox();
    const entry = context.jobState.llms.Perplexity;
    const evidence = context.buildFinalizationEvidence('Perplexity', entry, {
      finalStatus: 'EXTRACT_FAILED',
      finalReason: 'extract_failed',
      error: { type: 'extract_failed' },
      trimmedAnswer: 'Error: extract_failed',
      metaObj: { preTerminalMaterializeFinal: true },
      responseMeta: {}
    });
    context.recordModelRunState('Perplexity', entry, evidence);
    expect(evidence.accepted).toBe(true);
    expect(entry.modelRunState).toEqual(expect.objectContaining({
      executionStatus: 'finalized_failure',
      answerStatus: 'none',
      uiStatus: 'EXTRACT_FAILED'
    }));
  });

  test('denies manual resend when answer evidence already exists', () => {
    const context = createSandbox();
    const entry = context.jobState.llms.Perplexity;
    entry.promptSubmittedAt = null;
    entry.confirmedDispatchId = null;
    entry.pendingFinalAnswer = 'Recovered answer text. '.repeat(80);
    entry.promptSubmittedAt = Date.now() - 1000;
    entry.submitSource = 'content';
    entry.confirmedDispatchId = entry.lastDispatchMeta.dispatchId;

    const result = context.handleManualResendRequest('Perplexity');

    expect(result).toEqual(expect.objectContaining({
      status: 'manual_resend_denied',
      reason: 'no_resend_after_answer_evidence',
      intent: 'resend_prompt'
    }));
    expect(entry.manualResendActive).toBeUndefined();
    expect(entry.lastRecoveryIntentDecision).toEqual(expect.objectContaining({
      ok: false,
      intent: 'resend_prompt',
      reason: 'no_resend_after_answer_evidence'
    }));
    expect(entry.decisionLedger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          decision: 'deny_recovery_intent',
          reason: 'no_resend_after_answer_evidence',
          source: 'manual_resend'
        })
      ])
    );
  });

  test('rehydrates open job state after MV3 service worker restart', async () => {
    const context = createSandbox();
    const savedState = {
      prompt: 'rehydrate prompt',
      attachments: [],
      responsesCollected: 0,
      session: {
        startTime: 1778621552999,
        totalModels: 1,
        completed: 0,
        failed: 0
      },
      llms: {
        Qwen: {
          tabId: 303,
          requestId: 'req-qwen',
          status: 'GENERATING',
          lastDispatchMeta: { dispatchId: 'dispatch-qwen' }
        }
      }
    };
    context.CompressedStorage.get.mockResolvedValueOnce(savedState);

    await context.loadJobState();

    expect(context.jobState.session.mv3RehydrationCount).toBe(1);
    expect(context.jobState.llms.Qwen.rehydratedAt).toEqual(expect.any(Number));
    expect(context.chrome.alarms.create).toHaveBeenCalledWith(
      'llm_orchestrator_mv3_survival_v1',
      expect.objectContaining({ periodInMinutes: 0.5 })
    );
  });

  test('quarantines stale response with mismatched run identity', () => {
    const context = createSandbox();
    const entry = context.jobState.llms.Perplexity;
    entry.recentDispatchIds = ['dispatch-pplx'];

    context.handleLLMResponse('Perplexity', 'stale answer '.repeat(40), null, {
      sessionId: 999,
      runSessionId: 999,
      dispatchId: 'dispatch-pplx'
    });

    expect(entry.finalStatusRecorded).toBeFalsy();
    expect(entry.lastRunIdentityDecision).toEqual(expect.objectContaining({
      ok: false,
      reason: 'stale_run_session'
    }));
    expect(entry.decisionLedger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          decision: 'ignore_stale_event',
          reason: 'stale_run_session'
        })
      ])
    );
    expect(context.updateModelState).not.toHaveBeenCalledWith(
      'Perplexity',
      'SUCCESS',
      expect.anything()
    );
  });

  test('does not let unproven preserved text block a real terminal failure', () => {
    const context = createSandbox();
    const entry = context.jobState.llms.Perplexity;
    entry.promptSubmittedAt = null;
    entry.confirmedDispatchId = null;
    entry.pendingFinalAnswer = 'Recovered answer text. '.repeat(80);
    const evidence = context.buildFinalizationEvidence('Perplexity', entry, {
      finalStatus: 'NO_SEND',
      finalReason: 'no_send',
      error: { type: 'no_send' },
      trimmedAnswer: 'Error: no_send',
      metaObj: { preTerminalMaterializeFinal: true },
      responseMeta: {}
    });
    expect(evidence.accepted).toBe(true);
    expect(evidence.hasPendingFinalAnswer).toBe(false);
    expect(evidence.contradictions).not.toContain('failure_with_answer_evidence_after_prefinal_recovery');
  });

  test('fresh preserved text still blocks a contradictory terminal failure', () => {
    const context = createSandbox();
    const entry = context.jobState.llms.Perplexity;
    entry.pendingFinalAnswer = 'Recovered answer text. '.repeat(80);
    entry.promptSubmittedAt = Date.now() - 1000;
    entry.submitSource = 'content';
    entry.confirmedDispatchId = entry.lastDispatchMeta.dispatchId;
    const evidence = context.buildFinalizationEvidence('Perplexity', entry, {
      finalStatus: 'NO_SEND',
      finalReason: 'no_send',
      error: { type: 'no_send' },
      trimmedAnswer: 'Error: no_send',
      metaObj: { preTerminalMaterializeFinal: true },
      responseMeta: {}
    });
    expect(evidence.accepted).toBe(false);
    expect(evidence.hasPendingFinalAnswer).toBe(true);
    expect(evidence.contradictions).toContain('failure_with_answer_evidence_after_prefinal_recovery');
  });
});
