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

describe('an unfinished run does not take the Run button after a reload', () => {
  test('page load drops the recovered run instead of adopting it as a technical pause', () => {
    const from = source.indexOf('debateTransportPort?.recoverRun?.()');
    const block = source.slice(from, source.indexOf("Debate run recovery failed", from));
    expect(block).toContain('debateTransportPort?.clearRecovery?.()');
    expect(block).not.toContain('page_runtime_recovered');
    expect(block).not.toContain('debatePaused = true');
    expect(block).not.toContain('debateAggregateStore.replace(recovered)');
  });

  test('the transport port can clear the stored run', () => {
    const transport = fs.readFileSync(path.join(__dirname, '..', 'results', 'debate-transport.js'), 'utf8');
    expect(transport).toContain('clearRecovery()');
  });
});

describe('Run button and New pages (field report)', () => {
  test('pressing a composer button keeps the focus in the input, so a shrinking input cannot move the button away', () => {
    expect(source).toContain("debateRunToggleBtn?.closest('.msg-header')?.addEventListener('mousedown', (event) => {");
    expect(source).toContain("if (event.target.closest?.('button')) event.preventDefault();");
    const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'modals-responsive.css'), 'utf8');
    // The cause: the compact input shrinks on blur.
    expect(css).toContain('textarea#modTa:not(:focus)');
  });

  test('New pages is switched off when the run starts, not only after the first dispatch is acknowledged', () => {
    const from = source.indexOf('ownerAnswers: []\n            };');
    expect(source.slice(from, from + 500)).toContain('if (activePipelineRunContext.forceNewTabs) resetNewPagesCheckboxAfterOpen();');
  });
});

describe('Run button ignores a phantom run state', () => {
  test('with no run on the page (none started, no engine) the aggregate status cannot turn Run into pause/resume/approve', () => {
    expect(source).toContain('const hasLiveRun = pipelineRunActive || (Boolean(engineState) && !engineIdle);');
    expect(source).toContain("const phantom = !hasLiveRun && aggregate && String(aggregate.status || 'idle') !== 'idle';");
    expect(source).toContain('approvalWaiting: hasLiveRun && debateExecutionContext?.hasApprovalWaiter?.() === true');
    expect(source).toContain("'ui_phantom_state'");
  });
});

describe('no model is pre-selected', () => {
  const Presets = require('../disput/pipeline-presets');

  test('built-in templates store no models, so choosing one selects nothing for the moderator', () => {
    Presets.BUILTIN_PIPELINE_DEFINITIONS.forEach((definition) => expect(definition.defaultModelCount).toBe(0));
  });

  test('applying a template without stored models does not clear the moderator\'s own selection', () => {
    expect(source).toContain('if (isPipelinePage && Array.isArray(protocol.selectedModels) && protocol.selectedModels.length) {');
  });
});

describe('the moderator input is emptied once the message is sent', () => {
  test('the Run path clears it when the run starts and puts the text back if the run cannot start', () => {
    const start = source.indexOf('const startDebateFromPage = async () => {');
    const block = source.slice(start, start + 9000);
    expect(block).toContain('clearModeratorComposer();');
    expect(block.indexOf('clearModeratorComposer();')).toBeGreaterThan(block.indexOf('ownerAnswers: []'));
    expect(source).toContain('function restoreModeratorComposer(text) {');
    expect((source.match(/restoreModeratorComposer\(moderatorEntryText\)/g) || []).length).toBe(2);
    // The manual moderator dispatch already clears its input.
    expect(source.slice(source.indexOf('const startManualModeratorDispatch'), source.indexOf('const getDisputeTemplateApi'))).toContain('clearModeratorComposer();');
  });

  test('restore never overwrites text the moderator has typed since', () => {
    expect(source).toContain("String(promptInput.value || '').trim()) return;");
  });
});

describe('a stage does not hang on a model whose text has stopped (Auto)', () => {
  const STALL = 180000;
  const partial = (llmName, answer) => ({ llmName, answer, transportRequestId: `req-${llmName}` });

  test('text that has not changed for the stall time closes the wait with it; the others are untouched', async () => {
    const waiter = loadPipelineWaiter();
    const promise = waiter.waitForModels(['A', 'B'], { timeoutMs: 60000000, requestIds: ids(['A', 'B']) });
    waiter.handleFinal(final('A', 'answer A'));
    waiter.handlePartial(partial('B', 'draft of B that stopped growing'));
    const t0 = Date.now();
    expect(waiter.adoptStalled(t0 + STALL - 1000, STALL)).toEqual([]); // not long enough
    expect(waiter.adoptStalled(t0 + STALL + 1000, STALL)).toEqual(['B']);
    const result = await promise;
    expect(result.responses).toEqual({ A: 'answer A', B: 'draft of B that stopped growing' });
    expect(result.closeReason).toBe('stalled_with_text');
    expect(result.results.B).toMatchObject({ completion: 'partial', moderatorAccepted: true });
    waiter.reset();
  });

  test('growing text keeps the clock running, so a model still writing is never cut', async () => {
    const waiter = loadPipelineWaiter();
    waiter.waitForModels(['A'], { timeoutMs: 60000000, requestIds: ids(['A']) }).catch(() => {});
    waiter.handlePartial(partial('A', 'one'));
    const t0 = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 20));
    waiter.handlePartial(partial('A', 'one two'));
    expect(waiter.adoptStalled(t0 + STALL + 5, STALL)).toEqual([]); // changed 20 ms after t0
    waiter.reset();
  });

  test('a model with no text at all (still thinking) is never cut, even when another is stalled', () => {
    const waiter = loadPipelineWaiter();
    waiter.waitForModels(['A', 'B'], { timeoutMs: 60000000, requestIds: ids(['A', 'B']) }).catch(() => {});
    waiter.handlePartial(partial('A', 'draft'));
    expect(waiter.adoptStalled(Date.now() + STALL * 10, STALL)).toEqual([]);
    waiter.reset();
  });

  test('the page enables it for Auto only and journals it', () => {
    expect(source).toContain('pipelineWaiter.autoAdopt = () => isDebateAutoPolicy();');
    expect(source).toContain("'stall_adopted'");
    expect(source).toContain('if (!this.autoAdopt?.()) return;');
  });
});
