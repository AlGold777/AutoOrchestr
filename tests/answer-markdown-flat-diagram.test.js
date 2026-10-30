/** @jest-environment jsdom */
// ChatGPT draws a wide flowchart LR into a 412px panel: the svg is 412x30 on the page. That is a diagram, not an icon.
// A diagram the page has not drawn yet (lazy: "Загрузка диаграммы Mermaid") must be reported, never left as a silent gap.
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
const FLAT = (extra = '') => `<svg ${extra} viewBox="0 0 1800 130" width="100%"><g class="node"><rect width="100" height="40"/><text>A</text></g><g class="node"><rect x="200" width="100" height="40"/><text>B</text></g></svg>`;

function load() {
  ['AnswerHtmlBuilder', 'ContentUtils', 'AnswerMarkdown', 'AnswerMarkdownBlocks', 'AnswerMarkdownExtras', 'AnswerMarkdownProviders', 'AnswerStructure'].forEach((k) => { delete window[k]; });
  window.chrome = { runtime: { id: 'x', sendMessage: jest.fn() } };
  ['content-scripts/answer-structure.js', 'shared/answer-markdown.js', 'shared/answer-markdown-blocks.js', 'shared/answer-markdown-extras.js',
    'shared/answer-markdown-providers.js', 'content-scripts/answer-html-builder.js', 'content-scripts/content-utils.js'].forEach((f) => window.eval(read(f)));
}
const page = (inner) => { document.body.innerHTML = `<div data-message-author-role="assistant" id="msg"><p>${'Answer text long enough to be the answer. '.repeat(3)}</p>${inner}</div>`; };
const build = () => { const h = document.createElement('div'); h.innerHTML = window.ContentUtils.buildInlineHtml(document.getElementById('msg'), { includeRoot: false }); return h; };
const sizeSvgs = (w, h) => document.querySelectorAll('#msg svg').forEach((svg) => sizeOf(svg, w, h));

beforeEach(load);

describe('a flat wide diagram is content', () => {
  test.each([
    ['inside the preview pane of a code block', '<div data-code-block-preview-pane="mermaid">%s</div>'],
    ['bare, with only its own size and parts', '%s'],
    ['in a role=img holder with a caption', '<div role="img" aria-label="Диаграмма Mermaid">%s</div>']
  ])('412x30 %s becomes a picture of its own size', (_, wrapper) => {
    page(wrapper.replace('%s', FLAT()));
    sizeSvgs(412, 30);
    const img = build().querySelector('img');
    expect(img).not.toBeNull();
    expect(Number(img.getAttribute('width'))).toBe(1800);   // the size by the view box, not the 30px the panel squeezed it to
    expect(Number(img.getAttribute('height'))).toBe(130);
    expect(decode(img.getAttribute('src'))).toContain('<text');
  });

  test('a diagram that is not squeezed keeps the size it has on the page', () => {
    page(FLAT());
    sizeSvgs(1800, 130);
    expect(build().querySelector('img').getAttribute('width')).toBe('1800');
    page(`<svg viewBox="0 0 600 500" width="100%"><g class="node"><text>A</text></g><g class="node"><text>B</text></g><g class="node"><text>C</text></g></svg>`);
    sizeSvgs(412, 344);
    expect(Number(build().querySelector('img').getAttribute('width'))).toBe(412); // 412/600 on the page: unchanged
  });

  test('icons are still cut: small, few parts, no diagram marks', () => {
    page('<svg viewBox="0 0 24 24" width="16" height="16"><path d="M0 0"/></svg><svg viewBox="0 0 24 24"><path d="M0 0"/><path d="M1 1"/></svg>');
    sizeSvgs(16, 16);
    expect(build().querySelector('img')).toBeNull();
    page('<svg viewBox="0 0 40 8" width="100%"><rect width="40" height="1"/></svg>'); // a thin decorative line
    sizeSvgs(300, 2);
    expect(build().querySelector('img')).toBeNull();
  });

  test('the in-page extractor does the same, and the Markdown copy counts the diagram as copied', () => {
    page(`<div data-code-block-preview-pane="mermaid">${FLAT('id="mermaid-1" aria-roledescription="flowchart-v2"')}</div>`);
    sizeSvgs(412, 30);
    const out = extractor('GPT', 10, {});
    expect(out.ok).toBe(true);
    const host = document.createElement('div');
    host.innerHTML = out.html;
    expect(host.querySelector('img')).not.toBeNull();
    expect(out.answerMarkdown).toMatch(/```(?:svg|mermaid)/);
    expect(out.copyReport.found.diagram || out.copyReport.found.svg).toBeGreaterThan(0);
    const found = (out.copyReport.found.diagram || 0) + (out.copyReport.found.svg || 0);
    const copied = (out.copyReport.copied.diagram || 0) + (out.copyReport.copied.svg || 0);
    const stubs = out.copyReport.placeholders.filter((p) => p.type === 'svg' || p.type === 'diagram').length;
    expect(found).toBe(copied + stubs);
  });
});

describe('a diagram the page has not drawn yet', () => {
  const placeholder = '<div role="status" aria-label="Загрузка диаграммы Mermaid" style="height:240px"><span></span></div>';

  test('the html gets a visible note and the report an entry (never a silent gap)', () => {
    page(`<p>before</p>${placeholder}<p>after</p>`);
    const host = build();
    expect(host.textContent).toContain('[диаграмма не отрисована страницей: Загрузка диаграммы Mermaid]');
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(window.ContentUtils.getLastInlineHtmlNotes()).toContainEqual({ type: 'diagram', reason: 'страница не отрисовала диаграмму: Загрузка диаграммы Mermaid', position: 1 });
  });

  test('the extractor reports it with complete=false', () => {
    page(placeholder);
    const out = extractor('GPT', 10, {});
    expect(out.ok).toBe(true);
    expect(out.html).toContain('[диаграмма не отрисована страницей');
    expect(out.copyReport.complete).toBe(false);
    expect(out.copyReport.placeholders).toContainEqual({ type: 'diagram', reason: 'страница не отрисовала диаграмму: Загрузка диаграммы Mermaid', position: 1 });
  });

  test('other status elements (a generic spinner) are left alone', () => {
    page('<div role="status" aria-label="Loading"><span></span></div>');
    expect(build().textContent).not.toContain('не отрисована');
  });
});
