/**
 * @jest-environment jsdom
 */
const OwnerAsk = require('../results/owner-ask');

const mount = (asks) => {
  document.body.innerHTML = '<div id="box"></div>';
  const box = document.getElementById('box');
  OwnerAsk.render(box, asks);
  return box;
};
const fire = (node, type) => node.dispatchEvent(new Event(type, { bubbles: true }));
const pick = (box, selector) => {
  const input = box.querySelector(selector);
  input.checked = true;
  fire(input, 'change');
};

const items = [
  { id: 'a', type: 'one', question: 'Вариант', options: ['A', 'B'], required: true },
  { id: 'b', type: 'many', question: 'Несколько', options: ['x', 'y'] },
  { id: 'c', type: 'yesno', question: 'Да или нет?' },
  { id: 'd', type: 'text', question: 'Текст', required: true }
];

describe('Owner ask: form items (text, yes/no, many) on the shared renderer', () => {
  test('a text item has no options and one textarea; the required mark is on the legend', () => {
    const box = mount(OwnerAsk.formAsks([items[3]]));
    const row = box.querySelector('fieldset.owner-ask-item');
    expect(row.querySelector('legend').textContent).toBe('Текст *');
    expect(row.dataset.required).toBe('true');
    expect(row.querySelectorAll('input').length).toBe(0);
    const area = row.querySelector('textarea.owner-ask-text');
    expect(area.dataset.askText).toBe('0');
    expect(area.getAttribute('aria-label')).toBe('Текст');
    expect(area.rows).toBe(2);
    expect(row.querySelector('textarea.owner-ask-comment')).toBeNull();
  });

  test('yes/no offers Да and Нет as radio choices; many gives checkboxes and the multi note', () => {
    const box = mount(OwnerAsk.formAsks([items[1], items[2]]));
    const labels = [...box.querySelectorAll('.owner-ask-option span')].map((node) => node.textContent);
    expect(labels).toEqual(['x', 'y', 'Да', 'Нет']);
    expect(box.querySelector('input[data-ask-index="0"]').type).toBe('checkbox');
    expect(box.querySelector('input[data-ask-index="1"]').type).toBe('radio');
    expect(box.querySelector('.owner-ask-multi')).not.toBeNull();
  });

  test('answersOf: selected labels, trimmed text, comment only for questions with options', () => {
    const asks = OwnerAsk.formAsks(items);
    const box = mount(asks);
    pick(box, 'input[data-ask-index="1"][data-choice-index="0"]');
    pick(box, 'input[data-ask-index="1"][data-choice-index="1"]');
    box.querySelector('textarea[data-ask-text="3"]').value = '  текст  ';
    const answers = OwnerAsk.answersOf(box, asks);
    expect(answers.length).toBe(4);
    expect(answers[1]).toEqual({ selected: ['x', 'y'], text: '', comment: '' });
    expect(answers[3]).toEqual({ selected: [], text: 'текст', comment: '' });
  });

  test('complete: required items must be answered; an optional item may stay empty', () => {
    const asks = OwnerAsk.formAsks(items);
    const box = mount(asks);
    expect(OwnerAsk.complete(box, asks)).toBe(false);
    pick(box, 'input[data-ask-index="0"][data-choice-index="0"]');
    box.querySelector('textarea[data-ask-text="3"]').value = '   ';
    expect(OwnerAsk.complete(box, asks)).toBe(false);
    box.querySelector('textarea[data-ask-text="3"]').value = 'ок';
    expect(OwnerAsk.complete(box, asks)).toBe(true);
  });

  test('formAnswer json: only answered items, typed values (one, many, yesno as boolean, text)', () => {
    const box = mount(OwnerAsk.formAsks(items));
    pick(box, 'input[data-ask-index="0"][data-choice-index="1"]');
    pick(box, 'input[data-ask-index="1"][data-choice-index="0"]');
    pick(box, 'input[data-ask-index="2"][data-choice-index="1"]');
    expect(JSON.parse(OwnerAsk.formAnswer(box, items, 'json'))).toEqual({ a: 'B', b: ['x'], c: false });
    box.querySelector('textarea[data-ask-text="3"]').value = 'ок';
    expect(JSON.parse(OwnerAsk.formAnswer(box, items, 'json'))).toEqual({ a: 'B', b: ['x'], c: false, d: 'ок' });
  });

  test('formAnswer text: lines "question — value", the comment in brackets, unanswered optional items skipped', () => {
    const box = mount(OwnerAsk.formAsks(items));
    pick(box, 'input[data-ask-index="0"][data-choice-index="0"]');
    box.querySelector('textarea[data-ask-comment="0"]').value = 'пояснение';
    pick(box, 'input[data-ask-index="2"][data-choice-index="0"]');
    pick(box, 'input[data-ask-index="1"][data-choice-index="0"]');
    pick(box, 'input[data-ask-index="1"][data-choice-index="1"]');
    box.querySelector('textarea[data-ask-text="3"]').value = 'ок';
    expect(OwnerAsk.formAnswer(box, items, 'text')).toBe(
      'Вариант — A (комментарий: пояснение)\nНесколько — x; y\nДа или нет? — Да\nТекст — ок'
    );
  });

  test('formAnswer text skips an optional item with nothing picked', () => {
    const box = mount(OwnerAsk.formAsks(items));
    box.querySelector('textarea[data-ask-text="3"]').value = 'ок';
    expect(OwnerAsk.formAnswer(box, items, 'text')).toBe('Текст — ок');
  });
});

describe('Owner ask: the render without type is unchanged', () => {
  test('plain questions keep radio choices, a comment field and the collected answer', () => {
    const asks = [{ question: 'Вопрос', options: ['A', 'B'] }, { question: 'Решите' }];
    const box = mount(asks);
    expect(box.querySelector('legend').textContent).toBe('Вопрос');
    expect(box.querySelectorAll('fieldset.owner-ask-item')[0].querySelectorAll('input[type="radio"]').length).toBe(2);
    expect(box.querySelector('textarea.owner-ask-comment').placeholder).toBe('Комментарий (необязательно)');
    expect(box.querySelector('textarea[data-ask-text]')).toBeNull();
    expect(box.querySelectorAll('fieldset.owner-ask-item')[0].dataset.required).toBeUndefined();
    expect(box.querySelectorAll('fieldset.owner-ask-item')[1].querySelector('input').type).toBe('checkbox');
    pick(box, 'input[data-ask-index="0"][data-choice-index="1"]');
    expect(OwnerAsk.collect(box, asks)[0].answer).toBe('B');
  });
});
