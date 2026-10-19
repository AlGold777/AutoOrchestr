/** @jest-environment jsdom */
const AM = require('../shared/answer-markdown');

function el(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}
const md = (html, opts) => AM.convert(el(html), opts || {}).markdown;
const run = (html, opts) => AM.convert(el(html), opts || {});

describe('1. Текст и структура', () => {
  test('заголовки h1–h6', () => {
    const out = md('<h1>A</h1><h2>B</h2><h3>C</h3><h4>D</h4><h5>E</h5><h6>F</h6>');
    expect(out).toBe('# A\n\n## B\n\n### C\n\n#### D\n\n##### E\n\n###### F');
  });

  test('вложенные списки 4 уровня, смешанные, с нумерацией не с 1', () => {
    const out = md('<ul><li>a<ol start="5"><li>b<ul><li>c<ol><li>d</li></ol></li></ul></li><li>b2</li></ol></li></ul>');
    expect(out).toBe('- a\n  5. b\n     - c\n       1. d\n  6. b2');
  });

  test('атрибут start и value у li', () => {
    expect(md('<ol start="5"><li>x</li><li>y</li></ol>')).toBe('5. x\n6. y');
    expect(md('<ol><li value="10">x</li><li>y</li></ol>')).toBe('10. x\n11. y');
  });

  test('абзацы, вложенные цитаты, hr', () => {
    expect(md('<p>one</p><p>two</p>')).toBe('one\n\ntwo');
    expect(md('<blockquote><p>a</p><blockquote><p>b</p></blockquote></blockquote>')).toBe('> a\n>\n> > b');
    expect(md('<p>a</p><hr><p>b</p>')).toBe('a\n\n---\n\nb');
  });

  test('bold/italic/strike и комбинации, пробелы выносятся за маркеры', () => {
    expect(md('<p><b>b</b> <i>i</i> <del>s</del></p>')).toBe('**b** *i* ~~s~~');
    expect(md('<p><strong><em>x</em></strong></p>')).toBe('***x***');
    expect(md('<p>a<b> bold </b>c</p>')).toBe('a **bold** c');
  });

  test('ссылки сохраняют текст и URL', () => {
    expect(md('<p><a href="https://e.com/docs">документация</a></p>')).toBe('[документация](https://e.com/docs)');
    expect(md('<p><a href="https://e.com/a_(b)">x</a></p>')).toBe('[x](https://e.com/a_%28b%29)');
  });

  test('inline-код, в том числе с бэктиками внутри', () => {
    expect(md('<p>use <code>chrome.storage.local</code></p>')).toBe('use `chrome.storage.local`');
    expect(md('<p><code>a`b</code></p>')).toBe('``a`b``');
    expect(md('<p><code>`x`</code></p>')).toBe('`` `x` ``');
  });
});

