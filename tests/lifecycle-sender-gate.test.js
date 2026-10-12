// Trust boundary between provider tabs (review finding P0, 2026-07-02):
// the content script runs in EVERY tab of a provider, including the user's own
// manual chats. Lifecycle messages (PROMPT_SUBMITTED, LLM_RESPONSE,
// LLM_RESPONSE_READY, ANSWER_SNAPSHOT) must only mutate a model's run state
// when they come from that model's bound tab.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const AnswerProofNormalization = require('../shared/answer-proof-normalization.js');

const MESSAGE_ROUTER_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'message-router.js'),
  'utf8'
);

function createRouterSandbox() {
  let onMessageListener = null;
  const telemetryEvents = [];
  const context = {
    console,
    isValidTabId: tabId => Number.isInteger(tabId) && tabId > 0,
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
    setTimeout,
    clearTimeout,
    TERMINAL_STATUSES: ['SUCCESS', 'PARTIAL', 'ERROR', 'NO_SEND', 'EXTRACT_FAILED', 'EXTERNAL_LLM_FAILURE', 'USER_ACTION_REQUIRED', 'UNCERTAIN'],
    jobState: {
      session: { startTime: 12345 },
      llms: {
        GPT: {
          status: 'GENERATING',
          tabId: 101,
          lastDispatchMeta: { dispatchId: 'GPT:12345:1' },
          recentDispatchIds: ['GPT:12345:1']
        }
      }
    },
    resultsTabId: 909,
    CompressedStorage: {
      get: jest.fn(() => Promise.resolve([])),
      set: jest.fn(() => Promise.resolve()),
      migrate: jest.fn(() => Promise.resolve()),
      pruneIfNeeded: jest.fn(() => Promise.resolve())
    },
    clearDiagnosticsRuntimeLogs: jest.fn(() => false),
    saveJobState: jest.fn(),
    loadJobState: jest.fn(() => Promise.resolve()),
    loadResolutionMetrics: jest.fn(() => Promise.resolve()),
    loadCircuitBreakerState: jest.fn(() => Promise.resolve()),
    startProcess: jest.fn(() => Promise.resolve()),
    stopAllProcesses: jest.fn(),
    writeDiagnosticsEventsToStorage: jest.fn(() => Promise.resolve()),
    handleLLMResponse: jest.fn(),
    recordPipelineAnswerVerification: jest.fn(),
    AnswerProofNormalization,
    validateMaterializedAnswerEvidence: jest.fn((_llmName, text) => ({
      valid: String(text || '').trim().length >= 80,
      rejectReason: String(text || '').trim().length >= 80 ? null : 'too_short',
      hash: 'lifecycle-hash'
    })),
    updateModelState: jest.fn(),
    resolvePromptSubmitted: jest.fn(),
    emitTelemetry: jest.fn((llmName, event, payload = {}) => telemetryEvents.push({ llmName, event, payload })),
    broadcastDiagnostic: jest.fn(),
    broadcastGlobalState: jest.fn(),
    broadcastHumanVisitStatus: jest.fn(),
    saveAnswerSnapshotFromContent: jest.fn(() => Promise.resolve({ status: 'snapshot_saved' })),
    TabMapManager: {
      load: jest.fn(() => Promise.resolve()),
      get: jest.fn((llmName) => (llmName === 'GPT' ? 101 : null)),
      getNameByTabId: jest.fn((tabId) => (tabId === 101 ? 'GPT' : null)),
      entries: jest.fn(() => []),
      removeByName: jest.fn()
    },
    activateTabForDispatch: jest.fn(),
    chrome: {
      runtime: {
        lastError: null,
        onMessage: { addListener: (fn) => { onMessageListener = fn; } },
        onStartup: { addListener: () => {} },
        onInstalled: { addListener: () => {} },
        getManifest: () => ({ version: 'test' })
      },
      storage: {
        local: {
          get: jest.fn((key, callback) => {
            if (typeof callback === 'function') callback({});
            return Promise.resolve({});
          }),
          set: jest.fn(() => Promise.resolve())
        },
        session: {
          get: jest.fn(() => Promise.resolve({})),
          set: jest.fn(() => Promise.resolve())
        },
        onChanged: { addListener: () => {} }
      },
      tabs: {
        onRemoved: { addListener: () => {} },
        onUpdated: { addListener: () => {} },
        onActivated: { addListener: () => {} },
        sendMessage: jest.fn(() => Promise.resolve()),
        update: jest.fn((tabId, _update, callback) => { if (typeof callback === 'function') callback(); }),
        query: jest.fn(() => Promise.resolve([]))
      },
      scripting: { executeScript: jest.fn(() => Promise.resolve([])) },
      windows: { onFocusChanged: { addListener: () => {} } },
      alarms: { create: () => {}, clear: () => {}, onAlarm: { addListener: () => {} } },
      action: { onClicked: { addListener: () => {} } }
    },
    self: null
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(MESSAGE_ROUTER_SOURCE, context, { filename: 'background/message-router.js' });
  return {
    context,
    telemetryEvents,
    sendMessage(message, sender) {
      return new Promise((resolve) => {
        const handled = onMessageListener(message, sender, resolve);
        if (handled !== true) resolve(undefined);
      });
    }
  };
}

const BOUND_SENDER = { tab: { id: 101 } };
const FOREIGN_SENDER = { tab: { id: 202 } };
const PAGE_SENDER = {}; // extension pages have no sender.tab
const RESULTS_SENDER = { tab: { id: 909 } };
const META = {
  dispatchId: 'GPT:12345:1',
  runSessionId: 12345,
  sessionId: 12345,
  terminalResult: {
    status: 'SUCCESS_TERMINAL',
    attemptId: 'GPT:12345:1',
    decidedAt: 12346,
    reason: 'all_terminal_facts_proven',
    evidenceRefs: [1, 2, 3, 4]
  }
};

const PPLX_META_1 = { dispatchId: 'Perplexity:12345:1', runSessionId: 12345, sessionId: 12345 };
const PPLX_CHAT_SENDER = {
  tab: { id: 303, url: 'https://www.perplexity.ai/search/test' },
  url: 'https://www.perplexity.ai/search/test',
  documentId: 'pplx-chat-doc',
  frameId: 0
};
const PPLX_PAYMENT_SENDER = {
  tab: { id: 303, url: 'https://www.perplexity.ai/pro/payment?plan=yearly&origin=fileUpload' },
  url: 'https://www.perplexity.ai/pro/payment?plan=yearly&origin=fileUpload',
  documentId: 'pplx-payment-doc',
  frameId: 0
};

function configurePerplexityHandshake(context, { deferProbe = false } = {}) {
  const transitions = [];
  let machineState = 'SUBMITTING';
  let releaseProbe = null;
  context.jobState.prompt = 'global prompt';
  context.jobState.attachments = [{ name: 'report.pdf', base64: 'data:application/pdf;base64,AA==' }];
  context.jobState.session.promptsByModel = { Perplexity: 'per-model prompt' };
  context.jobState.llms.Perplexity = {
    llmName: 'Perplexity',
    status: 'GENERATING',
    tabId: 303,
    dispatchAttempts: 1,
    lastDispatchMeta: { dispatchId: PPLX_META_1.dispatchId },
    recentDispatchIds: [PPLX_META_1.dispatchId],
    providerPipelineActive: true
  };
  context.TabMapManager.get.mockImplementation((name) => (name === 'GPT' ? 101 : (name === 'Perplexity' ? 303 : null)));
  context.TabMapManager.getNameByTabId.mockImplementation((tabId) => (tabId === 101 ? 'GPT' : (tabId === 303 ? 'Perplexity' : null)));
  const machine = {
    get state() { return machineState; },
    isInProgress: jest.fn(() => ['QUEUED', 'ACTIVATING', 'TYPING', 'SUBMITTING', 'WAITING', 'STREAMING'].includes(machineState)),
    is: jest.fn((state) => machineState === state),
    canQueue: jest.fn(() => machineState === 'IDLE'),
    error: jest.fn(() => {
      transitions.push([machineState, 'ERROR']);
      machineState = 'ERROR';
      return true;
    }),
    reset: jest.fn(() => {
      transitions.push([machineState, 'IDLE']);
      machineState = 'IDLE';
      return true;
    })
  };
  context.DISPATCH_STATES = { IDLE: 'IDLE', ERROR: 'ERROR', DONE: 'DONE' };
  context.DispatchStateManager = { get: jest.fn(() => machine) };
  context.ReadySignalManager = { handleReadySignal: jest.fn() };
  context.TransportPolicy = {
    resolvePromptForModel: jest.fn((map, name, fallback) => map?.[name] || fallback)
  };
  context.dispatchPromptToTab = jest.fn(async (_name, _tabId, prompt) => {
    expect(machineState).toBe('IDLE');
    expect(prompt).toBe('per-model prompt');
    const entry = context.jobState.llms.Perplexity;
    entry.dispatchAttempts += 1;
    const dispatchId = `Perplexity:12345:${entry.dispatchAttempts}`;
    entry.lastDispatchMeta = { dispatchId };
    return { ok: true, accepted: true, dispatchId };
  });
  context.chrome.tabs.sendMessage.mockImplementation((_tabId, message, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    if (message?.type !== 'PROVIDER_TRANSIENT_BLOCKER_RESUME_PROBE') {
      cb?.({ ok: true });
      return Promise.resolve({ ok: true });
    }
    const response = {
      ok: true,
      ready: true,
      composerReady: true,
      token: message.token,
      dispatchId: message.meta.dispatchId,
      tabSessionId: 'pplx-session-2'
    };
    if (deferProbe) {
      releaseProbe = () => cb?.(response);
    } else {
      cb?.(response);
    }
    return undefined;
  });
  return { machine, transitions, releaseProbe: () => releaseProbe?.() };
}

describe('lifecycle sender gate', () => {
  test('Completion authority ACK is immediate even while job-state persistence is blocked', async () => {
    const { context, telemetryEvents, sendMessage } = createRouterSandbox();
    context.saveJobState.mockImplementation(() => new Promise(() => {}));

    const response = await Promise.race([
      sendMessage({
        type: 'LLM_COMPLETION_ATTEMPT', llmName: 'GPT',
        meta: { ...META, terminalResult: null, rolloutMode: 'enforced' }
      }, BOUND_SENDER),
      new Promise((resolve) => setTimeout(() => resolve({ status: 'test_timeout' }), 50))
    ]);

    expect(response).toEqual(expect.objectContaining({ status: 'completion_attempt_recorded' }));
    expect(context.jobState.llms.GPT.completionAuthorityAttempt).toEqual(expect.objectContaining({
      dispatchId: META.dispatchId
    }));
    expect(telemetryEvents.some((event) => event.event === 'COMPLETION_ATTEMPT_ACCEPTED')).toBe(true);
  });

  test('submit timeout and DISPATCH_SEND evidence start on provider send action, not command delivery', async () => {
    const { context, telemetryEvents, sendMessage } = createRouterSandbox();
    context.armPromptSubmittedWaiter = jest.fn(() => true);
    context.jobState.llms.GPT.lastCommandAcceptedDispatchId = META.dispatchId;
    context.jobState.llms.GPT.lastCommandAcceptedAt = 12346;
    context.jobState.llms.GPT.lastCommandAcceptedTiming = { readyWaitMs: 42 };

    const response = await sendMessage({
      type: 'PROVIDER_DISPATCH_STAGE_OBSERVED',
      llmName: 'GPT',
      stage: 'send_action_requested',
      meta: META
    }, BOUND_SENDER);

    expect(response).toEqual(expect.objectContaining({ status: 'provider_dispatch_stage_ack' }));
    expect(context.armPromptSubmittedWaiter).toHaveBeenCalledWith('GPT', META.dispatchId);
    expect(telemetryEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'DISPATCH_SEND',
        payload: expect.objectContaining({
          meta: expect.objectContaining({ dispatchId: META.dispatchId, readyWaitMs: 42 })
        })
      })
    ]));
  });

  test('PROMPT_SUBMITTED from a foreign provider tab is rejected and does not confirm the dispatch', async () => {
    const { context, telemetryEvents, sendMessage } = createRouterSandbox();
    const response = await sendMessage({ type: 'PROMPT_SUBMITTED', llmName: 'GPT' }, FOREIGN_SENDER);

    expect(response?.status).toBe('prompt_submitted_rejected');
    expect(context.jobState.llms.GPT.promptSubmittedAt).toBeFalsy();
    expect(telemetryEvents.some((e) => e.event === 'SENDER_TAB_MISMATCH_REJECTED')).toBe(true);
  });

  test('PROMPT_SUBMITTED from the bound tab is accepted', async () => {
    const { context, sendMessage } = createRouterSandbox();
    const response = await sendMessage({ type: 'PROMPT_SUBMITTED', llmName: 'GPT', meta: META }, BOUND_SENDER);

    expect(response?.status).not.toBe('prompt_submitted_rejected');
    expect(context.jobState.llms.GPT.promptSubmittedAt).toBeTruthy();
  });

  test('Completion authority is recovered from persisted run state after worker memory loss', async () => {
    const { context, sendMessage } = createRouterSandbox();
    await sendMessage({
      type: 'LLM_COMPLETION_ATTEMPT', llmName: 'GPT',
      meta: { ...META, terminalResult: null, rolloutMode: 'enforced' }
    }, BOUND_SENDER);
    expect(context.jobState.llms.GPT.completionAuthorityAttempt).toEqual(expect.objectContaining({
      dispatchId: META.dispatchId
    }));

    context.__completionAuthorityAttempts.clear();
    const response = await sendMessage({
      type: 'LLM_RESPONSE', llmName: 'GPT', answer: 'restored authority answer',
      meta: { ...META, completionTerminalResult: META.terminalResult }
    }, BOUND_SENDER);
    expect(response).toEqual(expect.objectContaining({ status: 'response_handled' }));
    expect(context.CompletionAuthorityRegistry.get('GPT')).toEqual(expect.objectContaining({
      dispatchId: META.dispatchId
    }));
  });

  test('LLM_RESPONSE from a foreign tab never reaches handleLLMResponse', async () => {
    const { context, sendMessage } = createRouterSandbox();
    const rejected = await sendMessage({ type: 'LLM_RESPONSE', llmName: 'GPT', answer: 'stale text' }, FOREIGN_SENDER);
    expect(rejected?.status).toBe('response_rejected');
    expect(context.handleLLMResponse).not.toHaveBeenCalled();

    await sendMessage({
      type: 'LLM_COMPLETION_ATTEMPT', llmName: 'GPT',
      meta: { ...META, terminalResult: null, rolloutMode: 'enforced', protocolVersion: '2.1.0' }
    }, BOUND_SENDER);
    const acceptedMeta = { ...META, completionTerminalResult: META.terminalResult, completionRolloutMode: 'enforced' };
    const accepted = await sendMessage({ type: 'LLM_RESPONSE', llmName: 'GPT', answer: 'real text', meta: acceptedMeta }, BOUND_SENDER);
    expect(accepted?.status).toBe('response_handled');
    expect(context.handleLLMResponse).toHaveBeenCalledWith('GPT', 'real text', null, acceptedMeta, '');
  });

  test('registered authority admits an answer for downstream verification when terminal observation is missing', async () => {
    const { context, sendMessage } = createRouterSandbox();
    await sendMessage({
      type: 'LLM_COMPLETION_ATTEMPT', llmName: 'GPT',
      meta: { ...META, terminalResult: null, rolloutMode: 'enforced', protocolVersion: '2.1.0' }
    }, BOUND_SENDER);
    const response = await sendMessage({
      type: 'LLM_RESPONSE', llmName: 'GPT', answer: 'legacy fallback answer', meta: { ...META, terminalResult: null }
    }, BOUND_SENDER);
    expect(response).toEqual(expect.objectContaining({ status: 'response_handled' }));
    expect(context.handleLLMResponse).toHaveBeenCalled();
  });

  test('registered shadow attempt also defers terminal certainty to downstream verification', async () => {
    const { context, sendMessage } = createRouterSandbox();
    await sendMessage({
      type: 'LLM_COMPLETION_ATTEMPT', llmName: 'GPT',
      meta: { ...META, terminalResult: null, rolloutMode: 'shadow', protocolVersion: '2.1.0' }
    }, BOUND_SENDER);
    const response = await sendMessage({
      type: 'LLM_RESPONSE', llmName: 'GPT', answer: 'shadow legacy answer', meta: { ...META, terminalResult: null }
    }, BOUND_SENDER);
    expect(response).toEqual(expect.objectContaining({ status: 'response_handled' }));
    expect(context.handleLLMResponse).toHaveBeenCalled();
  });

  test('a late answer after observer timeout reaches verification with STALLED evidence preserved', async () => {
    const { context, sendMessage } = createRouterSandbox();
    await sendMessage({
      type: 'LLM_COMPLETION_ATTEMPT', llmName: 'GPT',
      meta: { ...META, terminalResult: { status: 'STALLED', reason: 'timeout_progress' }, rolloutMode: 'enforced', protocolVersion: '2.1.0' }
    }, BOUND_SENDER);
    const meta = { ...META, terminalResult: { status: 'STALLED', reason: 'timeout_progress' } };
    const response = await sendMessage({ type: 'LLM_RESPONSE', llmName: 'GPT', answer: 'late answer', meta }, BOUND_SENDER);
    expect(response).toEqual(expect.objectContaining({ status: 'response_handled' }));
    expect(context.handleLLMResponse).toHaveBeenCalledWith('GPT', 'late answer', null, meta, '');
    expect(context.CompletionAuthorityRegistry.get('GPT').terminalResult.status).toBe('STALLED');
  });

  test.each(['FAILED_TERMINAL', 'INTERRUPTED', 'CANCELLED'])('an explicit %s terminal still blocks answer delivery', async (status) => {
    const { context, sendMessage } = createRouterSandbox();
    await sendMessage({
      type: 'LLM_COMPLETION_ATTEMPT', llmName: 'GPT',
      meta: { ...META, terminalResult: null, rolloutMode: 'enforced', protocolVersion: '2.1.0' }
    }, BOUND_SENDER);
    const response = await sendMessage({
      type: 'LLM_RESPONSE', llmName: 'GPT', answer: 'failed terminal answer',
      meta: { ...META, terminalResult: { status } }
    }, BOUND_SENDER);
    expect(response).toEqual(expect.objectContaining({
      status: 'response_rejected',
      reason: 'completion_terminal_failed'
    }));
    expect(context.handleLLMResponse).not.toHaveBeenCalled();
  });

  test('legacy delivery requires an explicit per-attempt authorization', async () => {
    const { context, sendMessage } = createRouterSandbox();
    await sendMessage({
      type: 'LLM_COMPLETION_ATTEMPT', llmName: 'GPT',
      meta: { ...META, terminalResult: null, rolloutMode: 'shadow', legacyDeliveryAuthorized: true }
    }, BOUND_SENDER);
    const response = await sendMessage({
      type: 'LLM_RESPONSE', llmName: 'GPT', answer: 'authorized migration answer',
      meta: { ...META, terminalResult: null, completionRolloutMode: 'shadow' }
    }, BOUND_SENDER);
    expect(response?.status).toBe('response_handled');
    expect(context.handleLLMResponse).toHaveBeenCalled();
  });

  test('SCRIPT_READY repairs a stale Completion runtime before acknowledging the provider', async () => {
    const { context, sendMessage } = createRouterSandbox();
    const currentRuntime = {
      buildVersion: 'test', detectorVersion: '2.3.0', protocolVersion: require('../shared/completion-protocol').version, completionSessionAvailable: true
    };
    let probeCount = 0;
    context.chrome.scripting.executeScript.mockImplementation((request) => {
      if (request.files) return Promise.resolve([]);
      probeCount += 1;
      return Promise.resolve([{ result: probeCount === 1
        ? { ...currentRuntime, detectorVersion: '2.2.0' }
        : currentRuntime }]);
    });
    const response = await sendMessage({ type: 'SCRIPT_READY', llmName: 'GPT', meta: {} }, BOUND_SENDER);
    expect(response?.status).toBe('ready_deferred_completion_runtime');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(context.chrome.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({
      files: [
        'shared/completion-protocol.js',
        'content-utils/selector-resolver-v2.js',
        'content-utils/response-lifecycle-detector.js',
        'content-scripts/content-bootstrap.js'
      ]
    }));
    expect(context.chrome.tabs.sendMessage).toHaveBeenCalledWith(101, expect.objectContaining({
      type: 'REQUEST_SCRIPT_READY', reason: 'completion_runtime_verified'
    }));
  });

  test('SCRIPT_READY with the exact Completion runtime is acknowledged without reinjection', async () => {
    const { context, sendMessage } = createRouterSandbox();
    const response = await sendMessage({
      type: 'SCRIPT_READY',
      llmName: 'GPT',
      meta: {
        completionRuntime: {
          buildVersion: 'test',
          detectorVersion: '2.3.0',
          protocolVersion: require('../shared/completion-protocol').version,
          completionSessionAvailable: true
        }
      }
    }, BOUND_SENDER);
    // This isolated router sandbox has no ReadySignalManager, so acceptance
    // falls through to ready_ignored; the important contract is no defer/repair.
    expect(response?.status).toBe('ready_ignored');
    expect(context.chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  test('typed non-success terminal is forwarded immediately to finalization', async () => {
    const { context, sendMessage } = createRouterSandbox();
    await sendMessage({
      type: 'LLM_COMPLETION_ATTEMPT', llmName: 'GPT',
      meta: { ...META, terminalResult: null, rolloutMode: 'enforced', protocolVersion: '2.1.0' }
    }, BOUND_SENDER);
    const terminalResult = { ...META.terminalResult, status: 'CONTINUE_REQUIRED', reason: 'continue_required' };
    const response = await sendMessage({
      type: 'LLM_COMPLETION_TERMINAL', llmName: 'GPT', meta: { ...META, rolloutMode: 'enforced', terminalResult }
    }, BOUND_SENDER);
    expect(response).toEqual(expect.objectContaining({ status: 'completion_terminal_recorded', terminalStatus: 'CONTINUE_REQUIRED' }));
    expect(context.handleLLMResponse).toHaveBeenCalledWith(
      'GPT', '', expect.objectContaining({ type: 'continue_required' }),
      expect.objectContaining({ completionTerminalResult: terminalResult }), ''
    );
  });

  test('LLM_RESPONSE_READY from a foreign tab cannot set completion evidence', async () => {
    const { context, sendMessage } = createRouterSandbox();
    const rejected = await sendMessage({ type: 'LLM_RESPONSE_READY', llmName: 'GPT' }, FOREIGN_SENDER);
    expect(rejected?.status).toBe('response_ready_rejected');
    expect(context.jobState.llms.GPT.lifecycleReadyAt).toBeFalsy();

    await sendMessage({ type: 'LLM_RESPONSE_READY', llmName: 'GPT', meta: META }, BOUND_SENDER);
    expect(context.jobState.llms.GPT.lifecycleReadyAt).toBeTruthy();
  });

  test('LLM_RESPONSE_READY finalizes the exact validated lifecycle snapshot without a second DOM selection', async () => {
    const { context, telemetryEvents, sendMessage } = createRouterSandbox();
    const answerText = 'Lifecycle-confirmed answer. '.repeat(20);
    context.handleLLMResponse.mockImplementation(() => {
      context.jobState.llms.GPT.finalStatus = 'SUCCESS';
      context.jobState.llms.GPT.finalStatusRecorded = true;
    });

    await sendMessage({
      type: 'LLM_RESPONSE_READY',
      llmName: 'GPT',
      answerText,
      meta: { ...META, textLength: answerText.length, answerHash: 'content-hash', completedAt: 777 }
    }, BOUND_SENDER);

    expect(context.validateMaterializedAnswerEvidence).toHaveBeenCalledWith(
      'GPT',
      answerText.trim(),
      expect.objectContaining({ source: 'lifecycle_complete_snapshot', dispatchId: META.dispatchId })
    );
    expect(context.jobState.llms.GPT.lifecycleAnswerCandidate).toEqual(
      expect.objectContaining({ text: answerText.trim(), source: 'lifecycle_complete_snapshot' })
    );
    expect(context.handleLLMResponse).toHaveBeenCalledWith(
      'GPT',
      answerText.trim(),
      null,
      expect.objectContaining({
        lifecycleCompleteSnapshot: true,
        responseMeta: expect.objectContaining({ source: 'lifecycle_complete_snapshot' })
      }),
      ''
    );
    expect(telemetryEvents.some((event) => event.event === 'LIFECYCLE_SNAPSHOT_ACCEPTED')).toBe(true);
    expect(context.updateModelState).not.toHaveBeenCalledWith(
      'GPT',
      'RECEIVING',
      expect.anything()
    );
  });

  test('LLM_RESPONSE_READY records incoming structural proof before finalization', async () => {
    const { context, sendMessage } = createRouterSandbox();
    const answerText = 'Lifecycle answer with strict structural proof. '.repeat(6);
    const answerVerification = {
      verified: true,
      resolution: 'exact',
      structuralComplete: true,
      generationActive: false,
      runSessionId: 12345,
      dispatchId: 'GPT:12345:1',
      generationEpoch: 1,
      turnAnchor: 2
    };

    await sendMessage({
      type: 'LLM_RESPONSE_READY',
      llmName: 'GPT',
      answerText,
      meta: { ...META, answerVerification }
    }, BOUND_SENDER);

    expect(context.recordPipelineAnswerVerification).toHaveBeenCalledWith(
      'GPT', answerVerification, BOUND_SENDER
    );
    expect(context.handleLLMResponse).toHaveBeenCalledWith(
      'GPT',
      answerText.trim(),
      null,
      expect.objectContaining({
        responseMeta: expect.objectContaining({ answerVerification })
      }),
      ''
    );
  });

  test('LLM_RESPONSE_READY records source materialization and receiver acknowledgement with one payload identity', async () => {
    const { telemetryEvents, sendMessage } = createRouterSandbox();
    const answerText = 'Materialized current answer. '.repeat(12);
    await sendMessage({
      type: 'LLM_RESPONSE_READY',
      llmName: 'GPT',
      answerText,
      meta: { ...META, attemptId: 'ready-1' }
    }, BOUND_SENDER);

    const source = telemetryEvents.find((event) => event.event === 'ANSWER_SOURCE_MATERIALIZED');
    const delivery = telemetryEvents.find((event) => event.event === 'ANSWER_DELIVERY_ACKNOWLEDGED');
    const extraction = telemetryEvents.find((event) => event.event === 'ANSWER_EXTRACTION_COMPLETED');
    expect(source.payload.meta).toEqual(expect.objectContaining({
      sourceProofLevel: 'direct_preterminal',
      attemptId: 'ready-1',
      normalizationVersion: AnswerProofNormalization.VERSION,
      payloadEvidenceId: expect.any(String)
    }));
    expect(delivery.payload.meta.payloadEvidenceId).toBe(source.payload.meta.payloadEvidenceId);
    expect(extraction.payload.meta).toEqual(expect.objectContaining({
      attemptId: 'ready-1',
      accepted: true,
      answerIdentity: 'current_dispatch',
      extractedTextLength: answerText.trim().length,
      payloadEvidenceId: source.payload.meta.payloadEvidenceId
    }));
  });

  test('post-terminal LLM_RESPONSE_READY exports an explicit delivery rejection', async () => {
    const { context, telemetryEvents, sendMessage } = createRouterSandbox();
    context.jobState.llms.GPT.status = 'SUCCESS';
    context.jobState.llms.GPT.finalStatus = 'SUCCESS';
    context.jobState.llms.GPT.finalStatusRecorded = true;
    context.commitModelRunTransition = jest.fn(() => ({ ok: true, applied: true }));

    const response = await sendMessage({
      type: 'LLM_RESPONSE_READY',
      llmName: 'GPT',
      answerText: 'Late materialized answer. '.repeat(10),
      meta: { ...META, attemptId: 'late-1', payloadEvidenceId: 'payload:late-1' }
    }, BOUND_SENDER);

    expect(response.status).toBe('response_ready_ignored_terminal');
    expect(telemetryEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'ANSWER_DELIVERY_REJECTED',
        payload: expect.objectContaining({
          meta: expect.objectContaining({ reason: 'post_terminal_noise', attemptId: 'late-1' })
        })
      })
    ]));
  });

  test('only a current card marker ends visits, and all markers stop a main-page request', async () => {
    const { context, sendMessage } = createRouterSandbox();
    context.completeHumanPresenceForModel = jest.fn();
    context.clearDeferredAnswerTimer = jest.fn();
    context.jobState.session.selectedModels = ['GPT', 'Claude'];
    context.jobState.llms.GPT.transportRequestId = 'request-gpt';
    context.jobState.llms.Claude = { transportRequestId: 'request-claude' };
    const card = (llmName, transportRequestId, dispatchId) => ({
      type: 'ANSWER_CARD_RENDER_EVALUATED', llmName,
      meta: { transportRequestId, dispatchId, answerEndMarkerSeen: true, usableResult: true }
    });
    await sendMessage(card('GPT', 'old-request', META.dispatchId), RESULTS_SENDER);
    await sendMessage(card('GPT', 'request-gpt', META.dispatchId), FOREIGN_SENDER);
    expect(context.jobState.llms.GPT.cardAnswerComplete).toBeUndefined();
    await sendMessage(card('GPT', 'request-gpt', META.dispatchId), RESULTS_SENDER);
    expect(context.jobState.llms.GPT.cardAnswerComplete).toBe(true);
    expect(context.completeHumanPresenceForModel).toHaveBeenCalledWith('GPT', 'answer_card_end_marker');
    expect(context.stopAllProcesses).not.toHaveBeenCalled();
    await sendMessage(card('Claude', 'request-claude'), RESULTS_SENDER);
    expect(context.stopAllProcesses).toHaveBeenCalledWith('answer_cards_complete', { closeTabs: false, preserveResults: true });
  });

  test('a pipeline card marker does not cancel the next stage', async () => {
    const { context, sendMessage } = createRouterSandbox();
    context.completeHumanPresenceForModel = jest.fn();
    context.clearDeferredAnswerTimer = jest.fn();
    context.jobState.session.selectedModels = ['GPT'];
    context.jobState.session.pipelineRunId = 'pipeline-1';
    context.jobState.llms.GPT.transportRequestId = 'request-gpt';
    await sendMessage({ type: 'ANSWER_CARD_RENDER_EVALUATED', llmName: 'GPT', meta: {
      transportRequestId: 'request-gpt', dispatchId: META.dispatchId, answerEndMarkerSeen: true, usableResult: true
    } }, RESULTS_SENDER);
    expect(context.jobState.llms.GPT.cardAnswerComplete).toBe(true);
    expect(context.stopAllProcesses).not.toHaveBeenCalled();
  });

  test('accepts card render evidence only from the registered results tab', async () => {
    const { telemetryEvents, sendMessage } = createRouterSandbox();
    const message = {
      type: 'ANSWER_CARD_RENDER_EVALUATED',
      llmName: 'GPT',
      meta: {
        dispatchId: META.dispatchId,
        attemptId: 'render-1',
        expectedCardId: 'panel-gpt',
        observedCardId: 'panel-gpt',
        outcome: 'matched'
      }
    };
    expect((await sendMessage(message, RESULTS_SENDER)).ok).toBe(true);
    expect(telemetryEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'ANSWER_CARD_RENDER_EVALUATED',
        payload: expect.objectContaining({ meta: expect.objectContaining({ dispatchMatches: true }) })
      })
    ]));

    expect((await sendMessage(message, FOREIGN_SENDER)).reason).toBe('not_results_tab');
  });

  test('ANSWER_SNAPSHOT from a foreign tab is ignored', async () => {
    const { context, sendMessage } = createRouterSandbox();
    const rejected = await sendMessage({ type: 'ANSWER_SNAPSHOT', llmName: 'GPT', text: 'x'.repeat(200) }, FOREIGN_SENDER);
    expect(rejected?.status).toBe('snapshot_ignored');
    expect(context.saveAnswerSnapshotFromContent).not.toHaveBeenCalled();
  });

  test('non-tab senders still need current run correlation', async () => {
    const { context, sendMessage } = createRouterSandbox();
    const response = await sendMessage({ type: 'LLM_RESPONSE', llmName: 'GPT', answer: 'ui text', meta: META }, PAGE_SENDER);
    expect(response?.status).toBe('response_handled');
    expect(context.handleLLMResponse).toHaveBeenCalled();
  });

  test('models without an active binding reject provider-tab lifecycle events', async () => {
    const { context, sendMessage } = createRouterSandbox();
    context.jobState.llms.Claude = { status: 'GENERATING' };
    context.TabMapManager.get.mockImplementation(() => null);
    const response = await sendMessage({ type: 'LLM_RESPONSE', llmName: 'Claude', answer: 'text' }, { tab: { id: 303 } });
    expect(response?.status).toBe('response_rejected');
  });
});

