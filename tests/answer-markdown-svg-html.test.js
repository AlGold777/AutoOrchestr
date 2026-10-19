/** @jest-environment jsdom */
// Diagrams (content SVG) survive in answerHtml as <img data:image/svg+xml>, icons do not,
// the sanitizer lets exactly that image through, and the in-page extractor agrees with ContentUtils.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const ORCH = read('background/job-orchestrator.js');

const sliceFunction = (src, name) => {
  const start = src.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const open = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced');
};
const extractor = new Function(`${sliceFunction(ORCH, 'extractLatestAssistantSnapshotInPage')}; return extractLatestAssistantSnapshotInPage;`)();
const capSnapshotHtml = new Function('LATE_COLLECT_CACHE_MAX_CHARS', `${sliceFunction(ORCH, 'capSnapshotHtml')}; return capSnapshotHtml;`);

const sizeOf = (svg, w, h) => { svg.getBoundingClientRect = () => ({ width: w, height: h, top: 0, bottom: h, left: 0, right: w }); };
const decode = (src) => Buffer.from(src.replace('data:image/svg+xml;base64,', ''), 'base64').toString('utf8');

const SVG_DIAGRAM = `<svg id="d1" viewBox="0 0 300 200"><style>.n{fill:#fff}</style>
  <g><rect class="n" width="10" height="10"/><foreignObject width="80" height="20"><div xmlns="http://www.w3.org/1999/xhtml">Label A</div></foreignObject></g></svg>`;
const PAGE = `<main><div data-message-author-role="assistant"><div class="markdown">
  <p>Before the diagram, long enough for the minimum text length.</p>
  <div class="panel"><div class="bar"><button id="b1"><svg id="icon-btn"><path d="M0 0"/></svg>Copy</button></div>
  <div class="preview">${SVG_DIAGRAM}</div></div>
  <svg id="icon-inline"><path d="M0 0"/></svg><p>After.</p></div></div></main>`;

const setSizes = (diagramW = 300, diagramH = 200) => {
  sizeOf(document.getElementById('d1'), diagramW, diagramH);
  sizeOf(document.getElementById('icon-btn'), 120, 120); // large but inside a button
  sizeOf(document.getElementById('icon-inline'), 16, 16);
};

describe('ContentUtils.buildInlineHtml with content SVG', () => {
  beforeEach(() => {
    delete window.ContentUtils;
    window.chrome = { runtime: { id: 'x', sendMessage: jest.fn() } };
    window.eval(read('content-scripts/content-utils.js'));
    document.body.innerHTML = PAGE;
  });

  test('diagram becomes an <img data:image/svg+xml> with size, style and foreignObject kept; icons and buttons are not', () => {
    setSizes();
    const html = window.ContentUtils.buildInlineHtml(document.querySelector('.markdown'), { includeRoot: false });
    const host = document.createElement('div');
    host.innerHTML = html;
    const imgs = host.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('alt')).toBe('Диаграмма');
    expect(imgs[0].getAttribute('width')).toBe('300');
    const svg = decode(imgs[0].getAttribute('src'));
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 300 200"');
    expect(svg).toContain('.n{fill:#fff}');
    expect(svg).toContain('Label A');
    expect(host.querySelector('svg')).toBeNull();
    expect(host.querySelector('button')).toBeNull();
    expect(window.ContentUtils.getLastInlineHtmlNotes()).toEqual([]);
  });

  test('the page DOM is not modified', () => {
    setSizes();
    window.ContentUtils.buildInlineHtml(document.querySelector('.markdown'));
    expect(document.getElementById('d1')).not.toBeNull();
  });

  test('an oversized diagram is replaced by a visible note and recorded', () => {
    setSizes();
    const big = document.getElementById('d1');
    big.insertAdjacentHTML('beforeend', `<desc>${'x'.repeat(420000)}</desc>`);
    const html = window.ContentUtils.buildInlineHtml(document.querySelector('.markdown'), { includeRoot: false });
    expect(html).toContain('[диаграмма не сохранена: размер]');
    expect(html).not.toContain('data:image/svg+xml');
    expect(window.ContentUtils.getLastInlineHtmlNotes()).toEqual([
      { type: 'svg', reason: 'диаграмма не сохранена в HTML: размер', position: 1 }
    ]);
  });
});

