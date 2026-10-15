const fs = require('fs');
const path = require('path');
const Engine = require('../disput/custom-engine');
const Schema = require('../disput/basic-schema');

const base = (steps, extra = {}) => ({ schemaVersion: 1, origin: 'user', steps, ...extra });
const round = (ref, models, extra = {}) => ({ ref, kind: 'round', models: models.map((name) => (typeof name === 'string' ? { name } : name)), ...extra });
const synthesis = (ref, models, extra = {}) => ({ ref, kind: 'synthesis', models: models.map((name) => (typeof name === 'string' ? { name } : name)), ...extra });
const errorPaths = (schema) => Schema.validate(schema).map((error) => error.path);

describe('Basic schema: defaults and inheritance', () => {
  test('the Basic defaults are the ones the engine and cards always used', () => {
    expect(Schema.DEFAULTS.roundTask).toBe('Учти ответы предыдущего шага и дай свой улучшенный ответ на задачу.');
    expect(Schema.DEFAULTS.synthesisTask).toBe(Engine.SYNTHESIS_TASK);
    expect(Schema.DEFAULTS.discipline).toEqual({
      limit: '[RESPONSE_LIMIT] Объём ответа: {от}-{слов} слов, не больше.',
      content: 'Сосредоточься на ясной концепции и ключевых идеях; убери повторы, длинные пересказы и второстепенные детали.',
      delivery: 'Последней строкой ответа напиши только метку {метка}',
      correction: Engine.CORRECTION_TEMPLATE
    });
  });

  test('a card value comes from the model, then the round, then ▶, then Basic', () => {
    const defaults = { roundTask: 'FROM_GENERAL', discipline: { content: 'GENERAL_CONTENT' } };
    expect(Schema.resolveFields({}, 'round', {}, defaults).task).toEqual({ value: 'FROM_GENERAL', source: 'pipeline' });
    expect(Schema.resolveFields({ task: 'OWN' }, 'round', { task: 'ROUND' }, defaults).task).toEqual({ value: 'OWN', source: 'model' });
    expect(Schema.resolveFields({}, 'round', { task: 'ROUND' }, defaults).task).toEqual({ value: 'ROUND', source: 'round' });
    expect(Schema.resolveFields({}, 'synthesis', {}, {}).task).toEqual({ value: Schema.DEFAULTS.synthesisTask, source: 'basic' });
    const fields = Schema.resolveFields({ discipline: { limit: 'OWN_LIMIT' } }, 'round', {}, defaults);
    expect(fields.discipline.limit).toEqual({ value: 'OWN_LIMIT', source: 'model' });
    expect(fields.discipline.content).toEqual({ value: 'GENERAL_CONTENT', source: 'pipeline' });
    expect(fields.discipline.delivery.source).toBe('basic');
  });

  test('an empty text is a value, a missing field is inheritance', () => {
    expect(Schema.resolveFields({ task: '' }, 'round', {}, { roundTask: 'GENERAL' }).task).toEqual({ value: '', source: 'model' });
    expect(Schema.resolveFields({ task: undefined }, 'round', {}, { roundTask: 'GENERAL' }).task.value).toBe('GENERAL');
    const steps = Schema.assemble(base([round('r1', ['A']), round('r2', [{ name: 'A', task: '' }, { name: 'B' }])]));
    expect(steps[1].models.map((model) => model.task)).toEqual(['', Schema.DEFAULTS.roundTask]);
  });
});

describe('Basic schema: assembly of engine steps', () => {
  test('rounds, synthesis and defaults give the steps the engine runs', () => {
    const steps = Schema.assemble(base([
      round('r1', ['A', 'B']), round('r2', ['A']), synthesis('final', ['C'])
    ]));
    expect(steps.map((step) => [step.kind, step.ref, step.order, step.input])).toEqual([
      ['round', 'r1', 'parallel', 'none'], ['round', 'r2', 'parallel', 'previous'], ['synthesis', 'final', undefined, undefined]
    ]);
    expect(steps[0].task).toBe('');
    expect(steps[0].models.map((model) => model.task)).toEqual(['', '']);
    expect(steps[1].task).toBe(Schema.DEFAULTS.roundTask);
    expect(steps[2].task).toBe(Schema.DEFAULTS.synthesisTask);
    expect(steps[1].models[0]).toEqual({
      name: 'A', id: 'A', promptTemplate: null, maxWords: null, extra: '', task: Schema.DEFAULTS.roundTask, discipline: { ...Schema.DEFAULTS.discipline }
    });
  });

  test('explicit order, input and task of a step reach its models', () => {
    const [first, second] = Schema.assemble(base([
      round('r1', ['A']),
      round('r2', ['A', 'B'], { order: 'sequential', input: 'all', task: 'STEP_TASK' })
    ]));
    expect(first.input).toBe('none');
    expect(second).toMatchObject({ order: 'sequential', input: 'all', task: 'STEP_TASK' });
    expect(second.models.map((model) => model.task)).toEqual(['STEP_TASK', 'STEP_TASK']);
  });

  test('the model request, limit, role and own discipline reach the model; ▶ lines go before its own', () => {
    const steps = Schema.assemble(base([
      round('r1', [{ name: 'A', role: 'critic', request: 'MY {задача}', maxWords: 120, discipline: { limit: 'LIM', lines: ['OWN'] } }])
    ], { defaults: { discipline: { content: 'GEN', lines: ['GENERAL_1', 'GENERAL_2'] } } }), { roleText: (role, ref) => `${role}@${ref}` });
    expect(steps[0].models[0]).toMatchObject({
      promptTemplate: 'MY {задача}', maxWords: 120, extra: 'critic@r1',
      discipline: { limit: 'LIM', content: 'GEN', delivery: Schema.DEFAULTS.discipline.delivery, lines: ['GENERAL_1', 'GENERAL_2', 'OWN'] }
    });
  });

  test('lists are replaced as a whole, in order', () => {
    const steps = Schema.assemble(base([round('r1', ['C', 'A', 'B'])]));
    expect(steps[0].models.map((model) => model.name)).toEqual(['C', 'A', 'B']);
  });

  test('an intermediate synthesis without its own request runs the final one of the same model', () => {
    const steps = Schema.assemble(base([
      round('r1', ['A']), synthesis('synth:x', ['S', 'T']), round('r2', ['A']),
      synthesis('final', [{ name: 'S', request: 'FINAL TEXT' }])
    ]));
    const synth = steps.find((step) => step.ref === 'synth:x');
    expect(synth.models.map((model) => model.promptTemplate)).toEqual(['FINAL TEXT', null]);
  });

  test('a switched-off step stays valid, keeps the numbering and gives the engine nothing', () => {
    const schema = base([round('r1', []), round('r2', ['A']), synthesis('final', [])]);
    expect(Schema.validate(schema)).toEqual([]);
    const steps = Schema.assemble(schema);
    expect(steps.map((step) => step.ref)).toEqual(['r2']);
    expect(steps[0].input).toBe('previous');
  });

  test('a new optional field does not change an old schema: assembled steps are stable', () => {
    const oldSchema = base([round('r1', ['A', 'B']), synthesis('final', ['C'])]);
    const before = JSON.stringify(Schema.assemble(oldSchema));
    expect(JSON.stringify(Schema.assemble(JSON.parse(JSON.stringify(oldSchema))))).toBe(before);
    expect(JSON.parse(before)[0].models[0].discipline).toEqual(Schema.DEFAULTS.discipline);
  });

  test('a user schema is self-contained: another schema or its original changes nothing in it', () => {
    const builtin = { ...base([round('r1', ['A'])], { defaults: { roundTask: 'BUILTIN' } }), origin: 'builtin' };
    const copy = { ...JSON.parse(JSON.stringify(builtin)), origin: 'user', basedOn: 'Original' };
    const before = JSON.stringify(Schema.assemble(copy));
    builtin.defaults.roundTask = 'CHANGED';
    builtin.steps.push(round('r2', ['B']));
    expect(JSON.stringify(Schema.assemble(copy))).toBe(before);
  });
});

describe('Basic schema: the canvas a schema stands for', () => {
  const canvasModels = ['Claude', 'GPT', 'Gemini', 'Grok'];
  const toCanvas = (schema, extra = {}) => Schema.toCanvas(schema, { models: canvasModels, ...extra });

  test('rounds, models with roles, the final synthesizer and the intermediate synthesis', () => {
    const schema = base([
      round('r1', [{ name: 'GPT' }, { name: 'Claude', role: 'critic' }]), synthesis('synth:mid', ['Gemini']),
      round('r2', ['GPT']), synthesis('final', ['Claude'])
    ]);
    const canvas = toCanvas(schema);
    expect(canvas.errors).toEqual([]);
    expect(canvas.roundCounter).toBe(2);
    expect(canvas.selectedModels).toEqual(['Claude', 'GPT']);
    expect(canvas.stacks['r1-models'].items).toEqual([
      { name: 'GPT', id: 'GPT', input: true, send: true, role: null }, { name: 'Claude', id: 'Claude', input: true, send: true, role: 'critic' }
    ]);
    expect(canvas.stacks['r2-models'].items.map((item) => [item.name, item.send])).toEqual([['GPT', true], ['Claude', false]]);
    expect(canvas.rounds.map((item) => item.participantIds)).toEqual([['GPT', 'Claude'], ['GPT']]);
    expect(canvas.synthesizer).toBe('Claude');
    expect(canvas.inserts).toEqual([{ afterRound: 1, plannedStageId: 'mid', participantIds: ['Gemini'] }]);
  });

  test('a switched-off model, a switched-off synthesis and a final that is off are not on the canvas', () => {
    const canvas = toCanvas(base([
      round('r1', ['GPT', { name: 'Grok', enabled: false, request: 'KEPT' }]), synthesis('synth:x', [{ name: 'Gemini', enabled: false }]),
      round('r2', []), synthesis('final', [])
    ]));
    expect(canvas.errors).toEqual([]);
    expect(canvas.selectedModels).toEqual(['GPT']);
    expect(canvas.inserts).toEqual([]);
    expect(canvas.synthesizer).toBe('');
    expect(canvas.roundCounter).toBe(2);
    expect(canvas.stacks['r2-models'].items.every((item) => item.send === false)).toBe(true);
  });

  test('onCanvas keeps a model on the canvas with Send off in every round; without it the model is not on the canvas', () => {
    const schema = base([
      round('r1', ['GPT', { name: 'Grok', enabled: false, onCanvas: true, request: 'KEPT' }]),
      round('r2', ['GPT', { name: 'Grok', enabled: false, onCanvas: true }]),
      synthesis('final', ['Claude'])
    ]);
    expect(Schema.validate(schema)).toEqual([]);
    const canvas = toCanvas(schema);
    expect(canvas.errors).toEqual([]);
    expect(canvas.selectedModels).toEqual(['GPT', 'Grok']);
    // The switched-off model stands in the stack of every round with Send off, and keeps its settings.
    ['r1-models', 'r2-models'].forEach((id) => {
      expect(canvas.stacks[id].items.find((item) => item.name === 'Grok')).toEqual({ name: 'Grok', id: 'Grok', input: false, send: false, role: null });
    });
    expect(canvas.rounds.map((item) => item.participantIds)).toEqual([['GPT'], ['GPT']]);
    expect(Schema.toSettings(schema).customModelSettings.r1.Grok).toEqual({ promptTemplate: 'KEPT', name: 'Grok', enabled: false });
    // A switched-off model with onCanvas is not called, and the schema without the mark gives the same engine steps.
    expect(Schema.assemble(schema).flatMap((step) => step.models.map((model) => model.name))).not.toContain('Grok');
    const unmarked = base([round('r1', ['GPT', { name: 'Grok', enabled: false, request: 'KEPT' }]), round('r2', ['GPT', { name: 'Grok', enabled: false }]), synthesis('final', ['Claude'])]);
    expect(toCanvas(unmarked).selectedModels).toEqual(['GPT']);
    expect(Schema.assemble(unmarked)).toEqual(Schema.assemble(schema));
  });

  test('onCanvas is a boolean and a known field; a schema without it is valid as before', () => {
    expect(errorPaths(base([round('r1', ['GPT', { name: 'Grok', enabled: false, onCanvas: 'yes' }])]))).toEqual(['steps[0].models[1].onCanvas']);
    expect(errorPaths(base([round('r1', ['GPT', { name: 'Grok', enabled: false, onCanvas: true, extra: 1 }])]))).toEqual(['steps[0].models[1].extra']);
    expect(errorPaths(base([round('r1', [{ name: 'GPT', onCanvas: false }])]))).toEqual([]);
    expect(errorPaths(base([round('r1', [{ name: 'GPT' }, { name: 'Grok', enabled: false }]), synthesis('final', ['GPT'])]))).toEqual([]);
  });

  test('a schema the canvas cannot show is named, not changed', () => {
    const places = (schema, extra) => toCanvas(schema, extra).errors.map((error) => error.path);
    expect(places(base([round('r1', ['Nobody'])]))).toEqual(['steps[0].models[0].name']);
    expect(places(base([round('r1', [{ name: 'GPT', role: 'ghost' }])]), { isRole: () => false })).toEqual(['steps[0].models[0].role']);
    expect(places(base([round('r2', ['GPT'])]))).toEqual(['steps[0].ref']);
    expect(places(base([synthesis('final', ['GPT']), round('r1', ['GPT'])]))).toContain('steps[0].ref');
    expect(places(base([round('r1', ['GPT']), synthesis('synth:a', ['Claude'])]))).toEqual(['steps[1]']);
    expect(places(base([synthesis('synth:a', ['Claude']), round('r1', ['GPT'])]))).toEqual(['steps[0]']);
    expect(places(base([round('r1', ['GPT']), synthesis('synth:', ['Claude']), round('r2', ['GPT'])]))).toEqual(['steps[1].ref']);
    expect(places(base([round('r1', ['GPT']), synthesis('synth:проверка', ['Claude']), round('r2', ['GPT'])]))).toEqual(['steps[1].ref']);
    expect(places(base([round('r1', ['GPT']), synthesis('synth:a b', ['Claude']), round('r2', ['GPT'])]))).toEqual(['steps[1].ref']);
    expect(places(base([round('r1', ['GPT'])], { run: { maxWords: 250 } }), { runWords: [300, 500, 700, 1000] })).toEqual(['run.maxWords']);
    expect(places(base([round('r1', ['GPT'])], { run: { maxWords: 500 } }), { runWords: [300, 500, 700, 1000] })).toEqual([]);
    expect(places(base([round('r1', ['GPT'])], { run: { maxWords: 250 } }))).toEqual([]);
    expect(places(base([round('r1', ['GPT']), synthesis('final', ['Claude', 'Gemini'])]))).toEqual(['steps[1].models']);
    expect(places(base([synthesis('final', ['Claude'])]))).toEqual(['steps']);
    expect(places(base([round('r1', ['GPT']), synthesis('final', ['Claude']), round('r2', ['GPT'])]))).toContain('steps[1].ref');
  });
});

