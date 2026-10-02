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
    const block = source.slice(from, from + 1800);
    expect(block).toContain('pipelineWaiter.closeAnsweredBatches(\'moderator_closed\')');
    expect(block).toContain("'moderator_pause'");
    expect(block.indexOf('closeAnsweredBatches')).toBeLessThan(block.indexOf("setDebatePausedState(true, 'pause_button')"));
  });
});
