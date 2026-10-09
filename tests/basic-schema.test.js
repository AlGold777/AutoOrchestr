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
