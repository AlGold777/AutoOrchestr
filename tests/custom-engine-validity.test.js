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
const FAIL = 'Разбор.\nНЕ ВЫПОЛНЕНО: срок\nВЕРДИКТ: НЕ ПРОШЁЛ';
const visitsOf = (result, ref) => result.steps.filter((step) => step.ref === ref).map((step) => [step.visit, step.valid]);

describe('Custom engine validity of results (6.3)', () => {
  test('a backward goto makes the target and what it fed stale; the old visits stay in the history; the new visit takes the new answer', async () => {
    // S1 → S2 (takes the answer of S1) → G (fails once: goto S1). The first visits of S1, S2 and G are stale.
    const steps = [
      { ref: 'S1', kind: 'round', input: 'none', models: ['A'] },
      { ref: 'S2', kind: 'round', models: ['B'] },
      { ref: 'G', kind: 'gate', criteria: ['c'], models: ['C'], onFail: { goto: 'S1', maxLoops: 1 } }
    ];
    const { send, calls } = transport({ A: ['a1', 'a2'], B: ['b1', 'b2'], C: [FAIL, PASS] });
    const result = await Engine.run({ task: 'T', steps, send });
    expect(result.stopReason).toBe('steps_done');
    expect(calls.map((call) => call.models[0])).toEqual(['A', 'B', 'C', 'A', 'B', 'C']);
    expect(visitsOf(result, 'S1')).toEqual([[1, false], [2, true]]);
    expect(visitsOf(result, 'S2')).toEqual([[1, false], [2, true]]);
    expect(visitsOf(result, 'G')).toEqual([[1, false], [2, true]]);
    expect(calls[4].prompts.B).toContain('a2');
    expect(calls[4].prompts.B).not.toContain('a1');
  });

  test('a step that is not used by the target is not stale: the unrelated step keeps its valid result', async () => {
    const steps = [
      { ref: 'X', kind: 'round', input: 'none', models: ['X'] },
      { ref: 'S1', kind: 'round', input: 'none', models: ['A'] },
      { ref: 'G', kind: 'gate', criteria: ['c'], models: ['C'], onFail: { goto: 'S1', maxLoops: 1 } }
    ];
    const { send } = transport({ X: ['x'], A: ['a1', 'a2'], C: [FAIL, PASS] });
    const result = await Engine.run({ task: 'T', steps, send });
    expect(visitsOf(result, 'X')).toEqual([[1, true]]);
  });

  test('invalidate names more steps to re-examine; their results are stale, the steps not named stay valid', async () => {
    const steps = [
      { ref: 'X', kind: 'round', input: 'none', models: ['X'] },
      { ref: 'S1', kind: 'round', input: 'none', models: ['A'] },
      { ref: 'G', kind: 'gate', criteria: ['c'], models: ['C'], onFail: { goto: 'S1', maxLoops: 1, invalidate: ['X'] } }
    ];
    const { send } = transport({ X: ['x'], A: ['a1', 'a2'], C: [FAIL, PASS] });
    const result = await Engine.run({ task: 'T', steps, send });
    expect(visitsOf(result, 'X')).toEqual([[1, false]]);
    expect(visitsOf(result, 'S1')).toEqual([[1, false], [2, true]]);
  });

  test('a required source whose latest visit was skipped does not fall back to the old answer: missing_input, nothing sent to the next step', async () => {
    const steps = [
      { ref: 'S1', kind: 'round', input: 'none', models: ['A'] },
      { ref: 'G', kind: 'gate', criteria: ['c'], models: ['C'], onFail: { goto: 'S1', maxLoops: 1 } },
      { ref: 'S2', kind: 'round', input: [{ step: 'S1', participant: 'A', required: true }], models: ['B'] }
    ];
    const { send, calls } = transport({ A: ['a1', '', ''], C: [FAIL, PASS], B: ['b'] });
    const decide = jest.fn(async () => 'skip');
    const result = await Engine.run({ task: 'T', steps, send, decide });
    expect(result.stopReason).toBe('missing_input');
    expect(result.stopDetail).toContain('S1');
    expect(calls.map((call) => call.models[0])).not.toContain('B');
    expect(visitsOf(result, 'S1')).toEqual([[1, false], [2, true]]);
  });

  test('an artifact of a stale visit is not substituted: a required artifact with no current version stops the run before the request', async () => {
    const output = { format: 'json', requiredFields: ['/map'], artifacts: [{ id: 'map', name: 'Map', pointer: '/map' }] };
    const steps = [
      { ref: 'S1', kind: 'round', input: 'none', output, models: ['A'] },
      { ref: 'G', kind: 'gate', criteria: ['c'], models: ['C'], onFail: { goto: 'S1', maxLoops: 1 } },
      { ref: 'S2', kind: 'round', input: [{ artifact: { step: 'S1', participant: 'A', id: 'map' }, version: 'latest', required: true }], models: ['B'] }
    ];
    const { send, calls } = transport({ A: ['{"map":"m1"}', '', ''], C: [FAIL, PASS], B: ['b'] });
    const result = await Engine.run({ task: 'T', steps, send, decide: async () => 'skip' });
    expect(result.stopReason).toBe('missing_input');
    expect(calls.map((call) => call.models[0])).not.toContain('B');
  });

  test('a current version is taken again after the re-run: the new visit gives the latest version', async () => {
    const output = { format: 'json', requiredFields: ['/map'], artifacts: [{ id: 'map', name: 'Map', pointer: '/map' }] };
    const steps = [
      { ref: 'S1', kind: 'round', input: 'none', output, models: ['A'] },
      { ref: 'G', kind: 'gate', criteria: ['c'], models: ['C'], onFail: { goto: 'S1', maxLoops: 1 } },
      { ref: 'S2', kind: 'round', input: [{ artifact: { step: 'S1', participant: 'A', id: 'map' }, version: 'latest', required: true }], models: ['B'] }
    ];
    const { send, calls } = transport({ A: ['{"map":"m1"}', '{"map":"m2"}'], C: [FAIL, PASS], B: ['b'] });
    const result = await Engine.run({ task: 'T', steps, send });
    expect(result.stopReason).toBe('steps_done');
    expect(calls.find((call) => call.models[0] === 'B').prompts.B).toContain('m2');
    expect(calls.find((call) => call.models[0] === 'B').prompts.B).not.toContain('m1');
  });

  test('the feedback is resolved before the invalidation: it keeps the answer that the goto makes stale, and goes to the new visit only', async () => {
    const steps = [
      { ref: 'S1', kind: 'round', input: 'none', models: ['A'] },
      { ref: 'S2', kind: 'round', models: ['B'] },
      { ref: 'G', kind: 'gate', criteria: ['c'], models: ['C'], onFail: { goto: 'S1', maxLoops: 1, feedback: [{ step: 'S2', participant: 'B' }] } }
    ];
    const { send, calls } = transport({ A: ['a1', 'a2'], B: ['b1', 'b2'], C: [FAIL, PASS] });
    const result = await Engine.run({ task: 'T', steps, send });
    expect(result.stopReason).toBe('steps_done');
    expect(visitsOf(result, 'S2')).toEqual([[1, false], [2, true]]);
    expect(calls[3].prompts.A).toContain('Замечания, вызвавшие возврат');
    expect(calls[3].prompts.A).toContain('b1');
    expect(calls[4].prompts.B).not.toContain('Замечания, вызвавшие возврат');
  });

  test('an explicit invalidate of a step that is not in the plan is refused before the first request', async () => {
    const steps = [
      { ref: 'S1', kind: 'round', input: 'none', models: ['A'] },
      { ref: 'G', kind: 'gate', criteria: ['c'], models: ['C'], onFail: { goto: 'S1', maxLoops: 1, invalidate: ['nope'] } }
    ];
    const { send, calls } = transport({ A: ['a'], C: [FAIL] });
    const error = await Engine.run({ task: 'T', steps, send }).catch((item) => item);
    expect(error.code).toBe('unknown_target');
    expect(calls).toHaveLength(0);
  });
});