describe('Perplexity transient blocker router handshake', () => {
  const blockerMessage = (type, token, phase, meta = PPLX_META_1) => ({
    type,
    llmName: 'Perplexity',
    blocker: 'file_upload_paywall',
    token,
    phase,
    meta
  });

  test('first START→CLEAR performs valid FSM cancellation and accepts exactly one resume dispatch', async () => {
    const { context, telemetryEvents, sendMessage } = createRouterSandbox();
    const { transitions } = configurePerplexityHandshake(context);
    const token = 'pplx-token-0001';

    expect(await sendMessage(blockerMessage('PROVIDER_TRANSIENT_BLOCKER_STARTED', token, 'armed'), PPLX_CHAT_SENDER))
      .toEqual(expect.objectContaining({ ok: true, status: 'blocker_armed' }));
    expect(await sendMessage(blockerMessage('PROVIDER_TRANSIENT_BLOCKER_STARTED', token, 'active'), PPLX_PAYMENT_SENDER))
      .toEqual(expect.objectContaining({ ok: true, status: 'blocker_started' }));

    const cleared = await sendMessage(
      blockerMessage('PROVIDER_TRANSIENT_BLOCKER_CLEARED', token, 'resume_ready'),
      PPLX_CHAT_SENDER
    );
    expect(cleared).toEqual(expect.objectContaining({
      ok: true,
      status: 'resume_accepted',
      dispatchId: 'Perplexity:12345:2',
      previousDispatchId: PPLX_META_1.dispatchId
    }));
    expect(transitions).toEqual([
      ['SUBMITTING', 'ERROR'],
      ['ERROR', 'IDLE']
    ]);
    expect(context.dispatchPromptToTab).toHaveBeenCalledTimes(1);
    expect(context.jobState.llms.Perplexity.perplexityPaywallResumeCount).toBe(1);
    expect(context.handleLLMResponse).not.toHaveBeenCalled();
    expect(telemetryEvents.some((event) => event.event === 'PROVIDER_TRANSIENT_BLOCKER_RESUME')).toBe(true);

    const duplicate = await sendMessage(
      blockerMessage('PROVIDER_TRANSIENT_BLOCKER_CLEARED', token, 'resume_ready'),
      PPLX_CHAT_SENDER
    );
    expect(duplicate).toEqual(expect.objectContaining({ ok: true, status: 'already_cleared' }));
    expect(context.dispatchPromptToTab).toHaveBeenCalledTimes(1);

    const secondToken = 'pplx-token-0002';
    const meta2 = { dispatchId: 'Perplexity:12345:2', runSessionId: 12345, sessionId: 12345 };
    await sendMessage(blockerMessage('PROVIDER_TRANSIENT_BLOCKER_STARTED', secondToken, 'armed', meta2), PPLX_CHAT_SENDER);
    await sendMessage(blockerMessage('PROVIDER_TRANSIENT_BLOCKER_STARTED', secondToken, 'active', meta2), PPLX_PAYMENT_SENDER);
    const repeated = await sendMessage(
      blockerMessage('PROVIDER_TRANSIENT_BLOCKER_CLEARED', secondToken, 'resume_ready', meta2),
      PPLX_CHAT_SENDER
    );
    expect(repeated).toEqual(expect.objectContaining({ ok: true, status: 'repeated_blocker_terminal' }));
    expect(context.dispatchPromptToTab).toHaveBeenCalledTimes(1);
    expect(context.handleLLMResponse).toHaveBeenCalledWith(
      'Perplexity',
      '',
      expect.objectContaining({
        type: 'attachment_unavailable',
        message: expect.stringContaining('repeated')
      }),
      expect.anything(),
      ''
    );
    expect(context.jobState.llms.Perplexity).toEqual(expect.objectContaining({
      transientBlocker: null,
      transientBlockerRunSessionId: null,
      transientBlockerDispatchId: null,
      transientBlockerTabId: null,
      providerPipelineActive: false
    }));
  });

  test('claims ACTIVE as PROBING before await so concurrent CLEAR cannot dispatch twice', async () => {
    const { context, sendMessage } = createRouterSandbox();
    const handshake = configurePerplexityHandshake(context, { deferProbe: true });
    const token = 'pplx-token-race';
    await sendMessage(blockerMessage('PROVIDER_TRANSIENT_BLOCKER_STARTED', token, 'armed'), PPLX_CHAT_SENDER);
    await sendMessage(blockerMessage('PROVIDER_TRANSIENT_BLOCKER_STARTED', token, 'active'), PPLX_PAYMENT_SENDER);

    const firstClear = sendMessage(
      blockerMessage('PROVIDER_TRANSIENT_BLOCKER_CLEARED', token, 'resume_ready'),
      PPLX_CHAT_SENDER
    );
    await Promise.resolve();
    expect(context.jobState.llms.Perplexity.transientBlocker.phase).toBe('PROBING');
    const concurrent = await sendMessage(
      blockerMessage('PROVIDER_TRANSIENT_BLOCKER_CLEARED', token, 'resume_ready'),
      PPLX_CHAT_SENDER
    );
    expect(concurrent).toEqual(expect.objectContaining({
      ok: false,
      reason: 'transient_blocker_resume_in_progress'
    }));
    expect(context.dispatchPromptToTab).not.toHaveBeenCalled();

    handshake.releaseProbe();
    expect(await firstClear).toEqual(expect.objectContaining({ ok: true, status: 'resume_accepted' }));
    expect(context.dispatchPromptToTab).toHaveBeenCalledTimes(1);
  });

  test('rejects stale CLEAR and quarantines original lifecycle while ACTIVE owns dispatch :1', async () => {
    const { context, sendMessage } = createRouterSandbox();
    configurePerplexityHandshake(context);
    const token = 'pplx-token-stale';
    await sendMessage(blockerMessage('PROVIDER_TRANSIENT_BLOCKER_STARTED', token, 'armed'), PPLX_CHAT_SENDER);
    await sendMessage(blockerMessage('PROVIDER_TRANSIENT_BLOCKER_STARTED', token, 'active'), PPLX_PAYMENT_SENDER);

    const pipelineState = await sendMessage({
      type: 'PROVIDER_DISPATCH_PIPELINE_STATE',
      llmName: 'Perplexity',
      active: false,
      meta: PPLX_META_1
    }, PPLX_CHAT_SENDER);
    expect(pipelineState).toEqual(expect.objectContaining({
      ok: true,
      status: 'pipeline_state_deferred_for_transient_blocker'
    }));
    expect(context.jobState.llms.Perplexity.providerPipelineActive).toBe(true);

    const response = await sendMessage({
      type: 'LLM_RESPONSE',
      llmName: 'Perplexity',
      answer: 'Error: provider navigation',
      error: { type: 'attachment_failed', message: 'provider navigation' },
      meta: PPLX_META_1
    }, PPLX_CHAT_SENDER);
    expect(response).toEqual(expect.objectContaining({
      status: 'response_deferred',
      reason: 'transient_blocker_active'
    }));
    expect(context.handleLLMResponse).not.toHaveBeenCalled();

    context.jobState.llms.Perplexity.lastDispatchMeta = { dispatchId: 'Perplexity:12345:99' };
    const staleClear = await sendMessage(
      blockerMessage('PROVIDER_TRANSIENT_BLOCKER_CLEARED', token, 'resume_ready'),
      PPLX_CHAT_SENDER
    );
    expect(staleClear).toEqual(expect.objectContaining({
      ok: false,
      reason: 'transient_blocker_not_active'
    }));
    expect(context.dispatchPromptToTab).not.toHaveBeenCalled();
  });
});

