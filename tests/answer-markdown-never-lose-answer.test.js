/** @jest-environment jsdom */
// Regression (Qwen, 2.81.814): the answer vanished (wide_container_only) because every diagram pre holds a Monaco editor with a hidden
// <textarea class="inputarea">, which the "page chrome" rule took for the page composer. And the general principle: no enrichment
// (builder, turn expansion, Markdown, sweep) may lose the whole answer — it degrades to the plain html/text with a note.
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

const monacoPre = (i) => `<pre class="qwen-markdown-code"><div class="qwen-markdown-code"><div>mermaid</div><button>Код</button><button>Копировать</button></div>
  <div class="mermaid"><div style="display:none"><div class="monaco-editor" role="code"><textarea class="inputarea monaco-mouse-cursor-text" aria-label="Editor content"></textarea>
  <div class="view-lines"><div class="view-line">graph TD; A${i}--&gt;B${i}</div></div></div></div><canvas width="2" height="2"></canvas></div></pre>`;
const qwenPage = (extra = '') => `<div class="chat-messages"><div class="qwen-chat-message qwen-chat-message-user"><p>Вопрос пользователя, достаточно длинный.</p></div>
  <div class="chat-response-message-render-flow"><div class="qwen-chat-thinking-tool-status-card">Мышление</div>
  <div class="qwen-chat-message qwen-chat-message-assistant"><div class="response-message-content"><div class="custom-qwen-markdown"><div class="qwen-markdown qwen-markdown-loose">
  <p>${'Текст ответа Qwen. '.repeat(30)}</p>${[1, 2, 3, 4, 5].map(monacoPre).join('<p>Между диаграммами идёт пояснение достаточной длины.</p>')}<p>Заключение ответа.</p>${extra}
  </div></div></div></div></div></div><div class="composer"><textarea placeholder="Спросите"></textarea></div>`;

const loadAll = () => {
  ['AnswerMarkdown', 'AnswerMarkdownBlocks', 'AnswerMarkdownExtras', 'AnswerMarkdownProviders', 'AnswerHtmlBuilder', 'ContentUtils']
    .forEach((k) => { delete window[k]; });
  window.chrome = { runtime: { id: 'x', sendMessage: jest.fn() } };
  ['shared/answer-markdown.js', 'shared/answer-markdown-blocks.js', 'shared/answer-markdown-extras.js', 'shared/answer-markdown-providers.js',
    'content-scripts/answer-html-builder.js', 'content-scripts/content-utils.js'].forEach((f) => window.eval(read(f)));
};
beforeEach(loadAll);

describe('Qwen answer with Monaco editors inside diagram blocks', () => {
  test('the in-page extractor returns the answer (not wide_container_only)', () => {
    document.body.innerHTML = qwenPage();
    const out = extractor('Qwen', 80, {});
    expect(out.reason).toBeUndefined();
    expect(out.ok).toBe(true);
    expect(out.text).toContain('Заключение ответа');
    expect(out.text).not.toContain('Вопрос пользователя');
  });

  test('the late snapshot returns it too', () => {
    document.body.innerHTML = qwenPage();
    const snap = window.ContentUtils.collectLateSnapshotCandidate('Qwen', 80, { withMarkdown: true });
    expect(snap.ok).toBe(true);
    expect(snap.text).toContain('Заключение ответа');
    expect(snap.text).not.toContain('Вопрос пользователя');
  });

  test('a real composer inside the node is still page chrome (unchanged rule)', () => {
    document.body.innerHTML = `<main><div class="qwen-markdown"><p>${'Ответ. '.repeat(30)}</p><textarea></textarea></div></main>`;
    expect(window.AnswerHtmlBuilder.containsPageChrome(document.querySelector('.qwen-markdown'))).toBe(true);
  });
});

describe('degradation: the answer is never lost to an enrichment failure', () => {
  test('one unambiguous candidate that looks like a page container is returned with a note', () => {
    document.body.innerHTML = qwenPage('<form><input></form>');
    const out = extractor('Qwen', 80, {});
    expect(out.ok).toBe(true);
    expect(out.text).toContain('Заключение ответа');
    expect(JSON.stringify(out.copyReport)).toContain('похож на контейнер страницы');
    expect(out.copyReport.complete).toBe(false);
  });

  test('exception in the html builder: plain html with a note', () => {
    document.body.innerHTML = qwenPage();
    window.AnswerHtmlBuilder = { ...window.AnswerHtmlBuilder, build: () => { throw new Error('boom'); } };
    const out = extractor('Qwen', 80, {});
    expect(out.ok).toBe(true);
    expect(out.html).toContain('Заключение ответа');
    expect(JSON.stringify(out.copyReport)).toContain('запасным путём');
  });

  test('exception in expandToTurn: the found node is the answer', () => {
    document.body.innerHTML = qwenPage();
    window.AnswerHtmlBuilder = { ...window.AnswerHtmlBuilder, expandToTurn: () => { throw new Error('boom'); } };
    const out = extractor('Qwen', 80, {});
    expect(out.ok).toBe(true);
    expect(out.text).toContain('Заключение ответа');
    expect(JSON.stringify(out.copyReport)).toContain('расширение до хода не удалось');
  });

  test('exception in AnswerMarkdown.convert / normalizeCodeBlocks: answer kept, report incomplete', () => {
    document.body.innerHTML = qwenPage();
    window.AnswerMarkdown = { ...window.AnswerMarkdown, convert: () => { throw new Error('boom'); } };
    const out = extractor('Qwen', 80, {});
    expect(out.ok).toBe(true);
    expect(out.text).toContain('Заключение ответа');
    expect(out.copyReport.complete).toBe(false);
    window.AnswerMarkdown = { ...window.AnswerMarkdown, normalizeCodeBlocks: () => { throw new Error('boom'); } };
    const snap = window.ContentUtils.collectLateSnapshotCandidate('Qwen', 80, { withMarkdown: true });
    expect(snap.ok).toBe(true);
    expect(snap.html).toContain('Заключение ответа');
  });

  test('exception in the late html builder: plain html with a note', () => {
    document.body.innerHTML = qwenPage();
    window.AnswerHtmlBuilder = { ...window.AnswerHtmlBuilder, build: () => { throw new Error('boom'); } };
    const snap = window.ContentUtils.collectLateSnapshotCandidate('Qwen', 80, { withMarkdown: true });
    expect(snap.ok).toBe(true);
    expect(snap.html).toContain('Заключение ответа');
  });
});
