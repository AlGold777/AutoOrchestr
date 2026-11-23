/** @jest-environment jsdom */
// The End step on the page: the End column of the canvas and the End window (basic-windows.md «Колонка End и окно End»).
const StageCard = require('../results/stage-card');
const H = require('./helpers/results-page-harness');

const schemaV2 = (steps, extra = {}) => ({ schemaVersion: 2, origin: 'user', steps, ...extra });
const round = (ref, models, extra = {}) => ({ ref, kind: 'round', models, ...extra });

describe('Basic End window (results/stage-card.js buildEndWindow)', () => {
  const items = [
    { step: 'r2', participant: 'gpt-id', label: 'Критик', title: 'Итог GPT', version: 3, text: 'Первый текст' },
    { step: 'r1', title: 'Черновик', text: 'Второй текст' }
  ];

  beforeEach(() => { document.body.innerHTML = ''; });

  test('one section per document: title, version and text, with its own copy button', () => {
    const onCopy = jest.fn();
    const dialog = StageCard.buildEndWindow(document, { title: 'Basic: все шаги пройдены.', items, onCopy });
    document.body.append(dialog);

    expect(dialog.querySelector('.basic-end-title').textContent).toBe('Basic: все шаги пройдены.');
    const sections = dialog.querySelectorAll('section.basic-end-item');
    expect(sections).toHaveLength(2);
    // The step label and the participant's label (not its id): the documents of a multi-model round tell apart by the participant.
    expect(sections[0].querySelector('.basic-end-item-title').textContent).toBe('Итог GPT · Критик');
    expect(sections[1].querySelector('.basic-end-item-title').textContent).toBe('Черновик');
    expect(sections[0].querySelector('.basic-end-item-version').textContent).toBe('версия 3');
    expect(sections[0].querySelector('.basic-end-text').textContent).toBe('Первый текст');
    expect(sections[1].querySelector('.basic-end-item-version')).toBeNull();

    sections[1].querySelector('.basic-end-copy').click();
    expect(onCopy).toHaveBeenCalledWith(items[1], sections[1].querySelector('.basic-end-copy'));
  });

  test('Save is disabled without documents; Save and Close call their callbacks', () => {
    const onSave = jest.fn();
    const onClose = jest.fn();
    const empty = StageCard.buildEndWindow(document, { title: 'Basic: x.', items: [], onSave, onClose });
    expect(empty.querySelector('.basic-end-save').disabled).toBe(true);

    const dialog = StageCard.buildEndWindow(document, { title: 'Basic: x.', items, onSave, onClose });
    document.body.append(dialog);
    dialog.querySelector('.basic-end-save').click();
    expect(onSave).toHaveBeenCalledTimes(1);
    dialog.querySelector('.basic-end-close').click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Basic End column on the canvas', () => {
  beforeAll(async () => {
    H.renderDebateDom();
    document.body.classList.add('pipeline-page');
    // The page keeps its columns in .pipeline-flow (pipeline_panel.html); the harness markup has them directly in the canvas.
    const canvas = document.querySelector('.pipeline-canvas');
    const flow = document.createElement('div');
    flow.className = 'pipeline-flow';
    flow.append(...Array.from(canvas.childNodes));
    flow.insertAdjacentHTML('afterbegin', '<div class="stage-column entry-column"><span class="entry-badge">In</span></div>');
    canvas.append(flow);
    ['disput/basic-input-files.js', 'results/basic-input-canvas.js'].forEach((file) => {
      window.eval(require('fs').readFileSync(require('path').join(__dirname, '..', file), 'utf8'));
    });
    await H.loadResultsScript();
  });

  const debug = () => window.__pipelineLifecycleDebug;
  const selectPipeline = async (name) => {
    document.querySelector(`.pipeline-item[data-name="${name}"]`)?.click();
    await H.delay(20);
  };
  const flowChildren = () => Array.from(document.querySelector('.pipeline-flow').children);

  test('one End column, last in the flow, after the last round, paired with In', async () => {
    const name = 'End column placement';
    const schema = schemaV2([
      round('r1', [{ id: 'claude-id', name: 'Claude' }]),
      round('r2', [{ id: 'gpt-id', name: 'GPT' }])
    ]);
    expect(await debug().installBasicSchema(name, schema)).toEqual({ ok: true, errors: [] });
    await selectPipeline(name);

    const ends = document.querySelectorAll('.pipeline-end-column');
    expect(ends).toHaveLength(1);
    const children = flowChildren();
    expect(children[0].classList.contains('entry-column')).toBe(true);
    expect(children[children.length - 1]).toBe(ends[0]);
    expect(children.indexOf(document.getElementById('round2'))).toBeLessThan(children.indexOf(ends[0]));
    expect(ends[0].querySelector('.pipeline-end-card').textContent).toBe('End');
    // The lines are drawn in the connector group right before the End column.
    expect(children[children.length - 2].querySelector('svg#svg-end-links')).not.toBeNull();
  });

  test('the End card names the source round, and a redraw keeps one End column', async () => {
    const name = 'End column redraw';
    const schema = schemaV2([
      round('r1', [{ id: 'claude-id', name: 'Claude' }]),
      round('r2', [{ id: 'gpt-id', name: 'GPT' }])
    ]);
    expect(await debug().installBasicSchema(name, schema)).toEqual({ ok: true, errors: [] });
    await selectPipeline(name);
    await selectPipeline(name);

    expect(document.querySelectorAll('.pipeline-end-column')).toHaveLength(1);
    expect(document.querySelector('.pipeline-end-card').dataset.endFrom).toBe('из R2');
  });

  test('lines come from the sources of the End step: one per source', async () => {
    const name = 'End lines from sources';
    const schema = schemaV2([
      round('r1', [{ id: 'claude-id', name: 'Claude' }]),
      round('r2', [{ id: 'gpt-id', name: 'GPT' }])
    ], { end: { from: [{ step: 'r1' }, { step: 'r2' }] } });
    expect(await debug().installBasicSchema(name, schema)).toEqual({ ok: true, errors: [] });
    await selectPipeline(name);

    expect(document.querySelectorAll('.pipeline-end-column')).toHaveLength(1);
    expect(document.querySelector('.pipeline-end-card').dataset.endFrom).toBe('из R1, R2');
    expect(document.querySelectorAll('svg#svg-end-links path.connector-line')).toHaveLength(2);
  });

  test('the built-in Default canvas and an empty canvas keep the End column', async () => {
    // Default has a model in its last round: the End source is that round (the contract default), one line to End.
    await selectPipeline('Default');
    expect(document.querySelectorAll('.pipeline-end-column')).toHaveLength(1);
    expect(document.querySelector('.pipeline-end-card').dataset.endFrom).toBe('из R1');
    expect(document.querySelectorAll('svg#svg-end-links path.connector-line')).toHaveLength(1);

    const name = 'End column empty canvas';
    // No round at all: a schema of one owner step (valid, runs by itself). The End column stays, with no source.
    expect(await debug().installBasicSchema(name, schemaV2([{ ref: 'owner:check', kind: 'owner', models: [], task: 'Проверить' }]))).toEqual({ ok: true, errors: [] });
    await selectPipeline(name);
    expect(document.querySelectorAll('.pipeline-end-column')).toHaveLength(1);
    expect(document.querySelector('.pipeline-end-card').dataset.endFrom).toBe('нет источников');
  });

  test('lines: right angles in the classic skin, curves in the new one (links to End and between the rounds)', async () => {
    const name = 'End lines by skin';
    const schema = schemaV2([
      round('r1', [{ id: 'claude-id', name: 'Claude' }, { id: 'gpt-id', name: 'GPT' }]),
      round('r2', [{ id: 'gemini-id', name: 'Gemini' }])
    ]);
    expect(await debug().installBasicSchema(name, schema)).toEqual({ ok: true, errors: [] });

    document.documentElement.removeAttribute('data-canvas-skin');
    await selectPipeline(name);
    const classicEnd = document.querySelector('svg#svg-end-links path.connector-line').getAttribute('d');
    expect(classicEnd).toMatch(/H.*V.*H/);
    expect(classicEnd).not.toMatch(/C/);
    expect(document.querySelectorAll('svg#svg-r1-r2 line').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('svg#svg-r1-r2 path').length).toBe(0);

    document.documentElement.setAttribute('data-canvas-skin', 'minimal');
    await selectPipeline(name);
    const minimalEnd = document.querySelector('svg#svg-end-links path.connector-line').getAttribute('d');
    expect(minimalEnd).toMatch(/C/);
    expect(minimalEnd).not.toMatch(/H/);
    expect(document.querySelectorAll('svg#svg-r1-r2 path.connector-line').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('svg#svg-r1-r2 line.connector-line').length).toBe(0);
    document.documentElement.removeAttribute('data-canvas-skin');
  });

  test('the schema keeps the end field of its source, as it keeps spec', async () => {
    const name = 'End field kept';
    const schema = schemaV2([
      round('r1', [{ id: 'claude-id', name: 'Claude' }]),
      round('r2', [{ id: 'gpt-id', name: 'GPT' }])
    ], { end: { from: [{ step: 'r1' }] } });
    expect(await debug().installBasicSchema(name, schema)).toEqual({ ok: true, errors: [] });
    await selectPipeline(name);

    expect(debug().basicSchemaFromPage(null, null, { forSave: true }).end).toEqual({ from: [{ step: 'r1' }] });
  });
});
