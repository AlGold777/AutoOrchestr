/** @jest-environment jsdom */
// Code blocks in answer cards: header with Copy + Просмотр + Скачать (always), download by language map, viewer dialog, line numbers gone.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
let tools;
const load = () => {
  if (window.ResultsCodeBlocks) window.ResultsCodeBlocks.dispose();
  delete window.ResultsCodeBlocks;
  window.eval(read('results/code-blocks.js'));
  tools = window.ResultsCodeBlocks;
};
const card = (html, model = 'Qwen') => {
  document.body.innerHTML = `<div class="debate-model-card" data-llm-name="${model}"><div class="debate-model-card-output" id="out">${html}</div></div>`;
  const out = document.getElementById('out');
  tools.install(document);
  return out;
};
const pre = (lang, code) => `<pre data-code-lang="${lang}"><code>${code.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></pre>`;
const settle = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => {
  load();
  window.URL.createObjectURL = jest.fn(() => 'blob:x');
  window.URL.revokeObjectURL = jest.fn();
  window.HTMLAnchorElement.prototype.click = jest.fn();
});
afterEach(() => { if (window.ResultsCodeBlocks) window.ResultsCodeBlocks.dispose(); document.body.innerHTML = ''; });

describe('header', () => {
  test('three buttons, labels from CSS only (no text in the card)', () => {
    const out = card(pre('python', 'print(1)'));
    const header = out.querySelector('.code-block-header');
    expect(Array.from(header.querySelectorAll('button')).map((b) => b.className.split(' ')[0])).toEqual(['code-block-open', 'code-block-download', 'code-block-copy']);
    expect(out.textContent).toBe('print(1)');
  });

  test('every block gets the same card: in a list, a table cell, a quote, no language, one line', () => {
    const out = card(`<ul><li>${pre('js', 'a()')}</li></ul><table><tr><td>${pre('', 'x')}</td></tr></table><blockquote>${pre('sql', 'select 1')}</blockquote><pre>raw</pre><p>inline <code>c</code></p>`);
    expect(out.querySelectorAll('.code-block')).toHaveLength(4);
    out.querySelectorAll('.code-block').forEach((block) => expect(block.querySelectorAll('.code-block-header .code-block-download')).toHaveLength(1));
    expect(out.querySelector('p code').closest('.code-block')).toBeNull();
  });

  test('a saved card whose header has only Copy gets the new buttons; decorating twice changes nothing', () => {
    const out = card('<div class="code-block"><div class="code-block-header" data-lang="js"><button class="code-block-copy"></button></div><pre><code>a</code></pre></div>');
    expect(out.querySelectorAll('.code-block-download')).toHaveLength(1);
    const before = out.innerHTML;
    tools.decorateCodeBlocks(out); tools.decorateCodeBlocks(out);
    expect(out.innerHTML).toBe(before);
  });
});

describe('download', () => {
  test.each([
    ['python', 'py'], ['javascript', 'js'], ['ts', 'ts'], ['bash', 'sh'], ['yaml', 'yml'], ['markdown', 'md'], ['mermaid', 'mmd'],
    ['csharp', 'cs'], ['rust', 'rs'], ['kotlin', 'kt'], ['diff', 'patch'], ['powershell', 'ps1'], ['whatever', 'txt'], ['code', 'txt']
  ])('%s -> .%s', (lang, ext) => {
    expect(tools.extensionOf(lang)).toBe(ext);
  });

  test('name: <model>-<language>-<N>.<ext>, Dockerfile without extension, forbidden characters removed', () => {
    expect(tools.downloadName('Qwen', 'python', 2)).toBe('Qwen-python-2.py');
    expect(tools.downloadName('', 'code', 1)).toBe('code-text-1.txt');
    expect(tools.downloadName('Le Chat', 'dockerfile', 1)).toBe('Le-Chat-dockerfile-1');
    expect(tools.downloadName('a/b:c', 'c++', 3)).toBe('a-b-c-c++-3.cpp');
  });

  test('click: Blob with the exact text (UTF-8, line breaks), the name by language and the block number, URL revoked, feedback', () => {
    const code = 'def f():\n    return "привет"\n\n';
    const out = card(`${pre('js', 'one')}${pre('python', code)}`);
    const blobs = [];
    window.URL.createObjectURL = jest.fn((blob) => { blobs.push(blob); return 'blob:x'; });
    const anchors = [];
    window.HTMLAnchorElement.prototype.click = jest.fn(function click() { anchors.push({ name: this.download, href: this.href }); });
    const button = out.querySelectorAll('.code-block')[1].querySelector('.code-block-download');
    button.click();
    expect(anchors).toEqual([{ name: 'Qwen-python-2.py', href: 'blob:x' }]);
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
    expect(blobs[0].size).toBe(new TextEncoder().encode(code).length);
    expect(button.classList.contains('is-downloaded')).toBe(true);
  });

  test('no line numbers or labels in the downloaded text: the pre text exactly', async () => {
    const out = card(pre('js', 'a\nb'));
    let blob;
    window.URL.createObjectURL = jest.fn((b) => { blob = b; return 'blob:x'; });
    out.querySelector('.code-block-download').click();
    expect(await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsText(blob); })).toBe('a\nb');
  });
});

