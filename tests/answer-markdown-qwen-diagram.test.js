/** @jest-environment jsdom */
// Qwen draws a Mermaid diagram INSIDE a <pre class="qwen-markdown-code">: a header (the word "mermaid", six icon buttons with tab/action
// texts), a hidden Monaco editor that holds only the first source line, canvases, and the rendered svg (the same svg id on several
// diagrams). That pre is a DIAGRAM, not code: a picture without the furniture; a pre with a visible full source is a mermaid code block.
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
const SAME_ID = 'mermaid-179244703972';

const HEADER = `<div class="qwen-markdown-code"><div>mermaid</div><div class="qwen-markdown-code-mermaid-tools">${['Код', 'превью', 'copy', 'download', 'full', 'zoom'].map((label) => `<button class="qwen-markdown-mermaid-btn"><span class="anticon" role="img"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="M1 1"/></svg></span>${['Код', 'превью'].includes(label) ? label : ''}</button>`).join('')}</div></div>`;
const MONACO_ONE_LINE = (first) => `<div style="display:none"><div class="monaco-editor" role="code"><div class="margin"><div class="line-numbers">1</div></div><div class="view-lines"><div class="view-line"><span>${first}</span></div></div></div></div>`;
const MONACO_FULL = `<div class="monaco-editor" role="code"><div class="view-lines"><div class="view-line"><span>flowchart LR</span></div><div class="view-line"><span>&nbsp;&nbsp;A --> B</span></div><div class="view-line"><span>&nbsp;&nbsp;B --> C</span></div></div></div>`;
const svg = (kind, extra = '') => `<svg id="${SAME_ID}" aria-roledescription="${kind}" viewBox="0 0 700 250" width="100%" ${extra}><style>#${SAME_ID} .node rect{fill:#eef}</style><g><g class="node default"><rect width="60" height="30"/><text>A</text></g><g class="node default"><rect x="80" width="60" height="30"/><text>B</text></g><g class="node default"><rect x="160" width="60" height="30"/><text>C</text></g></g></svg>`;
const diagramPre = (first, kind, body = svg(kind), editor = MONACO_ONE_LINE(first)) => `<pre class="qwen-markdown-code">${HEADER}<div class="qwen-markdown-code mermaid">${editor}<div><div class="qwen-markdown-mermaid-wrap">${body}</div></div><canvas></canvas><canvas></canvas><canvas></canvas></div></pre>`;

function load() {
  ['AnswerHtmlBuilder', 'ContentUtils', 'AnswerMarkdown', 'AnswerMarkdownBlocks', 'AnswerMarkdownExtras', 'AnswerMarkdownProviders', 'AnswerStructure'].forEach((k) => { delete window[k]; });
  window.chrome = { runtime: { id: 'x', sendMessage: jest.fn() } };
  ['content-scripts/answer-structure.js', 'shared/answer-markdown.js', 'shared/answer-markdown-blocks.js', 'shared/answer-markdown-extras.js',
    'shared/answer-markdown-providers.js', 'content-scripts/answer-html-builder.js', 'content-scripts/content-utils.js'].forEach((f) => window.eval(read(f)));
}
const page = (inner, { sizes = true } = {}) => {
  document.body.innerHTML = `<div class="qwen-markdown qwen-markdown-loose" id="msg"><p>Intro paragraph of the answer, long enough to be the answer.</p>${inner}<p>Closing paragraph.</p></div>`;
  if (sizes) document.querySelectorAll('#msg svg[id^="mermaid"]').forEach((s) => sizeOf(s, 702, 257));
};
const built = () => { const h = document.createElement('div'); h.innerHTML = window.ContentUtils.buildInlineHtml(document.getElementById('msg'), { includeRoot: false, provider: 'Qwen' }); return h; };
beforeEach(load);

