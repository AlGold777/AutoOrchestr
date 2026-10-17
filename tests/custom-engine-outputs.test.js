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

// The output of one author: its own artifact of the line `proposal` (pointer /map).
const own = (id, name = `Предложение ${id}`) => ({ format: 'json', requiredFields: ['/map'], artifacts: [{ id: 'proposal', name, pointer: '/map' }] });
const lineOf = (id) => ({ step: 'r1', participant: id, id: 'proposal' });
const revisionFrom = (id) => ({ format: 'json', requiredFields: ['/map'], artifacts: [{ id: 'proposal', name: `Доработка ${id}`, pointer: '/map',
  revisionOf: { artifact: lineOf(id), version: 'latest', required: true } }] });
const inputOf = (id) => [{ artifact: lineOf(id), version: 'latest', required: true }];

// Two authors of one parallel round (r1), each with its own line; in r2 both revise their own line, in one request.
const R1 = { ref: 'r1', kind: 'round', input: 'none', models: [
  { name: 'A', id: 'A', output: own('A') }, { name: 'B', id: 'B', output: own('B') }
] };
const R2 = { ref: 'r2', kind: 'round', input: 'none', models: [
  { name: 'A', id: 'A', input: inputOf('A'), output: revisionFrom('A') },
  { name: 'B', id: 'B', input: inputOf('B'), output: revisionFrom('B') }
] };
const R3 = { ref: 'r3', kind: 'round', input: [{ artifact: lineOf('A'), version: 'latest', required: true }], models: ['C'] };

describe('Custom engine: an individual output of a participant (D4, ТЗ 3.2)', () => {
  test('two authors of one parallel step keep their own lines: each revision continues the line of its author', async () => {
    const { send, calls } = transport({ A: ['{"map":"a1"}', '{"map":"a2"}'], B: ['{"map":"b1"}', '{"map":"b2"}'], C: ['ок'] });
    const result = await Engine.run({ task: 'T', steps: [R1, R2, R3], send, maxAttempts: 1 });
    expect(result.stopReason).toBe('steps_done');
    // r2 is one parallel request to both authors, not two technical steps.
    expect(calls[1].models).toEqual(['A', 'B']);
    expect(calls[1].prompts.A).toContain('a1');
    expect(calls[1].prompts.A).not.toContain('b1');
    expect(calls[1].prompts.B).toContain('b1');
    expect(calls[1].prompts.B).not.toContain('a1');
    const lineA = result.artifacts.filter((entry) => entry.lineage.participant === 'A');
    const lineB = result.artifacts.filter((entry) => entry.lineage.participant === 'B');
    expect(lineA.map((entry) => entry.source.participant)).toEqual(['A', 'A']);
    expect(lineB.map((entry) => entry.source.participant)).toEqual(['B', 'B']);
    expect(lineA.map((entry) => result.texts[entry.content.answerRef])).toEqual(['{"map":"a1"}', '{"map":"a2"}']);
    expect(lineB.map((entry) => result.texts[entry.content.answerRef])).toEqual(['{"map":"b1"}', '{"map":"b2"}']);
    // The consumer of the line of A gets its latest version only: the revision of A.
    expect(calls[2].prompts.C).toContain('a2');
    expect(calls[2].prompts.C).not.toContain('b2');
  });

  test('a revision that names a line its author does not get is refused before the first request, with the address', async () => {
    const { send, calls } = transport({ A: ['{"map":"a1"}'], B: ['{"map":"b1"}'] });
    const bad = { ...R2, models: [R2.models[0], { name: 'B', id: 'B', input: inputOf('B'), output: revisionFrom('A') }] };
    await expect(Engine.run({ task: 'T', steps: [R1, bad], send })).rejects.toMatchObject({ code: 'invalid_input', address: expect.stringContaining('шаг «r2» · output.artifacts') });
    expect(calls).toEqual([]);
  });

  test('an individual output replaces the shared output as a whole: its fields and artifacts are not merged', async () => {
    const shared = { format: 'json', requiredFields: ['/map'], artifacts: [{ id: 'shared', name: 'Общий', pointer: '/map' }] };
    const steps = [{ ref: 'r1', kind: 'round', input: 'none', output: shared, models: [
      { name: 'A', id: 'A', output: { format: 'json', requiredFields: ['/title'], artifacts: [{ id: 'own', name: 'Свой', pointer: '/title' }] } },
      { name: 'B', id: 'B' }
    ] }];
    const { send, calls } = transport({ A: ['{"title":"t"}'], B: ['{"map":"m"}'] });
    const result = await Engine.run({ task: 'T', steps, send, maxAttempts: 1 });
    expect(result.stopReason).toBe('steps_done');
    expect(calls[0].prompts.A).toContain('Обязательные поля: /title');
    expect(calls[0].prompts.A).not.toContain('/map');
    expect(result.steps[0].outcome.A.ok).toBe(true);
    expect(result.artifacts.map((entry) => [entry.lineage.participant, entry.id])).toEqual([['A', 'own'], ['B', 'shared']]);
  });

  test('a checker with its own json output gets the verdict instruction of json and is judged by it', async () => {
    const steps = [
      { ref: 'r1', kind: 'round', input: 'none', models: ['A'] },
      { ref: 'g', kind: 'gate', input: 'previous', criteria: ['check'], models: [
        { name: 'G', id: 'G', output: { format: 'json', requiredFields: ['/verdict'] } }
      ] }
    ];
    const { send, calls } = transport({ A: ['ответ'], G: ['{"verdict":"pass"}'] });
    const result = await Engine.run({ task: 'T', steps, send, maxAttempts: 1 });
    expect(result.stopReason).toBe('steps_done');
    expect(result.steps[1].outcome.G).toMatchObject({ ok: true, verdict: 'pass' });
    expect(calls[1].prompts.G).toContain('Поле verdict — "pass" или "fail"');
    expect(calls[1].prompts.G).not.toContain('НЕ ПРОШЁЛ');
  });

  test('the individual output is checked by its own fields: a participant without them is rejected with the path of the field', async () => {
    const steps = [{ ref: 'r1', kind: 'round', input: 'none', output: { format: 'json', requiredFields: ['/map'] }, models: [
      { name: 'A', id: 'A', output: { format: 'json', requiredFields: ['/title'] } },
      { name: 'B', id: 'B' }
    ] }];
    const { send } = transport({ A: ['{"map":"m"}'], B: ['{"map":"m"}'] });
    const result = await Engine.run({ task: 'T', steps, send, maxAttempts: 1, decide: async () => 'skip' });
    expect(result.steps[0].outcome.A).toMatchObject({ ok: false, reason: 'missing_field', detail: '/title' });
    expect(result.steps[0].outcome.B.ok).toBe(true);
  });
});
