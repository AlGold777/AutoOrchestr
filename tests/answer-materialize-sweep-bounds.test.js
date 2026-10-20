/** @jest-environment jsdom */
// The sweep walks up to the start of the LAST answer, not to the start of the page: the resolver finds that answer for every provider's
// markup (50 earlier turns above it), the walk is bounded by the answer's height, and an unknown answer is a short, reported walk.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const FAST = { settleMs: 5, settleCapMs: 25, placeholderWaitMs: 40, activeTailMs: 10 };
let Sweep;
const load = () => {
  ['AnswerMaterializeSweep', 'AnswerHtmlBuilder', 'AnswerPipelineSelectors', 'AnswerMarkdown', 'AnswerMarkdownBlocks', 'AnswerMarkdownExtras', 'AnswerMarkdownProviders']
    .forEach((k) => { delete window[k]; });
  delete globalThis.__AO_SWEEP_ACTIVE; delete globalThis.__AO_SWEEP_COUNT;
  window.chrome = window.chrome || { runtime: { id: 'x', sendMessage: jest.fn() } };
  ['shared/answer-markdown.js', 'shared/answer-markdown-blocks.js', 'shared/answer-markdown-extras.js', 'shared/answer-markdown-providers.js',
    'content-scripts/answer-html-builder.js', 'content-scripts/answer-pipeline-selectors.js', 'shared/answer-materialize-sweep.js'].forEach((f) => window.eval(read(f)));
  Sweep = window.AnswerMaterializeSweep;
};
beforeEach(load);

const para = (word, n = 30) => `<p>${(`${word} `).repeat(n)}</p>`;
// Per provider: [question markup, answer markup] of one turn; the last answer carries id="last".
const MARKUP = {
  Claude: (i, last) => [`<div data-testid="user-message"><p>Q${i} question text</p></div>`, `<div data-is-streaming="false"><div class="font-claude-response"${last ? ' id="last"' : ''}>${para(`A${i}`)}</div></div>`],
  Grok: (i, last) => [`<div data-testid="user-message"><p>Q${i} question text</p></div>`, `<div data-testid="assistant-message"${last ? ' id="last"' : ''}>${para(`A${i}`)}</div>`],
  DeepSeek: (i, last) => [`<div class="ds-message d29f3d7d"><div>${para(`Q${i}`)}</div></div>`,
    `<div class="ds-message"><div class="_74c0879"><div class="ds-think-content"><div class="ds-markdown">${para(`T${i}`)}</div></div></div><div class="ds-markdown ds-assistant-message-main-content"${last ? ' id="last"' : ''}>${para(`A${i}`)}</div></div>`],
  Qwen: (i, last) => [`<div class="qwen-chat-message qwen-chat-message-user"><p>Q${i} question text</p></div>`, `<div class="qwen-chat-message qwen-chat-message-assistant"${last ? ' id="last"' : ''}><div class="qwen-markdown">${para(`A${i}`)}</div></div>`],
  Gemini: (i, last) => [`<user-query><p>Q${i} question text</p></user-query>`, `<model-response${last ? ' id="last"' : ''}>${para(`A${i}`)}</model-response>`],
  GPT: (i, last) => [`<div data-message-author-role="user"><p>Q${i} question text</p></div>`, `<div data-message-author-role="assistant"${last ? ' id="last"' : ''}>${para(`A${i}`)}</div>`],
  'Le Chat': (i, last) => [`<div data-message-author-role="user"><p>Q${i} question text</p></div>`, `<div data-message-author-role="assistant"${last ? ' id="last"' : ''}>${para(`A${i}`)}</div>`]
};
const longPage = (model) => {
  const turns = [];
  for (let i = 0; i < 51; i += 1) turns.push(...MARKUP[model](i, i === 50));
  document.body.innerHTML = `<main><div id="scroller">${turns.join('')}</div></main>`;
};

