// Automation on the existing engine: control markers, pauses after stages / at gates /
// on a failed stage / on a question for the owner, owner answers reaching the next prompt.
const fs = require('fs');
const path = require('path');
const Markers = require('../disput/stage-markers');
const OwnerAsk = require('../results/owner-ask');
const Application = require('../disput/debate-application');
const DraftPlan = require('../disput/debate-draft-plan');
const Compiler = require('../disput/debate-prompt-compiler');
const Contracts = require('../disput/debate-contracts');
const Framework = require('../disput/architecture-framework');

const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

describe('stage markers', () => {
  test('ASK and VERDICT are read from lines of their own, with light decoration', () => {
    const text = [
      'Анализ.', '', '- [[ASK: Какой бюджет?]]', '**[[ASK: Кто владелец данных?]]**',
      '[[verdict: ISSUES_FOUND]]', '[[AO-abc123]]'
    ].join('\n');
    expect(Markers.parse(text)).toEqual({ verdict: 'issues_found', asks: ['Какой бюджет?', 'Кто владелец данных?'], invalid: [] });
  });

  test('markers inside code fences, quotes or running text are data, not control', () => {
    const text = [
      'Правило: пиши [[ASK: вопрос]] отдельной строкой.',
      '> [[ASK: цитата]]', '```', '[[VERDICT: pass]]', '[[ASK: в коде]]', '```'
    ].join('\n');
    expect(Markers.parse(text)).toEqual({ verdict: null, asks: [], invalid: [] });
  });

  test('duplicates collapse, at most 3 questions, empty questions are ignored, bad verdicts are reported', () => {
    const text = ['[[ASK: Q1]]', '[[ask: q1]]', '[[ASK: ]]', '[[ASK: Q2]]', '[[ASK: Q3]]', '[[ASK: Q4]]', '[[VERDICT: maybe]]'].join('\n');
    const parsed = Markers.parse(text);
    expect(parsed.asks).toEqual(['Q1', 'Q2', 'Q3']);
    expect(parsed.verdict).toBeNull();
    expect(parsed.invalid).toEqual([{ kind: 'VERDICT', value: 'maybe' }]);
    expect(Markers.parse('[[VERDICT: pass]]\n[[VERDICT: issues_found]]').verdict).toBe('issues_found'); // the last valid one
    expect(Markers.parse(null)).toEqual({ verdict: null, asks: [], invalid: [] });
  });

  test('instructions: ASK for every stage, VERDICT only for review stages', () => {
    expect(Markers.instructions({ purpose: 'position' })).toContain('[[ASK: вопрос]]');
    expect(Markers.instructions({ purpose: 'position' })).not.toContain('VERDICT');
    ['critique', 'verification', 'evidence_review'].forEach((purpose) => expect(Markers.instructions({ purpose })).toContain('[[VERDICT: pass]]'));
  });

  test('combining several participants: any issues_found wins', () => {
    expect(Markers.combineVerdicts(['pass', 'issues_found', null])).toBe('issues_found');
    expect(Markers.combineVerdicts(['pass', null])).toBe('pass');
    expect(Markers.combineVerdicts([null])).toBeNull();
  });
});

describe('owner ask dialog helpers', () => {
  const asks = [{ participantId: 'GPT', question: 'Какой бюджет?' }, { participantId: 'Claude', question: 'Кто владелец?' }];

  test('render writes text only; collect keeps answered questions; instruction names question and answer', () => {
    const container = document.createElement('div');
    OwnerAsk.render(container, [{ participantId: 'GPT', question: '<img src=x onerror=1>?' }]);
    expect(container.querySelector('img')).toBeNull();
    container.replaceChildren();
    OwnerAsk.render(container, asks);
    const fields = container.querySelectorAll('textarea');
    expect(fields).toHaveLength(2);
    fields[1].value = '  Отдел данных  ';
    const answers = OwnerAsk.collect(container, asks);
    expect(answers).toEqual([{ question: 'Кто владелец?', answer: 'Отдел данных', participantId: 'Claude' }]);
    expect(OwnerAsk.toInstruction(answers)).toBe('Ответ владельца на вопрос «Кто владелец?»: Отдел данных');
  });

  test('the owner answer reaches the next stage prompt as the current human instruction', () => {
    const base = Contracts.createTaskContract({ objective: 'Система учёта заказов', maxWords: 300 });
    // Same rebuild as withOwnerAnswers in results.js.
    const task = { ...base, contractKind: 'raw', currentInstruction: [base.currentInstruction, OwnerAsk.toInstruction([{ question: 'Бюджет?', answer: '5 млн' }])].filter(Boolean).join('\n') };
    const compiled = Compiler.compile({ task, stage: { stageId: 's', operation: 'opening', role: 'participant', expectedArtifactTypes: [] }, model: 'GPT' });
    expect(compiled.prompt).toContain('Текущее указание человека: Ответ владельца на вопрос «Бюджет?»: 5 млн');
    expect(compiled.prompt).toContain('Система учёта заказов');
    expect(source).toContain("return { ...task, contractKind: 'raw', currentInstruction:");
  });
});

