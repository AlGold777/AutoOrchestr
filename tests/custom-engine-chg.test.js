const Engine = require('../disput/custom-engine');

// A scripted transport (as in custom-engine.test.js): answers[model] is a list of replies, one per request to that model.
function transport(answers) {
  const calls = [];
  const used = {};
  const send = async (models, prompts, meta) => {
    calls.push({ models: models.slice(), prompts: { ...prompts }, meta });
    const byModel = {};
    models.forEach((model) => {
      const index = used[model] || 0;
      used[model] = index + 1;
      const reply = (answers[model] || [])[index];
      byModel[model] = typeof reply === 'object' ? reply : { text: reply || '', status: reply ? 'SUCCESS' : 'TIMEOUT' };
    });
    return { byModel, closedByOwner: false };
  };
  return { send, calls };
}

const PASS = 'Разбор.\nВЕРДИКТ: ПРОШЁЛ';
const FAIL = (unmet) => `Разбор.\nНЕ ВЫПОЛНЕНО: ${unmet}\nВЕРДИКТ: НЕ ПРОШЁЛ`;
const visitsOf = (result, ref) => result.steps.filter((step) => step.ref === ref).map((step) => [step.visit, step.valid]);

describe('Custom engine controlled change (6.3, T12)', () => {
  test('a change: the gate after the target returns to the saved step, the steps between are not re-run', async () => {
    // S10 → G1 → S14 → S19 (fails: goto S10, resumeAt S19). G1 fails on its second visit: return goes to S19 only.
    const steps = [
      { ref: 'S10', kind: 'round', input: 'none', models: ['A'] },
      { ref: 'G1', kind: 'gate', criteria: ['c'], models: ['B'], onFail: { return: true } },
      { ref: 'S14', kind: 'round', models: ['C'] },
      { ref: 'S19', kind: 'gate', criteria: ['d'], models: ['D'], onFail: { goto: 'S10', maxLoops: 1, resumeAt: 'S19' } }
    ];
    const { send, calls } = transport({ A: ['a1', 'a2'], B: [PASS, FAIL('x')], C: ['c1'], D: [FAIL('y'), PASS] });
    const result = await Engine.run({ task: 'T', steps, send });
    expect(result.stopReason).toBe('steps_done');
    expect(calls.map((call) => call.models)).toEqual([['A'], ['B'], ['C'], ['D'], ['A'], ['B'], ['D']]);
    // S10 and G1 ran again; S14 was not re-run by the return, so its first visit is stale and stays so.
    expect(visitsOf(result, 'S10')).toEqual([[1, false], [2, true]]);
    expect(visitsOf(result, 'S14')).toEqual([[1, false]]);
    expect(visitsOf(result, 'S19')).toEqual([[1, false], [2, true]]);
    expect(result.state.continuationStack).toEqual([]);
  });

  test('nested returns use the stack: the inner return goes to the inner point, then the outer one; the stack ends empty', async () => {
    // G1 fails on its first visit: it pushes G3 and goes to S1. G2 pushes G2's own point, then G3 returns to G2 first.
    const steps = [
      { ref: 'S1', kind: 'round', input: 'none', models: ['A'] },
      { ref: 'G1', kind: 'gate', criteria: ['c'], models: ['B'], onFail: { goto: 'S1', maxLoops: 2, resumeAt: 'G3' } },
      { ref: 'S2', kind: 'round', models: ['C'] },
      { ref: 'G2', kind: 'gate', criteria: ['d'], models: ['D'], onFail: { goto: 'S2', maxLoops: 1, resumeAt: 'G2' } },
      { ref: 'G3', kind: 'gate', criteria: ['e'], models: ['E'], onFail: { return: true, maxLoops: 2 } }
    ];
    const { send, calls } = transport({ A: ['a1', 'a2'], B: [FAIL('x'), PASS], C: ['c1', 'c2'], D: [FAIL('y'), PASS, PASS], E: [FAIL('z'), FAIL('z'), PASS] });
    const result = await Engine.run({ task: 'T', steps, send });
    expect(result.stopReason).toBe('steps_done');
    expect(calls.map((call) => call.models[0])).toEqual(['A', 'B', 'A', 'B', 'C', 'D', 'C', 'D', 'E', 'D', 'E', 'E']);
    expect(result.state.continuationStack).toEqual([]);
  });


  test('the change does not skip a required input: a stale required source stops the run, the designated route is not bypassed', async () => {
    // S19 requires S14's answer; the return from G1 goes to S19, S14 is not re-run, so S19's requirement is not met.
    const steps = [
      { ref: 'S10', kind: 'round', input: 'none', models: ['A'] },
      { ref: 'G1', kind: 'gate', criteria: ['c'], models: ['B'], onFail: { return: true } },
      { ref: 'S14', kind: 'round', models: ['C'] },
      { ref: 'S19', kind: 'gate', criteria: ['d'], models: ['D'], input: [{ step: 'S14', participant: 'C', required: true }], onFail: { goto: 'S10', maxLoops: 1, resumeAt: 'S19' } }
    ];
    const { send, calls } = transport({ A: ['a1', 'a2'], B: [PASS, FAIL('x')], C: ['c1'], D: [FAIL('y')] });
    const result = await Engine.run({ task: 'T', steps, send });
    expect(result.stopReason).toBe('missing_input');
    expect(result.stopDetail).toContain('S14');
    expect(calls.map((call) => call.models[0])).toEqual(['A', 'B', 'C', 'D', 'A', 'B']);
  });

  test('a stale previous step gives no input: the answer of an older step is not substituted', async () => {
    const steps = [
      { ref: 'S10', kind: 'round', input: 'none', models: ['A'] },
      { ref: 'G1', kind: 'gate', criteria: ['c'], models: ['B'], onFail: { return: true } },
      { ref: 'S14', kind: 'round', models: ['C'] },
      { ref: 'S19', kind: 'gate', criteria: ['d'], models: ['D'], onFail: { goto: 'S10', maxLoops: 1, resumeAt: 'S19' } }
    ];
    const { send, calls } = transport({ A: ['a1', 'a2'], B: [PASS, FAIL('x')], C: ['c1'], D: [FAIL('y'), PASS] });
    const result = await Engine.run({ task: 'T', steps, send });
    expect(result.stopReason).toBe('steps_done');
    expect(visitsOf(result, 'S14')).toEqual([[1, false]]);
    // The second visit of S19 has no answer of S14 and no answer of G1 either: its input is empty, not G1's.
    const last = calls[calls.length - 1];
    expect(last.models).toEqual(['D']);
    expect(last.prompts.D).not.toContain('Разбор.');
  });
});

