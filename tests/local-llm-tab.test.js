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

  test('the instruction, the files and, for a hint, the owner messages form the context', () => {
    const state = { system: 'Будь строгим', files: [{ name: 'a.md', text: 'правила' }], chat: [{ role: 'user', content: 'учитывай цену' }, { role: 'assistant', content: 'хорошо' }] };
    expect(LocalModel.contextOf(state)).toBe('Будь строгим\n\nФайл «a.md»:\nправила');
    const hint = LocalModel.contextOf(state, { withChat: true });
    expect(hint).toContain('учитывай цену');
    expect(hint).not.toContain('хорошо');
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
  test('the chat sends the history after the context and reports a failure', async () => {
    const fetchImpl = jest.fn(okChat('ответ'));
    const reply = await LocalModel.chat([{ role: 'user', content: 'привет' }], { fetchImpl, context: 'контекст', prepare: async () => {} });
    expect(reply).toEqual({ ok: true, text: 'ответ' });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).messages.map((m) => m.role)).toEqual(['system', 'user']);
    const log = jest.fn();
    const failed = await LocalModel.chat([{ role: 'user', content: 'x' }], { fetchImpl: async () => { throw new TypeError('x'); }, log, prepare: async () => {} });
    expect(failed.ok).toBe(false);
    expect(failed.error).toBe(LocalModel.LOG_LABELS.service_off);
    expect(log).toHaveBeenCalledWith('service_off', expect.any(String));
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

  test('the four blocks are there and the log says there are no failures', async () => {
    await setup();
    expect(titles()).toEqual(['Системная инструкция', 'Файлы', 'Log', 'Чат с моделью']);
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
  test('a chat message and its answer are shown; Enter sends', async () => {
    await setup({ chat: async () => ({ ok: true, text: 'Понял' }) });
    const input = panel.querySelector('.local-llm-chat-input');
    input.value = 'Учитывай цену';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush();
    expect([...panel.querySelectorAll('.local-llm-turn')].map((n) => n.textContent)).toEqual(['Учитывай цену', 'Понял']);
  });
  test('a failed chat shows the reason and the field works again', async () => {
    await setup({ chat: async () => ({ ok: false, error: 'Сервис недоступен' }) });
    panel.querySelector('.local-llm-chat-input').value = 'x';
    await tab.sendMessage();
    await flush();
    const error = panel.querySelector('.local-llm-chat-error');
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe('Сервис недоступен');
    expect(panel.querySelector('.local-llm-send').disabled).toBe(false);
  });
});
