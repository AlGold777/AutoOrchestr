const fs = require('fs');
const path = require('path');
const Engine = require('../disput/custom-engine');
const Schema = require('../disput/basic-schema');

const base = (steps, extra = {}) => ({ schemaVersion: 1, origin: 'user', steps, ...extra });
const round = (ref, models, extra = {}) => ({ ref, kind: 'round', models: models.map((name) => (typeof name === 'string' ? { name } : name)), ...extra });
const errorPaths = (schema) => Schema.validate(schema).map((error) => error.path);

describe('Basic schema: defaults and inheritance', () => {
  test('the Basic defaults are the ones the engine and cards always used', () => {
    expect(Schema.DEFAULTS.roundTask).toBe('Учти ответы предыдущего шага и дай свой улучшенный ответ на задачу.');
    expect(Schema.DEFAULTS).not.toHaveProperty('synthesisTask');
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
    expect(Schema.resolveFields({}, 'round', {}, {}).task).toEqual({ value: Schema.DEFAULTS.roundTask, source: 'basic' });
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
  test('rounds and defaults give the steps the engine runs; a synthesis is a round of one model with a role', () => {
    const steps = Schema.assemble(base([
      round('r1', ['A', 'B']), round('r2', ['A']), round('r3', [{ name: 'C', role: 'interaction_meta_synthesis' }])
    ]), { roleText: (role) => (role ? `ROLE ${role}` : '') });
    expect(steps.map((step) => [step.kind, step.ref, step.input])).toEqual([
      ['round', 'r1', 'none'], ['round', 'r2', 'previous'], ['round', 'r3', 'previous']
    ]);
    steps.forEach((step) => { expect(step).not.toHaveProperty('order'); expect(step).not.toHaveProperty('require'); });
    expect(steps[0].task).toBe('');
    expect(steps[0].models.map((model) => model.task)).toEqual(['', '']);
    expect(steps[1].task).toBe(Schema.DEFAULTS.roundTask);
    expect(steps[2].task).toBe(Schema.DEFAULTS.roundTask);
    expect(steps[2].models).toEqual([expect.objectContaining({ name: 'C', extra: 'ROLE interaction_meta_synthesis' })]);
    expect(steps[1].models[0]).toEqual({
      name: 'A', id: 'A', promptTemplate: null, maxWords: null, extra: '', task: Schema.DEFAULTS.roundTask, discipline: { ...Schema.DEFAULTS.discipline }
    });
  });

  test('explicit input and task of a step reach its models', () => {
    const [first, second] = Schema.assemble(base([
      round('r1', ['A']),
      round('r2', ['A', 'B'], { input: 'all', task: 'STEP_TASK' })
    ]));
    expect(first.input).toBe('none');
    expect(second).toMatchObject({ input: 'all', task: 'STEP_TASK' });
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

  test('a model without its own request takes no request of another step of the same model', () => {
    const steps = Schema.assemble(base([
      round('r1', ['A']), round('r2', ['S', 'T']), round('r3', [{ name: 'S', request: 'LAST TEXT' }])
    ]));
    expect(steps[1].models.map((model) => model.promptTemplate)).toEqual([null, null]);
    expect(steps[2].models[0].promptTemplate).toBe('LAST TEXT');
  });

  test('a schema with the removed kind synthesis is refused at its kind, with the way to write it now', () => {
    const old = base([round('r1', ['A', 'B']), { ref: 'final', kind: 'synthesis', models: [{ name: 'C' }] }]);
    expect(Schema.validate(old)).toEqual([{ path: 'steps[1].kind', message: 'тип шага: допустимо round, owner; синтез — роль: раунд из одной модели с role' }]);
    expect(Schema.toCanvas(old, { models: ['A', 'B', 'C'] }).errors.length).toBeGreaterThan(0);
  });

  test('a switched-off step stays valid, keeps the numbering and gives the engine nothing', () => {
    const schema = base([round('r1', []), round('r2', ['A']), round('r3', [])]);
    expect(Schema.validate(schema)).toEqual([]);
    const steps = Schema.assemble(schema);
    expect(steps.map((step) => step.ref)).toEqual(['r2']);
    // The first round that runs has nothing to take (plan 2.6): no input, and the inherited «previous answers» task is not sent.
    expect(steps[0].input).toBe('none');
    expect(steps[0].task).toBe('');
    expect(steps[0].models[0].task).toBe('');
  });

  test('a new optional field does not change an old schema: assembled steps are stable', () => {
    const oldSchema = base([round('r1', ['A', 'B']), round('r2', ['C'])]);
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

describe('Basic schema: a synthesis is a round of one model with a role', () => {
  const synthesisSchema = () => base([
    round('r1', ['A', 'B']),
    round('r2', [{ name: 'C', role: 'interaction_meta_synthesis' }], { task: 'Сведи ответы в один.' })
  ], { run: { policy: 'auto' } });

  test('the schema passes the check and stands on the canvas as rounds, without inserts and a synthesizer', () => {
    const schema = synthesisSchema();
    expect(Schema.validate(schema)).toEqual([]);
    const canvas = Schema.toCanvas(schema, { models: ['A', 'B', 'C'], isRole: (id) => id === 'interaction_meta_synthesis' });
    expect(canvas.errors).toEqual([]);
    expect(canvas.rounds.map((item) => [item.ref, item.participantIds])).toEqual([['r1', ['A', 'B']], ['r2', ['C']]]);
    expect(canvas.stacks['r2-models'].items.filter((item) => item.send)).toEqual([{ name: 'C', id: 'C', input: true, send: true, role: 'interaction_meta_synthesis' }]);
    expect(Object.keys(canvas).sort()).toEqual(['controls', 'errors', 'roundCounter', 'rounds', 'selectedModels', 'stacks']);
  });

  test('the engine runs it linearly; the result is the accepted answers of the last round', async () => {
    const steps = Schema.assemble(synthesisSchema(), { roleText: (role) => (role ? `ROLE ${role}` : '') });
    const calls = [];
    const send = async (models, prompts) => {
      calls.push({ models, prompts });
      return { byModel: Object.fromEntries(models.map((name) => [name, { text: `answer of ${name}`, status: 'SUCCESS' }])) };
    };
    const result = await Engine.run({ task: 'T', steps, send });
    expect(result.stopReason).toBe('steps_done');
    expect(calls.map((call) => call.models)).toEqual([['A', 'B'], ['C']]);
    expect(calls[1].prompts.C).toContain('Ответ 1:\nanswer of A');
    expect(calls[1].prompts.C).toContain('Сведи ответы в один.');
    expect(calls[1].prompts.C).toContain('ROLE interaction_meta_synthesis');
    expect(result.steps.map((step) => [step.ref, step.kind, step.label])).toEqual([['r1', 'round', 'Раунд 1'], ['r2', 'round', 'Раунд 2']]);
    expect(result.answers).toEqual(['answer of C']);
  });
});

describe('Basic schema: the canvas a schema stands for', () => {
  const canvasModels = ['Claude', 'GPT', 'Gemini', 'Grok'];
  const toCanvas = (schema, extra = {}) => Schema.toCanvas(schema, { models: canvasModels, ...extra });

  test('rounds and models with roles; the last round of one model with a role is an ordinary round', () => {
    const schema = base([
      round('r1', [{ name: 'GPT' }, { name: 'Claude', role: 'critic' }]),
      round('r2', ['GPT']), round('r3', [{ name: 'Claude', role: 'interaction_meta_synthesis' }])
    ]);
    const canvas = toCanvas(schema);
    expect(canvas.errors).toEqual([]);
    expect(canvas.roundCounter).toBe(3);
    expect(canvas.selectedModels).toEqual(['Claude', 'GPT']);
    expect(canvas.stacks['r1-models'].items).toEqual([
      { name: 'GPT', id: 'GPT', input: true, send: true, role: null }, { name: 'Claude', id: 'Claude', input: true, send: true, role: 'critic' }
    ]);
    expect(canvas.stacks['r2-models'].items.map((item) => [item.name, item.send])).toEqual([['GPT', true]]);
    expect(canvas.stacks['r3-models'].items).toEqual([
      { name: 'Claude', id: 'Claude', input: true, send: true, role: 'interaction_meta_synthesis' }
    ]);
    expect(canvas.rounds.map((item) => item.participantIds)).toEqual([['GPT', 'Claude'], ['GPT'], ['Claude']]);
    expect(canvas).not.toHaveProperty('synthesizer');
    expect(canvas).not.toHaveProperty('inserts');
  });

  test('a switched-off model and a switched-off round are not sent', () => {
    const canvas = toCanvas(base([
      round('r1', ['GPT', { name: 'Grok', enabled: false, request: 'KEPT' }]),
      round('r2', []), round('r3', [])
    ]));
    expect(canvas.errors).toEqual([]);
    expect(canvas.selectedModels).toEqual(['GPT']);
    expect(canvas.roundCounter).toBe(3);
    expect(canvas.stacks['r2-models'].items.every((item) => item.send === false)).toBe(true);
  });

  test('onCanvas keeps a model on the canvas with Send off in every round; without it the model is not on the canvas', () => {
    const schema = base([
      round('r1', ['GPT', { name: 'Grok', enabled: false, onCanvas: true, request: 'KEPT' }]),
      round('r2', ['GPT', { name: 'Grok', enabled: false, onCanvas: true }])
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
    expect(Schema.toSettings(schema).customModelSettings.r1.Grok).toEqual({ promptTemplate: 'KEPT', name: 'Grok', enabled: false, onCanvas: true });
    // A switched-off model with onCanvas is not called, and the schema without the mark gives the same engine steps.
    expect(Schema.assemble(schema).flatMap((step) => step.models.map((model) => model.name))).not.toContain('Grok');
    const unmarked = base([round('r1', ['GPT', { name: 'Grok', enabled: false, request: 'KEPT' }]), round('r2', ['GPT', { name: 'Grok', enabled: false }])]);
    expect(toCanvas(unmarked).selectedModels).toEqual(['GPT']);
    expect(Schema.assemble(unmarked)).toEqual(Schema.assemble(schema));
  });

  test('onCanvas is a boolean and a known field; a schema without it is valid as before', () => {
    expect(errorPaths(base([round('r1', ['GPT', { name: 'Grok', enabled: false, onCanvas: 'yes' }])]))).toEqual(['steps[0].models[1].onCanvas']);
    expect(errorPaths(base([round('r1', ['GPT', { name: 'Grok', enabled: false, onCanvas: true, extra: 1 }])]))).toEqual(['steps[0].models[1].extra']);
    expect(errorPaths(base([round('r1', [{ name: 'GPT', onCanvas: false }])]))).toEqual([]);
    expect(errorPaths(base([round('r1', [{ name: 'GPT' }, { name: 'Grok', enabled: false }]), round('r2', ['GPT'])]))).toEqual([]);
  });

  test('a schema the canvas cannot show is named, not changed', () => {
    const places = (schema, extra) => toCanvas(schema, extra).errors.map((error) => error.path);
    expect(places(base([round('r1', ['Nobody'])]))).toEqual(['steps[0].models[0].name']);
    expect(places(base([round('r1', [{ name: 'GPT', role: 'ghost' }])]), { isRole: () => false })).toEqual(['steps[0].models[0].role']);
    expect(places(base([round('r2', ['GPT'])]))).toEqual(['steps[0].ref']);
    expect(places(base([round('final', ['GPT']), round('r2', ['GPT'])]))).toEqual(['steps[0].ref']);
    expect(places(base([round('r1', ['GPT'])], { run: { maxWords: 250 } }), { runWords: [300, 500, 700, 1000] })).toEqual(['run.maxWords']);
    expect(places(base([round('r1', ['GPT'])], { run: { maxWords: 500 } }), { runWords: [300, 500, 700, 1000] })).toEqual([]);
    expect(places(base([round('r1', ['GPT'])], { run: { maxWords: 250 } }))).toEqual([]);
    expect(places(base([round('r1', [{ name: 'GPT', enabled: false }])]))).toEqual(['steps']);
  });
});

describe('Basic schema: values are kept as given until the end', () => {
  test('an empty own request is a value', () => {
    const steps = Schema.assemble(base([round('r1', [{ name: 'S', request: '' }, { name: 'T' }])]));
    expect(steps[0].models.map((model) => model.promptTemplate)).toEqual(['', null]);
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
    expect(Schema.resolveRun(base([round('r1', ['A'])]))).toEqual({ policy: 'manual', maxWords: 300, strictLength: false });
    expect(Schema.resolveRun(base([round('r1', ['A'])], { run: { policy: 'auto' } }))).toEqual({ policy: 'auto', maxWords: 300, strictLength: false });
    expect(Schema.resolveRun(base([round('r1', ['A'])], { run: { policy: 'manual', maxWords: 700 } }))).toEqual({ policy: 'manual', maxWords: 700, strictLength: false });
    expect(Schema.validate(base([round('r1', ['A'])], { run: { policy: 'auto', maxWords: 700 } }))).toEqual([]);
    expect(errorPaths(base([round('r1', ['A'])], { run: { policy: 'sometimes' } }))).toEqual(['run.policy']);
    expect(errorPaths(base([round('r1', ['A'])], { run: { maxWords: 0 } }))).toEqual(['run.maxWords']);
    expect(errorPaths(base([round('r1', ['A'])], { run: { speed: 1 } }))).toEqual(['run.speed']);
    expect(errorPaths(base([round('r1', ['A'])], { run: 5 }))).toEqual(['run']);
  });

  test('run.strictLength is an optional true or false of the whole run; without it the run is not strict', () => {
    expect(Schema.validate(base([round('r1', ['A'])], { run: { strictLength: true } }))).toEqual([]);
    expect(Schema.validate(base([round('r1', ['A'])], { run: { strictLength: false } }))).toEqual([]);
    expect(Schema.resolveRun(base([round('r1', ['A'])], { run: { strictLength: true } }))).toEqual({ policy: 'manual', maxWords: 300, strictLength: true });
    expect(Schema.resolveRun(base([round('r1', ['A'])], { run: { strictLength: false } })).strictLength).toBe(false);
    expect(errorPaths(base([round('r1', ['A'])], { run: { strictLength: 'yes' } }))).toEqual(['run.strictLength']);
    expect(errorPaths(base([round('r1', ['A'])], { run: { strictLength: 1 } }))).toEqual(['run.strictLength']);
    expect(Schema.describeErrors(Schema.validate(base([round('r1', ['A'])], { run: { strictLength: 1 } })))).toBe('run.strictLength: ожидается true или false');
  });
});

describe('Basic schema: a switched-off round keeps its number', () => {
  const schema = base([round('r1', []), round('r2', ['A', 'B']), round('r3', ['S']), round('r4', ['A']), round('r5', ['S'])]);

  test('assembly gives the original number and the id of every step', () => {
    const steps = Schema.assemble(schema);
    expect(steps.map((step) => [step.ref, step.round])).toEqual([['r2', 2], ['r3', 3], ['r4', 4], ['r5', 5]]);
    expect(steps.map((step) => step.input)).toEqual(['none', 'previous', 'previous', 'previous']);
  });

  test('the preview, the journal and the run use the same numbers and ids', async () => {
    const steps = Schema.assemble(schema);
    expect(Engine.previewPrompt({ task: 'T', steps, stepIndex: 0, modelName: 'A' }).label).toBe('Раунд 2');
    expect(Engine.previewPrompt({ task: 'T', steps, stepIndex: 1, modelName: 'S' }).label).toBe('Раунд 3');
    const events = [];
    const send = async (models) => ({ byModel: Object.fromEntries(models.map((name) => [name, { text: `answer of ${name}`, status: 'SUCCESS' }])) });
    const result = await Engine.run({ task: 'T', steps, send, onEvent: (kind, fields) => events.push([kind, fields]) });
    const start = events.find(([kind]) => kind === 'custom_start')[1];
    expect(start.steps.map((step) => [step.ref, step.label])).toEqual([
      ['r2', 'Раунд 2'], ['r3', 'Раунд 3'], ['r4', 'Раунд 4'], ['r5', 'Раунд 5']
    ]);
    expect(result.history.map((entry) => entry.ref)).toEqual(['r2', 'r2', 'r3', 'r4', 'r5']);
    expect(result.steps.map((step) => step.label)).toEqual(['Раунд 2', 'Раунд 3', 'Раунд 4', 'Раунд 5']);
  });

  test('without the numbers the engine counts the steps it got, as before', () => {
    const labels = Engine.normalizeSteps([{ kind: 'round', models: ['A'] }, { kind: 'owner', task: 'T', models: [] }, { kind: 'round', models: ['A'] }]);
    expect(labels.map((step) => [step.kind, step.round])).toEqual([['round', 1], ['owner', null], ['round', 2]]);
  });
});

describe('Basic schema: check before the first request', () => {
  test('the first example of the guide passes the check', () => {
    const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'Pipeline scenarios', 'basic-schema-guide.md'), 'utf8');
    const example = JSON.parse(doc.match(/```json\n([\s\S]*?)\n```/)[1]);
    expect(Schema.validate(example)).toEqual([]);
    expect(Schema.assemble(example).map((step) => step.ref)).toEqual(['r1']);
  });

  test('a format from a newer Basic is refused, older released formats stay supported', () => {
    const errors = Schema.validate(base([round('r1', ['A'])], { schemaVersion: Schema.SCHEMA_VERSION + 1 }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ path: 'schemaVersion' });
    expect(errors[0].message).toContain('более новой версией Basic');
    Schema.SUPPORTED_VERSIONS.forEach((version) => {
      const value = base([round('r1', ['A'])], { schemaVersion: version });
      if (version >= 2) value.steps[0].models[0].id = 'participant-a';
      expect(Schema.validate(value)).toEqual([]);
    });
    expect(Schema.SUPPORTED_VERSIONS).toContain(1);
  });

  test('every wrong place is named, nothing is corrected silently', () => {
    expect(errorPaths(null)).toEqual(['']);
    expect(errorPaths({ steps: [] })).toEqual(['schemaVersion', 'origin', 'steps']);
    expect(errorPaths(base([{ ref: 'r1', kind: 'loop', models: [] }]))).toEqual(['steps[0].kind', 'steps']);
    expect(errorPaths(base([round('r1', ['A'], { input: 'everything' })]))).toEqual(['steps[0].input']);
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
      defaults: { roundTask: 'R', discipline: { limit: 'l', content: 'c', delivery: 'd', correction: 'k', lines: ['x'] }, modelNotes: { A: 'n' }, roundPrompts: { r2: 'p' } },
      steps: [
        round('r1', [{ name: 'A', role: 'x', request: 'q', maxWords: 10, task: 't', discipline: { limit: '', lines: [] } }]),
        round('r2', ['A'], { input: 'previous', task: '' }),
        round('r3', ['B'], { task: 'T' }), round('r4', ['B'])
      ]
    };
    expect(Schema.validate(full)).toEqual([]);
    expect(Schema.assemble(full)).toHaveLength(4);
    expect(errorPaths({ ...full, defaults: { synthesisTask: 'S' } })).toEqual(['defaults.synthesisTask']);
  });
});

describe('Basic schema: an explicit task is sent with input none', () => {
  test('a task of the step and of the model reaches the first round, the model task comes first', () => {
    const steps = Schema.assemble(base([
      round('r1', [{ name: 'A' }, { name: 'B', task: 'MODEL_TASK' }], { task: 'STEP_TASK' })
    ]));
    expect(steps[0].input).toBe('none');
    expect(steps[0].task).toBe('STEP_TASK');
    expect(steps[0].models.map((model) => model.task)).toEqual(['STEP_TASK', 'MODEL_TASK']);
  });

  test('the Basic and ▶ tasks are not sent with input none, the inherited value does not appear', () => {
    const steps = Schema.assemble(base([round('r1', ['A'])], { defaults: { roundTask: 'PIPELINE_TASK' } }));
    expect(steps[0].task).toBe('');
    expect(steps[0].models[0].task).toBe('');
    expect(JSON.stringify(steps)).not.toContain('PIPELINE_TASK');
    expect(JSON.stringify(steps)).not.toContain(Schema.DEFAULTS.roundTask);
  });

  test('an explicit empty task is a value: it stops the ▶ task from coming in', () => {
    const steps = Schema.assemble(base([round('r1', [{ name: 'A', task: '' }], { task: '' }), round('r2', ['C'])], { defaults: { roundTask: 'PIPELINE_TASK' } }));
    expect(steps[0].task).toBe('');
    expect(steps[0].models[0].task).toBe('');
  });

  test('a full own request of the model works as before, the task stays as given', () => {
    const steps = Schema.assemble(base([round('r1', [{ name: 'A', request: 'Задача: {задача}', task: 'MODEL_TASK' }]), round('r2', ['C'])]));
    expect(steps[0].models[0]).toMatchObject({ promptTemplate: 'Задача: {задача}', task: 'MODEL_TASK' });
  });

  test('the preview shows the explicit task of the first round and nothing inherited', () => {
    const withTask = Schema.assemble(base([round('r1', ['A'], { task: 'STEP_TASK' }), round('r2', ['C'])]));
    expect(Engine.previewPrompt({ task: 'T', steps: withTask, stepIndex: 0, modelName: 'A' }).prompt).toBe('Задача:\nT\n\nЗадание:\nSTEP_TASK');
    const without = Schema.assemble(base([round('r1', ['A']), round('r2', ['C'])], { defaults: { roundTask: 'PIPELINE_TASK' } }));
    expect(Engine.previewPrompt({ task: 'T', steps: without, stepIndex: 0, modelName: 'A' }).prompt).toBe('Задача:\nT');
  });

  test('explicit tasks survive the settings of the cards and a JSON round trip', () => {
    const schema = base([round('r1', [{ name: 'A', task: 'MODEL_TASK' }], { task: 'STEP_TASK' }), round('r2', ['C'])]);
    const reloaded = JSON.parse(JSON.stringify(schema));
    expect(Schema.validate(reloaded)).toEqual([]);
    expect(Schema.assemble(reloaded)).toEqual(Schema.assemble(schema));
    const settings = Schema.toSettings(reloaded);
    expect(settings.customRoundSettings.r1).toEqual({ task: 'STEP_TASK' });
    expect(settings.customModelSettings.r1.A).toEqual({ name: 'A', task: 'MODEL_TASK' });
  });
});

describe('Basic schema: the order of participants on the canvas', () => {
  const canvasModels = ['Claude', 'GPT', 'Gemini', 'Grok'];
  const toCanvas = (schema, extra = {}) => Schema.toCanvas(schema, { models: canvasModels, ...extra });
  const itemNames = (canvas, ref) => canvas.stacks[`${ref}-models`].items.map((item) => item.name);

  test('a round keeps the order of its models from the schema, not the order of the canvas', () => {
    const canvas = toCanvas(base([round('r1', ['GPT', 'Claude']), round('r2', ['Claude'])]));
    expect(canvas.errors).toEqual([]);
    expect(canvas.selectedModels).toEqual(['Claude', 'GPT']);
    expect(itemNames(canvas, 'r1')).toEqual(['GPT', 'Claude']);
    expect(canvas.rounds[0].participantIds).toEqual(['GPT', 'Claude']);
  });

  test('each round has its own order', () => {
    const canvas = toCanvas(base([round('r1', ['GPT', 'Claude']), round('r2', ['Claude', 'GPT'])]));
    expect(itemNames(canvas, 'r1')).toEqual(['GPT', 'Claude']);
    expect(itemNames(canvas, 'r2')).toEqual(['Claude', 'GPT']);
    expect(canvas.rounds.map((item) => item.participantIds)).toEqual([['GPT', 'Claude'], ['Claude', 'GPT']]);
  });

  test('a round shows only its own participants: no model of another round stands in its stack', () => {
    const canvas = toCanvas(base([round('r1', ['GPT']), round('r2', ['Claude'])]));
    expect(canvas.stacks['r1-models'].items).toEqual([{ name: 'GPT', id: 'GPT', input: true, send: true, role: null }]);
    expect(canvas.stacks['r2-models'].items).toEqual([{ name: 'Claude', id: 'Claude', input: true, send: true, role: null }]);
    expect(canvas.rounds.map((item) => item.participantIds)).toEqual([['GPT'], ['Claude']]);
  });

  test('the engine still runs the models in the order of the schema', () => {
    const steps = Schema.assemble(base([round('r1', ['GPT', 'Claude']), round('r2', ['Claude'])]));
    expect(steps[0].models.map((model) => model.name)).toEqual(['GPT', 'Claude']);
  });

  test('a switched-off model keeps its settings, and the canvas does not change the schema', () => {
    const schema = base([round('r1', ['GPT', { name: 'Claude', enabled: false, task: 'KEPT_TASK' }]), round('r2', ['GPT'])]);
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
  // r1 has A and B, r2 has A, mid has S, r3 has A and a switched-off C; the step under test is r4.
  const withInput = (input) => base([
    round('r1', ['A', 'B']), round('r2', ['A']), round('mid', ['S']),
    round('r3', ['A', { name: 'C', enabled: false }]), round('r4', ['A'], { input })
  ]);

  test('a list of step refs and participant addresses is valid, keeps its order and reaches assemble', () => {
    const input = ['r1', { step: 'r3', participant: 'C' }, 'mid', { step: 'r2', participant: 'A' }];
    expect(Schema.validate(withInput(input))).toEqual([]);
    expect(Schema.assemble(withInput(input))[4].input).toEqual(input);
  });

  test('a step ref and a participant of the same step are two different sources', () => {
    expect(Schema.validate(withInput(['r1', { step: 'r1', participant: 'A' }]))).toEqual([]);
  });

  test('a switched-off step stays a valid reference', () => {
    expect(Schema.validate(base([round('r1', []), round('r2', ['A'], { input: ['r1'] })]))).toEqual([]);
  });

  test('a round of one model takes a list too', () => {
    const schema = base([round('r1', ['A']), round('r2', ['A']), round('r3', ['B'], { input: ['r1', 'r2'] })]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(Schema.assemble(schema)[2].input).toEqual(['r1', 'r2']);
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

  test('a later step is not a source; the last round is an ordinary source', () => {
    expect(errorPaths(base([round('r1', ['A']), round('r2', ['B']), round('r3', ['A'], { input: ['r2'] })]))).toEqual([]);
    expect(errorPaths(base([round('r1', ['A'], { input: ['r2'] }), round('r2', ['A'])]))).toEqual(['steps[0].input[0]']);
  });
});

describe('Basic schema: participants with an id and their own input (4.2)', () => {
  test('two participants of one model in a round are two participants, each with its id', () => {
    const schema = base([round('r1', [{ name: 'GPT', id: 'expert-1' }, { name: 'GPT', id: 'expert-2' }]), round('r2', ['Claude'])]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(Schema.assemble(schema)[0].models.map((model) => [model.name, model.id])).toEqual([['GPT', 'expert-1'], ['GPT', 'expert-2']]);
  });

  test('a model without an id has the name as its id, and an explicit id may differ from another name', () => {
    const schema = base([round('r1', ['A', { name: 'A', id: 'second' }]), round('r2', ['A'])]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(Schema.assemble(schema)[0].models.map((model) => model.id)).toEqual(['A', 'second']);
  });

  test('the same explicit id in two steps is one participant with the same name', () => {
    const schema = base([
      round('r1', [{ name: 'GPT', id: 'author' }]),
      round('r2', [{ name: 'GPT', id: 'author', input: ['r1'] }, { name: 'Claude', input: 'none' }]),
      round('r3', [{ name: 'GPT', id: 'author' }])
    ]);
    expect(Schema.validate(schema)).toEqual([]);
    const [, second] = Schema.assemble(schema);
    expect(second.models[0]).toMatchObject({ id: 'author', input: ['r1'] });
    expect(second.models[1]).toMatchObject({ id: 'Claude', input: 'none' });
  });

  test('a participant input replaces the step input in the assembled step, and a list of its own goes with it', () => {
    const schema = base([round('r1', ['A']), round('r2', [{ name: 'B', input: [{ step: 'r1', participant: 'A' }] }], { input: 'all' }), round('r3', ['B'])]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(Schema.assemble(schema)[1].models[0].input).toEqual([{ step: 'r1', participant: 'A' }]);
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
    expect(errorPaths(base([round('r1', ['A']), round('r2', [{ name: 'B', id: 'A' }]), round('r3', ['B'])]))).toEqual(['steps[1].models[0].name']);
    expect(errorPaths(base([round('r1', [{ name: 'A', id: 'x' }]), round('r2', [{ name: 'B', id: 'x' }])]))).toEqual(['steps[1].models[0].name']);
    expect(errorPaths(base([round('r1', ['A']), round('r2', [{ name: 'B', input: [{ step: 'r1', participant: 'Z' }] }])]))).toEqual(['steps[1].models[0].input[0].participant']);
  });

  test('a participant cannot take the answers of its own step or of a later one', () => {
    expect(errorPaths(base([round('r1', ['A']), round('r2', [{ name: 'A', input: ['r2'] }])]))).toEqual(['steps[1].models[0].input[0]']);
    expect(errorPaths(base([round('r1', [{ name: 'A', input: ['r2'] }]), round('r2', ['A'])]))).toEqual(['steps[0].models[0].input[0]']);
  });
});

describe('Basic schema: the canvas and participants with an id', () => {
  test('two participants of one model in a round are two blocks, each with its id, in the order of the schema', () => {
    const canvas = Schema.toCanvas(base([round('r1', [{ name: 'GPT', id: 'expert-2' }, { name: 'Claude' }, { name: 'GPT', id: 'expert-1' }]), round('r2', ['Claude'])]), { models: ['GPT', 'Claude'] });
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
    const text = base([round('r1', ['A'], { output: textOutput }), round('r2', ['B'])]);
    expect(Schema.validate(text)).toEqual([]);
    expect(Schema.assemble(text)[0].output).toEqual(textOutput);
    const json = base([round('r1', ['A'], { output: jsonOutput }), round('r2', ['B'])]);
    expect(Schema.validate(json)).toEqual([]);
    expect(Schema.assemble(json)[0].output).toEqual(jsonOutput);
  });

  test('a single text artifact covers the whole answer with an empty pointer, and a declared artifact can be an input', () => {
    const schema = base([
      round('r1', ['A'], { output: { artifacts: [{ id: 'map', name: 'Map', pointer: '' }] } }),
      round('r2', [{ name: 'B', input: [mapRef] }]),
      round('r3', ['B'])
    ]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(Schema.assemble(schema)[1].models[0].input).toEqual([mapRef]);
  });

  test('a revision names the earlier version it continues and that version is in the input of the author', () => {
    const schema = base([
      round('r1', ['A'], { output: { artifacts: [{ id: 'map', name: 'Map', pointer: '' }] } }),
      round('r2', ['A'], { input: [mapRef], output: { artifacts: [{ id: 'map', name: 'Map v2', pointer: '', revisionOf: mapRef }] } }),
      round('r3', ['B'])
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
    const revision = (revisionOf) => base([round('r1', ['A'], declared), round('r2', ['A'], { input: ['r1'], output: { artifacts: [{ id: 'map', name: 'Map v2', pointer: '', revisionOf }] } }), round('r3', ['B'])]);
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

describe('Basic schema: the removed fields require and order, owner approval and chat (4.2, 1.4)', () => {
  test('require and order are refused at their path with what the round does now', () => {
    [['any'], ['all'], [2]].forEach(([require]) => {
      expect(Schema.validate(base([round('r1', ['A', 'B'], { require })]))).toEqual([
        { path: 'steps[0].require', message: 'поле require не поддерживается: раунд ждёт ответов всех своих моделей' }]);
    });
    ['parallel', 'sequential'].forEach((order) => {
      expect(Schema.validate(base([round('r1', ['A', 'B'], { order })]))).toEqual([
        { path: 'steps[0].order', message: 'поле order не поддерживается: все модели раунда отвечают независимо; эстафета — раунды по одной модели подряд' }]);
    });
  });

  test('owner approval and the chat of the step reach assemble; the defaults are not written', () => {
    const schema = base([round('r1', ['A'], { owner: 'approve', chat: 'new' }), round('r2', ['B'], { owner: 'approve' })]);
    expect(Schema.validate(schema)).toEqual([]);
    const steps = Schema.assemble(schema);
    expect(steps[0]).toMatchObject({ owner: 'approve', chat: 'new' });
    expect(steps[1].owner).toBe('approve');
    expect(steps[1]).not.toHaveProperty('chat');
  });

  test('wrong values are named with their exact path', () => {
    const cases = [
      [{ owner: 'auto' }, 'steps[0].owner'],
      [{ owner: '' }, 'steps[0].owner'],
      [{ chat: 'keep' }, 'steps[0].chat']
    ];
    cases.forEach(([extra, path]) => expect({ extra, paths: errorPaths(base([round('r1', ['A', 'B'], extra)])) }).toEqual({ extra, paths: [path] }));
  });
});

describe('Basic schema: owner steps (4.1); gate and route are removed', () => {
  const owner = (ref, extra = {}) => ({ ref, kind: 'owner', task: 'Предоставьте исследование', models: [], ...extra });
  // A schema with one step between r1 and r2: the step under test is at index 1.
  const around = (step) => base([round('r1', ['A', 'B']), step, round('r2', ['C'])]);
  const pathsOf = (step) => errorPaths(around(step));
  const REMOVED = 'тип шага: допустимо round, owner; проверка — обычный раунд: критерии в task; решение принимает User шагом owner';

  test('an owner-only schema is valid: no round is needed, the owner keeps its place and has no models', () => {
    const schema = base([owner('owner:evidence', { output: { format: 'json', requiredFields: ['/evidence'] } })]);
    expect(Schema.validate(schema)).toEqual([]);
    const steps = Schema.assemble(schema);
    expect(steps.map((step) => [step.kind, step.ref])).toEqual([['owner', 'owner:evidence']]);
    expect(steps[0]).toMatchObject({ task: 'Предоставьте исследование', models: [] });
  });

  test('an owner step may stand between rounds; the plan is linear', () => {
    const schema = base([round('r1', ['A']), owner('owner:ok'), round('r2', ['A']), round('r3', ['B'])]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(Schema.assemble(schema).map((step) => step.ref)).toEqual(['r1', 'owner:ok', 'r2', 'r3']);
    expect(Schema.DEFAULTS).not.toHaveProperty('gate');
    expect(Schema.DEFAULTS).not.toHaveProperty('route');
  });

  test('a schema with a gate is refused at its kind, with the way to write a check now', () => {
    const gate = { ref: 'gate:g1', kind: 'gate', criteria: ['Есть источники'], pass: 'any', onFail: { goto: 'final', maxLoops: 2 }, models: [{ name: 'Claude' }] };
    expect(Schema.validate(around(gate))).toEqual([{ path: 'steps[1].kind', message: REMOVED }]);
  });

  test('a schema with a route is refused at its kind, with the same text', () => {
    const route = { ref: 'route:x', kind: 'route', models: [], select: { by: 'owner', cases: [{ id: 'c', label: 'Вариант', action: { goto: 'final' } }] } };
    expect(Schema.validate(around(route))).toEqual([{ path: 'steps[1].kind', message: REMOVED }]);
    expect(Schema.describeErrors(Schema.validate(around(route)))).toBe(`steps[1].kind: ${REMOVED}`);
  });

  test('a transition field left on a round or an owner is an unknown field at its path', () => {
    expect(Schema.validate(base([round('r1', ['A'], { onFail: { goto: 'final', maxLoops: 2 } }), round('r2', ['B'])])))
      .toEqual([{ path: 'steps[0].onFail', message: 'неизвестное поле' }]);
    expect(pathsOf(owner('owner:o', { select: { by: 'owner' } }))).toEqual(['steps[1].select']);
  });

  test('wrong owner steps are named with their exact paths', () => {
    const at = 'steps[1]';
    expect(pathsOf(owner('evidence'))).toEqual([`${at}.ref`]);
    expect(pathsOf(owner('owner:o', { task: '' }))).toEqual([`${at}.task`]);
    expect(pathsOf(owner('owner:o', { models: [{ name: 'GPT' }] }))).toEqual([`${at}.models`]);
    expect(pathsOf(owner('owner:o', { owner: 'approve' }))).toEqual([`${at}.owner`]);
  });
});

describe('Basic schema: owner steps on the canvas (9)', () => {
  const owner = (ref) => ({ ref, kind: 'owner', task: 'Предоставьте исследование', models: [] });

  test('owner steps are on the canvas in the order of the schema, between rounds too', () => {
    const schema = base([owner('owner:evidence'), round('r1', ['GPT']), owner('owner:ok'), round('r2', ['GPT']), round('r3', ['GPT'])]);
    const before = JSON.stringify(schema);
    const canvas = Schema.toCanvas(schema, { models: ['GPT'] });
    expect(canvas.errors).toEqual([]);
    expect(canvas.controls).toEqual([
      { ref: 'owner:evidence', kind: 'owner', index: 0, afterRound: 0 },
      { ref: 'owner:ok', kind: 'owner', index: 2, afterRound: 1 }
    ]);
    expect(canvas.roundCounter).toBe(3);
    expect(JSON.stringify(schema)).toBe(before);
  });

  test('the rounds limit counts rounds only', () => {
    const many = Array.from({ length: 50 }, (_, index) => round(`r${index + 1}`, ['GPT']));
    expect(Schema.toCanvas(base([...many, owner('owner:a'), owner('owner:b')]), { models: ['GPT'] }).errors).toEqual([]);
    expect(Schema.toCanvas(base([...many, round('r51', ['GPT'])]), { models: ['GPT'] }).errors.map((error) => error.path)).toEqual(['steps']);
  });

  test('the settings keep every new field per kind and per participant, keyed by the participant id', () => {
    const schema = base([
      round('r1', [{ name: 'GPT', id: 'expert-1', input: 'none', task: 'T1' }, { name: 'GPT', id: 'expert-2', input: ['r0'] }], { owner: 'approve', chat: 'new', output: { name: 'Карта', sections: ['A'] } }),
      { ref: 'owner:x', kind: 'owner', input: [{ step: 'r1', participant: 'expert-1' }], task: 'Решите', models: [] },
      round('r2', [{ name: 'Claude', request: 'R' }], { task: 'S' })
    ]);
    const settings = Schema.toSettings(schema);
    expect(settings.customRoundSettings.r1).toEqual({ owner: 'approve', chat: 'new', output: { name: 'Карта', sections: ['A'] } });
    expect(settings.customModelSettings.r1['expert-1']).toEqual({ name: 'GPT', task: 'T1', input: 'none' });
    expect(settings.customModelSettings.r1['expert-2']).toEqual({ name: 'GPT', input: ['r0'] });
    expect(settings.customStepSettings['owner:x']).toEqual({ input: [{ step: 'r1', participant: 'expert-1' }], task: 'Решите' });
    expect(settings.customRoundSettings.r2).toEqual({ task: 'S' });
    expect(settings.customModelSettings.r2.Claude).toEqual({ name: 'Claude', promptTemplate: 'R' });
  });

  test('an ordinary input may name a switched-off step: it has no answers, the step is a valid reference', () => {
    const schema = base([round('r1', ['A']), round('r3', [{ name: 'B', enabled: false }]), round('r4', ['A'], { input: ['r3'] })]);
    expect(Schema.validate(schema)).toEqual([]);
  });
});

describe('Basic schema: a whole step as a required source (3.1, D3)', () => {
  // r1 has A and B; r2 is the step under test (index 1).
  const withInput = (input) => base([round('r1', ['A', 'B']), round('r2', ['A'], { input }), round('r3', ['C'])]);

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
    round('r3', ['claude'])
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
      round('r3', ['claude'])
    ]);
    expect(Schema.validate(schema)).toEqual([]);
    const sourceOf = (participant, id) => ({ artifact: { step: 'r1', participant, id }, version: 'latest' });
    // author-B no longer declares proposal: the shared one is not merged into its own output.
    const reader = (source) => base([round('r1', [{ name: 'claude', id: 'author-A' }, { name: 'gpt', id: 'author-B', output: { artifacts: [{ id: 'notes', name: 'Заметки', pointer: '' }] } }], { output: shared }), round('r2', [{ name: 'claude', id: 'reader', input: [source] }]), round('r3', ['claude'])]);
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

  test('a revision must be in the input of this author with the same address', () => {
    // author-A's input holds the line of author-B only: the revision of author-A is not in its own input.
    const otherLine = valid();
    otherLine.steps[1].models[0] = { ...otherLine.steps[1].models[0], input: [proposalRef('author-B')] };
    expect(pathsOf(otherLine)).toEqual(['steps[1].models[0].output.artifacts[0].revisionOf']);
    const otherAddress = valid();
    otherAddress.steps[1].models[0].output.artifacts[0].revisionOf = { ...proposalRef('author-A'), version: { step: 'r1', participant: 'author-A', visit: 1 } };
    expect(pathsOf(otherAddress)).toEqual(['steps[1].models[0].output.artifacts[0].revisionOf']);
  });

  test('a shared output of a step still checks its revisions against the authors that inherit it', () => {
    const schema = base([
      round('r1', [{ name: 'claude', id: 'author-A' }], { output: shared }),
      round('r2', [{ name: 'claude', id: 'author-A', input: [proposalRef('author-A')] }], { output: { artifacts: [{ id: 'proposal', name: 'Доработано', pointer: '', revisionOf: proposalRef('author-A') }] } }),
      round('r3', ['B'])
    ]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(pathsOf(base([round('r1', [{ name: 'claude', id: 'author-A' }], { output: shared }), round('r2', [{ name: 'claude', id: 'author-A' }], { output: { artifacts: [{ id: 'proposal', name: 'Доработано', pointer: '', revisionOf: proposalRef('author-A') }] } }), round('r3', ['B'])]))).toEqual(['steps[1].output.artifacts[0].revisionOf']);
  });
});

describe('Basic schema: the participant of an owner step is owner (3.3, R08)', () => {
  const ownerStep = (ref, extra = {}) => ({ ref, kind: 'owner', task: 'Ответьте на вопрос', models: [], ...extra });
  const mapRef = (participant = 'A', step = 'r1') => ({ artifact: { step, participant, id: 'map' }, version: 'latest' });
  const mapOutput = { artifacts: [{ id: 'map', name: 'Карта', pointer: '' }] };
  const ownerSource = { step: 'owner:o', participant: 'owner' };

  test('the owner step takes owner as its one participant: step, artifact and exact version are valid', () => {
    const schema = base([
      round('r1', ['A'], { output: mapOutput }),
      ownerStep('owner:o', { output: { artifacts: [{ id: 'approved', name: 'Утверждённая карта', pointer: '' }] } }),
      round('r2', [{ name: 'A', input: [ownerSource, { artifact: { step: 'owner:o', participant: 'owner', id: 'approved' }, version: { step: 'owner:o', participant: 'owner', visit: 1 } }] }]),
      round('r3', [{ name: 'B' }], { task: 'Проверь: есть ответ' }),
      round('r4', ['B'])
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
      round('r3', ['B'])
    ]);
    expect(Schema.validate(schema)).toEqual([]);
    const missing = base([ownerStep('owner:o', { output: mapOutput }), round('r2', [{ name: 'A', output: { artifacts: [{ id: 'map', name: 'Карта v2', pointer: '', revisionOf: revision }] } }]), round('r3', ['B'])]);
    expect(errorPaths(missing)).toEqual(['steps[1].models[0].output.artifacts[0].revisionOf']);
  });

  test('another participant of an owner step is named; the owner artifact of another participant is named too', () => {
    const cases = [
      [[{ step: 'owner:o', participant: 'A' }], ['steps[1].models[0].input[0].participant']],
      [[{ artifact: { step: 'owner:o', participant: 'A', id: 'map' }, version: 'latest' }], ['steps[1].models[0].input[0].artifact.participant']],
      [[{ artifact: { step: 'owner:o', participant: 'owner', id: 'nope' }, version: 'latest' }], ['steps[1].models[0].input[0].artifact.id']]
    ];
    cases.forEach(([input, paths]) => {
      const schema = base([ownerStep('owner:o', { output: mapOutput }), round('r2', [{ name: 'A', input }]), round('r3', ['B'])]);
      expect({ input, paths: errorPaths(schema) }).toEqual({ input, paths });
    });
  });

  test('a model with the id owner in an ordinary step is an ordinary participant', () => {
    const schema = base([round('r1', [{ name: 'Claude', id: 'owner' }], { output: mapOutput }), round('r2', [{ name: 'B', input: [{ step: 'r1', participant: 'owner' }, mapRef('owner')] }]), round('r3', ['B'])]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(Schema.assemble(schema)[0].models[0]).toMatchObject({ name: 'Claude', id: 'owner' });
  });

  test('the owner keeps no models; its own sources are checked like a model step (a self or a later step is named)', () => {
    const input = [mapRef('A'), 'r1', ownerSource, { step: 'r2', required: true }];
    const schema = base([round('r1', ['A'], { output: mapOutput }), ownerStep('owner:o', { input, output: mapOutput }), round('r2', ['A']), round('r3', ['B'])]);
    expect(errorPaths(schema)).toEqual(['steps[1].input[2].step', 'steps[1].input[3].step']);
    const valid = base([round('r1', ['A'], { output: mapOutput }), ownerStep('owner:o', { input: [mapRef('A'), 'r1'], output: mapOutput }), round('r2', ['B'])]);
    expect(Schema.validate(valid)).toEqual([]);
    expect(Schema.assemble(valid)[1]).toMatchObject({ kind: 'owner', input: [mapRef('A'), 'r1'], models: [] });
  });
});

describe('Basic schema: the input of an owner step (N07)', () => {
  const ownerStep = (ref, extra = {}) => ({ ref, kind: 'owner', task: 'Ответьте', models: [], ...extra });
  const source = { step: 'r1', participant: 'A', required: true };

  test('an owner step without input keeps the empty input of before: no input field is assembled', () => {
    const steps = Schema.assemble(base([round('r1', ['A']), ownerStep('owner:o'), round('r2', ['B'])]));
    expect(steps[1]).not.toHaveProperty('input');
  });

  test('the owner input is kept by assemble and by the settings; the same sources as a model step', () => {
    const schema = base([round('r1', ['A']), ownerStep('owner:o', { input: [source, 'r1'] }), round('r2', ['B'])]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(Schema.assemble(schema)[1].input).toEqual([source, 'r1']);
    expect(Schema.toSettings(schema).customStepSettings['owner:o']).toMatchObject({ input: [source, 'r1'] });
  });

  test('a wrong owner input is named with its exact path, as for a model step', () => {
    const schema = base([round('r1', ['A']), ownerStep('owner:o', { input: [{ step: 'r1', participant: 'Z' }, 'owner:o'] }), round('r2', ['B'])]);
    expect(errorPaths(schema)).toEqual(['steps[1].input[0].participant', 'steps[1].input[1]']);
  });
});

describe('Basic schema: a pipeline without a round is checked the same way everywhere (R09)', () => {
  const owner = (ref) => ({ ref, kind: 'owner', task: 'Предоставьте исследование', models: [] });

  test('an owner-only pipeline is valid: no round is added, the canvas shows the owner and no round', () => {
    const schema = base([owner('owner:o')]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(Schema.assemble(schema)).toEqual([expect.objectContaining({ kind: 'owner', ref: 'owner:o' })]);
    const canvas = Schema.toCanvas(schema, { models: [] });
    expect(canvas.errors).toEqual([]);
    expect(canvas.rounds).toEqual([]);
    expect(canvas.controls).toEqual([{ ref: 'owner:o', kind: 'owner', index: 0, afterRound: 0 }]);
  });

  test('an empty pipeline and a pipeline with no executable step are named at steps, validate and canvas alike', () => {
    expect(errorPaths(base([]))).toEqual(['steps']);
    expect(Schema.toCanvas(base([]), { models: [] }).errors.map((error) => error.path)).toEqual(['steps']);
    const allOff = base([round('r1', [{ name: 'A', enabled: false }]), round('r2', [{ name: 'B', enabled: false }])]);
    expect(errorPaths(allOff)).toEqual(['steps']);
    expect(Schema.toCanvas(allOff, { models: ['A', 'B'] }).errors.map((error) => error.path)).toEqual(['steps']);
  });

  test('the limit of 50 counts rounds only: an owner between rounds does not count', () => {
    const many = Array.from({ length: 50 }, (_, index) => round(`r${index + 1}`, ['A']));
    expect(Schema.toCanvas(base([...many, owner('owner:o')]), { models: ['A'] }).errors).toEqual([]);
    expect(Schema.toCanvas(base([...many, round('r51', ['A'])]), { models: ['A'] }).errors.map((error) => error.path)).toEqual(['steps']);
  });
});

describe('Basic schema: a switched-off declared participant keeps its declaration (R12)', () => {
  const schemaWith = (r2Input) => base([
    round('r1', ['A', { name: 'GPT', id: 'gpt-1' }, { name: 'C', id: 'c-1', enabled: false }]),
    round('r2', [{ name: 'A', input: r2Input }]),
    round('r3', ['B'])
  ]);

  test('the declaration of a switched-off participant reaches the settings even without other settings', () => {
    const settings = Schema.toSettings(schemaWith(['r1']));
    expect(settings.customModelSettings.r1['c-1']).toEqual({ name: 'C', enabled: false });
    expect(settings.customModelSettings.r1.A).toEqual({ name: 'A' });
    expect(settings.customModelSettings.r1['gpt-1']).toEqual({ name: 'GPT' });
  });

  test('an optional source to a switched-off participant is valid and keeps its id in the settings and assembly', () => {
    const schema = schemaWith(['r1', { step: 'r1', participant: 'c-1' }]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(Schema.toSettings(schema).customModelSettings.r2.A.input).toEqual(['r1', { step: 'r1', participant: 'c-1' }]);
    expect(Schema.assemble(schema)[1].models[0].input).toEqual(['r1', { step: 'r1', participant: 'c-1' }]);
  });

  test('a required source to a switched-off participant is a validator error (it would stop the run); without required the round leaves it out', () => {
    const required = schemaWith([{ step: 'r1', participant: 'c-1', required: true }]);
    expect(Schema.validate(required).map((error) => error.path)).toEqual(['steps[1].models[0].input[0].participant']);
    const optional = schemaWith([{ step: 'r1', participant: 'c-1' }]);
    expect(Schema.validate(optional)).toEqual([]);
    const first = Schema.assemble(optional)[0];
    expect(first.models.map((model) => model.id)).toEqual(['A', 'gpt-1']);
  });

  test('switching the participant on again keeps its id and its place in the step', () => {
    const on = base([round('r1', ['A', { name: 'GPT', id: 'gpt-1' }, { name: 'C', id: 'c-1' }]), round('r2', ['B'])]);
    expect(Schema.validate(on)).toEqual([]);
    expect(Schema.assemble(on)[0].models.map((model) => model.id)).toEqual(['A', 'gpt-1', 'c-1']);
  });
});

describe('Basic schema: the specification text (spec, a step\'s title, goal, rules, quality) is for the document only', () => {
  const spec = { purpose: 'Назначение', inputs: '', result: 'Итог', application: 'Применение', readiness: 'Готово', rules: 'Правила', boundaries: 'Границы', failure: 'Сбой' };
  const withText = (schema) => ({
    ...schema,
    spec,
    steps: schema.steps.map((step, at) => ({ ...step, title: `Этап ${at + 1}`, goal: 'Цель', rules: '', quality: 'Критерии' }))
  });
  const plain = base([round('r1', ['A', 'B']), round('r2', ['C'])]);

  test('a schema with the specification text is valid; an empty text is a value and stays', () => {
    const schema = withText(plain);
    expect(Schema.validate(schema)).toEqual([]);
    expect(schema.spec.inputs).toBe('');
    expect(schema.steps[0].rules).toBe('');
  });

  test('an unknown field of spec is an error with its path', () => {
    expect(Schema.validate({ ...plain, spec: { purpose: 'x', foo: 'y' } })).toEqual([{ path: 'spec.foo', message: 'неизвестное поле' }]);
  });

  test('spec must be an object and its values text', () => {
    expect(Schema.validate({ ...plain, spec: 'текст' })).toEqual([{ path: 'spec', message: 'ожидается объект' }]);
    expect(Schema.validate({ ...plain, spec: null })).toEqual([{ path: 'spec', message: 'ожидается объект' }]);
    expect(errorPaths({ ...plain, spec: { result: 3 } })).toEqual(['spec.result']);
  });

  test('title, goal, rules and quality of a step are text, on every kind of step', () => {
    expect(errorPaths({ ...plain, steps: [{ ...plain.steps[0], goal: 1 }, plain.steps[1]] })).toEqual(['steps[0].goal']);
    expect(errorPaths(base([round('r1', ['A']), round('r2', ['B'], { title: ['x'] })]))).toEqual(['steps[1].title']);
    const owner = base([round('r1', ['A']), { ref: 'owner:check', kind: 'owner', task: 'Проверьте источники', models: [], quality: 5 }, round('r2', ['B'])]);
    expect(errorPaths(owner)).toEqual(['steps[1].quality']);
    expect(errorPaths({ ...owner, steps: [owner.steps[0], { ...owner.steps[1], quality: 'Проверка источников' }, owner.steps[2]] })).toEqual([]);
  });

  test('the text fields are not checked as a field the step does not have', () => {
    expect(Schema.validate(withText(plain)).filter((error) => /title|goal|rules|quality|spec/.test(error.path))).toEqual([]);
  });

  test('the engine and the canvas do not read the text: the requests and the canvas are the same with and without it', () => {
    const schema = withText(plain);
    expect(Schema.assemble(schema, { roleText: () => 'ROLE' })).toEqual(Schema.assemble(plain, { roleText: () => 'ROLE' }));
    const models = ['A', 'B', 'C'];
    expect(Schema.toCanvas(schema, { models })).toEqual(Schema.toCanvas(plain, { models }));
    expect(Schema.toSettings(schema)).toEqual(Schema.toSettings(plain));
  });
});

describe('Basic schema: description is the presentation of the pipeline, for the person only', () => {
  const steps = [round('r1', ['Claude'])];
  test('a long text is valid and does not change the assembled steps', () => {
    const text = 'Презентация проекта.\n\n'.repeat(50);
    expect(Schema.validate(base(steps, { description: text }))).toEqual([]);
    expect(Schema.assemble(base(steps, { description: text }))).toEqual(Schema.assemble(base(steps)));
  });
  test('a description that is not a text is an error with its path', () => {
    expect(errorPaths(base(steps, { description: 5 }))).toEqual(['description']);
  });
  test('the model comment is a text for the person: valid, it does not change the steps; not a text is an error', () => {
    expect(Schema.validate(base(steps, { comment: '— ничего\n— не использовал файлы' }))).toEqual([]);
    expect(Schema.assemble(base(steps, { comment: 'К' }))).toEqual(Schema.assemble(base(steps)));
    expect(errorPaths(base(steps, { comment: ['x'] }))).toEqual(['comment']);
  });
});

describe('Basic schema: artifact description (output.artifacts[].description)', () => {
  test('a string description is valid and stays on the artifact as given', () => {
    const schema = base([round('r1', ['A'], { output: { artifacts: [{ id: 'map', name: 'Map', pointer: '', description: 'Карта после правок' }] } })]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(schema.steps[0].output.artifacts[0].description).toBe('Карта после правок');
  });

  test('the description survives assembly, the way the engine reads the output of a step', () => {
    const schema = base([round('r1', ['A'], { output: { artifacts: [{ id: 'map', name: 'Map', pointer: '', description: 'Карта' }] } })]);
    const steps = Schema.assemble(schema);
    expect(steps[0].output.artifacts[0].description).toBe('Карта');
  });

  test('a description that is not a string is an error with its path', () => {
    const schema = base([round('r1', ['A'], { output: { artifacts: [{ id: 'map', name: 'Map', pointer: '', description: 5 }] } })]);
    expect(errorPaths(schema)).toEqual(['steps[0].output.artifacts[0].description']);
    expect(Schema.describeErrors(Schema.validate(schema))).toBe('steps[0].output.artifacts[0].description: описание артефакта: строка');
  });
});

describe('Basic schema: the default input is the previous step (B-2)', () => {
  const owner = (extra = {}) => ({ ref: 'owner:u', kind: 'owner', task: 'Уточните', models: [], ...extra });
  const r1 = (extra = {}) => round('r1', [{ name: 'Claude' }], extra);

  test('B-2: a round after an owner step gets previous by default', () => {
    const steps = Schema.assemble(base([owner(), r1()]));
    expect(steps[1].input).toBe('previous');
  });

  test('B-2: a round after a round and an owner step gets previous by default', () => {
    const steps = Schema.assemble(base([r1(), owner(), round('r2', [{ name: 'Claude' }])]));
    expect(steps[2].input).toBe('previous');
  });

  test('B-2: only the very first step gets none; a second round gets previous', () => {
    const steps = Schema.assemble(base([round('r1', [{ name: 'Claude' }]), round('r2', [{ name: 'Claude' }])]));
    expect(steps[0].input).toBe('none');
    expect(steps[1].input).toBe('previous');
  });

  test('B-2: an explicit input is kept as given', () => {
    const none = Schema.assemble(base([owner(), r1({ input: 'none' })]));
    const all = Schema.assemble(base([owner(), r1({ input: 'all' })]));
    expect(none[1].input).toBe('none');
    expect(all[1].input).toBe('all');
  });

  test('B-2: a single round is the first step and gets none', () => {
    const steps = Schema.assemble(base([r1()]));
    expect(steps[0].input).toBe('none');
  });
});

describe('Basic schema: этап 1 — документ для User (document)', () => {
  const readArtifacts = [{ id: 'spec', name: 'ТЗ', pointer: '' }];
  const srcRound = (extra = {}) => ({ ref: 'r1', kind: 'round', models: [{ name: 'Claude' }], output: { document: 'read', artifacts: readArtifacts }, ...extra });
  const docOwner = (extra = {}) => ({ ref: 'owner:u', kind: 'owner', task: 'Проверьте', models: [], document: 'r1', ...extra });
  const errs = (schema) => Schema.validate(schema);

  test('этап 1: документ из раунда с одной моделью и output.document — ошибок нет; output у модели тоже годится', () => {
    expect(errs(base([srcRound(), docOwner()]))).toEqual([]);
    const modelOutput = { ref: 'r1', kind: 'round', models: [{ name: 'Claude', output: { document: 'read', artifacts: readArtifacts } }] };
    expect(errs(base([modelOutput, docOwner()]))).toEqual([]);
  });

  test('этап 1: документ — неизвестный ref или ref позже шага User — ошибка по пути документа', () => {
    const unknown = errs(base([srcRound(), docOwner({ document: 'r9' })])).find((e) => e.path === 'steps[1].document');
    expect(unknown && unknown.message).toContain('неизвестный шаг');
    const later = errs(base([docOwner({ document: 'r2' }), srcRound({ ref: 'r2' })])).find((e) => e.path === 'steps[0].document');
    expect(later && later.message).toContain('более ранний');
  });

  test('этап 1: источник с двумя включёнными моделями — ошибка; с одной выключенной — ошибок нет', () => {
    const two = srcRound({ models: [{ name: 'Claude' }, { name: 'GPT' }] });
    const twoErr = errs(base([two, docOwner()])).find((e) => e.path === 'steps[1].document');
    expect(twoErr).toBeDefined();
    expect(twoErr.message).toContain('документ для User даёт одна модель');
    const oneOff = srcRound({ models: [{ name: 'Claude' }, { name: 'GPT', enabled: false }] });
    expect(errs(base([oneOff, docOwner()]))).toEqual([]);
  });

  test('этап 1: у источника нет output.document — ошибка с упоминанием output.document', () => {
    const noDoc = { ref: 'r1', kind: 'round', models: [{ name: 'Claude' }] };
    const found = errs(base([noDoc, docOwner()])).find((e) => e.path === 'steps[1].document');
    expect(found).toBeDefined();
    expect(found.message).toContain('output.document');
  });

  test('этап 1: источник — шаг User или не строка — ошибка', () => {
    const ownerSrc = [{ ref: 'owner:a', kind: 'owner', task: 'Т', models: [] }, docOwner({ document: 'owner:a' })];
    const srcErr = errs(base(ownerSrc)).find((e) => e.path === 'steps[1].document');
    expect(srcErr).toBeDefined();
    expect(srcErr.message).toContain('раунд');
    expect(errorPaths(base([srcRound(), docOwner({ document: 5 })]))).toContain('steps[1].document');
  });

  test('этап 1: output документа — только read или form; form требует format json', () => {
    expect(errorPaths(base([srcRound({ output: { document: 'x' } })]))).toContain('steps[0].output.document');
    expect(errorPaths(base([srcRound({ output: { document: 'form' } })]))).toContain('steps[0].output.document');
    expect(errs(base([srcRound({ output: { format: 'json', document: 'form' } })]))).toEqual([]);
  });

  test('этап 1: поле document у шага round — неизвестное поле', () => {
    const found = errs(base([round('r1', ['Claude'], { document: 'r0' })])).find((e) => e.path === 'steps[0].document');
    expect(found).toBeDefined();
    expect(found.message).toBe('неизвестное поле');
  });

  test('этап 1: assemble переносит document в шаг User', () => {
    const steps = Schema.assemble(base([srcRound(), docOwner()]));
    expect(steps[1].document).toBe('r1');
  });

  test('этап 1: toCanvas принимает шаг User с документом', () => {
    const canvas = Schema.toCanvas(base([srcRound(), docOwner()]), { models: ['Claude'] });
    expect(canvas.errors).toEqual([]);
    expect(canvas.controls).toHaveLength(1);
  });
});

describe('Basic schema: этап 2 — документ для чтения в метках', () => {
  const spec = [{ id: 'spec', name: 'ТЗ', pointer: '' }];
  const at = (schema, path) => Schema.validate(schema).find((e) => e.path === path);

  test('этап 2: раунд с output.document read без artifacts — ошибка по output.document: ровно один артефакт', () => {
    const found = at(base([round('r1', ['A'], { output: { document: 'read' } })]), 'steps[0].output.document');
    expect(found).toBeDefined();
    expect(found.message).toContain('ровно один артефакт');
  });

  test('этап 2: раунд с output.document read и двумя артефактами — та же ошибка', () => {
    const two = [{ id: 'spec', name: 'ТЗ', pointer: '' }, { id: 'plan', name: 'План', pointer: '' }];
    const found = at(base([round('r1', ['A'], { output: { document: 'read', artifacts: two } })]), 'steps[0].output.document');
    expect(found).toBeDefined();
    expect(found.message).toContain('ровно один артефакт');
  });

  test('этап 2: раунд с output.document read и одним артефактом с пустым указателем — ошибок нет', () => {
    expect(Schema.validate(base([round('r1', ['A'], { output: { document: 'read', artifacts: spec } }), round('r2', ['B'])]))).toEqual([]);
  });

  test('этап 2: формат json с документом read и одним артефактом с указателем — ошибок нет', () => {
    const output = { format: 'json', document: 'read', artifacts: [{ id: 'doc', name: 'Д', pointer: '/body' }] };
    expect(Schema.validate(base([round('r1', ['A'], { output })]))).toEqual([]);
  });

  test('этап 2: document form без artifacts — ошибок по artifacts нет, как в этапе 1', () => {
    const errors = Schema.validate(base([round('r1', ['A'], { output: { format: 'json', document: 'form' } })]));
    expect(errors.filter((e) => e.path.includes('artifacts'))).toEqual([]);
  });
});

describe('Basic schema: remarks that do not block a valid schema (warnings)', () => {
  const owner = (ref, extra = {}) => ({ ref, kind: 'owner', task: 'Ответьте', models: [], ...extra });
  const withTask = (ref, models, extra = {}) => round(ref, models, { task: 'Задача', ...extra });
  const full = (steps, extra = {}) => base(steps, { description: 'Описание схемы', ...extra });
  const paths = (schema) => Schema.warnings(schema).map((item) => item.path);

  test('a participant task next to the step task is a remark at the participant; either one alone is none', () => {
    expect(paths(full([withTask('r1', ['A'], { task: 'общее' })]))).toEqual([]);
    const both = full([{ ref: 'r1', kind: 'round', task: 'общее', models: [{ name: 'A', task: 'своё' }, { name: 'B' }] }]);
    expect(Schema.validate(both)).toEqual([]);
    expect(paths(both)).toEqual(['steps[0].models[0].task']);
  });

  test('an owner answer that no later step reads is a remark; previous, all, a reference and the document line read it', () => {
    expect(paths(full([withTask('r1', ['A']), owner('owner:a'), withTask('r2', ['A'], { input: 'none' })]))).toEqual(['steps[1]']);
    expect(paths(full([withTask('r1', ['A']), owner('owner:a'), withTask('r2', ['A'])]))).toEqual([]);
    expect(paths(full([withTask('r1', ['A']), owner('owner:a'), withTask('r2', ['A'], { input: 'none' }), withTask('r3', ['A'], { input: 'all' })]))).toEqual([]);
    expect(paths(full([withTask('r1', ['A']), owner('owner:a'), withTask('r2', ['A'], { input: 'none' }), withTask('r3', ['A'], { input: ['owner:a'] })]))).toEqual([]);
    const doc = { document: 'read', artifacts: [{ id: 'map', name: 'Карта', pointer: '' }] };
    expect(paths(full([withTask('r1', ['A'], { output: doc }), owner('owner:a', { document: 'r1' }), withTask('r2', ['A'], { input: 'none' }),
      withTask('r3', ['A'], { input: [{ artifact: { step: 'r1', participant: 'A', id: 'map' }, version: 'latest' }] })]))).toEqual([]);
  });

  test('an owner step at the end closes the schema: no remark', () => {
    expect(paths(full([withTask('r1', ['A']), owner('owner:end')]))).toEqual([]);
  });

  test('a placeholder text is a remark; an ellipsis inside a text is not', () => {
    expect(paths(full([withTask('r1', ['A'], { task: 'TODO' })], { description: '…' }))).toEqual(['description', 'steps[0].task']);
    expect(paths(full([withTask('r1', ['A'], { task: 'Сравни варианты… и выбери лучший.' })]))).toEqual([]);
  });
});

describe('Basic schema: the canvas shows only the participants of each round', () => {
  const canvasModels = ['Claude', 'GPT', 'DeepSeek', 'Perplexity'];
  const toCanvas = (schema) => Schema.toCanvas(schema, { models: canvasModels });
  const names = (canvas, ref) => canvas.stacks[`${ref}-models`].items.map((item) => item.name);

  test('two rounds with other participants: the stack of each round holds its own participants only', () => {
    const schema = base([
      round('r1', ['Claude', 'GPT', 'DeepSeek', { name: 'Perplexity', enabled: false }]),
      round('r2', ['Claude', { name: 'GPT', enabled: false }, { name: 'DeepSeek', enabled: false }])
    ]);
    const canvas = toCanvas(schema);
    expect(canvas.errors).toEqual([]);
    expect(names(canvas, 'r1')).toEqual(['Claude', 'GPT', 'DeepSeek']);
    expect(names(canvas, 'r2')).toEqual(['Claude']);
    expect(canvas.selectedModels).toEqual(['Claude', 'GPT', 'DeepSeek']);
  });

  test('a switched-off participant with onCanvas stays in its own round only; a switched-off one of another round does not show', () => {
    const schema = base([
      round('r1', ['Claude', { name: 'Perplexity', enabled: false, onCanvas: true }]),
      round('r2', ['GPT', { id: 'pplx-2', name: 'Perplexity', enabled: false }])
    ]);
    const canvas = toCanvas(schema);
    expect(canvas.errors).toEqual([]);
    expect(names(canvas, 'r1')).toEqual(['Claude', 'Perplexity']);
    expect(canvas.stacks['r1-models'].items[1]).toEqual({ name: 'Perplexity', id: 'Perplexity', input: false, send: false, role: null });
    expect(names(canvas, 'r2')).toEqual(['GPT']);
    expect(canvas.rounds.map((item) => item.participantIds)).toEqual([['Claude'], ['GPT']]);
    // A participant with an id in another round is not shown there either, and does not select its model.
    expect(canvas.selectedModels).toEqual(['Claude', 'GPT', 'Perplexity']);
    expect(toCanvas(base([round('r1', ['Claude']), round('r2', [{ id: 'pplx-2', name: 'Perplexity', enabled: false }])])).selectedModels).toEqual(['Claude']);
  });

  test('round trip: the schema keeps every participant with its id, label, role, task and enabled state after the canvas', () => {
    const schema = base([
      round('r1', [{ name: 'Claude', role: 'critic', task: 'T1' }, { name: 'GPT', id: 'gpt-1', label: 'GPT 1', enabled: false, onCanvas: true, request: 'KEPT' }, 'DeepSeek']),
      round('r2', [{ name: 'Claude', id: 'claude-2', label: 'Claude 2' }, { name: 'GPT', id: 'gpt-1', label: 'GPT 1', enabled: false, request: 'LATER' }])
    ]);
    const before = JSON.stringify(schema);
    const canvas = toCanvas(schema);
    expect(canvas.errors).toEqual([]);
    expect(canvas.stacks['r1-models'].items).toEqual([
      { name: 'Claude', id: 'Claude', input: true, send: true, role: 'critic' },
      { name: 'DeepSeek', id: 'DeepSeek', input: true, send: true, role: null },
      { name: 'GPT', id: 'gpt-1', label: 'GPT 1', input: false, send: false, role: null }
    ]);
    expect(names(canvas, 'r2')).toEqual(['Claude']);
    const settings = Schema.toSettings(schema);
    expect(Object.keys(settings.customModelSettings.r1).sort()).toEqual(['Claude', 'DeepSeek', 'gpt-1']);
    expect(settings.customModelSettings.r1['gpt-1']).toEqual({ promptTemplate: 'KEPT', name: 'GPT', label: 'GPT 1', enabled: false, onCanvas: true });
    expect(settings.customModelSettings.r2['claude-2']).toEqual({ name: 'Claude', label: 'Claude 2' });
    expect(settings.customModelSettings.r2['gpt-1']).toEqual({ promptTemplate: 'LATER', name: 'GPT', label: 'GPT 1', enabled: false });
    expect(JSON.stringify(schema)).toBe(before);
  });
});
