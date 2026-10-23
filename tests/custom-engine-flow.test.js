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

describe('Custom engine transitions: forward only (6.3)', () => {
  const r3 = { ref: 'r3', kind: 'round', models: ['D'] };

  test('a technical retry of an answer keeps its visit; only the attempt counts up', async () => {
    const { send, calls } = transport({ A: ['', 'карта'], B: [PASS] });
    await Engine.run({ task: 'T', steps: [r1, gate(undefined)], send });
    expect(calls[0].meta).toMatchObject({ attempt: 1, visit: 1 });
    expect(calls[1].meta).toMatchObject({ attempt: 2, visit: 1 });
  });

  test('onFail goto forward skips the steps between: the failed gate goes on to the target', async () => {
    const { send, calls } = transport({ A: ['карта'], B: [FAIL('срок')], D: ['d'] });
    const result = await Engine.run({ task: 'T', steps: [r1, gate({ goto: 'r3' }), r2, r3], send });
    expect(result.stopReason).toBe('steps_done');
    expect(calls.map((call) => call.models[0])).toEqual(['A', 'B', 'D']);
    expect(result.steps.map((step) => [step.ref, step.visit])).toEqual([['r1', 1], ['gate:g1', 1], ['r3', 1]]);
  });

  test('stop names its reason as the stop reason; the step result stays in the history', async () => {
    const { send, calls } = transport({ A: ['карта'], B: [FAIL('срок')] });
    const result = await Engine.run({ task: 'T', steps: [r1, gate({ stop: 'нужна ручная проверка' }), r2], send });
    expect(result.stopReason).toBe('нужна ручная проверка');
    expect(calls).toHaveLength(2);
    expect(result.steps.map((step) => step.ref)).toEqual(['r1', 'gate:g1']);
  });

  test('a goto to the current or an earlier step is refused before the first request, with the new text', async () => {
    for (const target of ['r1', 'gate:g1']) {
      const { send, calls } = transport({ A: ['a'], B: [FAIL('x')], C: ['c'] });
      const error = await Engine.run({ task: 'T', steps: [r1, gate({ goto: target }), r2], send }).catch((item) => item);
      expect(error).toBeInstanceOf(Engine.EngineError);
      expect(error.code).toBe('invalid_field');
      expect(error.message).toContain('возврат назад не поддерживается: добавьте обычный шаг ниже по списку');
      expect(calls).toHaveLength(0);
    }
  });

  test('return, maxLoops, feedback, invalidate and resumeAt are refused before the first request', async () => {
    const cases = [{ return: true }, { goto: 'r2', maxLoops: 1 }, { goto: 'r2', feedback: [{ step: 'r1', participant: 'A' }] },
      { goto: 'r2', invalidate: ['r1'] }, { goto: 'r2', resumeAt: 'r1' }];
    for (const action of cases) {
      const { send, calls } = transport({ A: ['a'], B: [FAIL('x')], C: ['c'] });
      const error = await Engine.run({ task: 'T', steps: [r1, gate(action), r2], send }).catch((item) => item);
      expect(error).toBeInstanceOf(Engine.EngineError);
      expect(error.message).toContain('возврат назад не поддерживается');
      expect(calls).toHaveLength(0);
    }
  });

  test('an unknown target, an empty stop and two actions at once are refused before the first request', async () => {
    const cases = [
      [gate({ goto: 'nope' }), 'unknown_target', 'nope'],
      [gate({ goto: 'r2', stop: 'x' }), 'invalid_field', 'onFail'],
      [gate({ stop: '   ' }), 'invalid_field', 'onFail']
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
    const steps = [r1, gate(undefined, { onPass: { goto: 'r3' } }), r2, { ref: 'r3', kind: 'round', models: ['D'] }];
    const { send, calls } = transport({ A: ['v1'], B: [PASS], C: ['c'], D: ['d'] });
    const result = await Engine.run({ task: 'T', steps, send });
    expect(result.stopReason).toBe('steps_done');
    expect(calls.map((call) => call.models[0])).toEqual(['A', 'B', 'D']);
    expect(result.steps.map((step) => step.ref)).toEqual(['r1', 'gate:g1', 'r3']);
  });

  test('the journal names the transition: from, case, action and target', async () => {
    const { send } = transport({ A: ['v1'], B: [FAIL('срок')], D: ['d'] });
    const events = [];
    await Engine.run({ task: 'T', steps: [r1, gate({ goto: 'r3' }), r2, r3], send, onEvent: (kind, fields) => events.push([kind, fields]) });
    expect(events).toContainEqual(['custom_transition', { from: 'gate:g1', case: 'onFail', action: 'goto', to: 'r3' }]);
  });

  test('the state of the run has no counters, stack or feedback: only the pointer, the visits and the decisions', async () => {
    const { send } = transport({ A: ['v1'], B: [PASS], C: ['c'] });
    const result = await Engine.run({ task: 'T', steps: [r1, gate(undefined), r2], send });
    ['loopCounters', 'continuationStack', 'feedback', 'dependencies'].forEach((field) => expect(result.state).not.toHaveProperty(field));
    expect(result.state.visits).toEqual({ r1: 1, 'gate:g1': 1, r2: 1 });
  });
});
