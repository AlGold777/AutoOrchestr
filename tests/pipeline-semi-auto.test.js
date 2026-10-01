// Semi-automatic pipeline: the moderator pulls answers with Get it and closes a
// running stage early with "next". Silent models are skipped for that stage only:
// not retried, not dropped from the run, and journaled apart from a timeout.
const fs = require('fs');
const path = require('path');
const Executor = require('../disput/debate-stage-executor');

const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

function loadPipelineWaiter() {
  const start = source.indexOf('const PIPELINE_TRANSPORT');
  const end = source.indexOf('let appendModeratorNoneNoteFromComposer');
  // eslint-disable-next-line no-new-func
  return new Function(`${source.slice(start, end)}; return pipelineWaiter;`)();
}

const ids = (models) => Object.fromEntries(models.map((model) => [model, `req-${model}`]));
const final = (llmName, answer, status) => ({
  llmName, answer, status, transportRequestId: `req-${llmName}`, metadata: { terminal: true }
});

describe('pipelineWaiter — moderator close', () => {
  test('closes an answered wait with collected answers and reports silent models as skipped', async () => {
    const waiter = loadPipelineWaiter();
    const promise = waiter.waitForModels(['A', 'B', 'C'], { timeoutMs: 60000, requestIds: ids(['A', 'B', 'C']) });
    waiter.handleFinal(final('A', 'answer A'));
    waiter.handleFinal(final('C', '', 'ERROR'));
    expect(waiter.openModels()).toEqual(['A', 'B', 'C']);
    expect(waiter.previewClose()).toEqual({ closable: 1, answeredModels: ['A'], partialModels: [], skipModels: ['B'] });
    expect(waiter.closeAnsweredBatches('moderator_closed')).toEqual({ closed: 1, stillWaiting: 0, skipped: ['B'] });
    const result = await promise;
    expect(result.timedOut).toBe(false);
    expect(result.closeReason).toBe('moderator_closed');
    expect(result.skipped).toEqual(['B']);
    expect(result.failed).toEqual({ C: 'ERROR' });
    expect(result.missing).toEqual(['B', 'C']);
    expect(waiter.openModels()).toEqual([]);
  });

  test('text shown without a final is adopted as an incomplete answer on close (field report 5)', async () => {
    const waiter = loadPipelineWaiter();
    const promise = waiter.waitForModels(['A', 'B', 'C'], { timeoutMs: 60000, requestIds: ids(['A', 'B', 'C']) });
    waiter.handleFinal(final('A', 'answer A'));
    // B: text arrived (e.g. from the global state) but no final; C: nothing.
    waiter.handlePartial({ llmName: 'B', answer: 'partial B', transportRequestId: 'req-B' });
    expect(waiter.previewClose()).toEqual({ closable: 1, answeredModels: ['A'], partialModels: ['B'], skipModels: ['C'] });
    waiter.closeAnsweredBatches('moderator_closed');
    const result = await promise;
    expect(result.responses).toEqual({ A: 'answer A', B: 'partial B' });
    expect(result.results.B).toMatchObject({ completion: 'partial', moderatorAccepted: true, attribution: 'unproven' });
    expect(result.adopted).toEqual(['B']);
    expect(result.skipped).toEqual(['C']);
    expect(result.missing).toEqual(['C']);
  });

  test('a wait with only unfinished text can be closed; a real final before the close wins', async () => {
    const waiter = loadPipelineWaiter();
    const promise = waiter.waitForModels(['A'], { timeoutMs: 60000, requestIds: ids(['A']) });
    waiter.handlePartial({ llmName: 'A', answer: 'draft', transportRequestId: 'req-A' });
    expect(waiter.previewClose().closable).toBe(1);
    waiter.handleFinal(final('A', 'complete answer'));
    const result = await promise;
    expect(result.responses.A).toBe('complete answer');
    expect(result).not.toHaveProperty('adopted');
  });

  test('a wait without any answer keeps waiting', () => {
    const waiter = loadPipelineWaiter();
    waiter.waitForModels(['A'], { timeoutMs: 60000, requestIds: ids(['A']) }).catch(() => {});
    expect(waiter.previewClose().closable).toBe(0);
    expect(waiter.closeAnsweredBatches()).toEqual({ closed: 0, stillWaiting: 1, skipped: [] });
    expect(waiter.waiting).toBe(true);
    waiter.reset();
  });

  test('normal settlement carries no skip fields', async () => {
    const waiter = loadPipelineWaiter();
    const promise = waiter.waitForModels(['A'], { timeoutMs: 60000, requestIds: ids(['A']) });
    waiter.handleFinal(final('A', 'ok'));
    const result = await promise;
    expect(result).not.toHaveProperty('skipped');
    expect(result).not.toHaveProperty('closeReason');
  });
});