describe('main-page request startup', () => {
  test.each([true, false])('dispatches through the router with forceNewTabs=%s', async (forceNewTabs) => {
    const { context, sendMessage } = createRouterSandbox();
    context.getOrchestratorStopGeneration = jest.fn(() => 0);
    const response = await sendMessage({
      type: 'START_FULLPAGE_PROCESS', prompt: 'New request', selectedLLMs: ['GPT'],
      forceNewTabs, sourceView: 'main', useApiFallback: false
    }, RESULTS_SENDER);
    expect(response).toEqual({ status: 'process_started' });
    expect(context.getOrchestratorStopGeneration).toHaveBeenCalledTimes(2);
    expect(context.startProcess).toHaveBeenCalledWith('New request', ['GPT'], 909,
      expect.objectContaining({ forceNewTabs, sourceView: 'main' }));
  });

  test('Stop during startup still cancels the request before dispatch', async () => {
    const { context, sendMessage } = createRouterSandbox();
    await sendMessage({ type: 'ANSWER_CARD_RENDER_EVALUATED', llmName: 'GPT', meta: {} }, RESULTS_SENDER);
    let generation = 0;
    let releaseDiagnostics;
    let preparationStarted;
    const preparing = new Promise(resolve => { preparationStarted = resolve; });
    context.getOrchestratorStopGeneration = () => generation;
    context.ProofTelemetryLedger = { clear: () => new Promise(resolve => {
      releaseDiagnostics = resolve;
      preparationStarted();
    }) };
    const response = sendMessage({ type: 'START_FULLPAGE_PROCESS', prompt: 'Cancelled request',
      selectedLLMs: ['GPT'], sourceView: 'main', useApiFallback: false }, RESULTS_SENDER);
    await preparing;
    generation += 1;
    releaseDiagnostics();
    expect(await response).toEqual({ success: false, errorCode: 'RUN_CANCELLED' });
    expect(context.startProcess).not.toHaveBeenCalled();
  });
});

describe('tabs.create failure handling', () => {
  test('tab-manager handles lastError / undefined tab instead of throwing', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'background', 'tab-manager.js'), 'utf8');
    expect(src).toContain("if (chrome.runtime.lastError || !tab?.id) {");
    expect(src).toContain("'TAB_CREATE_FAILED'");
    expect(src).toContain("type: 'tab_create_failed'");
  });
});