describe('the resolver finds the LAST answer', () => {
  test.each(Object.keys(MARKUP))('%s', (model) => {
    longPage(model);
    const found = Sweep.findAnswerElement(document, model);
    expect(found).not.toBeNull();
    const last = document.getElementById('last');
    expect(found === last || found.contains(last)).toBe(true);
    // not an earlier turn, not the user's message, not the reasoning block
    expect(found.textContent).toContain('A50');
    expect(found.textContent).not.toContain('A49');
    expect(found.textContent).not.toMatch(/Q50 question|T50/);
  });

  test('Perplexity: the blocks of the last turn are one answer, not the earlier turns', () => {
    const turns = [];
    for (let i = 0; i < 51; i += 1) {
      turns.push(`<h1>Q${i} question</h1><div class="turn" ${i === 50 ? 'id="last"' : ''}><div id="markdown-content-${i}a" class="prose">${para(`A${i}x`)}</div><div id="markdown-content-${i}b" class="prose">${para(`A${i}y`)}</div></div>`);
    }
    document.body.innerHTML = `<main>${turns.join('')}</main>`;
    const found = Sweep.findAnswerElement(document, 'Perplexity');
    expect(found.textContent).toContain('A50x');
    expect(found.textContent).not.toContain('A49');
    expect(found.textContent).not.toContain('Q50 question');
  });

  test('nothing recognizable: null', () => {
    document.body.innerHTML = '<main><div class="foo"><p>text</p></div></main>';
    expect(Sweep.findAnswerElement(document, 'Qwen')).toBeNull();
  });
});

// A 30 000px conversation viewport (no layout in jsdom: positions are computed from a table).
function mountScroller({ answerTop, answerHeight, recognizable = true }) {
  document.body.innerHTML = `<main><div id="scroller"><div class="filler">older turns</div>${recognizable
    ? '<div data-message-author-role="assistant" id="answer"><p>last answer</p></div>'
    : '<div class="plain" id="answer"><p>last answer</p></div>'}</div></main>`;
  const scroller = document.getElementById('scroller');
  const answer = document.getElementById('answer');
  const max = 30000 - 800;
  let top = max;
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => 30000 });
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 800 });
  Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => top, set: (v) => { top = Math.max(0, Math.min(max, v)); } });
  scroller.style.overflowY = 'auto';
  scroller.getClientRects = () => [{}];
  scroller.getBoundingClientRect = () => ({ top: 0, bottom: 800, left: 0, right: 800, width: 800, height: 800 });
  const reached = [];
  scroller.scrollTo = ({ top: value }) => { top = Math.max(0, Math.min(max, value)); reached.push(top); };
  answer.getBoundingClientRect = () => ({ top: answerTop - top, bottom: answerTop + answerHeight - top, left: 0, right: 800, width: 800, height: answerHeight });
  return { scroller, reached, getTop: () => top, max };
}

describe('the walk is bounded by the answer', () => {
  test('a long answer: stops at its start (answer_top), the way up is not longer than the answer + reserve, position restored', async () => {
    const page = mountScroller({ answerTop: 26000, answerHeight: 3600 });
    const report = await Sweep.run({ doc: document, provider: 'GPT', config: FAST });
    expect(report.answerFound).toBe(true);
    expect(report.answerHeight).toBe(3600);
    expect(report.stoppedBy).toBe('answer_top');
    expect(report.scrolledPx).toBeLessThanOrEqual(3600 + 800 * 0.25 + 800);
    expect(Math.min(...page.reached)).toBeGreaterThanOrEqual(26000 - 800 * 0.25 - 1);   // never above the start by more than the reserve
    expect(report.steps).toBeLessThanOrEqual(Math.ceil(3600 / 480) + 2);
    expect(page.getTop()).toBe(page.max);
  });

  test('an answer shorter than the window: no walk to the page start', async () => {
    const page = mountScroller({ answerTop: 29000, answerHeight: 700 });
    const report = await Sweep.run({ doc: document, provider: 'GPT', config: FAST });
    expect(report.steps).toBeLessThanOrEqual(3);
    expect(Math.min(...page.reached, page.max)).toBeGreaterThan(28000 - 800);
  });

  test('the answer cannot be found: at most 3 steps, reported as answer_start_unknown, not to the page start', async () => {
    const page = mountScroller({ answerTop: 26000, answerHeight: 3600, recognizable: false });
    const report = await Sweep.run({ doc: document, provider: 'Unknown', config: FAST });
    expect(report.answerFound).toBe(false);
    expect(report.steps).toBeLessThanOrEqual(3);
    expect(report.stoppedBy).toBe('unknown_cap');
    expect(report.note).toBe('answer_start_unknown');
    expect(report.scrolledPx).toBeLessThanOrEqual(2 * 800);
    expect(page.getTop()).toBe(page.max);
  });

  test('a caller-tracked block of the last turn is widened to the turn the resolver finds', async () => {
    mountScroller({ answerTop: 26000, answerHeight: 3600 });
    const inner = document.createElement('p'); inner.textContent = 'x';
    document.getElementById('answer').appendChild(inner);
    inner.getBoundingClientRect = () => ({ top: 28000, bottom: 28100, height: 100, left: 0, right: 1, width: 1 });
    const report = await Sweep.run({ doc: document, provider: 'GPT', answerEl: inner, config: FAST });
    expect(report.answerHeight).toBe(3600);
  });
});
