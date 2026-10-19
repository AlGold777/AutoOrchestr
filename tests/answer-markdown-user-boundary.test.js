/** @jest-environment jsdom */
// The user's own message (our prompt) must never be part of a pulled answer, whatever the provider calls it: a turn boundary is
// found by the NAME of the message (data-testid / role attributes / classes with user, human, prompt, query, question as a whole word),
// and an explicit assistant turn element (role=article, data-testid=assistant-message, ...) is the limit of the answer.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const ORCH = read('background/job-orchestrator.js');
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
const extractor = new Function(`${sliceFunction(ORCH, 'extractLatestAssistantSnapshotInPage')}; return extractLatestAssistantSnapshotInPage;`)();
const PROMPT = 'PROMPT-TEXT-OF-THE-USER please write the long analysis';
const ANSWER = 'ANSWER-TEXT of the model, long enough to be an answer.';

function load() {
  ['AnswerHtmlBuilder', 'ContentUtils', 'AnswerMarkdown', 'AnswerMarkdownBlocks', 'AnswerMarkdownExtras', 'AnswerMarkdownProviders', 'AnswerStructure'].forEach((k) => { delete window[k]; });
  window.chrome = { runtime: { id: 'x', sendMessage: jest.fn() } };
  ['content-scripts/answer-structure.js', 'shared/answer-markdown.js', 'shared/answer-markdown-blocks.js', 'shared/answer-markdown-extras.js',
    'shared/answer-markdown-providers.js', 'content-scripts/answer-html-builder.js', 'content-scripts/content-utils.js'].forEach((f) => window.eval(read(f)));
}
beforeEach(load);

const GROK = `<div data-testid="chat-transcript-scroller" role="region"><div class="turns">
  <div id="query-1"><div data-testid="user-message"><div class="markdown"><p>${PROMPT}</p></div></div></div>
  <div id="response-abc"><div data-testid="assistant-message" role="article"><h2 id="turn-heading-a" style="height:1px">Turn</h2><div></div>
    <div><div class="markdown"><p>${ANSWER}</p></div></div><section></section></div></div></div></div>`;

function expectAnswerOnly(out, answerWord = 'ANSWER-TEXT') {
  expect(out.ok).toBe(true);
  expect(out.text).toContain(answerWord);
  expect(out.text).not.toContain('PROMPT-TEXT');
  expect(out.html).not.toContain('PROMPT-TEXT');
  expect(out.answerMarkdown).not.toContain('PROMPT-TEXT');
}

describe('Grok structure (live data)', () => {
  test('the prompt is not part of the pulled answer (extractor)', () => {
    document.body.innerHTML = GROK;
    expectAnswerOnly(extractor('Grok', 10, {}));
  });

  test('the late snapshot candidate (content script) does not take the prompt either', () => {
    document.body.innerHTML = GROK;
    const snapshot = window.ContentUtils.collectLateSnapshotCandidate('Grok', 10);
    expect(snapshot.ok).toBe(true);
    expect(snapshot.text).toContain('ANSWER-TEXT');
    expect(snapshot.text).not.toContain('PROMPT-TEXT');
  });

  test('also when the user message sits after a sibling markdown block of the answer (several blocks)', () => {
    document.body.innerHTML = `<div role="region"><div id="q"><div data-testid="user-message"><div class="markdown"><p>${PROMPT}</p></div></div></div>
      <div id="r"><div data-testid="assistant-message" role="article"><div class="markdown"><p>${ANSWER} Part one.</p></div><div class="markdown"><p>Second part of the same answer, long enough.</p></div></div></div></div>`;
    const out = extractor('Grok', 10, {});
    expectAnswerOnly(out);
    expect(out.text).toContain('Second part of the same answer');
  });
});

describe('the name of a user message', () => {
  const mark = (html) => { const host = document.createElement('div'); host.innerHTML = html; return window.AnswerHtmlBuilder.isUserMessage(host.firstElementChild); };
  test.each([
    ['<div data-testid="user-message"></div>'], ['<div data-testid="human-turn"></div>'], ['<div data-message-author-role="user"></div>'],
    ['<div data-role="human"></div>'], ['<div class="chat-user-message"></div>'], ['<div class="human-message"></div>'],
    ['<div data-testid="prompt-text"></div>'], ['<div data-testid="query-bubble"></div>'], ['<div data-testid="question-content"></div>']
  ])('%s is a user message', (html) => { expect(mark(html)).toBe(true); });
  test.each([
    ['<div data-testid="user-avatar"></div>'], ['<div class="username"></div>'], ['<div class="user-select-none"></div>'], ['<div data-testid="user-menu"></div>'],
    ['<div data-testid="related-question"></div>'], ['<div data-testid="suggested-questions"></div>'], ['<div class="select-none flex"></div>'],
    ['<div data-testid="assistant-message"></div>'], ['<div class="prose"></div>'], ['<div data-testid="prompt-input-toolbar"></div>']
  ])('%s is not', (html) => { expect(mark(html)).toBe(false); });
});

