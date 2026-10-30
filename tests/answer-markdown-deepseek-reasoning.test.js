/** @jest-environment jsdom */
// DeepSeek (live structure 2026-10-19): one virtual-list item holds TWO messages (the user's prompt and the assistant's);
// the assistant message holds the reasoning block (div._hash > div.ds-think-content > div.ds-markdown) AND the answer
// (div.ds-markdown.ds-assistant-message-main-content). Neither the reasoning nor the prompt may reach the answer.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const sliceFunction = (src, name) => {
  const start = src.indexOf(`function ${name}(`);
  const open = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced');
};
const extractor = new Function(`${sliceFunction(read('background/job-orchestrator.js'), 'extractLatestAssistantSnapshotInPage')}; return extractLatestAssistantSnapshotInPage;`)();

const para = (tag, n) => `<p>${(`${tag} `).repeat(n)}</p>`;
const page = ({ answer = para('ANSWERWORD', 200), reasoning = para('THINKWORD', 150), prompt = para('PROMPTWORD', 150) } = {}) => `
  <div class="ds-scroll-area"><div class="ds-virtual-list"><div class="ds-virtual-list-item">
    <div class="ds-message d29f3d7d"><div class="fbb737a4">${prompt}</div></div>
    <div class="ds-message">
      <div class="_74c0879"><div class="ds-think-content"><div class="ds-markdown">${reasoning}</div></div></div>
      <div class="ds-markdown ds-assistant-message-main-content">${answer}</div>
    </div>
  </div></div></div>`;

const loadAll = () => {
  ['AnswerMarkdown', 'AnswerMarkdownBlocks', 'AnswerMarkdownExtras', 'AnswerMarkdownProviders', 'AnswerHtmlBuilder', 'ContentUtils', 'AnswerStructure']
    .forEach((k) => { delete window[k]; });
  window.chrome = window.chrome || { runtime: { id: 'x', sendMessage: jest.fn() } };
  ['content-scripts/answer-structure.js', 'shared/answer-markdown.js', 'shared/answer-markdown-blocks.js', 'shared/answer-markdown-extras.js',
    'shared/answer-markdown-providers.js', 'content-scripts/answer-html-builder.js', 'content-scripts/content-utils.js'].forEach((f) => window.eval(read(f)));
};
beforeEach(loadAll);

const expectOnlyAnswer = (out) => {
  expect(out.ok).toBe(true);
  expect(out.text).toContain('ANSWERWORD');
  expect(out.text).not.toContain('THINKWORD');
  expect(out.text).not.toContain('PROMPTWORD');
  expect(out.html).not.toContain('THINKWORD');
  expect(out.html).not.toContain('PROMPTWORD');
};

describe.each([['long answer', para('ANSWERWORD', 400)], ['short answer (428 chars)', `<p>${'ANSWERWORD '.repeat(38)}</p>`]])('%s', (name, answer) => {
  test('in-page extractor: only the answer', () => {
    document.body.innerHTML = page({ answer });
    const out = extractor('DeepSeek', 80, {});
    expectOnlyAnswer(out);
    expect(out.answerMarkdown).not.toMatch(/THINKWORD|PROMPTWORD/);
  });
  test('late snapshot: only the answer', () => {
    document.body.innerHTML = page({ answer });
    const out = window.ContentUtils.collectLateSnapshotCandidate('DeepSeek', 80, { withMarkdown: true });
    expectOnlyAnswer(out);
    expect(out.answerMarkdown).not.toMatch(/THINKWORD|PROMPTWORD/);
  });
});

