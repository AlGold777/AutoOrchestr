const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const DISPATCH = read('background/dispatch-coordinator.js');
const ORCH = read('background/job-orchestrator.js');

const start = DISPATCH.indexOf('const ANSWER_ENDING_WITH_TAG_PROBE = ');
const source = DISPATCH.slice(start, DISPATCH.indexOf('\n};', start) + 3);
const probe = vm.runInNewContext(`(${source.replace(/^const ANSWER_ENDING_WITH_TAG_PROBE = /, '').replace(/;\s*$/, '')})`, { document });
const ANSWER = 'div[data-markdown-text-style="assistant-message"]';
const tag = '[[AO-g4ar76]]';

const page = (html) => { document.body.innerHTML = html; };

describe('answer ending with the request tag (the proof that the request was sent and answered)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  test('an answer whose last line is the tag proves the request, even when the user turn is folded and has no tag', () => {
    page(`<main><div data-turn-key="t1"><div>Вы сказали: Задача: длинный запрос, показан сложенным</div>
      <div data-markdown-text-style="assistant-message"><p>Итог.</p><p>${tag}</p></div></div></main>`);
    expect(probe(tag, ANSWER)).toBe(true);
  });

  test('provider chrome after the tag is allowed, a long text after it is not', () => {
    page(`<div data-markdown-text-style="assistant-message">Итог ${tag}\nChatGPT может допускать ошибки.</div>`);
    expect(probe(tag, ANSWER)).toBe(true);
    page(`<div data-markdown-text-style="assistant-message">Цитата ${tag} ${'и дальше идёт ещё очень много текста ответа. '.repeat(10)}</div>`);
    expect(probe(tag, ANSWER)).toBe(false);
  });

  test('the tag in the composer or in the user part only is not an answer', () => {
    page(`<main><div contenteditable="true">напиши только метку ${tag}</div>
      <div data-turn-key="t1">Вы сказали: напиши только метку ${tag}</div></main>`);
    expect(probe(tag, ANSWER)).toBe(false);
  });

  test('a tag of another request is not the answer to this one', () => {
    page(`<div data-markdown-text-style="assistant-message">Итог [[AO-zzzzzz]]</div>`);
    expect(probe(tag, ANSWER)).toBe(false);
  });

  test('without an answer selector or tag nothing is proven', () => {
    page(`<div data-markdown-text-style="assistant-message">Итог ${tag}</div>`);
    expect(probe(tag, '')).toBe(false);
    expect(probe('', ANSWER)).toBe(false);
  });

  test('the repeat of a Basic request takes this proof next to the own-turn probe, for GPT only', () => {
    expect(ORCH).toMatch(/pageHoldsOwnPromptTurn\(tabId, prompt, llmName\) \|\| await pageHoldsAnswerEndingWithTag\(tabId, prompt, llmName\)/);
    expect(DISPATCH).toMatch(/toLowerCase\(\) === 'gpt' \? \(self\.SelectorConfigRegistry\?\.GPT\?\.newMarkup\?\.answerSelector/);
  });
});
