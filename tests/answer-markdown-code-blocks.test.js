/** @jest-environment jsdom */
// Code blocks in cards: a clean <pre data-code-lang><code> from the collected html, a header with the language and a Copy button
// added by DOM code after the sanitizer, copy of the exact text, idempotent, no text of its own in the card.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const CODE = 'def f(x):\n\n    if x:\n\treturn  1   \n    return 2\n';

function load() {
  if (window.ResultsCodeBlocks) window.ResultsCodeBlocks.dispose();
  ['ResultsCodeBlocks', 'ContentUtils', 'AnswerMarkdown', 'AnswerMarkdownBlocks', 'AnswerMarkdownExtras', 'AnswerMarkdownProviders', 'AnswerStructure', 'sanitizeHTML']
    .forEach((k) => { delete window[k]; });
  window.chrome = { runtime: { id: 'x', sendMessage: jest.fn() } };
  window.eval(read('results/code-blocks.js'));
  ['content-scripts/answer-structure.js', 'shared/answer-markdown.js', 'shared/answer-markdown-blocks.js', 'shared/answer-markdown-extras.js',
    'shared/answer-markdown-providers.js', 'content-scripts/answer-html-builder.js', 'content-scripts/content-utils.js', 'lib/purify.min.js', 'utils/sanitize.js'].forEach((file) => window.eval(read(file)));
}
const card = (html) => {
  document.body.innerHTML = `<div class="debate-model-card-output" id="out">${html}</div>`;
  return document.getElementById('out');
};
const block = `<pre data-code-lang="python"><code class="language-python">${CODE.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></pre>`;

beforeEach(load);
afterEach(() => { if (window.ResultsCodeBlocks) window.ResultsCodeBlocks.dispose(); });

describe('decorateCodeBlocks', () => {
  test('wraps a pre once: header with the language, one Copy button; a second call changes nothing', () => {
    const out = card(`<p>text</p>${block}`);
    const tools = window.ResultsCodeBlocks;
    tools.install(document);
    expect(out.querySelectorAll('.code-block')).toHaveLength(1);
    const wrapper = out.querySelector('.code-block');
    expect(wrapper.querySelector('.code-block-header').getAttribute('data-lang')).toBe('python');
    expect(wrapper.querySelectorAll('button.code-block-copy')).toHaveLength(1);
    expect(wrapper.querySelector('button').getAttribute('aria-label')).toBe('Копировать код');
    const before = out.innerHTML;
    tools.decorateCodeBlocks(out);
    tools.decorateCodeBlocks(out);
    expect(out.innerHTML).toBe(before);
  });

  test('language from class language-*, otherwise "code"; a block inside a list item', () => {
    const out = card('<ul><li>step<pre><code class="language-js">a()</code></pre></li></ul><pre>plain</pre>');
    window.ResultsCodeBlocks.install(document);
    expect(Array.from(out.querySelectorAll('.code-block-header'), (h) => h.getAttribute('data-lang'))).toEqual(['js', 'code']);
    expect(out.querySelector('li > .code-block')).not.toBeNull();
  });

  test('the header and the button have no text of their own: the card text is unchanged', () => {
    const out = card(`<p>text</p>${block}`);
    const before = out.textContent;
    window.ResultsCodeBlocks.install(document);
    expect(out.textContent).toBe(before);
  });

  test('a wrapper whose header was removed (saved html through the sanitizer) gets its header again', () => {
    const out = card(`<div class="code-block">${block}</div>`);
    window.ResultsCodeBlocks.install(document);
    expect(out.querySelectorAll('.code-block')).toHaveLength(1);
    expect(out.querySelectorAll('.code-block-copy')).toHaveLength(1);
  });

  test('a pre outside answer containers (diagnostics, prompts) is left alone', () => {
    document.body.innerHTML = '<pre id="log">log</pre><div class="debate-model-card-output"><pre>x</pre></div>';
    window.ResultsCodeBlocks.install(document);
    expect(document.querySelectorAll('.code-block')).toHaveLength(1);
    expect(document.getElementById('log').parentElement.classList.contains('code-block')).toBe(false);
  });

  test('html set later (growth, another render path) is decorated by the observer', async () => {
    const out = card('');
    window.ResultsCodeBlocks.install(document);
    out.innerHTML = block;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(out.querySelectorAll('.code-block-copy')).toHaveLength(1);
  });
});