// ---------------------------------------------------------------- real engine
const runEngine = async ({ mode, answerFor, gateAfterRound = 0, rounds = 3, hooks = {} }) => {
  const plan = DraftPlan.createCanvasPlan({
    rounds: Array.from({ length: rounds }, (_, i) => ({
      plannedStageId: `canvas-r${i + 1}`, purpose: i === 0 ? 'position' : 'response', participantIds: ['A', 'B'],
      meta: gateAfterRound === i + 1 ? { gateAfter: 'G1' } : undefined
    }))
  });
  const calls = [];
  const app = Application.createApplication({
    universalEngine: true, allowIncompleteWiring: true, exposeInternals: true,
    deps: {
      runModelBatch: async ({ models, context }) => {
        calls.push({ stage: context.pipelineStageId, models: models.slice() });
        const responses = {};
        models.forEach((model) => { const answer = answerFor(model, calls.length, context.pipelineStageId); if (answer) responses[model] = answer; });
        return { responses, results: {}, failed: {} };
      },
      proposeStateDelta: ({ participant }) => ({ by: participant.participantId }),
      ...hooks
    }
  });
  const started = await app.start({
    runId: `run-${Math.random().toString(36).slice(2, 8)}`, topic: 't', models: ['A', 'B'], draftPlan: plan,
    policies: { finalization: { mode: 'manual' }, stagePause: { mode } }, maxSteps: 30
  });
  return { app, started, calls, orchestrator: app.getOrchestrator() };
};
const snapshot = (orchestrator) => {
  const state = orchestrator.getState();
  return `${state.lifecycle}/${state.pauseInfo?.reason || '-'}/${state.stages.filter((stage) => stage.status === 'completed').length}`;
};
const continueUntilIdle = async (orchestrator, limit = 8) => {
  const trail = [snapshot(orchestrator)];
  for (let i = 0; i < limit && orchestrator.getState().lifecycle === 'PAUSED'; i += 1) {
    await orchestrator.requestContinue({});
    trail.push(snapshot(orchestrator));
  }
  return trail;
};

describe('stage pause policy on the real engine', () => {
  const ok = (model) => `answer ${model}`;

  test('never: all stages run in one go (unchanged behaviour)', async () => {
    const { orchestrator, calls } = await runEngine({ mode: 'never', answerFor: ok });
    expect(snapshot(orchestrator)).toBe('RUNNING/-/3');
    expect(calls).toHaveLength(3);
  });

  test('every_stage (semi-automatic): one stage, then a pause; Continue runs the next', async () => {
    const { orchestrator } = await runEngine({ mode: 'every_stage', answerFor: ok });
    expect(await continueUntilIdle(orchestrator)).toEqual([
      'PAUSED/stage_done/1', 'PAUSED/stage_done/2', 'PAUSED/stage_done/3', 'RUNNING/-/3'
    ]);
  });

  test('gates (auto): only after a stage followed by a template gate', async () => {
    const { orchestrator } = await runEngine({ mode: 'gates', answerFor: ok, gateAfterRound: 2 });
    expect(await continueUntilIdle(orchestrator)).toEqual(['PAUSED/gate/2', 'RUNNING/-/3']);
    expect(orchestrator.getState().pauseInfo).toBeNull();
    const none = await runEngine({ mode: 'gates', answerFor: ok });
    expect(snapshot(none.orchestrator)).toBe('RUNNING/-/3');
  });

  test('a stage nobody answered stops the run instead of being re-queued until the budget burns', async () => {
    const { orchestrator, calls } = await runEngine({ mode: 'never', answerFor: () => '' });
    const first = orchestrator.getState();
    expect(first.lifecycle).toBe('PAUSED');
    expect(first.pauseInfo).toMatchObject({ reason: 'stage_failed', plannedStageId: 'canvas-r1' });
    const afterFirst = calls.length;
    expect(afterFirst).toBeLessThanOrEqual(6); // one stage attempt: batch + one retry per model
    await orchestrator.requestContinue({});
    expect(calls.length - afterFirst).toBeLessThanOrEqual(6); // Continue = one more attempt, not a loop
    expect(orchestrator.getState().lifecycle).toBe('PAUSED');
  });

  test('a stage where one model answered is done (the silent one is retried inside the stage)', async () => {
    const { orchestrator } = await runEngine({ mode: 'never', answerFor: (model) => (model === 'B' ? '' : 'answer A') });
    expect(snapshot(orchestrator)).toBe('RUNNING/-/3');
  });
});

