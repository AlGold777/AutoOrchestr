/** @jest-environment jsdom */
// M-12: Gemini answer node appears after Send, but the positional anchor pool stays empty.
// Node identity against the pre-Send snapshot binds the turn; old answers never bind.
const fs = require('fs');
const path = require('path');
const TurnResolver = require('../content-scripts/turn-resolver');

const SELECTOR_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'answer-pipeline-selectors.js'), 'utf8'
);

const answer = (text) => {
  const el = document.createElement('model-response');
  el.innerHTML = `<message-content><p>${text}</p></message-content>`;
  return el;
};
const resolve = (options = {}) => TurnResolver.resolveTurn({
  platform: 'gemini',
  selectors: window.AnswerPipelineSelectors.PLATFORM_SELECTORS.gemini,
  document,
  minimumTextLength: 1,
  ...options
});
const main = () => document.querySelector('main');

beforeAll(() => {
  delete window.AnswerPipelineSelectors;
  window.eval(SELECTOR_SOURCE);
});

beforeEach(() => {
  document.body.innerHTML = '<main></main>';
});

describe('Gemini fresh turn node (turn-resolver preDispatchNodes)', () => {
  test('a node added after Send binds when the candidate count grew', () => {
    const old = answer('Старый ответ');
    main().append(old);
    const fresh = answer('Новый ответ [[AO-abc123]]');
    main().append(fresh);
    const turn = resolve({ anchorAnswerCount: 1, preDispatchNodes: new WeakSet([old]) });
    expect(turn.answerNode).toBe(fresh);
    expect(turn.resolution).toBe('exact');
  });

  test('observed case: anchor 3 and count 3 after Send still binds the new node by identity', () => {
    const a = answer('A');
    const b = answer('B');
    const c = answer('C');
    main().append(a, b, c);
    const baseline = new WeakSet([a, b, c]);
    c.remove();
    const fresh = answer('Новый ответ [[AO-abc123]]');
    main().append(fresh);
    const turn = resolve({ anchorAnswerCount: 3, preDispatchNodes: baseline });
    expect(turn.answerNode).toBe(fresh);
    expect(turn.resolution).toBe('exact');
    expect(turn.reason).toBe('gemini_fresh_turn_node');
    expect(turn.messageRoot).toBe(fresh);
    expect(turn.selectorSource).toBe('primary');
  });

  test('negative: old answers without a new node are not attached to the turn', () => {
    const a = answer('A');
    const b = answer('B');
    const c = answer('C');
    main().append(a, b, c);
    const turn = resolve({ anchorAnswerCount: 3, preDispatchNodes: new WeakSet([a, b, c]) });
    expect(turn.answerNode).toBeNull();
    expect(turn.resolution).toBe('unresolved');
    expect(turn.reason).toBe('answer_node_unresolved');
  });

  test('negative: a pre-Send node whose text was re-rendered is still not this turn', () => {
    const old = answer('Старый ответ');
    main().append(old);
    old.innerHTML = '<message-content><p>Старый ответ переписан</p></message-content>';
    const turn = resolve({ anchorAnswerCount: 1, preDispatchNodes: new WeakSet([old]) });
    expect(turn.answerNode).toBeNull();
  });

  test('without the pre-dispatch snapshot the fresh-node path is off (fails closed)', () => {
    const a = answer('A');
    main().append(a);
    const fresh = answer('Новый ответ');
    main().append(fresh);
    const turn = resolve({ anchorAnswerCount: 2 });
    expect(turn.answerNode).toBeNull();
  });

  test('an empty new response shell is not an answer yet', () => {
    const a = answer('A');
    main().append(a);
    const shell = document.createElement('model-response');
    main().append(shell);
    const turn = resolve({ anchorAnswerCount: 2, preDispatchNodes: new WeakSet([a]) });
    expect(turn.answerNode).toBeNull();
  });

  test('the node carrying the delivery token wins over a later node without it', () => {
    const a = answer('A');
    main().append(a);
    const tokened = answer('Ответ [[AO-111111]]');
    const plain = answer('Промежуточный текст без метки');
    main().append(tokened, plain);
    const turn = resolve({ anchorAnswerCount: 3, preDispatchNodes: new WeakSet([a]) });
    expect(turn.answerNode).toBe(tokened);
    expect(turn.reason).toBe('gemini_fresh_turn_node');
  });
});
