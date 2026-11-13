/** @jest-environment jsdom */
const LocalModel = require('../disput/local-model');
const LocalLlmTab = require('../results/local-llm-tab');

const fakeStore = () => {
  const data = {};
  const listeners = [];
  return {
    data, listeners,
    area: {
      get: async (key) => ({ [key]: data[key] }),
      set: async (value) => {
        Object.assign(data, value);
        Object.keys(value).forEach((key) => listeners.forEach((fn) => fn({ [key]: { newValue: value[key] } }, 'local')));
      }
    }
  };
};
const flush = async () => { for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve)); };
const okChat = (content) => async () => ({ ok: true, status: 200, json: async () => ({ message: { content } }) });

describe('LocalModel context and log', () => {
  let store;
  beforeEach(() => {
    store = fakeStore();
    window.chrome = { storage: { local: store.area } };
  });
  afterEach(() => { delete window.chrome; });

  test('the instruction and the files form the context', () => {
    const state = { system: 'Будь строгим', files: [{ name: 'a.md', text: 'правила' }] };
    expect(LocalModel.contextOf(state)).toBe('Будь строгим\n\nФайл «a.md»:\nправила');
  });
  test('an empty context adds no system message, a context adds one', () => {
    expect(LocalModel.buildRequest('т').messages.map((m) => m.role)).toEqual(['user']);
    expect(LocalModel.buildRequest('т', 'контекст').messages.map((m) => m.role)).toEqual(['system', 'user']);
  });
  test('problems of a hint are written to the log', async () => {
    const text = 'Разбор документа. '.repeat(30);
    const cases = [
      [async () => { throw new TypeError('Failed'); }, 'service_off'],
      [async () => ({ ok: false, status: 404 }), 'model_missing'],
      [async () => ({ ok: false, status: 500 }), 'http_error'],
      [okChat('not json'), 'bad_reply'],
      [okChat(JSON.stringify({ label: 'pass', quote: 'этого точно нет в тексте' })), 'quote_rejected']
    ];
    for (const [fetchImpl, kind] of cases) {
      const log = jest.fn();
      await expect(LocalModel.suggest(text, { fetchImpl, log })).resolves.toBeNull();
      expect(log.mock.calls[0][0]).toBe(kind);
    }
  });
  test('a text without a conclusion is not a problem', async () => {
    const log = jest.fn();
    await LocalModel.suggest('текст', { fetchImpl: okChat(JSON.stringify({ label: 'none', quote: '' })), log });
    expect(log).not.toHaveBeenCalled();
  });
  test('a cancelled request is not a problem', async () => {
    const controller = new AbortController();
    controller.abort();
    const log = jest.fn();
    await LocalModel.suggest('текст', { signal: controller.signal, fetchImpl: async () => { throw new DOMException('aborted', 'AbortError'); }, log });
    expect(log).not.toHaveBeenCalled();
  });
  test('the log keeps the newest entry first', async () => {
    await LocalModel.addLog('service_off', 'a');
    await LocalModel.addLog('timeout', 'b');
    expect((await LocalModel.loadState()).log.map((e) => e.kind)).toEqual(['timeout', 'service_off']);
  });
});

