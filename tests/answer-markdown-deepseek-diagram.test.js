/** @jest-environment jsdom */
// DeepSeek draws Mermaid as div.md-code-block: a banner (Diagram | Code tabs, Download, Fullscreen buttons) and the body with
// svg.mermaid-svg (labels as foreignObject). There is no <pre>: it is a DIAGRAM, not code. It must reach the card as a picture,
// without the banner; an ordinary md-code-block with a <pre> stays code.
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

const BANNER = `<div class="md-code-block-banner-wrap"><div class="md-code-block-banner md-code-block-banner-lite">
  <div class="ds-segmented" role="tablist"><div role="tab" aria-selected="true">Diagram</div><div role="tab" aria-selected="false">Code</div></div>
  <div class="ds-button" role="button"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M0 0"/></svg></div>
  <div class="ds-button" role="button"><span>Download</span></div><div class="ds-button" role="button"><span>Fullscreen</span></div></div></div>`;
const NODES = Array.from({ length: 6 }, (_, i) => `<g class="node default" id="flowchart-N${i}-${i}"><rect width="80" height="30"/><foreignObject width="80" height="30"><div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel">Step ${i}</span></div></foreignObject></g>`).join('');
const MERMAID_BLOCK = `<div class="md-code-block md-code-block-light">${BANNER}<style>.scope{color:red}</style>
  <div class="body"><svg class="flowchart mermaid-svg" id="mermaid-svg-5" role="graphics-document document" aria-roledescription="flowchart-v2" width="100%" viewBox="-33.4 -33.4 735.3 1904.4" style="max-width:735px"><style>#mermaid-svg-5 .node rect{fill:#ececff}</style><g>${NODES}</g></svg>
  <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 1"/></svg><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2"/></svg></div></div>`;
const CODE_BLOCK = `<div class="md-code-block md-code-block-light"><div class="md-code-block-banner-wrap"><div class="md-code-block-banner"><span class="lang">python</span><div class="ds-button" role="button"><span>Copy</span></div></div></div><pre><span>def f():</span>\n<span>    return 1</span></pre></div>`;

function load() {
  ['AnswerHtmlBuilder', 'ContentUtils', 'AnswerMarkdown', 'AnswerMarkdownBlocks', 'AnswerMarkdownExtras', 'AnswerMarkdownProviders', 'AnswerStructure'].forEach((k) => { delete window[k]; });
  window.chrome = { runtime: { id: 'x', sendMessage: jest.fn() } };
  ['content-scripts/answer-structure.js', 'shared/answer-markdown.js', 'shared/answer-markdown-blocks.js', 'shared/answer-markdown-extras.js',
    'shared/answer-markdown-providers.js', 'content-scripts/answer-html-builder.js', 'content-scripts/content-utils.js'].forEach((f) => window.eval(read(f)));
}
const page = (inner) => {
  document.body.innerHTML = `<div class="ds-markdown" id="msg"><p>Intro paragraph of the answer, long enough to be the answer.</p><h3>Scenario</h3>${inner}<p>Closing paragraph.</p></div>`;
  const svg = document.querySelector('svg.mermaid-svg');
  if (svg) sizeOf(svg, 752, 256);
  document.querySelectorAll('svg').forEach((s) => { if (s !== svg) sizeOf(s, 12, 12); });
};
beforeEach(load);

describe('a Mermaid diagram in a DeepSeek code-block shell', () => {
  test('the page path: a picture of the diagram, no banner, no tabs, no buttons', () => {
    page(MERMAID_BLOCK);
    const host = document.createElement('div');
    host.innerHTML = window.ContentUtils.buildInlineHtml(document.getElementById('msg'), { includeRoot: false, provider: 'DeepSeek' });
    const imgs = host.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('alt')).toBe('Диаграмма Mermaid (flowchart)');
    const svg = decode(imgs[0].getAttribute('src'));
    expect(svg).toContain('#mermaid-svg-5 .node rect{fill:#ececff}');
    expect(svg).toContain('Step 3');
    expect(Number(imgs[0].getAttribute('width'))).toBeGreaterThan(300);   // own size by the view box, not squeezed to 256px high
    expect(Number(imgs[0].getAttribute('height'))).toBeGreaterThan(300);
    ['Diagram', 'Download', 'Fullscreen', 'tablist', 'role="tab"', 'ds-button'].forEach((ui) => expect(host.innerHTML).not.toContain(ui));
    expect(host.textContent).not.toMatch(/Download|Fullscreen/);
    expect(host.querySelector('pre')).toBeNull();
    expect(host.textContent).toContain('Closing paragraph');
  });

  test('the extractor path gives the same, and the Markdown copy counts the diagram', () => {
    page(MERMAID_BLOCK);
    const out = extractor('DeepSeek', 10, {});
    expect(out.ok).toBe(true);
    const host = document.createElement('div');
    host.innerHTML = out.html;
    expect(host.querySelectorAll('img')).toHaveLength(1);
    expect(host.innerHTML).not.toContain('Download');
    const found = (out.copyReport.found.diagram || 0) + (out.copyReport.found.svg || 0);
    const copied = (out.copyReport.copied.diagram || 0) + (out.copyReport.copied.svg || 0);
    const stubs = out.copyReport.placeholders.filter((p) => p.type === 'svg' || p.type === 'diagram').length;
    expect(found).toBeGreaterThan(0);
    expect(found).toBe(copied + stubs);
    expect(out.answerMarkdown).not.toContain('Download');
  });

  test('Code tab active with a <pre> source: the code (mermaid), by the old rules', () => {
    page(`<div class="md-code-block md-code-block-light">${BANNER.replace('aria-selected="true">Diagram', 'aria-selected="false">Diagram').replace('aria-selected="false">Code', 'aria-selected="true">Code')}<pre><span>flowchart LR</span>\n<span>  A --> B</span></pre></div>`);
    const host = document.createElement('div');
    host.innerHTML = window.ContentUtils.buildInlineHtml(document.getElementById('msg'), { includeRoot: false, provider: 'DeepSeek' });
    const pre = host.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre.getAttribute('data-code-lang')).toBe('mermaid');
    expect(pre.textContent).toContain('A --> B');
    expect(host.textContent).not.toMatch(/Download|Fullscreen/);
  });
});

describe('ordinary code blocks stay code', () => {
  test('md-code-block with a <pre>: a clean code block, language from the banner, no banner furniture', () => {
    page(CODE_BLOCK);
    const host = document.createElement('div');
    host.innerHTML = window.ContentUtils.buildInlineHtml(document.getElementById('msg'), { includeRoot: false, provider: 'DeepSeek' });
    const pre = host.querySelector('pre');
    expect(pre.getAttribute('data-code-lang')).toBe('python');
    expect(pre.textContent).toBe('def f():\n    return 1');
    expect(host.textContent).not.toContain('Copy');
    expect(host.querySelector('img')).toBeNull();
  });

  test('the DeepSeek fixture of the engine still gives its code blocks', () => {
    const html = read('tests/fixtures/answer-markdown/deepseek.html');
    document.body.innerHTML = `<div id="root">${html}</div>`;
    const before = document.querySelectorAll('.md-code-block pre').length;
    const result = window.AnswerMarkdown.normalizeCodeBlocks(document.getElementById('root'), { provider: 'DeepSeek' });
    expect(result.count).toBe(before);
  });
});
