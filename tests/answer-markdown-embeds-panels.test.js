/** @jest-environment jsdom */
// Embedded blocks (iframe/object/embed), diagrams inside button/aria-hidden wrappers, and artifact panels
// outside the message: nothing is dropped silently, in the page path and in the in-page extractor.
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

const sizeOf = (el, w, h) => { el.getBoundingClientRect = () => ({ width: w, height: h, top: 0, bottom: h, left: 0, right: w }); };
const decode = (src) => Buffer.from(src.replace('data:image/svg+xml;base64,', ''), 'base64').toString('utf8');
const BIG_SVG = '<svg viewBox="0 0 300 200"><rect width="100" height="50"/><text x="5" y="5">A</text></svg>';
const ICON = '<svg><path d="M0 0"/></svg>';

function loadAll() {
  ['AnswerMarkdown', 'AnswerMarkdownBlocks', 'AnswerMarkdownExtras', 'AnswerMarkdownProviders', 'AnswerCopyContext', 'AnswerStructure', 'ContentUtils']
    .forEach((k) => { delete window[k]; });
  window.chrome = { runtime: { id: 'x', sendMessage: jest.fn() } };
  ['content-scripts/answer-structure.js', 'shared/answer-markdown.js', 'shared/answer-markdown-blocks.js',
    'shared/answer-markdown-extras.js', 'shared/answer-markdown-providers.js', 'content-scripts/answer-copy-context.js',
    'content-scripts/answer-html-builder.js', 'content-scripts/content-utils.js'].forEach((file) => window.eval(read(file)));
}
const page = (inner) => `<main><div data-message-author-role="assistant" id="msg"><p>${'Answer text long enough to be chosen. '.repeat(3)}</p>${inner}</div></main>`;
const htmlOf = () => window.ContentUtils.buildInlineHtml(document.getElementById('msg'), { includeRoot: false });
const hostOf = (html) => { const h = document.createElement('div'); h.innerHTML = html; return h; };
const sizeAll = () => document.querySelectorAll('#msg svg').forEach((svg) => sizeOf(svg, 300, 200));

function loadPipeline() {
  ['AnswerPipeline', 'AnswerPipelineConfig', 'AnswerPipelineSelectors', 'TurnResolver', 'UnifiedPipelineModules', 'UnifiedAnswerPipeline']
    .forEach((k) => { delete window[k]; });
  window.eval(read('content-scripts/pipeline-config.js'));
  window.eval(read('content-scripts/turn-resolver.js'));
  window.eval(read('content-scripts/pipeline-modules.js'));
  window.AnswerPipelineSelectors = { PLATFORM_SELECTORS: { generic: { lastMessage: '#msg', messageRoot: '#msg' } }, detectPlatform: () => 'generic' };
  window.eval(read('content-scripts/unified-answer-watcher.js'));
  class Dummy { constructor() {} start() {} stop() {} }
  class DummyTelemetry { constructor() { this.traceId = 'x'; } record() {} logPhase() {} }
  window.UnifiedPipelineModules = {
    ...window.UnifiedPipelineModules, AdaptiveTimeoutManager: Dummy, coordinationModes: {}, selectMode: () => ({}),
    IntelligentRetryManager: Dummy, ContinuousHumanActivity: Dummy, MaintenanceScroll: Dummy,
    ComprehensiveTelemetry: DummyTelemetry, PerplexityStabilization: Dummy, HumanSessionController: Dummy
  };
  window.AnswerPipeline.SanityCheck = Dummy;
  window.eval(read('content-scripts/unified-answer-pipeline.js'));
}

beforeEach(loadAll);

describe('iframe / object / embed', () => {
  test('a cross-origin iframe becomes a visible note with the host only, and is reported', () => {
    document.body.innerHTML = page('<iframe src="https://user:secret@widget.example.com/path/x?token=abc#frag"></iframe><object data="https://other.example.org/o"></object>');
    const html = htmlOf();
    expect(html).toContain('[встроенный блок не скопирован: iframe widget.example.com]');
    expect(html).toContain('[встроенный блок не скопирован: object other.example.org]');
    expect(html).not.toMatch(/secret|token|path\/x/);
    expect(window.ContentUtils.getLastInlineHtmlNotes().map((n) => n.type)).toEqual(['embed', 'embed']);
    expect(hostOf(html).querySelector('iframe, object')).toBeNull();
  });

  test('a srcdoc iframe with a content svg is saved as a picture', () => {
    document.body.innerHTML = page(`<iframe srcdoc='${BIG_SVG}'></iframe>`);
    const img = hostOf(htmlOf()).querySelector('img');
    expect(img).not.toBeNull();
    expect(decode(img.getAttribute('src'))).toContain('<text');
    expect(window.ContentUtils.getLastInlineHtmlNotes()).toEqual([]);
  });

  test('a same-origin iframe document with a content svg is saved as a picture', () => {
    document.body.innerHTML = page('<iframe></iframe>');
    const frame = document.querySelector('iframe');
    const inner = new DOMParser().parseFromString(`<body>${BIG_SVG}</body>`, 'text/html');
    sizeOf(inner.querySelector('svg'), 300, 200);
    Object.defineProperty(frame, 'contentDocument', { value: inner });
    expect(hostOf(htmlOf()).querySelector('img')).not.toBeNull();
  });

  test('an iframe whose document has no svg is a note, not silence', () => {
    document.body.innerHTML = page('<iframe srcdoc="<p>hello</p>"></iframe>');
    expect(htmlOf()).toContain('[встроенный блок не скопирован: iframe без адреса]');
  });

  test('the in-page extractor agrees: same note, same picture, and the copyReport carries the note', () => {
    document.body.innerHTML = page(`<iframe src="https://w.example.com/a?k=1"></iframe><iframe srcdoc='${BIG_SVG}'></iframe>`);
    const out = extractor('GPT', 10, {});
    expect(out.ok).toBe(true);
    expect(out.html).toContain('[встроенный блок не скопирован: iframe w.example.com]');
    expect(out.html).not.toContain('k=1');
    expect(out.html).toContain('data:image/svg+xml;base64,');
    expect(out.html).not.toContain('<iframe');
    expect(out.copyReport.complete).toBe(false);
    expect(out.copyReport.placeholders).toContainEqual({ type: 'embed', reason: 'встроенный блок (iframe) не скопирован: w.example.com', position: 1 });
  });
});