describe('2. Блоки кода', () => {
  test('содержимое побуквенно: отступы, табы, пустые строки, хвостовые пробелы, длинные строки', () => {
    const code = 'def f():\n\tif x:   \n        return 1\n\n\n    # ' + 'z'.repeat(500);
    const host = document.createElement('div');
    const pre = document.createElement('pre');
    const c = document.createElement('code');
    c.className = 'language-python';
    c.textContent = code + '\n';
    pre.appendChild(c);
    host.appendChild(pre);
    expect(AM.convert(host, {}).markdown).toBe('```python\n' + code + '\n```');
  });

  test('язык: class, data-language, на pre', () => {
    expect(md('<pre><code class="language-json">{}</code></pre>')).toBe('```json\n{}\n```');
    expect(md('<pre data-language="bash"><code>ls</code></pre>')).toBe('```bash\nls\n```');
    expect(md('<pre class="lang-js"><code>1</code></pre>')).toBe('```js\n1\n```');
  });

  test('служебные узлы исключаются: Copy, подпись языка, номера строк, подсветка остаётся текстом', () => {
    const out = md('<pre><div class="header"><span>python</span><button>Copy</button></div>'
      + '<div><code class="language-python"><span class="line"><span class="line-number">1</span>'
      + '<span class="hljs-keyword">print</span>(1)</span>\n<span class="line"><span class="line-number">2</span>x</span></code></div></pre>');
    expect(out).toBe('```python\nprint(1)\nx\n```');
  });

  test('номера строк и кнопка внутри pre без code', () => {
    const out = md('<pre><button>Copy</button><span data-line-number="1"></span>a\nb</pre>');
    expect(out).toBe('```\na\nb\n```');
  });

  test('fence длиннее самого длинного ряда бэктиков внутри', () => {
    const out = md('<pre><code class="language-markdown">```js\nx\n```</code></pre>');
    expect(out).toBe('````markdown\n```js\nx\n```\n````');
    expect(md('<pre><code>`````a</code></pre>')).toBe('``````\n`````a\n``````');
  });

  test('несколько блоков подряд не склеиваются', () => {
    const out = md('<pre><code>a</code></pre><pre><code>b</code></pre>');
    expect(out).toBe('```\na\n```\n\n```\nb\n```');
    expect(run('<pre><code>a</code></pre><pre><code>b</code></pre>').report.copied.code).toBe(2);
  });

  test('код в списке сохраняет отступы относительно содержимого', () => {
    const out = md('<ul><li>step<pre><code class="language-py">if a:\n    b\n\n    c</code></pre></li></ul>');
    expect(out).toBe('- step\n\n  ```py\n  if a:\n      b\n\n      c\n  ```');
  });

  test('код в ячейке таблицы: однострочный — span, многострочный — pre с отступами', () => {
    const out = md('<table><tr><th>A</th><th>B</th></tr><tr><td><code>x|y</code></td>'
      + '<td><pre><code class="language-py">if a:\n    b</code></pre></td></tr></table>');
    expect(out).toContain('| `x\\|y` | <pre><code class="language-py">if a:&#10;    b</code></pre> |');
  });

  test('diff сохраняет + и -', () => {
    const out = md('<pre><code class="language-diff"><span class="hljs-deletion">-old</span>\n<span class="hljs-addition">+new</span>\n context</code></pre>');
    expect(out).toBe('```diff\n-old\n+new\n context\n```');
  });

  test('NBSP и Unicode-рамки в коде не нормализуются', () => {
    const tree = 'src\u00A0\n├── a.js\n│   └── b.js';
    expect(md(`<pre><code>${tree}</code></pre>`)).toBe('```\n' + tree + '\n```');
  });

  test('provider.codeBlock и isUiNode', () => {
    AM.registerProvider('Test1', {
      codeBlock: (e) => (e.classList.contains('cb') ? { lang: 'Rust', text: e.querySelector('.body').textContent } : null),
      isUiNode: (e) => e.classList.contains('chip')
    });
    const out = md('<p>a<span class="chip">UI</span></p><div class="cb"><i>lbl</i><div class="body">fn main() {}</div></div>', { provider: 'Test1' });
    expect(out).toBe('a\n\n```rust\nfn main() {}\n```');
  });
});

describe('3. Таблицы', () => {
  test('заголовок, выравнивание, пустые ячейки, форматирование/ссылки/код в ячейках', () => {
    const out = md('<table><thead><tr><th align="left">L</th><th style="text-align:center">C</th><th align="right">R</th></tr></thead>'
      + '<tbody><tr><td><b>b</b></td><td><a href="http://u">l</a></td><td></td></tr>'
      + '<tr><td><code>c</code></td><td>x</td><td>y</td></tr></tbody></table>');
    expect(out).toBe('| L | C | R |\n| :--- | :---: | ---: |\n| **b** | [l](http://u) |   |\n| `c` | x | y |');
  });

  test('переносы <br> и экранирование |', () => {
    const out = md('<table><tr><th>A</th></tr><tr><td>a|b<br>c</td></tr></table>');
    expect(out).toBe('| A |\n| --- |\n| a\\|b<br>c |');
  });

  test('таблица без th получает пустой заголовок; обёртка прокрутки не мешает', () => {
    const out = md('<div style="overflow-x:auto"><div><table><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div></div>');
    expect(out).toBe('|   |   |\n| --- | --- |\n| 1 | 2 |');
  });

  test('объединённые ячейки -> HTML-таблица', () => {
    const out = md('<table><tr><th colspan="2">H</th></tr><tr><td>a</td><td>b|c</td></tr></table>');
    expect(out).toBe('<table>\n<tr><th colspan="2">H</th></tr>\n<tr><td>a</td><td>b|c</td></tr>\n</table>');
    expect(run('<table><tr><td rowspan="2">x</td></tr></table>').report.copied.table).toBe(1);
  });

  test('provider.tableRoot: обёртка вместо table', () => {
    AM.registerProvider('Test2', { tableRoot: (e) => (e.classList.contains('tw') ? e.querySelector('table') : null) });
    const out = md('<div class="tw"><table><tr><th>A</th></tr><tr><td>1</td></tr></table></div>', { provider: 'Test2' });
    expect(out).toBe('| A |\n| --- |\n| 1 |');
  });
});

