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
