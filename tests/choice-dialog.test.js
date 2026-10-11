/**
 * @jest-environment jsdom
 */
const ChoiceDialog = require('../results/choice-dialog');

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

  test('with a text field the submit button gives the text, and the message is text, not markup', async () => {
    const answer = ChoiceDialog.ask({ title: 'Ответ', message: '<img src=x onerror=alert(1)>', textInput: { label: 'Ответ владельца' }, choices: [{ value: 'send', label: 'Отправить' }] });
    expect(document.querySelector('.choice-dialog-message').innerHTML).toBe('&lt;img src=x onerror=alert(1)&gt;');
    document.querySelector('.choice-dialog-text').value = 'TEXT';
    document.querySelector('.choice-dialog-choice').click();
    await expect(answer).resolves.toBe('TEXT');
  });
});