describe('a rendered diagram inside pre.qwen-markdown-code', () => {
  test('a picture with the kind in its alt; no header, buttons, tab texts, editor, line number or canvas', () => {
    page(diagramPre('sequenceDiagram', 'sequence'));
    const host = built();
    const imgs = host.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('alt')).toBe('Диаграмма Mermaid (sequence)');
    expect(decode(imgs[0].getAttribute('src'))).toContain('#mermaid-179244703972 .node rect{fill:#eef}');
    expect(host.querySelector('pre')).toBeNull();
    ['Код', 'превью', 'mermaid<', 'monaco', 'view-line', 'line-numbers', '<canvas', '<button'].forEach((furniture) => expect(host.innerHTML).not.toContain(furniture));
    expect(host.textContent).not.toMatch(/sequenceDiagram|Код|превью/);
    expect(host.textContent).toContain('Closing paragraph');
  });

  test('five diagrams with the SAME svg id are five pictures (the id is not a key), each with its own kind', () => {
    page(['sequence', 'flowchart-v2', 'stateDiagram-v2', 'flowchart-v2', 'class'].map((kind) => diagramPre('x', kind)).join(''));
    const imgs = Array.from(built().querySelectorAll('img'));
    expect(imgs.map((i) => i.getAttribute('alt'))).toEqual([
      'Диаграмма Mermaid (sequence)', 'Диаграмма Mermaid (flowchart)', 'Диаграмма Mermaid (statediagram)', 'Диаграмма Mermaid (flowchart)', 'Диаграмма Mermaid (class)'
    ]);
  });

  test('the svg hidden because the "Код" tab is active (display:none, no layout) is still collected from the DOM', () => {
    page(diagramPre('graph TD', 'flowchart-v2', `<div style="display:none">${svg('flowchart-v2')}</div>`), { sizes: false });
    const host = built();
    const img = host.querySelector('img');
    expect(img).not.toBeNull();
    expect(Number(img.getAttribute('width'))).toBeGreaterThan(300);   // the size it declares (view box), not 0
    expect(host.querySelector('pre')).toBeNull();
    expect(host.textContent).not.toContain('Код');
  });

  test('a visible editor with the whole source (several lines, starts with the mermaid keyword): a mermaid code block, no picture', () => {
    page(diagramPre('x', 'flowchart-v2', svg('flowchart-v2'), MONACO_FULL));
    const host = built();
    const pre = host.querySelector('pre');
    expect(pre.getAttribute('data-code-lang')).toBe('mermaid');
    expect(pre.textContent).toBe('flowchart LR\n  A --> B\n  B --> C');
    expect(host.querySelector('img')).toBeNull();
  });

  test('the one first line of a hidden virtualised editor is NOT taken as the source', () => {
    page(diagramPre('graph TD', 'flowchart-v2'));
    const host = built();
    expect(host.querySelector('pre')).toBeNull();
    expect(host.textContent).not.toContain('graph TD');
    expect(host.querySelectorAll('img')).toHaveLength(1);
  });

  test('the extractor path gives the same pictures, and the Markdown copy accounts for every diagram (copied or a stub)', () => {
    page([diagramPre('sequenceDiagram', 'sequence'), diagramPre('graph TD', 'flowchart-v2')].join(''));
    const out = extractor('Qwen', 10, {});
    expect(out.ok).toBe(true);
    const host = document.createElement('div');
    host.innerHTML = out.html;
    expect(host.querySelectorAll('img')).toHaveLength(2);
    expect(host.innerHTML).not.toContain('<button');
    const found = (out.copyReport.found.diagram || 0) + (out.copyReport.found.svg || 0);
    const copied = (out.copyReport.copied.diagram || 0) + (out.copyReport.copied.svg || 0);
    const stubs = out.copyReport.placeholders.filter((p) => p.type === 'svg' || p.type === 'diagram').length;
    expect(found).toBeGreaterThanOrEqual(2);
    expect(found).toBe(copied + stubs);
  });
});

describe('ordinary Qwen code stays code', () => {
  test('a pre with code: a clean code block, nothing of the interface', () => {
    page('<pre class="qwen-markdown-code"><div class="qwen-markdown-code"><div>python</div><button>Copy</button></div><code>def f():\n    return 1</code></pre>', { sizes: false });
    const host = built();
    const pre = host.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre.textContent).toContain('def f():\n    return 1');
    expect(host.textContent).not.toContain('Copy');
    expect(host.querySelector('img')).toBeNull();
  });

  test('the Qwen fixture of the engine still gives its code blocks', () => {
    document.body.innerHTML = `<div id="root">${read('tests/fixtures/answer-markdown/qwen.html')}</div>`;
    const before = document.querySelectorAll('pre').length;
    const result = window.AnswerMarkdown.normalizeCodeBlocks(document.getElementById('root'), { provider: 'Qwen' });
    expect(result.count).toBeGreaterThanOrEqual(before > 0 ? 1 : 0);
  });
});