describe('11. Символы и кодировка', () => {
  test('NBSP/узкий пробел -> пробел, zero-width удаляются, пробелы схлопываются', () => {
    expect(md('<p>a\u00A0\u00A0b\u202Fc\u200Bd\u2060e\uFEFFf   g</p>')).toBe('a b cdef g');
  });

  test('ZWJ в эмодзи и ZWNJ в персидском слове сохраняются, прочие удаляются', () => {
    const family = '👨\u200D👩\u200D👧';
    expect(md(`<p>${family}</p>`)).toBe(family);
    const persian = 'می\u200Cخواهم';
    expect(md(`<p>${persian}</p>`)).toBe(persian);
    expect(md('<p>ab\u200Dc\u200Cd</p>')).toBe('abcd');
  });

  test('Unicode, эмодзи, RTL, CJK, стрелки без порчи', () => {
    const s = 'Привет 你好 مرحبا 😀 → ∑ ≤';
    expect(md(`<p>${s}</p>`)).toBe(s);
  });

  test('нет двойного экранирования: &lt; и snake_case', () => {
    expect(md('<p>a &lt; b &amp; c, snake_case, 5 * 3, x_1</p>')).toBe('a < b & c, snake_case, 5 * 3, x_1');
    expect(md('<p>&lt;div&gt; &amp;amp;</p>')).toBe('\\<div> \\&amp;');
  });

  test('экранирует только то, что меняет смысл, и один раз', () => {
    expect(md('<p>2*3*4 and _em_ and `t`</p>')).toBe('2\\*3\\*4 and \\_em\\_ and \\`t\\`');
    expect(md('<p>\\* literal</p>')).toBe('\\\\\\* literal');
    expect(md('<p># not heading</p>')).toBe('\\# not heading');
    expect(md('<p>1. not list</p>')).toBe('1\\. not list');
    expect(md('<p>- not bullet</p>')).toBe('\\- not bullet');
  });

  test('ASCII-дерево в pre не нормализуется', () => {
    const tree = '.\n├── src\u00A0\n│   └── a';
    expect(md(`<pre>${tree}</pre>`)).toBe('```\n' + tree + '\n```');
  });
});