describe('viewer', () => {
  const open = (out, i = 0) => { const b = out.querySelectorAll('.code-block')[i].querySelector('.code-block-open'); b.focus(); b.click(); return b; };

  test('opens a dialog (role, label), Esc closes it and the focus returns to the button; click outside closes; the card text is unchanged', () => {
    const out = card(pre('python', 'print(1)'));
    const opener = open(out);
    const dialog = document.querySelector('.code-viewer[role="dialog"]');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toMatch(/python/);
    expect(dialog.querySelector('.code-viewer-code').textContent).toBe('print(1)');
    expect(['Копировать', 'Скачать', 'Закрыть'].every((t) => Array.from(dialog.querySelectorAll('button')).some((b) => b.textContent === t))).toBe(true);
    expect(out.textContent).toBe('print(1)');
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.code-viewer')).toBeNull();
    expect(document.activeElement).toBe(opener);
    open(out);
    document.querySelector('.code-viewer-overlay').click();
    expect(document.querySelector('.code-viewer')).toBeNull();
  });

  test('the close button closes; Tab stays inside the dialog', () => {
    const out = card(pre('go', 'x'));
    open(out);
    const buttons = Array.from(document.querySelectorAll('.code-viewer button:not([hidden])'));
    buttons[buttons.length - 1].focus();
    const tab = new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.querySelector('.code-viewer').contains(document.activeElement)).toBe(true);
    document.querySelector('.code-viewer-close').click();
    expect(document.querySelector('.code-viewer')).toBeNull();
  });

  test('html: a sandboxed iframe (no permissions) with the CSP meta, the block text in srcdoc; switch to the code', () => {
    const html = '<h1>Hi</h1><script>alert(1)</script>';
    open(card(pre('html', html)));
    const frame = document.querySelector('.code-viewer iframe');
    expect(frame.getAttribute('sandbox')).toBe('');
    const srcdoc = frame.getAttribute('srcdoc');
    expect(srcdoc).toContain('http-equiv="Content-Security-Policy"');
    expect(srcdoc).toContain("default-src 'none'");
    expect(srcdoc).toContain(html);
    document.querySelector('.code-viewer-mode[data-mode="code"]').click();
    expect(document.querySelector('.code-viewer iframe')).toBeNull();
    expect(document.querySelector('.code-viewer-code').textContent).toBe(html);
  });

  test('svg: a picture; an svg with a script is shown as code', () => {
    open(card(pre('svg', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>')));
    expect(document.querySelector('.code-viewer img').getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/);
    tools.dispose(); load();
    open(card(pre('svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')));
    expect(document.querySelector('.code-viewer img')).toBeNull();
    expect(document.querySelector('.code-viewer-code')).not.toBeNull();
  });

  test('json: indented; csv: a table; other languages: code with a wrap switch', () => {
    open(card(pre('json', '{"a":[1,2]}')));
    expect(document.querySelector('.code-viewer-code').textContent).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
    tools.dispose(); load();
    open(card(pre('csv', 'a,b\n1,"x,y"\n')));
    expect(Array.from(document.querySelectorAll('.code-viewer td')).map((td) => td.textContent)).toEqual(['1', 'x,y']);
    tools.dispose(); load();
    open(card(pre('rust', 'fn main() {}')));
    const code = document.querySelector('.code-viewer-code');
    expect(code.style.whiteSpace).toBe('pre');
    document.querySelector('.code-viewer-wrap').click();
    expect(document.querySelector('.code-viewer-code').style.whiteSpace).toBe('pre-wrap');
  });

  test('markdown: rendered through MarkdownToHtml and the sanitizer', () => {
    window.eval(read('shared/markdown-to-html.js'));
    window.sanitizeHTML = jest.fn((html) => html.replace(/<script[\s\S]*?<\/script>/g, ''));
    open(card(pre('markdown', '# Title\n\n- a\n- b')));
    expect(document.querySelector('.code-viewer-md h1').textContent).toBe('Title');
    expect(window.sanitizeHTML).toHaveBeenCalled();
    delete window.sanitizeHTML;
  });

  test('mermaid: the diagram (the card render is reused), the source in the code view', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g/></svg>';
    tools.setMermaidLoader(async () => ({ initialize() {}, render: async () => ({ svg }) }));
    const out = card(pre('mermaid', 'flowchart LR\n A-->B'));
    await settle(); await settle();
    open(out);
    await settle();
    expect(document.querySelector('.code-viewer img').getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    document.querySelector('.code-viewer-mode[data-mode="code"]').click();
    expect(document.querySelector('.code-viewer-code').textContent).toBe('flowchart LR\n A-->B');
  });

  test('download from the viewer uses the same name', () => {
    const out = card(`${pre('js', 'a')}${pre('python', 'b')}`);
    const anchors = [];
    window.HTMLAnchorElement.prototype.click = jest.fn(function click() { anchors.push(this.download); });
    open(out, 1);
    document.querySelector('.code-viewer-save').click();
    expect(anchors).toEqual(['Qwen-python-2.py']);
  });
});

describe('line numbers', () => {
  const VARIANTS = {
    'span.line-number': '<span class="line-number">1</span>a\n<span class="line-number">2</span>b',
    'span.linenumber': '<span class="linenumber">1</span>a\n<span class="linenumber">2</span>b',
    'data-line-number': '<span data-line-number="1"></span>a\n<span data-line-number="2"></span>b',
    '.line-numbers-rows': '<span class="line-numbers-rows"><span></span><span></span></span>a\nb',
    '.cm-gutters': '<div class="cm-gutters"><div>1</div><div>2</div></div>a\nb',
    'hljs-ln': '<span class="hljs-ln-numbers">12</span>a\nb',
    'Monaco-like class': '<span class="my-line-num-gutter">1</span>a\nb'
  };
  test.each(Object.keys(VARIANTS))('a raw saved pre with %s: numbers removed by the card, text is the code', (name) => {
    const out = card(`<pre><code>${VARIANTS[name]}</code></pre>`);
    const text = out.querySelector('pre code').textContent;
    expect(text.replace(/\s+$/, '')).toBe('a\nb');
    expect(out.querySelector('.code-block-download')).not.toBeNull();
  });

  test('inline code and text outside pre are left alone', () => {
    const out = card('<p><span class="line-number">7</span> <code>x</code></p>');
    expect(out.querySelector('.line-number')).not.toBeNull();
  });
});

describe('every provider fixture: one card per code block, no provider furniture, no line numbers', () => {
  const dir = path.join(ROOT, 'tests/fixtures/answer-markdown');
  const loadEngine = () => {
    ['AnswerMarkdown', 'AnswerMarkdownBlocks', 'AnswerMarkdownExtras', 'AnswerMarkdownProviders', 'AnswerHtmlBuilder'].forEach((k) => { delete window[k]; });
    window.chrome = window.chrome || { runtime: { id: 'x', sendMessage: jest.fn() } };
    ['shared/answer-markdown.js', 'shared/answer-markdown-blocks.js', 'shared/answer-markdown-extras.js', 'shared/answer-markdown-providers.js',
      'content-scripts/answer-html-builder.js'].forEach((f) => window.eval(read(f)));
  };
  test.each(fs.readdirSync(dir).filter((f) => f.endsWith('.html')))('%s', (file) => {
    loadEngine();
    const source = document.createElement('div');
    source.innerHTML = fs.readFileSync(path.join(dir, file), 'utf8');
    document.body.appendChild(source);
    const html = window.AnswerHtmlBuilder.build(source, { includeRoot: false, provider: file.replace('.html', '') });
    source.remove();
    const out = card(html);
    const pres = out.querySelectorAll('pre');
    expect(out.querySelectorAll('.code-block')).toHaveLength(pres.length);
    out.querySelectorAll('.code-block').forEach((block) => {
      expect(block.querySelectorAll('.code-block-header')).toHaveLength(1);
      expect(Array.from(block.querySelectorAll('button')).every((b) => /^code-block-/.test(b.className))).toBe(true);
      expect(block.querySelector('pre').querySelector('.line-number, .linenumber, [data-line-number], .cm-gutters, .hljs-ln-numbers')).toBeNull();
    });
  });
});
