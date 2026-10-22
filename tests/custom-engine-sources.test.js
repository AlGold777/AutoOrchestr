const Engine = require('../disput/custom-engine');

// A scripted transport (as in custom-engine-owner.test.js): answers[model] is a list of replies, one per request to that model.
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
      byModel[model] = { text: reply || '', status: reply ? 'SUCCESS' : 'TIMEOUT' };
    });
    return { byModel, closedByOwner: false };
  };
  return { send, calls };
}

const sentTo = (calls, model) => calls.filter((call) => call.models.includes(model));

// Round r1 gives its answers; r2 (model C) takes r1 as a whole result (3.1).
const R1 = (extra = {}) => ({ ref: 'r1', kind: 'round', input: 'none', models: ['A', 'B'], ...extra });
const R2 = (source, extra = {}) => ({ ref: 'r2', kind: 'round', input: [source], models: ['C'], ...extra });

describe('Custom engine: a required whole-step source (D3, ТЗ 3.1)', () => {
  test('{ step, required } gives every accepted answer of the step, in the order of its participants', async () => {
    const { send, calls } = transport({ A: ['ответ A'], B: ['ответ B'], C: ['ок'] });
    const result = await Engine.run({ task: 'T', steps: [R1({ models: ['B', 'A'] }), R2({ step: 'r1', required: true })], send, maxAttempts: 1 });
    expect(result.stopReason).toBe('steps_done');
    const prompt = sentTo(calls, 'C')[0].prompts.C;
    expect(prompt).toContain('ответ A');
    expect(prompt).toContain('ответ B');
    expect(prompt.indexOf('ответ B')).toBeLessThan(prompt.indexOf('ответ A'));
  });

  test('a participant that did not answer is left out when the threshold of the step is met', async () => {
    const { send, calls } = transport({ A: ['ответ A'], B: [''], C: ['ок'] });
    const result = await Engine.run({ task: 'T', steps: [R1({ require: 1 }), R2({ step: 'r1', required: true })], send, maxAttempts: 1 });
    expect(result.stopReason).toBe('steps_done');
    const prompt = sentTo(calls, 'C')[0].prompts.C;
    expect(prompt).toContain('ответ A');
    expect(prompt).not.toContain('участник B');
  });

  test('a required whole result below the threshold (require all, one failed) is missing: no request to C', async () => {
    const { send, calls } = transport({ A: ['ответ A'], B: [''], C: ['ок'] });
    const result = await Engine.run({ task: 'T', steps: [R1({ require: 'all' }), R2({ step: 'r1', required: true })], send, maxAttempts: 1, decide: async () => 'skip' });
    expect(result.stopReason).toBe('missing_input');
    expect(result.stopDetail).toContain('шаг «r1»');
    expect(sentTo(calls, 'C')).toEqual([]);
  });

  test('a skipped required source stops the run before the request of the consumer, with its address', async () => {
    const { send, calls } = transport({ A: [''], B: [''], C: ['ок'] });
    const result = await Engine.run({ task: 'T', steps: [R1({ models: ['A'] }), R2({ step: 'r1', required: true })], send, maxAttempts: 1, decide: async () => 'skip' });
    expect(result.stopReason).toBe('missing_input');
    expect(result.stopDetail).toContain('шаг «r1» не дал принятого ответа');
    expect(result.stopDetail).toContain('шаг «r2» не отправлен');
    expect(sentTo(calls, 'C')).toEqual([]);
  });

  test('a required source that names a switched-off step is missing before the request', async () => {
    const { send, calls } = transport({ C: ['ок'] });
    const result = await Engine.run({ task: 'T', steps: [R2({ step: 'r9', required: true })], send, maxAttempts: 1 });
    expect(result.stopReason).toBe('missing_input');
    expect(result.stopDetail).toContain('шаг «r9»');
    expect(calls).toEqual([]);
  });

  test('a participant source stays exact: a required participant that did not answer is missing, the others do not matter', async () => {
    const { send, calls } = transport({ A: ['ответ A'], B: [''], C: ['ок'] });
    const result = await Engine.run({ task: 'T', steps: [R1({ require: 1 }), R2({ step: 'r1', participant: 'B', required: true })], send, maxAttempts: 1 });
    expect(result.stopReason).toBe('missing_input');
    expect(result.stopDetail).toContain('участник «B»');
    expect(sentTo(calls, 'C')).toEqual([]);
  });

  test('a string reference stays optional: a skipped step gives nothing and the consumer is still asked', async () => {
    const { send, calls } = transport({ A: [''], C: ['ок'] });
    const result = await Engine.run({ task: 'T', steps: [R1({ models: ['A'] }), R2('r1')], send, maxAttempts: 1, decide: async () => 'skip' });
    expect(result.stopReason).toBe('steps_done');
    expect(sentTo(calls, 'C')).toHaveLength(1);
  });

  test('a required gate that did not pass gives no input: the consumer is missing before its request', async () => {
    const { send, calls } = transport({ A: ['ответ A'], G: ['НЕ ВЫПОЛНЕНО: check\nВЕРДИКТ: НЕ ПРОШЁЛ'], C: ['ок'] });
    const gate = { ref: 'g', kind: 'gate', input: 'previous', criteria: ['check'], models: ['G'], onFail: 'ask' };
    const steps = [R1({ models: ['A'] }), gate, R2({ step: 'g', required: true })];
    const result = await Engine.run({ task: 'T', steps, send, maxAttempts: 1, decide: async () => 'continue' });
    expect(result.stopReason).toBe('missing_input');
    expect(result.stopDetail).toContain('шаг «g» не прошёл проверку');
    expect(sentTo(calls, 'C')).toEqual([]);
  });

  test('a whole-step source to a later step is refused before the first request, with the address', async () => {
    const { send, calls } = transport({ A: ['ок'], C: ['ок'] });
    const steps = [R1({ models: ['A'], input: [{ step: 'r2', required: true }] }), R2('r1')];
    await expect(Engine.run({ task: 'T', steps, send })).rejects.toMatchObject({ code: 'invalid_input', address: expect.stringContaining('шаг «r1»') });
    expect(calls).toEqual([]);
  });
});
