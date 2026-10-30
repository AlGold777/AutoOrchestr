/** @jest-environment jsdom */
// M-16, second stage (2026-10-31): the background and the content script read the new ChatGPT markup too.
// Compressed fixture: a reasoning line (no token) and a final block with the delivery token, in the last turn.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const ORCH = read('background/job-orchestrator.js');
const DISPATCH = read('background/dispatch-coordinator.js');
const CONTENT = read('content-scripts/content-chatgpt.js');

const sliceFunction = (src, name) => {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`no function ${name}`);
  const open = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced');
};

const extractor = new Function(`${sliceFunction(ORCH, 'extractLatestAssistantSnapshotInPage')}; return extractLatestAssistantSnapshotInPage;`)();

// The background reads the GPT entry of the selector registry (selectors/chatgpt.config.js).
const loadGptConfig = () => {
  window.eval(read('selectors/chatgpt.config.js'));
  return window.SelectorConfigRegistry.GPT.newMarkup;
};

const REASONING = 'Перепишу инструкцию целиком с явными критериями приёмки, сверю термины с исходным заданием и уберу повторы между разделами, '
  + 'чтобы ответ можно было проверить по пунктам без дополнительных уточнений от пользователя.';
const FINAL = 'Инструкция v2: цели, критерии приёмки по пунктам и порядок проверки.\nОбработка заняла 1m 6s\n[[AO-p9ymcr]]';
const OLD_ANSWER = 'Предыдущая тема: свод по другой задаче, длинный текст для проверки.\n[[AO-old111]]';
const USER_PROMPT = 'Напиши инструкцию v2 для проверки. Заверши ответ строкой [[AO-p9ymcr]]';

const block = (text, id) => `<div class="DilRenderer" data-dil-message-id="${id}"><div class="MarkdownRoot" `
  + `data-markdown-text-style="assistant-message" data-chatgpt-copy-reference="1"><p>${text}</p></div></div>`;
const turn = (key, state, inner) => `<div data-turn-key="${key}"><div data-talvt-turn-state="${state}">${inner}</div></div>`;

const run = (newMarkup) => extractor('GPT', 20, { enrich: false, gptNewMarkup: newMarkup });

const newMarkup = loadGptConfig();

describe('ChatGPT new markup in the background (M-16, stage 2)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('the GPT registry entry carries the new markup values', () => {
    expect(newMarkup).toEqual({
      turnSelector: 'div[data-turn-key]',
      turnStateSelector: '[data-talvt-turn-state]',
      completeState: 'complete',
      answerSelector: 'div[data-markdown-text-style="assistant-message"]'
    });
  });

  test('a complete last turn gives the final block with the token, not the reasoning line', () => {
    document.body.innerHTML = `<main>${turn('t1', 'complete', block(OLD_ANSWER, 'a0'))}`
      + `${turn('t2', 'complete', block(REASONING, 'a1') + block(FINAL, 'a2'))}</main>`;
    const result = run(newMarkup);
    expect(result.ok).toBe(true);
    expect(result.text).toContain('[[AO-p9ymcr]]');
    expect(result.text).not.toContain('Перепишу');
    expect(result.text).not.toContain('[[AO-old111]]');
  });

  test('a generating last turn with only the reasoning line has no answer yet', () => {
    document.body.innerHTML = `<main>${turn('t1', 'complete', block(OLD_ANSWER, 'a0'))}`
      + `${turn('t2', 'generating', block(REASONING, 'a1'))}</main>`;
    const result = run(newMarkup);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('gpt_turn_generating');
  });

  test('a generating turn whose final block with the token is already written gives that block', () => {
    document.body.innerHTML = `<main>${turn('t2', 'generating', block(REASONING, 'a1') + block(FINAL, 'a2'))}</main>`;
    const result = run(newMarkup);
    expect(result.ok).toBe(true);
    expect(result.text).toContain('[[AO-p9ymcr]]');
  });

  test('the answer is taken from the last turn, not from an earlier turn that also has a token', () => {
    document.body.innerHTML = `<main>${turn('t1', 'complete', block(OLD_ANSWER, 'a0'))}`
      + `${turn('t2', 'complete', block(REASONING, 'a1'))}</main>`;
    const result = run(newMarkup);
    expect(result.text).not.toContain('[[AO-old111]]');
  });

  test('without the new markup the old extraction path is unchanged', () => {
    document.body.innerHTML = '<main><div data-message-author-role="assistant"><div class="markdown">'
      + '<p>Старый ответ, достаточно длинный для проверки, и метка [[AO-old111]] в конце.</p></div></div></main>';
    const result = run(null);
    expect(result.ok).toBe(true);
    expect(result.text).toContain('[[AO-old111]]');
  });
});