// The route that returns after a recomputation names its required sources (N05): the engine checks them before the owner decides.
// G1 fails once, which starts the change (return to S19); S18 is the recomputed round; chk is the owner's route with the return.
const RECOMPUTE = (require) => [
  { ref: 'S10', kind: 'round', input: 'none', models: ['A'] },
  { ref: 'G1', kind: 'gate', criteria: ['c'], models: ['B'], onFail: { goto: 'S10', maxLoops: 1, resumeAt: 'S19' } },
  { ref: 'S18', kind: 'round', order: 'parallel', require, input: 'none', models: ['C1', 'C2'] },
  { ref: 'chk', kind: 'route', models: [], input: [{ step: 'S18', participant: 'C2', required: true }],
    select: { by: 'owner', cases: [
      { id: 'next', label: 'Продолжить', action: { goto: 'S19' } },
      { id: 'return', label: 'Вернуться к точке изменения', action: { return: true, maxLoops: 1 } }] } },
  { ref: 'S19', kind: 'round', input: 'none', models: ['D'] }
];

describe('Custom engine: the return of a change waits for its recomputed inputs (N05)', () => {
  test('the recomputed input is there: the owner returns, the stack ends empty, S19 runs', async () => {
    const { send, calls } = transport({ A: ['a1', 'a2'], B: [FAIL('x'), PASS], C1: ['c1a', 'c1b'], C2: ['c2a', 'c2b'], D: ['d1'] });
    const result = await Engine.run({ task: 'T', steps: RECOMPUTE(2), send, chooseRoute: async () => 'return' });
    expect(result.stopReason).toBe('steps_done');
    expect(calls.map((call) => call.models.join(','))).toEqual(['A', 'B', 'A', 'B', 'C1,C2', 'D']);
    expect(result.state.continuationStack).toEqual([]);
  });

  test('a failed recomputed input (no answer, the step goes on with enough others): missing_input names the source; the owner is not asked; S19 is not sent', async () => {
    const { send, calls } = transport({ A: ['a1', 'a2'], B: [FAIL('x'), PASS], C1: ['c1a', 'c1b'], C2: [''], D: ['d1'] });
    const asked = [];
    const result = await Engine.run({ task: 'T', steps: RECOMPUTE(1), send, chooseRoute: async (arg) => { asked.push(arg.stepRef); return 'return'; } });
    expect(result.stopReason).toBe('missing_input');
    expect(result.stopDetail).toContain('C2');
    expect(result.stopDetail).toContain('S18');
    expect(result.stopDetail).toContain('chk');
    expect(asked).toEqual([]);
    expect(calls.some((call) => call.models.includes('D'))).toBe(false);
  });

  test('a skipped recomputed input: missing_input names the source; the return is not taken', async () => {
    const { send, calls } = transport({ A: ['a1', 'a2'], B: [FAIL('x'), PASS], C1: ['c1a'], C2: [''], D: ['d1'] });
    const result = await Engine.run({ task: 'T', steps: RECOMPUTE(2), send, chooseRoute: async () => 'return', decide: async () => 'skip' });
    expect(result.stopReason).toBe('missing_input');
    expect(result.stopDetail).toContain('C2');
    expect(result.stopDetail).toContain('chk');
    expect(calls.some((call) => call.models.includes('D'))).toBe(false);
  });
});