describe('no false boundary inside the live answer skeletons of all providers', () => {
  const dir = path.join(ROOT, 'tests/fixtures/live-answer-skeletons');
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json') && name !== 'index.json');
  test.each(files)('%s: no element of the assistant turn is taken for a user message', (file) => {
    const html = JSON.parse(read(`tests/fixtures/live-answer-skeletons/${file}`)).capture.html;
    document.body.innerHTML = `<div id="root">${html}</div>`;
    expect(window.AnswerHtmlBuilder.containsUserMessage(document.getElementById('root'))).toBe(false);
  });
});

describe('the explicit assistant turn is the limit of the answer', () => {
  test('peers outside the assistant turn are not merged in, and the node never widens above it', () => {
    document.body.innerHTML = `<div id="all"><div id="mine"><div class="markdown" id="m1"><p>one</p></div></div>
      <div id="turn" role="article"><div class="markdown" id="a1"><p>a</p></div><div><div class="markdown" id="a2"><p>b</p></div></div></div></div>`;
    const turn = window.AnswerHtmlBuilder.expandToTurn(document.getElementById('a1'), [document.getElementById('m1'), document.getElementById('a2')]);
    expect(turn.node.id).toBe('turn');
    expect(turn.node.contains(document.getElementById('m1'))).toBe(false);
  });
});

describe.each([
  ['Claude', 'Claude', '<div data-testid="user-message"><div class="font-user-message"><p>PROMPT-TEXT q</p></div></div><div data-is-response="true"><div class="standard-markdown"><p>ANSWER-TEXT claude answer, long enough to be an answer.</p></div></div>'],
  ['GPT', 'GPT', '<div data-message-author-role="user"><div class="whitespace-pre-wrap">PROMPT-TEXT q</div></div><div data-message-author-role="assistant"><div class="markdown prose"><p>ANSWER-TEXT gpt answer, long enough to be an answer.</p></div></div>'],
  ['Perplexity', 'Perplexity', '<div class="query"><h1>PROMPT-TEXT q</h1></div><div id="turn"><div class="prose"><p>ANSWER-TEXT perplexity part one, long enough here.</p></div><div class="prose"><p>Second block of perplexity, long enough here.</p></div></div>'],
  ['Qwen', 'Qwen', '<div class="qwen-chat-message qwen-chat-message-user"><p>PROMPT-TEXT q</p></div><div class="qwen-chat-message qwen-chat-message-assistant"><div class="response-message-content"><div class="custom-qwen-markdown"><div class="qwen-markdown qwen-markdown-loose"><p>ANSWER-TEXT qwen answer, long enough to be an answer.</p></div></div></div></div>'],
  ['DeepSeek', 'DeepSeek', '<div class="message-item" data-role="user"><p>PROMPT-TEXT q</p></div><div class="message-item" data-role="assistant"><div class="markdown-body"><p>ANSWER-TEXT deepseek answer, long enough to be an answer.</p></div></div>'],
  ['Gemini', 'Gemini', '<user-query><p>PROMPT-TEXT q</p></user-query><model-response><div class="markdown"><p>ANSWER-TEXT gemini answer, long enough to be an answer.</p></div></model-response>'],
  ['Le Chat', 'Le Chat', '<div data-message-author-role="user"><p>PROMPT-TEXT q</p></div><div data-message-author-role="assistant"><div class="markdown-container-style"><p>ANSWER-TEXT lechat answer, long enough to be an answer.</p></div></div>'],
  ['Kimi', 'Kimi', '<div class="user-content"><p>PROMPT-TEXT q</p></div><div class="segment-assistant"><div class="markdown"><p>ANSWER-TEXT kimi answer, long enough to be an answer.</p></div></div>'],
  ['Z.ai', 'Z.ai', '<div class="user-message"><p>PROMPT-TEXT q</p></div><div class="chat-assistant markdown-prose"><p>ANSWER-TEXT zai answer, long enough to be an answer.</p></div>']
])('%s: the prompt stays out, the answer is whole', (_, model, inner) => {
  test('extractor', () => {
    document.body.innerHTML = `<main><div id="thread">${inner}</div></main>`;
    const out = extractor(model, 10, {});
    expect(out.ok).toBe(true);
    expect(out.text).toContain('ANSWER-TEXT');
    expect(out.text).not.toContain('PROMPT-TEXT');
    expect(out.html).not.toContain('PROMPT-TEXT');
  });
});