describe('Basic schema: values are kept as given until the end', () => {
  test('an empty own request is a value: the intermediate synthesis does not take the final one', () => {
    const steps = Schema.assemble(base([
      round('r1', ['A']), synthesis('synth:x', [{ name: 'S', request: '' }, { name: 'T' }]), round('r2', ['A']),
      synthesis('final', [{ name: 'S', request: 'FINAL TEXT' }, { name: 'T', request: 'FINAL T' }])
    ]));
    const synth = steps.find((step) => step.ref === 'synth:x');
    expect(synth.models.map((model) => model.promptTemplate)).toEqual(['', 'FINAL T']);
    expect(steps.find((step) => step.ref === 'r2').models[0].promptTemplate).toBeNull();
  });

  test('an empty discipline text reaches the model as empty, not as the Basic text', () => {
    const [step] = Schema.assemble(base([round('r1', [{ name: 'A', discipline: { limit: '', content: '' } }])]));
    expect(step.models[0].discipline).toMatchObject({ limit: '', content: '', delivery: Schema.DEFAULTS.discipline.delivery });
  });

  test('wrong values are errors, not inheritance: 0, false, text and the wrong type', () => {
    [0, false, '300', -5, 1.5, null].forEach((value) => {
      expect(errorPaths(base([round('r1', [{ name: 'A', maxWords: value }])]))).toEqual(['steps[0].models[0].maxWords']);
    });
    expect(errorPaths(base([round('r1', [{ name: 'A', task: 5 }])]))).toEqual(['steps[0].models[0].task']);
    expect(errorPaths(base([round('r1', [{ name: 'A', discipline: 'x' }])]))).toEqual(['steps[0].models[0].discipline']);
  });

  test('the run policy and the shared limit are part of the schema', () => {
    expect(Schema.resolveRun(base([round('r1', ['A'])]))).toEqual({ policy: 'manual', maxWords: 300 });
    expect(Schema.resolveRun(base([round('r1', ['A'])], { run: { policy: 'auto' } }))).toEqual({ policy: 'auto', maxWords: 300 });
    expect(Schema.resolveRun(base([round('r1', ['A'])], { run: { policy: 'manual', maxWords: 700 } }))).toEqual({ policy: 'manual', maxWords: 700 });
    expect(Schema.validate(base([round('r1', ['A'])], { run: { policy: 'auto', maxWords: 700 } }))).toEqual([]);
    expect(errorPaths(base([round('r1', ['A'])], { run: { policy: 'sometimes' } }))).toEqual(['run.policy']);
    expect(errorPaths(base([round('r1', ['A'])], { run: { maxWords: 0 } }))).toEqual(['run.maxWords']);
    expect(errorPaths(base([round('r1', ['A'])], { run: { speed: 1 } }))).toEqual(['run.speed']);
    expect(errorPaths(base([round('r1', ['A'])], { run: 5 }))).toEqual(['run']);
  });
});

describe('Basic schema: a switched-off round keeps its number', () => {
  const schema = base([round('r1', []), round('r2', ['A', 'B']), synthesis('synth:x', ['S']), round('r3', ['A']), synthesis('final', ['S'])]);

  test('assembly gives the original number and the id of every step', () => {
    const steps = Schema.assemble(schema);
    expect(steps.map((step) => [step.ref, step.round ?? null, step.afterRound ?? null])).toEqual([
      ['r2', 2, null], ['synth:x', null, 2], ['r3', 3, null], ['final', null, 3]
    ]);
    expect(steps[0].input).toBe('previous');
  });

  test('the preview, the journal and the run use the same numbers and ids', async () => {
    const steps = Schema.assemble(schema);
    expect(Engine.previewPrompt({ task: 'T', steps, stepIndex: 0, modelName: 'A' }).label).toBe('Раунд 2');
    expect(Engine.previewPrompt({ task: 'T', steps, stepIndex: 1, modelName: 'S' }).label).toBe('Синтез после раунда 2');
    const events = [];
    const send = async (models) => ({ byModel: Object.fromEntries(models.map((name) => [name, { text: `answer of ${name}`, status: 'SUCCESS' }])) });
    const result = await Engine.run({ task: 'T', steps, send, onEvent: (kind, fields) => events.push([kind, fields]) });
    const start = events.find(([kind]) => kind === 'custom_start')[1];
    expect(start.steps.map((step) => [step.ref, step.label])).toEqual([
      ['r2', 'Раунд 2'], ['synth:x', 'Синтез после раунда 2'], ['r3', 'Раунд 3'], ['final', 'Синтез после раунда 3']
    ]);
    expect(result.history.map((entry) => entry.ref)).toEqual(['r2', 'r2', 'synth:x', 'r3', 'final']);
    expect(result.steps.map((step) => step.label)).toEqual(['Раунд 2', 'Синтез после раунда 2', 'Раунд 3', 'Синтез после раунда 3']);
  });

  test('without the numbers the engine counts the steps it got, as before', () => {
    const labels = Engine.normalizeSteps([{ kind: 'round', models: ['A'] }, { kind: 'synthesis', models: ['S'] }, { kind: 'round', models: ['A'] }]);
    expect(labels.map((step) => [step.round, step.afterRound])).toEqual([[1, null], [null, 1], [2, null]]);
  });
});

describe('Basic schema: check before the first request', () => {
  test('the first example of the guide passes the check', () => {
    const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'Pipeline scenarios', 'basic-schema-guide.md'), 'utf8');
    const example = JSON.parse(doc.match(/```json\n([\s\S]*?)\n```/)[1]);
    expect(Schema.validate(example)).toEqual([]);
    expect(Schema.assemble(example).map((step) => step.ref)).toEqual(['r1', 'final']);
  });

  test('a format from a newer Basic is refused, older released formats stay supported', () => {
    const errors = Schema.validate(base([round('r1', ['A'])], { schemaVersion: Schema.SCHEMA_VERSION + 1 }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ path: 'schemaVersion' });
    expect(errors[0].message).toContain('более новой версией Basic');
    Schema.SUPPORTED_VERSIONS.forEach((version) => expect(Schema.validate(base([round('r1', ['A'])], { schemaVersion: version }))).toEqual([]));
    expect(Schema.SUPPORTED_VERSIONS).toContain(1);
  });

  test('every wrong place is named, nothing is corrected silently', () => {
    expect(errorPaths(null)).toEqual(['']);
    expect(errorPaths({ steps: [] })).toEqual(['schemaVersion', 'origin', 'steps']);
    expect(errorPaths(base([{ ref: 'r1', kind: 'loop', models: [] }]))).toEqual(['steps[0].kind', 'steps']);
    expect(errorPaths(base([round('r1', ['A'], { order: 'random' })]))).toEqual(['steps[0].order']);
    expect(errorPaths(base([round('r1', ['A'], { input: 'everything' })]))).toEqual(['steps[0].input']);
    expect(errorPaths(base([synthesis('final', ['A'], { order: 'sequential' })]))).toEqual(['steps[0].order', 'steps']);
    expect(errorPaths(base([synthesis('final', ['A'], { input: 'all' })]))).toEqual(['steps[0].input', 'steps']);
    expect(errorPaths(base([round('r1', ['A']), round('r1', ['B'])]))).toEqual(['steps[1].ref']);
    expect(errorPaths(base([round('r1', ['A', 'A'])]))).toEqual(['steps[0].models[1].name']);
    expect(errorPaths(base([round('r1', [{ name: 'A', maxWords: 0 }])]))).toEqual(['steps[0].models[0].maxWords']);
    expect(errorPaths(base([round('r1', [{ name: 'A', maxWords: '300' }])]))).toEqual(['steps[0].models[0].maxWords']);
    expect(errorPaths(base([round('r1', [{ name: 'A', discipline: { lines: 'one' } }])]))).toEqual(['steps[0].models[0].discipline.lines']);
    expect(errorPaths(base([round('r1', [{ name: 'A', discipline: { lines: [1] } }])]))).toEqual(['steps[0].models[0].discipline.lines[0]']);
    expect(errorPaths(base([round('r1', [{ name: 'A', colour: 'red' }])]))).toEqual(['steps[0].models[0].colour']);
    expect(errorPaths(base([round('r1', ['A'])], { extra: true }))).toEqual(['extra']);
    expect(errorPaths(base([round('r1', ['A'])], { defaults: { roundTask: 5, discipline: { mood: 'x' } } }))).toEqual(['defaults.roundTask', 'defaults.discipline.mood']);
  });

  test('an unsupported schema is described in one line with the place of the error', () => {
    const errors = Schema.validate(base([round('r1', [{ name: 'A', maxWords: -1 }])]));
    expect(Schema.describeErrors(errors)).toBe('steps[0].models[0].maxWords: ожидается положительное целое число слов');
  });

  test('every default field of a schema is accepted: a full schema validates and assembles', () => {
    const full = {
      schemaVersion: 1, origin: 'builtin', basedOn: 'Basic',
      defaults: { roundTask: 'R', synthesisTask: 'S', discipline: { limit: 'l', content: 'c', delivery: 'd', correction: 'k', lines: ['x'] }, modelNotes: { A: 'n' }, roundPrompts: { r2: 'p' } },
      steps: [
        round('r1', [{ name: 'A', role: 'x', request: 'q', maxWords: 10, task: 't', discipline: { limit: '', lines: [] } }]),
        round('r2', ['A'], { order: 'sequential', input: 'previous', task: '' }),
        synthesis('synth:z', ['B'], { task: 'T' }), round('r3', ['B']), synthesis('final', ['B'])
      ]
    };
    expect(Schema.validate(full)).toEqual([]);
    expect(Schema.assemble(full)).toHaveLength(5);
  });
});

