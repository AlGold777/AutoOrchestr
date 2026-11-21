/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const LocalModel = require('../disput/local-model');
const LocalModelFeatures = require('../results/local-model-features');
const { create } = require('../results/local-model-main');
const Contract = require('../shared/status-contract');

const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve)); };
const M4 = 'qwen3.5:4b-mlx';
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const mainIds = ['main_stall_watch', 'main_failure_look'];
const pipelineIds = ['stall_watch', 'failure_look', 'owner_hint'];

const panel = (name) => `<div class="llm-panel" id="panel-${name.toLowerCase()}"><div class="llm-header"><span class="llm-title">${name}</span>
  <div class="status-control-cluster"><span class="status-indicator" data-llm-name="${name}"></span></div>
  <div class="header-right"><button class="panel-clear-response-btn" data-target="output-${name.toLowerCase()}"></button></div></div><div class="output" id="output-${name.toLowerCase()}"></div></div>`;

describe('registry by page', () => {
  let data;
  beforeEach(async () => {
    data = {};
    window.chrome = { storage: { local: { get: async (key) => ({ [key]: data[key] }), set: async (value) => { Object.assign(data, value); } } } };
    LocalModel.setModel('');
    data = {};
    await LocalModel.loadFeatures();
  });
  afterEach(() => { delete window.chrome; });

  test('every function has a page; the main page has two, the pipeline three', () => {
    expect(LocalModel.pageFeatures('main').map((item) => item.id)).toEqual(mainIds);
    expect(LocalModel.pageFeatures('pipeline').map((item) => item.id)).toEqual(pipelineIds);
    expect(LocalModel.FEATURES.every((item) => ['main', 'pipeline'].includes(item.page))).toBe(true);
  });

  test('both pages are in Middle by default and a mode of one page does not touch the other', () => {
    LocalModel.setModel(M4);
    expect(LocalModel.presetOf(M4, 'main')).toBe('hint');
    expect(LocalModel.presetOf(M4, 'pipeline')).toBe('hint');
    LocalModel.applyPreset('log', M4, 'main');
    expect(LocalModel.featureState(M4)).toEqual({ stall_watch: true, failure_look: true, owner_hint: true, main_stall_watch: true, main_failure_look: false });
    expect(LocalModel.presetOf(M4, 'main')).toBe('log');
    expect(LocalModel.presetOf(M4, 'pipeline')).toBe('hint');
    LocalModel.applyPreset('log', M4, 'pipeline');
    expect(LocalModel.featureState(M4)).toMatchObject({ stall_watch: true, failure_look: false, owner_hint: false, main_failure_look: false });
    LocalModel.applyPreset('hint', M4, 'main');
    expect(LocalModel.featureState(M4)).toMatchObject({ main_failure_look: true, failure_look: false });
  });

  test('without LLM no function of the main page is on', () => {
    mainIds.forEach((id) => expect(LocalModel.feature(id)).toBe(false));
    LocalModel.setModel(M4);
    mainIds.forEach((id) => expect(LocalModel.feature(id)).toBe(true));
  });

  test('the window of each page shows only its own functions and modes', async () => {
    LocalModel.setModel(M4);
    const shape = async (page) => {
      document.body.innerHTML = `<button id="b"></button><div class="modal" id="m" data-page="${page}" style="display:none"><div class="modal-content"><h2 class="local-model-title"></h2>
        <div class="local-model-modes"></div><div class="local-model-features"></div><button class="local-model-close"></button></div></div>`;
      const modal = document.getElementById('m');
      LocalModelFeatures.mount(document.getElementById('b'), modal, LocalModel);
      await flush();
      document.getElementById('b').click();
      return { ids: [...modal.querySelectorAll('[data-feature]')].map((n) => n.dataset.feature), modes: [...modal.querySelectorAll('.local-model-mode')].map((n) => n.textContent), modal };
    };
    const main = await shape('main');
    expect(main.ids).toEqual(mainIds);
    expect(main.modes).toEqual(['Light', 'Middle']);
    main.modal.querySelector('[data-level="log"]').click();
    expect(LocalModel.featureState(M4)).toMatchObject({ main_failure_look: false, owner_hint: true, failure_look: true });
    const pipeline = await shape('pipeline');
    expect(pipeline.ids).toEqual(pipelineIds);
  });
});

