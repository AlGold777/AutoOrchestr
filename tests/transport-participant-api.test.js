const fs = require('fs');
const path = require('path');
const vm = require('vm');

// R06: a Basic participant chat is never sent by the stateless API path. With the API mode on, the request stops
// before the send with an explicit code; the API mode of the user is not changed. Requests without a participant
// keep the API path of the other pipelines.
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const ORCHESTRATOR_SOURCE = read('background/job-orchestrator.js');

function createOrchestratorSandbox({ apiFeatureEnabled, useApiFallback = true, participants = {} }) {
  const context = {
    console: { log() {}, warn() {}, error: (...a) => { if (process.env.DBG_R06) process.stdout.write('ERR ' + String(a[1] && a[1].stack || a[1]) + '\n'); }, debug() {}, info() {} },
    Promise, Map, Set, Date, Math, Array, Object, Number, String, Boolean, JSON, Error, AbortController, URL,
    setTimeout, clearTimeout, setInterval, clearInterval,
    chrome: {
      storage: { local: {
        get: jest.fn(() => Promise.resolve({ feature_api_transport_enabled: apiFeatureEnabled })),
        set: jest.fn(() => Promise.resolve()),
        remove: jest.fn(() => Promise.resolve())
      } },
      tabs: { create: jest.fn(), get: jest.fn(), query: jest.fn() },
      runtime: { lastError: null, getURL: (file) => `chrome-extension://test/${file}` }
    },
    self: null,
    llmStartChains: Object.create(null),
    apiFallbackConfig: { Claude: { storageKey: 'claude_api_key' } },
    jobState: {
      session: { startTime: 1 },
      useApiFallback,
      llms: { Claude: { tabId: null, pipelineRunId: 'run-1', transportRequestId: 'req-A' } }
    },
    getActiveSessionId: () => 1,
    isSessionActive: () => true,
    isRateLimited: () => false,
    updateModelState: jest.fn(),
    ApiKeyStorage: {
      getSessionKey: jest.fn(() => Promise.resolve('sk-test')),
      getLegacyKey: jest.fn(() => Promise.resolve(null)),
      warnPlaintext: jest.fn()
    },
    openParticipantChat: jest.fn(() => Promise.resolve({ ok: true, tabId: 5 })),
    emitTelemetry: jest.fn(),
    broadcastGlobalState: jest.fn(),
    saveJobState: jest.fn(),
    // Globals of the other background modules that the response path calls (tab-manager, state-manager).
    closePingWindowForLLM: jest.fn(),
    extendPingWindowForLLM: jest.fn(),
    clearAdaptiveCollectTimer: jest.fn(),
    clearDeferredAnswerTimer: jest.fn(),
    clearPostSuccessScrollAudit: jest.fn(),
    clearClaudeRetryTimers: jest.fn(),
    clearBudgetPhases: jest.fn(),
    completeHumanPresenceForModel: jest.fn(),
    sendMessageToResultsTab: jest.fn(),
    appendLogEntry: jest.fn(),
    getLogSnapshot: jest.fn(() => []),
    TabMapManager: { get: jest.fn(() => null), entries: jest.fn(() => []), removeByName: jest.fn() },
    SUCCESS_STATUSES: ['DONE', 'SUCCESS', 'PARTIAL'],
    FAILURE_STATUSES: ['ERROR', 'CRITICAL_ERROR', 'UNRESPONSIVE', 'CIRCUIT_OPEN', 'API_FAILED', 'NO_SEND', 'EXTRACT_FAILED', 'STREAM_TIMEOUT', 'USER_ACTION_REQUIRED', 'UNCERTAIN'],
    TERMINAL_STATUSES: ['DONE', 'SUCCESS', 'PARTIAL', 'ERROR', 'CRITICAL_ERROR', 'UNRESPONSIVE', 'CIRCUIT_OPEN', 'API_FAILED', 'NO_SEND', 'EXTRACT_FAILED', 'STREAM_TIMEOUT', 'USER_ACTION_REQUIRED', 'UNCERTAIN']
  };
  context.self = context;
  vm.createContext(context);
  // The run's participants are set by startProcess; the test starts with them from the first line of the module.
  // handleLLMResponse runs the whole response path of the background; here it only records the call.
  const source = ORCHESTRATOR_SOURCE
    .replace('let activeParticipantRequests = {};', 'let activeParticipantRequests = self.__testParticipants || {};')
    .replace("function handleLLMResponse(llmName, answer, error = null, meta = null, answerHtml = '') {",
      "function handleLLMResponse(llmName, answer, error = null, meta = null, answerHtml = '') { self.__responses.push({ llmName, error }); return; }\n function __unusedResponsePath(llmName, answer, error = null, meta = null, answerHtml = '') {");
  expect(source).not.toBe(ORCHESTRATOR_SOURCE);
  context.__testParticipants = participants;
  context.__responses = [];
  vm.runInContext(source, context, { filename: 'background/job-orchestrator.js' });
  return context;
}