describe('Basic schema: an explicit task is sent with input none', () => {
  test('a task of the step and of the model reaches the first round, the model task comes first', () => {
    const steps = Schema.assemble(base([
      round('r1', [{ name: 'A' }, { name: 'B', task: 'MODEL_TASK' }], { task: 'STEP_TASK' }),
      synthesis('final', ['C'])
    ]));
    expect(steps[0].input).toBe('none');
    expect(steps[0].task).toBe('STEP_TASK');
    expect(steps[0].models.map((model) => model.task)).toEqual(['STEP_TASK', 'MODEL_TASK']);
  });

  test('the Basic and ▶ tasks are not sent with input none, the inherited value does not appear', () => {
    const steps = Schema.assemble(base([round('r1', ['A']), synthesis('final', ['C'])], { defaults: { roundTask: 'PIPELINE_TASK' } }));
    expect(steps[0].task).toBe('');
    expect(steps[0].models[0].task).toBe('');
    expect(JSON.stringify(steps)).not.toContain('PIPELINE_TASK');
    expect(JSON.stringify(steps)).not.toContain(Schema.DEFAULTS.roundTask);
  });

  test('an explicit empty task is a value: it stops the ▶ task from coming in', () => {
    const steps = Schema.assemble(base([round('r1', [{ name: 'A', task: '' }], { task: '' }), synthesis('final', ['C'])], { defaults: { roundTask: 'PIPELINE_TASK' } }));
    expect(steps[0].task).toBe('');
    expect(steps[0].models[0].task).toBe('');
  });

  test('a full own request of the model works as before, the task stays as given', () => {
    const steps = Schema.assemble(base([round('r1', [{ name: 'A', request: 'Задача: {задача}', task: 'MODEL_TASK' }]), synthesis('final', ['C'])]));
    expect(steps[0].models[0]).toMatchObject({ promptTemplate: 'Задача: {задача}', task: 'MODEL_TASK' });
  });

  test('the preview shows the explicit task of the first round and nothing inherited', () => {
    const withTask = Schema.assemble(base([round('r1', ['A'], { task: 'STEP_TASK' }), synthesis('final', ['C'])]));
    expect(Engine.previewPrompt({ task: 'T', steps: withTask, stepIndex: 0, modelName: 'A' }).prompt).toBe('Задача:\nT\n\nЗадание:\nSTEP_TASK');
    const without = Schema.assemble(base([round('r1', ['A']), synthesis('final', ['C'])], { defaults: { roundTask: 'PIPELINE_TASK' } }));
    expect(Engine.previewPrompt({ task: 'T', steps: without, stepIndex: 0, modelName: 'A' }).prompt).toBe('Задача:\nT');
  });

  test('explicit tasks survive the settings of the cards and a JSON round trip', () => {
    const schema = base([round('r1', [{ name: 'A', task: 'MODEL_TASK' }], { task: 'STEP_TASK' }), synthesis('final', ['C'])]);
    const reloaded = JSON.parse(JSON.stringify(schema));
    expect(Schema.validate(reloaded)).toEqual([]);
    expect(Schema.assemble(reloaded)).toEqual(Schema.assemble(schema));
    const settings = Schema.toSettings(reloaded);
    expect(settings.customRoundSettings.r1).toEqual({ task: 'STEP_TASK' });
    expect(settings.customModelSettings.r1.A).toEqual({ task: 'MODEL_TASK' });
  });
});

describe('Basic schema: the order of participants on the canvas', () => {
  const canvasModels = ['Claude', 'GPT', 'Gemini', 'Grok'];
  const toCanvas = (schema, extra = {}) => Schema.toCanvas(schema, { models: canvasModels, ...extra });
  const itemNames = (canvas, ref) => canvas.stacks[`${ref}-models`].items.map((item) => item.name);

  test('a round keeps the order of its models from the schema, not the order of the canvas', () => {
    const canvas = toCanvas(base([round('r1', ['GPT', 'Claude']), synthesis('final', ['Claude'])]));
    expect(canvas.errors).toEqual([]);
    expect(canvas.selectedModels).toEqual(['Claude', 'GPT']);
    expect(itemNames(canvas, 'r1')).toEqual(['GPT', 'Claude']);
    expect(canvas.rounds[0].participantIds).toEqual(['GPT', 'Claude']);
  });

  test('each round has its own order', () => {
    const canvas = toCanvas(base([round('r1', ['GPT', 'Claude']), round('r2', ['Claude', 'GPT']), synthesis('final', ['Claude'])]));
    expect(itemNames(canvas, 'r1')).toEqual(['GPT', 'Claude']);
    expect(itemNames(canvas, 'r2')).toEqual(['Claude', 'GPT']);
    expect(canvas.rounds.map((item) => item.participantIds)).toEqual([['GPT', 'Claude'], ['Claude', 'GPT']]);
  });

  test('the models of a round that are not in it follow the enabled ones, switched off for this round', () => {
    const canvas = toCanvas(base([round('r1', ['GPT']), round('r2', ['Claude']), synthesis('final', ['Claude'])]));
    expect(canvas.stacks['r1-models'].items).toEqual([
      { name: 'GPT', id: 'GPT', input: true, send: true, role: null }, { name: 'Claude', id: 'Claude', input: false, send: false, role: null }
    ]);
    expect(canvas.stacks['r2-models'].items).toEqual([
      { name: 'Claude', id: 'Claude', input: true, send: true, role: null }, { name: 'GPT', id: 'GPT', input: false, send: false, role: null }
    ]);
    expect(canvas.rounds.map((item) => item.participantIds)).toEqual([['GPT'], ['Claude']]);
  });

  test('the engine still runs the models in the order of the schema', () => {
    const steps = Schema.assemble(base([round('r1', ['GPT', 'Claude']), synthesis('final', ['Claude'])]));
    expect(steps[0].models.map((model) => model.name)).toEqual(['GPT', 'Claude']);
  });

  test('a switched-off model keeps its settings, and the canvas does not change the schema', () => {
    const schema = base([round('r1', ['GPT', { name: 'Claude', enabled: false, task: 'KEPT_TASK' }]), synthesis('final', ['GPT'])]);
    const before = JSON.stringify(schema);
    const first = toCanvas(schema);
    const second = toCanvas(schema);
    expect(first.errors).toEqual([]);
    expect(first.stacks).toEqual(second.stacks);
    expect(first.rounds).toEqual(second.rounds);
    expect(JSON.stringify(schema)).toBe(before);
    // The switched-off declaration (name, enabled) stays with the task (R12).
    expect(Schema.toSettings(schema).customModelSettings.r1.Claude).toEqual({ name: 'Claude', enabled: false, task: 'KEPT_TASK' });
  });
});

