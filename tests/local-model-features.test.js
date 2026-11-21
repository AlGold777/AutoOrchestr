/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const LocalModel = require('../disput/local-model');
const LocalModelFeatures = require('../results/local-model-features');

const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve)); };
const M4 = 'qwen3.5:4b-mlx';
const M9 = 'qwen3.5:9b-mlx';
const ids = LocalModel.FEATURES.map((item) => item.id);

describe('functions of the local model', () => {
  let data;
  beforeEach(async () => {
    data = {};
    window.chrome = { storage: { local: {
      get: async (key) => ({ [key]: data[key] }),
      set: async (value) => { Object.assign(data, value); }
    } } };
    LocalModel.setModel('');
    data = {};
    await LocalModel.loadFeatures();
  });
  afterEach(() => { delete window.chrome; });

  test('by default all three functions are on and the mode is Middle for both models', () => {
    expect(ids).toEqual(['stall_watch', 'failure_look', 'owner_hint']);
    [M4, M9].forEach((model) => {
      expect(LocalModel.featureState(model)).toEqual({ stall_watch: true, failure_look: true, owner_hint: true });
      expect(LocalModel.presetOf(model)).toBe('hint');
    });
    LocalModel.setModel(M4);
    ids.forEach((id) => expect(LocalModel.feature(id)).toBe(true));
    expect(LocalModel.feature('nothing')).toBe(false);
  });

  test('without LLM no function is on', () => {
    ids.forEach((id) => expect(LocalModel.feature(id)).toBe(false));
  });

  test('modes set the checkboxes and a manual change gives a custom set', () => {
    LocalModel.setModel(M4);
    LocalModel.applyPreset('log');
    expect(LocalModel.featureState(M4)).toEqual({ stall_watch: true, failure_look: false, owner_hint: false });
    expect(LocalModel.presetOf(M4)).toBe('log');
    expect(LocalModel.feature('owner_hint')).toBe(false);
    LocalModel.applyPreset('hint');
    ids.forEach((id) => expect(LocalModel.feature(id)).toBe(true));
    LocalModel.setFeature('failure_look', false);
    expect(LocalModel.presetOf(M4)).toBe('custom');
    expect(LocalModel.feature('failure_look')).toBe(false);
    expect(data[LocalModel.FEATURES_KEY][M4].failure_look).toBe(false);
  });

  test('models are independent and the choice is read back', async () => {
    LocalModel.setModel(M9);
    LocalModel.applyPreset('log', M4);
    expect(LocalModel.presetOf(M4)).toBe('log');
    expect(LocalModel.presetOf(M9)).toBe('hint');
    await LocalModel.loadFeatures();
    expect(LocalModel.presetOf(M4)).toBe('log');
    expect(LocalModel.setFeature('stall_watch', false, 'unknown')).toBe(false);
  });

  test('results.js asks for the function, not for the model', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    expect(source).toContain("enabled: () => window.LocalModel.feature('stall_watch')");
    expect(source).toContain("window.LocalModel?.feature('failure_look')");
    expect(source).toContain("window.LocalModel?.feature('owner_hint')");
  });

  test('a switched-off stall watch reads no pages', async () => {
    let on = false;
    const read = jest.fn(async () => ({ text: 'a', buttons: [], dialogs: [] }));
    const watch = LocalModel.createStallWatch({ tabOf: () => 1, read, observe: jest.fn(), enabled: () => on });
    watch.note({ participant: 'p' });
    await watch.tick();
    expect(read).not.toHaveBeenCalled();
    on = true;
    await watch.tick();
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('queue of the calls', () => {
  const okResponse = () => ({ ok: true, status: 200, json: async () => ({ message: { content: 'x' }, done_reason: 'stop' }) });
  const gate = () => { let open; const promise = new Promise((resolve) => { open = resolve; }); return { promise, open }; };

  test('one request at a time, the participant before waiting observations', async () => {
    const started = [];
    let active = 0;
    let maxActive = 0;
    const first = gate();
    const fetchImpl = jest.fn(async (url, init) => {
      const name = JSON.parse(init.body).name;
      started.push(name);
      active += 1; maxActive = Math.max(maxActive, active);
      if (name === 'first') await first.promise;
      await Promise.resolve();
      active -= 1;
      return okResponse();
    });
    const call = (name, priority) => LocalModel.post({ name, model: M4 }, { fetchImpl, priority });
    const a = call('first', 'observation');
    const b = call('watch', 'observation');
    const c = call('hint', 'owner_hint');
    const d = call('participant', 'participant');
    const e = call('watch2', 'observation');
    await flush();
    expect(started).toEqual(['first']);
    first.open();
    await Promise.all([a, b, c, d, e]);
    expect(started).toEqual(['first', 'participant', 'hint', 'watch', 'watch2']);
    expect(maxActive).toBe(1);
  });

  test('the time limit does not run while the call waits', async () => {
    const first = gate();
    const seen = [];
    const fetchImpl = jest.fn(async (url, init) => {
      seen.push(init.signal);
      if (seen.length === 1) await first.promise;
      return okResponse();
    });
    const a = LocalModel.post({ model: M4 }, { fetchImpl, timeoutMs: 20 });
    const b = LocalModel.post({ model: M4 }, { fetchImpl, timeoutMs: 20 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    first.open();
    const [, second] = await Promise.all([a, b]);
    expect(second.content).toBe('x');
    expect(second.problem).toBeUndefined();
    expect(seen[1].aborted).toBe(false);
  });

  test('a call cancelled before it starts makes no request', async () => {
    const fetchImpl = jest.fn(async () => okResponse());
    const controller = new AbortController();
    controller.abort();
    expect(await LocalModel.post({ model: M4 }, { fetchImpl, signal: controller.signal })).toEqual({});
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('a call cancelled while waiting leaves the queue without a request', async () => {
    const first = gate();
    const fetchImpl = jest.fn(async () => { await first.promise; return okResponse(); });
    const controller = new AbortController();
    const a = LocalModel.post({ model: M4 }, { fetchImpl });
    const b = LocalModel.post({ model: M4 }, { fetchImpl, signal: controller.signal });
    await flush();
    controller.abort();
    expect(await b).toEqual({});
    first.open();
    await a;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('the queue goes on after an HTTP error, a thrown fetch and a bad JSON', async () => {
    const replies = [
      async () => ({ ok: false, status: 500, json: async () => ({}) }),
      async () => { throw new Error('down'); },
      async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }),
      async () => okResponse()
    ];
    const fetchImpl = jest.fn((...args) => replies.shift()(...args));
    const results = await Promise.all([1, 2, 3, 4].map(() => LocalModel.post({ model: M4 }, { fetchImpl })));
    expect(results[0].problem.kind).toBe('http_error');
    expect(results[1].problem.kind).toBe('service_off');
    expect(results[2].problem.kind).toBe('service_off');
    expect(results[3].problem).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});

describe('button and window of the local model', () => {
  let data;
  beforeEach(() => {
    data = {};
    window.chrome = { storage: { local: {
      get: async (key) => ({ [key]: data[key] }),
      set: async (value) => { Object.assign(data, value); }
    } } };
    LocalModel.setModel('');
    data = {};
    document.body.innerHTML = `<button id="b" hidden></button>
      <div class="modal" id="m" style="display:none"><div class="modal-content"><h2 class="local-model-title"></h2>
      <div class="local-model-modes"></div><div class="local-model-features"></div><button class="local-model-close"></button></div></div>`;
  });
  afterEach(() => { delete window.chrome; });

  test('the button is hidden without a model and carries the name of the chosen one', async () => {
    const button = document.getElementById('b');
    const view = LocalModelFeatures.mount(button, document.getElementById('m'), LocalModel);
    await flush();
    expect(button.hidden).toBe(true);
    LocalModel.setModel(M9);
    view.render();
    expect(button.hidden).toBe(false);
    expect(button.textContent).toBe('Qwen 3.5 9B');
  });

  test('the window shows Light and Middle, checkboxes by group, and applies changes at once', async () => {
    LocalModel.setModel(M4);
    const button = document.getElementById('b');
    const modal = document.getElementById('m');
    LocalModelFeatures.mount(button, modal, LocalModel);
    await flush();
    button.click();
    expect(modal.classList.contains('is-visible')).toBe(true);
    expect(modal.querySelector('.local-model-title').textContent).toBe('Qwen 3.5 4B');
    expect([...modal.querySelectorAll('.local-model-mode')].map((n) => n.textContent)).toEqual(['Light', 'Middle']);
    expect(modal.querySelector('.is-active').textContent).toBe('Middle');
    expect([...modal.querySelectorAll('.local-model-group-title')].map((n) => n.textContent)).toEqual(['Наблюдение за вкладками', 'Подсказки владельцу']);
    modal.querySelector('[data-level="log"]').click();
    expect(LocalModel.presetOf(M4)).toBe('log');
    expect(modal.querySelector('[data-feature="owner_hint"]').checked).toBe(false);
    const box = modal.querySelector('[data-feature="failure_look"]');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(LocalModel.presetOf(M4)).toBe('custom');
    expect(modal.querySelector('.is-custom').textContent).toBe('Свой');
    modal.querySelector('.local-model-close').click();
    expect(modal.classList.contains('is-visible')).toBe(false);
  });
});
