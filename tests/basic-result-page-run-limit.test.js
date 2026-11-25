/** @jest-environment jsdom */
// result_new.html has no length control (#debate-length-select): a Basic schema keeps its own run.maxWords there.
const fs = require('fs');
const path = require('path');
const { delay, renderDebateDom, loadResultsScript } = require('./helpers/results-page-harness');

const schemaOf = (steps, extra = {}) => ({ schemaVersion: 1, origin: 'user', steps, ...extra });
const round = (ref, models) => ({ ref, kind: 'round', models: models.map((name) => ({ name })) });
const limited = (maxWords) => schemaOf([round('r1', ['GPT']), round('r2', ['Claude'])], { run: { maxWords } });

describe('Basic on a page without the length control', () => {
  let debug;
  const planOf = () => window.__pipelineDraftPlanForCanvas(window.__getActivePipelineDraftPlan());
  const select = async (name) => { document.querySelector(`.pipeline-item[data-name="${name}"]`).click(); await delay(0); };
  const note = () => document.getElementById('notification-message').textContent;
  const stored = async (name) => (await chrome.storage.local.get('llmComparatorPipelines')).llmComparatorPipelines.pipelines[name].schema;
  const install = async (name, schema) => {
    expect(await debug.installBasicSchema(name, JSON.parse(JSON.stringify(schema)))).toEqual({ ok: true, errors: [] });
    await select(name);
  };
  const openCard = async () => {
    document.querySelector('#r1-models .model-block').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await delay(0);
    return document.getElementById('pipeline-block-info-modal');
  };

  beforeAll(async () => {
    const page = fs.readFileSync(path.join(__dirname, '..', 'result_new.html'), 'utf8');
    renderDebateDom();
    // The run controls of the harness that result_new.html does not have.
    ['debate-length-select', 'debate-run-policy-select', 'debate-auto-toggle-btn', 'debate-max-turns-input', 'auto-checkbox'].forEach((id) => {
      expect(page).not.toContain(`id="${id}"`);
      document.getElementById(id).remove();
    });
    await loadResultsScript();
    debug = window.__pipelineLifecycleDebug;
  });

  beforeEach(() => {
    debug.setPipelineStoreForTest({ pipelines: {}, order: [], active: '', lastSaved: '' });
    debug.clearCustomSessionForTest();
    document.getElementById('notification-message').textContent = '';
  });

  test('a schema with run.maxWords is installed, shown on the canvas and taken by the run', async () => {
    await install('Long', limited(700));

    expect(note()).not.toContain('run.maxWords');
    expect(note()).not.toContain('Схема не отображена на холсте');
    expect(document.querySelector('#r2-models .model-block .model-name').textContent).toBe('Claude');
    const built = debug.buildBasicRun(planOf());
    expect(built.errors).toEqual([]);
    expect(built.run.maxWords).toBe(700);
    expect(built.schema.run.maxWords).toBe(700);
  });

  test('a model card without its own limit shows the limit of the schema, and its Save keeps it', async () => {
    await install('Card', limited(1000));
    const modal = await openCard();
    const length = modal.querySelector('#custom-card-length');
    expect(length.value).toBe('1000');

    length.value = '250';
    length.dispatchEvent(new Event('input'));
    modal.querySelector('#custom-card-save').click();
    await delay(0); await delay(0);

    const saved = await stored('Card');
    expect(saved.run.maxWords).toBe(1000);
    expect(saved.steps[0].models[0].maxWords).toBe(250);
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });

  test('every pipeline keeps its own limit through a switch and Save; without one Basic gives 300', async () => {
    await install('Seven', limited(700));
    await install('Three', limited(300));
    await install('Plain', schemaOf([round('r1', ['GPT'])]));

    await select('Seven');
    expect(debug.basicSchemaFromPage(planOf(), null, { forSave: true }).run.maxWords).toBe(700);
    await select('Three');
    // An explicit value equal to the Basic one stays in the schema.
    expect(debug.basicSchemaFromPage(planOf(), null, { forSave: true }).run.maxWords).toBe(300);
    await select('Plain');
    expect(debug.buildBasicRun(planOf()).run.maxWords).toBe(300);
    expect(debug.basicSchemaFromPage(planOf(), null, { forSave: true }).run?.maxWords).toBeUndefined();
  });

  test('a value outside the four limits is still refused', async () => {
    const result = await debug.installBasicSchema('Wrong', limited(400));
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([{ path: 'run.maxWords', message: 'предел длины pipeline: допустимо 300, 500, 700, 1000' }]);
  });
});
