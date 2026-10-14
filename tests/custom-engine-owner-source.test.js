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

// The owner's replies, one per call: a text, a file object, null (cancel) or '' (empty). Every request is kept with its input.
function owner(replies) {
  const calls = [];
  let index = 0;
  const provideOwnerResult = async (request) => {
    calls.push(request);
    const reply = replies[index];
    index += 1;
    return reply === undefined ? null : reply;
  };
  return { provideOwnerResult, calls };
}

const R1 = { ref: 'r1', kind: 'round', input: 'none', models: ['A'] };
const OWNER = (extra = {}) => ({ ref: 'owner:evidence', kind: 'owner', task: 'Предоставьте исследование', ...extra });
const EVIDENCE = { step: 'owner:evidence', participant: 'owner', id: 'evidence' };

describe('Custom engine: the owner as a participant of its step (R08, ТЗ 3.3)', () => {
  test('an artifact of the owner step is the input of a model: the owner text is data, not a model answer', async () => {
    const steps = [
      OWNER({ output: { artifacts: [{ id: 'evidence', name: 'Доказательство', pointer: '' }] } }),
      { ref: 'S2', kind: 'round', input: [{ artifact: EVIDENCE, version: 'latest', required: true }], models: ['A'] }
    ];
    const { send, calls } = transport({ A: ['ок'] });
    const { provideOwnerResult } = owner(['Факты: 1']);
    const result = await Engine.run({ task: 'T', steps, send, provideOwnerResult, maxAttempts: 1 });
    expect(result.stopReason).toBe('steps_done');
    expect(calls.map((call) => call.models)).toEqual([['A']]);
    expect(calls[0].prompts.A).toContain('Факты: 1');
    expect(result.history.some((entry) => entry.participant === 'owner')).toBe(false);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({ id: 'evidence', lineage: EVIDENCE, source: { participant: 'owner' } });
  });

  test('an artifact that the owner step does not declare is refused before the first request, with the address', async () => {
    const steps = [
      OWNER({ output: { artifacts: [{ id: 'evidence', name: 'Доказательство', pointer: '' }] } }),
      { ref: 'S2', kind: 'round', input: [{ artifact: { ...EVIDENCE, id: 'other' }, version: 'latest', required: true }], models: ['A'] }
    ];
    const { send, calls } = transport({ A: ['ок'] });
    const { provideOwnerResult, calls: asked } = owner(['Факты']);
    await expect(Engine.run({ task: 'T', steps, send, provideOwnerResult })).rejects.toMatchObject({ code: 'invalid_input', address: expect.stringContaining('шаг «S2»') });
    expect(calls).toEqual([]);
    expect(asked).toEqual([]);
  });

  test('a source that names another participant of the owner step is refused before the first request', async () => {
    const steps = [OWNER(), { ref: 'S2', kind: 'round', input: [{ step: 'owner:evidence', participant: 'A', required: true }], models: ['A'] }];
    const { send, calls } = transport({ A: ['ок'] });
    const { provideOwnerResult } = owner(['Факты']);
    await expect(Engine.run({ task: 'T', steps, send, provideOwnerResult })).rejects.toMatchObject({ code: 'invalid_input', address: expect.stringContaining('шаг «S2»') });
    expect(calls).toEqual([]);
  });

  test('a model with the id owner in a round is still a model: the owner step does not change it', async () => {
    const steps = [OWNER(), { ref: 'S2', kind: 'round', input: 'none', models: [{ name: 'A', id: 'owner' }] }];
    const { send, calls } = transport({ A: ['ок'] });
    const { provideOwnerResult } = owner(['Факты']);
    const result = await Engine.run({ task: 'T', steps, send, provideOwnerResult, maxAttempts: 1 });
    expect(result.stopReason).toBe('steps_done');
    expect(calls[0].models).toEqual(['A']);
    expect(result.history.find((entry) => entry.model === 'A').participant).toBe('owner');
  });
});

