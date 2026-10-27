// Regression tests of the review of user schemas (docs/Pipeline scenarios/basic-user-schemas-fix-plan.md): the numbers
// in the test names are the items of that plan.
const fs = require('fs');
const path = require('path');
const { delay, renderDebateDom, loadResultsScript } = require('./helpers/results-page-harness');

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
