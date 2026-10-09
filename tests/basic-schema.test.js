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
      name: 'A', promptTemplate: null, maxWords: null, extra: '', task: Schema.DEFAULTS.roundTask, discipline: { ...Schema.DEFAULTS.discipline }
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
      { name: 'Claude', input: true, send: true, role: 'critic' }, { name: 'GPT', input: true, send: true, role: null }
    ]);
    expect(canvas.stacks['r2-models'].items.map((item) => [item.name, item.send])).toEqual([['Claude', false], ['GPT', true]]);
    expect(canvas.rounds.map((item) => item.participantIds)).toEqual([['Claude', 'GPT'], ['GPT']]);
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

  test('a schema the canvas cannot show is named, not changed', () => {
    const places = (schema, extra) => toCanvas(schema, extra).errors.map((error) => error.path);
    expect(places(base([round('r1', ['Nobody'])]))).toEqual(['steps[0].models[0].name']);
    expect(places(base([round('r1', [{ name: 'GPT', role: 'ghost' }])]), { isRole: () => false })).toEqual(['steps[0].models[0].role']);
    expect(places(base([round('r2', ['GPT'])]))).toEqual(['steps[0].ref']);
    expect(places(base([synthesis('final', ['GPT']), round('r1', ['GPT'])]))).toContain('steps[0].ref');
    expect(places(base([round('r1', ['GPT']), synthesis('synth:a', ['Claude'])]))).toEqual(['steps[1]']);
    expect(places(base([synthesis('synth:a', ['Claude']), round('r1', ['GPT'])]))).toEqual(['steps[0]']);
    expect(places(base([round('r1', ['GPT']), synthesis('synth:', ['Claude']), round('r2', ['GPT'])]))).toEqual(['steps[1].ref']);
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
    expect(Schema.resolveRun(base([]))).toEqual({ policy: 'manual', maxWords: 300 });
    expect(Schema.resolveRun(base([], { run: { policy: 'auto' } }))).toEqual({ policy: 'auto', maxWords: 300 });
    expect(Schema.resolveRun(base([], { run: { policy: 'manual', maxWords: 700 } }))).toEqual({ policy: 'manual', maxWords: 700 });
    expect(Schema.validate(base([], { run: { policy: 'auto', maxWords: 700 } }))).toEqual([]);
    expect(errorPaths(base([], { run: { policy: 'sometimes' } }))).toEqual(['run.policy']);
    expect(errorPaths(base([], { run: { maxWords: 0 } }))).toEqual(['run.maxWords']);
    expect(errorPaths(base([], { run: { speed: 1 } }))).toEqual(['run.speed']);
    expect(errorPaths(base([], { run: 5 }))).toEqual(['run']);
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
  test('the minimal example of the reference passes the check', () => {
    const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'Pipeline scenarios', 'basic-schema-reference.md'), 'utf8');
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
    expect(errorPaths({ steps: [] })).toEqual(['schemaVersion', 'origin']);
    expect(errorPaths(base([{ ref: 'r1', kind: 'loop', models: [] }]))).toEqual(['steps[0].kind']);
    expect(errorPaths(base([round('r1', ['A'], { order: 'random' })]))).toEqual(['steps[0].order']);
    expect(errorPaths(base([round('r1', ['A'], { input: 'everything' })]))).toEqual(['steps[0].input']);
    expect(errorPaths(base([synthesis('final', ['A'], { order: 'sequential' })]))).toEqual(['steps[0].order']);
    expect(errorPaths(base([synthesis('final', ['A'], { input: 'all' })]))).toEqual(['steps[0].input']);
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
        synthesis('synth:z', ['B'], { task: 'T' }), synthesis('final', ['B'])
      ]
    };
    expect(Schema.validate(full)).toEqual([]);
    expect(Schema.assemble(full)).toHaveLength(4);
  });
});
