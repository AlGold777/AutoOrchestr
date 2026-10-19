/** @jest-environment jsdom */
// End to end, on the real results.js page: an answer's structure (headings, lists, code, tables) must
// reach the card and the exports, whatever order the messages arrive in and whether the adapter sent
// html, only a markdown copy, or only flat text first.
const fs = require('fs');
const path = require('path');
const H = require('./helpers/results-page-harness');

const R = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const fixtureHtml = (name) => JSON.parse(R(`tests/fixtures/live-answer-skeletons/${name}.json`)).capture.html;
const lorem = (n) => { const w = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do '; let s = ''; while (s.length < n) s += w; return s.slice(0, n).trim() || 'x'; };
const fill = (html) => html.replace(/⟦TEXT:(\d+)⟧/g, (_, n) => lorem(Number(n)));

const send = (message) => chrome.runtime.onMessage.addListener.mock.calls.forEach(([listener]) => listener(message, {}, jest.fn()));
let counter = 0;

beforeAll(async () => {
  H.renderDebateDom();
  document.body.classList.add('pipeline-page');
  await H.loadResultsScript();
  window.eval(R('content-scripts/answer-structure.js'));
});

beforeEach(() => {
  chrome.runtime.sendMessage.mockImplementation((message, callback) => { if (typeof callback === 'function') callback({ status: 'ok' }); });
  document.getElementById('debate-session-clear-btn').click();
});

// What the page really holds for an answer: its rich html and the flat text each path derives from it.
function answerOf(fixture) {
  const holder = document.createElement('div');
  holder.innerHTML = fill(fixtureHtml(fixture));
  document.body.appendChild(holder);
  const node = holder.firstElementChild;
  const html = node.innerHTML;
  const flat = window.AnswerStructure.linearizeText(node);
  holder.remove();
  return { html, flat, structure: { h: (html.match(/<h[1-6]\b/g) || []).length, li: (html.match(/<li\b/g) || []).length } };
}
const cardOf = (model) => document.querySelector(`.debate-model-card[data-llm-name="${model}"]`);
const shape = (card) => {
  const out = card.querySelector('.debate-model-card-output');
  return { h: out.querySelectorAll('h1,h2,h3,h4,h5,h6').length, li: out.querySelectorAll('li').length, p: out.querySelectorAll('p').length, out };
};
const finalMessage = (model, request, fields) => ({
  type: 'LLM_PARTIAL_RESPONSE', llmName: model, transportRequestId: request,
  metadata: { status: 'SUCCESS', terminal: true }, ...fields
});

const CASES = [['GPT', 'chatgpt'], ['Le Chat', 'lechat']];

describe.each(CASES)('%s: structure reaches the card', (model, fixture) => {
  let answer;
  beforeAll(() => { answer = answerOf(fixture); });
  const request = () => `rq-${model}-${(counter += 1)}`;

  test('ordinary completion: streamed flat text, then the final with html', () => {
    const rq = request();
    send({ type: 'LLM_PARTIAL_RESPONSE', llmName: model, answer: answer.flat.slice(0, 300), answerHtml: '', transportRequestId: rq, metadata: { status: 'GENERATING' } });
    send(finalMessage(model, rq, { answer: answer.flat, answerHtml: answer.html }));
    const s = shape(cardOf(model));
    expect(s.h).toBeGreaterThanOrEqual(answer.structure.h - 1);
    expect(s.li).toBeGreaterThan(answer.structure.li / 2);
    expect(s.p).toBeGreaterThan(1);
  });

  test('flat final first (this was the bug), then Get it brings the html: the card is upgraded in place', () => {
    const rq = request();
    send(finalMessage(model, rq, { answer: answer.flat, answerHtml: '' }));
    expect(shape(cardOf(model)).h).toBe(0);
    send(finalMessage(model, rq, { answer: answer.flat, answerHtml: answer.html }));
    send({ type: 'MANUAL_PING_RESULT', llmName: model, status: 'success', answer: answer.flat, answerHtml: answer.html, transportRequestId: rq });
    expect(document.querySelectorAll(`.debate-model-card[data-llm-name="${model}"]`)).toHaveLength(1);
    const s = shape(cardOf(model));
    expect(s.h).toBeGreaterThanOrEqual(answer.structure.h - 1);
    expect(s.li).toBeGreaterThan(answer.structure.li / 2);
    expect(cardOf(model).querySelector('.post-terminal-badge')).toBeNull();
  });

  test('the same, when the later text differs slightly (page labels) — still one structured card', () => {
    const rq = request();
    send(finalMessage(model, rq, { answer: `${answer.flat} Copy`, answerHtml: '' }));
    send(finalMessage(model, rq, { answer: answer.flat, answerHtml: answer.html }));
    expect(shape(cardOf(model)).h).toBeGreaterThanOrEqual(answer.structure.h - 1);
  });

  test('rich first, flat later: the structure is kept', () => {
    const rq = request();
    send(finalMessage(model, rq, { answer: answer.flat, answerHtml: answer.html }));
    send(finalMessage(model, rq, { answer: answer.flat, answerHtml: '' }));
    expect(shape(cardOf(model)).h).toBeGreaterThanOrEqual(answer.structure.h - 1);
  });

  test('the flat text has page labels the html lacks: that is not "truncated html"', () => {
    const rq = request();
    const labelled = answer.flat.replace(/(\S+\s+){40}/, (m) => `${m}Copy code Double-click or use to zoom Copy code Double-click or use to zoom `);
    send(finalMessage(model, rq, { answer: labelled, answerHtml: answer.html }));
    expect(shape(cardOf(model)).h).toBeGreaterThanOrEqual(answer.structure.h - 1);
  });

  test('no html at all, but a markdown copy: rendered as structure, with the "html отсутствует" marker', () => {
    const rq = request();
    const report = { version: 1, found: {}, copied: {}, placeholders: [], mismatches: [], flags: {}, complete: true };
    send(finalMessage(model, rq, {
      answer: 'Title Item one Item two code', answerHtml: '',
      answerMarkdown: '## Title\n\n- Item one\n- Item two\n\n```js\nx = 1\n```\n\n| a | b |\n|---|--:|\n| 1 | 2 |',
      copyReport: report
    }));
    const card = cardOf(model);
    const out = card.querySelector('.debate-model-card-output');
    expect(out.querySelector('h2').textContent).toBe('Title');
    expect(out.querySelectorAll('li')).toHaveLength(2);
    expect(out.querySelector('pre code').textContent).toBe('x = 1');
    expect(out.querySelector('table th').textContent).toBe('a');
    expect(card.querySelector('.debate-copy-incomplete').title).toContain('html');
  });

  test('exports contain what the card shows', () => {
    const rq = request();
    send(finalMessage(model, rq, { answer: answer.flat, answerHtml: '' }));
    send(finalMessage(model, rq, { answer: answer.flat, answerHtml: answer.html }));
    const feed = document.getElementById('debate-model-cards');
    const sessionId = cardOf(model).dataset.sessionId;
    const doc = window.DebateExport.buildFeedDocument(feed, sessionId, 'T', {}, '');
    expect(doc).toMatch(/<h[1-6]\b/);
    expect(doc).toContain('<li');
    expect(window.DebateExport.collectFeedHtml(feed, sessionId)).toContain('<li');
  });
});

describe.each([['Qwen', 'qwen'], ['DeepSeek', 'deepseek'], ['Perplexity', 'perplexity']])('%s: no regression', (model, fixture) => {
  let answer;
  beforeAll(() => { answer = answerOf(fixture); });
  test('rich html, and flat-then-rich, both give a structured card', () => {
    send(finalMessage(model, `rq-${model}-a`, { answer: answer.flat, answerHtml: answer.html }));
    const first = shape(cardOf(model));
    expect(first.h + first.li).toBeGreaterThan(0);
    document.getElementById('debate-session-clear-btn').click();
    send(finalMessage(model, `rq-${model}-b`, { answer: answer.flat, answerHtml: '' }));
    send(finalMessage(model, `rq-${model}-b`, { answer: answer.flat, answerHtml: answer.html }));
    const second = shape(cardOf(model));
    expect(second.h).toBe(first.h);
    expect(second.li).toBe(first.li);
  });
});
