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
const gate = (extra = {}) => ({ ref: 'gate:g1', kind: 'gate', criteria: ['есть источники'], models: ['B', 'C'], ...extra });
const after = { ref: 'r2', kind: 'round', models: ['A'] };
const first = { ref: 'r1', kind: 'round', input: 'none', models: ['A'] };

describe('Custom engine gate (6.1)', () => {
  test('pass all: two checkers pass, the run goes on to the next step; the event names the verdict', async () => {
    const { send, calls } = transport({ A: ['карта', 'итог'], B: [PASS], C: [PASS] });
    const events = [];
    const result = await Engine.run({ task: 'T', steps: [first, gate(), after], send, onEvent: (kind, fields) => events.push([kind, fields]) });
    expect(result.stopReason).toBe('steps_done');
    expect(calls.map((call) => call.models)).toEqual([['A'], ['B', 'C'], ['A']]);
    expect(events).toContainEqual(['custom_gate', expect.objectContaining({ ref: 'gate:g1', pass: true })]);
  });

  test('the checker gets the criteria and the verdict instruction; its request is an answer phase of the gate', async () => {
    const { send, calls } = transport({ A: ['карта'], B: [PASS], C: [PASS] });
    await Engine.run({ task: 'T', steps: [first, gate()], send });
    expect(calls[1].prompts.B).toContain('есть источники');
    expect(calls[1].prompts.B).toContain('ВЕРДИКТ: НЕ ПРОШЁЛ');
    expect(calls[1].meta).toMatchObject({ phase: 'answer', stepRef: 'gate:g1', visit: 1 });
  });

  test('pass all: one fail stops the run with gate_failed; the next step is not sent; the unmet criterion is named', async () => {
    const { send, calls } = transport({ A: ['карта', 'итог'], B: [PASS], C: [FAIL('нет источников')] });
    const result = await Engine.run({ task: 'T', steps: [first, gate(), after], send });
    expect(result.stopReason).toBe('gate_failed');
    expect(result.stopDetail).toContain('нет источников');
    expect(calls.map((call) => call.models)).toEqual([['A'], ['B', 'C']]);
  });

  test('pass any: one passing checker passes the gate even when another fails', async () => {
    const { send, calls } = transport({ A: ['карта', 'итог'], B: [FAIL('срок')], C: [PASS] });
    const result = await Engine.run({ task: 'T', steps: [first, gate({ pass: 'any' }), after], send });
    expect(result.stopReason).toBe('steps_done');
    expect(calls).toHaveLength(3);
  });

  test('an answer without a verdict is corrected in the same chat; only that checker is sent again', async () => {
    const { send, calls } = transport({ A: ['карта', 'итог'], B: ['без вердикта', PASS], C: [PASS] });
    const result = await Engine.run({ task: 'T', steps: [first, gate(), after], send });
    expect(result.stopReason).toBe('steps_done');
    // Calls: the first step, the two checkers, the correction of B alone, the second step.
    expect(calls.map((call) => call.models)).toEqual([['A'], ['B', 'C'], ['B'], ['A']]);
    expect(calls[2].prompts.B).toContain('без вердикта');
    expect(calls[2].meta.attempt).toBe(2);
  });

  test('no verdict twice: the checker is not accepted, the owner gets no continue and skip makes the gate fail', async () => {
    const { send } = transport({ A: ['карта'], B: [PASS], C: ['без вердикта', 'снова без вердикта'] });
    const decide = jest.fn(async () => 'skip');
    const result = await Engine.run({ task: 'T', steps: [first, gate({ require: 'all' }), after], send, decide });
    expect(decide.mock.calls[0][0].choices).toEqual(['retry', 'skip', 'stop']);
    expect(result.stopReason).toBe('gate_failed');
  });

  test('require all: below the threshold the gate does not pass on the verdicts it has; stop ends the run', async () => {
    const { send, calls } = transport({ A: ['карта'], B: [PASS], C: [] });
    const decide = jest.fn(async () => 'stop');
    const result = await Engine.run({ task: 'T', steps: [first, gate({ require: 'all' }), after], send, decide });
    expect(result.stopReason).toBe('stopped');
    expect(calls.map((call) => call.models)).toEqual([['A'], ['B', 'C'], ['C']]);
  });

  test('onFail ask: the owner decides; continue goes on past the failed gate, stop ends the run', async () => {
    const goOn = jest.fn(async () => 'continue');
    const passed = await Engine.run({ task: 'T', steps: [first, gate({ onFail: 'ask' }), after], send: transport({ A: ['карта', 'итог'], B: [PASS], C: [FAIL('срок')] }).send, decide: goOn });
    expect(goOn.mock.calls[0][0].choices).toEqual(['continue', 'stop']);
    expect(passed.stopReason).toBe('steps_done');

    const stopped = await Engine.run({ task: 'T', steps: [first, gate({ onFail: 'ask' }), after], send: transport({ A: ['карта'], B: [PASS], C: [FAIL('срок')] }).send, decide: async () => 'stop' });
    expect(stopped.stopReason).toBe('stopped');
  });

  test('onFail ask without an owner decision is no_decision: the failed gate never goes on by itself', async () => {
    const { send, calls } = transport({ A: ['карта', 'итог'], B: [PASS], C: [FAIL('срок')] });
    const result = await Engine.run({ task: 'T', steps: [first, gate({ onFail: 'ask' }), after], send });
    expect(result.stopReason).toBe('no_decision');
    expect(calls).toHaveLength(2);
  });

  test('a json gate: the verdict is in the fields; a fail names the unmet criteria', async () => {
    const output = { format: 'json', requiredFields: ['/note'] };
    const failed = await Engine.run({ task: 'T', steps: [first, gate({ output }), after],
      send: transport({ A: ['карта'], B: ['{"verdict":"fail","unmet":["срок"],"note":"x"}'], C: ['{"verdict":"pass","note":"y"}'] }).send });
    expect(failed.stopReason).toBe('gate_failed');
    expect(failed.stopDetail).toContain('срок');

    const passed = await Engine.run({ task: 'T', steps: [first, gate({ output }), after],
      send: transport({ A: ['карта', 'итог'], B: ['{"verdict":"pass","note":"x"}'], C: ['{"verdict":"pass","note":"y"}'] }).send });
    expect(passed.stopReason).toBe('steps_done');
  });

  test('a json gate without unmet on fail is corrected as no_verdict', async () => {
    const output = { format: 'json', requiredFields: ['/note'] };
    const { send, calls } = transport({ A: ['карта', 'итог'], B: ['{"verdict":"fail","note":"x"}', '{"verdict":"pass","note":"x"}'], C: ['{"verdict":"pass","note":"y"}'] });
    const result = await Engine.run({ task: 'T', steps: [first, gate({ output }), after], send });
    expect(result.stopReason).toBe('steps_done');
    expect(calls[2].prompts.B).toContain('без вердикта');
  });
});