describe('ASK marker pauses the run and hands the question out', () => {
  test('the stage keeps asks and verdict; Continue goes on', async () => {
    const answer = (model, call) => (model === 'A' && call === 1
      ? 'Анализ.\n[[ASK: Какой бюджет?]]\n[[VERDICT: issues_found]]'
      : `answer ${model}\n[[VERDICT: pass]]`);
    const { orchestrator } = await runEngine({ mode: 'never', answerFor: answer });
    const state = orchestrator.getState();
    expect(state.lifecycle).toBe('PAUSED');
    expect(state.pauseInfo).toMatchObject({ reason: 'ask', plannedStageId: 'canvas-r1', verdict: 'issues_found', asks: [{ participantId: 'A', question: 'Какой бюджет?' }] });
    expect(state.stages[0]).toMatchObject({ asks: [{ participantId: 'A', question: 'Какой бюджет?' }], verdict: 'issues_found' });
    await orchestrator.requestContinue({});
    expect(snapshot(orchestrator)).toBe('RUNNING/-/3');
  });

  test('the application tells the page: aggregate paused + onEnginePause', async () => {
    const seen = [];
    const { app } = await runEngine({
      mode: 'every_stage', answerFor: (model) => `answer ${model}`,
      hooks: { onEnginePause: (info) => seen.push(info) }
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ reason: 'stage_done', plannedStageId: 'canvas-r1', by: 'engine' });
    expect(app.getState().status).toBe('paused');
    expect(app.getState().pauseReason).toBe('stage_done');
  });
});

describe('template wiring', () => {
  test('gates of the framework stop the run in Auto: the stage before a gate carries gateAfter', () => {
    expect(Framework.STAGES.filter((stage) => stage.gateAfter).map((stage) => [stage.n, stage.gateAfter]))
      .toEqual([[12, 'G1'], [16, 'G2'], [21, 'G3'], [29, 'G4']]);
  });

  test('the page derives the pause policy from the run mode and handles every pause reason', () => {
    expect(source).toContain("stagePause: { mode: compiledRunPolicy === 'auto' ? 'gates' : 'every_stage' }");
    expect(source).toContain('onEnginePause: (info) => handleEnginePause(info)');
    ['ask', 'gate', 'stage_failed'].forEach((reason) => expect(source).toContain(`info.reason === '${reason}'`));
    expect(source).toContain('window.DebateStageMarkers.instructions({ purpose: stage.purpose })');
    const html = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');
    expect(html.indexOf('disput/stage-markers.js')).toBeLessThan(html.indexOf('disput/debate-stage-executor.js'));
    expect(html).toContain('id="owner-ask-dialog"');
    expect(html.indexOf('results/owner-ask.js')).toBeLessThan(html.indexOf('<script src="results.js">'));
  });
});

describe('a participant that dropped out does not freeze the run (field report 9)', () => {
  const runDropout = async (assignments) => {
    const plan = DraftPlan.createCanvasPlan({
      rounds: assignments.map((participantIds, i) => ({ plannedStageId: `canvas-r${i + 1}`, purpose: i === 0 ? 'position' : 'response', participantIds }))
    });
    const calls = [];
    const paused = [];
    const app = Application.createApplication({
      universalEngine: true, allowIncompleteWiring: true, exposeInternals: true,
      deps: {
        runModelBatch: async ({ models, context }) => {
          calls.push({ stage: context.pipelineStageId.split('-').pop(), models: models.slice() });
          const responses = {};
          const failed = {};
          models.forEach((model) => { if (model === 'B') failed.B = 'NO_SEND'; else responses[model] = `answer ${model}`; });
          return { responses, results: {}, failed };
        },
        proposeStateDelta: ({ participant }) => ({ by: participant.participantId }),
        onEnginePause: (info) => paused.push(info)
      }
    });
    await app.start({
      runId: 'run-dropout', topic: 't', models: ['A', 'B'], draftPlan: plan,
      policies: { finalization: { mode: 'manual' }, stagePause: { mode: 'never' } }, maxSteps: 20
    });
    return { calls, paused, orchestrator: app.getOrchestrator() };
  };

  test('the next stage goes on with the participants that are left', async () => {
    const { calls, orchestrator } = await runDropout([['A', 'B'], ['A', 'B']]);
    expect(calls.map((call) => call.models)).toEqual([['A', 'B'], ['A']]);
    expect(orchestrator.getState().stages.filter((stage) => stage.status === 'completed')).toHaveLength(2);
    expect(orchestrator.getState().lifecycle).toBe('RUNNING');
  });

  test('when nobody is left for a stage the run stops visibly, with the reason and the stage', async () => {
    const { calls, paused, orchestrator } = await runDropout([['A', 'B'], ['B']]);
    expect(calls).toHaveLength(1);
    const state = orchestrator.getState();
    expect(state.lifecycle).toBe('PAUSED');
    expect(state.pauseInfo).toMatchObject({ reason: 'participants_unavailable', plannedStageId: 'canvas-r2', participantId: 'B' });
    expect(paused.map((info) => info.reason)).toEqual(['participants_unavailable']);
  });
});
