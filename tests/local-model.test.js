/** @jest-environment jsdom */
const LocalModel = require('../disput/local-model');
const ChoiceDialog = require('../results/choice-dialog');

const review = `${'Подробный разбор документа по разделам. '.repeat(12)}Решение: v1 направить на доработку. Сначала устранить замечания.`;
const replyOf = (content, ok = true) => async () => ({ ok, json: async () => ({ message: { content } }) });
const reply = (label, quote) => JSON.stringify({ label, quote });
const noPrepare = async () => {};

describe('LocalModel.parseReply', () => {
  test('a conclusion with a literal quote is kept', () => {
    expect(LocalModel.parseReply(reply('rework', 'v1 направить на доработку'), review)).toEqual({ label: 'rework', quote: 'v1 направить на доработку' });
  });
  test('quote marks, case and line breaks of the quote do not matter', () => {
    expect(LocalModel.parseReply(reply('rework', '«V1 НАПРАВИТЬ\nна доработку»'), review)?.label).toBe('rework');
  });
  test('an invented quote drops the hint', () => {
    expect(LocalModel.parseReply(reply('pass', 'документ полностью готов к использованию'), review)).toBeNull();
  });
  test('none, an unknown label, a short quote and broken JSON give no hint', () => {
    expect(LocalModel.parseReply(reply('none', ''), review)).toBeNull();
    expect(LocalModel.parseReply(reply('maybe', 'v1 направить на доработку'), review)).toBeNull();
    expect(LocalModel.parseReply(reply('rework', 'v1'), review)).toBeNull();
    expect(LocalModel.parseReply('not json', review)).toBeNull();
    expect(LocalModel.parseReply(undefined, review)).toBeNull();
  });
});

describe('LocalModel request', () => {
  test('the answer is limited to the three labels and the model does not think', () => {
    const body = LocalModel.buildRequest('текст');
    expect(body.model).toBe(LocalModel.MODEL);
    expect(body.think).toBe(false);
    expect(body.format.properties.label.enum).toEqual(['pass', 'rework', 'none']);
  });
  test('a very long text keeps its beginning and its end', () => {
    const prompt = LocalModel.buildPrompt(`НАЧАЛО${'с'.repeat(100000)}КОНЕЦ`);
    expect(prompt).toContain('НАЧАЛО');
    expect(prompt).toContain('КОНЕЦ');
    expect(prompt.length).toBeLessThan(33000);
  });
});

describe('LocalModel.ownerHint', () => {
  const quote = 'v1 направить на доработку';
  test('one line for each text with a conclusion, named by its source', async () => {
    const lines = await LocalModel.ownerHint([{ label: 'GPT', text: review }], { fetchImpl: replyOf(reply('rework', quote)), prepare: noPrepare });
    expect(lines).toEqual([`GPT: вернуть на доработку. Основание: «${quote}»`]);
  });
  test('short texts and files are not sent to the model', async () => {
    const fetchImpl = jest.fn(replyOf(reply('rework', quote)));
    const lines = await LocalModel.ownerHint([{ text: 'коротко' }, { file: { name: 'a.pdf' }, text: review }], { fetchImpl, prepare: noPrepare });
    expect(lines).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  test('the service off, an error status or a refused rule give no hint and no exception', async () => {
    const input = [{ label: 'GPT', text: review }];
    await expect(LocalModel.ownerHint(input, { fetchImpl: async () => { throw new TypeError('Failed to fetch'); }, prepare: noPrepare })).resolves.toEqual([]);
    await expect(LocalModel.ownerHint(input, { fetchImpl: replyOf('{}', false), prepare: noPrepare })).resolves.toEqual([]);
    await expect(LocalModel.ownerHint(input, { fetchImpl: replyOf('{}'), prepare: async () => { throw new Error('no rule'); } })).resolves.toEqual([]);
  });
  test('a closed window stops the following requests', async () => {
    const controller = new AbortController();
    const fetchImpl = jest.fn(async () => { controller.abort(); return replyOf(reply('rework', quote))(); });
    await LocalModel.ownerHint([{ text: review }, { text: review }], { fetchImpl, prepare: noPrepare, signal: controller.signal });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('the hint in the choice dialog', () => {
  const options = (hint) => ({ title: 't', message: 'm', choices: [{ value: 'send', label: 'Отправить' }], hint });
  const flush = () => new Promise((resolve) => setTimeout(resolve));
  const closeWith = (selector) => document.querySelector(selector).click();

  test('the window opens at once and the hint appears when ready', async () => {
    let ready;
    const answer = ChoiceDialog.ask(options(new Promise((resolve) => { ready = resolve; })), document);
    expect(document.querySelector('.choice-dialog')).not.toBeNull();
    expect(document.querySelector('.choice-dialog-hint')).toBeNull();
    ready(['GPT: можно принимать. Основание: «нет ошибок»']);
    await flush();
    const hint = document.querySelector('.choice-dialog-hint');
    expect(hint.textContent).toContain('решаете вы');
    expect(hint.textContent).toContain('GPT: можно принимать');
    closeWith('.choice-dialog-choice');
    await expect(answer).resolves.toBe('send');
  });
  test('no lines or a failed hint leave the window as it was', async () => {
    for (const makeHint of [() => Promise.resolve([]), () => Promise.reject(new Error('x'))]) {
      const answer = ChoiceDialog.ask(options(makeHint()), document);
      await flush();
      expect(document.querySelector('.choice-dialog-hint')).toBeNull();
      closeWith('.choice-dialog-cancel');
      await expect(answer).resolves.toBeNull();
    }
  });
  test('a hint that comes after the window is closed is ignored', async () => {
    let ready;
    const answer = ChoiceDialog.ask(options(new Promise((resolve) => { ready = resolve; })), document);
    closeWith('.choice-dialog-cancel');
    await answer;
    ready(['поздно']);
    await flush();
    expect(document.querySelector('.choice-dialog-hint')).toBeNull();
  });
});