describe('Custom engine: the owner as a source of a revision and of feedback (R08, ТЗ 3.3)', () => {
  test('a model revises an artifact of the owner step: the revision joins the owner line, the author is the model', async () => {
    const steps = [
      OWNER({ output: { artifacts: [{ id: 'evidence', name: 'Доказательство', pointer: '' }] } }),
      { ref: 'S2', kind: 'round', input: 'none', models: [{ name: 'A', id: 'A',
        input: [{ artifact: EVIDENCE, version: 'latest', required: true }],
        output: { artifacts: [{ id: 'evidence', name: 'Доработка', pointer: '', revisionOf: { artifact: EVIDENCE, version: 'latest', required: true } }] } }] }
    ];
    const { send } = transport({ A: ['доработано'] });
    const { provideOwnerResult } = owner(['Факты: 1']);
    const result = await Engine.run({ task: 'T', steps, send, provideOwnerResult, maxAttempts: 1 });
    expect(result.stopReason).toBe('steps_done');
    expect(result.artifacts.map((entry) => [entry.lineage.participant, entry.source.participant])).toEqual([['owner', 'owner'], ['owner', 'A']]);
    expect(result.texts[result.artifacts[1].content.answerRef]).toBe('доработано');
  });

  test('an owner revision joins the line of the artifact it got as input; the owner must get that artifact', async () => {
    const source = { ...EVIDENCE, step: 'owner:first' };
    const steps = [
      OWNER({ ref: 'owner:first', output: { artifacts: [{ id: 'evidence', name: 'Первое', pointer: '' }] } }),
      OWNER({ ref: 'owner:second', input: [{ artifact: source, version: 'latest', required: true }],
        output: { artifacts: [{ id: 'evidence', name: 'Исправлено', pointer: '', revisionOf: { artifact: source, version: 'latest', required: true } }] } }),
      { ref: 'S3', kind: 'round', input: [{ artifact: source, version: 'latest', required: true }], models: ['A'] }
    ];
    const { send, calls } = transport({ A: ['ок'] });
    const { provideOwnerResult, calls: asked } = owner(['Первая версия', 'Вторая версия']);
    const result = await Engine.run({ task: 'T', steps, send, provideOwnerResult, maxAttempts: 1 });
    expect(result.stopReason).toBe('steps_done');
    expect(asked[1].input[0]).toMatchObject({ step: 'owner:first', text: 'Первая версия' });
    expect(result.artifacts.map((entry) => entry.lineage.step)).toEqual(['owner:first', 'owner:first']);
    expect(calls[0].prompts.A).toContain('Вторая версия');
    expect(calls[0].prompts.A).not.toContain('Первая версия');
  });

  test('an owner revision without its artifact in the owner input is refused before the first request', async () => {
    const source = { ...EVIDENCE, step: 'owner:first' };
    const steps = [
      OWNER({ ref: 'owner:first', output: { artifacts: [{ id: 'evidence', name: 'Первое', pointer: '' }] } }),
      OWNER({ ref: 'owner:second', output: { artifacts: [{ id: 'evidence', name: 'Исправлено', pointer: '', revisionOf: { artifact: source, version: 'latest', required: true } }] } })
    ];
    const { send, calls } = transport({});
    const { provideOwnerResult, calls: asked } = owner(['Первая версия', 'Вторая версия']);
    await expect(Engine.run({ task: 'T', steps, send, provideOwnerResult })).rejects.toMatchObject({ code: 'invalid_input', address: expect.stringContaining('шаг «owner:second»') });
    expect(calls).toEqual([]);
    expect(asked).toEqual([]);
  });

  test('the feedback of the owner goes to the next visit of the author only, as its text', async () => {
    const steps = [
      OWNER({ ref: 'owner:o' }),
      { ref: 'r1', kind: 'round', input: 'none', models: ['A'] },
      { ref: 'g', kind: 'gate', input: 'previous', criteria: ['check'], models: ['G'],
        onFail: { goto: 'r1', maxLoops: 1, feedback: ['owner:o'] } }
    ];
    const { send, calls } = transport({ A: ['a1', 'a2'], G: ['НЕ ВЫПОЛНЕНО: check\nВЕРДИКТ: НЕ ПРОШЁЛ', 'ВЕРДИКТ: ПРОШЁЛ'] });
    const { provideOwnerResult } = owner(['Замечание владельца']);
    const result = await Engine.run({ task: 'T', steps, send, provideOwnerResult, maxAttempts: 1 });
    expect(result.stopReason).toBe('steps_done');
    const author = calls.filter((call) => call.models.includes('A'));
    expect(author[0].prompts.A).not.toContain('Замечание владельца');
    expect(author[1].prompts.A).toContain('Замечание владельца');
    expect(calls.some((call) => call.models.includes('owner'))).toBe(false);
  });
});

