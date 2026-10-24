/**
 * @jest-environment jsdom
 */
const ChoiceDialog = require('../results/choice-dialog');
window.OwnerAsk = require('../results/owner-ask');

describe('Choice dialog: any number of buttons, a text answer, a cancel', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('the pressed button gives its value, and the dialog leaves the page', async () => {
    const answer = ChoiceDialog.ask({ title: 'Маршрут', choices: [{ value: 'a', label: 'Первый' }, { value: 'b', label: 'Второй' }, { value: 'c', label: 'Третий' }] });
    const buttons = [...document.querySelectorAll('.choice-dialog-choice')];
    expect(buttons.map((button) => button.textContent)).toEqual(['Первый', 'Второй', 'Третий']);
    buttons[2].click();
    await expect(answer).resolves.toBe('c');
    expect(document.querySelector('.choice-dialog')).toBeNull();
  });

  test('Cancel and Escape resolve to null', async () => {
    const byCancel = ChoiceDialog.ask({ choices: [{ value: 'x', label: 'X' }] });
    document.querySelector('.choice-dialog-cancel').click();
    await expect(byCancel).resolves.toBeNull();
    const byEscape = ChoiceDialog.ask({ choices: [{ value: 'x', label: 'X' }] });
    document.querySelector('.choice-dialog').dispatchEvent(new Event('cancel'));
    await expect(byEscape).resolves.toBeNull();
    expect(document.querySelector('.choice-dialog')).toBeNull();
  });

  test('R07: a Stop of the run (the abort of its signal) closes the window and resolves to null; an aborted signal opens none', async () => {
    const controller = new AbortController();
    const answer = ChoiceDialog.ask({ title: 'Ответ User', textInput: { label: 'Ответ' }, choices: [{ value: 'send', label: 'Отправить' }], signal: controller.signal });
    expect(document.querySelector('.choice-dialog')).not.toBeNull();
    controller.abort();
    await expect(answer).resolves.toBeNull();
    expect(document.querySelector('.choice-dialog')).toBeNull();
    await expect(ChoiceDialog.ask({ choices: [{ value: 'x', label: 'X' }], signal: controller.signal })).resolves.toBeNull();
    expect(document.querySelector('.choice-dialog')).toBeNull();
  });

  test('with a text field the submit button gives the text, and the message is text, not markup', async () => {
    const answer = ChoiceDialog.ask({ title: 'Ответ', message: '<img src=x onerror=alert(1)>', textInput: { label: 'Ответ User' }, choices: [{ value: 'send', label: 'Отправить' }] });
    expect(document.querySelector('.choice-dialog-message').innerHTML).toBe('&lt;img src=x onerror=alert(1)&gt;');
    document.querySelector('.choice-dialog-text').value = 'TEXT';
    document.querySelector('.choice-dialog-choice').click();
    await expect(answer).resolves.toBe('TEXT');
  });
});

