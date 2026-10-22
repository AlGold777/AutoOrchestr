/**
 * @jest-environment jsdom
 */
// Markup in these tests is "синтетика, по известной структуре" (KaTeX/MathJax/mermaid/...),
// не проверено вживую на страницах провайдеров. Исключение — fixtures/live-answer-skeletons.
const fs = require('fs');
const path = require('path');
const Blocks = require('../shared/answer-markdown-blocks');

// Minimal engine double: walks the DOM, lets block handlers absorb elements, keeps text as is.
function makeEngine() {
  const handlers = [];
  const placeholders = [];
  const copied = {};
  const engine = {
    registerBlock: (h) => handlers.push(h)
  };
  engine.convert = (el) => {
    placeholders.length = 0;
    Object.keys(copied).forEach((k) => delete copied[k]);
    const sorted = handlers.slice().sort((a, b) => b.priority - a.priority);
    let pos = 0;
    const ctx = {
      provider: null,
      options: {},
      get position() { return pos; },
      text: (e) => e.textContent,
      fence(text, lang) {
        const runs = String(text).match(/`{3,}/g) || [];
        const n = Math.max(3, ...runs.map((r) => r.length + 1));
        return `${'`'.repeat(n)}${lang || ''}\n${text}\n${'`'.repeat(n)}`;
      },
      placeholder(type, reason) {
        pos += 1;
        placeholders.push({ type, reason, position: pos });
        return `[НЕ СКОПИРОВАНО: тип=${type}, причина=${reason}, позиция=${pos}]`;
      },
      convertChildren: (e) => walk(e)
    };
    function walk(node) {
      let out = '';
      node.childNodes.forEach((n) => {
        if (n.nodeType === 3) { out += n.nodeValue; return; }
        if (n.nodeType !== 1) return;
        for (const h of sorted) {
          if (!h.match(n, ctx)) continue;
          const r = h.render(n, ctx);
          if (r) {
            copied[h.type] = (copied[h.type] || 0) + (r.copied === undefined ? 1 : r.copied);
            out += r.markdown;
            return;
          }
        }
        out += walk(n);
      });
      return out;
    }
    return { markdown: walk(el), placeholders: placeholders.slice(), copied: { ...copied } };
  };
  Blocks.register(engine);
  return engine;
}

function conv(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  const engine = makeEngine();
  const result = engine.convert(host);
  result.markdown = result.markdown.replace(/\n{3,}/g, '\n\n').trim();
  result.census = Blocks.census(host);
  return result;
}

const katexInline = (tex) =>
  `<span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>x</mi></mrow>` +
  `<annotation encoding="application/x-tex">${tex}</annotation></semantics></math></span>` +
  `<span class="katex-html" aria-hidden="true"><span class="base"><span class="mord">x</span></span></span></span>`;

describe('formulas', () => {
  test('KaTeX inline -> $tex$, visible aria-hidden layer is not output', () => {
    const r = conv(`<p>Дано ${katexInline('\\frac{a}{b}')} здесь</p>`);
    expect(r.markdown).toBe('Дано $\\frac{a}{b}$ здесь');
    expect(r.copied.math).toBe(1);
    expect(r.census.math).toBe(1);
  });

  test('KaTeX display (.katex-display) -> $$ block', () => {
    const r = conv(`<p>до</p><span class="katex-display">${katexInline('\\int_0^1 x^2 dx')}</span><p>после</p>`);
    expect(r.markdown).toBe('до\n\n$$\n\\int_0^1 x^2 dx\n$$\n\nпосле');
    expect(r.census.math).toBe(1);
  });

  test('inline and display are distinguished in one answer', () => {
    const r = conv(`<p>a ${katexInline('x^2')}</p><div class="katex-display">${katexInline('y^2')}</div>`);
    expect(r.markdown).toContain('$x^2$');
    expect(r.markdown).toContain('$$\ny^2\n$$');
    expect(r.copied.math).toBe(2);
  });

  test('KaTeX without annotation -> placeholder, not scattered glyphs', () => {
    const r = conv('<p>x <span class="katex"><span class="katex-html" aria-hidden="true"><span class="mord">a</span><span class="mord">b</span></span></span></p>');
    expect(r.markdown).toMatch(/\[НЕ СКОПИРОВАНО: тип=math, причина=нет LaTeX-источника/);
    expect(r.markdown).not.toMatch(/ab/);
    expect(r.placeholders).toHaveLength(1);
    expect(r.copied.math).toBe(0);
  });

  test('wrapper with data-math (Gemini-style, не проверено вживую): div -> block, span -> inline', () => {
    const r = conv('<span class="math-inline" data-math="E=mc^2"><span class="katex"><span class="katex-html">E</span></span></span>' +
      '<div class="math-block" data-math="a+b"><span class="katex-display"><span class="katex"><span class="katex-html">a</span></span></span></div>');
    expect(r.markdown).toContain('$E=mc^2$');
    expect(r.markdown).toContain('$$\na+b\n$$');
    expect(r.census.math).toBe(2);
  });

  test('MathJax v2: rendered span + script[type=math/tex] -> one formula', () => {
    const r = conv('<p>f <span class="MathJax_Preview">x</span><span class="MathJax" id="MathJax-Element-1-Frame"><span>x</span><span>2</span></span>' +
      '<script type="math/tex" id="MathJax-Element-1">x^2</script> g</p>');
    expect(r.markdown).toBe('f $x^2$ g');
    expect(r.copied.math).toBe(1);
    expect(r.census.math).toBe(1);
  });

  test('MathJax v2 display: script mode=display', () => {
    const r = conv('<div class="MathJax_Display"><span class="MathJax" id="MathJax-Element-2-Frame">..</span></div>' +
      '<script type="math/tex; mode=display" id="MathJax-Element-2">\\sum_i i</script>');
    expect(r.markdown).toBe('$$\n\\sum_i i\n$$');
    expect(r.copied.math).toBe(1);
  });

  test('MathJax v2: script without rendered sibling still yields the formula', () => {
    const r = conv('<p>a <script type="math/tex">y</script> b</p>');
    expect(r.markdown).toBe('a $y$ b');
  });

  test('MathJax v3 mjx-container: assistive MathML annotation, display attr', () => {
    const inner = '<mjx-assistive-mml><math><semantics><mi>x</mi><annotation encoding="application/x-tex">\\alpha</annotation></semantics></math></mjx-assistive-mml>';
    const r = conv(`<p>a <mjx-container class="MathJax" jax="CHTML"><mjx-math>α</mjx-math>${inner}</mjx-container></p>` +
      `<mjx-container class="MathJax" display="true" jax="CHTML"><mjx-math>β</mjx-math>${inner.replace('\\alpha', '\\beta')}</mjx-container>`);
    expect(r.markdown).toContain('a $\\alpha$');
    expect(r.markdown).toContain('$$\n\\beta\n$$');
  });

  test('MathJax v3 without TeX source -> placeholder', () => {
    const r = conv('<mjx-container class="MathJax"><mjx-math>α</mjx-math><mjx-assistive-mml><math><mi>α</mi></math></mjx-assistive-mml></mjx-container>');
    expect(r.markdown).toMatch(/тип=math/);
    expect(r.placeholders).toHaveLength(1);
  });

  test('data-latex on container (MathJax-style attribute)', () => {
    const r = conv('<mjx-container data-latex="\\gamma"><mjx-math>γ</mjx-math></mjx-container>');
    expect(r.markdown).toBe('$\\gamma$');
  });

  test('bare MathML with annotation; display="block"', () => {
    const m = (d, t) => `<math ${d}><semantics><mi>z</mi><annotation encoding="application/x-tex">${t}</annotation></semantics></math>`;
    const r = conv(`<p>a ${m('', 'z_1')}</p>${m('display="block"', 'z_2')}`);
    expect(r.markdown).toContain('$z_1$');
    expect(r.markdown).toContain('$$\nz_2\n$$');
  });

  test('bare MathML without annotation -> placeholder', () => {
    const r = conv('<p><math><mi>q</mi></math></p>');
    expect(r.placeholders).toHaveLength(1);
  });

  test('remark-math raw class output keeps TeX as text', () => {
    const r = conv('<p><span class="math-inline">\\pi</span></p><div class="math-display">e^{i\\pi}</div>');
    expect(r.markdown).toContain('$\\pi$');
    expect(r.markdown).toContain('$$\ne^{i\\pi}\n$$');
  });
});

describe('diagrams', () => {
  test('pre.mermaid with source text -> ```mermaid', () => {
    const r = conv('<pre class="mermaid">graph TD\n  A--&gt;B\n  B--&gt;C</pre>');
    expect(r.markdown).toBe('```mermaid\ngraph TD\n  A-->B\n  B-->C\n```');
    expect(r.copied.diagram).toBe(1);
    expect(r.census.diagram).toBe(1);
  });

  test('pre > code.language-mermaid', () => {
    const r = conv('<pre><code class="language-mermaid">flowchart LR\n  A --> B\n</code></pre>');
    expect(r.markdown).toBe('```mermaid\nflowchart LR\n  A --> B\n```');
  });

  test('PlantUML / DOT / d2 by language class, aliases normalized', () => {
    const r = conv('<pre><code class="language-puml">@startuml\nA -> B\n@enduml</code></pre>' +
      '<pre><code class="language-graphviz">digraph { a -> b }</code></pre>' +
      '<pre><code class="language-d2">a -> b</code></pre>');
    expect(r.markdown).toContain('```plantuml\n@startuml');
    expect(r.markdown).toContain('```dot\ndigraph');
    expect(r.markdown).toContain('```d2\na -> b');
    expect(r.copied.diagram).toBe(3);
  });

  test('ordinary code language is not a diagram', () => {
    const r = conv('<pre><code class="language-python">print(1)</code></pre>');
    expect(r.markdown).toBe('print(1)');
    expect(r.census.diagram).toBe(0);
  });

  test('inline code with a mermaid class is not claimed', () => {
    expect(conv('<p><code class="language-mermaid">A-->B</code></p>').census.diagram).toBe(0);
  });

  test('rendered mermaid: source in data attribute', () => {
    const r = conv('<div class="mermaid" data-processed="true" data-mermaid="graph TD;A--&gt;B"><svg id="mermaid-1" viewBox="0 0 200 100"><g><text>A</text><text>B</text></g></svg></div>');
    expect(r.markdown).toBe('```mermaid\ngraph TD;A-->B\n```');
    expect(r.markdown).not.toMatch(/<svg/);
  });

  test('rendered mermaid: source in nested hidden pre', () => {
    const r = conv('<div class="mermaid"><svg id="mermaid-2" viewBox="0 0 200 100"><text>A</text></svg><pre hidden>graph LR\nA-->B</pre></div>');
    expect(r.markdown).toBe('```mermaid\ngraph LR\nA-->B\n```');
  });

  test('rendered mermaid: source in adjacent code block is emitted once', () => {
    const r = conv('<div class="mermaid"><svg id="mermaid-3" viewBox="0 0 200 100"><text>A</text></svg></div>' +
      '<pre><code class="language-mermaid">graph TD\nA-->B</code></pre>');
    // the picture is accounted for by the source block next to it; only one fenced block is written
    expect(r.markdown).toBe('```mermaid\ngraph TD\nA-->B\n```');
    expect(r.copied.diagram).toBe(2);
    expect(r.census.diagram).toBe(2);
  });

  test('rendered mermaid without source -> placeholder + SVG source, not node labels', () => {
    const r = conv('<div class="mermaid" data-processed="true"><svg id="mermaid-4" viewBox="0 0 200 100"><g class="node"><text>Узел А</text></g></svg></div>');
    expect(r.markdown).toMatch(/тип=diagram, причина=mermaid: рендерер оставил только SVG без исходника/);
    expect(r.markdown).toContain('```svg\n<svg');
    expect(r.copied.diagram).toBe(0);
    expect(r.placeholders).toHaveLength(1);
    expect(r.census.diagram).toBe(1);
    expect(r.census.svg).toBe(0);
  });

  test('bare mermaid svg (no container class) -> svg-only diagram placeholder', () => {
    const r = conv('<div><svg id="mermaid-9" aria-roledescription="flowchart-v2" viewBox="0 0 300 200"><text>x</text></svg></div>');
    expect(r.placeholders).toHaveLength(1);
    expect(r.placeholders[0].type).toBe('diagram');
  });

  test('bare graphviz svg (no container) is exported as a plain svg block', () => {
    const r = conv('<svg viewBox="0 0 100 100"><g id="graph0" class="graph"><g class="node"><title>a</title></g><g class="edge"><title>a-&gt;b</title></g></g></svg>');
    expect(r.placeholders).toHaveLength(0);
    expect(r.markdown).toContain('```svg\n<svg');
    expect(r.copied.svg).toBe(1);
  });

  test('container div.graphviz with svg only -> svg-only diagram placeholder', () => {
    const r = conv('<div class="graphviz"><svg viewBox="0 0 100 100"><g class="graph"><text>a</text></g></svg></div>');
    expect(r.placeholders[0].type).toBe('diagram');
    expect(r.markdown).toMatch(/dot: рендерер оставил только SVG/);
  });

  test('empty diagram source -> placeholder', () => {
    const r = conv('<pre class="mermaid">  \n </pre>');
    expect(r.placeholders).toHaveLength(1);
  });

  test('fence is longer than backticks inside the source', () => {
    const r = conv('<pre class="mermaid">A["```"]</pre>');
    expect(r.markdown.startsWith('````mermaid')).toBe(true);
  });

  test('renderDiagramSource helper for provider-resolved code language', () => {
    const engine = makeEngine();
    let ctxRef;
    engine.registerBlock({ name: 'spy', type: 'x', priority: 1000, match: () => false, render: () => null });
    const host = document.createElement('div');
    host.innerHTML = '<i></i>';
    // reuse engine ctx by rendering through a throw-away handler
    const spy = { name: 'grab', type: 'x', priority: 2000, match: (e) => e.tagName === 'I', render: (e, ctx) => { ctxRef = ctx; return { markdown: '' }; } };
    engine.registerBlock(spy);
    engine.convert(host);
    const r = Blocks.renderDiagramSource('Mermaid', 'graph TD\nA-->B\n', ctxRef, host);
    expect(r).toEqual({ markdown: '\n\n```mermaid\ngraph TD\nA-->B\n```\n\n', copied: 1 });
    expect(Blocks.renderDiagramSource('python', 'x', ctxRef, host)).toBeNull();
  });
});

describe('svg', () => {
  test('content SVG -> ```svg source with xmlns', () => {
    const r = conv('<p>до</p><svg width="200" height="100" viewBox="0 0 200 100"><rect x="1" y="1" width="50" height="50"/><circle cx="9" cy="9" r="5"/></svg><p>после</p>');
    expect(r.markdown).toMatch(/до\n\n```svg\n<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="200"/);
    expect(r.markdown).toMatch(/<\/svg>\n```\n\nпосле/);
    expect(r.copied.svg).toBe(1);
    expect(r.census.svg).toBe(1);
  });

  test('icons are not claimed (button, aria-hidden, small, use-only)', () => {
    const r = conv('<button><svg width="100" height="100"><path d="M0"/><path d="M1"/></svg></button>' +
      '<svg aria-hidden="true"><path d="M0"/><path d="M1"/></svg><svg width="16" height="16" viewBox="0 0 16 16"><path d="M0"/><path d="M2"/></svg>' +
      '<svg><use href="#i"/></svg><svg class="icon-md"><path d="M0"/><path d="M5"/></svg>');
    expect(r.census).toEqual({ math: 0, diagram: 0, svg: 0, image: 0 });
  });

  test('svg inside a math wrapper belongs to the formula, not to the svg handler', () => {
    const r = conv('<mjx-container data-latex="a"><svg width="300" height="100"><path d="M0"/><path d="M1"/></svg></mjx-container>');
    expect(r.markdown).toBe('$a$');
    expect(r.census.svg).toBe(0);
  });
});

describe('images, canvas, charts', () => {
  test('img: src, alt, title; relative url is resolved', () => {
    const r = conv('<p>до <img src="/a/b.png" alt="Кот" title="Подпись"> после</p>');
    expect(r.markdown).toMatch(/^до !\[Кот\]\(https?:\/\/[^)]*\/a\/b\.png "Подпись"\) после$/);
    expect(r.copied.image).toBe(1);
  });

  test('img without alt gets the word "изображение"; brackets in alt are escaped', () => {
    expect(conv('<img src="https://x.test/a.png">').markdown).toBe('![изображение](https://x.test/a.png)');
    expect(conv('<img src="https://x.test/a.png" alt="a [1] b">').markdown).toBe('![a \\[1\\] b](https://x.test/a.png)');
  });

  test('srcset -> best candidate (w and x descriptors)', () => {
    expect(conv('<img src="https://x.test/s.png" srcset="https://x.test/s.png 320w, https://x.test/m.png 800w, https://x.test/l.png 1600w" alt="a">').markdown)
      .toBe('![a](https://x.test/l.png)');
    expect(conv('<img srcset="https://x.test/1.png 1x, https://x.test/2.png 2x" alt="a">').markdown).toBe('![a](https://x.test/2.png)');
  });

  test('data-URL image is kept; lazy data-src is used', () => {
    expect(conv('<img src="data:image/png;base64,iVBORw0KGgo=" alt="p">').markdown).toBe('![p](data:image/png;base64,iVBORw0KGgo=)');
    expect(conv('<img data-src="https://x.test/lazy.png" alt="l">').markdown).toBe('![l](https://x.test/lazy.png)');
  });

  test('url with spaces/parens is percent-encoded', () => {
    expect(conv('<img src="https://x.test/a (1).png" alt="a">').markdown).toBe('![a](https://x.test/a%20%281%29.png)');
  });

  test('blob: url, missing src and oversized data-URL -> placeholder', () => {
    expect(conv('<img src="blob:https://x.test/1" alt="a">').placeholders).toHaveLength(1);
    expect(conv('<img alt="a">').placeholders).toHaveLength(1);
    expect(conv(`<img src="data:image/png;base64,${'A'.repeat(2000001)}" alt="a">`).placeholders).toHaveLength(1);
  });

  test('UI images (favicon chips, avatars, button content) write nothing and are not counted as content', () => {
    const r = conv('<p>a<span><img class="h-3 w-3 rounded-full"></span><button><img src="https://x.test/i.png" alt="i"></button><img class="avatar" src="https://x.test/u.png" alt="u">b</p>');
    expect(r.markdown).toBe('ab');
    expect(r.census.image).toBe(0);
  });

  test('small image with src and alt is content, not UI', () => {
    expect(conv('<img src="https://x.test/t.png" alt="значок" width="16" height="16">').markdown).toBe('![значок](https://x.test/t.png)');
  });

  test('emoji image is returned as its alt character', () => {
    expect(conv('<p>да <img class="emoji" src="https://x.test/e.png" alt="😀"></p>').markdown).toBe('да 😀');
  });

  test('picture/figure: inner img (srcset from <source> as fallback) keeps order next to the caption text', () => {
    const r = conv('<p>до</p><figure><picture><source srcset="https://x.test/w.webp 800w"><img src="https://x.test/p.png" alt="фото"></picture><figcaption>Рис. 1</figcaption></figure><p>после</p>');
    const order = ['до', '![фото](https://x.test/p.png)', 'Рис. 1', 'после'].map((x) => r.markdown.indexOf(x));
    expect(order.every((v) => v >= 0)).toBe(true);
    expect(order).toEqual(order.slice().sort((a, b) => a - b));
    expect(conv('<picture><source srcset="https://x.test/w.webp 800w, https://x.test/h.webp 1600w"><img alt="a"></picture>').markdown)
      .toBe('![a](https://x.test/h.webp)');
  });

  test('canvas -> data URL via toDataURL', () => {
    const host = document.createElement('div');
    host.innerHTML = '<canvas aria-label="Продажи"></canvas>';
    host.firstChild.toDataURL = () => 'data:image/png;base64,' + 'A'.repeat(40);
    const r = makeEngine().convert(host);
    expect(r.markdown).toBe(`![Продажи](data:image/png;base64,${'A'.repeat(40)})`);
  });

  test('canvas: toDataURL throws (tainted) or unavailable -> placeholder', () => {
    const host = document.createElement('div');
    host.innerHTML = '<canvas></canvas>';
    host.firstChild.toDataURL = () => { throw new Error('SecurityError'); };
    expect(makeEngine().convert(host).placeholders).toHaveLength(1);
    const host2 = document.createElement('div');
    host2.innerHTML = '<canvas></canvas>';
    host2.firstChild.toDataURL = () => null;
    expect(makeEngine().convert(host2).placeholders).toHaveLength(1);
  });

  test('chart container with canvas (ECharts-style) -> image of the canvas, counted once', () => {
    const host = document.createElement('div');
    host.innerHTML = '<div _echarts_instance_="ec_1"><div><canvas></canvas></div></div>';
    host.querySelector('canvas').toDataURL = () => 'data:image/png;base64,' + 'B'.repeat(40);
    const r = makeEngine().convert(host);
    expect(r.markdown).toMatch(/^!\[график ECharts\]\(data:image\/png/);
    expect(r.copied.image).toBe(1);
    expect(Blocks.census(host).image).toBe(1);
  });

  test('chart rendered as SVG (Plotly/Highcharts) without data -> placeholder, not axis labels', () => {
    const r = conv('<div class="js-plotly-plot"><svg class="main-svg" width="600" height="400"><text>0</text><text>10</text></svg></div>');
    expect(r.markdown).toMatch(/тип=image, причина=график Plotly: исходные данные недоступны/);
    expect(r.markdown).not.toMatch(/\b10\b/);
    expect(r.census.svg).toBe(0);
    const h = conv('<div class="highcharts-container"><svg width="600" height="400"><text>Q1</text></svg></div>');
    expect(h.placeholders[0].reason).toMatch(/Highcharts/);
  });

  test('chart with JSON config in a data attribute -> json block (не проверено вживую)', () => {
    const r = conv('<div class="js-plotly-plot" data-chart-config=\'{"type":"bar","data":[1,2]}\'><svg width="600" height="400"><text>x</text></svg></div>');
    expect(r.markdown).toBe('```json\n{"type":"bar","data":[1,2]}\n```');
  });
});

describe('order and robustness', () => {
  test('formula, image, diagram and svg keep their order between text', () => {
    const r = conv(`<p>один</p><div class="katex-display">${katexInline('a')}</div><p>два</p><img src="https://x.test/i.png" alt="i">` +
      '<p>три</p><pre class="mermaid">graph TD;A-->B</pre><p>четыре</p><svg width="90" height="90"><rect width="50" height="50"/><rect width="5" height="5"/></svg><p>пять</p>');
    const text = r.markdown;
    const order = ['один', '$$', 'два', '![i]', 'три', '```mermaid', 'четыре', '```svg', 'пять'].map((s) => text.indexOf(s));
    expect(order.every((v) => v >= 0)).toBe(true);
    expect(order).toEqual(order.slice().sort((a, b) => a - b));
  });

  test('census equals copied + placeholders for a mixed answer', () => {
    const r = conv(`<p>${katexInline('a')}</p><span class="katex"><span class="katex-html">q</span></span><img src="https://x.test/i.png" alt="i"><pre class="mermaid">graph TD;A-->B</pre>`);
    expect(r.census.math).toBe(r.copied.math + r.placeholders.filter((p) => p.type === 'math').length);
    expect(r.census.image).toBe(r.copied.image);
    expect(r.census.diagram).toBe(r.copied.diagram);
  });

  test('handler exception becomes a placeholder, not silence', () => {
    const h = Blocks.HANDLERS.find((x) => x.name === 'image');
    const img = document.createElement('img');
    img.setAttribute('src', 'https://x.test/a.png');
    const out = h.render(img, { placeholder: (t, why) => `[НЕ СКОПИРОВАНО: тип=${t}, причина=${why}, позиция=1]`, text: () => '' });
    expect(out.copied).toBe(1); // control: works
    const bad = h.render({ localName: 'img', closest: () => { throw new Error('boom'); }, getAttribute: () => null }, { placeholder: (t, why) => `[НЕ СКОПИРОВАНО: тип=${t}, причина=${why}, позиция=1]` });
    expect(bad.markdown).toMatch(/причина=ошибка обработчика: boom/);
    expect(bad.copied).toBe(0);
  });

  test('registers into an existing engine on load and exposes handler contract', () => {
    for (const h of Blocks.HANDLERS) {
      expect(typeof h.name).toBe('string');
      expect(['math', 'diagram', 'svg', 'image', 'text', 'code']).toContain(h.type);
      expect(typeof h.priority).toBe('number');
      expect(typeof h.match).toBe('function');
      expect(typeof h.render).toBe('function');
    }
    expect(Blocks.register({})).toBe(false);
  });
});

describe('live skeleton fixtures (tests/fixtures/live-answer-skeletons)', () => {
  const dir = path.join(__dirname, 'fixtures', 'live-answer-skeletons');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json');

  test.each(files)('%s: UI icons and favicons are not blocks; no formulas/diagrams in skeletons', (file) => {
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const html = data.capture && data.capture.html;
    if (!html) return;
    const host = document.createElement('div');
    host.innerHTML = html;
    const c = Blocks.census(host);
    expect(c.math).toBe(0);
    expect(c.diagram).toBe(0);
    expect(c.image).toBe(0);
    expect(c.svg).toBe(0);
  });
});

describe('GFM: pipe-table cells', () => {
  test('display math in a cell is one line $$…$$; fenced blocks become placeholders', () => {
    const r = conv(`<table><tr><td><span class="katex-display">${katexInline('a\\\\b')}</span></td><td><pre class="mermaid">graph TD;A-->B</pre></td><td><svg width="90" height="90"><rect width="5" height="5"/><rect width="9" height="9"/></svg></td><td><img src="https://x.test/i.png" alt="i"></td></tr></table>`);
    expect(r.markdown).toContain('$$a\\\\b$$');
    expect(r.markdown).not.toContain('\n$$');
    expect(r.placeholders.map((p) => p.type)).toEqual(['diagram', 'svg']);
    expect(r.markdown).toContain('![i](https://x.test/i.png)');
  });
});

describe('block math format is fixed to $$ (not ```math)', () => {
  test('display formula is $$ on its own lines', () => {
    expect(conv(`<div class="katex-display">${katexInline('x')}</div>`).markdown).toBe('$$\nx\n$$');
  });
});

// Разметка Mermaid-блока ChatGPT по образцу, присланному пользователем (синтетика, по этой структуре):
// шапка «Код Mermaid» + svg с большим <style> + подписи узлов в foreignObject/span + обычный текст дальше.
// Соглашения id узлов/рёбер mermaid v10/v11 — по памяти, не проверено вживую.
const BIG_CSS = '#chatgpt-mermaid-_r_3n_{font-family:sans-serif;}@keyframes edge-animation-frame{from{stroke-dashoffset:0}}' + '.x{fill:red}'.repeat(500);
const node = (id, x, y, label, extra = '') => `<g class="node default" id="chatgpt-mermaid-_r_3n_-flowchart-${id}-0" data-id="${id}" transform="translate(${x}, ${y})">${extra}<foreignObject><div><span class="nodeLabel"><p>${label}</p></span></div></foreignObject></g>`;
const edge = (a, b, n = 0, cls = 'flowchart-link') => `<path id="chatgpt-mermaid-_r_3n_-L_${a}_${b}_${n}" data-id="L_${a}_${b}_${n}" class="${cls}"/>`;
const chatgptMermaid = (inner, extraBefore = '') => `<div class="block"><div class="header"><span>Код Mermaid</span><button aria-label="Копировать">Copy</button></div>${extraBefore}` +
  `<svg id="chatgpt-mermaid-_r_3n_" width="100%" viewBox="0 0 300 300" aria-roledescription="flowchart-v2" role="graphics-document document"><style>${BIG_CSS}</style><g class="root">${inner}</g></svg></div>`;
const FLOW = '<g class="clusters"><g class="cluster" id="sg1"><rect x="0" y="0" width="150" height="150"/><g class="cluster-label"><foreignObject><span class="nodeLabel"><p>Модули</p></span></foreignObject></g></g></g>' +
  '<g class="edgePaths">' + edge('A', 'B') + edge('B', 'C', 1) + '</g>' +
  '<g class="edgeLabels"><g class="edgeLabel"><g class="label" data-id="L_A_B_0"><foreignObject><span class="nodeLabel"><p>есть</p></span></foreignObject></g></g><g class="edgeLabel"><g class="label" data-id="L_B_C_1"></g></g></g>' +
  '<g class="nodes">' + node('A', 50, 30, 'Семейный реестр') + node('B', 50, 100, 'Источники данных', '<polygon/>') + node('C', 250, 250, 'Календарь') + '</g>';

(fs.existsSync(path.join(__dirname, '..', 'shared', 'answer-markdown.js')) ? describe : describe.skip)('ChatGPT-style mermaid block (синтетика по образцу пользователя)', () => {
  const Engine = require('../shared/answer-markdown');
  beforeAll(() => Blocks.register(Engine));
  const run = (html) => { const h = document.createElement('div'); h.innerHTML = html; return Engine.convert(h, {}); };

  test('svg only: no CSS, no merged labels, header label dropped, flowchart reconstructed and marked', () => {
    const r = run(`<p>Вот схема:</p>${chatgptMermaid(FLOW)}<p>Особенности: текст после.</p>`);
    expect(r.markdown).not.toMatch(/keyframes|font-family|stroke-dashoffset|\.x\{/);
    expect(r.markdown).not.toContain('Код Mermaid');
    expect(r.markdown).not.toMatch(/Семейный реестрИсточники/);
    expect(r.markdown).toContain('```mermaid\n%% реконструировано из SVG, возможны расхождения\nflowchart TD');
    expect(r.markdown).toContain('subgraph sg1 ["Модули"]');
    expect(r.markdown).toContain('A["Семейный реестр"]');
    expect(r.markdown).toContain('B{"Источники данных"}');
    expect(r.markdown).toContain('A -->|есть| B');
    expect(r.markdown).toContain('B --> C');
    expect(r.markdown).toMatch(/```\n+Особенности: текст после\./);
    expect(r.report.found.diagram).toBe(1);
    expect(r.report.copied.diagram).toBe(1);
    expect(r.report.mismatches).toEqual([]);
  });

  test('visible source block in the same wrapper wins: one mermaid block, exact source', () => {
    const r = run(chatgptMermaid(FLOW, '<pre><code class="language-mermaid">graph TD\n  A[Старт] --> B[Конец]</code></pre>'));
    expect(r.markdown.match(/```mermaid/g)).toHaveLength(1);
    expect(r.markdown).toContain('graph TD\n  A[Старт] --> B[Конец]');
    expect(r.markdown).not.toContain('реконструировано');
    expect(r.report.mismatches).toEqual([]);
  });

  test('hidden Code tab / textarea / script type=text/mermaid supply the source', () => {
    expect(run(chatgptMermaid(FLOW, '<div hidden><pre><code class="language-mermaid">graph LR\nX-->Y</code></pre></div>')).markdown).toContain('```mermaid\ngraph LR\nX-->Y\n```');
    expect(run(chatgptMermaid(FLOW, '<textarea>sequenceDiagram\nA->>B: hi</textarea>')).markdown).toContain('```mermaid\nsequenceDiagram\nA->>B: hi\n```');
    expect(run(chatgptMermaid(FLOW, '<script type="text/mermaid">graph TD\nQ-->W</script>')).markdown).toContain('```mermaid\ngraph TD\nQ-->W\n```');
  });

  test('not a flowchart (sequence) and no source: placeholder + svg without the huge CSS', () => {
    const r = run(`<div><span>Mermaid</span><svg id="chatgpt-mermaid-_r_9_" viewBox="0 0 100 100" aria-roledescription="sequence"><style>${BIG_CSS}</style><g class="actor"><text>A</text></g><g><text>B</text></g></svg></div>`);
    expect(r.markdown).toMatch(/тип=diagram, причина=mermaid: рендерер оставил только SVG без исходника; CSS \d+ симв\. вырезан/);
    expect(r.markdown).toContain('```svg\n<svg');
    expect(r.markdown).toContain('<!-- CSS из <style>');
    expect(r.markdown).not.toMatch(/keyframes|font-family/);
    expect(r.markdown).not.toMatch(/^Mermaid$/m);
    expect(r.report.mismatches).toEqual([]);
    expect(r.report.complete).toBe(false);
  });

  test('flowchart with an unresolvable edge is not guessed: falls back to placeholder', () => {
    const bad = FLOW.replace(/L_A_B_0/g, 'L_zz_0');
    expect(run(chatgptMermaid(bad)).markdown).toMatch(/рендерер оставил только SVG/);
  });

  test('small <style> stays; text of <style>/<script> never appears via diagram source helpers', () => {
    const r = run('<div class="mermaid"><style>.a{color:red}</style>graph TD;A-->B</div>');
    expect(r.markdown.trim()).toBe('```mermaid\ngraph TD;A-->B\n```');
  });
});

const enginePath = path.join(__dirname, '..', 'shared', 'answer-markdown.js');
(fs.existsSync(enginePath) ? describe : describe.skip)('integration with the real engine (shared/answer-markdown.js)', () => {
  let Engine;
  beforeAll(() => {
    Engine = require(enginePath);
    Blocks.register(Engine);
  });
  const run = (html) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    return Engine.convert(host, { provider: null });
  };

  test('test-prompt fragment: inline + block formula, mermaid, ASCII tree; report is complete', () => {
    const r = run(`<p>Inline ${katexInline('\\int_0^1 x^2 dx')} text.</p>` +
      `<span class="katex-display">${katexInline('\\int_0^1 x^2 dx')}</span>` +
      '<pre><code class="language-mermaid">flowchart TD\n  A --> B\n  B --> C\n  C --> D</code></pre>' +
      '<pre><code>root/\n├── src/\n│   └── a.js\n└── b.js</code></pre>');
    expect(r.markdown).toContain('Inline $\\int_0^1 x^2 dx$ text.');
    expect(r.markdown).toContain('$$\n\\int_0^1 x^2 dx\n$$');
    expect(r.markdown).toContain('```mermaid\nflowchart TD\n  A --> B\n  B --> C\n  C --> D\n```');
    expect(r.markdown).toContain('root/\n├── src/\n│   └── a.js\n└── b.js');
    expect(r.report.found.math).toBe(2);
    expect(r.report.copied.math).toBe(2);
    expect(r.report.found.diagram).toBe(1);
    expect(r.report.mismatches).toEqual([]);
    expect(r.report.complete).toBe(true);
  });

  test('pipe table with a formula: single-line cell, no mismatch', () => {
    const r = run(`<table><thead><tr><th>f</th></tr></thead><tbody><tr><td><span class="katex-display">${katexInline('a|b')}</span></td></tr></tbody></table>`);
    expect(r.markdown).toContain('$$a\\|b$$');
    expect(r.markdown.split('\n').filter((l) => l.startsWith('|'))).toHaveLength(3);
    expect(r.report.mismatches).toEqual([]);
  });

  test('NBSP and Unicode frames inside an ASCII scheme are preserved (engine code path)', () => {
    const r = run('<pre><code>┌──┐\n│ A│\n└──┘</code></pre>');
    expect(r.markdown).toContain('│ A│');
  });

  test('KaTeX without source: placeholder in text and in the report, report incomplete', () => {
    const r = run('<p>x <span class="katex"><span class="katex-html"><span class="mord">a</span></span></span></p>');
    expect(r.markdown).toMatch(/\[НЕ СКОПИРОВАНО: тип=math, причина=нет LaTeX-источника в разметке, позиция=\d+\]/);
    expect(r.report.placeholders).toHaveLength(1);
    expect(r.report.mismatches).toEqual([]);
    expect(r.report.complete).toBe(false);
  });

  test('rendered mermaid without source: placeholder + svg, accounted in the report', () => {
    const r = run('<div class="mermaid"><svg id="mermaid-1" viewBox="0 0 10 10"><text>A</text></svg></div>');
    expect(r.markdown).toMatch(/тип=diagram/);
    expect(r.report.found.diagram).toBe(1);
    expect(r.report.mismatches).toEqual([]);
    expect(r.report.complete).toBe(false);
  });

  test('image and content svg are counted without mismatch; UI icon svg/img are not placeholders', () => {
    const r = run('<p>a <img src="https://x.test/i.png" alt="i"></p>' +
      '<svg width="120" height="80"><rect width="5" height="5"/><rect width="9" height="9"/></svg>' +
      '<p><span><img class="h-3 w-3"></span><svg class="icon-md"><path d="M0"/></svg>b</p>');
    expect(r.markdown).toContain('![i](https://x.test/i.png)');
    expect(r.markdown).toContain('```svg');
    expect(r.report.mismatches).toEqual([]);
    expect(r.report.placeholders).toEqual([]);
  });

  test('MathJax v2 rendered span + script: one formula, preview text does not leak', () => {
    const r = run('<p>f <span class="MathJax_Preview">PREVIEW</span><span class="MathJax" id="MathJax-Element-7-Frame">x2</span>' +
      '<script type="math/tex" id="MathJax-Element-7">x^2</script> g</p>');
    expect(r.markdown).toContain('f $x^2$ g');
    expect(r.markdown).not.toContain('PREVIEW');
    expect(r.report.mismatches).toEqual([]);
  });

  test('canvas chart and ECharts container are counted once', () => {
    const host = document.createElement('div');
    host.innerHTML = '<canvas id="a"></canvas><div _echarts_instance_="ec_1"><canvas id="b"></canvas></div>';
    host.querySelectorAll('canvas').forEach((c) => { c.toDataURL = () => 'data:image/png;base64,' + 'A'.repeat(40); });
    const r = Engine.convert(host, {});
    expect(r.report.found.image).toBe(2);
    expect(r.report.copied.image).toBe(2);
    expect(r.report.mismatches).toEqual([]);
  });
});

