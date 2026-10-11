const Engine = require('../disput/custom-engine');

// The storage of the texts (as the record gives it): the same dictionary for every run of one test, like a reload of one record.
function textStore() {
  const data = {};
  let seq = 0;
  return { data, putText: (value) => { seq += 1; const ref = `t${seq}`; data[ref] = value; return ref; }, getText: (ref) => data[ref] };
}

// A checkpoint that keeps every state (as the page keeps the snapshot). `failAfter(state)` true makes the next checkpoints fail.
function keeper({ failAfter = null } = {}) {
  const saved = [];
  let failing = false;
  const checkpoint = async (state) => {
    if (failing) throw new Error('disk full');
    saved.push(JSON.parse(JSON.stringify(state)));
    if (typeof failAfter === 'function' && failAfter(state)) failing = true;
  };
  return { checkpoint, saved, last: () => saved[saved.length - 1] };
}

// A transport with scripted answers; `abortWhen(models, meta)` aborts the call (the request is in flight when Stop comes).
function transport(answers, log, { abortWhen = null, controller = null } = {}) {
  const used = {};
  const send = async (models, prompts, meta) => {
    log.push({ models: models.slice(), prompts: { ...prompts }, attempt: meta.attempt, visit: meta.visit, stepRef: meta.stepRef });
    if (abortWhen && abortWhen(models, meta)) {
      controller.abort();
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }
    const byModel = {};
    models.forEach((model) => {
      const index = used[model] || 0;
      used[model] = index + 1;
      const reply = (answers[model] || [])[index];
      byModel[model] = { text: reply || '', status: reply ? 'SUCCESS' : 'TIMEOUT' };
    });
    return { byModel, closedByOwner: false };
  };
  return send;
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const FAIL = 'Разбор.\nНЕ ВЫПОЛНЕНО: x\nВЕРДИКТ: НЕ ПРОШЁЛ';
const PASS = 'Разбор.\nВЕРДИКТ: ПРОШЁЛ';

const TWO_ROUNDS = [
  { ref: 'S1', kind: 'round', input: 'none', models: ['A'] },
  { ref: 'S2', kind: 'round', input: 'previous', models: ['B'] }
];

// The first run stops while B's request is in flight; the second run resumes from the state the first one saved.
async function stopInFlight(steps, { answersA = ['a1'] } = {}) {
  const controller = new AbortController();
  const texts = textStore();
  const first = keeper();
  const log1 = [];
  const run1 = await Engine.run({
    task: 'T', steps, signal: controller.signal, checkpoint: first.checkpoint, putText: texts.putText, getText: texts.getText,
    send: transport({ A: answersA, B: ['b1'] }, log1, { abortWhen: (models) => models[0] === 'B', controller })
  });
  return { run1, saved: first.last(), texts, log1 };
}

describe('Custom engine resume (8.3, T15, T16, T13)', () => {
  test('a reload in the middle of a send: the request in flight is unknown; the owner resends it as a new attempt, and the finished step is not sent again', async () => {
    const { run1, saved, texts } = await stopInFlight(TWO_ROUNDS);
    expect(run1.stopReason).toBe('cancelled');
    expect(saved.current).toMatchObject({ active: true, stepRef: 'S2', visit: 1, pending: [expect.objectContaining({ participantId: 'B', attempt: 1 })] });
    const asked = [];
    const log2 = [];
    const second = keeper();
    const run2 = await Engine.run({
      task: 'T', steps: TWO_ROUNDS, checkpoint: second.checkpoint, putText: texts.putText, getText: texts.getText, resume: clone(saved),
      send: transport({ B: ['b2'] }, log2), resolveUnknown: async (request) => { asked.push(request); return 'resend'; }
    });
    expect(run2.stopReason).toBe('steps_done');
    expect(asked).toEqual([{ stepRef: 'S2', visit: 1, items: [{ participantId: 'B', attempt: 1 }], choices: ['resend', 'skip'] }]);
    expect(log2.map((call) => call.models[0])).toEqual(['B']);
    expect(log2[0]).toMatchObject({ attempt: 2 });
    expect(log2[0].prompts.B).toContain('a1');
    expect(run2.steps.map((item) => [item.ref, item.visit])).toEqual([['S1', 1], ['S2', 1]]);
  });

  test('skip of an unknown request does not count as an answer: the step needs its answers, the run waits for the owner', async () => {
    const { saved, texts } = await stopInFlight(TWO_ROUNDS);
    const log2 = [];
    const run2 = await Engine.run({
      task: 'T', steps: TWO_ROUNDS, checkpoint: keeper().checkpoint, putText: texts.putText, getText: texts.getText, resume: clone(saved),
      send: transport({ B: ['b2'] }, log2), resolveUnknown: async () => 'skip'
    });
    expect(log2).toEqual([]);
    expect(run2.stopReason).toBe('no_decision');
  });

  test('without an owner answer to the unknown request nothing is sent', async () => {
    const { saved, texts } = await stopInFlight(TWO_ROUNDS);
    const log2 = [];
    const run2 = await Engine.run({
      task: 'T', steps: TWO_ROUNDS, checkpoint: keeper().checkpoint, putText: texts.putText, getText: texts.getText, resume: clone(saved),
      send: transport({ B: ['b2'] }, log2)
    });
    expect(log2).toEqual([]);
    expect(run2.stopReason).toBe('no_decision');
  });

  test('a decision the owner has taken is not asked again after a reload; the unknown request is still settled', async () => {
    const steps = [{ ref: 'S1', kind: 'round', input: 'none', models: ['A'], owner: 'approve' }, TWO_ROUNDS[1]];
    const controller = new AbortController();
    const texts = textStore();
    const asked1 = [];
    const first = keeper();
    const run1 = await Engine.run({
      task: 'T', steps, signal: controller.signal, checkpoint: first.checkpoint, putText: texts.putText, getText: texts.getText,
      send: transport({ A: ['a1'], B: ['b1'] }, [], { abortWhen: (models) => models[0] === 'B', controller }),
      decide: async (request) => { asked1.push(request.step); return 'continue'; }
    });
    expect(run1.stopReason).toBe('cancelled');
    expect(asked1).toEqual([0]);
    const asked2 = [];
    const log2 = [];
    const run2 = await Engine.run({
      task: 'T', steps, checkpoint: keeper().checkpoint, putText: texts.putText, getText: texts.getText, resume: clone(first.last()),
      send: transport({ B: ['b2'] }, log2), resolveUnknown: async () => 'resend',
      decide: async (request) => { asked2.push(request.step); return 'continue'; }
    });
    expect(asked2).toEqual([]);
    expect(log2.map((call) => call.models[0])).toEqual(['B']);
    expect(run2.stopReason).toBe('steps_done');
  });

  test('an open owner decision stays open after a Stop, and the reload asks it again with the same data', async () => {
    const steps = [{ ref: 'S1', kind: 'round', input: 'none', models: ['A'], owner: 'approve' }];
    const controller = new AbortController();
    const texts = textStore();
    const first = keeper();
    const run1 = await Engine.run({
      task: 'T', steps, signal: controller.signal, checkpoint: first.checkpoint, putText: texts.putText, getText: texts.getText,
      send: transport({ A: ['a1'] }, []),
      decide: async () => { controller.abort(); return new Promise(() => {}); }
    });
    expect(run1.stopReason).toBe('cancelled');
    expect(first.last().pendingOwner).toEqual({ kind: 'decision', stepRef: 'S1', visit: 1 });
    const asked = [];
    const log2 = [];
    const run2 = await Engine.run({
      task: 'T', steps, checkpoint: keeper().checkpoint, putText: texts.putText, getText: texts.getText, resume: clone(first.last()),
      send: transport({ A: ['a-new'] }, log2),
      decide: async (request) => { asked.push({ accepted: request.accepted, failed: request.failed }); return 'continue'; }
    });
    expect(asked).toEqual([{ accepted: ['A'], failed: [] }]);
    expect(log2).toEqual([]);
    expect(run2.stopReason).toBe('steps_done');
  });

  test('a loop counter is not reset by a reload: the third transition is refused after the reload too (T13)', async () => {
    const steps = [
      { ref: 'S10', kind: 'round', input: 'none', models: ['A'] },
      { ref: 'G1', kind: 'gate', criteria: ['c'], models: ['B'], onFail: { goto: 'S10', maxLoops: 1 } }
    ];
    const controller = new AbortController();
    const texts = textStore();
    const first = keeper();
    const run1 = await Engine.run({
      task: 'T', steps, signal: controller.signal, checkpoint: first.checkpoint, putText: texts.putText, getText: texts.getText,
      send: transport({ A: ['a1', 'a2'], B: [FAIL] }, [], { abortWhen: (models, meta) => models[0] === 'A' && meta.visit === 2, controller })
    });
    expect(run1.stopReason).toBe('cancelled');
    expect(first.last().loopCounters).toEqual({ 'G1:onFail': 1 });
    const log2 = [];
    const run2 = await Engine.run({
      task: 'T', steps, checkpoint: keeper().checkpoint, putText: texts.putText, getText: texts.getText, resume: clone(first.last()),
      send: transport({ A: ['a2b'], B: [FAIL] }, log2), resolveUnknown: async () => 'resend'
    });
    expect(run2.stopReason).toBe('loop_limit');
    expect(log2.map((call) => call.models[0])).toEqual(['A', 'B']);
    expect(run2.state.loopCounters).toEqual({ 'G1:onFail': 1 });
  });

  test('a transition the reload found applied is not applied a second time: its counter stays at one', async () => {
    const steps = [
      { ref: 'S10', kind: 'round', input: 'none', models: ['A'] },
      { ref: 'G1', kind: 'gate', criteria: ['c'], models: ['B'], onFail: { goto: 'S10', maxLoops: 2 } }
    ];
    const texts = textStore();
    // The checkpoint after the transition is the last one that is saved: the next checkpoints fail (a crash right after it).
    const first = keeper({ failAfter: (state) => Boolean(state.current && state.current.applied) });
    const error = await Engine.run({
      task: 'T', steps, checkpoint: first.checkpoint, putText: texts.putText, getText: texts.getText,
      send: transport({ A: ['a1', 'a2'], B: [FAIL, PASS] }, [])
    }).catch((item) => item);
    expect(error.code).toBe('checkpoint_failed');
    expect(first.last().current).toMatchObject({ active: true, stepRef: 'G1', phase: 'transition', applied: { target: 'S10' } });
    const log2 = [];
    const run2 = await Engine.run({
      task: 'T', steps, checkpoint: keeper().checkpoint, putText: texts.putText, getText: texts.getText, resume: clone(first.last()),
      send: transport({ A: ['a2'], B: [PASS] }, log2)
    });
    expect(run2.stopReason).toBe('steps_done');
    expect(log2.map((call) => call.models[0])).toEqual(['A', 'B']);
    expect(run2.state.loopCounters).toEqual({ 'G1:onFail': 1 });
  });

  test('the resumed run uses the steps it is given (the saved schema); a step of the saved state missing from them is refused', async () => {
    const { saved, texts } = await stopInFlight(TWO_ROUNDS);
    const log2 = [];
    const error = await Engine.run({
      task: 'T', steps: [TWO_ROUNDS[1]], checkpoint: keeper().checkpoint, putText: texts.putText, getText: texts.getText, resume: clone(saved),
      send: transport({ B: ['b2'] }, log2), resolveUnknown: async () => 'resend'
    }).catch((item) => item);
    expect(error.code).toBe('resume_mismatch');
    expect(log2).toEqual([]);
  });

  test('an owner answer that was accepted is kept: after a reload the owner is not asked again, and the next step gets its text', async () => {
    const steps = [{ ref: 'owner:evidence', kind: 'owner', task: 'Дай факты' }, { ref: 'S2', kind: 'round', input: ['owner:evidence'], models: ['B'] }];
    const controller = new AbortController();
    const texts = textStore();
    const first = keeper();
    const asked1 = [];
    const run1 = await Engine.run({
      task: 'T', steps, signal: controller.signal, checkpoint: first.checkpoint, putText: texts.putText, getText: texts.getText,
      provideOwnerResult: async (request) => { asked1.push(request.stepRef); return 'Факты: 1'; },
      send: transport({ B: ['b1'] }, [], { abortWhen: () => true, controller })
    });
    expect(run1.stopReason).toBe('cancelled');
    expect(asked1).toEqual(['owner:evidence']);
    const asked2 = [];
    const log2 = [];
    const run2 = await Engine.run({
      task: 'T', steps, checkpoint: keeper().checkpoint, putText: texts.putText, getText: texts.getText, resume: clone(first.last()),
      provideOwnerResult: async (request) => { asked2.push(request.stepRef); return 'другое'; },
      send: transport({ B: ['b2'] }, log2), resolveUnknown: async () => 'resend'
    });
    expect(asked2).toEqual([]);
    expect(run2.stopReason).toBe('steps_done');
    expect(log2[0].prompts.B).toContain('Факты: 1');
  });
});

describe('Custom engine resume: an unknown request stays unknown until the owner decides (8.3)', () => {
  test('a Stop while the owner decides on an unknown request keeps it unknown: the next run sends nothing before the owner answers', async () => {
    const { saved, texts } = await stopInFlight(TWO_ROUNDS);
    const controller = new AbortController();
    const second = keeper();
    const log2 = [];
    const run2 = await Engine.run({
      task: 'T', steps: TWO_ROUNDS, signal: controller.signal, checkpoint: second.checkpoint, putText: texts.putText, getText: texts.getText, resume: clone(saved),
      send: transport({ B: ['b2'] }, log2),
      resolveUnknown: async () => { controller.abort(); return new Promise(() => {}); }
    });
    expect(run2.stopReason).toBe('cancelled');
    expect(log2).toEqual([]);
    expect(second.last().current.pending).toEqual([expect.objectContaining({ participantId: 'B', attempt: 1 })]);
    const log3 = [];
    const run3 = await Engine.run({
      task: 'T', steps: TWO_ROUNDS, checkpoint: keeper().checkpoint, putText: texts.putText, getText: texts.getText, resume: clone(second.last()),
      send: transport({ B: ['b3'] }, log3), resolveUnknown: async () => 'resend'
    });
    expect(run3.stopReason).toBe('steps_done');
    expect(log3.map((call) => [call.models[0], call.attempt])).toEqual([['B', 2]]);
  });
});