describe('sanitizeHTML (DOMPurify) with diagram images', () => {
  beforeEach(() => {
    window.eval(read('lib/purify.min.js'));
    delete window.sanitizeHTML;
    window.eval(read('utils/sanitize.js'));
  });
  const svgSrc = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`;

  test('keeps a base64 svg data image, drops every other image source and handlers', () => {
    const clean = window.sanitizeHTML(`<p>a</p><img src="${svgSrc}" alt="Диаграмма" width="10" height="10" onerror="x()">
      <img src="https://tracker.example/p.png"><img src="data:text/html;base64,AAAA"><img src="data:image/svg+xml;utf8,<svg onload=1>">
      <a href="${svgSrc}">l</a>`);
    const host = document.createElement('div');
    host.innerHTML = clean;
    const imgs = Array.from(host.querySelectorAll('img'));
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toBe(svgSrc);
    expect(imgs[0].getAttribute('alt')).toBe('Диаграмма');
    expect(imgs[0].getAttribute('width')).toBe('10');
    expect(imgs[0].hasAttribute('onerror')).toBe(false);
    expect(host.querySelector('a').hasAttribute('href')).toBe(false);
  });

  test('end to end: buildInlineHtml output passes the sanitizer with the image intact', () => {
    delete window.ContentUtils;
    window.chrome = { runtime: { id: 'x', sendMessage: jest.fn() } };
    window.eval(read('content-scripts/content-utils.js'));
    document.body.innerHTML = PAGE;
    setSizes();
    const clean = window.sanitizeHTML(window.ContentUtils.buildInlineHtml(document.querySelector('.markdown'), { includeRoot: false }));
    expect(clean).toContain('<img');
    expect(clean).toContain('data:image/svg+xml;base64,');
  });
});

describe('in-page extractor agrees with ContentUtils', () => {
  const imgSrcs = (html) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    return Array.from(host.querySelectorAll('img')).map((img) => `${img.getAttribute('src')}|${img.getAttribute('width')}x${img.getAttribute('height')}`);
  };
  beforeEach(() => {
    delete window.ContentUtils;
    window.chrome = { runtime: { id: 'x', sendMessage: jest.fn() } };
    window.eval(read('content-scripts/content-utils.js'));
    delete window.AnswerMarkdown;
    document.body.innerHTML = PAGE;
    setSizes();
  });

  test('same images, same icon/button filtering', () => {
    const expected = imgSrcs(window.ContentUtils.buildInlineHtml(document.querySelector('.markdown'), { includeRoot: false }));
    // GPT path of the extractor: raw node html (ContentUtils.getLastInlineHtmlNotes is not used for it)
    const out = extractor('GPT', 10, {});
    expect(out.ok).toBe(true);
    expect(expected).toHaveLength(1);
    expect(imgSrcs(out.html)).toEqual(expected);
    expect(out.html).not.toContain('id="d1"');
  });

  test('an oversized diagram is noted in html and in copyReport (complete=false)', () => {
    document.getElementById('d1').insertAdjacentHTML('beforeend', `<desc>${'x'.repeat(420000)}</desc>`);
    const out = extractor('GPT', 10, {});
    expect(out.html).toContain('[диаграмма не сохранена: размер]');
    expect(out.copyReport.complete).toBe(false);
    expect(out.copyReport.placeholders).toContainEqual({ type: 'svg', reason: 'диаграмма не сохранена в HTML: размер', position: 1 });
  });

  test('snapshot cache cap never cuts a diagram image in half', () => {
    const cap = capSnapshotHtml(1000);
    const html = `<p>x</p><img src="data:image/svg+xml;base64,${'A'.repeat(3000)}" alt="Диаграмма">`;
    const out = cap(html);
    expect(out).toContain('[диаграмма не сохранена: размер]');
    expect(out).not.toContain('base64');
    expect(cap('<p>short</p>')).toBe('<p>short</p>');
  });
});

describe('markdown for a rendered diagram with a hidden "Code view" panel', () => {
  beforeEach(() => {
    ['AnswerMarkdown', 'AnswerMarkdownBlocks', 'AnswerMarkdownExtras', 'AnswerMarkdownProviders'].forEach((k) => { delete window[k]; });
    ['shared/answer-markdown.js', 'shared/answer-markdown-blocks.js', 'shared/answer-markdown-extras.js', 'shared/answer-markdown-providers.js']
      .forEach((file) => window.eval(read(file)));
  });
  const page = (svgAttrs) => `<div class="msg"><p>Before</p>
    <div class="card"><div class="bar"><button>Copy</button><button>Code view</button><button>Preview</button><button>Expand preview</button></div>
    <div class="preview"><svg ${svgAttrs} width="300" height="200"><g><text>A</text><text>B</text></g></svg></div>
    <div class="code" style="display:none"><pre><code>flowchart LR\n  A --> B</code></pre></div></div><p>After</p></div>`;

  test.each([
    ['mermaid marker on the svg', 'id="mermaid-1" aria-roledescription="flowchart-v2"'],
    ['no marker on the svg (source decides)', 'id="chart-1"']
  ])('source comes from the hidden panel: %s', (_, attrs) => {
    document.body.innerHTML = page(attrs);
    const { markdown, report } = window.AnswerMarkdown.convert(document.querySelector('.msg'), { provider: 'Le Chat' });
    expect(markdown).toContain('```mermaid\nflowchart LR\n  A --> B\n```');
    expect(markdown).not.toContain('Code view');
    expect(markdown).not.toContain('НЕ СКОПИРОВАНО');
    expect(markdown.match(/flowchart LR/g)).toHaveLength(1);
    expect(report.complete).toBe(true);
    expect((report.found.diagram || 0) + (report.found.svg || 0)).toBe(1);
  });

  test('an unrelated code block elsewhere is not taken as the diagram source', () => {
    document.body.innerHTML = `<div class="msg"><div class="card"><div class="preview"><svg id="mermaid-1" aria-roledescription="flowchart-v2" width="300" height="200"><g><text>A</text><text>B</text></g></svg></div></div>
      <pre><code>print("hi")</code></pre></div>`;
    const { markdown, report } = window.AnswerMarkdown.convert(document.querySelector('.msg'), { provider: 'Le Chat' });
    expect(markdown).toContain('НЕ СКОПИРОВАНО');
    expect(report.complete).toBe(false);
  });
});