describe('diagrams inside buttons and aria-hidden wrappers', () => {
  test.each([
    ['role=button wrapper', '<div role="button" tabindex="0">%s</div>'],
    ['button wrapper', '<button>%s</button>'],
    ['aria-hidden wrapper', '<div aria-hidden="true">%s</div>']
  ])('a diagram in a %s is kept as a picture; an icon there is cut', (_, wrapper) => {
    document.body.innerHTML = page(wrapper.replace('%s', BIG_SVG) + wrapper.replace('%s', ICON));
    sizeAll();
    const imgs = hostOf(htmlOf()).querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(decode(imgs[0].getAttribute('src'))).toContain('<text');
  });

  test('page chrome stays excluded: nav, header, reasoning', () => {
    document.body.innerHTML = page(`<nav>${BIG_SVG}</nav><header>${BIG_SVG}</header><div data-message-part-type="reasoning">${BIG_SVG}</div>`);
    sizeAll();
    expect(hostOf(htmlOf()).querySelector('img')).toBeNull();
  });

  test('the extractor applies the same rule', () => {
    document.body.innerHTML = page(`<div role="button">${BIG_SVG}</div><div role="button">${ICON}</div><aside>${BIG_SVG}</aside>`);
    sizeAll();
    const fromPage = hostOf(htmlOf()).querySelectorAll('img').length;
    const out = extractor('GPT', 10, {});
    const host = hostOf(out.html);
    expect(host.querySelectorAll('img')).toHaveLength(fromPage);
    expect(fromPage).toBe(1);
  });
});

describe('artifact panels outside the message', () => {
  const panel = '<div role="dialog" aria-label="Artifact: Plan" data-artifact-type="text/markdown"><h2>Plan</h2><pre><code>print(1)</code></pre></div>';

  test('the panel is converted and appended with its heading, and counted in the report (pipeline path)', () => {
    document.body.innerHTML = page('<div data-testid="artifact-card">Plan</div>') + panel;
    loadPipeline();
    const fields = window.UnifiedAnswerPipeline.buildAnswerMarkdownFields(document.getElementById('msg'), 'Claude');
    expect(fields.answerMarkdown).toContain('### Артефакт: Artifact: Plan, text/markdown');
    expect(fields.answerMarkdown).toContain('print(1)');
    expect(fields.copyReport.copied.code).toBeGreaterThanOrEqual(1);
    // The extractor's copy of the same logic gives the same appended block.
    const out = extractor('GPT', 10, {});
    const tail = (value) => value.slice(value.indexOf('### Артефакт'));
    expect(tail(out.answerMarkdown)).toBe(tail(fields.answerMarkdown));
  });

  test('extractor: panel content is appended after the answer and the report includes it', () => {
    document.body.innerHTML = page('<div data-testid="artifact-card">Plan</div>') + panel;
    const out = extractor('GPT', 10, {});
    expect(out.ok).toBe(true);
    expect(out.answerMarkdown).toMatch(/### Артефакт: Artifact: Plan, text\/markdown\n\n[\s\S]*print\(1\)/);
    expect(out.answerMarkdown.indexOf('Answer text')).toBeLessThan(out.answerMarkdown.indexOf('### Артефакт'));
    expect(out.copyReport.copied.code).toBeGreaterThanOrEqual(1);
  });

  test('an artifact reference without a panel on the page is reported, not silent', () => {
    document.body.innerHTML = page('<div data-testid="artifact-card">Plan</div>');
    const out = extractor('GPT', 10, {});
    expect(out.copyReport.complete).toBe(false);
    expect(out.copyReport.placeholders.some((item) => item.type === 'artifact')).toBe(true);
  });

  test('a panel the engine cannot convert becomes a placeholder', () => {
    document.body.innerHTML = page('') + panel;
    const original = window.AnswerMarkdown.convert;
    window.AnswerMarkdown = {
      ...window.AnswerMarkdown,
      convert: (el, options) => {
        if (el.getAttribute && el.getAttribute('role') === 'dialog') throw new Error('boom');
        return original(el, options);
      }
    };
    const out = extractor('GPT', 10, {});
    expect(out.answerMarkdown).toContain('тип=artifact, причина=панель артефакта не прочитана: boom');
    expect(out.copyReport.complete).toBe(false);
  });
});