describe('LocalModel observation', () => {
  const page = { url: 'u', title: 't', text: 'Какой ответ вы предпочитаете? Выберите один, чтобы продолжить.', dialogs: [], buttons: ['Предпочитаю этот ответ', 'Войти', 'Стоп'] };
  const reply = (situation, button, note = '') => JSON.stringify({ situation, button, note });
  const scripting = { executeScript: async () => [{ result: page }] };
  beforeEach(() => { window.chrome = { storage: { local: fakeStore().area } }; });
  afterEach(() => { delete window.chrome; });

  test('a button that is on the page and allowed is kept', () => {
    expect(LocalModel.checkObservation(reply('choose_answer', 'предпочитаю ЭТОТ ответ', 'Какой ответ вы предпочитаете?'), page))
      .toEqual({ situation: 'choose_answer', button: 'Предпочитаю этот ответ', note: 'Какой ответ вы предпочитаете?' });
  });
  test('an invented button or a quote not on the page is dropped', () => {
    const result = LocalModel.checkObservation(reply('choose_answer', 'Нажми меня', 'выдуманная фраза'), page);
    expect(result.button).toBe('');
    expect(result.note).toBe('');
  });
  test('login, payment and similar buttons are never named', () => {
    expect(LocalModel.checkObservation(reply('choose_answer', 'Войти'), page).button).toBe('');
    expect(LocalModel.checkObservation(reply('login_required', 'Предпочитаю этот ответ'), page).button).toBe('');
    expect(LocalModel.checkObservation(reply('limit_reached', 'Предпочитаю этот ответ'), page).button).toBe('');
  });
  test('an unknown situation and broken JSON give nothing', () => {
    expect(LocalModel.checkObservation(reply('other', ''), page)).toBeNull();
    expect(LocalModel.checkObservation('oops', page)).toBeNull();
  });
  test('the observation is logged and saved, and it only reads the tab', async () => {
    const log = jest.fn();
    const executeScript = jest.fn(scripting.executeScript);
    const result = await LocalModel.observeTab({ tabId: 7, participant: 'qwen-a', reason: 'empty' }, {
      scripting: { executeScript }, prepare: async () => {}, log, fetchImpl: okChat(reply('choose_answer', 'Предпочитаю этот ответ'))
    });
    expect(result.button).toBe('Предпочитаю этот ответ');
    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toBe('observed');
    expect(log.mock.calls[0][1]).toContain('нажала бы');
    const saved = (await LocalModel.loadState()).observations;
    expect(saved[0]).toMatchObject({ participant: 'qwen-a', reason: 'empty', situation: 'choose_answer' });
  });
  test('without a tab nothing happens, a closed tab goes to the log', async () => {
    await expect(LocalModel.observeTab({ participant: 'x' }, { scripting })).resolves.toBeNull();
    const log = jest.fn();
    await LocalModel.observeTab({ tabId: 1, participant: 'x' }, { scripting: { executeScript: async () => { throw new Error('No tab'); } }, log, prepare: async () => {} });
    expect(log.mock.calls[0][0]).toBe('observe_failed');
  });
  test('the model is asked only for known situations', () => {
    expect(LocalModel.buildObservationRequest(page, 'empty').format.properties.situation.enum).toEqual(Object.keys(LocalModel.SITUATIONS));
  });
});

describe('LocalModel stall watch', () => {
  const setup = () => {
    let time = 0;
    const pages = { value: { text: 'a', buttons: [], dialogs: [] } };
    const observe = jest.fn(async () => {});
    const watch = LocalModel.createStallWatch({ tabOf: () => 5, read: async () => pages.value, observe, now: () => time, stallMs: 100 });
    return { watch, pages, observe, advance: (ms) => { time += ms; } };
  };
  test('an unchanged page is observed once after the stall time', async () => {
    const { watch, observe, advance } = setup();
    watch.note({ participant: 'gpt-a', phase: 'answer', state: 'sending' });
    await watch.tick();
    advance(50); await watch.tick();
    expect(observe).not.toHaveBeenCalled();
    advance(60); await watch.tick();
    expect(observe).toHaveBeenCalledWith({ tabId: 5, participant: 'gpt-a', reason: 'no_progress' });
    advance(500); await watch.tick();
    expect(observe).toHaveBeenCalledTimes(1);
  });
  test('a page that keeps changing is not observed', async () => {
    const { watch, pages, observe, advance } = setup();
    watch.note({ participant: 'gpt-a', phase: 'answer' });
    for (let i = 0; i < 5; i += 1) {
      pages.value = { text: `текст ${i}`, buttons: [], dialogs: [] };
      advance(90);
      await watch.tick();
    }
    expect(observe).not.toHaveBeenCalled();
  });
  test('a change after a stall allows a new observation', async () => {
    const { watch, pages, observe, advance } = setup();
    watch.note({ participant: 'gpt-a', phase: 'answer' });
    await watch.tick(); advance(110); await watch.tick();
    pages.value = { text: 'новый', buttons: [], dialogs: [] };
    await watch.tick(); advance(110); await watch.tick();
    expect(observe).toHaveBeenCalledTimes(2);
  });
  test('a new window on the page is observed at once', async () => {
    const { watch, pages, observe } = setup();
    watch.note({ participant: 'claude-a', phase: 'answer' });
    await watch.tick();
    pages.value = { text: 'a', buttons: [], dialogs: ['You have hit your limit'] };
    await watch.tick();
    expect(observe).toHaveBeenCalledWith({ tabId: 5, participant: 'claude-a', reason: 'new_dialog' });
    await watch.tick();
    expect(observe).toHaveBeenCalledTimes(1);
  });
  test('a generation that stops with no end mark is observed at once', async () => {
    const { watch, pages, observe } = setup();
    watch.note({ participant: 'gpt-a', phase: 'answer' });
    pages.value = { text: 'пишет', buttons: ['Стоп'], dialogs: [] };
    await watch.tick();
    pages.value = { text: 'пишет и оборвался', buttons: ['Отправить'], dialogs: [] };
    await watch.tick();
    expect(observe).toHaveBeenCalledWith({ tabId: 5, participant: 'gpt-a', reason: 'stopped_without_end' });
  });
  test('a generation that ends with the end mark is not a problem', async () => {
    const { watch, pages, observe } = setup();
    watch.note({ participant: 'gpt-a', phase: 'answer' });
    pages.value = { text: 'пишет', buttons: ['Стоп'], dialogs: [] };
    await watch.tick();
    pages.value = { text: 'готово [[AO-abc123]]', buttons: ['Отправить'], dialogs: [] };
    await watch.tick();
    expect(observe).not.toHaveBeenCalled();
  });
  test('a finished participant is forgotten', async () => {
    const { watch, observe, advance } = setup();
    watch.note({ participant: 'gpt-a', phase: 'answer' });
    await watch.tick();
    watch.note({ participant: 'gpt-a', phase: 'answer', state: 'done', finishedAt: 1 });
    advance(200); await watch.tick();
    expect(observe).not.toHaveBeenCalled();
    expect(watch.waitingCount()).toBe(0);
  });
  test('a closed tab does not break the watch', async () => {
    const observe = jest.fn();
    const watch = LocalModel.createStallWatch({ tabOf: () => 5, read: async () => { throw new Error('gone'); }, observe });
    watch.note({ participant: 'x', phase: 'answer' });
    await expect(watch.tick()).resolves.toBeUndefined();
    expect(observe).not.toHaveBeenCalled();
  });
});

