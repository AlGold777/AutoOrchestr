/** @jest-environment jsdom */
// Двойник движка (контракт 4.1): синтетика, по известной структуре. Настоящий shared/answer-markdown.js подключается, если он есть.
const Extras = require('../shared/answer-markdown-extras.js');

function makeEngine() {
  const placeholders = [];
  const copied = {};
  const ctx = {
    report: {}, options: {}, footer: [],
    addFooter(x) { this.footer.push(x); },
    text: (el) => el.textContent,
    convertChildren: (el) => (el.querySelector('table') ? '| a | b |\n| --- | --- |\n| 1 | 2 |' : el.textContent.trim()),
    fence: (t, lang) => '```' + (lang || '') + '\n' + t + '\n```',
    placeholder: (type, reason) => { placeholders.push({ type, reason }); return `[НЕ СКОПИРОВАНО: тип=${type}, причина=${reason}, позиция=${placeholders.length}]`; }
  };
  return {
    placeholders, copied, ctx,
    run(el) {
      const h = Extras.handlers.filter((x) => x.match(el, ctx)).sort((a, b) => b.priority - a.priority)[0];
      if (!h) return null;
      const r = h.render(el, ctx);
      copied[h.type] = (copied[h.type] || 0) + (r.copied || 0);
      return r.markdown;
    }
  };
}
function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }

test('register регистрирует все обработчики с типами artifact/source/file/output', () => {
  const reg = [];
  Extras.register({ registerBlock: (h) => reg.push(h) });
  expect(new Set(reg.map((h) => h.type))).toEqual(new Set(['artifact', 'source', 'file', 'output']));
  reg.forEach((h) => expect(h.priority).toBeGreaterThan(0));
});

test('артефакт: маркер + содержимое отдельным блоком (синтетика)', () => {
  const e = makeEngine();
  const md = e.run(el('<div data-artifact data-artifact-title="Калькулятор" data-artifact-type="html"><pre><code>&lt;p&gt;hi&lt;/p&gt;</code></pre></div>'));
  expect(md).toContain('Артефакт: Калькулятор, html');
  expect(md).toContain('```html\n<p>hi</p>\n```');
  expect(e.copied.artifact).toBe(1);
});

test('артефакт с несколькими версиями: актуальная помечена (синтетика)', () => {
  const e = makeEngine();
  const md = e.run(el(`<div data-artifact data-artifact-title="A" data-artifact-type="python">
    <div data-artifact-version="1"><pre>old</pre></div>
    <div data-artifact-version="2" aria-current="true"><pre>new</pre></div>
    <div data-artifact-version="3"><pre>later</pre></div></div>`));
  expect(md).toContain('версия 2 из 3, актуальная');
  expect(md).toContain('new');
  expect(md).not.toContain('old');
});

test('артефакт-документ идёт через convertChildren; карточка без панели — заглушка', () => {
  const e = makeEngine();
  expect(e.run(el('<div data-artifact data-artifact-title="Док" data-artifact-type="document"><div data-artifact-content>Текст</div></div>'))).toContain('Текст');
  const md = e.run(el('<div data-artifact data-artifact-title="Пусто" data-artifact-type="code"></div>'));
  expect(md).toContain('Артефакт: Пусто, code');
  expect(md).toMatch(/НЕ СКОПИРОВАНО: тип=artifact/);
  expect(e.copied.artifact).toBe(1);
});

test('чип цитаты ChatGPT (реальный атрибут webpage-citation-pill): ссылка сохраняется; без href — заглушка', () => {
  const e = makeEngine();
  expect(e.run(el('<span data-testid="webpage-citation-pill"><a href="https://ex.com/a">ex.com</a></span>'))).toBe('[^1]');
  expect(e.run(el('<sup data-citation><a href="https://ex.com/b">[2]</a></sup>'))).toBe('[^2]');
  expect(e.run(el('<sup data-citation><a href="https://ex.com/a">[3]</a></sup>'))).toBe('[^1]'); // тот же URL — та же сноска
  expect(e.ctx.footer).toEqual(['[^1]: ex.com — https://ex.com/a', '[^2]: https://ex.com/b']);
  // как в живом скелете chatgpt.json: href вырезан санитайзером
  expect(e.run(el('<span data-testid="webpage-citation-pill"><a><span>site</span></a></span>'))).toMatch(/тип=source/);
  expect(e.copied.source).toBe(3);
});