describe('Copy button', () => {
  test('writes the exact text (indentation, tab, empty lines, trailing spaces) and shows feedback for 1.5 s', async () => {
    const out = card(block);
    window.ResultsCodeBlocks.install(document);
    const writeText = jest.fn(async () => {});
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    jest.useFakeTimers();
    const button = out.querySelector('.code-block-copy');
    button.click();
    await Promise.resolve(); await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(CODE);
    expect(button.classList.contains('is-copied')).toBe(true);
    jest.advanceTimersByTime(1600);
    expect(button.classList.contains('is-copied')).toBe(false);
    jest.useRealTimers();
  });

  test('for a pre without <code> the text is the pre text; without the Clipboard API the textarea route is used', async () => {
    const out = card('<pre>a\n  b</pre>');
    window.ResultsCodeBlocks.install(document);
    Object.defineProperty(window.navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = jest.fn(() => true);
    let copied = null;
    const original = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = original(tag);
      if (tag === 'textarea') Object.defineProperty(el, 'select', { value: () => { copied = el.value; } });
      return el;
    });
    out.querySelector('.code-block-copy').click();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(copied).toBe('a\n  b');
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    jest.restoreAllMocks();
  });
});

describe('sanitizer and normalized html', () => {
  test('data-code-lang and class language-* survive sanitizeHTML', () => {
    const clean = window.sanitizeHTML(block);
    expect(clean).toContain('data-code-lang="python"');
    expect(clean).toContain('class="language-python"');
  });

  test('buildInlineHtml turns a provider code block into the clean pre (engine present) and keeps the old html without it', () => {
    document.body.innerHTML = '<div id="msg"><p>text</p><div class="codeblock"><div class="head"><span>python</span><button>Copy</button></div><pre><code class="hljs language-python"><span class="k">def</span> f():\n    return 1</code></pre></div></div>';
    const html = window.ContentUtils.buildInlineHtml(document.getElementById('msg'), { includeRoot: false });
    const host = document.createElement('div');
    host.innerHTML = html;
    const pre = host.querySelector('pre');
    expect(pre.getAttribute('data-code-lang')).toBe('python');
    expect(pre.querySelector('code').textContent).toBe('def f():\n    return 1');
    expect(pre.querySelector('.k')).toBeNull(); // no syntax highlighting is kept
    expect(host.textContent).not.toMatch(/Copy/);
    delete window.AnswerMarkdown;
    const old = window.ContentUtils.buildInlineHtml(document.getElementById('msg'), { includeRoot: false });
    expect(old).toContain('<pre');
  });

  test('the markdown-to-html result (fenced code) is decorated like any other', () => {
    window.eval(read('shared/markdown-to-html.js'));
    const out = card(window.MarkdownToHtml.render('```ts\nlet a: number = 1;\n```'));
    window.ResultsCodeBlocks.install(document);
    expect(out.querySelector('.code-block-header').getAttribute('data-lang')).toBe('ts');
  });
});

describe('exports', () => {
  test('the exported card html has no code-block furniture (the page decoration is unwrapped)', () => {
    const out = card(`<p>t</p>${block}`);
    window.ResultsCodeBlocks.install(document);
    const Exporter = require('../results/debate-export');
    const feed = document.createElement('div');
    feed.innerHTML = '<div class="debate-model-card" data-session-id="1" data-llm-name="GPT"></div>';
    const cardEl = feed.firstElementChild;
    cardEl.appendChild(out.cloneNode(true));
    cardEl.firstElementChild.className = 'debate-model-card-output';
    const parts = Exporter.cardParts(cardEl);
    expect(parts.body).toContain('<pre');
    expect(parts.body).not.toMatch(/code-block|<button/);
  });
});

describe('stylesheet', () => {
  test('the page stylesheet carries the code-block rules, header on top (label left, button right)', () => {
    const css = read('styles/modals-responsive.css');
    const rules = css.slice(css.indexOf('/* code-block:start */'), css.indexOf('/* code-block:end */'));
    expect(rules).toMatch(/\.code-block-header\{display:flex;[^}]*justify-content:space-between/);
    expect(rules).toMatch(/\.code-block pre\{[^}]*white-space:pre;[^}]*overflow-x:auto/);
  });
});
