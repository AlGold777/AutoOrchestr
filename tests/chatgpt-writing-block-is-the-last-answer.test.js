/** @jest-environment jsdom */
// ChatGPT (live, 2026-10-28): the answer of a turn can be a writing block ("Текст"): a document widget with a contenteditable
// editor inside the assistant markdown node. That editor is the answer itself, not the page composer. Treating it as page
// chrome dropped the newest answer, so Get It delivered the answer of an earlier turn.
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

const OLD = 'Claude GPT DeepSeek and some more words to pass the minimum length [[AO-old]]';
const NEWEST = 'LATESTBODY '.repeat(60);
const turn = (id, inner) => `<div data-content-search-turn-key="fallback-turn-${id}"><div class="group flex flex-col">
  <div data-markdown-text-style="assistant-message" dir="auto">${inner}</div></div></div>`;
const writingBlock = (body) => `<div data-client-defined-widget="writing_block"><div data-oai-writing-block-surface="" data-testid="chatgpt-writing-block">
  <header><span>Текст</span></header><div contenteditable="true"><p>${body}</p></div></div></div><p>[[AO-new]]</p>`;

beforeEach(() => {
  ['AnswerMarkdown', 'AnswerHtmlBuilder', 'ContentUtils', 'AnswerStructure'].forEach((k) => { delete window[k]; });
  window.chrome = window.chrome || { runtime: { id: 'x', sendMessage: jest.fn() } };
  ['content-scripts/answer-structure.js', 'content-scripts/answer-html-builder.js', 'content-scripts/content-utils.js'].forEach((f) => window.eval(read(f)));
  document.body.innerHTML = `<main>${turn(1, `<p>${OLD}</p>`)}<div data-message-author-role="user"><p>next question</p></div>${turn(2, writingBlock(NEWEST))}
    <div contenteditable="true" id="prompt-textarea"><p></p></div></main>`;
});

test('Get It takes the writing-block answer of the last turn, not the answer of an earlier one', () => {
  const out = extractor('GPT', 20, { enrich: false, manualLatestRecovery: true, strategyId: 'last_visible', strategyIndex: 1 });
  expect(out.ok).toBe(true);
  expect(out.text).toContain('LATESTBODY');
  expect(out.text).toContain('[[AO-new]]');
  expect(out.text).not.toContain('AO-old');
});

test('late snapshot takes the same answer', () => {
  const out = window.ContentUtils.collectLateSnapshotCandidate('GPT', 20, {});
  expect(out.ok).toBe(true);
  expect(out.text).toContain('LATESTBODY');
  expect(out.text).not.toContain('AO-old');
});

test('the page composer is still page chrome, the writing-block editor is not', () => {
  const builder = window.AnswerHtmlBuilder;
  expect(builder.containsPageChrome(document.querySelector('[data-oai-writing-block-surface]'))).toBe(false);
  expect(builder.containsPageChrome(document.querySelector('main'))).toBe(true);
});