describe('StageExecutor — skipped participant', () => {
  const run = async (batchResult) => {
    const calls = [];
    const events = [];
    const adapter = Executor.createLlmAdapter({
      runModelBatch: async (args) => { calls.push(args.models); return batchResult; }
    });
    const executor = Executor.createStageExecutor({
      adapters: Executor.createAdapterRegistry({ llm: adapter }),
      retryPolicy: { maxAttempts: 2, delayMs: 0 },
      emit: (type, payload) => events.push({ type, payload })
    });
    const summary = await executor.execute({
      runId: 'run-1', stageInstanceId: 'stage-1', purpose: 'p', dispatchMode: 'parallel', completionMode: 'all',
      participants: [{ participantId: 'A', model: 'A', type: 'llm' }, { participantId: 'B', model: 'B', type: 'llm' }]
    });
    return { summary, calls, events };
  };

  test('a skipped model is neither retried nor treated as a terminal dropout', async () => {
    const { summary, calls, events } = await run({
      responses: { A: 'answer A' }, results: {}, missing: ['B'], failed: {},
      timedOut: false, closeReason: 'moderator_closed', skipped: ['B']
    });
    expect(calls).toEqual([['A', 'B']]);
    expect(summary.executionStatus).toBe('partial');
    expect(summary.terminalFailures).toEqual([]);
    expect(summary.failedParticipants).toEqual(['B']);
    expect(events.find((e) => e.type === 'PARTICIPANT_SKIPPED')?.payload).toMatchObject({ participantId: 'B', reason: 'moderator_closed' });
  });

  test('without a moderator close a missing model is still retried', async () => {
    const { calls } = await run({ responses: { A: 'answer A' }, results: {}, missing: ['B'], failed: {}, timedOut: true });
    expect(calls).toEqual([['A', 'B'], ['B']]);
  });
});

test('pipeline page binds Get it and the next action to the shared routes', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');
  expect(html).toContain('id="pipeline-get-it-btn"');
  expect(source).toContain("bindGetItButton(pipelineGetItBtn, {");
  expect(source).toContain("pipelineWaiter.closeAnsweredBatches('moderator_closed')");
});

test('a template keeps the moderator\'s explicit Auto choice (semi-automatic run of a template)', () => {
  const from = source.indexOf('const applyPipelineConfig = (config = {}) => {');
  const block = source.slice(from, source.indexOf('debateRunPolicySelect.value = protocol.runPolicy;', from) + 80);
  expect(block).toContain('!debateRunPolicySelect.dataset.explicitOverride');
  // The template must no longer erase the explicit choice.
  const policyBlock = source.slice(from, source.indexOf('if (lengthSelect && protocol.length)', from));
  expect(policyBlock).not.toContain('delete debateRunPolicySelect.dataset.explicitOverride');
  // The compiled run policy reads that choice first.
  expect(source).toMatch(/debateRunPolicySelect\?\.dataset\.explicitOverride\s*\|\|\s*presetConfig\.runPolicy/);
});

test('the panel journals shown answers, run context and moderator actions', () => {
  expect(source).toContain("batchEvent?.('displayed', {");
  expect(source).toContain("source: 'global_state_hydrate'");
  expect(source).toContain('...getRunModeContext()');
  ['moderator_get_it', 'get_it_result', 'moderator_stage_close', 'moderator_close_refused', 'moderator_approve']
    .forEach((kind) => expect(source).toContain(`'${kind}'`));
  expect(source).toContain("context?.manualModeratorDispatch ? 'manual' : 'unscoped'");
});

describe('moderator-driven runs get no automatic page visits', () => {
  const vm = require('vm');
  const orch = fs.readFileSync(path.join(__dirname, '..', 'background', 'job-orchestrator.js'), 'utf8');
  const from = orch.indexOf('function isModeratorDrivenRun()');
  const gate = orch.slice(from, orch.indexOf('  const visitFn =', from)) + '  return \'would_visit\';\n}';
  const run = async (runMode) => {
    const c = {
      self: { isInitialPromptPassActive: () => false }, isValidTabId: () => true, emitTelemetry: jest.fn(),
      jobState: { session: { runMode } }
    };
    vm.createContext(c);
    vm.runInContext(gate, c);
    return { result: await vm.runInContext("runForcedAutomationVisits('GPT', 5, 1, {reason:'x'})", c), c };
  };

  test.each(['semi_auto', 'manual_dispatch'])('%s skips the visit and journals why', async (mode) => {
    const { result, c } = await run(mode);
    expect(result).toBe(false);
    expect(c.emitTelemetry).toHaveBeenCalledWith('GPT', 'FORCED_VISIT_SKIPPED', expect.objectContaining({ details: 'moderator_driven_run' }));
  });

  test.each(['auto', null])('%s still visits', async (mode) => {
    expect((await run(mode)).result).toBe('would_visit');
  });

  test('the panel sends the run mode and the background keeps it on the session', () => {
    expect(source).toContain('runMode: getRunModeContext().runMode');
    expect(orch).toContain("jobState.session.runMode = String(pipelineContext?.runMode || '') || null;");
  });
});
