// Regression tests of the review of user schemas (docs/Pipeline scenarios/basic-user-schemas-fix-plan.md): the numbers
// in the test names are the items of that plan.
const fs = require('fs');
const path = require('path');
const { delay, renderDebateDom, loadResultsScript } = require('./helpers/results-page-harness');
const Engine = require('../disput/custom-engine');
const Schema = require('../disput/basic-schema');
const Record = require('../disput/custom-run-record');
const Reader = require('../disput/schema-text-reader');

const settle = () => delay(0);
const schemaOf = (steps, extra = {}) => ({ schemaVersion: 1, origin: 'user', steps, ...extra });
const round = (ref, models, extra = {}) => ({ ref, kind: 'round', models: models.map((model) => (typeof model === 'string' ? { name: model } : model)), ...extra });

describe('Basic: user schemas keep working and keep their data', () => {
  let debug;
  const planOf = () => window.__pipelineDraftPlanForCanvas(window.__getActivePipelineDraftPlan());
  const select = async (name) => { document.querySelector(`.pipeline-item[data-name="${name}"]`).click(); await settle(); };
  const note = () => document.getElementById('notification-message').textContent;
  const stored = async () => (await chrome.storage.local.get('llmComparatorPipelines')).llmComparatorPipelines;
  // A Basic pipeline open on the canvas, the base the schemas of a test are installed next to.
  const host = (name = 'Host') => {
    const config = { version: 3, roundCounter: 2, protocol: { type: 'universal', presetId: 'CUSTOM', selectedModels: ['GPT', 'Claude'], length: '300', roundLimit: '2', runPolicy: 'auto' }, modelStacks: {} };
    debug.setPipelineStoreForTest({ active: name, pipelines: { [name]: config }, order: [name] });
    debug.applyPipelineConfig(config);
  };
  const install = async (name, schema) => {
    const result = await debug.installBasicSchema(name, JSON.parse(JSON.stringify(schema)));
    expect(result).toEqual({ ok: true, errors: [] });
    await select(name);
  };

  beforeAll(async () => {
    renderDebateDom();
    document.body.classList.add('pipeline-page');
    await loadResultsScript();
    // The acceptance of answers is checked before a run (pipeline_panel.html loads these modules).
    ['debate-response-acceptance', 'stage-markers'].forEach((mod) => window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', `${mod}.js`), 'utf8')));
    debug = window.__pipelineLifecycleDebug;
  });

  beforeEach(() => {
    chrome.runtime.sendMessage.mockImplementation((message, callback) => { if (typeof callback === 'function') callback({ status: 'ok', active: false }); });
    document.getElementById('notification-message').textContent = '';
    debug.clearCustomSessionForTest();
    host();
  });

  test('1.1 a renamed pipeline keeps its owner steps on the run and in the record', async () => {
    await install('Own', schemaOf([
      round('r1', ['GPT']),
      { ref: 'owner:u1', kind: 'owner', task: 'Approve it', models: [] },
      round('r2', ['Claude'])
    ]));
    expect(await debug.renamePipelineForTest('Own', 'Own renamed')).toBe(true);
    expect(debug.buildBasicRun(planOf()).schema.steps.map((step) => step.ref)).toEqual(['r1', 'owner:u1', 'r2']);
    expect(debug.basicSchemaFromPage(planOf(), null, { forSave: true }).steps.map((step) => step.ref)).toEqual(['r1', 'owner:u1', 'r2']);
  });

  test('1.5 Save of a model card keeps the participant\'s own output', async () => {
    const output = { name: 'own out' };
    await install('Card output', schemaOf([round('r1', [{ name: 'GPT', output }])]));
    document.querySelector('#r1-models .model-block').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle();
    const modal = document.getElementById('pipeline-block-info-modal');
    const length = modal.querySelector('#custom-card-length');
    length.value = '250';
    length.dispatchEvent(new Event('input'));
    modal.querySelector('#custom-card-save').click();
    await settle(); await settle();
    const model = (await stored()).pipelines['Card output'].schema.steps[0].models[0];
    expect(model).toEqual(expect.objectContaining({ name: 'GPT', maxWords: 250, output }));
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });

  test('1.6 Export of a saved schema the page cannot read gives that schema as it is stored', async () => {
    const schema = schemaOf([round('r1', ['GPT'], { task: 'KEEP ME', extraField: 1 })], { description: 'KEEP DESCRIPTION' });
    const record = { version: 3, roundCounter: 1, protocol: { type: 'universal', presetId: 'CUSTOM', selectedModels: ['GPT'] }, modelStacks: {}, schema };
    debug.setPipelineStoreForTest({ active: 'Broken', pipelines: { Broken: record }, order: ['Broken'] });
    debug.applyPipelineConfig(record);
    const built = debug.buildBasicExport();
    expect(built.ok).toBe(true);
    expect(built.schema).toEqual(schema);
    expect(built.unreadable).toContain('steps[0].extraField');
  });

  test('1.3 pipelines another page wrote are taken over before this page writes', async () => {
    const listeners = chrome.storage.onChanged.addListener.mock.calls.map(([listener]) => listener);
    const current = await stored();
    const other = { version: 3, roundCounter: 1, protocol: { type: 'universal', presetId: 'CUSTOM', selectedModels: ['GPT'] }, modelStacks: {} };
    const newValue = { ...current, writer: 'another-page', pipelines: { ...current.pipelines, 'Other tab': other }, order: [...current.order, 'Other tab'] };
    listeners.forEach((listener) => listener({ llmComparatorPipelines: { newValue } }, 'local'));
    await debug.installBasicSchema('This tab', schemaOf([round('r1', ['GPT'])]));
    const after = await stored();
    expect(after.order).toEqual(expect.arrayContaining(['Other tab', 'This tab']));
    expect(after.pipelines['Other tab']).toEqual(other);
  });

  test('1.4 a refused write is named and the schema is not installed', async () => {
    chrome.storage.local.set.mockImplementationOnce(() => Promise.reject(new Error('QUOTA_BYTES quota exceeded')));
    const result = await debug.installBasicSchema('Quota', schemaOf([round('r1', ['GPT'])]));
    expect(result.ok).toBe(false);
    expect(result.errors[0].path).toBe('хранилище');
    expect(debug.getPipelineStoreSnapshot().pipelines.Quota).toBeUndefined();
    expect(note()).toContain('Pipelines не сохранены в хранилище: QUOTA_BYTES quota exceeded');
  });

  test('2.1 a schema that names a switched-off round or participant installs and runs', async () => {
    await install('Off refs', schemaOf([
      round('r1', ['Claude', { name: 'GPT', enabled: false }]),
      round('r2', []),
      round('r3', ['Gemini'], { input: [{ step: 'r1', participant: 'GPT' }, 'r2', 'r1'] })
    ]));
    const built = debug.buildBasicRun(planOf());
    expect(built.errors).toEqual([]);
    expect(built.steps.map((step) => [step.ref, step.round])).toEqual([['r1', 1], ['r3', 3]]);
    expect(built.steps[0].off).toEqual([{ id: 'GPT', name: 'GPT' }]);
  });

  test('2.3 Save keeps a switched-off participant the schema declares, without other fields', async () => {
    await install('Off kept', schemaOf([
      round('r1', ['Claude', { name: 'GPT', enabled: false }]),
      round('r2', ['Gemini'], { input: [{ step: 'r1', participant: 'GPT' }] })
    ]));
    const saved = debug.basicSchemaFromPage(planOf(), null, { forSave: true });
    expect(saved.steps[0].models).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'GPT', enabled: false })]));
    expect(Schema.validate(saved)).toEqual([]);
  });

  test('2.4 a change of the canvas of a saved pipeline is in its record at once', async () => {
    await install('Canvas edit', schemaOf([round('r1', ['GPT', 'Claude'])]));
    const claude = [...document.querySelectorAll('#r1-models .model-block')].find((block) => block.querySelector('.model-name')?.textContent === 'Claude');
    const send = claude.querySelector('.model-input-checkbox');
    send.checked = false;
    send.dispatchEvent(new Event('change', { bubbles: true }));
    await delay(300);
    const models = (await stored()).pipelines['Canvas edit'].schema.steps[0].models;
    expect(models.filter((model) => model.enabled !== false).map((model) => model.name)).toEqual(['GPT']);
  });

  test('2.6 the first round that runs has no input and no inherited task, whatever is switched off before it', () => {
    const steps = Schema.assemble(schemaOf([round('r1', []), round('r2', ['A']), round('r3', ['B'])]));
    expect(steps.map((step) => [step.ref, step.round, step.input, step.task === ''])).toEqual([['r2', 2, 'none', true], ['r3', 3, 'previous', false]]);
    expect(Schema.defaultInputOf([{ ref: 'owner:a', kind: 'owner', task: 't', models: [] }, round('r1', ['A'])], 1)).toBe('previous');
  });

  test('2.2 the engine takes a switched-off participant as a source that gives nothing', async () => {
    const steps = (input) => Schema.assemble(schemaOf([
      round('r1', ['A', { name: 'B', enabled: false }]),
      round('r2', ['C'], { input: [input] })
    ]));
    const calls = [];
    const send = async (models) => {
      calls.push(models.slice());
      return { byModel: Object.fromEntries(models.map((model) => [model, { text: `ответ ${model}.`, status: 'SUCCESS' }])), closedByOwner: false };
    };
    const optional = await Engine.run({ task: 'T', steps: steps({ step: 'r1', participant: 'B' }), send, maxAttempts: 1 });
    expect(optional.stopReason).toBe('steps_done');
    const required = await Engine.run({ task: 'T', steps: steps({ step: 'r1', participant: 'B', required: true }), send, maxAttempts: 1 });
    expect(required.stopReason).toBe('missing_input');
  });

  test('2.7 a schema of owner steps only runs from the page', async () => {
    await install('Owner only', schemaOf([{ ref: 'owner:o', kind: 'owner', task: 'Give it', models: [] }]));
    const built = debug.buildBasicRun(planOf());
    expect(built.errors).toEqual([]);
    expect(built.steps.map((step) => step.ref)).toEqual(['owner:o']);
    expect(debug.basicSchemaFromPage(planOf(), null, { forSave: true }).steps.map((step) => step.ref)).toEqual(['owner:o']);
  });

  test('3.1 the owner window gets the purpose (goal) of its step', async () => {
    const asked = [];
    const steps = Schema.assemble(schemaOf([round('r1', ['A']), { ref: 'owner:o', kind: 'owner', task: 'Ответьте', goal: 'Выбрать вариант', models: [] }]));
    const send = async (models) => ({ byModel: Object.fromEntries(models.map((model) => [model, { text: 'ответ.', status: 'SUCCESS' }])), closedByOwner: false });
    const result = await Engine.run({ task: 'T', steps, send, maxAttempts: 1, provideOwnerResult: async (request) => { asked.push(request); return 'да'; } });
    expect(result.stopReason).toBe('steps_done');
    expect(asked[0].goal).toBe('Выбрать вариант');
  });

  test('3.2 a document revised by a later round is the one the owner reads, edits and passes on', async () => {
    const draft = { step: 'r1', participant: 'A', id: 'draft' };
    const schema = schemaOf([
      round('r1', ['A'], { output: { document: 'read', artifacts: [{ id: 'draft', name: 'Черновик', pointer: '' }] } }),
      round('r2', ['B'], { input: [{ artifact: draft, version: 'latest' }],
        output: { document: 'read', artifacts: [{ id: 'final', name: 'Доработка', pointer: '', revisionOf: { artifact: draft, version: 'latest' } }] } }),
      { ref: 'owner:o', kind: 'owner', task: 'Утвердите', document: 'r2', models: [] },
      round('r3', ['C'])
    ]);
    expect(Schema.validate(schema)).toEqual([]);
    const steps = Schema.assemble(schema);
    const prompts = {};
    const replies = { A: '[[DOC: draft]]\nЧЕРНОВИК\n[[/DOC]]', B: '[[DOC: final]]\nДОРАБОТКА\n[[/DOC]]', C: 'итог.' };
    const send = async (models, byModel) => { Object.assign(prompts, byModel); return { byModel: Object.fromEntries(models.map((model) => [model, { text: replies[model], status: 'SUCCESS' }])), closedByOwner: false }; };
    const asked = [];
    const result = await Engine.run({ task: 'T', steps, send, maxAttempts: 1, provideOwnerResult: async (request) => { asked.push(request); return 'ДОРАБОТКА С ПРАВКОЙ USER'; } });
    expect(result.stopReason).toBe('steps_done');
    expect(asked[0].document).toEqual(expect.objectContaining({ kind: 'read', text: 'ДОРАБОТКА' }));
    expect(prompts.C).toContain('ДОРАБОТКА С ПРАВКОЙ USER');
    const line = result.artifacts.filter((entry) => entry.lineage.id === 'draft');
    expect(line.map((entry) => entry.source.participant)).toEqual(['A', 'B', 'owner']);
  });

  test('4.1 the snapshot takes the requests in flight from the state: an empty list stays empty', () => {
    const record = Record.createRun({ runId: 'p', pipelineName: 'P', task: 'T', steps: [{ ref: 'r1', kind: 'round', models: ['A'] }] });
    Record.setSnapshot(record, { schema: {}, state: { pc: 'r1', current: { stepRef: 'r1', pending: [{ participantId: 'A', attempt: 1 }] } } });
    Record.setSnapshot(record, { schema: {}, state: { pc: 'r1', current: { stepRef: 'r1', pending: [] } } });
    expect(record.snapshot.current.pending).toEqual([]);
  });

  test('4.3 an attempt that was not sent becomes the sent attempt on a continuation', () => {
    const record = Record.createRun({ runId: 'n', pipelineName: 'P', task: 'T', steps: [{ ref: 'r1', kind: 'round', models: ['A'] }] });
    const key = { step: 0, ref: 'r1', participant: 'A', model: 'A', visit: 1, attempt: 1 };
    Record.recordAttempt(record, { ...key, prompt: 'P', parts: {}, state: 'not_sent', reason: 'cancelled_before_dispatch' });
    Record.recordAttempt(record, { ...key, prompt: 'P', parts: {} });
    Record.recordAttempt(record, { ...key, state: 'done', sentPrompt: 'P', answer: 'ответ', accepted: true });
    expect(record.attempts).toHaveLength(1);
    expect(Record.exportRun(record).attempts[0]).toMatchObject({ state: 'done', prompt: 'P', answer: 'ответ', accepted: true });
  });

  test('4.4 a request over the budget names its size and the budget', async () => {
    const send = jest.fn();
    const result = await Engine.run({ task: 'x'.repeat(200), steps: Schema.assemble(schemaOf([round('r1', ['A'])])), send, maxPromptChars: 100 });
    expect(result.stopReason).toBe('context_full');
    expect(result.stopDetail).toMatch(/шаг «r1» · модель «A»: запрос \d+ символов, бюджет 100/);
    expect(send).not.toHaveBeenCalled();
  });

  test('4.5 the text sent to a model is kept without a second copy of its request', () => {
    const record = Record.createRun({ runId: 's', pipelineName: 'P', task: 'T', steps: [{ ref: 'r1', kind: 'round', models: ['A'] }] });
    const prompt = 'вход '.repeat(4000);
    const key = { step: 0, ref: 'r1', participant: 'A', model: 'A', visit: 1, attempt: 1 };
    Record.recordAttempt(record, { ...key, prompt, parts: {} });
    Record.recordAttempt(record, { ...key, state: 'done', sentPrompt: `${prompt}\n\nПоследней строкой ответа напиши только метку [[AO-x]]`, answer: 'ответ', accepted: true });
    const stored = Record.serialize(record);
    expect(Object.values(stored.texts).filter((text) => text.includes('вход вход')).length).toBe(1);
    expect(Record.exportRun(Record.revive(JSON.parse(JSON.stringify(stored)))).attempts[0].sentPrompt).toBe(`${prompt}\n\nПоследней строкой ответа напиши только метку [[AO-x]]`);
  });

  test('4.6 a continuation runs the steps the run started with', () => {
    const record = Record.createRun({ runId: 'c', pipelineName: 'P', task: 'T', steps: [{ ref: 'r1', kind: 'round', models: ['A'] }] });
    const steps = [{ ref: 'r1', kind: 'round', models: [{ name: 'A', id: 'A', task: 'OLD BASIC TASK' }] }];
    Record.setSnapshot(record, { schema: { schemaVersion: 1 }, steps, state: { pc: 'r1' } });
    Record.setSnapshot(record, { schema: { schemaVersion: 1 }, state: { pc: 'r1' } });
    expect(record.snapshot.steps).toEqual(steps);
  });

  test('5.3 an own request without {вход}: format 1 reads and runs as before, format 2 is refused', async () => {
    const steps = [round('r1', ['A']), round('r2', [{ name: 'B', request: 'Своя задача: {задача}' }])];
    expect(Schema.validate(schemaOf(steps))).toEqual([]);
    const v2 = { ...schemaOf(steps.map((step) => ({ ...step, models: step.models.map((model) => ({ id: model.name, ...model })) }))), schemaVersion: 2 };
    expect(Schema.validate(v2).map((error) => error.path)).toEqual(['steps[1].models[0].request']);
    const send = async (models) => ({ byModel: Object.fromEntries(models.map((model) => [model, { text: `ответ ${model}.`, status: 'SUCCESS' }])), closedByOwner: false });
    const result = await Engine.run({ task: 'T', steps: Schema.assemble(schemaOf(steps)), send, maxAttempts: 1 });
    expect(result.stopReason).toBe('steps_done');
  });

  test('5.2 the notice of an unreadable saved schema says what to do for its reason', async () => {
    const open = (schema) => {
      const record = { version: 3, roundCounter: 1, protocol: { type: 'universal', presetId: 'CUSTOM', selectedModels: ['GPT'] }, modelStacks: {}, schema };
      debug.setPipelineStoreForTest({ active: 'Old', pipelines: { Old: record }, order: ['Old'] });
      debug.applyPipelineConfig(record);
      return note();
    };
    expect(open(schemaOf([round('r1', ['GPT'])], { schemaVersion: 9 }))).toContain('обновите расширение');
    expect(open(schemaOf([round('r1', ['GPT']), { ref: 'g', kind: 'gate', models: [] }]))).toContain('перепишите эти места');
    expect(open(schemaOf([round('r1', ['GPT'], { extraField: 1 })]))).toContain('Исправьте схему по ошибкам');
  });

  test('6.3 the reader skips braces before the schema, names a second schema and reads odd spaces', () => {
    const schema = '{"schemaVersion":1,"origin":"user","steps":[{"ref":"r1","kind":"round","models":[{"name":"GPT"}]}]}';
    const preamble = Reader.read(`Вот схема {v2}, пример шага {"ref":"r1"}:\n${schema}`);
    expect(preamble.ok).toBe(true);
    expect(preamble.value.schemaVersion).toBe(1);
    expect(preamble.notes.join(' ')).toContain('Текст со скобками перед схемой пропущен');
    const two = Reader.read(`${schema}\n\nИли так:\n${schema.replace('GPT', 'Claude')}`);
    expect(two.value.steps[0].models[0].name).toBe('GPT');
    expect(two.notes.join(' ')).toContain('больше одной схемы');
    const spaces = Reader.read(schema.replace('{"schemaVersion"', '{\u00A0"schemaVersion"').replace(',"origin"', ',\u200B"origin"'));
    expect(spaces.ok).toBe(true);
    expect(spaces.notes.join(' ')).toContain('Неразрывные и невидимые пробелы');
  });

  test('6.2 a schema file is read like a pasted reply and checked before its name is asked', async () => {
    const importFile = async (text, answer) => {
      const oldPrompt = window.prompt;
      const prompts = [];
      window.prompt = jest.fn((message, proposed) => { prompts.push(proposed); return answer; });
      try {
        document.getElementById('pipeline-import-btn').click();
        const input = [...document.querySelectorAll('input[type="file"]')].filter((node) => node.accept === 'application/json').pop();
        Object.defineProperty(input, 'files', { value: [new File([text], 'fenced.json', { type: 'application/json' })], configurable: true });
        input.dispatchEvent(new Event('change'));
        await delay(150);
      } finally { window.prompt = oldPrompt; }
      return prompts;
    };
    const fenced = 'Схема:\n```json\n{ "schemaVersion": 1, "origin": "user", "steps": [{ "ref": "r1", "kind": "round", "models": [{ "name": "GPT" }], }] }\n```';
    await importFile(fenced, 'From fence');
    expect(debug.getPipelineStoreSnapshot().pipelines['From fence'].schema.steps[0].models[0].name).toBe('GPT');
    const prompts = await importFile(JSON.stringify({ name: 'not a schema' }), 'Nope');
    expect(prompts).toEqual([]);
    expect(note()).toContain('schemaVersion: версия формата не указана');
  });

  test('1.7 another pipeline cannot be opened while a run goes on', async () => {
    const twoRounds = (model) => schemaOf([round('r1', [model]), round('r2', [model])], { run: { policy: 'auto' } });
    await install('RunA', twoRounds('GPT'));
    await debug.installBasicSchema('RunB', twoRounds('Claude'));
    await select('RunA');
    // The transport never answers: the run stays in its first round.
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (message.type !== 'START_FULLPAGE_PROCESS') { callback?.({ status: 'ok', active: false }); return; }
      callback?.({ status: 'process_started' });
    });
    document.getElementById('modTa').value = 'RACE TASK';
    const run = window.runPipeline();
    await delay(300);
    await select('RunB');
    expect(debug.getPipelineStoreSnapshot().active).toBe('RunA');
    expect(note()).toContain('Идёт прогон');
    window.cancelPipelineRun();
    await Promise.race([run, delay(500)]);
  }, 30000);
});
