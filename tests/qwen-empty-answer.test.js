/** @jest-environment jsdom */
// "ПУСТОЙ ОТВЕТ" (Qwen): an empty result must never be a success and never overwrite a non-empty answer.
// (a) builder html empty, (b) html sanitized away, (c) whole-answer stub, (d) selection failure, (e) exceptions in enrichment.
// Also: the automatic pre-collect visit (tab activation) for an answer that stays empty is limited per dispatch.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./helpers/results-page-harness');

const R = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const ORCH = R('background/job-orchestrator.js');
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

const ANSWER = 'Текст ответа Qwen. '.repeat(30);
const qwenPage = (inner = `<p>${ANSWER}</p>`) => `<div class="qwen-chat-message qwen-chat-message-user"><p>Вопрос пользователя</p></div>
  <div class="qwen-chat-message qwen-chat-message-assistant"><div class="response-message-content"><div class="custom-qwen-markdown"><div class="qwen-markdown qwen-markdown-loose">${inner}</div></div></div></div>`;

const loadAll = () => {
  ['AnswerMarkdown', 'AnswerMarkdownBlocks', 'AnswerMarkdownExtras', 'AnswerMarkdownProviders', 'AnswerHtmlBuilder', 'ContentUtils'].forEach((k) => { delete window[k]; });
  window.chrome = window.chrome || { runtime: { id: 'x', sendMessage: jest.fn() } };
  ['shared/answer-markdown.js', 'shared/answer-markdown-blocks.js', 'shared/answer-markdown-extras.js', 'shared/answer-markdown-providers.js',
    'content-scripts/answer-html-builder.js', 'content-scripts/content-utils.js'].forEach((f) => window.eval(R(f)));
};

describe('collection side: an empty html or a failure is never an empty success', () => {
  let savedChrome;
  beforeEach(() => { savedChrome = window.chrome; window.chrome = undefined; loadAll(); });
  afterEach(() => { window.chrome = savedChrome; });

  test('(a) builder returns an empty html: the plain copy is taken (extractor and late snapshot)', () => {
    document.body.innerHTML = qwenPage();
    window.AnswerHtmlBuilder = { ...window.AnswerHtmlBuilder, build: () => '<div></div>', getLastNotes: () => [] };
    const out = extractor('Qwen', 80, {});
    expect(out.ok).toBe(true);
    expect(out.html).toContain('Текст ответа Qwen');
    expect(JSON.stringify(out.copyReport)).toContain('запасным путём');
    const late = window.ContentUtils.collectLateSnapshotCandidate('Qwen', 80);
    expect(late.ok).toBe(true);
    expect(late.html).toContain('Текст ответа Qwen');
  });

  test('(d) selection failure with nothing on the page is an explicit failure with a reason, not an empty success', () => {
    document.body.innerHTML = '<div class="qwen-chat-message qwen-chat-message-user"><p>Вопрос</p></div>';
    const out = extractor('Qwen', 80, {});
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('no_candidate');
    expect(out.text).toBeUndefined();
  });

  test('(e) exceptions in convert / normalizeCodeBlocks / builder never give empty fields', () => {
    document.body.innerHTML = qwenPage();
    window.AnswerMarkdown = { ...window.AnswerMarkdown, convert: () => { throw new Error('x'); }, normalizeCodeBlocks: () => { throw new Error('x'); } };
    window.AnswerHtmlBuilder = { ...window.AnswerHtmlBuilder, build: () => { throw new Error('x'); } };
    const out = extractor('Qwen', 80, {});
    expect(out.ok).toBe(true);
    expect(out.text.length).toBeGreaterThan(100);
    expect(out.html.length).toBeGreaterThan(100);
    expect(out.copyReport.complete).toBe(false);
  });
});

