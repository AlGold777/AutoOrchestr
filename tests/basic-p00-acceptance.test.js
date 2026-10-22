// Acceptance of the wave 0 fixes (T00, T01): the explicit task of the first round with input none,
// and the order of participants from schema through the canvas and back. Fake send only, no transport.
const Engine = require('../disput/custom-engine');
const Schema = require('../disput/basic-schema');

const base = (steps, extra = {}) => ({ schemaVersion: 1, origin: 'user', steps, ...extra });
const round = (ref, models, extra = {}) => ({ ref, kind: 'round', models: models.map((name) => (typeof name === 'string' ? { name } : name)), ...extra });
const synthesis = (ref, models, extra = {}) => ({ ref, kind: 'synthesis', models: models.map((name) => (typeof name === 'string' ? { name } : name)), ...extra });

// Scripted transport: answers[model] is a list of replies, one per request to that model.
function transport(answers) {
  const calls = [];
  const used = {};
  const send = async (models, prompts, meta) => {
    calls.push({ models: models.slice(), prompts: { ...prompts }, meta });
    const byModel = {};
    models.forEach((model) => {
      const index = used[model] || 0;
      used[model] = index + 1;
      const reply = (answers[model] || [])[index] || '';
      byModel[model] = { text: reply, status: reply ? 'SUCCESS' : 'TIMEOUT' };
    });
    return { byModel, closedByOwner: false };
  };
  return { send, calls };
}

describe('T00: explicit task of the first round with input none', () => {
  const firstRound = (models, step = {}) => base([round('r1', models, { input: 'none', ...step }), synthesis('final', ['C'])]);

  test('the step task and the model task reach assemble, the preview and the request of the engine', async () => {
    const schema = firstRound([{ name: 'A', task: 'MODEL_TASK' }, 'B'], { task: 'STEP_TASK' });
    const steps = Schema.assemble(schema);
    expect(steps[0].input).toBe('none');
    expect(steps[0].task).toBe('STEP_TASK');
    expect(steps[0].models.map((model) => model.task)).toEqual(['MODEL_TASK', 'STEP_TASK']);

    const preview = Engine.previewPrompt({ task: 'T', steps, stepIndex: 0, modelName: 'A' });
    expect(preview.prompt).toBe('Задача:\nT\n\nЗадание:\nMODEL_TASK');
    expect(Engine.previewPrompt({ task: 'T', steps, stepIndex: 0, modelName: 'B' }).prompt).toBe('Задача:\nT\n\nЗадание:\nSTEP_TASK');

    const { send, calls } = transport({ A: ['a'], B: ['b'] });
    await Engine.run({ task: 'T', steps, send });
    expect(calls[0].prompts.A).toBe('Задача:\nT\n\nЗадание:\nMODEL_TASK');
    expect(calls[0].prompts.B).toBe('Задача:\nT\n\nЗадание:\nSTEP_TASK');
  });

  test('only the inherited task (▶ or Basic) is not sent with input none', async () => {
    const schema = firstRound(['A'], {});
    const withPipeline = base([round('r1', ['A'], { input: 'none' }), synthesis('final', ['C'])], { defaults: { roundTask: 'PIPELINE_TASK' } });
    for (const current of [schema, withPipeline]) {
      const steps = Schema.assemble(current);
      expect(JSON.stringify(steps)).not.toContain('PIPELINE_TASK');
      expect(JSON.stringify(steps)).not.toContain(Schema.DEFAULTS.roundTask);
      const { send, calls } = transport({ A: ['a'] });
      await Engine.run({ task: 'T', steps, send });
      expect(calls[0].prompts.A).toBe('Задача:\nT');
    }
  });
});

describe('T01: participant order [B, A] through the canvas and back', () => {
  const canvasModels = ['A', 'B'];
  const toCanvas = (schema) => Schema.toCanvas(schema, { models: canvasModels });
  const names = (canvas, ref) => canvas.stacks[`${ref}-models`].items.map((item) => item.name);
  // The schema the canvas stands for: the round's models in the order of its stack (the page reads them the same way).
  const schemaFromCanvas = (canvas, schema) => ({
    ...schema,
    steps: schema.steps.map((step, index) => (step.kind === 'round'
      ? { ...step, models: canvas.rounds[index].participantIds.map((name) => ({ name })) }
      : step))
  });

  test('the canvas stack and participantIds keep [B, A], and a schema round trip repeated twice keeps it', () => {
    const schema = base([round('r1', ['B', 'A']), synthesis('final', ['A'])]);
    expect(Schema.validate(schema)).toEqual([]);

    const first = toCanvas(schema);
    expect(first.errors).toEqual([]);
    expect(names(first, 'r1')).toEqual(['B', 'A']);
    expect(first.rounds[0].participantIds).toEqual(['B', 'A']);

    const back1 = schemaFromCanvas(first, schema);
    expect(back1.steps[0].models.map((model) => model.name)).toEqual(['B', 'A']);
    expect(Schema.validate(back1)).toEqual([]);

    const second = toCanvas(JSON.parse(JSON.stringify(back1)));
    expect(names(second, 'r1')).toEqual(['B', 'A']);
    const back2 = schemaFromCanvas(second, back1);
    expect(back2.steps[0].models.map((model) => model.name)).toEqual(['B', 'A']);
    expect(back2).toEqual(back1);
  });

  test('sequential send goes B then A, and A gets the answer of B', async () => {
    const schema = base([round('r1', ['B', 'A'], { order: 'sequential', input: 'none', task: 'Добавь' }), synthesis('final', ['A'])]);
    const { send, calls } = transport({ B: ['ответ B'], A: ['ответ A'], });
    const result = await Engine.run({ task: 'T', steps: Schema.assemble(schema), send });
    expect(calls.slice(0, 2).map((call) => call.models)).toEqual([['B'], ['A']]);
    expect(calls[1].prompts.A).toContain('Ответы участников этого раунда до тебя:\n\nОтвет 1:\nответ B');
    expect(calls[0].prompts.B).not.toContain('ответ A');
    expect(result.steps[0].outcome.A.ok).toBe(true);
  });
});
