/** @jest-environment node */
// Background dispatch hardening: start reservation, generation-aware run guard,
// focus queue failure propagation, durable intent, undelivered commands,
// open circuit, retry prompt and pre-dispatch reload.
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const coordinator = read('background/dispatch-coordinator.js');
const orchestrator = read('background/job-orchestrator.js');

describe('RunGuard', () => {
  require('../shared/transport-contract.js');
  const RunGuard = require('../shared/run-guard.js');
  const now = Date.now();

  test('active rounds block a new run', () => {
    expect(RunGuard.canStartNewRun({ roundsInProgress: true }, {}).ok).toBe(false);
  });

  test('a tab that still generates blocks a run reusing tabs', () => {
    const llms = { GPT: { promptSubmittedAt: now - 1000, finalStatusRecorded: false, status: 'GENERATING' } };
    expect(RunGuard.canStartNewRun({}, {}, llms)).toMatchObject({ ok: false, reason: 'model_still_generating', model: 'GPT' });
    expect(RunGuard.canStartNewRun({}, { forceNewTabs: true }, llms).ok).toBe(true);
  });

  test('finished, stopped, undispatched and stale entries do not block', () => {
    const llms = {
      A: { promptSubmittedAt: now - 1000, finalStatusRecorded: true },
      B: { promptSubmittedAt: now - 1000, status: 'STOPPED' },
      C: { promptSubmittedAt: 0 },
      D: { promptSubmittedAt: now - 60 * 60 * 1000 }
    };
    expect(RunGuard.canStartNewRun({}, {}, llms).ok).toBe(true);
  });
});

describe('focus queue', () => {
  function loadFocusLock() {
    const start = coordinator.indexOf('function withPromptDispatchFocusLock(fn) {');
    const end = coordinator.indexOf('function resolvePromptSubmitted(');
    // eslint-disable-next-line no-new-func
    return new Function(`let promptDispatchFocusMutex = Promise.resolve();\n${coordinator.slice(start, end)}\nreturn withPromptDispatchFocusLock;`)();
  }

  test('a failure reaches the caller and the queue continues', async () => {
    const lock = loadFocusLock();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(lock(async () => { throw new Error('focus failed'); })).rejects.toThrow('focus failed');
    await expect(lock(async () => 'next')).resolves.toBe('next');
    warn.mockRestore();
  });
});

