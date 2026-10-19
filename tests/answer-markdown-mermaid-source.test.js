/** @jest-environment jsdom */
// Perplexity draws Mermaid in a cross-origin iframe and keeps the source in a hidden <pre>. The source must reach the
// card as a mermaid code block, the paired iframe leaves without a "not copied" note, everything else that is hidden
// in the page stays out. Hidden-ness is read from the page (computed style), not from the copy.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const SOURCE = 'flowchart LR\n  A[Start] --> B{Check}\n  B -->|yes| C[Done]\n';

function load() {
  ['ContentUtils', 'AnswerMarkdown', 'AnswerMarkdownBlocks', 'AnswerMarkdownExtras', 'AnswerMarkdownProviders', 'AnswerStructure'].forEach((k) => { delete window[k]; });
  window.chrome = { runtime: { id: 'x', sendMessage: jest.fn() } };
  ['content-scripts/answer-structure.js', 'shared/answer-markdown.js', 'shared/answer-markdown-blocks.js', 'shared/answer-markdown-extras.js',
    'shared/answer-markdown-providers.js', 'content-scripts/content-utils.js'].forEach((file) => window.eval(read(file)));
}
const page = (inner) => {
  document.body.innerHTML = `<div id="msg"><p>Intro paragraph of the answer.</p>${inner}<p>Closing paragraph.</p></div>`;
};
const build = () => {
  const host = document.createElement('div');
  host.innerHTML = window.ContentUtils.buildInlineHtml(document.getElementById('msg'), { includeRoot: false });
  return host;
};
const DIAGRAM = (src = SOURCE) => `<div class="diagram"><iframe title="Mermaid diagram" sandbox="allow-scripts" src="https://render.example.test/m?id=1"></iframe><div style="display:none"><pre>${src}</pre></div></div>`;

beforeEach(load);

describe('Mermaid source next to its iframe', () => {
  test('the hidden pre is kept as a mermaid code block with its exact text; the iframe goes without a note', () => {
    page(DIAGRAM());
    const host = build();
    const pre = host.querySelector('pre');
    expect(pre.getAttribute('data-code-lang')).toBe('mermaid');
    expect(pre.querySelector('code').className).toBe('language-mermaid');
    expect(pre.textContent).toBe(SOURCE.trimEnd()); // the engine drops the final newline of a block, as in the Markdown copy
    expect(host.querySelector('iframe')).toBeNull();
    expect(host.textContent).not.toContain('встроенный блок');
    expect(window.ContentUtils.getLastInlineHtmlNotes()).toEqual([]);
    expect(host.querySelectorAll('pre')).toHaveLength(1);
  });

  test('also when the hiding comes from a stylesheet class, not an inline style', () => {
    document.head.innerHTML = '<style>.src-panel{display:none}</style>';
    page(`<div><iframe title="Mermaid diagram" src="https://render.example.test/m"></iframe><div class="src-panel"><pre>${SOURCE}</pre></div></div>`);
    const host = build();
    expect(host.querySelector('pre').textContent).toBe(SOURCE.trimEnd());
    expect(host.querySelector('iframe')).toBeNull();
    document.head.innerHTML = '';
  });

  test('a Mermaid iframe without a source next to it still gets the "not copied" note', () => {
    page('<div><iframe title="Mermaid diagram" src="https://render.example.test/m"></iframe></div>');
    const host = build();
    expect(host.textContent).toContain('[встроенный блок не скопирован: iframe render.example.test]');
    expect(window.ContentUtils.getLastInlineHtmlNotes().map((n) => n.type)).toEqual(['embed']);
  });

  test('a visible Mermaid pre is a mermaid code block too', () => {
    page(`<pre>${SOURCE}</pre>`);
    expect(build().querySelector('pre').getAttribute('data-code-lang')).toBe('mermaid');
  });

  test('an iframe of another kind next to a Mermaid source keeps its note', () => {
    page(`<div><iframe title="Video" src="https://video.example.test/v"></iframe><div style="display:none"><pre>${SOURCE}</pre></div></div>`);
    expect(build().textContent).toContain('[встроенный блок не скопирован: iframe video.example.test]');
  });
});

describe('other hidden content stays out', () => {
  test('display:none (own or inherited), visibility:hidden and the hidden attribute; a hidden ordinary pre', () => {
    page(`<div style="display:none"><p>SECRET-A</p></div><span style="visibility:hidden">SECRET-B</span><p hidden>SECRET-C</p>
      <div style="display:none"><div><p>SECRET-D</p></div><pre>print("hidden code")</pre></div><p>visible text</p>`);
    const host = build();
    expect(host.textContent).toContain('visible text');
    ['SECRET-A', 'SECRET-B', 'SECRET-C', 'SECRET-D', 'hidden code'].forEach((word) => expect(host.textContent).not.toContain(word));
    expect(host.querySelector('pre')).toBeNull();
  });

  test('the page itself is not changed by the collection', () => {
    page(DIAGRAM());
    build();
    expect(document.querySelector('#msg iframe')).not.toBeNull();
    expect(document.querySelector('#msg pre').textContent).toBe(SOURCE);
    expect(document.querySelector('#msg pre').hasAttribute('data-code-lang')).toBe(false);
  });
});

describe('the engine', () => {
  test('the kept mermaid pre survives normalizeCodeBlocks with its language', () => {
    page(DIAGRAM());
    const host = build();
    expect(host.querySelectorAll('pre')).toHaveLength(1);
    expect(host.querySelector('pre').getAttribute('data-code-lang')).toBe('mermaid');
    expect(host.querySelector('code').className).toBe('language-mermaid');
  });
});