describe('Custom engine: what a change makes stale (N05, 6.3)', () => {
  test('the invalidation is the target, its explicit refs and what really used them: an unrelated step between the target and resumeAt stays valid', async () => {
    const steps = [
      { ref: 'S10', kind: 'round', input: 'none', models: ['A'] },
      { ref: 'G1', kind: 'gate', criteria: ['c'], models: ['B'], onFail: { goto: 'S10', maxLoops: 1, resumeAt: 'S19' } },
      { ref: 'S14', kind: 'round', input: 'none', models: ['C'] },
      { ref: 'S19', kind: 'gate', criteria: ['d'], models: ['D'], input: 'none', onFail: { return: true, maxLoops: 1 } }
    ];
    const { send } = transport({ A: ['a1', 'a2'], B: [FAIL('x'), PASS], C: ['c1'], D: [PASS] });
    const result = await Engine.run({ task: 'T', steps, send });
    expect(result.stopReason).toBe('steps_done');
    // S14 depends on nothing of the target: its visit is not stale although it lies between S10 and S19.
    expect(visitsOf(result, 'S14')).toEqual([[1, true]]);
  });

  test('feedback of a change takes the remark of the exact visit of its source: the second return gives the second visit\'s text', async () => {
    const steps = [
      { ref: 'S1', kind: 'round', input: 'none', models: ['A'] },
      { ref: 'S2', kind: 'round', input: 'none', models: ['B'] },
      { ref: 'G', kind: 'gate', criteria: ['c'], models: ['C'], onFail: { goto: 'S1', maxLoops: 2, feedback: [{ step: 'S2', participant: 'B' }] } }
    ];
    const { send, calls } = transport({ A: ['a1', 'a2', 'a3'], B: ['REMARK_1', 'REMARK_2', 'REMARK_3'], C: [FAIL('x'), FAIL('y'), PASS] });
    const result = await Engine.run({ task: 'T', steps, send });
    expect(result.stopReason).toBe('steps_done');
    const thirdA = calls.filter((call) => call.models[0] === 'A')[2].prompts.A;
    expect(thirdA).toContain('REMARK_2');
    expect(thirdA).not.toContain('REMARK_1');
    expect(thirdA).toContain('визит 2');
  });
});
