/** @jest-environment node */
// L-21: a delivery marker after a progress line («Проверю…») does not complete the answer in the
// dispatch layer either. Same predicate as the delivery layer (answerEndMarkerSeen).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const source = read('background/dispatch-coordinator.js');
const fnSource = source.slice(source.indexOf('function answerHasDeliveryToken'), source.indexOf('// Runs in the provider page'));
const TOKEN = '[[AO-abc123]]';

function load() {
  const context = {
    console,
    jobState: { session: { promptsByModel: { GPT: `Проверь план.\n${TOKEN}` } } }
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(read('shared/answer-proof-normalization.js'), context);
  vm.runInContext(read('shared/answer-content-classifier.js'), context);
  vm.runInContext(fnSource + '\n;this.check = answerHasDeliveryToken;', context);
  return context.check;
}

describe('answerHasDeliveryToken with a progress line', () => {
  const check = load();

  test('a progress line followed by the marker is not a completed answer', () => {
    expect(check('GPT', `Проверю план и риски.\n\n${TOKEN}`)).toBe(false);
  });

  test('a short content answer followed by the marker is completed', () => {
    expect(check('GPT', `Замечаний нет.\n\n${TOKEN}`)).toBe(true);
  });

  test('a long answer that starts like progress is completed', () => {
    const body = `Проверил план подробно. ${'Раздел разбирает риски, сроки и зависимости между этапами. '.repeat(6)}`;
    expect(check('GPT', `${body}\n${TOKEN}`)).toBe(true);
  });

  test('the marker must still be the tail of the text', () => {
    expect(check('GPT', `Замечаний нет.\n${TOKEN}\nЕщё текст после метки, который не относится к ответу и длиннее сорока символов.`)).toBe(false);
  });
});