describe('Custom engine: the input of the owner step (N07, ТЗ 3.3)', () => {
  test('the owner window gets the accepted answer of a participant with its address, the text and the visit', async () => {
    const steps = [R1, OWNER({ input: [{ step: 'r1', required: true }] })];
    const { send, calls } = transport({ A: ['ответ A'] });
    const { provideOwnerResult, calls: asked } = owner(['Итог']);
    const result = await Engine.run({ task: 'T', steps, send, provideOwnerResult, maxAttempts: 1 });
    expect(result.stopReason).toBe('steps_done');
    expect(calls.map((call) => call.models)).toEqual([['A']]);
    expect(asked[0].input).toEqual([expect.objectContaining({ step: 'r1', participant: 'A', visit: 1, text: 'ответ A' })]);
    expect(asked[0].input[0]).not.toHaveProperty('file');
  });

  test('a required input that did not get an answer blocks the owner window: nothing is asked', async () => {
    const steps = [{ ...R1, models: ['A'] }, OWNER({ input: [{ step: 'r1', required: true }] })];
    const { send } = transport({ A: [''] });
    const { provideOwnerResult, calls: asked } = owner(['Итог']);
    const result = await Engine.run({ task: 'T', steps, send, provideOwnerResult, maxAttempts: 1, decide: async () => 'skip' });
    expect(result.stopReason).toBe('missing_input');
    expect(result.stopDetail).toContain('шаг «r1»');
    expect(asked).toEqual([]);
  });

  test('an optional input that did not get an answer gives the owner an empty input', async () => {
    const steps = [{ ...R1, models: ['A'] }, OWNER({ input: ['r1'] })];
    const { send } = transport({ A: [''] });
    const { provideOwnerResult, calls: asked } = owner(['Итог']);
    const result = await Engine.run({ task: 'T', steps, send, provideOwnerResult, maxAttempts: 1, decide: async () => 'skip' });
    expect(result.stopReason).toBe('steps_done');
    expect(asked[0].input).toEqual([]);
  });

  test('a binary file of an owner step reaches the next owner as a file reference, never as text, and is not refused', async () => {
    const steps = [
      OWNER({ ref: 'owner:file' }),
      OWNER({ ref: 'owner:review', input: ['owner:file'] })
    ];
    const { send } = transport({});
    const { provideOwnerResult, calls: asked } = owner([
      { file: { name: 'scan.pdf', mime: 'application/pdf', size: 10, ref: 'file-1' } },
      'Обзор'
    ]);
    const result = await Engine.run({ task: 'T', steps, send, provideOwnerResult });
    expect(result.stopReason).toBe('steps_done');
    expect(asked[1].input).toEqual([expect.objectContaining({ step: 'owner:file', participant: 'owner', visit: 1, file: expect.objectContaining({ ref: 'file-1', name: 'scan.pdf' }) })]);
    expect(asked[1].input[0]).not.toHaveProperty('text');
  });

  test('a changed source invalidates the owner answer built on it: the owner is asked again with the new answer', async () => {
    const gate = { ref: 'g', kind: 'gate', input: 'previous', criteria: ['check'], models: ['G'], onFail: { goto: 'r1', maxLoops: 1 } };
    const steps = [R1, OWNER({ input: [{ step: 'r1', required: true }] }), gate];
    const { send } = transport({
      A: ['a1', 'a2'],
      G: ['НЕ ВЫПОЛНЕНО: check\nВЕРДИКТ: НЕ ПРОШЁЛ', 'ВЕРДИКТ: ПРОШЁЛ']
    });
    const { provideOwnerResult, calls: asked } = owner(['Ответ 1', 'Ответ 2']);
    const result = await Engine.run({ task: 'T', steps, send, provideOwnerResult, maxAttempts: 1 });
    expect(result.stopReason).toBe('steps_done');
    expect(asked.map((request) => request.input[0].text)).toEqual(['a1', 'a2']);
  });
});