test('без ctx.addFooter чип даёт встроенную ссылку, связь не теряется', () => {
  const e = makeEngine();
  delete e.ctx.addFooter;
  expect(e.run(el('<span data-testid="webpage-citation-pill"><a href="https://ex.com/a">ex.com</a></span>'))).toBe('[ex.com](https://ex.com/a)');
});

test('список источников и карточка поиска: заголовок, URL, сниппет (синтетика)', () => {
  const e = makeEngine();
  const md = e.run(el(`<ol data-source-list><li><a href="https://a.com"><h3>Заголовок А</h3></a><p>Кратко</p></li>
    <li><a href="https://b.com">B [x]</a></li><li><span>Без ссылки</span></li></ol>`));
  expect(md).toContain('Источники:');
  expect(md).toContain('1. [Заголовок А](https://a.com) — Кратко');
  expect(md).toContain('2. [B \\[x\\]](https://b.com)');
  expect(md).toMatch(/НЕ СКОПИРОВАНО: тип=source, причина=у 1 из 3 источников нет URL/);
  expect(e.copied.source).toBe(0);
  expect(e.run(el('<ol data-source-list><li><a href="https://a.com">A</a></li></ol>'))).toContain('1. [A](https://a.com)');
  expect(e.copied.source).toBe(1);
  expect(e.run(el('<div data-search-result><a href="https://c.com"><strong>Карточка</strong></a></div>'))).toBe('1. [Карточка](https://c.com)');
  expect(Extras.handlers.every((h) => typeof h.censusSelector === 'string' && h.censusSelector)).toBe(true);
});

test('файл: имя, тип, URL; без URL — заглушка', () => {
  const e = makeEngine();
  expect(e.run(el('<a download="report.csv" href="https://x/f?id=1">Скачать</a>'))).toBe('[report.csv](https://x/f?id=1)');
  expect(e.run(el('<div data-file-name="a.pdf"><a href="/f/a">a</a></div>'))).toBe('[a.pdf](/f/a)');
  expect(e.run(el('<div data-file-name="b.zip"></div>'))).toMatch(/тип=file/);
});

test('code interpreter: код, вывод, график, файл (синтетика)', () => {
  const e = makeEngine();
  const md = e.run(el(`<div data-code-interpreter data-language="python">
    <pre><code>print(1)\n</code></pre>
    <div data-role="output"><pre>1\n</pre></div>
    <img src="https://x/plot.png" alt="график">
    <table><tr><td>1</td></tr></table>
    <a download="out.csv" href="/o">out.csv</a></div>`));
  expect(md).toContain('| a | b |\n| --- | --- |');
  expect(md).toContain('Код:\n\n```python\nprint(1)\n```');
  expect(md).toContain('Вывод:\n\n```\n1\n```');
  expect(md).toContain('![график](https://x/plot.png)');
  expect(md).toContain('[out.csv](/o)');
  expect(e.copied.output).toBe(1);
  expect(e.run(el('<div data-code-interpreter></div>'))).toMatch(/тип=output/);
});

test('исключение внутри обработчика → заглушка, не пропуск', () => {
  const e = makeEngine();
  const bad = el('<div data-artifact></div>');
  bad.querySelector = () => { throw new Error('boom'); };
  expect(e.run(bad)).toMatch(/НЕ СКОПИРОВАНО: тип=artifact, причина=исключение: boom/);
});

test('CENSUS_SELECTORS соответствуют поглощаемым элементам', () => {
  const root = el('<div><span data-testid="webpage-citation-pill"></span><a download="x"></a><div data-artifact></div><div data-code-interpreter></div></div>');
  const S = Extras.CENSUS_SELECTORS;
  expect(root.querySelectorAll(S.source)).toHaveLength(1);
  expect(root.querySelectorAll(S.file)).toHaveLength(1);
  expect(root.querySelectorAll(S.artifact)).toHaveLength(1);
  expect(root.querySelectorAll(S.output)).toHaveLength(1);
});

const fs = require('fs');
const path = require('path');
const realEnginePath = path.join(__dirname, '../shared/answer-markdown.js');
const maybe = fs.existsSync(realEnginePath) ? describe : describe.skip;
maybe('с настоящим движком shared/answer-markdown.js', () => {
  test('чип цитаты ChatGPT проходит через convert', () => {
    const AM = require(realEnginePath);
    Extras.register(AM);
    const r = AM.convert(el('<div><p>Факт <span data-testid="webpage-citation-pill"><a href="https://ex.com/a">ex.com</a></span></p></div>'), {});
    expect(r.markdown).toMatch(/\[\^1\]|\[ex\.com\]\(https:\/\/ex\.com\/a\)/);
    expect(r.report.copied.source).toBe(1);
  });
});