// Синтетика по живому DOM Claude, снятому 2026-10-19: хост div[data-mermaid="true"][role=img] с открытым shadowRoot,
// в нём <style> и div > svg (flowchart-v2) с узлами g.node (id mermaid-<uid>-flowchart-<ID>-<n>), кластерами g.cluster
// и подписями в svg <text>/<tspan>. Исходника в DOM нет. Id рёбер (L_<from>_<to>_<n>) — по соглашению mermaid v11,
// вживую не подтверждены.
describe('Claude mermaid host with open shadowRoot (синтетика по живому DOM Claude, снятому 2026-10-19)', () => {
  const Engine = require('../shared/answer-markdown');
  beforeAll(() => Blocks.register(Engine));
  const U = 'mermaid-r54-r1-b1e1198bc';
  const shadowSvg = (edgesXml) => `<style>.shadow-only-css{fill:red}</style><div><svg id="${U}" aria-roledescription="flowchart-v2" viewBox="0 0 306.28 1388.2" xmlns="http://www.w3.org/2000/svg">` +
    '<style>.node.src rect{fill:#eef}</style><g class="root">' +
    `<g class="clusters"><g class="cluster" id="${U}-REGISTRY"><rect x="0" y="100" width="200" height="100"/><g class="cluster-label"><text><tspan>Семейный реестр</tspan></text></g></g></g>` +
    `<g class="edgePaths">${edgesXml}</g>` +
    '<g class="nodes">' +
    `<g class="node default src" id="${U}-flowchart-A1-0" transform="translate(100, 30)"><rect width="100" height="40"/><g class="label"><text><tspan>Задачи</tspan><tspan>уже есть</tspan></text></g></g>` +
    `<g class="node default core" id="${U}-flowchart-R1-3" transform="translate(100, 150)"><rect width="80" height="40"/><g class="label"><text><tspan>Реестр</tspan></text></g></g>` +
    `<g class="node default done" id="${U}-flowchart-O1-7" transform="translate(100, 300)"><rect width="100" height="40"/><g class="label"><text><tspan>Календарь</tspan></text></g></g>` +
    '</g></g></svg></div>';
  const IDEDGES = `<path id="${U}-L_A1_REGISTRY_0" class="flowchart-link" d="M100,50L100,100"/><path id="${U}-L_REGISTRY_O1_1" class="flowchart-link edge-pattern-dotted" d="M100,200L100,280"/>`;
  const host = (edges) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<p>Схема:</p><div dir="ltr" data-mermaid="true" role="img" aria-label="Диаграмма Mermaid"></div><p>Особенности: после.</p>';
    wrap.querySelector('[data-mermaid]').attachShadow({ mode: 'open' }).innerHTML = shadowSvg(edges);
    return wrap;
  };

  test('light DOM of the host is empty, yet the diagram is reconstructed from the shadow svg; counted found=copied=1', () => {
    const wrap = host(IDEDGES);
    expect(wrap.querySelector('[data-mermaid]').textContent).toBe('');
    expect(wrap.querySelector('svg')).toBeNull();
    const r = Engine.convert(wrap, {});
    expect(r.markdown).toContain('```mermaid\n%% реконструировано из SVG, возможны расхождения\nflowchart TD');
    expect(r.markdown).toContain('A1["Задачи<br/>уже есть"]');
    expect(r.markdown).not.toMatch(/Задачиуже/);
    expect(r.markdown).toContain('subgraph REGISTRY ["Семейный реестр"]');
    expect(r.markdown).toContain('R1["Реестр"]');
    expect(r.markdown).toContain('A1 --> REGISTRY');
    expect(r.markdown).toContain('REGISTRY -.-> O1');
    expect(r.markdown).toContain('class A1 src');
    expect(r.markdown).not.toMatch(/shadow-only-css|fill:#eef/);
    expect(r.markdown).toMatch(/```\n+Особенности: после\./);
    expect(r.report.found.diagram).toBe(1);
    expect(r.report.copied.diagram).toBe(1);
    expect(r.report.mismatches).toEqual([]);
  });

  test('edge ids unknown: edges are recovered from path geometry and marked approximate', () => {
    const r = Engine.convert(host('<path d="M100,50L100,100"/><path class="edge-pattern-dotted" d="M100,200L100,280"/>'), {});
    expect(r.markdown).toContain('%% рёбра определены по геометрии (приблизительно)');
    expect(r.markdown).toContain('A1 --> REGISTRY');
    expect(r.markdown).toContain('REGISTRY --> O1'.replace('-->', '-.->'));
  });

  test('nothing resolvable: placeholder + svg that keeps the shadow-level <style>, never an empty result', () => {
    const r = Engine.convert(host('<path d="M0,0"/>'), {});
    expect(r.markdown).toMatch(/тип=diagram, причина=mermaid: рендерер оставил только SVG без исходника/);
    expect(r.markdown).toContain('```svg');
    expect(r.markdown).toContain('.shadow-only-css{fill:red}');
    expect(r.report.mismatches).toEqual([]);
    expect(r.report.complete).toBe(false);
  });

  test('role=img + aria-label "Mermaid" alone marks a host (without data-mermaid)', () => {
    const w = document.createElement('div');
    w.innerHTML = '<div role="img" aria-label="Диаграмма Mermaid"></div>';
    w.firstChild.attachShadow({ mode: 'open' }).innerHTML = shadowSvg(IDEDGES);
    expect(Engine.convert(w, {}).markdown).toContain('flowchart TD');
  });
});

// Синтетика по живому DOM ChatGPT, снятому 2026-10-19: декларативные компоненты (data-d-component / data-d-direction).
// «Сценарий А»: box[col] -> карточки box[col] (внутри row = svg[icon] 16x16 + text), между карточками svg[icon] 18x18 (стрелка).
describe('ChatGPT DIL components (синтетика по живому DOM ChatGPT, снятому 2026-10-19)', () => {
  const Engine = require('../shared/answer-markdown');
  beforeAll(() => Blocks.register(Engine));
  const run = (html) => { const h = document.createElement('div'); h.innerHTML = html; return Engine.convert(h, {}); };
  const ICON = '<svg data-d-component="icon" width="16" height="16" fill="currentColor"><path d="M0 0h8v8z"/></svg>';
  const ARROW = '<svg data-d-component="icon" width="18" height="18" fill="currentColor"><path d="M9 0v18z"/></svg>';
  const card = (text, cap = '') => `<div data-d-component="box" data-d-direction="col"><div data-d-component="row" data-d-direction="row">${ICON}<p data-d-component="text">${text}</p></div>${cap ? `<p data-d-component="text">${cap}</p>` : ''}</div>`;
  const flow = (dir, cards) => `<div data-d-component="box" data-d-direction="${dir}">${cards.join(ARROW)}</div>`;

  test('column flow: framed cards joined by ↓, no whitespace normalization inside, counted as diagram + reconstructed', () => {
    const r = run(`<p>Сценарий А</p>${flow('col', [card('Запрос', 'пояснение'), card('Проверка'), card('Ответ'), card('Итог')])}<p>После.</p>`);
    const block = r.markdown.match(/```text\n([\s\S]*?)\n```/)[1];
    expect(block).toBe([
      '┌───────────┐', '│ Запрос    │', '│ пояснение │', '└───────────┘', '      ↓',
      '┌──────────┐', '│ Проверка │', '└──────────┘', '      ↓',
      '┌───────┐', '│ Ответ │', '└───────┘', '    ↓',
      '┌──────┐', '│ Итог │', '└──────┘'
    ].join('\n'));
    expect(r.markdown).toMatch(/```\n+После\./);
    expect(r.markdown).not.toMatch(/Запрос\s*\n+\s*Проверка(?!\s*│)/);
    expect(r.report.found.diagram).toBe(1);
    expect(r.report.copied.diagram).toBe(1);
    expect(r.report.mismatches).toEqual([]);
    expect(r.report.placeholders).toEqual([]);
    expect(r.report.flags.reconstructed).toBe(1);
    expect(r.report.flags.reconstructedNotes).toEqual(['блок-схема на HTML-компонентах, не SVG']);
    expect(r.report.found.svg || 0).toBe(0);
  });

  test('NBSP inside a card is kept', () => {
    const r = run(flow('col', [card('а б'), card('в')]));
    expect(r.markdown).toContain('│ а б │');
  });

  test('row flow: cards side by side with →', () => {
    const r = run(flow('row', [card('Один'), card('Два'), card('Три')]));
    const block = r.markdown.match(/```text\n([\s\S]*?)\n```/)[1].split('\n');
    expect(block).toHaveLength(3);
    expect(block[1]).toBe('│ Один │ → │ Два │ → │ Три │');
    expect(r.report.mismatches).toEqual([]);
  });

  test('is idempotent: card text is written once', () => {
    const r = run(flow('col', [card('Уникум'), card('Другой')]));
    expect(r.markdown.match(/Уникум/g)).toHaveLength(1);
  });

  test('plain DIL box with a single card is not a flow; decorative icons are dropped without placeholders', () => {
    const r = run(`<div data-d-component="box" data-d-direction="col">${card('Только карточка')}</div>`);
    expect(r.markdown).not.toContain('```');
    expect(r.markdown).toContain('Только карточка');
    expect(r.report.placeholders).toEqual([]);
    expect(r.report.mismatches).toEqual([]);
  });

  test('DIL row (outside a flow) is one line', () => {
    const r = run(`<div data-d-component="row" data-d-direction="row">${ICON}<span data-d-component="text">Левое</span><span data-d-component="text">Правое</span></div>`);
    expect(r.markdown.trim()).toBe('Левое Правое');
  });

  test('title, caption, divider', () => {
    const r = run('<div data-d-component="title">Заголовок</div><div data-d-component="caption">подпись</div><div data-d-component="divider"></div><div data-d-component="title"><h3>Свой тег</h3></div>');
    expect(r.markdown).toContain('## Заголовок');
    expect(r.markdown).toContain('*подпись*');
    expect(r.markdown).toContain('---');
  });

  test('list / list-item with nesting', () => {
    const r = run('<div data-d-component="list"><div data-d-component="list-item">Один<div data-d-component="list"><div data-d-component="list-item">Вложенный</div></div></div><div data-d-component="list-item">Два</div></div>');
    expect(r.markdown.trim()).toBe('- Один\n  - Вложенный\n- Два');
  });

  test('grid 2x2 -> GFM table (empty header); without columns -> list', () => {
    const item = (t) => `<div data-d-component="grid-item">${t}</div>`;
    const r = run(`<div data-d-component="grid" style="display:grid;grid-template-columns:repeat(2, 1fr)">${item('A')}${item('B')}${item('C')}${item('D')}</div>`);
    expect(r.markdown.trim()).toBe('|   |   |\n| --- | --- |\n| A | B |\n| C | D |');
    const l = run(`<div data-d-component="grid">${item('A')}${item('B')}</div>`);
    expect(l.markdown.trim()).toBe('- A\n- B');
  });

  test('table / table-row / table-cell -> GFM table, pipes escaped', () => {
    const cell = (t) => `<div data-d-component="table-cell">${t}</div>`;
    const row = (...c) => `<div data-d-component="table-row">${c.map(cell).join('')}</div>`;
    const r = run(`<div data-d-component="table">${row('H1', 'H2')}${row('a|b', 'c')}</div>`);
    expect(r.markdown.trim()).toBe('| H1 | H2 |\n| --- | --- |\n| a\\|b | c |');
  });

  test('regression: markup without DIL is unchanged', () => {
    const r = run('<p>Просто текст</p><ul><li>один</li></ul>');
    expect(r.markdown).toContain('Просто текст');
    expect(r.markdown).toContain('- один');
    expect(r.report.flags.reconstructed).toBeUndefined();
  });
});

// Синтетика по живому DOM Perplexity, снятому 2026-10-19: iframe[title="Mermaid diagram"][sandbox] на другом домене
// (содержимое недоступно) + скрытый pre без code-класса с текстом исходника в ближайшем предке.
describe('Perplexity mermaid: cross-origin iframe + hidden pre (синтетика по живому DOM Perplexity, снятому 2026-10-19)', () => {
  const Engine = require('../shared/answer-markdown');
  const Extras = require('../shared/answer-markdown-extras');
  beforeAll(() => { Blocks.register(Engine); Extras.register(Engine); });
  const run = (html) => { const h = document.createElement('div'); h.innerHTML = html; return Engine.convert(h, {}); };
  const frame = '<div><div><iframe title="Mermaid diagram" sandbox="allow-scripts" src="https://render.pplxusercontent.com/m/1" width="720" height="240"></iframe></div></div>';
  const hidden = (src) => `<div style="display:none"><pre>${src}</pre></div>`;
  const pair = (src) => `<div class="d">${frame}${hidden(src)}</div>`;
  const SRC1 = 'flowchart LR\n  subgraph A["Источники"]\n    X --> Y\n  end';
  const SRC2 = 'flowchart TB\n  subgraph B\n    P --> Q\n  end';

  test('two iframes + two hidden pres: exact sources in order, no iframe placeholders, no duplicates, one diagram per pair', () => {
    const r = run(`<p>до</p>${pair(SRC1)}<p>между</p>${pair(SRC2)}<p>после</p>`);
    const i1 = r.markdown.indexOf('```mermaid\n' + SRC1 + '\n```');
    const i2 = r.markdown.indexOf('```mermaid\n' + SRC2 + '\n```');
    expect(i1).toBeGreaterThan(r.markdown.indexOf('до'));
    expect(i2).toBeGreaterThan(r.markdown.indexOf('между'));
    expect(i1).toBeLessThan(r.markdown.indexOf('между'));
    expect(r.markdown.match(/flowchart/g)).toHaveLength(2);
    expect(r.markdown).not.toMatch(/iframe не прочитан|Встроенный блок/);
    expect(r.report.found.diagram).toBe(2);
    expect(r.report.copied.diagram).toBe(2);
    expect(r.report.found.code || 0).toBe(0);
    expect(r.report.found.artifact || 0).toBe(0);
    expect(r.report.placeholders).toEqual([]);
    expect(r.report.mismatches).toEqual([]);
  });

  test('pairs by proximity, not by position in the page: the pre of the second wrapper is not taken by the first iframe', () => {
    const r = run(`<div>${frame}${hidden(SRC1)}</div><div>${frame}${hidden(SRC2)}</div>`);
    expect(r.markdown.indexOf(SRC1)).toBeLessThan(r.markdown.indexOf(SRC2));
    expect(r.report.mismatches).toEqual([]);
  });

  test('iframe without a source: placeholder as before (embed handler), report consistent', () => {
    const r = run(`${pair(SRC1)}<div>${frame}</div>`);
    expect(r.markdown).toContain('```mermaid\n' + SRC1);
    expect(r.markdown).toMatch(/\[НЕ СКОПИРОВАНО: тип=artifact, причина=iframe не прочитан/);
    expect(r.report.mismatches).toEqual([]);
    expect(r.report.copied.diagram).toBe(1);
  });

  test('hidden (computed display:none, as live) mermaid pre without an iframe is written as mermaid source', () => {
    const host = document.createElement('div');
    host.innerHTML = `<style>.hid{display:none}</style><p>x</p><div class="hid"><pre>${SRC1}</pre></div>`;
    document.body.appendChild(host);
    const r = Engine.convert(host, {});
    host.remove();
    expect(r.markdown).toContain('```mermaid\n' + SRC1 + '\n```');
    expect(r.report.found.diagram).toBe(1);
    expect(r.report.copied.diagram).toBe(1);
    expect(r.report.mismatches).toEqual([]);
  });

  test('visible python pre and a visible pre that merely starts with "graph" next to an iframe are not touched', () => {
    const r = run(`<pre><code class="language-python">print(1)</code></pre><div class="d">${frame}<pre>graph of results is below</pre></div>`);
    expect(r.markdown).toContain('print(1)');
    expect(r.markdown).not.toContain('```mermaid');
    expect(r.markdown).toContain('graph of results is below');
  });

  test('a hidden pre that does not look like mermaid is not taken as the source', () => {
    const r = run(`<div class="d">${frame}${hidden('SELECT 1')}</div>`);
    expect(r.markdown).not.toContain('```mermaid');
    expect(r.markdown).toMatch(/iframe не прочитан/);
  });
});

// Синтетика по живому DOM DeepSeek, снятому 2026-10-19: div.md-code-block = шапка (tablist «Diagram»/«Code» + кнопки) +
// скрытый style + svg.flowchart.mermaid-svg#mermaid-svg-N; метки узлов в foreignObject; id узлов flowchart-<ID>-<n> без uid,
// рёбра path.flowchart-link id L_<from>_<to>_<n>, g.edgeLabel по числу рёбер. Исходного pre в DOM нет.
describe('DeepSeek mermaid code block (синтетика по живому DOM DeepSeek, снятому 2026-10-19)', () => {
  const Engine = require('../shared/answer-markdown');
  const Providers = require('../shared/answer-markdown-providers');
  beforeAll(() => { Blocks.register(Engine); Providers.register(Engine); });
  const fo = (inner) => `<foreignObject width="100" height="30"><div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel"><p>${inner}</p></span></div></foreignObject>`;
  const node = (id, n, x, y, label) => `<g class="node default" id="flowchart-${id}-${n}" transform="translate(${x}, ${y})"><rect width="100" height="40"/><g class="label">${fo(label)}</g></g>`;
  const edge = (a, b, cls = 'edge-thickness-normal edge-pattern-solid') => `<path id="L_${a}_${b}_0" class="flowchart-link ${cls}" data-id="L_${a}_${b}_0" d="M0,0L1,1"/>`;
  const elabel = (id, t) => `<g class="edgeLabel"><g class="label" data-id="${id}">${t ? `<foreignObject><div><span class="edgeLabel"><p>${t}</p></span></div></foreignObject>` : ''}</g></g>`;
  const block = (body, lang = '') => `<div class="md-code-block md-code-block-light"><div class="md-code-block-banner"><div role="tablist"><div role="tab" aria-selected="true">Diagram</div><div role="tab">Code</div></div>` +
    '<div role="button" aria-label="Download">Download</div><div role="button">Fullscreen</div></div><style>.md-code-block{color:red}</style>' +
    `<div><svg id="mermaid-svg-3" class="flowchart mermaid-svg" role="graphics-document document" viewBox="-33.4 -33.4 735.3 1904.4"><style>#mermaid-svg-3{font-family:x}</style><g>${body}</g></svg></div></div>${lang}`;
  const BODY = '<g class="edgePaths">' + edge('A', 'B') + edge('B', 'C', 'edge-thickness-normal edge-pattern-dotted') + '</g>' +
    '<g class="edgeLabels">' + elabel('L_A_B_0', 'да') + elabel('L_B_C_0', '') + '</g>' +
    '<g class="nodes">' + node('A', 0, 100, 30, 'Старт') + node('B', 1, 100, 130, 'Первая строка<br>вторая строка') + node('C', 3, 100, 230, 'Финал') + '</g>';
  const run = (html, provider) => { const h = document.createElement('div'); h.innerHTML = html; return Engine.convert(h, { provider }); };

  test('diagram tab block: flowchart reconstructed, header UI text and CSS absent, one diagram, <br> kept in labels', () => {
    for (const provider of [null, 'DeepSeek']) {
      const r = run(`<p>до</p>${block(BODY)}<p>после</p>`, provider);
      expect(r.markdown).toContain('```mermaid\n%% реконструировано из SVG, возможны расхождения\nflowchart TD');
      expect(r.markdown).toContain('A["Старт"]');
      expect(r.markdown).toContain('B["Первая строка<br/>вторая строка"]');
      expect(r.markdown).toContain('A -->|да| B');
      expect(r.markdown).toContain('B -.-> C');
      expect(r.markdown).not.toMatch(/Diagram|Download|Fullscreen|font-family|color:red/);
      expect(r.markdown).not.toMatch(/```\s*\n*\s*(python|json)/);
      expect(r.markdown).toMatch(/```\n+после/);
      expect(r.report.found.diagram).toBe(1);
      expect(r.report.copied.diagram).toBe(1);
      expect(r.report.found.code || 0).toBe(0);
      expect(r.report.placeholders).toEqual([]);
      expect(r.report.mismatches).toEqual([]);
      expect(r.report.flags.reconstructed).toBe(1);
    }
  });

  test('normal thickness is a plain arrow (edge-thickness-normal is not "thick")', () => {
    expect(run(block(BODY)).markdown).not.toContain('==>');
  });

  test('regression: ordinary .md-code-block with pre stays a code block with its language', () => {
    const r = run('<div class="md-code-block"><div class="md-code-block-banner"><span>python</span></div><pre><span>print(1)</span></pre></div>', 'DeepSeek');
    expect(r.markdown).toContain('```python\nprint(1)\n```');
    expect(r.report.found.diagram || 0).toBe(0);
  });
});

// Синтетика по живому DOM Qwen, снятому 2026-10-19: pre.qwen-markdown-code = шапка («mermaid», кнопки с aria-hidden svg,
// «Код», «превью») + div.qwen-markdown-code.mermaid с скрытым Monaco (одна view-line = первая строка исходника, номер строки,
// canvas) + отрисованный svg#mermaid-<id> (id у разных диаграмм бывает одинаковым). Исходник целиком в DOM отсутствует.
// Конвенции sequence/state svg (rect.actor-top, text.messageText, line.messageLine0/1, g.node#state-<name>-<n>,
// path.transition) — по памяти о mermaid v11, вживую не подтверждены.
describe('Qwen mermaid code block (синтетика по живому DOM Qwen, снятому 2026-10-19)', () => {
  const Engine = require('../shared/answer-markdown');
  const Providers = require('../shared/answer-markdown-providers');
  beforeAll(() => { Blocks.register(Engine); Providers.register(Engine); });
  const run = (html, provider = 'Qwen') => { const h = document.createElement('div'); h.innerHTML = html; return Engine.convert(h, { provider }); };
  const ICON = '<button><svg aria-hidden="true" class="icon" viewBox="0 0 16 16"><path d="M0 0h8v8z"/></svg></button>';
  const wrap = (firstLine, svg) => `<pre class="qwen-markdown-code"><div class="hdr"><span>mermaid</span>${ICON.repeat(3)}<span>Код</span><span>превью</span></div>` +
    `<div class="qwen-markdown-code mermaid"><div style="display:none"><div class="monaco-editor" role="code" style="width:0;height:0"><div class="view-lines"><div class="view-line"><span>${firstLine}</span></div></div><div class="line-numbers">1</div><canvas></canvas></div></div>${svg}</div></pre>`;
  const actor = (name, x) => `<g><rect class="actor actor-top" name="${name}" x="${x}" y="0" width="100" height="40"/><text class="actor actor-box" x="${x + 50}" y="20"><tspan>${name}</tspan></text></g>`;
  const SEQ = '<svg id="mermaid-179244703972" aria-roledescription="sequence" viewBox="0 0 702 257">' + actor('Alice', 0) + actor('Bob', 200) +
    '<g><text class="messageText" x="100" y="80">Привет</text><line class="messageLine0" x1="50" y1="90" x2="250" y2="90" marker-end="url(#arrowhead)"/></g>' +
    '<g><text class="messageText" x="100" y="130">Ответ</text><line class="messageLine1" x1="250" y1="140" x2="50" y2="140" marker-end="url(#arrowhead)"/></g>' +
    '<rect class="note" x="150" y="170" width="150" height="30"/><text class="noteText"><tspan>заметка</tspan></text></svg>';
  const fo = (t) => `<foreignObject><div><span class="nodeLabel"><p>${t}</p></span></div></foreignObject>`;
  const FLOW = '<svg id="mermaid-179244703972" aria-roledescription="flowchart-v2" viewBox="0 0 363 376"><g class="edgePaths"><path id="L_A_B_0" class="flowchart-link edge-thickness-normal edge-pattern-solid" d="M1,1L2,2"/></g><g class="edgeLabels"><g class="edgeLabel"><g class="label" data-id="L_A_B_0"></g></g></g>' +
    `<g class="nodes"><g class="node default" id="flowchart-A-0" transform="translate(50, 30)"><rect width="80" height="40"/><g class="label">${fo('Начало')}</g></g><g class="node default" id="flowchart-B-1" transform="translate(50, 130)"><rect width="80" height="40"/><g class="label">${fo('Конец')}</g></g></g></svg>`;
  const STATE = '<svg id="mermaid-1792447" aria-roledescription="stateDiagram" class="statediagram" viewBox="0 0 200 300">' +
    '<g class="edgePaths"><path id="edge0" class="transition" d="M100,27L100,80"/><path id="edge1" class="transition" d="M100,120L100,180"/></g>' +
    '<g class="edgeLabels"><g class="edgeLabel"></g><g class="edgeLabel"><g class="label"><foreignObject><div><span class="edgeLabel"><p>go</p></span></div></foreignObject></g></g></g>' +
    '<g class="nodes"><g class="node default" id="state-root_start-2" transform="translate(100, 20)"><circle r="7"/></g>' +
    `<g class="node default" id="state-Idle-0" transform="translate(100, 100)"><rect width="80" height="40"/>${fo('Idle')}</g>` +
    `<g class="node default" id="state-Running-1" transform="translate(100, 200)"><rect width="80" height="40"/>${fo('Running')}</g></g></svg>`;

  test('sequence: participants, messages with direction/dashes, note; UI header, Monaco line and canvas are not in the output', () => {
    const r = run(`<p>до</p>${wrap('sequenceDiagram', SEQ)}<p>после</p>`);
    expect(r.markdown).toContain('```mermaid\n%% реконструировано из SVG, возможны расхождения\nsequenceDiagram');
    expect(r.markdown).toContain('participant Alice');
    expect(r.markdown).toContain('Alice ->> Bob: Привет');
    expect(r.markdown).toContain('Bob -->> Alice: Ответ');
    expect(r.markdown).toContain('Note over Bob: заметка');
    expect(r.markdown.indexOf('Привет')).toBeLessThan(r.markdown.indexOf('Ответ'));
    expect(r.markdown).not.toMatch(/превью|Код|mermaidКод|^1$/m);
    expect(r.markdown).toMatch(/```\n+после/);
    expect(r.report.found.diagram).toBe(1);
    expect(r.report.copied.diagram).toBe(1);
    expect(r.report.found.code || 0).toBe(0);
    expect(r.report.mismatches).toEqual([]);
    expect(r.report.placeholders).toEqual([]);
    expect(r.report.flags.reconstructed).toBe(1);
  });

  test('flowchart (graph TD) and stateDiagram-v2 are reconstructed by their own rules', () => {
    const f = run(wrap('graph TD', FLOW));
    expect(f.markdown).toContain('flowchart TD');
    expect(f.markdown).toContain('A["Начало"]');
    expect(f.markdown).toContain('A --> B');
    const st = run(wrap('stateDiagram-v2', STATE));
    expect(st.markdown).toContain('stateDiagram-v2');
    expect(st.markdown).toContain('[*] --> Idle');
    expect(st.markdown).toContain('Idle --> Running: go');
    expect(st.markdown).toContain('%% переходы определены по геометрии (приблизительно)');
    expect(st.report.mismatches).toEqual([]);
  });

  test('the same svg id in two diagrams: each block is reconstructed from its own svg', () => {
    const r = run(`${wrap('sequenceDiagram', SEQ)}${wrap('graph TD', FLOW)}`);
    expect(r.markdown).toContain('sequenceDiagram');
    expect(r.markdown).toContain('flowchart TD');
    expect(r.markdown.indexOf('sequenceDiagram')).toBeLessThan(r.markdown.indexOf('flowchart TD'));
    expect(r.report.found.diagram).toBe(2);
    expect(r.report.copied.diagram).toBe(2);
    expect(r.report.mismatches).toEqual([]);
  });

  test('unknown kind or loops: placeholder + svg body only (no header/buttons), never merged junk', () => {
    const pie = '<svg id="mermaid-5" aria-roledescription="pie" viewBox="0 0 100 100"><style>.slice{fill:red}</style><g><path d="M0 0L5 5"/><text>Cats</text></g></svg>';
    const r = run(wrap('pie', pie));
    expect(r.markdown).toMatch(/тип=diagram, причина=mermaid: рендерер оставил только SVG без исходника/);
    expect(r.markdown).toContain('```svg\n<svg');
    expect(r.markdown).toContain('.slice{fill:red}');
    expect(r.markdown).not.toMatch(/превью|mermaidКод|Monaco|monaco|view-line/);
    expect(r.report.mismatches).toEqual([]);
    const loop = run(wrap('sequenceDiagram', SEQ.replace('</svg>', '<line class="loopLine" x1="0" y1="0" x2="5" y2="0"/></svg>')));
    expect(loop.markdown).toContain('```svg');
  });

  test('regression: ordinary Qwen code block (no svg, header buttons only) stays a code block', () => {
    const r = run(`<pre class="qwen-markdown-code"><div class="hdr"><span>python</span>${ICON}</div><code class="language-python">print(1)\nprint(2)</code></pre>`);
    expect(r.report.found.diagram || 0).toBe(0);
    expect(r.report.found.code).toBe(1);
    expect(r.markdown).toContain('print(1)\nprint(2)');
    expect(r.markdown).not.toContain('```mermaid');
  });
});
