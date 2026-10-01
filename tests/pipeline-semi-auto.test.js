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
    expect(waiter.previewClose()).toEqual({ closable: 1, answeredModels: ['A'], skipModels: ['B'] });
    expect(waiter.closeAnsweredBatches('moderator_closed')).toEqual({ closed: 1, stillWaiting: 0, skipped: ['B'] });
    const result = await promise;
    expect(result.timedOut).toBe(false);
    expect(result.closeReason).toBe('moderator_closed');
    expect(result.skipped).toEqual(['B']);
    expect(result.failed).toEqual({ C: 'ERROR' });
    expect(result.missing).toEqual(['B', 'C']);
    expect(waiter.openModels()).toEqual([]);
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