describe('Basic schema: input by references (4.3)', () => {
  // r1 has A and B, r2 has A, synth:mid has S, r3 has A and a switched-off C; the step under test is r4.
  const withInput = (input) => base([
    round('r1', ['A', 'B']), round('r2', ['A']), synthesis('synth:mid', ['S']),
    round('r3', ['A', { name: 'C', enabled: false }]), round('r4', ['A'], { input })
  ]);

  test('a list of step refs and participant addresses is valid, keeps its order and reaches assemble', () => {
    const input = ['r1', { step: 'r3', participant: 'C', required: true }, 'synth:mid', { step: 'r2', participant: 'A' }];
    expect(Schema.validate(withInput(input))).toEqual([]);
    expect(Schema.assemble(withInput(input))[4].input).toEqual(input);
  });

  test('a step ref and a participant of the same step are two different sources', () => {
    expect(Schema.validate(withInput(['r1', { step: 'r1', participant: 'A' }]))).toEqual([]);
  });

  test('a switched-off step stays a valid reference', () => {
    expect(Schema.validate(base([round('r1', []), round('r2', ['A'], { input: ['r1'] })]))).toEqual([]);
  });

  test('a synthesis takes a list; none and all stay forbidden for it', () => {
    const schema = base([round('r1', ['A']), round('r2', ['A']), synthesis('final', ['B'], { input: ['r1', 'r2'] })]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(Schema.assemble(schema)[2].input).toEqual(['r1', 'r2']);
    expect(errorPaths(base([round('r1', ['A']), synthesis('final', ['B'], { input: 'none' })]))).toEqual(['steps[1].input']);
    expect(errorPaths(base([round('r1', ['A']), synthesis('final', ['B'], { input: 'all' })]))).toEqual(['steps[1].input']);
  });

  test('a list without the input of a step keeps the old assembly: no input field for a synthesis', () => {
    const steps = Schema.assemble(base([round('r1', ['A']), synthesis('final', ['B'])]));
    expect(steps[1]).not.toHaveProperty('input');
  });

  test('wrong sources are named with their exact path', () => {
    const cases = [
      [[], ['steps[4].input']],
      [['r4'], ['steps[4].input[0]']],
      [['r9'], ['steps[4].input[0]']],
      [['r1', 'r1'], ['steps[4].input[1]']],
      [[{ step: 'r1', participant: 'A' }, { step: 'r1', participant: 'A', required: true }], ['steps[4].input[1]']],
      [[{ step: 'r1', participant: 'Z' }], ['steps[4].input[0].participant']],
      [[{ step: 'r4', participant: 'A' }], ['steps[4].input[0].step']],
      [[{ step: 'r1', participant: 'A', colour: 'x' }], ['steps[4].input[0].colour']],
      [[{}], ['steps[4].input[0]']],
      [[5], ['steps[4].input[0]']],
      [[{ step: 'r1', participant: 'A', required: 'yes' }], ['steps[4].input[0].required']],
      [[{ step: 'r1', participant: 'A', version: 'latest' }], ['steps[4].input[0].version']]
    ];
    cases.forEach(([input, paths]) => expect({ input, paths: errorPaths(withInput(input)) }).toEqual({ input, paths }));
  });

  test('an artifact source is refused until the step declares the artifact, and needs an explicit version', () => {
    const artifact = { artifact: { step: 'r1', participant: 'A', id: 'map' }, version: 'latest' };
    expect(errorPaths(withInput([artifact]))).toEqual(['steps[4].input[0].artifact.id']);
    expect(errorPaths(withInput([{ artifact: artifact.artifact }]))).toEqual(expect.arrayContaining(['steps[4].input[0].version']));
    expect(errorPaths(withInput([{ artifact: artifact.artifact, version: 'current' }]))).toEqual(expect.arrayContaining(['steps[4].input[0].version']));
    expect(errorPaths(withInput([{ artifact: artifact.artifact, version: { step: 'r1', participant: 'A', visit: 0 } }]))).toEqual(expect.arrayContaining(['steps[4].input[0].version.visit']));
    expect(errorPaths(withInput([{ artifact: { step: 'r1', participant: 'A' }, version: 'latest' }]))).toEqual(expect.arrayContaining(['steps[4].input[0].artifact.id']));
  });

  test('a final result cannot be an ordinary input, and a later step is not a source', () => {
    expect(errorPaths(base([round('r1', ['A']), synthesis('final', ['B']), round('r2', ['A'], { input: ['final'] })]))).toEqual(['steps[2].input[0]']);
    expect(errorPaths(base([round('r1', ['A'], { input: ['r2'] }), round('r2', ['A'])]))).toEqual(['steps[0].input[0]']);
  });
});

describe('Basic schema: participants with an id and their own input (4.2)', () => {
  test('two participants of one model in a round are two participants, each with its id', () => {
    const schema = base([round('r1', [{ name: 'GPT', id: 'expert-1' }, { name: 'GPT', id: 'expert-2' }]), synthesis('final', ['Claude'])]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(Schema.assemble(schema)[0].models.map((model) => [model.name, model.id])).toEqual([['GPT', 'expert-1'], ['GPT', 'expert-2']]);
  });

  test('a model without an id has the name as its id, and an explicit id may differ from another name', () => {
    const schema = base([round('r1', ['A', { name: 'A', id: 'second' }]), synthesis('final', ['A'])]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(Schema.assemble(schema)[0].models.map((model) => model.id)).toEqual(['A', 'second']);
  });

  test('the same explicit id in two steps is one participant with the same name', () => {
    const schema = base([
      round('r1', [{ name: 'GPT', id: 'author' }]),
      round('r2', [{ name: 'GPT', id: 'author', input: ['r1'] }, { name: 'Claude', input: 'none' }]),
      synthesis('final', [{ name: 'GPT', id: 'author' }])
    ]);
    expect(Schema.validate(schema)).toEqual([]);
    const [, second] = Schema.assemble(schema);
    expect(second.models[0]).toMatchObject({ id: 'author', input: ['r1'] });
    expect(second.models[1]).toMatchObject({ id: 'Claude', input: 'none' });
  });

  test('a participant input replaces the step input in the assembled step, and a list of its own goes with it', () => {
    const schema = base([round('r1', ['A']), round('r2', [{ name: 'B', input: [{ step: 'r1', participant: 'A' }] }], { input: 'all' }), synthesis('final', ['B'])]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(Schema.assemble(schema)[1].models[0].input).toEqual([{ step: 'r1', participant: 'A' }]);
  });

  test('a shared id of a participant reaches the intermediate synthesis from the final one', () => {
    const steps = Schema.assemble(base([
      round('r1', ['A']), synthesis('synth:x', [{ name: 'S', id: 's1' }]), round('r2', ['A']),
      synthesis('final', [{ name: 'S', id: 's1', request: 'FINAL FOR S1' }])
    ]));
    expect(steps.find((step) => step.ref === 'synth:x').models[0].promptTemplate).toBe('FINAL FOR S1');
  });

  test('wrong participants are named with their exact path', () => {
    const cases = [
      [[{ name: 'A', id: '' }], 'steps[0].models[0].id'],
      [[{ name: 'A', id: 5 }], 'steps[0].models[0].id'],
      [[{ name: 'A', id: 'x' }, { name: 'B', id: 'x' }], 'steps[0].models[1].id'],
      [[{ name: 'A', id: 'B' }, { name: 'B' }], 'steps[0].models[1].name'],
      [['A', 'A'], 'steps[0].models[1].name'],
      [[{ name: 'A', input: 'everything' }], 'steps[0].models[0].input'],
      [[{ name: 'A', input: [] }], 'steps[0].models[0].input'],
      [[{ name: 'A', input: ['r9'] }], 'steps[0].models[0].input[0]'],
      [[{ name: 'A', input: [{ step: 'r0', participant: 'A' }] }], 'steps[0].models[0].input[0].step']
    ];
    cases.forEach(([models, path]) => expect({ models, paths: errorPaths(base([round('r1', models)])) }).toEqual({ models, paths: [path] }));
    expect(errorPaths(base([round('r1', ['A']), round('r2', [{ name: 'B', id: 'A' }]), synthesis('final', ['B'])]))).toEqual(['steps[1].models[0].name']);
    expect(errorPaths(base([round('r1', [{ name: 'A', id: 'x' }]), round('r2', [{ name: 'B', id: 'x' }])]))).toEqual(['steps[1].models[0].name']);
    expect(errorPaths(base([round('r1', ['A']), synthesis('final', [{ name: 'B', input: 'all' }])]))).toEqual(['steps[1].models[0].input']);
    expect(errorPaths(base([round('r1', ['A']), round('r2', [{ name: 'B', input: [{ step: 'r1', participant: 'Z' }] }])]))).toEqual(['steps[1].models[0].input[0].participant']);
  });

  test('a participant cannot take the answers of its own step or of a later one', () => {
    expect(errorPaths(base([round('r1', ['A']), round('r2', [{ name: 'A', input: ['r2'] }])]))).toEqual(['steps[1].models[0].input[0]']);
    expect(errorPaths(base([round('r1', [{ name: 'A', input: ['r2'] }]), round('r2', ['A'])]))).toEqual(['steps[0].models[0].input[0]']);
  });
});

describe('Basic schema: the canvas and participants with an id', () => {
  test('two participants of one model in a round are two blocks, each with its id, in the order of the schema', () => {
    const canvas = Schema.toCanvas(base([round('r1', [{ name: 'GPT', id: 'expert-2' }, { name: 'Claude' }, { name: 'GPT', id: 'expert-1' }]), synthesis('final', ['Claude'])]), { models: ['GPT', 'Claude'] });
    expect(canvas.errors).toEqual([]);
    expect(canvas.stacks['r1-models'].items.map((item) => [item.name, item.id])).toEqual([['GPT', 'expert-2'], ['Claude', 'Claude'], ['GPT', 'expert-1']]);
    expect(canvas.rounds[0].participantIds).toEqual(['expert-2', 'Claude', 'expert-1']);
    expect(canvas.selectedModels).toEqual(['GPT', 'Claude']);
  });
});

describe('Basic schema: output of a step, artifacts and revisions (5.1–5.2)', () => {
  const textOutput = { name: 'Результаты аудита', form: 'Сформируй исправленную карту и замечания', sections: ['Карта', 'Замечания'], strictLength: true };
  const jsonOutput = {
    name: 'Аудит карты', format: 'json', requiredFields: ['/correctedMap', '/auditFindings'],
    artifacts: [{ id: 'map', name: 'Corrected Map', pointer: '/correctedMap' }, { id: 'findings', name: 'Audit Findings', pointer: '/auditFindings' }]
  };
  const mapRef = { artifact: { step: 'r1', participant: 'A', id: 'map' }, version: 'latest' };

  test('a text output with sections and a strict length, and a json output with artifacts, are valid and kept as given', () => {
    const text = base([round('r1', ['A'], { output: textOutput }), synthesis('final', ['B'])]);
    expect(Schema.validate(text)).toEqual([]);
    expect(Schema.assemble(text)[0].output).toEqual(textOutput);
    const json = base([round('r1', ['A'], { output: jsonOutput }), synthesis('final', ['B'])]);
    expect(Schema.validate(json)).toEqual([]);
    expect(Schema.assemble(json)[0].output).toEqual(jsonOutput);
  });

  test('a single text artifact covers the whole answer with an empty pointer, and a declared artifact can be an input', () => {
    const schema = base([
      round('r1', ['A'], { output: { artifacts: [{ id: 'map', name: 'Map', pointer: '' }] } }),
      round('r2', [{ name: 'B', input: [mapRef] }]),
      synthesis('final', ['B'])
    ]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(Schema.assemble(schema)[1].models[0].input).toEqual([mapRef]);
  });

  test('a revision names the earlier version it continues and that version is in the input of the author', () => {
    const schema = base([
      round('r1', ['A'], { output: { artifacts: [{ id: 'map', name: 'Map', pointer: '' }] } }),
      round('r2', ['A'], { input: [mapRef], output: { artifacts: [{ id: 'map', name: 'Map v2', pointer: '', revisionOf: mapRef }] } }),
      synthesis('final', ['B'])
    ]);
    expect(Schema.validate(schema)).toEqual([]);
  });

  test('wrong output is named with its exact path', () => {
    const cases = [
      [{ sections: [] }, ['steps[0].output.sections']],
      [{ sections: [''] }, ['steps[0].output.sections[0]']],
      [{ format: 'json', sections: ['Карта'] }, ['steps[0].output.sections']],
      [{ strictLength: 'yes' }, ['steps[0].output.strictLength']],
      [{ format: 'xml' }, ['steps[0].output.format']],
      [{ requiredFields: ['/a'] }, ['steps[0].output.requiredFields']],
      [{ format: 'json', requiredFields: [] }, ['steps[0].output.requiredFields']],
      [{ format: 'json', requiredFields: ['field'] }, ['steps[0].output.requiredFields[0]']],
      [{ format: 'json', requiredFields: ['/a/constructor'] }, ['steps[0].output.requiredFields[0]']],
      [{ format: 'json', requiredFields: ['/__proto__'] }, ['steps[0].output.requiredFields[0]']],
      [{ format: 'json', requiredFields: ['/a~2b'] }, ['steps[0].output.requiredFields[0]']],
      [{ format: 'json', requiredFields: [''] }, ['steps[0].output.requiredFields[0]']],
      [{ artifacts: [] }, ['steps[0].output.artifacts']],
      [{ artifacts: [{ id: 'a', name: 'A', pointer: '' }, { id: 'b', name: 'B', pointer: '' }] }, ['steps[0].output.artifacts']],
      [{ artifacts: [{ id: 'a', name: 'A', pointer: '/x' }] }, ['steps[0].output.artifacts[0].pointer']],
      [{ format: 'json', artifacts: [{ id: 'a', name: 'A', pointer: '' }] }, ['steps[0].output.artifacts[0].pointer']],
      [{ format: 'json', artifacts: [{ id: 'a', name: 'A', pointer: '/x' }, { id: 'a', name: 'B', pointer: '/y' }] }, ['steps[0].output.artifacts[1].id']],
      [{ format: 'json', artifacts: [{ id: 'a', name: 'A', pointer: '/x' }, { id: 'b', name: 'B', pointer: '/x' }] }, ['steps[0].output.artifacts[1].pointer']],
      [{ artifacts: [{ id: 'a', pointer: '' }] }, ['steps[0].output.artifacts[0].name']],
      [{ artifacts: [{ id: 'a', name: 'A' }] }, ['steps[0].output.artifacts[0].pointer']],
      [{ artifacts: [{ id: 'a', name: 'A', pointer: '', colour: 'red' }] }, ['steps[0].output.artifacts[0].colour']],
      [{ extra: 1 }, ['steps[0].output.extra']]
    ];
    cases.forEach(([output, paths]) => expect({ output, paths: errorPaths(base([round('r1', ['A'], { output })])) }).toEqual({ output, paths }));
    expect(errorPaths(base([round('r1', ['A'], { output: 'text' })]))).toEqual(['steps[0].output']);
  });

  test('a revision that is not in the input of its author, or is not a reference to an artifact, is named', () => {
    const declared = { output: { artifacts: [{ id: 'map', name: 'Map', pointer: '' }] } };
    const revision = (revisionOf) => base([round('r1', ['A'], declared), round('r2', ['A'], { input: ['r1'], output: { artifacts: [{ id: 'map', name: 'Map v2', pointer: '', revisionOf }] } }), synthesis('final', ['B'])]);
    expect(errorPaths(revision(mapRef))).toEqual(['steps[1].output.artifacts[0].revisionOf']);
    expect(errorPaths(revision('map'))).toEqual(['steps[1].output.artifacts[0].revisionOf']);
    const notInInput = base([round('r1', ['A'], declared), round('r2', ['A'], { output: { artifacts: [{ id: 'map', name: 'Map v2', pointer: '', revisionOf: mapRef }] } })]);
    expect(errorPaths(notInInput)).toEqual(['steps[1].output.artifacts[0].revisionOf']);
  });

  test('an input artifact that the step does not declare is refused by its id', () => {
    const schema = base([round('r1', ['A'], { output: { artifacts: [{ id: 'map', name: 'Map', pointer: '' }] } }), round('r2', ['B'], { input: [{ artifact: { step: 'r1', participant: 'A', id: 'nope' }, version: 'latest' }] })]);
    expect(errorPaths(schema)).toEqual(['steps[1].input[0].artifact.id']);
  });
});

describe('Basic schema: how many answers a step needs, owner approval and chat (4.2, 1.3, 1.4)', () => {
  test('require any, all or a number from 1 to the enabled participants are valid and reach assemble', () => {
    [['any'], ['all'], [2]].forEach(([require]) => {
      const schema = base([round('r1', ['A', 'B', { name: 'C', enabled: false }], { require }), synthesis('final', ['D'])]);
      expect(Schema.validate(schema)).toEqual([]);
      expect(Schema.assemble(schema)[0].require).toBe(require);
    });
  });

  test('a switched-off step keeps its number of answers, and the number is checked again when the step is switched on', () => {
    expect(Schema.validate(base([round('r1', [{ name: 'A', enabled: false }], { require: 2 }), round('r2', ['B']), synthesis('final', ['B'])]))).toEqual([]);
    expect(errorPaths(base([round('r1', ['A'], { require: 2 }), synthesis('final', ['B'])]))).toEqual(['steps[0].require']);
  });

  test('owner approval and the chat of the step reach assemble; the defaults are not written', () => {
    const schema = base([round('r1', ['A'], { owner: 'approve', chat: 'new' }), synthesis('final', ['B'], { owner: 'approve' })]);
    expect(Schema.validate(schema)).toEqual([]);
    const steps = Schema.assemble(schema);
    expect(steps[0]).toMatchObject({ owner: 'approve', chat: 'new' });
    expect(steps[1].owner).toBe('approve');
    expect(steps[1]).not.toHaveProperty('chat');
    expect(steps[1]).not.toHaveProperty('require');
  });

  test('wrong values are named with their exact path', () => {
    const cases = [
      [{ require: 0 }, 'steps[0].require'],
      [{ require: 1.5 }, 'steps[0].require'],
      [{ require: '2' }, 'steps[0].require'],
      [{ require: 'some' }, 'steps[0].require'],
      [{ require: true }, 'steps[0].require'],
      [{ require: 3 }, 'steps[0].require'],
      [{ owner: 'auto' }, 'steps[0].owner'],
      [{ owner: '' }, 'steps[0].owner'],
      [{ chat: 'keep' }, 'steps[0].chat']
    ];
    cases.forEach(([extra, path]) => expect({ extra, paths: errorPaths(base([round('r1', ['A', 'B'], extra)])) }).toEqual({ extra, paths: [path] }));
  });
});

describe('Basic schema: gate, route and owner steps (6.1, 6.2, 4.1)', () => {
  const gate = (ref, models, extra = {}) => ({ ref, kind: 'gate', criteria: ['Есть источники'], models: models.map((name) => (typeof name === 'string' ? { name } : name)), ...extra });
  const owner = (ref, extra = {}) => ({ ref, kind: 'owner', task: 'Предоставьте исследование', models: [], ...extra });
  const route = (ref, extra) => ({ ref, kind: 'route', models: [], ...extra });
  // Route by rule reads the answer of participant A of r1 (its JSON answer) as its source 0.
  const ruleRoute = (cases, extra = {}) => route('route:audit', { input: [{ step: 'r1', participant: 'A' }], select: { by: 'rule', cases, ...extra } });
  const ruleCase = (id, when, action) => ({ id, when, action });
  const eqCase = (id, value, action) => ruleCase(id, { source: 0, pointer: '/route', op: 'eq', value }, action);
  // A schema with one control step between r1 and the final synthesis: the step under test is at index 1.
  const around = (step) => base([round('r1', ['A', 'B']), step, synthesis('final', ['C'])]);
  const pathsOf = (step) => errorPaths(around(step));

  test('a control-only schema is valid: no round is needed, owner and route keep their place', () => {
    const schema = base([owner('owner:evidence', { output: { format: 'json', requiredFields: ['/evidence'] } }), gate('gate:g1', ['Claude']), route('route:next', { select: { by: 'owner', cases: [{ id: 'go', label: 'Дальше', action: { stop: 'Готово' } }] } })]);
    expect(Schema.validate(schema)).toEqual([]);
    const steps = Schema.assemble(schema);
    expect(steps.map((step) => [step.kind, step.ref])).toEqual([['owner', 'owner:evidence'], ['gate', 'gate:g1'], ['route', 'route:next']]);
    expect(steps[0]).toMatchObject({ task: 'Предоставьте исследование', models: [] });
  });

  test('control steps may stand between rounds, and gate takes criteria, pass, onFail', () => {
    const schema = base([round('r1', ['A']), gate('gate:g1', ['Claude'], { pass: 'any', onFail: 'ask' }), round('r2', ['A']), synthesis('final', ['B'])]);
    expect(Schema.validate(schema)).toEqual([]);
    const gateStep = Schema.assemble(schema)[1];
    expect(gateStep).toMatchObject({ kind: 'gate', criteria: ['Есть источники'], pass: 'any', onFail: 'ask' });
    expect(gateStep.models.map((model) => model.name)).toEqual(['Claude']);
  });

  test('gate, route and owner defaults come from DEFAULTS; route and owner without models stay in the plan', () => {
    expect(Schema.DEFAULTS.gate).toEqual({ pass: 'all', onFail: 'stop' });
    const schema = base([owner('owner:o'), route('route:m', { task: 'Выбери', models: [{ name: 'GPT' }], select: { by: 'model', cases: [{ id: 'a', label: 'А', action: { stop: 'А' } }] } }), route('route:r', { select: { by: 'owner', cases: [{ id: 'b', label: 'Б', action: { stop: 'Б' } }] } }), synthesis('final', ['B'])]);
    expect(Schema.validate(schema)).toEqual([]);
    const steps = Schema.assemble(schema);
    expect(steps.map((step) => step.ref)).toEqual(['owner:o', 'route:m', 'route:r', 'final']);
    expect(steps[1]).toMatchObject({ kind: 'route', models: [{ name: 'GPT' }] });
    expect(steps[0].models).toEqual([]);
    expect(steps[2].models).toEqual([]);
  });

  test('a gate without an enabled checker is a named schema error and never disappears from the plan', () => {
    const off = base([round('r1', ['A']), gate('gate:off', [{ name: 'Claude', enabled: false }]), synthesis('final', ['B'])]);
    expect(errorPaths(off)).toEqual(['steps[1].models']);
    expect(errorPaths(base([round('r1', ['A']), gate('gate:empty', []), synthesis('final', ['B'])]))).toEqual(['steps[1].models']);
  });

  test('a rule route with exact sources and conditions, and a route by model with one participant, are valid', () => {
    expect(pathsOf(ruleRoute([eqCase('close', 'close', { stop: 'Закрыть' }), eqCase('revise', 'revise', { stop: 'Доработать' })], { otherwise: { stop: 'Нет решения' } }))).toEqual([]);
    expect(pathsOf(ruleRoute([ruleCase('any', { any: [{ source: 0, pointer: '/a', op: 'exists' }, { source: 0, pointer: '/b', op: 'in', value: [1, 2] }] }, { stop: 'Дальше' })], { conflict: 'first' }))).toEqual([]);
    expect(pathsOf(route('route:m', { task: 'Выбери', models: [{ name: 'GPT' }], select: { by: 'model', cases: [{ id: 'a', label: 'Вариант А', action: { stop: 'А' } }, { id: 'b', label: 'Вариант Б', action: { stop: 'Б' } }] } }))).toEqual([]);
  });

  test('wrong gate, route and owner steps are named with their exact paths', () => {
    const at = 'steps[1]';
    const gateCases = [
      [{ criteria: undefined }, [`${at}.criteria`]],
      [{ criteria: [] }, [`${at}.criteria`]],
      [{ criteria: [''] }, [`${at}.criteria[0]`]],
      [{ pass: 'some' }, [`${at}.pass`]],
      [{ onFail: 'retry' }, [`${at}.onFail`]],
      [{ order: 'sequential' }, [`${at}.order`]]
    ];
    gateCases.forEach(([extra, paths]) => expect({ extra, paths: pathsOf(gate('gate:g1', ['Claude'], extra)) }).toEqual({ extra, paths }));
    expect(pathsOf(gate('check', ['Claude']))).toEqual([`${at}.ref`]);
    expect(pathsOf(gate('gate:g1', []))).toEqual([`${at}.models`]);

    const cases = [
      [route('audit', { select: { by: 'owner', cases: [{ id: 'x', label: 'x', action: { stop: 'y' } }] } }), [`${at}.ref`]],
      [route('route:a', { select: { by: 'random', cases: [{ id: 'x', label: 'x', action: { stop: 'y' } }] } }), [`${at}.select.by`]],
      [route('route:a'), [`${at}.select`]],
      [route('route:a', { select: { by: 'owner', cases: [] } }), [`${at}.select.cases`]],
      [route('route:a', { select: { by: 'owner', cases: [{ label: 'x', action: { stop: 'y' } }] } }), [`${at}.select.cases[0].id`]],
      [route('route:a', { select: { by: 'owner', cases: [{ id: 'x', label: 'x', action: { stop: 'y' } }, { id: 'x', label: 'z', action: { stop: 'w' } }] } }), [`${at}.select.cases[1].id`]],
      [route('route:a', { models: [{ name: 'GPT' }, { name: 'Claude' }], task: 'Выбери', select: { by: 'model', cases: [{ id: 'x', label: 'x', action: { stop: 'y' } }] } }), [`${at}.models`]],
      [route('route:a', { models: [{ name: 'GPT' }], select: { by: 'owner', cases: [{ id: 'x', label: 'x', action: { stop: 'y' } }] } }), [`${at}.models`]],
      [route('route:a', { task: 'Выбери', models: [{ name: 'GPT' }], select: { by: 'model', cases: [{ id: 'x', label: 'x', action: { stop: 'y' } }] } }), []],
      [route('route:a', { models: [{ name: 'GPT' }], select: { by: 'model', cases: [{ id: 'x', label: 'x', action: { stop: 'y' } }] } }), [`${at}.task`]],
      [route('route:a', { task: 'Выбери', models: [{ name: 'GPT' }], select: { by: 'model', cases: [{ id: 'x', action: { stop: 'y' } }] } }), [`${at}.select.cases[0].label`]],
      [route('route:a', { task: 'Выбери', models: [{ name: 'GPT' }], select: { by: 'model', cases: [{ id: 'x', label: 'x', when: { source: 0 }, action: { stop: 'y' } }] } }), [`${at}.select.cases[0].when`]],
      [route('route:a', { task: 'Выбери', models: [{ name: 'GPT' }], select: { by: 'model', cases: [{ id: 'x', label: 'x', action: { stop: 'y' } }], otherwise: { stop: 'z' } } }), [`${at}.select.otherwise`]],
      [route('route:a', { task: 'Выбери', models: [{ name: 'GPT' }], select: { by: 'model', conflict: 'first', cases: [{ id: 'x', label: 'x', action: { stop: 'y' } }] } }), [`${at}.select.conflict`]],
      [route('route:a', { input: 'none', select: { by: 'owner', cases: [{ id: 'x', label: 'x', action: { stop: 'y' } }] } }), [`${at}.input`]],
      [route('route:a', { select: { by: 'rule', cases: [eqCase('x', 'y', { stop: 'z' })] } }), [`${at}.input`]],
      [route('route:a', { input: [{ step: 'r1', participant: 'A' }], select: { by: 'rule', cases: [{ id: 'x', action: { stop: 'z' } }] } }), [`${at}.select.cases[0].when`]],
      [ruleRoute([eqCase('x', 'y', { stop: 'z' })].map((item) => ({ ...item, when: { source: 1, pointer: '/route', op: 'eq', value: 'y' } }))), [`${at}.select.cases[0].when.source`]],
      [ruleRoute([ruleCase('x', { source: 'A', pointer: '/route', op: 'eq', value: 'y' }, { stop: 'z' })]), [`${at}.select.cases[0].when.source`]],
      [ruleRoute([ruleCase('x', { source: 0, pointer: 'route', op: 'eq', value: 'y' }, { stop: 'z' })]), [`${at}.select.cases[0].when.pointer`]],
      [ruleRoute([ruleCase('x', { source: 0, pointer: '/route', op: 'like', value: 'y' }, { stop: 'z' })]), [`${at}.select.cases[0].when.op`]],
      [ruleRoute([ruleCase('x', { source: 0, pointer: '/route', op: 'eq' }, { stop: 'z' })]), [`${at}.select.cases[0].when.value`]],
      [ruleRoute([ruleCase('x', { source: 0, pointer: '/route', op: 'exists', value: 1 }, { stop: 'z' })]), [`${at}.select.cases[0].when.value`]],
      [ruleRoute([ruleCase('x', { source: 0, pointer: '/route', op: 'in', value: [] }, { stop: 'z' })]), [`${at}.select.cases[0].when.value`]],
      [ruleRoute([ruleCase('x', { all: [], }, { stop: 'z' })]), [`${at}.select.cases[0].when.all`]],
      [ruleRoute([ruleCase('x', { all: [{ source: 0, pointer: '/a', op: 'exists' }], any: [{ source: 0, pointer: '/a', op: 'exists' }] }, { stop: 'z' })]), [`${at}.select.cases[0].when`]],
      [ruleRoute([ruleCase('x', { source: 0, pointer: '/route', op: 'exists' }, undefined)]), [`${at}.select.cases[0].action`]],
      [ruleRoute([ruleCase('x', { source: 0, pointer: '/route', op: 'exists' }, { goto: 'final', stop: 'z' })]), [`${at}.select.cases[0].action`]],
      [ruleRoute([ruleCase('x', { source: 0, pointer: '/route', op: 'exists' }, { goto: '' })]), [`${at}.select.cases[0].action.goto`]],
      [ruleRoute([ruleCase('x', { source: 0, pointer: '/route', op: 'exists' }, { stop: '' })]), [`${at}.select.cases[0].action.stop`]],
      [ruleRoute([ruleCase('x', { source: 0, pointer: '/route', op: 'exists' }, { goto: 'final', maxLoops: 2, colour: 'red' })]), [`${at}.select.cases[0].action.colour`]]
    ];
    cases.forEach(([step, paths], index) => expect({ index, paths: pathsOf(step) }).toEqual({ index, paths }));

    expect(pathsOf(owner('evidence'))).toEqual([`${at}.ref`]);
    expect(pathsOf(owner('owner:o', { task: '' }))).toEqual([`${at}.task`]);
    expect(pathsOf(owner('owner:o', { models: [{ name: 'GPT' }] }))).toEqual([`${at}.models`]);
    expect(pathsOf(owner('owner:o', { owner: 'approve' }))).toEqual([`${at}.owner`]);
  });
});

describe('Basic schema: control steps on the canvas (9)', () => {
  const gateStep = { ref: 'gate:g1', kind: 'gate', criteria: ['Есть источники'], models: [{ name: 'GPT' }] };
  const owner = (ref) => ({ ref, kind: 'owner', task: 'Предоставьте исследование', models: [] });

  test('a gate, a route and an owner are on the canvas in the order of the schema, between rounds too', () => {
    const schema = base([
      owner('owner:evidence'), round('r1', ['GPT']), gateStep,
      { ref: 'route:next', kind: 'route', models: [], select: { by: 'owner', cases: [{ id: 'go', label: 'Дальше', action: { goto: 'final' } }] } },
      round('r2', ['GPT']), synthesis('final', ['GPT'])
    ]);
    const before = JSON.stringify(schema);
    const canvas = Schema.toCanvas(schema, { models: ['GPT'] });
    expect(canvas.errors).toEqual([]);
    expect(canvas.controls).toEqual([
      { ref: 'owner:evidence', kind: 'owner', index: 0, afterRound: 0 },
      { ref: 'gate:g1', kind: 'gate', index: 2, afterRound: 1 },
      { ref: 'route:next', kind: 'route', index: 3, afterRound: 1 }
    ]);
    expect(canvas.roundCounter).toBe(2);
    expect(JSON.stringify(schema)).toBe(before);
  });

  test('the rounds limit counts rounds only; an intermediate synthesis keeps its place after a round', () => {
    const many = Array.from({ length: 50 }, (_, index) => round(`r${index + 1}`, ['GPT']));
    expect(Schema.toCanvas(base([...many, gateStep, gateStep, synthesis('final', ['GPT'])]), { models: ['GPT'] }).errors).toEqual([]);
    expect(Schema.toCanvas(base([...many, round('r51', ['GPT']), synthesis('final', ['GPT'])]), { models: ['GPT'] }).errors.map((error) => error.path)).toEqual(['steps']);
    // A control step may stand between a round and its intermediate synthesis (R11); the synthesis still needs a round after it.
    expect(Schema.toCanvas(base([round('r1', ['GPT']), gateStep, synthesis('synth:x', ['GPT']), round('r2', ['GPT'])]), { models: ['GPT'] }).errors).toEqual([]);
    expect(Schema.toCanvas(base([round('r1', ['GPT']), gateStep, synthesis('synth:x', ['GPT']), synthesis('final', ['GPT'])]), { models: ['GPT'] }).errors.map((error) => error.path)).toEqual(['steps[2]']);
  });

  test('the settings keep every new field per kind and per participant, keyed by the participant id', () => {
    const schema = base([
      round('r1', [{ name: 'GPT', id: 'expert-1', input: 'none', task: 'T1' }, { name: 'GPT', id: 'expert-2', input: ['r0'] }], { require: 'all', owner: 'approve', chat: 'new', output: { name: 'Карта', sections: ['A'] } }),
      { ref: 'route:x', kind: 'route', input: [{ step: 'r1', participant: 'expert-1' }], task: 'Выбери', models: [], select: { by: 'rule', cases: [] } },
      synthesis('final', [{ name: 'Claude', request: 'R' }], { task: 'S' })
    ]);
    const settings = Schema.toSettings(schema);
    expect(settings.customRoundSettings.r1).toEqual({ require: 'all', owner: 'approve', chat: 'new', output: { name: 'Карта', sections: ['A'] } });
    expect(settings.customModelSettings.r1['expert-1']).toEqual({ task: 'T1', input: 'none' });
    expect(settings.customModelSettings.r1['expert-2']).toEqual({ input: ['r0'] });
    expect(settings.customStepSettings['route:x']).toEqual({ input: [{ step: 'r1', participant: 'expert-1' }], task: 'Выбери', select: { by: 'rule', cases: [] } });
    expect(settings.customStepSettings.final).toEqual({ task: 'S' });
  });
});

describe('Basic schema: transitions, loop limits and the graph (6.3, 6.4)', () => {
  const gate = (ref, models, extra = {}) => ({ ref, kind: 'gate', criteria: ['Есть источники'], models: models.map((name) => ({ name })), ...extra });
  // A route by owner at index 1 whose cases and otherwise take the given actions.
  const routeWith = (cases, extra = {}) => ({ ref: 'route:x', kind: 'route', models: [], select: { by: 'owner', cases: cases.map((action, at) => ({ id: `c${at}`, label: `Вариант ${at}`, action })), ...extra } });
  const plan = (step, tail = []) => base([round('r1', ['A']), step, round('r2', ['A']), synthesis('final', ['B']), ...tail]);
  const pathsOf = (schema) => errorPaths(schema);
  const CASE = 'steps[1].select.cases[0].action';

  test('a forward transition needs no limit, a backward one takes its limit from 1 to 5, a gate has onPass and onFail actions', () => {
    expect(Schema.validate(plan(routeWith([{ goto: 'final' }])))).toEqual([]);
    [1, 5].forEach((maxLoops) => expect(Schema.validate(plan(routeWith([{ goto: 'r1', maxLoops }])))).toEqual([]));
    expect(Schema.validate(plan(gate('gate:g1', ['A'], { onPass: { goto: 'final' }, onFail: { goto: 'r1', maxLoops: 2 } })))).toEqual([]);
  });

  test('the spec return: S19 goes back to S10 with resumeAt S19, G1 returns to the point of continuation', () => {
    const schema = base([
      round('r1', ['A']), routeWith([{ goto: 'r1', maxLoops: 2, resumeAt: 'route:x' }]), gate('gate:g1', ['A'], { onPass: { return: true, maxLoops: 2 } }), synthesis('final', ['B'])
    ]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(Schema.assemble(schema)[2].onPass).toEqual({ return: true, maxLoops: 2 });
  });

  test('feedback may come from the current or a later step, invalidate names existing steps', () => {
    expect(Schema.validate(plan(routeWith([{ goto: 'r1', maxLoops: 1, feedback: [{ step: 'r2', participant: 'A' }, 'final'], invalidate: ['r2'] }])))).toEqual([]);
  });

  test('a wrong transition is named with the path of its action', () => {
    const cases = [
      [routeWith([{ goto: 'r9' }]), [`${CASE}.goto`]],
      [routeWith([{ goto: 'r1' }]), [CASE]],
      [routeWith([{ goto: 'route:x' }]), [CASE]],
      [routeWith([{ goto: 'r1', maxLoops: 0 }]), [`${CASE}.maxLoops`]],
      [routeWith([{ goto: 'r1', maxLoops: 6 }]), [`${CASE}.maxLoops`]],
      [routeWith([{ goto: 'r1', maxLoops: 1.5 }]), [`${CASE}.maxLoops`]],
      [routeWith([{ goto: 'r1', maxLoops: '2' }]), [`${CASE}.maxLoops`]],
      [routeWith([{ stop: 'Конец', maxLoops: 2 }]), [`${CASE}.maxLoops`]],
      [routeWith([{ goto: 'final', resumeAt: 'r9' }]), [`${CASE}.resumeAt`]],
      [routeWith([{ goto: 'final', feedback: [] }]), [`${CASE}.feedback`]],
      [routeWith([{ goto: 'final', feedback: ['r9'] }]), [`${CASE}.feedback[0]`]],
      [routeWith([{ goto: 'final', invalidate: [] }]), [`${CASE}.invalidate`]],
      [routeWith([{ goto: 'final', invalidate: ['r9'] }]), [`${CASE}.invalidate[0]`]],
      [routeWith([{ return: true }]), [CASE]],
      [routeWith([{ goto: 'final', colour: 'red' }]), [`${CASE}.colour`]]
    ];
    cases.forEach(([step, paths], index) => expect({ index, paths: pathsOf(plan(step)) }).toEqual({ index, paths }));
  });

  test('a return back needs a limit, and a return must have a point of continuation', () => {
    const back = base([round('r1', ['A']), routeWith([{ goto: 'r1', maxLoops: 1, resumeAt: 'route:x' }]), gate('gate:g1', ['A'], { onPass: { return: true } }), synthesis('final', ['B'])]);
    expect(pathsOf(back)).toEqual(['steps[2].onPass']);
    expect(pathsOf(plan(gate('gate:g1', ['A'], { onPass: { return: true } })))).toEqual(['steps[1].onPass']);
  });

  test('a gate without onPass goes on to the next step, and a stop action stops', () => {
    expect(Schema.validate(plan(gate('gate:g1', ['A'], { onFail: { stop: 'Нет' } })))).toEqual([]);
    expect(pathsOf(plan(gate('gate:g1', ['A'], { onFail: 'retry' })))).toEqual(['steps[1].onFail']);
  });

  test('a graph of transitions: linear steps, unlimited edges and limited edges; a cycle of unlimited edges is named by its action', () => {
    const steps = [
      { ref: 'r1', kind: 'round', models: [{ name: 'A' }] },
      { ref: 'route:x', kind: 'route', models: [], select: { by: 'owner', cases: [{ id: 'back', label: 'Назад', action: { goto: 'r1' } }] } },
      { ref: 'final', kind: 'synthesis', models: [{ name: 'B' }] }
    ];
    const graph = Schema.graph(steps);
    expect(graph.edges).toEqual([
      { from: 0, to: 1, limited: false, path: 'steps[0]' },
      { from: 1, to: 0, limited: false, path: 'steps[1].select.cases[0].action' }
    ]);
    expect(graph.cycle).toBe('steps[1].select.cases[0].action');
    steps[1].select.cases[0].action.maxLoops = 2;
    expect(Schema.graph(steps).cycle).toBeNull();
  });
});


describe('Basic schema: transitions never point at a switched-off step (A04 request)', () => {
  // r3 has no enabled model: a switched-off step. The route at index 1 may point at it; the ordinary input may not stop there.
  const offStep = (enabled) => round('r3', [{ name: 'B', enabled }]);
  const plan = (action, enabled = false, extra = {}) => base([
    round('r1', ['A']),
    { ref: 'route:x', kind: 'route', models: [], select: { by: 'owner', cases: [{ id: 'c', label: 'Вариант', action }], ...extra } },
    offStep(enabled),
    synthesis('final', ['C'])
  ]);
  const ACTION = 'steps[1].select.cases[0].action';

  test('the same schema with the step switched on is valid for every field', () => {
    expect(Schema.validate(plan({ goto: 'r3' }, true))).toEqual([]);
    expect(Schema.validate(plan({ goto: 'final', resumeAt: 'r3' }, true))).toEqual([]);
    expect(Schema.validate(plan({ goto: 'final', invalidate: ['r3'] }, true))).toEqual([]);
    expect(Schema.validate(plan({ goto: 'final', feedback: [{ step: 'r3', participant: 'B' }] }, true))).toEqual([]);
  });

  test('a goto, a resumeAt, an invalidate and a feedback to a switched-off step are named with their path', () => {
    expect(errorPaths(plan({ goto: 'r3' }))).toEqual([`${ACTION}.goto`]);
    expect(errorPaths(plan({ goto: 'final', resumeAt: 'r3' }))).toEqual([`${ACTION}.resumeAt`]);
    expect(errorPaths(plan({ goto: 'final', invalidate: ['r3'] }))).toEqual([`${ACTION}.invalidate[0]`]);
    expect(errorPaths(plan({ goto: 'final', feedback: ['r3'] }))).toEqual([`${ACTION}.feedback[0]`]);
    expect(errorPaths(plan({ goto: 'final', feedback: [{ step: 'r3', participant: 'B' }] }))).toEqual([`${ACTION}.feedback[0].step`]);
  });

  test('an otherwise of a route to a switched-off step is named too', () => {
    const rule = base([
      round('r1', ['A']),
      { ref: 'route:x', kind: 'route', models: [], input: [{ step: 'r1', participant: 'A' }], select: { by: 'rule', cases: [{ id: 'c', when: { source: 0, pointer: '/route', op: 'exists' }, action: { stop: 'Конец' } }], otherwise: { goto: 'r3' } } },
      offStep(false),
      synthesis('final', ['C'])
    ]);
    expect(errorPaths(rule)).toEqual(['steps[1].select.otherwise.goto']);
  });

  test('an ordinary input may still name a switched-off step: it has no answers, the step is a valid reference', () => {
    const schema = base([round('r1', ['A']), offStep(false), round('r4', ['A'], { input: ['r3'] })]);
    expect(Schema.validate(schema)).toEqual([]);
  });

  test('assembly keeps criteria, pass, onFail, onPass and select of a gate and a route', () => {
    const schema = base([
      round('r1', ['A']),
      { ref: 'gate:g1', kind: 'gate', criteria: ['Есть источники'], pass: 'any', onFail: { stop: 'Нет' }, onPass: { goto: 'final' }, models: [{ name: 'Claude' }] },
      { ref: 'route:x', kind: 'route', models: [], select: { by: 'owner', cases: [{ id: 'c', label: 'Вариант', action: { goto: 'final' } }] } },
      synthesis('final', ['C'])
    ]);
    expect(Schema.validate(schema)).toEqual([]);
    const [, gate, route] = Schema.assemble(schema);
    expect(gate).toMatchObject({ criteria: ['Есть источники'], pass: 'any', onFail: { stop: 'Нет' }, onPass: { goto: 'final' } });
    expect(route.select).toEqual({ by: 'owner', cases: [{ id: 'c', label: 'Вариант', action: { goto: 'final' } }] });
  });
});

describe('Basic schema: a whole step as a required source (3.1, D3)', () => {
  // r1 has A and B; r2 is the step under test (index 1).
  const withInput = (input) => base([round('r1', ['A', 'B']), round('r2', ['A'], { input }), synthesis('final', ['C'])]);

  test('{ step, required } is the whole accepted result of a step: valid, kept by assemble', () => {
    const input = [{ step: 'r1', required: true }];
    expect(Schema.validate(withInput(input))).toEqual([]);
    expect(Schema.assemble(withInput(input))[1].input).toEqual(input);
  });

  test('a whole step and a participant of the same step are two different sources; a plain ref alone stays valid', () => {
    expect(Schema.validate(withInput([{ step: 'r1', required: true }, { step: 'r1', participant: 'A', required: false }]))).toEqual([]);
    expect(Schema.validate(withInput(['r1']))).toEqual([]);
  });

  test('a plain step ref and an object on the same whole step are a duplicate, named at the object', () => {
    expect(errorPaths(withInput(['r1', { step: 'r1', required: true }]))).toEqual(['steps[1].input[1]']);
    expect(errorPaths(withInput([{ step: 'r1' }, { step: 'r1', required: true }]))).toEqual(['steps[1].input[1]']);
  });

  test('wrong whole-step sources are named with their exact path', () => {
    const cases = [
      [[{ required: true }], ['steps[1].input[0]']],
      [[{ step: 'r1', required: 'yes' }], ['steps[1].input[0].required']],
      [[{ step: 'r1', colour: 'x' }], ['steps[1].input[0].colour']],
      [[{ step: 'r9', required: true }], ['steps[1].input[0].step']],
      [[{ step: 'r2', required: true }], ['steps[1].input[0].step']]
    ];
    cases.forEach(([input, paths]) => expect({ input, paths: errorPaths(withInput(input)) }).toEqual({ input, paths }));
  });
});

describe('Basic schema: an own output of a participant (3.2, D4)', () => {
  const proposalRef = (participant) => ({ artifact: { step: 'r1', participant, id: 'proposal' }, version: 'latest', required: true });
  const shared = { artifacts: [{ id: 'proposal', name: 'Предложение', pointer: '' }] };
  // Two authors of one parallel step r1 share the output; each author of r2 continues its own line.
  const author = (participant, name, extra = {}) => ({ name, id: participant, input: [proposalRef(participant)], output: { artifacts: [{ id: 'proposal', name: `Доработанное ${name}`, pointer: '', revisionOf: proposalRef(participant) }] }, ...extra });
  const valid = () => base([
    round('r1', [{ name: 'claude', id: 'author-A' }, { name: 'gpt', id: 'author-B' }], { output: shared }),
    round('r2', [author('author-A', 'claude'), author('author-B', 'gpt')]),
    synthesis('final', ['claude'])
  ]);
  const pathsOf = (schema) => errorPaths(schema);

  test('each author of one step has its own line; its declaration reaches assemble as the model output', () => {
    const schema = valid();
    expect(Schema.validate(schema)).toEqual([]);
    const r2 = Schema.assemble(schema)[1];
    expect(r2.models[0].output).toEqual(schema.steps[1].models[0].output);
    expect(r2.models[1].output).toEqual(schema.steps[1].models[1].output);
    expect(Schema.toSettings(schema).customModelSettings.r2['author-A'].output).toEqual(schema.steps[1].models[0].output);
    expect(Schema.toCanvas(schema, { models: ['claude', 'gpt'] }).errors).toEqual([]);
  });

  test('an own declaration replaces the shared output as a whole; a participant without one inherits it', () => {
    const schema = base([
      round('r1', [{ name: 'claude', id: 'author-A' }, { name: 'gpt', id: 'author-B', output: { artifacts: [{ id: 'notes', name: 'Заметки', pointer: '' }] } }], { output: shared }),
      round('r2', [{ name: 'claude', id: 'author-A', input: [proposalRef('author-A')], output: { artifacts: [{ id: 'proposal', name: 'Доработано', pointer: '', revisionOf: proposalRef('author-A') }] } }]),
      synthesis('final', ['claude'])
    ]);
    expect(Schema.validate(schema)).toEqual([]);
    const sourceOf = (participant, id) => ({ artifact: { step: 'r1', participant, id }, version: 'latest' });
    // author-B no longer declares proposal: the shared one is not merged into its own output.
    const reader = (source) => base([round('r1', [{ name: 'claude', id: 'author-A' }, { name: 'gpt', id: 'author-B', output: { artifacts: [{ id: 'notes', name: 'Заметки', pointer: '' }] } }], { output: shared }), round('r2', [{ name: 'claude', id: 'reader', input: [source] }]), synthesis('final', ['claude'])]);
    expect(pathsOf(reader(sourceOf('author-A', 'proposal')))).toEqual([]);
    expect(pathsOf(reader(sourceOf('author-B', 'proposal')))).toEqual(['steps[1].models[0].input[0].artifact.id']);
    expect(pathsOf(reader(sourceOf('author-B', 'notes')))).toEqual([]);
  });

  test('a wrong own output is named with its full path', () => {
    const cases = [
      [{ artifacts: [{ id: 'x', name: 'X', pointer: '/x' }] }, ['steps[1].models[0].output.artifacts[0].pointer']],
      [{ extra: 1 }, ['steps[1].models[0].output.extra']],
      [{ format: 'json', artifacts: [{ id: 'x', name: 'X', pointer: '/x' }, { id: 'x', name: 'Y', pointer: '/y' }] }, ['steps[1].models[0].output.artifacts[1].id']]
    ];
    cases.forEach(([output, paths]) => {
      const schema = valid();
      schema.steps[1].models[0] = { ...schema.steps[1].models[0], output };
      expect({ output, paths: pathsOf(schema) }).toEqual({ output, paths: expect.arrayContaining(paths) });
      expect(pathsOf(schema).every((path) => path.startsWith('steps[1].models[0].output'))).toBe(true);
    });
  });

  test('a revision must be in the input of this author with the same address; a route has no output', () => {
    // author-A's input holds the line of author-B only: the revision of author-A is not in its own input.
    const otherLine = valid();
    otherLine.steps[1].models[0] = { ...otherLine.steps[1].models[0], input: [proposalRef('author-B')] };
    expect(pathsOf(otherLine)).toEqual(['steps[1].models[0].output.artifacts[0].revisionOf']);
    const otherAddress = valid();
    otherAddress.steps[1].models[0].output.artifacts[0].revisionOf = { ...proposalRef('author-A'), version: { step: 'r1', participant: 'author-A', visit: 1 } };
    expect(pathsOf(otherAddress)).toEqual(['steps[1].models[0].output.artifacts[0].revisionOf']);
    const route = base([round('r1', ['A']), { ref: 'route:r', kind: 'route', models: [{ name: 'GPT', output: { artifacts: [] } }], task: 'Выбери', select: { by: 'model', cases: [{ id: 'a', label: 'А', action: { stop: 'А' } }] } }, synthesis('final', ['B'])]);
    expect(pathsOf(route)).toEqual(['steps[1].models[0].output']);
  });

  test('a shared output of a step still checks its revisions against the authors that inherit it', () => {
    const schema = base([
      round('r1', [{ name: 'claude', id: 'author-A' }], { output: shared }),
      round('r2', [{ name: 'claude', id: 'author-A', input: [proposalRef('author-A')] }], { output: { artifacts: [{ id: 'proposal', name: 'Доработано', pointer: '', revisionOf: proposalRef('author-A') }] } }),
      synthesis('final', ['B'])
    ]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(pathsOf(base([round('r1', [{ name: 'claude', id: 'author-A' }], { output: shared }), round('r2', [{ name: 'claude', id: 'author-A' }], { output: { artifacts: [{ id: 'proposal', name: 'Доработано', pointer: '', revisionOf: proposalRef('author-A') }] } }), synthesis('final', ['B'])]))).toEqual(['steps[1].output.artifacts[0].revisionOf']);
  });
});

describe('Basic schema: the participant of an owner step is owner (3.3, R08)', () => {
  const ownerStep = (ref, extra = {}) => ({ ref, kind: 'owner', task: 'Ответьте на вопрос', models: [], ...extra });
  const mapRef = (participant = 'A', step = 'r1') => ({ artifact: { step, participant, id: 'map' }, version: 'latest' });
  const mapOutput = { artifacts: [{ id: 'map', name: 'Карта', pointer: '' }] };
  const ownerSource = { step: 'owner:o', participant: 'owner' };

  test('the owner step takes owner as its one participant: step, artifact, exact version and feedback are valid', () => {
    const schema = base([
      round('r1', ['A'], { output: mapOutput }),
      ownerStep('owner:o', { output: { artifacts: [{ id: 'approved', name: 'Утверждённая карта', pointer: '' }] } }),
      round('r2', [{ name: 'A', input: [ownerSource, { artifact: { step: 'owner:o', participant: 'owner', id: 'approved' }, version: { step: 'owner:o', participant: 'owner', visit: 1 } }] }]),
      { ref: 'gate:g1', kind: 'gate', criteria: ['Есть ответ'], models: [{ name: 'B' }], onFail: { goto: 'r2', maxLoops: 1, feedback: [ownerSource] } },
      synthesis('final', ['B'])
    ]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(Schema.assemble(schema)[1]).toMatchObject({ kind: 'owner', ref: 'owner:o' });
    expect(Schema.assemble(schema)[2].models[0].input).toEqual([ownerSource, { artifact: { step: 'owner:o', participant: 'owner', id: 'approved' }, version: { step: 'owner:o', participant: 'owner', visit: 1 } }]);
  });

  test('V06: the owner step takes input none, previous, all or a list of sources; any other value is refused with its path', () => {
    ['none', 'previous', 'all', ['r1']].forEach((input) => {
      expect(errorPaths(base([round('r1', ['A']), ownerStep('owner:o', { input })]))).toEqual([]);
    });
    expect(errorPaths(base([round('r1', ['A']), ownerStep('owner:o', { input: 'last' })]))).toEqual(['steps[1].input']);
  });

  test('a revision of an owner artifact is valid when the author has it in its input', () => {
    const revision = { artifact: { step: 'owner:o', participant: 'owner', id: 'map' }, version: 'latest' };
    const schema = base([
      ownerStep('owner:o', { output: mapOutput }),
      round('r2', [{ name: 'A', input: [revision], output: { artifacts: [{ id: 'map', name: 'Карта v2', pointer: '', revisionOf: revision }] } }]),
      synthesis('final', ['B'])
    ]);
    expect(Schema.validate(schema)).toEqual([]);
    const missing = base([ownerStep('owner:o', { output: mapOutput }), round('r2', [{ name: 'A', output: { artifacts: [{ id: 'map', name: 'Карта v2', pointer: '', revisionOf: revision }] } }]), synthesis('final', ['B'])]);
    expect(errorPaths(missing)).toEqual(['steps[1].models[0].output.artifacts[0].revisionOf']);
  });

  test('another participant of an owner step is named; the owner artifact of another participant is named too', () => {
    const cases = [
      [[{ step: 'owner:o', participant: 'A' }], ['steps[1].models[0].input[0].participant']],
      [[{ artifact: { step: 'owner:o', participant: 'A', id: 'map' }, version: 'latest' }], ['steps[1].models[0].input[0].artifact.participant']],
      [[{ artifact: { step: 'owner:o', participant: 'owner', id: 'nope' }, version: 'latest' }], ['steps[1].models[0].input[0].artifact.id']]
    ];
    cases.forEach(([input, paths]) => {
      const schema = base([ownerStep('owner:o', { output: mapOutput }), round('r2', [{ name: 'A', input }]), synthesis('final', ['B'])]);
      expect({ input, paths: errorPaths(schema) }).toEqual({ input, paths });
    });
  });

  test('a model with the id owner in an ordinary step is an ordinary participant', () => {
    const schema = base([round('r1', [{ name: 'Claude', id: 'owner' }], { output: mapOutput }), round('r2', [{ name: 'B', input: [{ step: 'r1', participant: 'owner' }, mapRef('owner')] }]), synthesis('final', ['B'])]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(Schema.assemble(schema)[0].models[0]).toMatchObject({ name: 'Claude', id: 'owner' });
  });

  test('the owner keeps no models; its own sources are checked like a model step (a self or a later step is named)', () => {
    const input = [mapRef('A'), 'r1', ownerSource, { step: 'r2', required: true }];
    const schema = base([round('r1', ['A'], { output: mapOutput }), ownerStep('owner:o', { input, output: mapOutput }), round('r2', ['A']), synthesis('final', ['B'])]);
    expect(errorPaths(schema)).toEqual(['steps[1].input[2].step', 'steps[1].input[3].step']);
    const valid = base([round('r1', ['A'], { output: mapOutput }), ownerStep('owner:o', { input: [mapRef('A'), 'r1'], output: mapOutput }), synthesis('final', ['B'])]);
    expect(Schema.validate(valid)).toEqual([]);
    expect(Schema.assemble(valid)[1]).toMatchObject({ kind: 'owner', input: [mapRef('A'), 'r1'], models: [] });
  });
});

describe('Basic schema: the input of an owner step (N07)', () => {
  const ownerStep = (ref, extra = {}) => ({ ref, kind: 'owner', task: 'Ответьте', models: [], ...extra });
  const source = { step: 'r1', participant: 'A', required: true };

  test('an owner step without input keeps the empty input of before: no input field is assembled', () => {
    const steps = Schema.assemble(base([round('r1', ['A']), ownerStep('owner:o'), synthesis('final', ['B'])]));
    expect(steps[1]).not.toHaveProperty('input');
  });

  test('the owner input is kept by assemble and by the settings; the same sources as a model step', () => {
    const schema = base([round('r1', ['A']), ownerStep('owner:o', { input: [source, 'r1'] }), synthesis('final', ['B'])]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(Schema.assemble(schema)[1].input).toEqual([source, 'r1']);
    expect(Schema.toSettings(schema).customStepSettings['owner:o']).toMatchObject({ input: [source, 'r1'] });
  });

  test('a wrong owner input is named with its exact path, as for a model step', () => {
    const schema = base([round('r1', ['A']), ownerStep('owner:o', { input: [{ step: 'r1', participant: 'Z' }, 'owner:o'] }), synthesis('final', ['B'])]);
    expect(errorPaths(schema)).toEqual(['steps[1].input[0].participant', 'steps[1].input[1]']);
  });
});

describe('Basic schema: a pipeline without a round is checked the same way everywhere (R09)', () => {
  const owner = (ref) => ({ ref, kind: 'owner', task: 'Предоставьте исследование', models: [] });
  const gate = (ref, models) => ({ ref, kind: 'gate', criteria: ['Есть источники'], models: models.map((name) => ({ name })) });
  const route = (ref) => ({ ref, kind: 'route', models: [], select: { by: 'owner', cases: [{ id: 'go', label: 'Дальше', action: { stop: 'Готово' } }] } });

  test('an owner-only pipeline is valid: no round is added, the canvas shows the owner and no round', () => {
    const schema = base([owner('owner:o')]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(Schema.assemble(schema)).toEqual([expect.objectContaining({ kind: 'owner', ref: 'owner:o' })]);
    const canvas = Schema.toCanvas(schema, { models: [] });
    expect(canvas.errors).toEqual([]);
    expect(canvas.rounds).toEqual([]);
    expect(canvas.controls).toEqual([{ ref: 'owner:o', kind: 'owner', index: 0, afterRound: 0 }]);
  });

  test('a standalone owner route and a gate with a checker are valid pipelines too', () => {
    expect(Schema.validate(base([route('route:next')]))).toEqual([]);
    expect(Schema.validate(base([gate('gate:g1', ['Claude'])]))).toEqual([]);
    expect(Schema.toCanvas(base([gate('gate:g1', ['Claude'])]), { models: ['Claude'] }).errors).toEqual([]);
  });

  test('an empty pipeline and a pipeline with no executable step are named at steps, validate and canvas alike', () => {
    expect(errorPaths(base([]))).toEqual(['steps']);
    expect(Schema.toCanvas(base([]), { models: [] }).errors.map((error) => error.path)).toEqual(['steps']);
    const allOff = base([round('r1', [{ name: 'A', enabled: false }]), synthesis('final', [{ name: 'B', enabled: false }])]);
    expect(errorPaths(allOff)).toEqual(['steps']);
    expect(Schema.toCanvas(allOff, { models: ['A', 'B'] }).errors.map((error) => error.path)).toEqual(['steps']);
  });

  test('the limit of 50 counts rounds only: an owner between rounds does not count', () => {
    const many = Array.from({ length: 50 }, (_, index) => round(`r${index + 1}`, ['A']));
    expect(Schema.toCanvas(base([...many, owner('owner:o')]), { models: ['A'] }).errors).toEqual([]);
    expect(Schema.toCanvas(base([...many, round('r51', ['A'])]), { models: ['A'] }).errors.map((error) => error.path)).toEqual(['steps']);
  });
});

describe('Basic schema: the order of a synthesis and control steps (R11)', () => {
  const gate = (ref, models) => ({ ref, kind: 'gate', criteria: ['Есть источники'], models: models.map((name) => ({ name })) });
  const route = (ref) => ({ ref, kind: 'route', models: [], select: { by: 'owner', cases: [{ id: 'go', label: 'Дальше', action: { stop: 'Готово' } }] } });
  const owner = (ref) => ({ ref, kind: 'owner', task: 'Предоставьте исследование', models: [] });
  const refsOf = (steps) => steps.map((step) => step.ref);
  const models = ['A', 'B', 'C', 'S'];

  test('both orders are valid and the canvas keeps them: r1 → synth → gate → r2 and r1 → gate → synth → r2', () => {
    const synthFirst = base([round('r1', ['A']), synthesis('synth:x', ['S']), gate('gate:g', ['C']), round('r2', ['A']), synthesis('final', ['B'])]);
    const gateFirst = base([round('r1', ['A']), gate('gate:g', ['C']), synthesis('synth:x', ['S']), round('r2', ['A']), synthesis('final', ['B'])]);
    [synthFirst, gateFirst].forEach((schema) => {
      expect(Schema.validate(schema)).toEqual([]);
      expect(refsOf(Schema.assemble(schema))).toEqual(refsOf(schema.steps));
      const canvas = Schema.toCanvas(schema, { models });
      expect(canvas.errors).toEqual([]);
      expect(canvas.controls).toEqual([{ ref: 'gate:g', kind: 'gate', index: schema.steps.findIndex((step) => step.ref === 'gate:g'), afterRound: 1 }]);
      expect(canvas.inserts).toEqual([expect.objectContaining({ afterRound: 1, plannedStageId: 'x' })]);
    });
  });

  test('consecutive control steps keep their order next to a synthesis, and no round is needed beside them', () => {
    const schema = base([round('r1', ['A']), gate('gate:g', ['C']), route('route:r'), synthesis('synth:x', ['S']), owner('owner:o'), round('r2', ['A']), synthesis('final', ['B'])]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(refsOf(Schema.assemble(schema))).toEqual(['r1', 'gate:g', 'route:r', 'synth:x', 'owner:o', 'r2', 'final']);
    expect(Schema.toCanvas(schema, { models }).errors).toEqual([]);
  });

  test('a synthesis after a synthesis stays refused, also with a control step between them', () => {
    const adjacent = base([round('r1', ['A']), synthesis('synth:x', ['S']), synthesis('synth:y', ['S']), round('r2', ['A']), synthesis('final', ['B'])]);
    expect(Schema.validate(adjacent).map((error) => [error.path, error.message])).toEqual([
      ['steps[1]', 'промежуточный синтез стоит между двумя раундами'],
      ['steps[2]', 'промежуточный синтез стоит сразу после раунда']
    ]);
    const withGate = base([round('r1', ['A']), synthesis('synth:x', ['S']), gate('gate:g', ['C']), synthesis('synth:y', ['S']), round('r2', ['A']), synthesis('final', ['B'])]);
    expect(errorPaths(withGate)).toEqual(['steps[1]', 'steps[3]']);
    expect(Schema.toCanvas(withGate, { models }).errors.map((error) => error.path)).toEqual(['steps[1]', 'steps[3]']);
  });

  test('an intermediate synthesis without a round on one side is named by validate and the canvas alike', () => {
    const noRoundAfter = base([round('r1', ['A']), gate('gate:g', ['C']), synthesis('synth:x', ['S']), synthesis('final', ['B'])]);
    expect(errorPaths(noRoundAfter)).toEqual(['steps[2]']);
    expect(Schema.toCanvas(noRoundAfter, { models }).errors.map((error) => error.path)).toEqual(['steps[2]']);
    const first = base([synthesis('synth:x', ['S']), round('r1', ['A']), synthesis('final', ['B'])]);
    expect(errorPaths(first)).toEqual(['steps[0]']);
    expect(Schema.toCanvas(first, { models }).errors.map((error) => error.path)).toEqual(['steps[0]']);
  });
});

describe('Basic schema: a switched-off declared participant keeps its declaration (R12)', () => {
  const schemaWith = (r2Input) => base([
    round('r1', ['A', { name: 'GPT', id: 'gpt-1' }, { name: 'C', id: 'c-1', enabled: false }], { require: 'all' }),
    round('r2', [{ name: 'A', input: r2Input }]),
    synthesis('final', ['B'])
  ]);

  test('the declaration of a switched-off participant reaches the settings even without other settings', () => {
    const settings = Schema.toSettings(schemaWith(['r1']));
    expect(settings.customModelSettings.r1['c-1']).toEqual({ name: 'C', enabled: false });
    expect(settings.customModelSettings.r1.A).toBeUndefined();
    expect(settings.customModelSettings.r1['gpt-1']).toBeUndefined();
  });

  test('an optional source to a switched-off participant is valid and keeps its id in the settings and assembly', () => {
    const schema = schemaWith(['r1', { step: 'r1', participant: 'c-1' }]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(Schema.toSettings(schema).customModelSettings.r2.A.input).toEqual(['r1', { step: 'r1', participant: 'c-1' }]);
    expect(Schema.assemble(schema)[1].models[0].input).toEqual(['r1', { step: 'r1', participant: 'c-1' }]);
  });

  test('a required source to a switched-off participant is not a validator error: the run decides it; require all leaves it out', () => {
    const schema = schemaWith([{ step: 'r1', participant: 'c-1', required: true }]);
    expect(Schema.validate(schema)).toEqual([]);
    const first = Schema.assemble(schema)[0];
    expect(first.models.map((model) => model.id)).toEqual(['A', 'gpt-1']);
    expect(first.require).toBe('all');
  });

  test('switching the participant on again keeps its id and its place in the step', () => {
    const on = base([round('r1', ['A', { name: 'GPT', id: 'gpt-1' }, { name: 'C', id: 'c-1' }]), synthesis('final', ['B'])]);
    expect(Schema.validate(on)).toEqual([]);
    expect(Schema.assemble(on)[0].models.map((model) => model.id)).toEqual(['A', 'gpt-1', 'c-1']);
  });
});