describe('12. Census, report, заглушки', () => {
  const sample = '<h2>T</h2><p><a href="http://a">l</a></p><pre><code class="language-js">x</code></pre>'
    + '<table><tr><th>A</th></tr><tr><td><pre><code>y</code></pre></td></tr></table><ul><li>i</li></ul><blockquote>q</blockquote><hr>';

  test('census считает по DOM независимо от конвертации', () => {
    expect(AM.census(el(sample))).toEqual({ heading: 1, link: 1, code: 2, table: 1, list: 1, quote: 1, hr: 1 });
  });

  test('census: диаграмма в pre и код различаются; служебные узлы не считаются', () => {
    const c = AM.census(el('<pre><code class="language-mermaid">graph TD</code></pre><pre><code>x</code></pre><div hidden><pre>z</pre></div><button><a href="http://x">y</a></button>'));
    expect(c).toEqual({ diagram: 1, code: 1 });
  });

  test('report: found == copied, нет mismatch, complete=true', () => {
    const { report } = run(sample, { provider: null });
    expect(report.version).toBe(1);
    expect(report.found).toEqual(report.copied);
    expect(report.placeholders).toEqual([]);
    expect(report.mismatches).toEqual([]);
    expect(report.complete).toBe(true);
  });

  test('неподдержанные типы — заглушка по формату, а не пропуск', () => {
    const { markdown, report } = run('<p>a</p><svg><circle/></svg><span class="katex">x</span>');
    expect(markdown).toMatch(AM.PLACEHOLDER_RE);
    expect(markdown).toContain('[НЕ СКОПИРОВАНО: тип=svg, причина=обработчик типа не подключён, позиция=1]');
    expect(report.placeholders.map((p) => p.type).sort()).toEqual(['math', 'svg']);
    expect(report.found).toEqual({ svg: 1, math: 1 });
    expect(report.mismatches).toEqual([]);
    expect(report.complete).toBe(false);
  });

  test('mermaid в pre сохраняется как исходник с типом diagram', () => {
    const { markdown, report } = run('<pre><code class="language-mermaid">graph TD\n A-->B</code></pre>');
    expect(markdown).toBe('```mermaid\ngraph TD\n A-->B\n```');
    expect(report.copied).toEqual({ diagram: 1 });
    expect(report.complete).toBe(true);
  });

  test('изображение: ![alt](src); без src — заглушка', () => {
    expect(md('<p>x <img src="http://i/a.png" alt="pic"> y</p>')).toBe('x ![pic](http://i/a.png) y');
    const r = run('<img alt="z">');
    expect(r.markdown).toContain('тип=image');
    expect(r.report.complete).toBe(false);
  });

  test('flags из context делают копию неполной', () => {
    const r = run('<p>a</p>', { context: { generating: true, version: '2/3', collapsed: 2, regenerated: true } });
    expect(r.report.flags).toEqual({ generating: true, collapsed: 2, version: '2/3', regenerated: true });
    expect(r.report.complete).toBe(false);
    expect(run('<p>a</p>', { context: { version: '1/1' } }).report.complete).toBe(true);
  });

  test('maxChars: обрезка помечается заглушкой и truncated', () => {
    const r = run('<p>' + 'x'.repeat(100) + '</p>', { maxChars: 20 });
    expect(r.markdown).toContain('причина=превышен maxChars');
    expect(r.report.flags.truncated).toBe(true);
    expect(r.report.complete).toBe(false);
  });

  test('shadow DOM обходится, включая slot', () => {
    const host = document.createElement('div');
    const inner = document.createElement('section');
    host.appendChild(inner);
    const sh = inner.attachShadow({ mode: 'open' });
    sh.innerHTML = '<h3>S</h3><pre><code>in shadow</code></pre><div><slot></slot></div>';
    inner.appendChild(Object.assign(document.createElement('p'), { textContent: 'slotted' }));
    const r = AM.convert(host, {});
    expect(r.markdown).toContain('### S');
    expect(r.markdown).toContain('```\nin shadow\n```');
    expect(r.markdown).toContain('slotted');
    expect(r.report.found).toEqual({ heading: 1, code: 1 });
    expect(r.report.mismatches).toEqual([]);
  });

  test('answerRoot уточняет корень', () => {
    AM.registerProvider('Test3', { answerRoot: (e) => e.querySelector('.ans') });
    expect(md('<div class="meta"><h1>no</h1></div><div class="ans"><p>yes</p></div>', { provider: 'Test3' })).toBe('yes');
  });

  test('mismatch фиксируется как ошибка, если обработчик без censusSelector отдал блок, которого census не видел', () => {
    const off = AM.registerBlock({
      name: 't-ghost', type: 'artifact', priority: 50,
      match: (e) => e.classList && e.classList.contains('ghost'),
      render: () => ({ markdown: 'G' })
    });
    const r = run('<div class="ghost">x</div>');
    off();
    expect(r.report.mismatches).toEqual([{ type: 'artifact', found: 0, copied: 1, placeholders: 0 }]);
    expect(r.report.complete).toBe(false);
  });

  test('глубокая вложенность не роняет конвертацию', () => {
    let html = 'deep';
    for (let i = 0; i < 300; i++) html = `<div>${html}</div>`;
    const r = run(html);
    expect(r.markdown).toMatch(AM.PLACEHOLDER_RE);
    expect(r.report.complete).toBe(false);
  });
});