describe('Local LLM tab', () => {
  let store;
  let panel;
  let tab;
  const api = (overrides = {}) => ({ ...LocalModel, ...overrides });
  const setup = async (overrides) => {
    store = fakeStore();
    window.chrome = { storage: { local: store.area } };
    document.body.innerHTML = '<section id="p"></section>';
    panel = document.getElementById('p');
    tab = LocalLlmTab.mount(panel, { api: api(overrides), doc: document, areaEvents: { addListener: (fn) => store.listeners.push(fn) } });
    await tab.ready;
  };
  afterEach(() => { delete window.chrome; });
  const titles = () => [...panel.querySelectorAll('h2')].map((h) => h.textContent);

  test('the three blocks are there and the log says there are no failures', async () => {
    await setup();
    expect(titles()).toEqual(['Системная инструкция', 'Файлы', 'Log']);
    expect(panel.querySelector('.local-llm-log').textContent).toContain('Сбоев нет');
  });
  test('the instruction is saved', async () => {
    await setup();
    panel.querySelector('.local-llm-system').value = 'Новая инструкция';
    await tab.saveSystem();
    expect((await LocalModel.loadState()).system).toBe('Новая инструкция');
  });
  test('a dropped text file is listed, a binary file goes to the log', async () => {
    await setup();
    const files = [{ name: 'a.md', size: 5, type: '', text: async () => 'текст' }, { name: 'b.png', size: 5, type: 'image/png', text: async () => '' }];
    const event = new Event('drop', { bubbles: true, cancelable: true });
    event.dataTransfer = { files };
    panel.querySelector('.local-llm-drop').dispatchEvent(event);
    await flush();
    expect(panel.querySelector('.local-llm-file-name').textContent).toBe('a.md');
    expect(panel.querySelector('.local-llm-log').textContent).toContain('b.png');
  });
  test('the removal button takes a file away', async () => {
    await setup();
    await tab.addFiles([{ name: 'a.md', size: 5, type: '', text: async () => 'т' }]);
    await flush();
    panel.querySelector('.local-llm-file-remove').click();
    await flush();
    expect(panel.querySelector('.local-llm-file')).toBeNull();
  });
});
