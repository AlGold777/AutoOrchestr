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

const r1 = { ref: 'r1', kind: 'round', input: 'none', models: ['A'] };
// A check is an ordinary round: its criteria are in the task, and its answer is an answer like any other.
const check = { ref: 'r2', kind: 'round', task: 'Проверь по критериям: полнота. Перечисли невыполненные.', models: ['B'] };
const decision = { ref: 'owner:ok', kind: 'owner', input: 'previous', task: 'Прочитайте проверку и решите, что делать дальше' };
const r3 = { ref: 'r3', kind: 'round', input: 'all', models: ['C'] };

describe('Custom engine: a linear run of rounds and an owner step (no branches, no transitions)', () => {
  test('the steps run in their order; the owner decides by its answer, the next round reads it', async () => {
    const { send, calls } = transport({ A: ['карта'], B: ['не выполнено: полнота'], C: ['итог'] });
    const events = [];
    const result = await Engine.run({ task: 'T', steps: [r1, check, decision, r3], send,
      provideOwnerResult: async () => 'Доработать раздел о сроках', onEvent: (kind) => events.push(kind) });
    expect(result.stopReason).toBe('steps_done');
    expect(calls.map((call) => call.models[0])).toEqual(['A', 'B', 'C']);
    expect(result.steps.map((step) => [step.ref, step.visit])).toEqual([['r1', 1], ['r2', 1], ['owner:ok', 1], ['r3', 1]]);
    expect(calls[2].prompts.C).toContain('Доработать раздел о сроках');
    expect(events.some((kind) => /gate|route|transition/.test(kind))).toBe(false);
    expect(result.state.visits).toEqual({ r1: 1, r2: 1, 'owner:ok': 1, r3: 1 });
    ['loopCounters', 'continuationStack', 'feedback', 'dependencies', 'routes'].forEach((field) => expect(result.state).not.toHaveProperty(field));
  });

  test('a technical retry of an answer keeps its visit; only the attempt counts up', async () => {
    const { send, calls } = transport({ A: ['', 'карта'], B: ['проверка'] });
    await Engine.run({ task: 'T', steps: [r1, check], send });
    expect(calls[0].meta).toMatchObject({ attempt: 1, visit: 1 });
    expect(calls[1].meta).toMatchObject({ attempt: 2, visit: 1 });
  });

  test('a gate or a route step is refused before the first request: the engine does not execute these kinds', async () => {
    const removed = [
      { ref: 'gate:g1', kind: 'gate', criteria: ['полнота'], models: ['B'], onFail: { goto: 'r3' } },
      { ref: 'route:x', kind: 'route', models: [], select: { by: 'owner', cases: [{ id: 'a', label: 'A', action: { goto: 'r3' } }] } }
    ];
    for (const step of removed) {
      const { send, calls } = transport({ A: ['a'], B: ['b'], C: ['c'] });
      const error = await Engine.run({ task: 'T', steps: [r1, step, r3], send }).catch((item) => item);
      expect(error).toBeInstanceOf(Engine.EngineError);
      expect(error.code).toBe('unsupported_kind');
      expect(error.message).toContain(step.kind);
      expect(calls).toHaveLength(0);
    }
  });
});
