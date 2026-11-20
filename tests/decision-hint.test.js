/**
 * @jest-environment jsdom
 */
const ChoiceDialog = require('../results/choice-dialog');

// The hint of the pause window («Что дальше?») and of the owner window use the same helper.
describe('ChoiceDialog.appendHint: lines of a hint, no hold, nothing on failure', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve));
  let container;
  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    container.innerHTML = '<h2>Вопрос</h2><div class="buttons"></div>';
    document.body.append(container);
  });

  test('the title and the lines go in one paragraph, before the given node, as text', async () => {
    const before = container.querySelector('.buttons');
    ChoiceDialog.appendHint(container, Promise.resolve(['GPT: <b>нет</b>', 'Qwen: ждёт']), {
      title: 'Наблюдение локальной модели (решаете вы):', before
    });
    await flush();
    const node = container.querySelector('p.choice-dialog-hint');
    expect(node.textContent).toBe('Наблюдение локальной модели (решаете вы):\nGPT: <b>нет</b>\nQwen: ждёт');
    expect(node.querySelector('b')).toBeNull();
    expect(node.nextElementSibling).toBe(before);
  });

  test('an empty list, a failure or a closed window add nothing', async () => {
    for (const hint of [Promise.resolve([]), Promise.reject(new Error('x')), Promise.resolve(['поздно'])]) {
      ChoiceDialog.appendHint(container, hint, { isOpen: () => false });
    }
    ChoiceDialog.appendHint(container, Promise.resolve([]), { isOpen: () => true });
    ChoiceDialog.appendHint(container, Promise.reject(new Error('x')), { isOpen: () => true });
    await flush();
    expect(container.querySelector('.choice-dialog-hint')).toBeNull();
  });

  test('no hint (null) changes nothing, and the window does not wait for the hint', async () => {
    ChoiceDialog.appendHint(container, null);
    let ready;
    ChoiceDialog.appendHint(container, new Promise((resolve) => { ready = resolve; }), { isOpen: () => true });
    expect(container.querySelector('.choice-dialog-hint')).toBeNull();
    ready(['строка']);
    await flush();
    expect(container.querySelector('.choice-dialog-hint').textContent).toContain('строка');
  });
});