describe('Хуки registerBlock / registerProvider', () => {
  const offs = [];
  afterEach(() => { while (offs.length) offs.pop()(); });
  const reg = (h) => { offs.push(AM.registerBlock(h)); };

  test('валидация обработчика', () => {
    expect(() => AM.registerBlock({ name: 'x' })).toThrow(TypeError);
    expect(() => AM.registerProvider('', {})).toThrow(TypeError);
  });

  test('приоритет: обработчик пакета (priority>0) побеждает дефолтный движка, даже при равном приоритете 0', () => {
    reg({ name: 't-code0', type: 'code', priority: 0, match: (e) => e.tagName === 'PRE', render: () => ({ markdown: 'CUSTOM0' }) });
    expect(md('<pre><code>a</code></pre>')).toBe('CUSTOM0');
    reg({ name: 't-code9', type: 'code', priority: 9, match: (e) => e.tagName === 'PRE', render: () => ({ markdown: 'CUSTOM9' }) });
    expect(md('<pre><code>a</code></pre>')).toBe('CUSTOM9');
  });

  test('null-отказ передаёт элемент следующему обработчику', () => {
    reg({ name: 't-null', type: 'code', priority: 100, match: () => true, render: () => null });
    expect(md('<pre><code>a</code></pre>')).toBe('```\na\n```');
  });

  test('поглощение потомков: движок не заходит внутрь; found внутри вычитается, copied считается из render', () => {
    reg({
      name: 't-art', type: 'artifact', priority: 100, censusSelector: '.art',
      match: (e) => e.classList && e.classList.contains('art'),
      render: (e, ctx) => ({ markdown: ctx.fence(ctx.text(e), 'html') })
    });
    const r = run('<div class="art"><h1>inside</h1><pre><code>c</code></pre></div><h2>out</h2>');
    expect(r.markdown).toBe('```html\ninsidec\n```\n\n## out');
    expect(r.report.found).toEqual({ artifact: 1, heading: 1 });
    expect(r.report.copied).toEqual({ artifact: 1, heading: 1 });
    expect(r.report.mismatches).toEqual([]);
    expect(r.report.complete).toBe(true);
  });

  test('поглощение без censusSelector: вложенные блоки не дают ложных mismatch', () => {
    reg({ name: 't-wrap', type: 'source', priority: 100, match: (e) => e.classList && e.classList.contains('w'), render: () => ({ markdown: 'W', copied: 1 }) });
    const r = run('<div class="w"><h1>a</h1><a href="http://u">u</a></div>');
    expect(r.report.found).toEqual({});
    expect(r.report.mismatches).toEqual([{ type: 'source', found: 0, copied: 1, placeholders: 0 }]);
  });

  test('подсчёт copied в report: copied из render, тип можно переопределить', () => {
    reg({
      name: 't-math', type: 'math', priority: 100,
      match: (e) => e.classList && e.classList.contains('katex'),
      render: (e) => ({ markdown: '$x$', copied: 1 })
    });
    const r = run('<p>see <span class="katex">x</span> ok</p>');
    expect(r.markdown).toBe('see $x$ ok');
    expect(r.report.copied).toEqual({ math: 1 });
    expect(r.report.found).toEqual({ math: 1 });
    expect(r.report.complete).toBe(true);
  });

  test('блочный результат обработчика отделяется абзацами', () => {
    reg({ name: 't-blk', type: 'math', priority: 100, match: (e) => e.classList && e.classList.contains('katex-display'), render: () => ({ markdown: '$$\nx\n$$' }) });
    expect(md('<p>a</p><span class="katex-display">x</span><p>b</p>')).toBe('a\n\n$$\nx\n$$\n\nb');
  });

  test('исключение в render и в match даёт заглушку с причиной, не пропуск', () => {
    reg({ name: 't-boom', type: 'diagram', priority: 100, match: (e) => e.classList && e.classList.contains('boom'), render: () => { throw new Error('bad svg'); } });
    const r = run('<div class="boom">x</div>');
    expect(r.markdown).toBe('[НЕ СКОПИРОВАНО: тип=diagram, причина=ошибка обработчика t-boom: bad svg, позиция=1]');
    expect(r.report.placeholders).toEqual([{ type: 'diagram', reason: 'ошибка обработчика t-boom: bad svg', position: 1 }]);
    expect(r.report.complete).toBe(false);
    reg({ name: 't-boom2', type: 'diagram', priority: 100, match: () => { throw new Error('m'); }, render: () => ({ markdown: '' }) });
    expect(run('<p>x</p>').report.placeholders.length).toBe(1);
  });

  test('ctx.placeholder учитывается в report; позиция — номер блока', () => {
    reg({
      name: 't-ph', type: 'diagram', priority: 100, censusSelector: '.mm',
      match: (e) => e.classList && e.classList.contains('mm'),
      render: (e, ctx) => ({ markdown: ctx.placeholder('mermaid', 'источник не найден, только картинка', e), copied: 0 })
    });
    const r = run('<h1>a</h1><div class="mm"></div>');
    expect(r.markdown).toBe('# a\n\n[НЕ СКОПИРОВАНО: тип=mermaid, причина=источник не найден, только картинка, позиция=2]');
    const m = AM.PLACEHOLDER_RE.exec(r.markdown);
    expect(m.slice(1)).toEqual(['mermaid', 'источник не найден, только картинка', '2']);
    expect(r.report.found).toEqual({ heading: 1, diagram: 1 });
    expect(r.report.mismatches).toEqual([]);
  });

  test('ctx.convertChildren, ctx.fence, ctx.text, ctx.provider', () => {
    AM.registerProvider('Test4', {});
    let seen;
    reg({
      name: 't-ctx', type: 'artifact', priority: 100, censusSelector: '.c',
      match: (e) => e.classList && e.classList.contains('c'),
      render: (e, ctx) => { seen = ctx.provider; return { markdown: ctx.convertChildren(e) + '\n\n' + ctx.fence('```', 'x') }; }
    });
    const r = run('<div class="c"><h2>t</h2></div>', { provider: 'Test4' });
    expect(seen).toBe('Test4');
    expect(r.markdown).toBe('## t\n\n````x\n```\n````');
  });
});