describe('Choice dialog: required text, a document to read, a questionnaire form', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  const sendChoice = [{ value: 'send', label: 'Отправить' }];
  const submitButton = () => document.querySelector('.choice-dialog-choice');
  const fire = (node, type) => node.dispatchEvent(new Event(type, { bubbles: true }));

  test('textInput.required: the submit button waits for a non-empty text, then gives it', async () => {
    const answer = ChoiceDialog.ask({ title: 'Ответ', textInput: { label: 'Ответ User', required: true }, choices: sendChoice });
    const area = document.querySelector('.choice-dialog-text');
    expect(submitButton().disabled).toBe(true);
    area.value = '   ';
    fire(area, 'input');
    expect(submitButton().disabled).toBe(true);
    area.value = 'Текст';
    fire(area, 'input');
    expect(submitButton().disabled).toBe(false);
    submitButton().click();
    await expect(answer).resolves.toBe('Текст');
  });

  test('kind read: the document is text (not markup), the button is active at once, an empty comment gives the standard answer', async () => {
    const answer = ChoiceDialog.ask({ title: 'Документ', document: { kind: 'read', text: '<b>x</b>' }, choices: sendChoice });
    const block = document.querySelector('.choice-dialog-document');
    expect(block.textContent).toBe('<b>x</b>');
    expect(block.querySelector('b')).toBeNull();
    expect(document.querySelector('.choice-dialog-text').getAttribute('aria-label')).toBe('Комментарий (необязательно)');
    expect(submitButton().disabled).toBe(false);
    submitButton().click();
    await expect(answer).resolves.toBe('Документ прочитан, замечаний нет.');
  });

  test('kind read: a comment after trim is the answer', async () => {
    const answer = ChoiceDialog.ask({ document: { kind: 'read', text: 'Текст' }, choices: sendChoice });
    document.querySelector('.choice-dialog-text').value = '  Замечание  ';
    submitButton().click();
    await expect(answer).resolves.toBe('Замечание');
  });

  const formItems = [
    { id: 'a', type: 'one', question: 'Вариант', options: ['A', 'B'], required: true },
    { id: 'b', type: 'many', question: 'Несколько', options: ['x', 'y'] },
    { id: 'c', type: 'yesno', question: 'Да или нет?', required: true },
    { id: 'd', type: 'text', question: 'Текст', required: true }
  ];
  const openForm = (extra = {}) => ChoiceDialog.ask({ title: 'Опрос', document: { kind: 'form', form: { items: formItems } }, choices: sendChoice, ...extra });
  const pick = (selector) => {
    const input = document.querySelector(`.choice-dialog-form ${selector}`);
    input.checked = true;
    fire(input, 'change');
  };

  test('kind form: the button waits for the required items, then gives the text answer', async () => {
    const answer = openForm();
    expect(submitButton().disabled).toBe(true);
    pick('input[data-ask-index="0"][data-choice-index="0"]');
    expect(submitButton().disabled).toBe(true);
    pick('input[data-ask-index="2"][data-choice-index="0"]');
    expect(submitButton().disabled).toBe(true);
    const text = document.querySelector('.choice-dialog-form textarea[data-ask-text="3"]');
    text.value = 'текст';
    fire(text, 'input');
    expect(submitButton().disabled).toBe(false);
    submitButton().click();
    await expect(answer).resolves.toBe('Вариант — A\nДа или нет? — Да\nТекст — текст');
  });

  test('kind form with answerFormat json: JSON by item id with the types one, many, yesno, text', async () => {
    const answer = openForm({ answerFormat: 'json' });
    pick('input[data-ask-index="0"][data-choice-index="1"]');
    pick('input[data-ask-index="1"][data-choice-index="0"]');
    pick('input[data-ask-index="1"][data-choice-index="1"]');
    pick('input[data-ask-index="2"][data-choice-index="0"]');
    const text = document.querySelector('.choice-dialog-form textarea[data-ask-text="3"]');
    text.value = 'текст';
    fire(text, 'input');
    expect(submitButton().disabled).toBe(false);
    submitButton().click();
    expect(JSON.parse(await answer)).toEqual({ a: 'B', b: ['x', 'y'], c: true, d: 'текст' });
  });

  test('kind form: Cancel resolves to null', async () => {
    const answer = openForm();
    document.querySelector('.choice-dialog-cancel').click();
    await expect(answer).resolves.toBeNull();
    expect(document.querySelector('.choice-dialog')).toBeNull();
  });
});