describe('job state persistence', () => {
  function loadSaveJobState(persistResult) {
    const start = orchestrator.indexOf('let jobStateSaveFlight = null;');
    const end = orchestrator.indexOf('async function persistJobStateSnapshot(state) {');
    // eslint-disable-next-line no-new-func
    return new Function('persistJobStateSnapshot', `${orchestrator.slice(start, end)}\nreturn saveJobState;`)(
      async () => persistResult
    );
  }

  test('callers learn whether their snapshot is durable', async () => {
    await expect(loadSaveJobState(true)({})).resolves.toBe(true);
    await expect(loadSaveJobState(false)({})).resolves.toBe(false);
  });

  test('the snapshot writer reports failure instead of swallowing it', () => {
    const fn = orchestrator.slice(orchestrator.indexOf('async function persistJobStateSnapshot(state) {'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toContain('return true;');
    expect(body).toContain('return false;');
  });

  test('the command intent must be durable before the provider page is touched', () => {
    expect(coordinator).toContain('const intentPersisted = await saveJobState(jobState);');
    expect(coordinator).toContain("return { ok: false, reason: 'intent_not_persisted' };");
  });
});

describe('dispatch transaction', () => {
  test('an undelivered or unaccepted command settles the submit waiter', () => {
    expect(coordinator).toContain('const settleUndeliveredCommand = (result) => {');
    expect(coordinator).toContain('if (!commandAccepted) settleUndeliveredCommand(commandDeliveryResult);');
    expect(coordinator).toContain('if (!reportCommandDelivered(commandDeliveryResult)) settleUndeliveredCommand(commandDeliveryResult);');
    expect(coordinator).toContain("if (!commandDeliveryReported && !requireCommandAcceptance) {");
  });

  test('an open circuit records a retryable state instead of returning silently', () => {
    const block = coordinator.slice(coordinator.indexOf('if (!circuitState.ok) {'));
    const circuit = block.slice(0, block.indexOf("return { ok: false, deferred: true, reason: 'circuit_open' };"));
    expect(circuit).toContain("entry.lastDispatchError = { type: 'circuit_open'");
    expect(circuit).toContain('entry.retryAfterAt = Date.now()');
    expect(circuit).toContain('entry.dispatchAttempts = Math.max(1');
    expect(circuit).toContain('schedulePromptDispatchSupervisor();');
  });

  test('the retry supervisor resends the per-model prompt', () => {
    expect(coordinator).toContain("await dispatchPromptToTab(llmName, tabId, resolvePromptForDispatch(llmName, jobState.prompt), jobState.attachments || [], 'retry_supervisor', {");
    expect(coordinator).not.toContain("await dispatchPromptToTab(llmName, tabId, jobState.prompt,");
  });

  test('the pre-dispatch reload re-checks the dispatch state right before reloading', () => {
    const block = coordinator.slice(coordinator.indexOf('const reloadFlags = resolveDispatchFlags(llmName, entry);'));
    const beforeReload = block.slice(0, block.indexOf('chrome.tabs.reload(tabId'));
    expect(beforeReload).toContain('!reloadFlags.isSent');
    expect(beforeReload).toContain('!entry.promptSubmittedAt');
    expect(beforeReload).toContain("'PRE_DISPATCH_RELOAD_SKIPPED'");
  });
});

describe('start reservation', () => {
  test('the reservation is taken synchronously before the first await', () => {
    const fn = orchestrator.slice(orchestrator.indexOf('async function startProcess(prompt, selectedLLMs, resultsTab, options = {}) {'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    const reserveAt = body.indexOf('startProcessReserved = true;');
    expect(reserveAt).toBeGreaterThan(0);
    expect(body.slice(0, reserveAt)).not.toContain('await ');
    expect(body).toContain('finally {\n    startProcessReserved = false;');
  });

  test('later batches of the same pipeline run keep diagnostics and the proof ledger', () => {
    const router = read('background/message-router.js');
    expect(router).toContain('const continuesPipelineRun = Boolean(incomingPipelineRunId)');
    expect(router).toContain('if (!continuesPipelineRun) {');
  });
});

describe('cancellation is durable', () => {
  const vm = require('vm');
  function sandbox() {
    const c = {
      console,
      CompressedStorage: { set: jest.fn(async () => {}), remove: jest.fn(async () => {}) },
      updateMv3SurvivalAlarm: jest.fn()
    };
    c.self = c;
    c.PipelineFSM = { compactJobStateForStorage: jest.fn((state) => structuredClone(state)) };
    vm.createContext(c);
    vm.runInContext(`${orchestrator.slice(orchestrator.indexOf('let jobStateSaveFlight'), orchestrator.indexOf('async function loadJobState'))}
      this.saveJobState = saveJobState;
      this.stop = () => { jobStateStopGeneration += 1; };`, c);
    return c;
  }

  test('a snapshot queued before a stop is not written after it', async () => {
    const c = sandbox();
    const queued = c.saveJobState({ phase: 'running' });
    c.stop();
    await expect(queued).resolves.toBe(false);
    expect(c.CompressedStorage.set).not.toHaveBeenCalled();
  });

  test('a write in flight during a stop is undone', async () => {
    const c = sandbox();
    let release;
    c.CompressedStorage.set.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const inFlight = c.saveJobState({ phase: 'running' });
    await new Promise((resolve) => setImmediate(resolve));
    c.stop();
    release();
    await expect(inFlight).resolves.toBe(false);
    expect(c.CompressedStorage.remove).toHaveBeenCalledWith('jobState');
  });

  test('recovery never resumes a cancelled or stopped run', () => {
    const fn = orchestrator.slice(orchestrator.indexOf('function rehydrateActiveJobRuntime('));
    const guard = fn.slice(0, fn.indexOf('mv3RehydrationInFlight = true;'));
    expect(guard).toContain("controlState === 'CANCELLED' || controlState === 'STOPPED'");
    expect(orchestrator).toContain('jobStateStopGeneration += 1;');
  });
});

describe('provider tabs', () => {
  const contentUtils = read('content-scripts/content-utils.js');
  const gpt = read('content-scripts/content-chatgpt.js');
  const pipeline = read('content-scripts/unified-answer-pipeline.js');

  test('cancel stops the provider generation of a request in flight', () => {
    expect(contentUtils).toContain("if (message?.type !== 'STOP_AND_CLEANUP' || !hasActiveRequest()) return false;");
    expect(contentUtils).toContain("return { stopped: false, reason: 'stop_unconfirmed' };");
  });

  test('a GPT tab runs one injection at a time and refuses a different prompt', () => {
    expect(gpt).toContain('if (gptSharedInjection && fp === gptSharedFingerprint) {');
    expect(gpt).toContain("type: 'concurrent_request',");
    expect(gpt).not.toContain('Date.now() - gptSharedStartedAt < 15000');
  });

  test('run state is not mirrored into the provider site storage', () => {
    expect(pipeline).not.toContain('window.localStorage.setItem');
    expect(pipeline).toContain('.forEach((key) => storage.removeItem(key));');
  });

  test('long answers are not cut at 50 000 characters', () => {
    ['chatgpt', 'claude', 'gemini', 'grok', 'deepseek', 'qwen', 'lechat', 'perplexity'].forEach((name) => {
      expect(read(`content-scripts/content-${name}.js`)).not.toContain('maxLength: 50000');
    });
  });

  test('only a named health PONG proves the model receiver is ready', () => {
    expect(coordinator).toContain("response?.type === 'HEALTH_CHECK_PONG' && response.llmName === llmName");
  });
});
