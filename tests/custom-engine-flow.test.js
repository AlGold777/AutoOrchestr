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
const r1 = { ref: 'r1', kind: 'round', input: 'none', models: ['A'] };
const gate = (onFail, extra = {}) => ({ ref: 'gate:g1', kind: 'gate', criteria: ['полнота'], models: ['B'], onFail, ...extra });
const r2 = { ref: 'r2', kind: 'round', models: ['C'] };

describe('Custom engine transitions (6.3, 6.4)', () => {
  test('a shorthand goto with maxLoops in onFail re-runs the step: the second visit is a new visit, the first is not', async () => {
    const { send, calls } = transport({ A: ['карта v1', 'карта v2'], B: [FAIL('срок'), PASS], C: ['итог'] });
    const result = await Engine.run({ task: 'T', steps: [r1, gate({ goto: 'r1', maxLoops: 1 }), r2], send });
    expect(result.stopReason).toBe('steps_done');
    expect(calls.map((call) => call.models)).toEqual([['A'], ['B'], ['A'], ['B'], ['C']]);
    expect(calls[0].meta.visit).toBe(1);
    expect(calls[2].meta.visit).toBe(2);
    expect(calls[4].meta.visit).toBe(1);
    expect(result.steps.map((step) => [step.ref, step.visit])).toEqual([['r1', 1], ['gate:g1', 1], ['r1', 2], ['gate:g1', 2], ['r2', 1]]);
  });

  test('a technical retry of an answer keeps its visit; only the attempt counts up', async () => {
    const { send, calls } = transport({ A: ['', 'карта'], B: [PASS] });
    await Engine.run({ task: 'T', steps: [r1, gate(undefined)], send });
    expect(calls[0].meta).toMatchObject({ attempt: 1, visit: 1 });
    expect(calls[1].meta).toMatchObject({ attempt: 2, visit: 1 });
  });

  test('the feedback of a return reaches the new visit of its target in its own block; the first visit does not see it', async () => {
    const { send, calls } = transport({ A: ['карта v1', 'карта v2'], B: [FAIL('срок'), PASS], C: ['итог'] });
    await Engine.run({ task: 'T', steps: [r1, gate({ goto: 'r1', maxLoops: 1, feedback: [{ step: 'gate:g1', participant: 'B' }] }), r2], send });
    expect(calls[0].prompts.A).not.toContain('Замечания, вызвавшие возврат');
    expect(calls[2].prompts.A).toContain('Замечания, вызвавшие возврат');
    expect(calls[2].prompts.A).toContain('срок');
    expect(calls[2].prompts.A).toContain('визит 1');
    expect(calls[4].prompts.C).not.toContain('Замечания, вызвавшие возврат');
  });

  test('a source takes the latest visit of its step, and the label names the visit', async () => {
    const { send, calls } = transport({ A: ['карта v1', 'карта v2'], B: [FAIL('срок'), PASS], C: ['итог'] });
    await Engine.run({ task: 'T', steps: [r1, gate({ goto: 'r1', maxLoops: 1 }), { ref: 'r2', kind: 'round', input: [{ step: 'r1', participant: 'A' }], models: ['C'] }], send });
    expect(calls[4].prompts.C).toContain('карта v2');
    expect(calls[4].prompts.C).not.toContain('карта v1');
    expect(calls[4].prompts.C).toContain('визит 2');
  });

  test('the third transition over maxLoops 2 is not made: loop_limit, the counter keeps its value', async () => {
    const { send, calls } = transport({ A: ['v1', 'v2', 'v3'], B: [FAIL('срок'), FAIL('срок'), FAIL('срок')], C: ['итог'] });
    const result = await Engine.run({ task: 'T', steps: [r1, gate({ goto: 'r1', maxLoops: 2 }), r2], send });
    expect(result.stopReason).toBe('loop_limit');
    expect(calls.map((call) => call.models)).toEqual([['A'], ['B'], ['A'], ['B'], ['A'], ['B']]);
    expect(result.state.loopCounters).toEqual({ 'gate:g1:onFail': 2 });
  });

  test('a self-loop is limited like any other transition: the third transition to the same gate is not made', async () => {
    const { send, calls } = transport({ A: ['карта'], B: [FAIL('срок'), FAIL('срок'), FAIL('срок')] });
    const result = await Engine.run({ task: 'T', steps: [r1, gate({ goto: 'gate:g1', maxLoops: 2 })], send });
    expect(result.stopReason).toBe('loop_limit');
    expect(calls.map((call) => call.models[0])).toEqual(['A', 'B', 'B', 'B']);
    expect(result.state.loopCounters).toEqual({ 'gate:g1:onFail': 2 });
  });

  test('stop names its reason as the stop reason; the step result stays in the history', async () => {
    const { send, calls } = transport({ A: ['карта'], B: [FAIL('срок')] });
    const result = await Engine.run({ task: 'T', steps: [r1, gate({ stop: 'нужна ручная проверка' }), r2], send });
    expect(result.stopReason).toBe('нужна ручная проверка');
    expect(calls).toHaveLength(2);
    expect(result.steps.map((step) => step.ref)).toEqual(['r1', 'gate:g1']);
  });

  test('a return with no stored continuation point stops the run before any request: return_missing', async () => {
    const { send, calls } = transport({ A: ['карта'], B: [FAIL('срок')] });
    const result = await Engine.run({ task: 'T', steps: [r1, gate({ return: true })], send });
    expect(result.stopReason).toBe('return_missing');
    expect(calls).toHaveLength(2);
  });

  test('a backward transition without maxLoops, a limit outside 1..5, an unknown target: refused before the first request', async () => {
    const cases = [
      [gate({ goto: 'r1' }), 'invalid_field', 'maxLoops'],
      [gate({ goto: 'r1', maxLoops: 6 }), 'invalid_field', 'maxLoops'],
      [gate({ goto: 'nope', maxLoops: 1 }), 'unknown_target', 'nope'],
      [gate({ goto: 'r1', maxLoops: 1, stop: 'x' }), 'invalid_field', 'onFail'],
      [gate({ stop: '   ' }), 'invalid_field', 'onFail'],
    ];
    for (const [step, code, mention] of cases) {
      const { send, calls } = transport({ A: ['a'], B: [FAIL('x')], C: ['c'] });
      const error = await Engine.run({ task: 'T', steps: [r1, step, r2], send }).catch((item) => item);
      expect(error).toBeInstanceOf(Engine.EngineError);
      expect(error.code).toBe(code);
      expect(error.message).toContain(mention);
      expect(calls).toHaveLength(0);
    }
  });

  test('onPass: a passing gate takes its transition; the step after it is the target, not the next step', async () => {
    // G1 passes on its first visit and goes to r3, skipping r2; on the second visit it passes and goes on to r2.
    const steps = [r1, gate(undefined, { onPass: { goto: 'r3' } }), r2, { ref: 'r3', kind: 'round', models: ['D'] }];
    const { send, calls } = transport({ A: ['v1'], B: [PASS], C: ['c'], D: ['d'] });
    const result = await Engine.run({ task: 'T', steps, send });
    expect(result.stopReason).toBe('steps_done');
    expect(calls.map((call) => call.models[0])).toEqual(['A', 'B', 'D']);
    expect(result.steps.map((step) => step.ref)).toEqual(['r1', 'gate:g1', 'r3']);
  });

  test('the journal names the transition: from, case, action, target and the count of the loop', async () => {
    const { send } = transport({ A: ['v1', 'v2'], B: [FAIL('срок'), PASS], C: ['итог'] });
    const events = [];
    await Engine.run({ task: 'T', steps: [r1, gate({ goto: 'r1', maxLoops: 1 }), r2], send, onEvent: (kind, fields) => events.push([kind, fields]) });
    expect(events).toContainEqual(['custom_transition', expect.objectContaining({ from: 'gate:g1', case: 'onFail', action: 'goto', to: 'r1', count: 1, maxLoops: 1 })]);
  });
});
