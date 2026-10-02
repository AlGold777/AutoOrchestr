// The Pause button closes the running round and pauses; the button comes back as Run and starts the
// next round. Before the fix a pause requested while a stage ran left the run QUIESCING forever and
// "Continue" answered NOT_PAUSED.
const fs = require('fs');
const path = require('path');
const Application = require('../disput/debate-application');
const DraftPlan = require('../disput/debate-draft-plan');

const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

const makeRun = ({ rounds = 3 } = {}) => {
  const plan = DraftPlan.createCanvasPlan({
    rounds: Array.from({ length: rounds }, (_, i) => ({ plannedStageId: `canvas-r${i + 1}`, purpose: i === 0 ? 'position' : 'response', participantIds: ['A', 'B'] }))
  });
  const gates = [];
  const started = [];
  const app = Application.createApplication({
    universalEngine: true, allowIncompleteWiring: true, exposeInternals: true,
    deps: {
      runModelBatch: ({ models, context }) => new Promise((resolve) => {
        started.push(context.pipelineStageId);
        gates.push(() => resolve({ responses: Object.fromEntries(models.map((model) => [model, `answer ${model}`])), results: {}, failed: {} }));
      }),
      proposeStateDelta: ({ participant }) => ({ by: participant.participantId })
    }
  });
  const run = app.start({
    runId: `run-${Math.random().toString(36).slice(2, 8)}`, topic: 't', models: ['A', 'B'], draftPlan: plan,
    policies: { finalization: { mode: 'manual' }, stagePause: { mode: 'never' } }, maxSteps: 20
  });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
  // Let every further round answer at once (Continue goes on through the remaining rounds).
  const drain = async (promise) => {
    let done = false;
    promise.then(() => { done = true; });
    for (let i = 0; i < 200 && !done; i += 1) { while (gates.length) gates.shift()(); await tick(); }
    return promise;
  };
  const completed = () => app.getOrchestrator().getState().stages.filter((stage) => stage.status === 'completed').length;
  return { app, run, gates, started, tick, completed, drain };
};

describe('pause during a running round, then Run', () => {
  test('the run reaches PAUSED when the round ends; Continue starts the next round', async () => {
    const { app, run, gates, started, tick, completed, drain } = makeRun();
    await tick();
    expect(started).toHaveLength(1);
    const paused = await app.pause('pause_button');
    expect(paused).toMatchObject({ ok: true, lifecycle: 'QUIESCING' }); // the round is still running
    gates.shift()(); // the round ends (the page closes it with the answers it holds)
    await run;
    const state = app.getOrchestrator().getState();
    expect(state.lifecycle).toBe('PAUSED');
    expect(completed()).toBe(1);
    expect(started).toHaveLength(1);

    const resumed = app.resume();
    await tick();
    expect(started).toHaveLength(2); // the next round started
    await drain(resumed);
    expect(started).toHaveLength(3);
    expect(app.getOrchestrator().getState().lifecycle).toBe('RUNNING');
  });

  test('Run pressed while the round is still finishing waits for the pause and then goes on', async () => {
    const { app, run, gates, started, tick, drain } = makeRun();
    await tick();
    await app.pause('pause_button');
    const resumed = app.resume(); // pressed before the round ended
    await tick();
    expect(started).toHaveLength(1); // nothing started yet: the paused round is not finished
    gates.shift()();
    await run;
    await tick();
    expect(started).toHaveLength(2);
    await drain(resumed);
    expect(app.getOrchestrator().getState().lifecycle).toBe('RUNNING');
  });

  test('a pause that nobody resumes stays a pause', async () => {
    const { app, run, gates, tick, started } = makeRun();
    await tick();
    await app.pause('pause_button');
    gates.shift()();
    await run;
    await tick();
    expect(app.getOrchestrator().getState().lifecycle).toBe('PAUSED');
    expect(started).toHaveLength(1);
  });
});

describe('the Pause button on the page', () => {
  test('closes the round with the collected answers, journals it and then pauses', () => {
    const from = source.indexOf("if (controls.action === 'pause') {");
    const block = source.slice(from, from + 3500);
    expect(block).toContain('pipelineWaiter.closeAnsweredBatches(\'moderator_closed\')');
    expect(block).toContain("'moderator_pause'");
    expect(block.indexOf('closeAnsweredBatches')).toBeLessThan(block.indexOf("setDebatePausedState(true, 'pause_button')"));
  });
});

// ---------------------------------------------------------------------------
// The Run button along a whole flow: it follows the rounds, and a human can step in at any moment.
const Controller = require('../results/debate-controller');