describe('Тестовый промпт целиком', () => {
  test('заголовки, список, таблица с кодом, python, json, markdown с бэктиками, цитата, ссылка', () => {
    const html = '<h1>H1</h1><h2>H2</h2><h3>H3</h3>'
      + '<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li></ul>'
      + '<table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td>1</td><td><code>x()</code></td><td>3</td></tr></table>'
      + '<pre><code class="language-python">def f():\n    x = 1\n\n    return x</code></pre>'
      + '<pre><code class="language-json">{"a": 1}</code></pre>'
      + '<pre><code class="language-markdown">```js\nfoo\n```</code></pre>'
      + '<blockquote><p>quote</p></blockquote><p><a href="https://e.com">link</a></p>';
    const { markdown, report } = run(html);
    expect(markdown).toContain('````markdown\n```js\nfoo\n```\n````');
    expect(markdown).toContain('    return x');
    expect(markdown).toContain('| 1 | `x()` | 3 |');
    expect(report.mismatches).toEqual([]);
    expect(report.complete).toBe(true);
    expect(report.copied.code).toBe(3);
  });
});

describe('GFM: таблицы и task-списки', () => {
  test('pipe-таблица: выравнивание, пустые ячейки, \\|, <br>', () => {
    const out = md('<table><tr><th align="left">A</th><th align="center">B</th><th align="right">C</th></tr>'
      + '<tr><td></td><td>x|y<br>z</td><td>~~s~~ <del>d</del></td></tr></table>');
    expect(out).toBe('| A | B | C |\n| :--- | :---: | ---: |\n|   | x\\|y<br>z | \\~\\~s\\~\\~ ~~d~~ |');
  });

  test('task-списки: - [ ] и - [x]', () => {
    const out = md('<ul><li><input type="checkbox" disabled> todo</li><li><input type="checkbox" checked disabled> done</li></ul>');
    expect(out).toBe('- [ ] todo\n- [x] done');
    expect(run('<ul><li><input type="checkbox"> a</li></ul>').report.complete).toBe(true);
  });

  test('автоссылка остаётся ссылкой', () => {
    expect(md('<p><a href="https://e.com">https://e.com</a></p>')).toBe('[https://e.com](https://e.com)');
  });
});
