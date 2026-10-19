// DOM -> Markdown: block handlers for formulas, diagrams, SVG, images and charts.
// Contract: docs/Architecture/answer-markdown-spec.md section 4.1 (registerBlock / ctx).
// Markup knowledge below comes from the known structure of the renderers (KaTeX, MathJax v2/v3,
// mermaid, ...) and is NOT verified live on provider pages unless a comment says otherwise.
(function initAnswerMarkdownBlocks(root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AnswerMarkdownBlocks = api;
  if (root.AnswerMarkdown && typeof root.AnswerMarkdown.registerBlock === 'function') {
    api.register(root.AnswerMarkdown);
  }
})(typeof self !== 'undefined' ? self : globalThis, function factory() {
  'use strict';

  const MAX_DATA_URL = 2000000;
  const MAX_SVG = 500000;

  const DIAGRAM_LANGS = {
    mermaid: 'mermaid',
    plantuml: 'plantuml',
    puml: 'plantuml',
    dot: 'dot',
    graphviz: 'dot',
    gv: 'dot',
    d2: 'd2'
  };
  // data-* attributes in which a renderer may leave the diagram / chart / formula source (not verified live).
  const SOURCE_ATTRS = ['data-mermaid', 'data-mermaid-source', 'data-source', 'data-code', 'data-diagram', 'data-graph', 'data-original'];
  const CHART_CONFIG_ATTRS = ['data-chart-config', 'data-chart', 'data-config', 'data-options', 'data-spec'];
  const TEX_ATTRS = ['data-math', 'data-latex', 'data-tex'];
  const CHART_SELECTOR = '.js-plotly-plot, .highcharts-container, [data-highcharts-chart], [_echarts_instance_]';
  const MATH_SELECTOR = [
    '.katex-display', '.katex', '[data-math]', '[data-latex]', '[data-tex]', '.math-block', '.math-display', '.math-inline',
    '.MathJax_Display', '.MathJax_SVG_Display', '.MathJax', '.MathJax_SVG', '.MathJax_CHTML', '.MathJax_Preview',
    'mjx-container', 'script[type^="math/tex"]', 'math', 'code.language-math'
  ].join(',');
  // What the engine census must count as one math block (script and MathJax_Preview are not blocks).
  const MATH_CENSUS_SELECTOR = MATH_SELECTOR.split(',').filter((x) => x !== 'script[type^="math/tex"]' && x !== '.MathJax_Preview').join(',');
  const RENDERED_MJ = '.MathJax_Display, .MathJax_SVG_Display, .MathJax, .MathJax_SVG, .MathJax_CHTML, mjx-container';
  // Containers the engine census must count as one diagram (pre blocks are counted by the engine itself).
  const DIAGRAM_CENSUS_SELECTOR = ['.mermaid', '[data-mermaid]', '.plantuml', '.graphviz', '.d2', 'svg[id^="mermaid"]', 'svg[aria-roledescription]']
    .concat(Object.keys(DIAGRAM_LANGS).map((k) => `div.language-${k}, div.lang-${k}, span.language-${k}, span.lang-${k}, figure.language-${k}, section.language-${k}`)).join(',');
  const SHAPES = 'path,rect,circle,line,polyline,polygon,ellipse,text,image,foreignObject';

  const lc = (v) => String(v || '').toLowerCase();
  const attr = (el, name) => (el.getAttribute ? el.getAttribute(name) : null);
  const has = (el, sel) => { try { return !!el.matches && el.matches(sel); } catch (_) { return false; } };
  const tag = (el) => lc(el && el.localName);
  const classes = (el) => (el && el.classList ? Array.from(el.classList) : []);

  // GFM pipe-table cells hold one line (the engine turns newlines into <br>): no fenced blocks there.
  const inCell = (el) => !!(el && el.closest && el.closest('td, th'));
  const CELL_REASON = 'многострочный блок в ячейке таблицы';

  function textOf(el, ctx) {
    return ctx && typeof ctx.text === 'function' ? ctx.text(el) : String(el.textContent || '');
  }

  function oneLine(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function stripEdgeNewlines(value) {
    return String(value || '').replace(/^(?:[ \t]*\r?\n)+/, '').replace(/(?:\r?\n[ \t]*)+$/, '');
  }

  // ---------------------------------------------------------------- math

  function texFromAnnotation(el) {
    const list = el.querySelectorAll
      ? Array.from(el.querySelectorAll('annotation')).filter((a) => /tex/i.test(attr(a, 'encoding') || ''))
      : [];
    if (has(el, 'annotation') && /tex/i.test(attr(el, 'encoding') || '')) list.unshift(el);
    const parts = list.map((a) => String(a.textContent || '').trim()).filter(Boolean);
    return parts.length ? parts.join('\n') : null;
  }

  function texFromAttrs(el) {
    const nodes = [el].concat(el.querySelector ? Array.from(el.querySelectorAll('[data-math],[data-latex],[data-tex]')).slice(0, 1) : []);
    for (const node of nodes) {
      for (const name of TEX_ATTRS) {
        const v = attr(node, name);
        if (v && v.trim()) return v.trim();
      }
    }
    return null;
  }

  // MathJax v2: <span class="MathJax" id="MathJax-Element-1-Frame"> ... </span><script type="math/tex" id="MathJax-Element-1">.
  function scriptFor(el) {
    const doc = el.ownerDocument;
    const holder = el.closest ? el.closest('.MathJax_Display, .MathJax_SVG_Display') || el : el;
    const id = attr(el, 'id');
    if (id && /-Frame$/.test(id) && doc) {
      const s = doc.getElementById(id.replace(/-Frame$/, ''));
      if (s && has(s, 'script[type^="math/tex"]')) return s;
    }
    const next = holder.nextElementSibling;
    if (next && has(next, 'script[type^="math/tex"]')) return next;
    return null;
  }

  function renderedBefore(script) {
    const prev = script.previousElementSibling;
    return !!(prev && has(prev, RENDERED_MJ));
  }

  function isDisplay(el, script) {
    if (script && /mode\s*=\s*display/i.test(attr(script, 'type') || '')) return true;
    if (el.closest && el.closest('.katex-display, .MathJax_Display, .MathJax_SVG_Display, .math-block, .math-display')) return true;
    if (el.querySelector && el.querySelector('.katex-display, math[display="block"]')) return true;
    if (has(el, 'math[display="block"], mjx-container[display="true"], .math-block, .math-display')) return true;
    if (has(el, '[data-math], [data-latex], [data-tex]') && tag(el) === 'div') return true;
    return false;
  }

  const SKIP_MATH = (name) => ({ type: 'math', count: 0, name, render: () => ({ markdown: '', copied: 0 }) });

  function analyzeMath(el) {
    if (!has(el, MATH_SELECTOR)) return null;
    // remark-math raw output keeps TeX as text; a wrapper around real renderer output is not raw.
    const rendererInside = !!(el.querySelector && el.querySelector('.katex, mjx-container, .MathJax, .MathJax_SVG, math'));
    const rawClass = has(el, '.math-inline, .math-display, .math-block, code.language-math') && !rendererInside;
    const isScript = tag(el) === 'script';
    if (isScript && renderedBefore(el)) return SKIP_MATH('math');
    if (has(el, '.MathJax_Preview')) return SKIP_MATH('math');
    return {
      type: 'math',
      count: 1,
      name: 'math',
      render(ctx) {
        const script = isScript ? el : scriptFor(el);
        let tex = isScript ? String(el.textContent || '').trim() : texFromAnnotation(el);
        if (!tex) tex = texFromAttrs(el);
        if (!tex && script) tex = String(script.textContent || '').trim();
        if (!tex && rawClass) tex = String(textOf(el, ctx)).trim().replace(/^\$+|\$+$/g, '').trim();
        if (!tex) {
          // KaTeX/MathJax/MathML without a TeX source: scattered glyphs would be wrong text.
          return { markdown: ctx.placeholder('math', 'нет LaTeX-источника в разметке', el), copied: 0 };
        }
        if (isDisplay(el, script)) {
          if (inCell(el)) return { markdown: `$$${tex.replace(/\s*\n\s*/g, ' ')}$$`, copied: 1 };
          return { markdown: `\n\n$$\n${tex}\n$$\n\n`, copied: 1 };
        }
        return { markdown: `$${tex.replace(/\s*\n\s*/g, ' ')}$`, copied: 1 };
      }
    };
  }

  // ---------------------------------------------------------------- svg helpers

  function svgSize(svg) {
    const num = (v) => { const m = /^\s*([\d.]+)\s*(px)?\s*$/.exec(v || ''); return m ? parseFloat(m[1]) : null; };
    const w = num(attr(svg, 'width'));
    const h = num(attr(svg, 'height'));
    if (w !== null || h !== null) return Math.max(w || 0, h || 0);
    const vb = (attr(svg, 'viewBox') || '').trim().split(/[\s,]+/).map(parseFloat);
    if (vb.length === 4 && vb.every(Number.isFinite)) return Math.max(vb[2], vb[3]);
    return null;
  }

  function isIconSvg(svg) {
    if (svg.closest && svg.closest('button, [role="button"]')) return true;
    if (/icon|lucide|anticon|emoji/i.test(attr(svg, 'class') || '')) return true;
    const children = Array.from(svg.children || []);
    if (!children.length) return true;
    if (children.every((c) => tag(c) === 'use')) return true;
    const size = svgSize(svg);
    if (size !== null) return size <= 40;
    if (attr(svg, 'aria-hidden') === 'true') return true;
    if (svg.querySelector && svg.querySelector('title, desc')) return false;
    return svg.querySelectorAll(SHAPES).length <= 1;
  }

  function serializeSvg(svg) {
    let out = svg.outerHTML;
    if (!/^<svg\b[^>]*\sxmlns=/i.test(out)) out = out.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    return out;
  }

  // Bare mermaid svg (no container). Graphviz svg without a container is exported as a plain svg block.
  function svgDiagramLang(svg) {
    return has(svg, 'svg[id^="mermaid"], svg[aria-roledescription]') ? 'mermaid' : null;
  }

  // ---------------------------------------------------------------- diagrams

  function langFromClasses(el) {
    for (const c of classes(el)) {
      const m = /^(?:language|lang)-(.+)$/i.exec(c);
      const name = lc(m ? m[1] : c);
      if (DIAGRAM_LANGS[name] && (m || ['mermaid', 'plantuml', 'graphviz', 'd2'].includes(name))) return DIAGRAM_LANGS[name];
    }
    return null;
  }

  function langFromData(el) {
    for (const name of ['data-language', 'data-lang', 'data-code-language']) {
      const v = lc(attr(el, name));
      if (DIAGRAM_LANGS[v]) return DIAGRAM_LANGS[v];
    }
    return null;
  }

  // Same lookup order as the engine's code language probe for <pre>: itself, inner <code>, parent.
  function detectLang(el) {
    const t = tag(el);
    if (t === 'pre') {
      const code = el.querySelector('code');
      return langFromData(el) || langFromClasses(el) || (code && (langFromData(code) || langFromClasses(code)))
        || (el.parentElement && (langFromData(el.parentElement) || langFromClasses(el.parentElement))) || null;
    }
    if (['div', 'span', 'figure', 'section'].includes(t)) return langFromClasses(el);
    return null;
  }

  function attrSource(el) {
    for (const node of [el, el.parentElement]) {
      if (!node) continue;
      for (const name of SOURCE_ATTRS) {
        const v = attr(node, name);
        if (v && v.trim() && !/^(true|false)$/i.test(v.trim())) return v;
      }
    }
    return null;
  }

  function innerSource(el, ctx) {
    const cand = Array.from(el.querySelectorAll('textarea, script[type*="mermaid"], script[type="text/plain"], pre, code'))
      .filter((n) => !n.querySelector('svg') && !(n.closest && n.closest('svg')));
    for (const n of cand) {
      const t = textOf(n, ctx);
      if (t.trim()) return t;
    }
    return null;
  }

  // A rendered diagram whose source lives in a neighbouring panel ("Code view" next to
  // "Preview"), possibly hidden: the nearest ancestor (up to 3 levels, never one holding
  // another picture) with exactly one <pre> that has no svg. Hidden text is read here on
  // purpose (the engine skips it as visible content); it is never copied as ordinary text.
  const MERMAID_START = /^\s*(?:%%\{[\s\S]*?\}%%\s*)?(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|journey|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|C4Context)\b/;
  function hiddenWithin(node, scope) {
    for (let n = node; n && n !== scope.parentElement; n = n.parentElement) {
      if (n.hidden || attr(n, 'aria-hidden') === 'true' || /display\s*:\s*none/i.test(attr(n, 'style') || '')) return true;
    }
    return false;
  }

  function scopedSource(svg, ctx) {
    let scope = svg.parentElement;
    for (let depth = 0; scope && depth < 3 && tag(scope) !== 'body'; depth += 1, scope = scope.parentElement) {
      if (scope.querySelectorAll('svg').length !== 1) return null;
      const pres = Array.from(scope.querySelectorAll('pre')).filter((n) => !n.querySelector('svg') && !(n.closest && n.closest('svg')));
      if (pres.length === 1) {
        // Only a hidden panel: a visible one is already copied by the engine as a code block.
        if (!hiddenWithin(pres[0], scope)) return null;
        const text = textOf(pres[0], ctx);
        return text.trim() ? text : null;
      }
      if (pres.length > 1) return null;
    }
    return null;
  }

  function siblingSource(el, lang) {
    return [el.previousElementSibling, el.nextElementSibling].some((s) => s && !s.querySelector('svg') && detectLang(s) === lang);
  }

  // Shared with the engine: a code block whose provider-resolved language is a diagram language.
  function renderDiagramSource(lang, text, ctx, el) {
    const name = DIAGRAM_LANGS[lc(lang)];
    if (!name) return null;
    if (inCell(el)) return { markdown: ctx.placeholder('diagram', CELL_REASON + ' (' + name + ')', el), copied: 0 };
    const body = stripEdgeNewlines(text);
    if (!body.trim()) return { markdown: ctx.placeholder('diagram', 'пустой исходник диаграммы ' + name, el), copied: 0 };
    return { markdown: `\n\n${ctx.fence(body, name)}\n\n`, copied: 1 };
  }

  function svgOnlyDiagram(el, svg, lang, ctx) {
    const note = ctx.placeholder('diagram', `${lang}: рендерер оставил только SVG без исходника`, el);
    if (inCell(el)) return { markdown: note, copied: 0 };
    const src = serializeSvg(svg);
    if (src.length > MAX_SVG) return { markdown: note, copied: 0 };
    return { markdown: `\n\n${note}\n\n${ctx.fence(src, 'svg')}\n\n`, copied: 0 };
  }

  function analyzeDiagram(el) {
    const t = tag(el);
    if (t === 'svg') {
      if (el.parentNode && el.parentNode.closest && el.parentNode.closest('svg')) return null;
      if (isIconSvg(el)) return null;
      const lang = svgDiagramLang(el);
      if (!lang) return null;
      return {
        type: 'diagram', count: 1, name: 'diagram',
        render(ctx) {
          const kind = lang;
          const src = attrSource(el) || scopedSource(el, ctx);
          if (src) return renderDiagramSource(kind, src, ctx, el);
          return svgOnlyDiagram(el, el, kind, ctx);
        }
      };
    }
    const lang = detectLang(el);
    if (!lang) return null;
    const svg = el.querySelector('svg');
    if (svg && siblingSource(el, lang)) {
      // The rendered picture is represented by the neighbouring source block (which is counted itself).
      return { type: 'diagram', count: 1, name: 'diagram', render: () => ({ markdown: '', copied: 1 }) };
    }
    return {
      type: 'diagram', count: 1, name: 'diagram',
      render(ctx) {
        let source = attrSource(el);
        if (source === null && !svg) source = textOf(el, ctx);
        if (source === null) source = innerSource(el, ctx);
        if (source !== null) return renderDiagramSource(lang, source, ctx, el);
        if (svg) return svgOnlyDiagram(el, svg, lang, ctx);
        return { markdown: ctx.placeholder('diagram', 'пустой исходник диаграммы ' + lang, el), copied: 0 };
      }
    };
  }

  // ---------------------------------------------------------------- plain svg

  function analyzeSvg(el) {
    if (tag(el) !== 'svg') return null;
    if (el.parentNode && el.parentNode.closest && el.parentNode.closest('svg')) return null;
    // UI icon: not content. The engine census counts every non-hidden svg, so the icon is accounted
    // for with an empty render (it disappears from the census as soon as the engine skips icons itself).
    if (isIconSvg(el)) return { type: 'svg', count: 1, ui: true, name: 'svg', render: () => ({ markdown: '', copied: 1 }) };
    return {
      type: 'svg', count: 1, name: 'svg',
      render(ctx) {
        // A marker-less picture whose hidden "Code view" panel holds mermaid source: copy the source.
        const panel = inCell(el) ? null : scopedSource(el, ctx);
        if (panel && MERMAID_START.test(panel)) return { markdown: `\n\n${ctx.fence(stripEdgeNewlines(panel), 'mermaid')}\n\n`, copied: 1 };
        const src = serializeSvg(el);
        if (inCell(el)) return { markdown: ctx.placeholder('svg', CELL_REASON, el), copied: 0 };
        if (src.length > MAX_SVG) return { markdown: ctx.placeholder('svg', 'SVG слишком большой', el), copied: 0 };
        return { markdown: `\n\n${ctx.fence(src, 'svg')}\n\n`, copied: 1 };
      }
    };
  }

  // ---------------------------------------------------------------- images, canvas, charts

  const escAlt = (v) => oneLine(v).replace(/([[\]\\])/g, '\\$1');
  const escTitle = (v) => oneLine(v).replace(/"/g, '\\"');
  const fmtUrl = (u) => String(u).replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/</g, '%3C').replace(/>/g, '%3E');

  function resolveUrl(el, raw) {
    if (!raw || /^(data|blob|javascript):/i.test(raw)) return raw;
    try { return new URL(raw, el.ownerDocument && el.ownerDocument.baseURI).href; } catch (_) { return raw; }
  }

  function bestFromSrcset(srcset) {
    let best = null;
    for (const part of String(srcset || '').split(/,\s+(?=\S)/)) {
      const m = /^\s*(\S+)(?:\s+([\d.]+)([wx]))?\s*$/.exec(part);
      if (!m) continue;
      const score = m[2] ? parseFloat(m[2]) * (m[3] === 'x' ? 1000 : 1) : 0;
      if (!best || score > best.score) best = { url: m[1], score };
    }
    return best ? best.url : null;
  }

  function imgSource(img) {
    const pic = img.parentElement && tag(img.parentElement) === 'picture' ? img.parentElement : null;
    const fromSources = pic ? Array.from(pic.querySelectorAll('source')).map((s) => bestFromSrcset(attr(s, 'srcset'))).filter(Boolean)[0] : null;
    const raw = bestFromSrcset(attr(img, 'srcset')) || attr(img, 'src') || attr(img, 'data-src') || attr(img, 'data-original') || fromSources || '';
    return raw.trim();
  }

  function isUiImg(img) {
    if (img.closest && img.closest('button, [role="button"]')) return true;
    if (/(^|\s)(?:size|h|w)-[1-4](\s|$)|favicon|avatar/i.test(attr(img, 'class') || '')) return true;
    return !imgSource(img) && !(attr(img, 'alt') || '').trim();
  }

  function imageMarkdown(img, ctx) {
    const raw = imgSource(img);
    const alt = attr(img, 'alt') || attr(img, 'aria-label') || '';
    if (!raw) return { markdown: ctx.placeholder('image', 'у изображения нет src', img), copied: 0 };
    if (/^blob:/i.test(raw)) return { markdown: ctx.placeholder('image', 'blob-URL недоступен вне страницы', img), copied: 0 };
    if (/^data:/i.test(raw) && raw.length > MAX_DATA_URL) return { markdown: ctx.placeholder('image', 'data-URL слишком велик', img), copied: 0 };
    const url = fmtUrl(resolveUrl(img, raw));
    const title = attr(img, 'title');
    return { markdown: `![${escAlt(alt) || 'изображение'}](${url}${title ? ` "${escTitle(title)}"` : ''})`, copied: 1 };
  }

  function canvasMarkdown(canvas, ctx, label) {
    let url = null;
    try { url = canvas.toDataURL('image/png'); } catch (_) { url = null; } // tainted canvas throws
    const alt = attr(canvas, 'aria-label') || attr(canvas, 'title') || label || 'изображение (canvas)';
    if (!url || !/^data:image\//i.test(url) || url.length < 30) return { markdown: ctx.placeholder('image', 'canvas недоступен для экспорта', canvas), copied: 0 };
    if (url.length > MAX_DATA_URL) return { markdown: ctx.placeholder('image', 'data-URL слишком велик', canvas), copied: 0 };
    return { markdown: `![${escAlt(alt)}](${url})`, copied: 1 };
  }

  function chartLib(el) {
    if (has(el, '.js-plotly-plot')) return 'Plotly';
    if (has(el, '.highcharts-container, [data-highcharts-chart]')) return 'Highcharts';
    if (has(el, '[_echarts_instance_]')) return 'ECharts';
    return 'график';
  }

  function analyzeImage(el) {
    const t = tag(el);
    if (t === 'img') {
      if (/(^|\s)emoji(\s|$)/i.test(attr(el, 'class') || '') && attr(el, 'alt')) {
        return { type: 'image', count: 1, name: 'image', render: () => ({ markdown: attr(el, 'alt'), copied: 1 }) };
      }
      // UI image (favicon chip, avatar, button content): not content, accounted for with an empty render.
      if (isUiImg(el)) return { type: 'image', count: 1, ui: true, name: 'image', render: () => ({ markdown: '', copied: 1 }) };
      return { type: 'image', count: 1, name: 'image', render: (ctx) => imageMarkdown(el, ctx) };
    }
    if (t === 'canvas') {
      if (el.closest('button, [role="button"]')) return null;
      return { type: 'image', count: 1, name: 'image', render: (ctx) => canvasMarkdown(el, ctx) };
    }
    if (has(el, CHART_SELECTOR)) {
      return {
        type: 'image', count: 1, name: 'image',
        render(ctx) {
          const lib = chartLib(el);
          for (const name of CHART_CONFIG_ATTRS) {
            const v = attr(el, name);
            if (v && /^\s*[{[]/.test(v)) return inCell(el) ? { markdown: ctx.placeholder('image', 'конфиг графика: ' + CELL_REASON, el), copied: 0 } : { markdown: `\n\n${ctx.fence(v.trim(), 'json')}\n\n`, copied: 1 };
          }
          const canvas = el.querySelector('canvas');
          if (canvas) return canvasMarkdown(canvas, ctx, `график ${lib}`);
          // Chart data lives in the page world (unreachable from a content script); SVG labels are not data.
          return { markdown: ctx.placeholder('image', `график ${lib}: исходные данные недоступны`, el), copied: 0 };
        }
      };
    }
    return null;
  }

  // ---------------------------------------------------------------- registry

  // Order = priority: the first analyzer that claims an element wins.
  const FAMILIES = [
    { name: 'math', type: 'math', priority: 110, analyze: analyzeMath, censusSelector: MATH_CENSUS_SELECTOR },
    { name: 'diagram', type: 'diagram', priority: 105, analyze: analyzeDiagram, censusSelector: DIAGRAM_CENSUS_SELECTOR },
    { name: 'svg', type: 'svg', priority: 95, analyze: analyzeSvg },
    { name: 'image', type: 'image', priority: 90, analyze: analyzeImage, censusSelector: CHART_SELECTOR }
  ];

  function claim(el) {
    for (const family of FAMILIES) {
      const d = family.analyze(el);
      if (d) return d;
    }
    return null;
  }

  const HANDLERS = FAMILIES.map((family) => ({
    name: family.name,
    type: family.type,
    priority: family.priority,
    censusSelector: family.censusSelector || '',
    match(el) { try { return !!family.analyze(el); } catch (_) { return false; } },
    render(el, ctx) {
      try {
        const d = family.analyze(el);
        return d ? d.render(ctx) : null;
      } catch (err) {
        return { markdown: ctx.placeholder(family.type, 'ошибка обработчика: ' + ((err && err.message) || err), el), copied: 0 };
      }
    }
  }));

  function register(engine) {
    if (!engine || typeof engine.registerBlock !== 'function') return false;
    HANDLERS.forEach((h) => engine.registerBlock(h));
    return true;
  }

  // Count of content blocks these handlers claim (UI icons excluded; no descent into claimed elements).
  // The engine's own census is authoritative for the report; this one is a cross-check for tests.
  function census(rootEl) {
    const counts = { math: 0, diagram: 0, svg: 0, image: 0 };
    (function walk(node) {
      for (const child of Array.from(node.children || [])) {
        let d = null;
        try { d = claim(child); } catch (_) { d = null; }
        if (d) { if (!d.ui) counts[d.type] += d.count; continue; }
        walk(child);
      }
    })(rootEl);
    return counts;
  }

  return { HANDLERS, register, census, renderDiagramSource, DIAGRAM_LANGS, version: 1 };
});