describe('the pieces', () => {
  test('without the explicit marker the reasoning .ds-markdown is still not a candidate', () => {
    document.body.innerHTML = page().replace(' ds-assistant-message-main-content', '');
    const out = extractor('DeepSeek', 80, {});
    expectOnlyAnswer(out);
  });

  test('a message node widened to the whole assistant message drops the reasoning from html and markdown', () => {
    document.body.innerHTML = page();
    const message = document.querySelectorAll('.ds-message')[1];
    const html = window.AnswerHtmlBuilder.build(message, { includeRoot: false, provider: 'DeepSeek' });
    expect(html).toContain('ANSWERWORD');
    expect(html).not.toContain('THINKWORD');
    const md = window.AnswerMarkdown.convert(message, { provider: 'DeepSeek' }).markdown;
    expect(md).toContain('ANSWERWORD');
    expect(md).not.toContain('THINKWORD');
  });

  test('AnswerStructure.isIgnored knows ds-think-content', () => {
    document.body.innerHTML = page();
    expect(window.AnswerStructure.isIgnored(document.querySelector('.ds-think-content'))).toBe(true);
    expect(window.AnswerStructure.isIgnored(document.querySelector('.ds-assistant-message-main-content'))).toBe(false);
  });

  test('the item with two sibling messages is a multi-turn container; one message is not', () => {
    document.body.innerHTML = page();
    const b = window.AnswerHtmlBuilder;
    expect(b.hasMessageTwins(document.querySelector('.ds-virtual-list-item'))).toBe(true);
    expect(b.hasMessageTwins(document.querySelectorAll('.ds-message')[1])).toBe(false);
  });

  test('expandToTurn never lifts an answer above its message into the item holding the prompt', () => {
    document.body.innerHTML = page();
    const answer = document.querySelector('.ds-assistant-message-main-content');
    const turn = window.AnswerHtmlBuilder.expandToTurn(answer, []);
    expect(turn.node.contains(document.querySelector('.fbb737a4'))).toBe(false);
  });

  test('whole-word rule: thinker / reasonable / cotton are not reasoning', () => {
    const b = window.AnswerHtmlBuilder;
    ['thinker', 'reasonable', 'cotton', 'rethink-it'].forEach((cls) => {
      const el = document.createElement('div'); el.className = cls;
      expect(b.isReasoningBlock(el)).toBe(false);
    });
    ['ds-think-content', 'thinking-container', 'thoughtChain', 'reasoning_block', 'cot'].forEach((cls) => {
      const el = document.createElement('div'); el.className = cls;
      expect(b.isReasoningBlock(el)).toBe(true);
    });
  });
});

describe('no live skeleton of any provider is cut by the new rules', () => {
  const dir = path.join(ROOT, 'tests/fixtures/live-answer-skeletons');
  test.each(fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json'))('%s', (file) => {
    const html = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).capture.html;
    const holder = document.createElement('div');
    holder.innerHTML = html;
    document.body.appendChild(holder);
    const b = window.AnswerHtmlBuilder;
    const root = holder.firstElementChild || holder;
    // An answer skeleton is one answer: it is not inside a reasoning block and does not hold several turns of one message family.
    expect(b.insideReasoning(root)).toBe(false);
    expect(b.hasMessageTwins(root)).toBe(false);
    // and no node of it is ignored as reasoning by the structure rules (Gemini: class has-thoughts is a state flag)
    holder.querySelectorAll('*').forEach((el) => {
      expect(b.isReasoningBlock(el) && !/think|thought|reason/.test(el.localName + el.className)).toBe(false);
    });
    holder.remove();
  });
});

test('Gemini: has-thoughts is a state flag, the answer container is not reasoning or ignored', () => {
  document.body.innerHTML = '<structured-content-container class="model-response-text has-thoughts"><p>Ответ</p></structured-content-container><div class="response-footer complete has-thoughts"></div>';
  document.querySelectorAll('*').forEach((el) => {
    expect(window.AnswerHtmlBuilder.isReasoningBlock(el)).toBe(false);
    expect(window.AnswerStructure.isIgnored(el.parentElement && el.localName === 'structured-content-container' ? el : document.createElement('i'))).toBe(false);
  });
  const real = document.createElement('div'); real.className = 'thinking-content has-thoughts';
  expect(window.AnswerHtmlBuilder.isReasoningBlock(real)).toBe(true);
});