describe('main page: watching and the look at a failed tab', () => {
  let model;
  let main;
  const names = ['GPT', 'Claude'];
  const tabsState = { tabs: { map: { GPT: 11, Claude: 12 } } };
  beforeEach(() => {
    document.body.className = '';
    document.body.innerHTML = names.map(panel).join('') + '<button id="clear-all-btn"></button>';
    model = {
      enabled: jest.fn(() => true),
      feature: jest.fn(() => true),
      observeTab: jest.fn(async () => ({ situation: 'blocked', button: '', note: '' })),
      observationLine: jest.fn((name) => `${name}: смотрю`),
      createStallWatch: jest.fn(() => ({ note: jest.fn(), start: jest.fn(), stop: jest.fn(), waitingCount: jest.fn(() => 1) }))
    };
    main = create({ api: model, doc: document, contract: Contract });
    main.setTabs(tabsState);
  });
  const line = (name) => document.querySelector(`.status-indicator[data-llm-name="${name}"]`).closest('.llm-header').querySelector('.local-model-look');

  test('an error, a timeout and an empty answer are looked at once and the line is in the card', async () => {
    main.begin(names);
    main.noteStatus('GPT', 'ERROR');
    main.noteStatus('GPT', 'ERROR');
    await flush();
    expect(model.observeTab).toHaveBeenCalledTimes(1);
    expect(model.observeTab).toHaveBeenCalledWith({ tabId: 11, participant: 'GPT', reason: 'статус ERROR' });
    expect(line('GPT').textContent).toBe('GPT: смотрю');
    main.noteStatus('Claude', 'STREAM_TIMEOUT');
    await flush();
    expect(line('Claude')).not.toBeNull();
    main.begin(names);
    main.noteAnswer('GPT', '  ');
    await flush();
    expect(model.observeTab).toHaveBeenCalledTimes(3);
    expect(model.observeTab.mock.calls[2][0].reason).toBe('пустой ответ');
  });

  test('after Stop a late error or empty answer looks at nothing', async () => {
    main.begin(names);
    main.stop();
    main.noteStatus('GPT', 'ERROR');
    main.noteAnswer('Claude', '');
    await flush();
    expect(model.observeTab).not.toHaveBeenCalled();
  });

  test('an error inside a hook does not reach the page', () => {
    model.createStallWatch.mockImplementation(() => { throw new Error('boom'); });
    expect(() => main.begin(names)).not.toThrow();
  });

  test('success, partial and live statuses are not looked at', async () => {
    main.begin(names);
    ['INITIALIZING', 'RECEIVING', 'SUCCESS', 'PARTIAL', 'RECOVERABLE_ERROR'].forEach((status) => main.noteStatus('GPT', status));
    main.noteAnswer('Claude', 'a text');
    await flush();
    expect(model.observeTab).not.toHaveBeenCalled();
    expect(line('GPT')).toBeNull();
  });

  test('the line goes away with a new request, with the clear button and with the clear-all button', async () => {
    main.begin(names);
    main.noteStatus('GPT', 'ERROR');
    main.noteStatus('Claude', 'ERROR');
    await flush();
    document.querySelector('#panel-gpt .panel-clear-response-btn').click();
    expect(line('GPT')).toBeNull();
    expect(line('Claude')).not.toBeNull();
    main.begin(names);
    expect(line('Claude')).toBeNull();
    main.noteStatus('GPT', 'ERROR');
    await flush();
    document.getElementById('clear-all-btn').click();
    expect(document.querySelectorAll('.local-model-look')).toHaveLength(0);
  });

  test('a function that is off reads nothing and calls no model', async () => {
    model.feature.mockImplementation((id) => id !== 'main_failure_look');
    main.begin(names);
    main.noteStatus('GPT', 'ERROR');
    await flush();
    expect(model.observeTab).not.toHaveBeenCalled();
    model.enabled.mockReturnValue(false);
    main.begin(names);
    expect(model.createStallWatch).toHaveBeenCalledTimes(1);
  });

  test('only models of the current request are watched; the watch stops with their final answers', () => {
    const watch = { note: jest.fn(), start: jest.fn(), stop: jest.fn(), waitingCount: jest.fn() };
    model.createStallWatch.mockReturnValue(watch);
    main.begin(['GPT']);
    expect(watch.note.mock.calls.map((call) => call[0].participant)).toEqual(['GPT']);
    expect(watch.start).toHaveBeenCalled();
    main.noteStatus('Claude', 'ERROR');
    expect(model.observeTab).not.toHaveBeenCalled();
    watch.waitingCount.mockReturnValue(0);
    main.noteStatus('GPT', 'SUCCESS');
    expect(watch.note).toHaveBeenLastCalledWith({ participant: 'GPT', state: 'done' });
    expect(watch.stop).toHaveBeenCalled();
  });

  test('the watch asks for the function of the main page', () => {
    main.begin(names);
    const { enabled } = model.createStallWatch.mock.calls[0][0];
    enabled();
    expect(model.feature).toHaveBeenCalledWith('main_stall_watch');
    expect(model.createStallWatch.mock.calls[0][0].tabOf('GPT')).toBe(11);
  });

  test('on the pipeline page nothing runs', async () => {
    document.body.className = 'pipeline-page';
    main.begin(names);
    main.noteStatus('GPT', 'ERROR');
    await flush();
    expect(model.createStallWatch).not.toHaveBeenCalled();
    expect(model.observeTab).not.toHaveBeenCalled();
  });
});