describe('Choice dialog: a document to edit, a document to view only, an unavailable version', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  const submitButton = () => document.querySelector('.choice-dialog-choice');
  const fire = (node, type) => node.dispatchEvent(new Event(type, { bubbles: true }));

  test('editable: a textarea with the document text under its title, the button waits for non-empty text, the exact text is the answer', async () => {
    const answer = ChoiceDialog.ask({ title: 'Утверждение', document: { kind: 'read', name: 'ТЗ', version: 2, text: 'Строка' + '\n' + 'вторая', editable: true }, choices: [{ value: 'send', label: 'Отправить' }] });
    expect(document.querySelector('.choice-dialog-document-title').textContent).toBe('ТЗ v2');
    const area = document.querySelector('textarea.choice-dialog-document-edit');
    expect(area.value).toBe('Строка\nвторая');
    expect(area.getAttribute('aria-label')).toBe('Документ');
    expect(document.querySelector('.choice-dialog-document')).toBeNull();
    expect(document.querySelector('.choice-dialog-text')).toBeNull();
    expect(submitButton().disabled).toBe(false);
    area.value = '  \n ';
    fire(area, 'input');
    expect(submitButton().disabled).toBe(true);
    area.value = '  Правка  \n';
    fire(area, 'input');
    expect(submitButton().disabled).toBe(false);
    submitButton().click();
    await expect(answer).resolves.toBe('  Правка  \n');
  });

  test('editable: without a change the answer is the document text; textInput is ignored', async () => {
    const answer = ChoiceDialog.ask({ document: { kind: 'read', name: 'ТЗ', version: 1, text: 'Исходный', editable: true }, textInput: { label: 'Другое', required: true }, choices: [{ value: 'send', label: 'Отправить' }] });
    expect(document.querySelector('.choice-dialog-document-title').textContent).toBe('ТЗ v1');
    submitButton().click();
    await expect(answer).resolves.toBe('Исходный');
  });

  test('editable: without a name the title is only the version', () => {
    ChoiceDialog.ask({ document: { kind: 'read', version: 3, text: 'x', editable: true }, choices: [{ value: 'send', label: 'Отправить' }] });
    expect(document.querySelector('.choice-dialog-document-title').textContent).toBe('v3');
  });

  test('readOnly: the text is shown as text, there is no submit button, only Close, and the answer is null', async () => {
    const answer = ChoiceDialog.ask({ document: { kind: 'read', name: 'ТЗ', version: 2, text: '<b>x</b>', readOnly: true }, choices: [{ value: 'send', label: 'Отправить' }], cancelText: 'Закрыть' });
    expect(document.querySelector('.choice-dialog-document-title').textContent).toBe('ТЗ v2');
    const block = document.querySelector('pre.choice-dialog-document');
    expect(block.textContent).toBe('<b>x</b>');
    expect(block.querySelector('b')).toBeNull();
    expect(document.querySelector('.choice-dialog-choice')).toBeNull();
    expect(document.querySelector('.choice-dialog-text')).toBeNull();
    expect(document.querySelector('.choice-dialog-cancel').textContent).toBe('Закрыть');
    document.querySelector('.choice-dialog-cancel').click();
    await expect(answer).resolves.toBeNull();
  });

  test('readOnly: without cancelText the button is Закрыть', () => {
    ChoiceDialog.ask({ document: { kind: 'read', text: 'x', readOnly: true } });
    expect(document.querySelector('.choice-dialog-cancel').textContent).toBe('Закрыть');
  });

  test('unavailable: the message names the document and version, the retry button is active and gives its value, Cancel gives null', async () => {
    const answer = ChoiceDialog.ask({ document: { kind: 'read', name: 'ТЗ', version: 2, unavailable: true }, choices: [{ value: 'retry', label: 'Повторить' }] });
    expect(document.querySelector('.choice-dialog-document-unavailable').textContent).toBe('Документ «ТЗ» v2 недоступен. Другая версия вместо него не подставляется.');
    expect(document.querySelector('pre.choice-dialog-document')).toBeNull();
    expect(submitButton().textContent).toBe('Повторить');
    expect(submitButton().disabled).toBe(false);
    submitButton().click();
    await expect(answer).resolves.toBe('retry');
  });

  test('unavailable: Cancel gives null', async () => {
    const answer = ChoiceDialog.ask({ document: { kind: 'read', name: 'ТЗ', version: 2, unavailable: true }, choices: [{ value: 'retry', label: 'Повторить' }] });
    document.querySelector('.choice-dialog-cancel').click();
    await expect(answer).resolves.toBeNull();
  });

  test('a plain kind read without the new fields keeps the comment and the standard answer', async () => {
    const answer = ChoiceDialog.ask({ document: { kind: 'read', text: 'Текст' }, choices: [{ value: 'send', label: 'Отправить' }] });
    expect(document.querySelector('.choice-dialog-document').textContent).toBe('Текст');
    expect(document.querySelector('.choice-dialog-document-edit')).toBeNull();
    expect(document.querySelector('.choice-dialog-text')).not.toBeNull();
    submitButton().click();
    await expect(answer).resolves.toBe('Документ прочитан, замечаний нет.');
  });
});