const PARTICIPANT = { Claude: { participantId: 'author-A', newChat: false, runId: 'run-1' } };

describe('participant chats do not use the stateless API path (R06)', () => {
  test('API mode on + participant continue: no stateless API call, explicit error, no tab work', async () => {
    const context = createOrchestratorSandbox({ apiFeatureEnabled: true, participants: PARTICIPANT });
    await context.startModelForLLM('Claude', 'hello', false, [], { sessionId: 1 });
    expect(context.ApiKeyStorage.getSessionKey).not.toHaveBeenCalled();
    expect(context.openParticipantChat).not.toHaveBeenCalled();
    expect(context.__responses).toEqual([expect.objectContaining({
      llmName: 'Claude',
      error: expect.objectContaining({ ok: false, errorCode: 'participant_api_unsupported' })
    })]);
    expect(context.updateModelState).toHaveBeenCalledWith('Claude', 'USER_ACTION_REQUIRED', expect.objectContaining({
      errorCode: 'participant_api_unsupported'
    }));
    expect(context.jobState.useApiFallback).toBe(true);
  });

  test('API mode on + participant new chat is refused the same way', async () => {
    const context = createOrchestratorSandbox({
      apiFeatureEnabled: true,
      participants: { Claude: { participantId: 'author-A', newChat: true } }
    });
    await context.startModelForLLM('Claude', 'hello', false, [], { sessionId: 1 });
    expect(context.ApiKeyStorage.getSessionKey).not.toHaveBeenCalled();
    expect(context.__responses).toEqual([expect.objectContaining({ error: expect.objectContaining({ errorCode: 'participant_api_unsupported' }) })]);
    expect(context.updateModelState).toHaveBeenCalledWith('Claude', 'USER_ACTION_REQUIRED', expect.objectContaining({ errorCode: 'participant_api_unsupported' }));
  });

  test('API mode off + participant: the request goes to the tab path, not to the API', async () => {
    const context = createOrchestratorSandbox({ apiFeatureEnabled: false, participants: PARTICIPANT });
    await context.startModelForLLM('Claude', 'hello', false, [], { sessionId: 1 });
    expect(context.ApiKeyStorage.getSessionKey).not.toHaveBeenCalled();
    expect(context.openParticipantChat).toHaveBeenCalledTimes(1);
    expect(context.__responses).toEqual([]);
    expect(context.updateModelState).not.toHaveBeenCalledWith('Claude', 'USER_ACTION_REQUIRED', expect.anything());
  });

  test('a request without a participant keeps the API path of the other pipelines', async () => {
    const context = createOrchestratorSandbox({ apiFeatureEnabled: true, participants: {} });
    await context.startModelForLLM('Claude', 'hello', false, [], { sessionId: 1 });
    expect(context.ApiKeyStorage.getSessionKey).toHaveBeenCalledTimes(1);
    expect(context.openParticipantChat).not.toHaveBeenCalled();
    expect(context.updateModelState).not.toHaveBeenCalledWith('Claude', 'USER_ACTION_REQUIRED', expect.anything());
  });


  test('a continue whose chat is lost ends the model with an explicit status and sends nothing', async () => {
    const context = createOrchestratorSandbox({ apiFeatureEnabled: false, participants: PARTICIPANT });
    context.openParticipantChat = jest.fn(() => Promise.resolve({
      ok: false,
      error: { ok: false, type: 'participant_chat_lost', errorCode: 'participant_chat_lost', message: 'lost', meta: { participantId: 'author-A', runId: 'run-1' } }
    }));
    await context.startModelForLLM('Claude', 'hello', false, [], { sessionId: 1 });
    expect(context.openParticipantChat).toHaveBeenCalledWith('Claude', expect.objectContaining({ participantId: 'author-A', runId: 'run-1', newChat: false }), 'hello', [], expect.anything());
    expect(context.__responses).toEqual([expect.objectContaining({ error: expect.objectContaining({ errorCode: 'participant_chat_lost' }) })]);
    expect(context.updateModelState).toHaveBeenCalledWith('Claude', 'USER_ACTION_REQUIRED', expect.objectContaining({ errorCode: 'participant_chat_lost' }));
  });
});