describe('wiring', () => {
  test('result_new.html places the select left of Long, the button left of export, the window and the tab', () => {
    const html = read('result_new.html');
    expect(html.indexOf('id="local-model-select"')).toBeGreaterThan(html.indexOf('class="prompt-footer-right"'));
    expect(html.indexOf('id="local-model-select"')).toBeLessThan(html.indexOf('long-mode-toggle"'));
    expect(html.indexOf('id="local-model-button"')).toBeLessThan(html.indexOf('id="export-html-btn"'));
    expect(html.indexOf('id="local-model-button"')).toBeGreaterThan(html.indexOf('class="toolbar-cluster"'));
    expect(html).toContain('id="local-model-modal" data-page="main"');
    expect(html).toContain('id="local-llm-tabpanel"');
    ['disput/local-model.js', 'results/local-llm-tab.js', 'results/local-model-select.js', 'results/local-model-features.js', 'results/local-model-main.js'].forEach((file) => {
      expect(html.indexOf(`src="${file}"`)).toBeGreaterThan(-1);
      expect(html.indexOf(`src="${file}"`)).toBeLessThan(html.indexOf('src="results.js"'));
    });
  });

  test('the pipeline panel does not load the main page module', () => {
    expect(read('pipeline_panel.html')).not.toContain('local-model-main.js');
  });

  test('results.js hooks: start of a request, statuses, final answers, tabs of the broadcast', () => {
    const source = read('results.js');
    expect(source).toContain('window.LocalModelMain?.begin(selectedLLMs)');
    expect(source).toContain('window.LocalModelMain?.noteStatus(normalizedName, normalizedStatus)');
    expect(source).toContain('window.LocalModelMain.noteAnswer(message.llmName, finalText)');
    expect(source).toContain('window.LocalModelMain?.setTabs(message.state || {})');
  });
});
