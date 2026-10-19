/** @jest-environment jsdom */
// Сквозная приёмка: тестовый промпт из docs/Architecture/answer-markdown-spec.md.
// Все пакеты загружаются вместе: движок -> blocks -> extras -> providers. Разметка — синтетика, по известной структуре.
const AM = require('../shared/answer-markdown');
const Blocks = require('../shared/answer-markdown-blocks');
const Extras = require('../shared/answer-markdown-extras');
const Providers = require('../shared/answer-markdown-providers');

beforeAll(() => {
  Blocks.register(AM);
  Extras.register(AM);
  Providers.register(AM);
});

const katex = (tex, display) => {
  const inner = `<span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>x</mi></mrow>`
    + `<annotation encoding="application/x-tex">${tex}</annotation></semantics></math></span>`
    + `<span class="katex-html" aria-hidden="true"><span class="mord">x</span></span></span>`;
  return display ? `<span class="katex-display">${inner}</span>` : inner;
};

const TREE = '.\u00A0\n├── src\u00A0\n│   └── a.js\n└── README.md';
const PY = 'def f(x):\n    if x:\n\treturn 1\n\n    # trailing   \n    return 2';

function answer({ mermaid, citation }) {
  const root = document.createElement('div');
  root.innerHTML = '<h1>Один</h1><h2>Два</h2><h3>Три</h3>'
    + '<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li></ul>'
    + '<table><thead><tr><th>A</th><th>B</th><th>C</th></tr></thead><tbody>'
    + '<tr><td>1</td><td><code>f(x)</code></td><td>3</td></tr>'
    + '<tr><td>4</td><td>5</td><td>6</td></tr><tr><td>7</td><td>8</td><td>9</td></tr></tbody></table>'
    + '<pre><code class="language-python"></code></pre>'
    + '<pre><code class="language-json">{"a": [1, 2]}</code></pre>'
    + '<pre><code class="language-markdown">```js\nlet x;\n```</code></pre>'
    + `<p>Inline ${katex('\\int_0^1 x^2 dx', false)} и блок:</p>${katex('\\frac{a}{b}', true)}`
    + (mermaid === 'source'
      ? '<pre><code class="language-mermaid">flowchart TD\n  A-->B\n  B-->C\n  C-->D</code></pre>'
      : '<div class="mermaid"><svg id="mermaid-1" aria-roledescription="flowchart-v2" viewBox="0 0 400 300">'
        + '<g><rect width="50" height="20"/><rect width="50" height="20"/><rect width="50" height="20"/><rect width="50" height="20"/>'
        + '<text>A</text></g></svg></div>')
    + '<pre></pre>'
    + '<p>Смотри <a href="https://e.com/docs">документацию</a>.</p>'
    + '<blockquote><p>цитата</p></blockquote>'
    + (citation ? '<p>Утверждение<sup data-citation><a href="https://src.example/a">1</a></sup>.</p>' : '');
  root.querySelector('pre:empty').textContent = TREE;
  root.querySelectorAll('pre')[0].querySelector('code').textContent = PY;
  return root;
}

const PH = new RegExp(AM.PLACEHOLDER_RE.source, 'g');

describe('приёмка: тестовый промпт', () => {
  test('сноска с источником: [^1] в тексте и определение в конце', () => {
    const { markdown } = AM.convert(answer({ mermaid: 'source', citation: true }), {});
    expect(markdown).toContain('Утверждение[^1].');
    expect(markdown.trim().endsWith('[^1]: https://src.example/a')).toBe(true);
  });

  // БАГ WP3 (shared/answer-markdown-extras.js): обработчики не задают censusSelector, поэтому поглощённый
  // чип источника даёт mismatch {type:'source', found:0, copied:1}. Когда WP3 исправит — убрать .failing.
  test('сноска с источником: report сходится (mismatches пуст)', () => {
    const { report } = AM.convert(answer({ mermaid: 'source', citation: true }), {});
    expect(report.mismatches).toEqual([]);
  });

  test('вариант с исходником Mermaid: всё скопировано, mismatches пуст', () => {
    const { markdown, report } = AM.convert(answer({ mermaid: 'source' }), {});
    expect(markdown).toContain('# Один\n\n## Два\n\n### Три');
    expect(markdown).toContain('- a\n  - b\n    - c');
    expect(markdown).toContain('| A | B | C |\n| --- | --- | --- |\n| 1 | `f(x)` | 3 |');
    expect(markdown).toContain('```python\n' + PY + '\n```');
    expect(markdown).toContain('```json\n{"a": [1, 2]}\n```');
    expect(markdown).toContain('````markdown\n```js\nlet x;\n```\n````');
    expect(markdown).toContain('$\\int_0^1 x^2 dx$');
    expect(markdown).toContain('$$\n\\frac{a}{b}\n$$');
    expect(markdown).toContain('```mermaid\nflowchart TD\n  A-->B\n  B-->C\n  C-->D\n```');
    expect(markdown).toContain('```\n' + TREE + '\n```');
    expect(markdown).toContain('[документацию](https://e.com/docs)');
    expect(markdown).toContain('> цитата');
    expect(report.mismatches).toEqual([]);
    expect(report.placeholders).toEqual([]);
    expect(report.complete).toBe(true);
    expect(report.copied).toEqual(report.found);
  });

  test('вариант «только SVG»: заглушка + SVG-исходник, не тишина; report сходится', () => {
    const { markdown, report } = AM.convert(answer({ mermaid: 'svg' }), {});
    const phs = [...markdown.matchAll(PH)];
    expect(phs.some((m) => m[1] === 'diagram')).toBe(true);
    expect(markdown).toContain('```svg\n<svg');
    expect(report.mismatches).toEqual([]);
    expect(report.complete).toBe(false);
    expect(report.placeholders.filter((p) => p.type === 'diagram')).toHaveLength(1);
  });

  test('идемпотентность: повторная конвертация того же DOM даёт то же', () => {
    const root = answer({ mermaid: 'source' });
    const a = AM.convert(root, {});
    const b = AM.convert(root, {});
    expect(b.markdown).toBe(a.markdown);
    expect(b.report).toEqual(a.report);
    const c = AM.convert(answer({ mermaid: 'svg' }), {});
    const d = AM.convert(answer({ mermaid: 'svg' }), {});
    expect(d).toEqual(c);
  });

  test('census совпадает с report.found', () => {
    const root = answer({ mermaid: 'source' });
    expect(AM.convert(root, {}).report.found).toEqual(AM.census(root, {}));
  });

  test('конфликты обработчиков: код внутри формулы/диаграммы не считается дважды, блоки пакетов приоритетнее дефолтов', () => {
    const { report } = AM.convert(answer({ mermaid: 'source' }), {});
    expect(report.copied.code).toBe(4);
    expect(report.copied.diagram).toBe(1);
    expect(report.copied.math).toBe(2);
    expect(report.copied.table).toBe(1);
  });

  test('с провайдером из реестра (все 10) ответ не ломается', () => {
    ['GPT', 'Gemini', 'Claude', 'Grok', 'Le Chat', 'Qwen', 'DeepSeek', 'Perplexity', 'Z.ai', 'Kimi'].forEach((provider) => {
      const { markdown, report } = AM.convert(answer({ mermaid: 'source' }), { provider });
      expect(markdown).toContain('```python');
      expect(report.mismatches).toEqual([]);
    });
  });
});
