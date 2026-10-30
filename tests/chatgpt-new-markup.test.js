/** @jest-environment jsdom */
// M-16 (2026-10-30): ChatGPT new markup. No [data-message-author-role]; the answer is
// div[data-markdown-text-style="assistant-message"] inside DilRenderer; the turn is div[data-turn-key]
// with its state in data-talvt-turn-state. Compressed fixture: a reasoning line (195 chars, no token)
// and the final block with the delivery token, both in the last turn.
const fs = require('fs');
const path = require('path');
const TurnResolver = require('../content-scripts/turn-resolver.js');

const REASONING = 'Перепишу инструкцию целиком с явными критериями приёмки, сверю термины с исходным заданием и уберу повторы между разделами, '
  + 'чтобы ответ можно было проверить по пунктам без дополнительных уточнений от пользователя.';
const FINAL = 'Инструкция v2: цели, критерии приёмки по пунктам и порядок проверки.\nОбработка заняла 1m 6s\n[[AO-p9ymcr]]';
const OLD_ANSWER = 'Предыдущая тема: свод.\n[[AO-old111]]';

const block = (text, id) => `<div class="DilRenderer" data-dil-message-id="${id}" data-dil-source-message-id="${id}">`
  + `<div class="MarkdownRoot" data-markdown-text-style="assistant-message" data-chatgpt-copy-reference="1">`
  + `<p>${text}</p></div></div>`;

const turnHtml = (key, state, blocks) => `<div data-turn-key="${key}"><div data-talvt-turn-state="${state}">${blocks}</div></div>`;

const loadSelectors = () => {
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'content-scripts', 'answer-pipeline-selectors.js'), 'utf8'));
  return window.AnswerPipelineSelectors.PLATFORM_SELECTORS.chatgpt;
};

const resolve = (selectors) => TurnResolver.resolveTurn({
  platform: 'chatgpt',
  selectors,
  document,
  anchorAnswerCount: 0,
  minimumTextLength: 1
});

describe('ChatGPT new markup (M-16): last turn and completion state', () => {
  let selectors;

  beforeAll(() => {
    selectors = loadSelectors();
  });

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('the selectors for the new markup live in the chatgpt entry', () => {
    expect(selectors.newMarkup.turnSelector).toBe('div[data-turn-key]');
    expect(selectors.newMarkup.completeState).toBe('complete');
    expect(selectors.newMarkup.answerSelector).toBe('div[data-markdown-text-style="assistant-message"]');
  });

  test('complete turn: the final block with the token is the answer, not the reasoning line', () => {
    document.body.innerHTML = `<main>${turnHtml('t1', 'complete', block(OLD_ANSWER, 'a0'))}`
      + `${turnHtml('t2', 'complete', block(REASONING, 'a1') + block(FINAL, 'a2'))}</main>`;
    const result = resolve(selectors);
    expect(result.chatGptTurnState).toBe('complete');
    expect(result.answerNode.textContent).toContain('[[AO-p9ymcr]]');
    expect(result.answerNode.textContent).not.toContain('Перепишу');
  });

  test('the answer comes from the last turn, not from an earlier turn that also has a token', () => {
    document.body.innerHTML = `<main>${turnHtml('t1', 'complete', block(OLD_ANSWER, 'a0'))}`
      + `${turnHtml('t2', 'complete', block(REASONING, 'a1'))}</main>`;
    const result = resolve(selectors);
    expect(result.answerNode.textContent).not.toContain('[[AO-old111]]');
    expect(result.answerNode.textContent).toContain('Перепишу');
  });

  test('turn still generating, only the reasoning line so far: no answer yet (not the reasoning line)', () => {
    document.body.innerHTML = `<main>${turnHtml('t1', 'complete', block(OLD_ANSWER, 'a0'))}`
      + `${turnHtml('t2', 'generating', block(REASONING, 'a1'))}</main>`;
    const result = resolve(selectors);
    expect(result.chatGptTurnState).toBe('generating');
    expect(result.answerNode).toBeNull();
    expect(result.reason).toBe('answer_node_unresolved');
  });

  test('turn still generating, final block with the token already rendered: the final is the answer', () => {
    document.body.innerHTML = `<main>${turnHtml('t2', 'generating', block(REASONING, 'a1') + block(FINAL, 'a2'))}</main>`;
    const result = resolve(selectors);
    expect(result.answerNode.textContent).toContain('[[AO-p9ymcr]]');
  });

  test('pickChatGptTurn returns the turn state and its generating flag', () => {
    document.body.innerHTML = `<main>${turnHtml('t2', 'complete', block(FINAL, 'a2'))}</main>`;
    const turn = TurnResolver.pickChatGptTurn(TurnResolver.createDeepQuery(document), selectors.newMarkup,
      Array.from(document.querySelectorAll(selectors.newMarkup.answerSelector)));
    expect(turn.state).toBe('complete');
    expect(turn.generating).toBe(false);
  });

  test('old markup (no data-turn-key) is resolved as before', () => {
    document.body.innerHTML = '<main><div data-testid="conversation-turn" data-message-author-role="assistant">Старый ответ [[AO-old111]]</div></main>';
    const result = resolve(selectors);
    expect(result.chatGptTurnState).toBeNull();
    expect(result.answerNode.textContent).toContain('[[AO-old111]]');
  });
});