describe('own prompt turn probe in the new markup (M-16, stage 2)', () => {
  const probeSource = DISPATCH.slice(DISPATCH.indexOf('const OWN_PROMPT_TURN_PROBE = '),
    DISPATCH.indexOf('\n};', DISPATCH.indexOf('const OWN_PROMPT_TURN_PROBE = ')) + 3);
  const probe = vm.runInNewContext(`(${probeSource.replace(/^const OWN_PROMPT_TURN_PROBE = /, '').replace(/;\s*$/, '')})`, { document });
  const tag = '[[AO-p9ymcr]]';

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('a user turn without an answer block, carrying the tag, is the own prompt turn', () => {
    document.body.innerHTML = `<main>${turn('u1', 'complete', `<div>${USER_PROMPT}</div>`)}</main>`;
    expect(probe(tag, newMarkup)).toBe(true);
  });

  test('an answer turn that only repeats the tag is not the own prompt turn', () => {
    document.body.innerHTML = `<main>${turn('t2', 'complete', block(FINAL, 'a2'))}</main>`;
    expect(probe(tag, newMarkup)).toBe(false);
  });

  test('without the GPT config the new markup is not read (other providers keep the old probe)', () => {
    document.body.innerHTML = `<main>${turn('u1', 'complete', `<div>${USER_PROMPT}</div>`)}</main>`;
    expect(probe(tag, null)).toBe(false);
  });
});

describe('content script scope to the last GPT turn (M-16, stage 2)', () => {
  const helperSource = CONTENT.slice(CONTENT.indexOf('  const scopeToLastGptTurn = '), CONTENT.indexOf('  const buildInlineHtml = '));

  test('the helper keeps only the nodes of the last turn that holds an answer', () => {
    window.eval(read('content-scripts/answer-pipeline-selectors.js'));
    window.eval(read('content-scripts/turn-resolver.js'));
    document.body.innerHTML = `<main>${turn('t1', 'complete', block(OLD_ANSWER, 'a0'))}`
      + `${turn('t2', 'complete', block(REASONING, 'a1') + block(FINAL, 'a2'))}</main>`;
    const ctx = vm.createContext({ document, window, Node });
    const scope = vm.runInContext(`${helperSource}\nscopeToLastGptTurn`, ctx);
    const nodes = Array.from(document.querySelectorAll('div[data-markdown-text-style="assistant-message"]'));
    const kept = scope(nodes);
    expect(kept).toHaveLength(2);
    expect(kept.every((node) => node.closest('div[data-turn-key]').getAttribute('data-turn-key') === 't2')).toBe(true);
  });

  test('without the resolver the nodes stay as they are', () => {
    delete window.TurnResolver;
    document.body.innerHTML = `<main>${turn('t1', 'complete', block(OLD_ANSWER, 'a0'))}</main>`;
    const ctx = vm.createContext({ document, window: {}, Node });
    const scope = vm.runInContext(`${helperSource}\nscopeToLastGptTurn`, ctx);
    const nodes = Array.from(document.querySelectorAll('div[data-markdown-text-style="assistant-message"]'));
    expect(scope(nodes)).toBe(nodes);
  });
});
