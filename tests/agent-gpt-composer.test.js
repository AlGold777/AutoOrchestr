/**
 * @jest-environment jsdom
 */
// Скрипты отправки в чат ChatGPT пишут только в поле сообщения: редактор документа внутри ответа не трогают.
const fs = require('fs');
const path = require('path');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', 'scripts', 'agent', name), 'utf8').trim();
const type = () => window.eval(`${read('gpt-type.js')}("отчёт")`);
const writingBlock = '<div data-testid="chatgpt-writing-block"><div class="ProseMirror" contenteditable="true" tabindex="0" id="doc">документ ответа</div></div>';
const composer = '<fieldset><div data-composer-body><div data-composer-input><div class="ProseMirror" data-composer-markdown contenteditable="true" tabindex="0" id="box"></div></div><button aria-label="Отправить" id="send"></button></div></fieldset>';

describe('scripts/agent: поле сообщения ChatGPT', () => {
  const targets = [];
  beforeEach(() => {
    jest.useFakeTimers();
    targets.length = 0;
    document.execCommand = (command) => { targets.push([command, document.activeElement.id]); return true; };
  });
  afterEach(() => jest.useRealTimers());

  test('текст идёт в поле сообщения, а не в документ ответа; нажимается кнопка этого поля', () => {
    document.body.innerHTML = `<main><button aria-label="Отправить по почте" id="other"></button>${writingBlock}${composer}</main>`;
    const clicked = [];
    document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => clicked.push(b.id)));
    expect(type()).toBe('TYPED');
    jest.advanceTimersByTime(800);
    expect(targets).toEqual([['selectAll', 'box'], ['insertText', 'box']]);
    expect(clicked).toEqual(['send']);
  });

  test('без поля сообщения ничего не правится', () => {
    document.body.innerHTML = `<main>${writingBlock}</main>`;
    document.getElementById('doc').focus();
    expect(type()).toBe('NO_COMPOSER');
    expect(targets).toEqual([]);
  });

  test('если поле не получило фокус, ничего не правится', () => {
    document.body.innerHTML = `<main>${writingBlock}${composer}</main>`;
    document.getElementById('doc').focus();
    document.getElementById('box').focus = () => {};
    expect(type()).toBe('NO_FOCUS');
    expect(targets).toEqual([]);
  });

  test('длина черновика считается по полю сообщения', () => {
    document.body.innerHTML = `<main>${writingBlock}${composer}</main>`;
    document.querySelectorAll('*').forEach((el) => Object.defineProperty(el, 'innerText', { get: () => el.textContent, configurable: true }));
    expect(JSON.parse(window.eval(read('gpt-state.js'))).draft).toBe(0);
  });
});