describe('Run button along the flow', () => {
  // Same derivation as getDebateRunControls in results.js: an engine that is idle (all rounds done,
  // waiting for finalization) is not a live run; the page's own pause/resume dispatches stand in for
  // the aggregate events the page sends when the human presses the button.
  const buttonFor = (app, { runActive, autoMode, pageStatus = null }) => {
    const engine = app.getOrchestrator?.()?.getState?.() || null;
    const engineIdle = Boolean(engine?.idle) && !runActive;
    const hasLiveRun = runActive || (Boolean(engine) && !engineIdle);
    let aggregate = app.getState();
    if (pageStatus) aggregate = { ...aggregate, status: pageStatus };
    if (!hasLiveRun) aggregate = null;
    const startPending = ['STARTING', 'RECONCILING', 'FINALIZING'].includes(engine?.lifecycle || '')
      || (runActive && !['running', 'awaiting_approval', 'paused', 'technical_pause', 'finalization_pending'].includes(String(aggregate?.status || 'idle')));
    return Controller.deriveRunControls({ aggregate, approvalWaiting: false, startPending, autoMode }).action;
  };

  test('Auto: Run → pause during rounds (also between them) → resume when paused → Run again at the end', async () => {
    const plan = DraftPlan.createCanvasPlan({ rounds: [1, 2, 3].map((n) => ({ plannedStageId: `canvas-r${n}`, purpose: n === 1 ? 'position' : 'response', participantIds: ['A', 'B'] })) });
    const gates = [];
    const app = Application.createApplication({
      universalEngine: true, allowIncompleteWiring: true, exposeInternals: true,
      deps: {
        runModelBatch: ({ models }) => new Promise((resolve) => gates.push(() => resolve({ responses: Object.fromEntries(models.map((m) => [m, `a ${m}`])), results: {}, failed: {} }))),
        proposeStateDelta: ({ participant }) => ({ by: participant.participantId })
      }
    });
    const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
    let runActive = true;
    expect(buttonFor(app, { runActive: false, autoMode: true })).toBe('run');
    const start = app.start({ runId: 'run-button', topic: 't', models: ['A', 'B'], draftPlan: plan, policies: { finalization: { mode: 'after_required_goals' }, stagePause: { mode: 'gates' } }, maxSteps: 20 })
      .finally(() => { runActive = false; });
    await tick();
    expect(buttonFor(app, { runActive, autoMode: true })).toBe('pause'); // round 1
    gates.shift()();
    await tick();
    expect(buttonFor(app, { runActive, autoMode: true })).toBe('pause'); // round 2 started by itself
    const paused = app.pause('pause_button');
    expect(buttonFor(app, { runActive, autoMode: true, pageStatus: 'paused' })).toBe('resume'); // pressed: Run again at once
    gates.shift()();
    await paused;
    await start;
    expect(app.getOrchestrator().getState().lifecycle).toBe('PAUSED');
    expect(buttonFor(app, { runActive, autoMode: true, pageStatus: 'paused' })).toBe('resume');
    const resumed = app.resume();
    await tick();
    expect(buttonFor(app, { runActive: false, autoMode: true, pageStatus: 'running' })).toBe('pause'); // round 3
    gates.shift()();
    await resumed;
    await tick();
    expect(app.getState().status).toBe('completed');
    expect(buttonFor(app, { runActive: false, autoMode: true })).toBe('run'); // the flow is over: Run
  });

  test('semi-automatic: after the last round the engine is idle and the button is Run again (a new run may start)', async () => {
    const plan = DraftPlan.createCanvasPlan({ rounds: [1, 2].map((n) => ({ plannedStageId: `canvas-r${n}`, purpose: n === 1 ? 'position' : 'response', participantIds: ['A', 'B'] })) });
    const idleEvents = [];
    const app = Application.createApplication({
      universalEngine: true, allowIncompleteWiring: true, exposeInternals: true,
      deps: {
        runModelBatch: async ({ models }) => ({ responses: Object.fromEntries(models.map((m) => [m, `a ${m}`])), results: {}, failed: {} }),
        proposeStateDelta: ({ participant }) => ({ by: participant.participantId })
      }
    });
    await app.start({ runId: 'run-idle', topic: 't', models: ['A', 'B'], draftPlan: plan, policies: { finalization: { mode: 'manual' }, stagePause: { mode: 'every_stage' } }, maxSteps: 20 });
    const engine = app.getOrchestrator();
    expect(engine.getState()).toMatchObject({ lifecycle: 'PAUSED', idle: false }); // after round 1: paused, not idle
    await app.resume();
    expect(engine.getState().lifecycle).toBe('PAUSED'); // after round 2
    await app.resume();
    // Nothing left: RUNNING but idle.
    expect(engine.getState()).toMatchObject({ lifecycle: 'RUNNING', idle: true });
    expect(buttonFor(app, { runActive: false, autoMode: false, pageStatus: 'running' })).toBe('run');
    expect(engine.getState().events.filter((event) => event.type === 'RUN_IDLE').length).toBeGreaterThanOrEqual(1);
    // A new run replaces it: the previous engine can be cancelled.
    await expect(engine.requestCancel({ reason: 'new_run' })).resolves.toMatchObject({ ok: true });
    expect(engine.getState().lifecycle).toBe('CANCELLED');
  });

  test('the page lets a new run replace an idle one and keeps a paused or running engine as a live run', () => {
    expect(source).toContain('const engineIdle = Boolean(engineState?.idle) && !pipelineRunActive;');
    expect(source).toContain("await previousEngine.requestCancel({ reason: 'new_run' });");
    expect(source).toContain('if (!pipelineRunActive && previousEngine?.getState?.()?.idle) {');
  });
});