describe('card side: an empty payload does not erase or replace an answer', () => {
  const send = (message) => chrome.runtime.onMessage.addListener.mock.calls.forEach(([listener]) => listener(message, {}, jest.fn()));
  let n = 0;
  const final = (rq, fields) => ({ type: 'LLM_PARTIAL_RESPONSE', llmName: 'Qwen', transportRequestId: rq, metadata: { status: 'SUCCESS', terminal: true }, ...fields });
  const card = () => document.querySelector('.debate-model-card[data-llm-name="Qwen"] .debate-model-card-output');

  beforeAll(async () => {
    H.renderDebateDom();
    document.body.classList.add('pipeline-page');
    await H.loadResultsScript();
  });
  beforeEach(() => {
    chrome.runtime.sendMessage.mockImplementation((message, callback) => { if (typeof callback === 'function') callback({ status: 'ok' }); });
    document.getElementById('debate-session-clear-btn').click();
  });

  test('(b) html that sanitizes to nothing visible: the card shows the text', () => {
    const rq = `rq-b-${n += 1}`;
    send(final(rq, { answer: ANSWER, answerHtml: '<div><span></span><script>alert(1)</script></div>' }));
    expect(card().textContent).toContain('Текст ответа Qwen');
  });

  test('(c) a whole-answer stub copy is never rendered as the answer', () => {
    const rq = `rq-c-${n += 1}`;
    send(final(rq, {
      answer: ANSWER, answerHtml: '',
      answerMarkdown: '[НЕ СКОПИРОВАНО: тип=answer, причина=исключение, позиция=1]',
      copyReport: { version: 1, found: {}, copied: {}, placeholders: [{ type: 'answer', reason: 'исключение', position: 1 }], mismatches: [], flags: {}, complete: false }
    }));
    expect(card().textContent).toContain('Текст ответа Qwen');
    expect(card().textContent).not.toContain('НЕ СКОПИРОВАНО');
  });

  test('an empty message after a full answer does not overwrite it', () => {
    const rq = `rq-e-${n += 1}`;
    send(final(rq, { answer: ANSWER, answerHtml: `<p>${ANSWER}</p>` }));
    send(final(`${rq}-2`, { answer: '', answerHtml: '' }));
    send(final(rq, { answer: '', answerHtml: '<div></div>' }));
    expect(card().textContent).toContain('Текст ответа Qwen');
  });
});

describe('automatic pre-collect visits for an answer that stays empty', () => {
  const src = ORCH.slice(ORCH.indexOf('const PRECOLLECT_NUDGE_MAX_PER_DISPATCH'), ORCH.indexOf('async function runPreCollectScrollNudge'));
  const make = () => {
    const c = { emitTelemetry: jest.fn(), Date, Map, Math, String };
    vm.createContext(c);
    vm.runInContext(`${src}; this.gate = gatePreCollectNudge; this.MAX = PRECOLLECT_NUDGE_MAX_PER_DISPATCH; this.PAUSE = PRECOLLECT_NUDGE_BASE_PAUSE_MS;`, c);
    return c;
  };
  const entry = (answer = '') => ({ lastDispatchMeta: { dispatchId: 'd1' }, answer });

  test('at most N activations per dispatch, then a single explicit summary and no more', () => {
    const c = make();
    let now = 1000;
    let allowed = 0;
    for (let i = 0; i < 12; i += 1) {
      now += 10 * 60 * 1000;
      if (c.gate('Qwen', entry(''), 5, 'round2_precollect', now).allowed) allowed += 1;
    }
    expect(allowed).toBeLessThanOrEqual(c.MAX);
    const skips = c.emitTelemetry.mock.calls.filter(([, type]) => type === 'PRECOLLECT_NUDGE_SKIP');
    expect(skips).toHaveLength(1);
    expect(skips[0][1]).toBe('PRECOLLECT_NUDGE_SKIP');
    expect(skips[0][2].meta.summary).toMatch(/^ответ не получен: /);
  });

  test('a visit that left the answer exactly as empty is not repeated', () => {
    const c = make();
    let now = 1000;
    const results = [];
    for (let i = 0; i < 4; i += 1) { now += 10 * 60 * 1000; results.push(c.gate('Qwen', entry(''), 5, 'x', now).allowed); }
    expect(results).toEqual([true, true, false, false]);
  });

  test('visits come with a growing pause', () => {
    const c = make();
    expect(c.gate('Qwen', entry('a'), 5, 'x', 1000).allowed).toBe(true);
    expect(c.gate('Qwen', entry('a'), 5, 'x', 1000 + 100).allowed).toBe(false);
    expect(c.gate('Qwen', entry('a'), 5, 'x', 1000 + c.PAUSE + 1).allowed).toBe(true);
    expect(c.gate('Qwen', entry('a'), 5, 'x', 1000 + c.PAUSE + 1 + c.PAUSE).allowed).toBe(false);
  });

  test('a new dispatch starts from zero; the user\'s own Get it (get_it_*) is not gated', () => {
    const c = make();
    for (let i = 0; i < 5; i += 1) c.gate('Qwen', entry(''), 5, 'x', 1000 + i * 1e7);
    const next = { lastDispatchMeta: { dispatchId: 'd2' }, answer: '' };
    expect(c.gate('Qwen', next, 5, 'x', 9e9).allowed).toBe(true);
    const gateCall = ORCH.slice(ORCH.indexOf("typeof gatePreCollectNudge === 'function'"), ORCH.indexOf("typeof gatePreCollectNudge === 'function'") + 120);
    expect(gateCall).toContain('!/^get_it_/.test(String(reason))');
  });
});
