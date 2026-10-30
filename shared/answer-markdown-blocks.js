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
  // aria-roledescription values mermaid puts on its svg (known list; not verified live).
  const MERMAID_ROLES = ['flowchart', 'flowchart-v2', 'sequence', 'classDiagram', 'stateDiagram', 'er', 'gantt', 'pie', 'journey',
    'gitGraph', 'mindmap', 'timeline', 'quadrantChart', 'requirement', 'c4', 'sankey', 'xychart', 'block', 'packet', 'kanban', 'architecture', 'radar'];
  // Provider-independent: ChatGPT-style ids look like "chatgpt-mermaid-<n>", plain mermaid ids "mermaid-<n>".
  const MERMAID_SVG_SELECTOR = ['svg[id*="mermaid" i]', 'svg[class*="mermaid" i]', 'svg[data-processed]']
    .concat(MERMAID_ROLES.map((r) => `svg[aria-roledescription="${r}"]`)).join(',');
  const DIAGRAM_LABEL_RE = /^(?:(?:код|code)\s+)?(?:mermaid|plantuml|graphviz|dot|d2)$/i;
  const DIAGRAM_CENSUS_SELECTOR = ['.mermaid', '[data-mermaid]', '.plantuml', '.graphviz', '.d2', MERMAID_SVG_SELECTOR]
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

  const NON_TEXT_TAGS = new Set(['style', 'script', 'noscript', 'template']);

  // Exact text, but never the text of <style>/<script>/<noscript>/<template> (CSS must not leak into Markdown).
  function textOf(el, ctx) {
    if (el.querySelector && el.querySelector('style, script, noscript, template')) {
      let out = '';
      (function walk(node) {
        node.childNodes.forEach((n) => {
          if (n.nodeType === 3) out += n.nodeValue;
          else if (n.nodeType === 1 && !NON_TEXT_TAGS.has(tag(n))) walk(n);
        });
      })(el);
      return out;
    }
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

  const MAX_STYLE = 4096;

  // SVG source; <style> larger than 4 KB is cut out (an xml comment marks the cut) so the block stays readable.
  function serializeSvg(svg) {
    let out = svg.outerHTML;
    let cut = 0;
    out = out.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (m, css) => {
      if (css.length <= MAX_STYLE) return m;
      cut += css.length;
      return '';
    });
    if (!/^<svg\b[^>]*\sxmlns=/i.test(out)) out = out.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    if (cut) out = out.replace(/^<svg\b[^>]*>/i, (m) => `${m}<!-- CSS из <style> (${cut} симв.) вырезан -->`);
    return { src: out, cut };
  }

  function svgDiagramLang(svg) {
    return has(svg, MERMAID_SVG_SELECTOR) ? 'mermaid' : null;
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

  // ---- best-effort flowchart reconstruction from a rendered mermaid svg (mermaid v11 flowchart-v2 conventions;
  // structure confirmed on a live Claude DOM 2026-10-19 for nodes/clusters, edge ids are NOT confirmed).
  // Returns { text, approx } or null whenever anything is not understood: no partial guesses.
  const collapse = (v) => String(v || '').replace(/\s+/g, ' ').trim();

  // Label from html (.nodeLabel) or svg <text>: tspans/lines are separated, never glued ("Задачи<br/>уже есть").
  // html label (foreignObject): block parts are separated by a space, <br> stays a line break of the mermaid label
  function htmlLabelText(root) {
    let out = '';
    (function walk(node) {
      node.childNodes.forEach((n) => {
        if (n.nodeType === 3) out += n.nodeValue;
        else if (n.nodeType === 1) {
          const t = tag(n);
          if (NON_TEXT_TAGS.has(t)) return;
          if (t === 'br') { out += '\u0001'; return; }
          const block = t === 'p' || t === 'div';
          if (block) out += ' ';
          walk(n);
          if (block) out += ' ';
        }
      });
    })(root);
    return collapse(out).replace(/ ?\u0001 ?/g, '<br/>');
  }

  function labelText(g) {
    const fo = g.querySelector('foreignObject');
    if (fo) { const t = htmlLabelText(fo); if (t) return t; }
    const nl = g.querySelector('.nodeLabel');
    if (nl) return htmlLabelText(nl);
    const parts = [];
    for (const t of (tag(g) === 'text' ? [g] : Array.from(g.querySelectorAll('text')))) {
      const lines = Array.from(t.children).filter((c) => tag(c) === 'tspan');
      if (!lines.length) { const x = collapse(textOf(t)); if (x) parts.push(x); continue; }
      for (const ln of lines) {
        const inner = Array.from(ln.children).filter((c) => tag(c) === 'tspan');
        const x = inner.length > 1 ? collapse(inner.map((c) => textOf(c)).join(' ')) : collapse(textOf(ln));
        if (x) parts.push(x);
      }
    }
    return parts.join('<br/>');
  }

  function translateOf(g) {
    const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(attr(g, 'transform') || '');
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
  }

  function flowNodeId(g) {
    const d = attr(g, 'data-id');
    if (d) return d;
    const m = /(?:^|-)flowchart-(.+)-\d+$/.exec(attr(g, 'id') || '');
    return m ? m[1] : null;
  }

  const mdLabel = (t) => `"${String(t).replace(/"/g, '#quot;')}"`;
  const NODE_CLASS_NOISE = new Set(['node', 'default', 'flowchart-label', 'clickable', 'statediagram-state', 'label-container']);

  function splitEnds(body, ends, sep) {
    for (const a of ends.keys()) {
      if (!body.startsWith(a + sep)) continue;
      const rest = body.slice(a.length + sep.length);
      if (ends.has(rest)) return [a, rest];
    }
    return null;
  }

  function pathPoints(path) {
    const nums = (attr(path, 'd') || '').match(/-?\d*\.?\d+(?:e-?\d+)?/gi);
    if (!nums || nums.length < 4) return null;
    const v = nums.map(parseFloat);
    return { a: { x: v[0], y: v[1] }, b: { x: v[v.length - 2], y: v[v.length - 1] } };
  }

  function reconstructFlowchart(svg) {
    const svgId = attr(svg, 'id') || '';
    const nodes = [];
    const ends = new Map(); // id -> { x, y, hw, hh, node? }
    for (const g of Array.from(svg.querySelectorAll('g.node'))) {
      const id = flowNodeId(g);
      if (!id || ends.has(id)) continue;
      const pos = translateOf(g);
      const rect = g.querySelector('rect, polygon, circle, ellipse');
      const hw = rect ? (parseFloat(attr(rect, 'width')) || (parseFloat(attr(rect, 'r')) * 2) || 0) / 2 : 0;
      const hh = rect ? (parseFloat(attr(rect, 'height')) || (parseFloat(attr(rect, 'r')) * 2) || 0) / 2 : 0;
      const shape = g.querySelector('polygon') ? '{}' : (g.querySelector('circle, ellipse') ? '(())' : '[]');
      const classes = (attr(g, 'class') || '').split(/\s+/).filter((c) => c && !NODE_CLASS_NOISE.has(c) && /^[\w-]+$/.test(c));
      const node = { id, label: labelText(g) || id, shape, classes, x: pos ? pos.x : null, y: pos ? pos.y : null, hw, hh, cluster: null };
      nodes.push(node);
      ends.set(id, node);
    }
    if (!nodes.length) return null;

    const clusters = [];
    for (const g of Array.from(svg.querySelectorAll('g.cluster'))) {
      const r = g.querySelector('rect');
      const num = (n) => parseFloat(attr(r, n));
      if (!r || ![num('x'), num('y'), num('width'), num('height')].every(Number.isFinite)) continue;
      let rawId = attr(g, 'data-id') || attr(g, 'id') || `sg${clusters.length + 1}`;
      if (svgId && rawId.startsWith(svgId + '-')) rawId = rawId.slice(svgId.length + 1);
      const c = {
        id: rawId, label: labelText(g), x: num('x'), y: num('y'), w: num('width'), h: num('height'), parent: null, isCluster: true
      };
      c.cx = c.x + c.w / 2; c.cy = c.y + c.h / 2; c.hw = c.w / 2; c.hh = c.h / 2;
      clusters.push(c);
      if (!ends.has(rawId)) ends.set(rawId, c);
    }

    const pathEls = Array.from(svg.querySelectorAll('path.flowchart-link'));
    const paths = pathEls.length ? pathEls : Array.from(svg.querySelectorAll('.edgePaths path, g.edgePath path'));
    const edgeLabels = Array.from(svg.querySelectorAll('g.edgeLabel'));
    const labelById = new Map();
    edgeLabels.forEach((g) => {
      const holder = g.querySelector('[data-id]');
      const id = holder ? attr(holder, 'data-id') : attr(g, 'data-id');
      if (id) labelById.set(id, labelText(g));
    });
    const center = (e) => (e.isCluster ? { x: e.cx, y: e.cy } : { x: e.x, y: e.y });
    const nearest = (pt) => {
      let best = null; let bd = Infinity;
      for (const [id, e] of ends) {
        const c = center(e);
        if (c.x === null) continue;
        const dx = Math.max(Math.abs(pt.x - c.x) - (e.hw || 0), 0);
        const dy = Math.max(Math.abs(pt.y - c.y) - (e.hh || 0), 0);
        // smaller boxes win a tie: a node inside a cluster beats the cluster
        const d = Math.hypot(dx, dy) + ((e.hw || 0) * (e.hh || 0)) / 1e7;
        if (d < bd) { bd = d; best = id; }
      }
      return bd <= 12 ? best : null;
    };
    const edges = [];
    let approx = false;
    for (let i = 0; i < paths.length; i += 1) {
      const path = paths[i];
      const eid = attr(path, 'data-id') || attr(path, 'id') || '';
      const cls = attr(path, 'class') || '';
      let pair = null;
      const ls = /(?:^|\s)LS-(\S+)/.exec(cls); const le = /(?:^|\s)LE-(\S+)/.exec(cls);
      if (ls && le && ends.has(ls[1]) && ends.has(le[1])) pair = [ls[1], le[1]];
      if (!pair) {
        const m = /(?:^|[-_])L_(.+)_(\d+)$/.exec(eid);
        if (m) pair = splitEnds(m[1], ends, '_');
      }
      if (!pair) {
        const m = /(?:^|-)L-(.+)$/.exec(eid);
        if (m) pair = splitEnds(m[1], ends, '-');
      }
      if (!pair) {
        const pts = pathPoints(path);
        const a = pts && nearest(pts.a); const b = pts && nearest(pts.b);
        if (a && b && a !== b) { pair = [a, b]; approx = true; }
      }
      if (!pair) return null;
      let label = labelById.has(eid) ? labelById.get(eid) : '';
      if (!labelById.size && edgeLabels.length === paths.length) label = labelText(edgeLabels[i]);
      const style = /dotted/.test(cls) ? '-.->' : (/edge-thickness-thick/.test(cls) ? '==>' : '-->');
      edges.push({ from: pair[0], to: pair[1], label, style });
    }

    const inside = (c, x, y) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h;
    const area = (c) => c.w * c.h;
    for (const c of clusters) {
      const encl = clusters.filter((o) => o !== c && inside(o, c.cx, c.cy) && area(o) > area(c));
      c.parent = encl.sort((a, b) => area(a) - area(b))[0] || null;
    }
    for (const n of nodes) {
      if (n.x === null) continue;
      const encl = clusters.filter((c) => inside(c, n.x, n.y));
      n.cluster = encl.sort((a, b) => area(a) - area(b))[0] || null;
    }

    let dx = 0; let dy = 0;
    for (const e of edges) {
      const a = center(ends.get(e.from)); const b = center(ends.get(e.to));
      if (a.x !== null && b.x !== null) { dx += b.x - a.x; dy += b.y - a.y; }
    }
    const dir = Math.abs(dy) >= Math.abs(dx) ? (dy >= 0 ? 'TD' : 'BT') : (dx >= 0 ? 'LR' : 'RL');

    const safe = (id) => String(id).replace(/[^\w]/g, '_');
    const lines = ['%% реконструировано из SVG, возможны расхождения'];
    if (approx) lines.push('%% рёбра определены по геометрии (приблизительно)');
    lines.push(`flowchart ${dir}`);
    const nodeLine = (n, pad) => {
      const [o, c] = n.shape === '(())' ? ['((', '))'] : (n.shape === '{}' ? ['{', '}'] : ['[', ']']);
      return `${pad}${safe(n.id)}${o}${mdLabel(n.label)}${c}`;
    };
    const emit = (cluster, pad) => {
      nodes.filter((n) => n.cluster === cluster).forEach((n) => lines.push(nodeLine(n, pad)));
      clusters.filter((c) => c.parent === cluster).forEach((c) => {
        lines.push(`${pad}subgraph ${safe(c.id)}${c.label ? ` [${mdLabel(c.label)}]` : ''}`);
        emit(c, pad + '  ');
        lines.push(`${pad}end`);
      });
    };
    emit(null, '  ');
    for (const e of edges) lines.push(`  ${safe(e.from)} ${e.style}${e.label ? `|${e.label}|` : ''} ${safe(e.to)}`);
    const byClass = new Map();
    nodes.forEach((n) => n.classes.forEach((c) => byClass.set(c, (byClass.get(c) || []).concat(safe(n.id)))));
    byClass.forEach((ids, c) => lines.push(`  class ${ids.join(',')} ${c}`));
    return { text: lines.join('\n'), approx };
  }

  // ---- sequence / state diagram reconstruction (mermaid v11 conventions as remembered; NOT verified live).
  // Both return { text, approx } or null; unknown structure (loops/alt, composite states) is not guessed.
  const numAttr = (el, n) => parseFloat(attr(el, n));
  const safeId = (v) => String(v).replace(/[^\w]/g, '_') || '_';

  function pathEnds(el) {
    if (tag(el) === 'line') {
      return { a: { x: numAttr(el, 'x1'), y: numAttr(el, 'y1') }, b: { x: numAttr(el, 'x2'), y: numAttr(el, 'y2') } };
    }
    return pathPoints(el);
  }

  function reconstructSequence(svg) {
    if (svg.querySelector('.loopLine, .loopText, .labelText')) return null; // loop/alt/opt: not reconstructed
    let rects = Array.from(svg.querySelectorAll('rect.actor-top'));
    if (!rects.length) rects = Array.from(svg.querySelectorAll('rect.actor:not(.actor-bottom)'));
    const actors = [];
    for (const r of rects) {
      const x = numAttr(r, 'x'); const w = numAttr(r, 'width');
      if (!Number.isFinite(x) || !Number.isFinite(w)) return null;
      let name = attr(r, 'name');
      if (!name) {
        const t = r.parentElement && r.parentElement.querySelector('text.actor-box, text.actor');
        name = t ? labelText(t) : '';
      }
      if (!name) return null;
      actors.push({ name: collapse(name), cx: x + w / 2 });
    }
    if (actors.length < 1) return null;
    actors.sort((a, b) => a.cx - b.cx);
    const used = new Set();
    actors.forEach((a) => {
      let id = safeId(a.name); let n = 2;
      while (used.has(id)) id = `${safeId(a.name)}_${n++}`;
      used.add(id); a.id = id;
    });
    const nearestActor = (x) => actors.reduce((b, a) => (Math.abs(a.cx - x) < Math.abs(b.cx - x) ? a : b));

    const texts = Array.from(svg.querySelectorAll('text.messageText')).map((t) => ({ y: numAttr(t, 'y'), text: labelText(t), used: false }));
    const lines = Array.from(svg.querySelectorAll('line.messageLine0, line.messageLine1, path.messageLine0, path.messageLine1'));
    const events = [];
    for (const l of lines) {
      const pts = pathEnds(l);
      if (!pts || ![pts.a.x, pts.a.y, pts.b.x, pts.b.y].every(Number.isFinite)) return null;
      const y = Math.min(pts.a.y, pts.b.y);
      let best = null;
      for (const t of texts) {
        if (t.used || !(t.y <= y + 2) || y - t.y > 80) continue;
        if (!best || t.y > best.y) best = t;
      }
      if (best) best.used = true;
      const marker = attr(l, 'marker-end') || '';
      const dashed = /messageLine1/.test(attr(l, 'class') || '');
      const head = /cross/i.test(marker) ? 'x' : (/arrowhead|filled/i.test(marker) ? '>>' : '>');
      events.push({
        y, md: `${nearestActor(pts.a.x).id} ${dashed ? '--' : '-'}${head} ${nearestActor(pts.b.x).id}: ${best ? best.text : ''}`.replace(/: $/, '')
      });
    }
    if (texts.some((t) => !t.used)) return null; // a message text without its line: structure not understood
    const noteRects = Array.from(svg.querySelectorAll('rect.note'));
    const noteTexts = Array.from(svg.querySelectorAll('text.noteText'));
    if (noteRects.length !== noteTexts.length) return null;
    noteRects.forEach((r, i) => {
      const x = numAttr(r, 'x'); const w = numAttr(r, 'width'); const y = numAttr(r, 'y');
      if (![x, w, y].every(Number.isFinite)) return;
      const over = actors.filter((a) => a.cx >= x && a.cx <= x + w);
      const ids = (over.length ? over : [nearestActor(x + w / 2)]).map((a) => a.id);
      const ends = ids.length > 1 ? [ids[0], ids[ids.length - 1]] : ids;
      events.push({ y, md: `Note over ${ends.join(',')}: ${labelText(noteTexts[i])}` });
    });
    events.sort((a, b) => a.y - b.y);
    const lines2 = ['%% реконструировано из SVG, возможны расхождения', 'sequenceDiagram'];
    actors.forEach((a) => lines2.push(a.id === a.name ? `  participant ${a.id}` : `  participant ${a.id} as ${a.name}`));
    events.forEach((e) => lines2.push(`  ${e.md}`));
    return { text: lines2.join('\n'), approx: true };
  }

  function reconstructState(svg) {
    if (svg.querySelector('g.cluster')) return null; // composite states: not reconstructed
    const nodes = [];
    for (const g of Array.from(svg.querySelectorAll('g.node'))) {
      const m = /(?:^|-)state-(.+)-\d+$/.exec(attr(g, 'id') || '');
      if (!m) continue;
      const pos = translateOf(g);
      if (!pos) return null;
      const rect = g.querySelector('rect, circle, ellipse, polygon');
      const hw = rect ? (numAttr(rect, 'width') || numAttr(rect, 'r') * 2 || 0) / 2 : 0;
      const hh = rect ? (numAttr(rect, 'height') || numAttr(rect, 'r') * 2 || 0) / 2 : 0;
      const start = /(?:^|_)start$/.test(m[1]) || /statediagram-start|state-start/.test(attr(g, 'class') || '');
      const end = /(?:^|_)end$/.test(m[1]) || /statediagram-end|state-end/.test(attr(g, 'class') || '');
      nodes.push({ name: m[1], label: labelText(g), x: pos.x, y: pos.y, hw, hh, start, end });
    }
    if (!nodes.length) return null;
    const paths = Array.from(svg.querySelectorAll('path.transition'));
    const list = paths.length ? paths : Array.from(svg.querySelectorAll('.edgePaths path'));
    const labels = Array.from(svg.querySelectorAll('g.edgeLabel'));
    const nearest = (pt) => {
      let best = null; let bd = Infinity;
      for (const n of nodes) {
        const d = Math.hypot(Math.max(Math.abs(pt.x - n.x) - n.hw, 0), Math.max(Math.abs(pt.y - n.y) - n.hh, 0));
        if (d < bd) { bd = d; best = n; }
      }
      return bd <= 12 ? best : null;
    };
    const edges = [];
    for (let i = 0; i < list.length; i += 1) {
      const pts = pathPoints(list[i]);
      const a = pts && nearest(pts.a); const b = pts && nearest(pts.b);
      if (!a || !b) return null;
      edges.push({ a, b, label: labels.length === list.length ? labelText(labels[i]) : '' });
    }
    const idOf = (n, asTarget) => (n.start || n.end ? '[*]' : safeId(n.name));
    const lines = ['%% реконструировано из SVG, возможны расхождения', '%% переходы определены по геометрии (приблизительно)', 'stateDiagram-v2'];
    nodes.filter((n) => !n.start && !n.end && n.label && n.label !== n.name).forEach((n) => lines.push(`  state ${mdLabel(n.label)} as ${safeId(n.name)}`));
    edges.forEach((e) => lines.push(`  ${idOf(e.a)} --> ${idOf(e.b, true)}${e.label ? `: ${e.label}` : ''}`));
    return { text: lines.join('\n'), approx: true };
  }

  // Diagram kind from the svg itself (aria-roledescription, structure); the first Monaco line is only a hint.
  function reconstructMermaid(svg, host) {
    const role = lc(attr(svg, 'aria-roledescription'));
    let kind = null;
    if (/^(flowchart|graph)/.test(role) || svg.querySelector('g.node[id*="flowchart-"]')) kind = 'flowchart';
    else if (role === 'sequence' || svg.querySelector('text.messageText, rect.actor-top')) kind = 'sequence';
    else if (/state/.test(role) || /statediagram/i.test(attr(svg, 'class') || '')) kind = 'state';
    if (!kind && host && host.querySelector) {
      const line = host.querySelector('.view-line');
      const m = /^\s*(sequenceDiagram|graph|flowchart|stateDiagram)/.exec(line ? line.textContent : '');
      if (m) kind = m[1] === 'sequenceDiagram' ? 'sequence' : (m[1] === 'stateDiagram' ? 'state' : 'flowchart');
    }
    if (kind === 'flowchart') return reconstructFlowchart(svg);
    if (kind === 'sequence') return reconstructSequence(svg);
    if (kind === 'state') return reconstructState(svg);
    return null;
  }

  // Source stored next to / around a rendered mermaid svg (hidden "Code" tab, textarea, script type=text/mermaid).
  function hiddenish(node, stop) {
    for (let n = node; n && n !== stop; n = n.parentElement) {
      if (n.hasAttribute('hidden') || n.hasAttribute('inert') || attr(n, 'aria-hidden') === 'true') return true;
      if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(attr(n, 'style') || '')) return true;
    }
    return false;
  }

  // -> { emit: text } | { sibling: true } | null
  function wrapperSource(svg, lang, ctx) {
    let wrap = svg.parentElement;
    for (let depth = 0; wrap && depth < 4; depth += 1, wrap = wrap.parentElement) {
      if (wrap.querySelectorAll(MERMAID_SVG_SELECTOR).length > 1) return null;
      const cands = Array.from(wrap.querySelectorAll('textarea, script[type*="mermaid"], pre, code'))
        .filter((c) => !c.closest('svg') && !c.querySelector('svg'));
      for (const c of cands) {
        const t = tag(c);
        // the engine's ctx.text() deliberately returns '' for <script>: read the source container directly
        const text = t === 'textarea' || t === 'script' ? String(c.textContent || '') : textOf(c, ctx);
        if (!text.trim()) continue;
        if (t === 'textarea' || t === 'script') return { emit: text };
        const strong = detectLang(c.closest('pre') || c) === lang;
        if (!strong) continue;
        const pre = c.closest('pre') || c;
        if (hiddenish(pre, wrap.parentElement)) return { emit: text };
        return { sibling: true };
      }
    }
    return null;
  }

  function svgOnlyDiagram(el, svg, lang, ctx) {
    if (lang === 'mermaid' && !inCell(el)) {
      let rebuilt = null;
      try { rebuilt = reconstructMermaid(svg, el); } catch (_) { rebuilt = null; }
      if (rebuilt) return { markdown: `\n\n${ctx.fence(rebuilt.text, 'mermaid')}\n\n`, copied: 1, reconstructed: true, approximate: rebuilt.approx };
    }
    // Shadow-DOM renderer (live Claude DOM 2026-10-19): the host's own <style> sits next to the svg, keep it.
    let target = svg;
    const rootNode = svg.getRootNode && svg.getRootNode();
    if (rootNode && rootNode.nodeType === 11) {
      const styles = Array.from(rootNode.querySelectorAll('style')).filter((st) => !svg.contains(st));
      if (styles.length) {
        target = svg.cloneNode(true);
        styles.slice().reverse().forEach((st) => target.insertBefore(st.cloneNode(true), target.firstChild));
      }
    }
    const { src, cut } = serializeSvg(target);
    const note = ctx.placeholder('diagram', `${lang}: рендерер оставил только SVG без исходника${cut ? `; CSS ${cut} симв. вырезан` : ''}`, el);
    if (inCell(el)) return { markdown: note, copied: 0 };
    if (src.length > MAX_SVG) return { markdown: note, copied: 0 };
    return { markdown: `\n\n${note}\n\n${ctx.fence(src, 'svg')}\n\n`, copied: 0 };
  }

  // Header caption of a diagram block ("Код Mermaid"): its text must become the fence language, not text.
  function isDiagramLabel(el) {
    if (el.children.length && !Array.from(el.children).every((c) => has(c, 'button, [role="button"], svg'))) return false;
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('');
    if (own.length > 40 || !DIAGRAM_LABEL_RE.test(collapse(own))) return false;
    let a = el.parentElement;
    for (let i = 0; a && i < 4; i += 1, a = a.parentElement) {
      if (a.querySelector(MERMAID_SVG_SELECTOR) || a.querySelector('.mermaid')) return true;
    }
    return false;
  }

  function analyzeDiagram(el) {
    const t = tag(el);
    // Tab strip of a diagram code block ("Diagram" | "Code", live DeepSeek 2026-10-19): UI, never text.
    if (attr(el, 'role') === 'tablist' && el.textContent.length < 80) {
      const tabs = Array.from(el.querySelectorAll('[role="tab"]'));
      if (tabs.length && tabs.every((x) => /^(diagram|code|preview|source|диаграмма|код)$/i.test(collapse(x.textContent)))) {
        let a = el.parentElement;
        for (let i = 0; a && i < 3; i += 1, a = a.parentElement) {
          if (a.querySelector(MERMAID_SVG_SELECTOR)) return { type: 'diagram', count: 0, name: 'diagram', render: () => ({ markdown: '', copied: 0 }) };
        }
      }
    }
    if (t !== 'svg' && el.children.length < 4 && el.textContent.length < 60 && isDiagramLabel(el)) {
      return { type: 'diagram', count: 0, name: 'diagram', render: () => ({ markdown: '', copied: 0 }) };
    }
    if (t === 'svg') {
      if (el.parentNode && el.parentNode.closest && el.parentNode.closest('svg')) return null;
      if (isIconSvg(el)) return null;
      const lang = svgDiagramLang(el);
      if (!lang) return null;
      return {
        type: 'diagram', count: 1, name: 'diagram',
        render(ctx) {
          const src = attrSource(el) || scopedSource(el, ctx);
          if (src) return renderDiagramSource(lang, src, ctx, el);
          const near = wrapperSource(el, lang, ctx);
          // a visible source block next to the picture is written by its own handler: count this one as covered
          if (near && near.sibling) return { markdown: '', copied: 1 };
          if (near) return renderDiagramSource(lang, near.emit, ctx, el);
          return svgOnlyDiagram(el, el, lang, ctx);
        }
      };
    }
    // Claude: <div data-mermaid="true" role="img" aria-label="Диаграмма Mermaid"> is a host with an OPEN shadowRoot
    // that holds the svg (light DOM is empty). Detected by the light-DOM markers, not by provider.
    // Qwen: <pre class="qwen-markdown-code"> = header UI + hidden Monaco editor + the rendered mermaid svg (any display).
    const hostLike = (['div', 'span', 'figure', 'section'].includes(t) && has(el, '[data-mermaid], [role="img"][aria-label*="mermaid" i]'))
      || (t === 'pre' && !!el.querySelector(MERMAID_SVG_SELECTOR));
    const lang = hostLike ? 'mermaid' : detectLang(el);
    if (!lang) return null;
    const svg = el.querySelector(MERMAID_SVG_SELECTOR) || el.querySelector('svg') || (el.shadowRoot && el.shadowRoot.querySelector('svg')) || null;
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
        const { src } = serializeSvg(el);
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

  // ---------------------------------------------------------------- ChatGPT "DIL" components (HTML/CSS, not SVG)
  // Declarative components marked data-d-component (title, text, box, row, icon, grid, grid-item, list, list-item,
  // caption, divider, svg, table, table-row, table-cell) + data-d-direction (col|row). Structure confirmed on a live
  // ChatGPT DOM 2026-10-19 for box/row/icon/text ("Сценарий А"); the other components are handled by name only.
  const comp = (el) => (el && el.getAttribute ? el.getAttribute('data-d-component') : null);
  const EDGE_WS = /^[ \t\r\n]+|[ \t\r\n]+$/g;
  // Whitespace of HTML source (not NBSP / narrow spaces): inside the flow block nothing else is normalized.
  const rawLine = (v) => String(v || '').replace(/[ \t\r\n]+/g, ' ').replace(EDGE_WS, '');
  const width = (s) => Array.from(s).length;

  function flowInfo(el) {
    const c = comp(el);
    if (c !== 'box' && c !== 'row') return null;
    const kids = Array.from(el.children);
    const kind = kids.map((k) => (comp(k) === 'box' ? 'c' : (tag(k) === 'svg' && comp(k) === 'icon' ? 'a' : 'o')));
    const first = kind.indexOf('c');
    const last = kind.lastIndexOf('c');
    if (first < 0 || kind.filter((k) => k === 'c').length < 2) return null;
    if (!kind.slice(first, last + 1).includes('a')) return null; // a connector must sit between two cards
    const dir = attr(el, 'data-d-direction') || (c === 'row' ? 'row' : 'col');
    return { kids, kind, dir: dir === 'row' ? 'row' : 'col' };
  }

  function cardLines(card, ctx) {
    const lines = [];
    (function walk(el) {
      const kids = Array.from(el.children).filter((k) => tag(k) !== 'svg');
      if (!el.children.length) { const t = rawLine(textOf(el, ctx)); if (t) lines.push(t); return; }
      if (comp(el) === 'row') {
        const parts = kids.map((k) => rawLine(textOf(k, ctx))).filter(Boolean);
        if (parts.length) lines.push(parts.join(' '));
        return;
      }
      el.childNodes.forEach((n) => {
        if (n.nodeType === 3) { const t = rawLine(n.nodeValue); if (t) lines.push(t); } else if (n.nodeType === 1 && tag(n) !== 'svg' && !NON_TEXT_TAGS.has(tag(n))) walk(n);
      });
    })(card);
    return lines;
  }

  function frame(lines) {
    const w = Math.max(0, ...lines.map(width));
    const pad = (s) => s + ' '.repeat(w - width(s));
    return [`┌${'─'.repeat(w + 2)}┐`].concat((lines.length ? lines : ['']).map((l) => `│ ${pad(l)} │`), [`└${'─'.repeat(w + 2)}┘`]);
  }

  function renderFlow(el, info, ctx) {
    const items = [];
    info.kids.forEach((k, i) => {
      if (info.kind[i] === 'c') items.push({ lines: frame(cardLines(k, ctx)) });
      else if (info.kind[i] === 'a') items.push({ arrow: true });
      else if (tag(k) !== 'svg') { const t = cardLines(k, ctx); if (t.length) items.push({ lines: t }); }
    });
    const out = [];
    if (info.dir === 'col') {
      let prevW = 0;
      for (const it of items) {
        if (it.arrow) out.push(' '.repeat(Math.floor(prevW / 2)) + '↓');
        else { out.push(...it.lines); prevW = Math.max(0, ...it.lines.map(width)); }
      }
    } else {
      const cols = items.map((it) => (it.arrow ? { arrow: true, lines: ['→'] } : { lines: it.lines, w: Math.max(0, ...it.lines.map(width)) }));
      const h = Math.max(1, ...cols.map((c) => c.lines.length));
      const mid = Math.floor((h - 1) / 2);
      for (let r = 0; r < h; r += 1) {
        out.push(cols.map((c) => {
          if (c.arrow) return r === mid ? ' → ' : '   ';
          return (c.lines[r] || '') + ' '.repeat(c.w - width(c.lines[r] || ''));
        }).join('').replace(/\s+$/, ''));
      }
    }
    return `\n\n${ctx.fence(out.join('\n'), 'text')}\n\n`;
  }

  function analyzeDilFlow(el) {
    if (!el.hasAttribute || !el.hasAttribute('data-d-component')) return null;
    const info = flowInfo(el);
    if (!info) return null;
    return {
      type: 'diagram', count: 1, name: 'dil-flow',
      render(ctx) {
        if (inCell(el)) return { markdown: ctx.placeholder('diagram', 'блок-схема на HTML-компонентах: ' + CELL_REASON, el), copied: 0 };
        return {
          markdown: renderFlow(el, info, ctx), copied: 1, reconstructed: true, note: 'блок-схема на HTML-компонентах, не SVG'
        };
      }
    };
  }

  const cellMd = (ctx, el) => ctx.convertChildren(el).replace(/\s*\n+\s*/g, '<br>').replace(/(?<!\\)\|/g, '\\|').trim();

  function gfmTable(rows, headerFromFirst) {
    const cols = Math.max(...rows.map((r) => r.length));
    const norm = rows.map((r) => r.concat(Array(cols - r.length).fill('')));
    const head = headerFromFirst ? norm[0] : Array(cols).fill('');
    const body = headerFromFirst ? norm.slice(1) : norm;
    const line = (cells) => `| ${cells.map((c) => c || ' ').join(' | ')} |`;
    return `\n\n${[line(head), line(Array(cols).fill('---'))].concat(body.map(line)).join('\n')}\n\n`;
  }

  function gridCols(el) {
    const m = /grid-template-columns\s*:\s*([^;]+)/i.exec(attr(el, 'style') || '');
    if (!m) return 0;
    const rep = /repeat\(\s*(\d+)\s*,/i.exec(m[1]);
    if (rep) return parseInt(rep[1], 10);
    return m[1].trim().split(/\s+(?![^(]*\))/).filter(Boolean).length;
  }

  function listMd(el, ctx, depth) {
    const lines = [];
    for (const item of Array.from(el.children).filter((k) => comp(k) === 'list-item')) {
      const clone = item.cloneNode(true);
      const nested = Array.from(clone.querySelectorAll('[data-d-component="list"]'));
      nested.forEach((n) => n.remove());
      const text = ctx.convertChildren(clone).replace(/\s*\n+\s*/g, ' ').trim();
      lines.push(`${'  '.repeat(depth)}- ${text}`);
      Array.from(item.querySelectorAll('[data-d-component="list"]'))
        .filter((n) => n.parentElement.closest('[data-d-component="list"]') === el)
        .forEach((n) => lines.push(listMd(n, ctx, depth + 1)));
    }
    return lines.join('\n');
  }

  function analyzeDil(el) {
    const c = el.hasAttribute && el.getAttribute('data-d-component');
    if (!c) return null;
    const t = tag(el);
    const done = (render) => ({ type: 'text', count: 0, name: 'dil', render });
    // The engine renders real h1-6 / ul / ol / table itself; DIL markup on other tags is converted here.
    // copied stays 0: these blocks are not counted by the engine census, so nothing may be added to `copied`.
    if (c === 'title' && !/^h[1-6]$/.test(t)) return done((ctx) => ({ markdown: `\n\n## ${rawLine(ctx.convertChildren(el))}\n\n`, copied: 0 }));
    if (c === 'divider' && t !== 'hr') return done(() => ({ markdown: '\n\n---\n\n', copied: 0 }));
    if (c === 'caption') return done((ctx) => ({ markdown: `\n\n*${rawLine(ctx.convertChildren(el))}*\n\n`, copied: 0 }));
    if (c === 'list' && t !== 'ul' && t !== 'ol') return done((ctx) => ({ markdown: `\n\n${listMd(el, ctx, 0)}\n\n`, copied: 0 }));
    if (c === 'table' && t !== 'table') {
      return done((ctx) => {
        const rows = Array.from(el.querySelectorAll('[data-d-component="table-row"]'))
          .map((r) => Array.from(r.querySelectorAll('[data-d-component="table-cell"]')).map((cell) => cellMd(ctx, cell)));
        if (!rows.length || !rows.some((r) => r.length)) return { markdown: ctx.convertChildren(el), copied: 0 };
        return { markdown: gfmTable(rows, true), copied: 0 };
      });
    }
    if (c === 'grid') {
      return done((ctx) => {
        const items = Array.from(el.children).filter((k) => comp(k) === 'grid-item');
        const cols = gridCols(el);
        if (items.length < 2 || items.length !== Array.from(el.children).length) return { markdown: ctx.convertChildren(el), copied: 0 };
        if (cols < 2) return { markdown: `\n\n${items.map((k) => `- ${cellMd(ctx, k)}`).join('\n')}\n\n`, copied: 0 };
        const rows = [];
        for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols).map((k) => cellMd(ctx, k)));
        return { markdown: gfmTable(rows, false), copied: 0 };
      });
    }
    if (c === 'row') {
      return done((ctx) => {
        // inline children of a row are separate items: keep a space between them
        const clone = el.cloneNode(true);
        Array.from(clone.children).forEach((k) => k.after(el.ownerDocument.createTextNode(' ')));
        const parts = ctx.convertChildren(clone).split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
        if (parts.some((p) => p.includes('\n'))) return { markdown: parts.join('\n\n'), copied: 0 };
        return { markdown: parts.length ? `\n\n${parts.join(' ')}\n\n` : '', copied: 0 };
      });
    }
    return null;
  }

  // ---------------------------------------------------------------- Perplexity mermaid: cross-origin iframe + hidden source
  // Live DOM 2026-10-19: iframe[title="Mermaid diagram"][sandbox] (other origin, unreadable) with a hidden <pre>
  // (no code class, text starts like mermaid) in a nearby ancestor. The hidden text is the real source: read on purpose.
  const IFRAME_DIAGRAM_TITLE = /mermaid|diagram|диаграмм/i;

  function isHiddenDeep(node) {
    const win = node.ownerDocument && node.ownerDocument.defaultView;
    for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hasAttribute('hidden') || attr(n, 'aria-hidden') === 'true') return true;
      if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(attr(n, 'style') || '')) return true;
      if (win) {
        try {
          const cs = win.getComputedStyle(n);
          if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return true;
        } catch (_) { /* no computed style */ }
      }
    }
    return false;
  }

  const isMermaidIframe = (el) => tag(el) === 'iframe' && IFRAME_DIAGRAM_TITLE.test(attr(el, 'title') || attr(el, 'aria-label') || '');
  const isHiddenMermaidPre = (el) => tag(el) === 'pre' && MERMAID_START.test(el.textContent || '') && isHiddenDeep(el);

  // iframe -> pre pairs: closest common ancestor first (up to 4 levels), then document order; one pre per iframe.
  function pairMermaid(el) {
    const root = el.getRootNode ? el.getRootNode() : el.ownerDocument;
    if (!root || !root.querySelectorAll) return { byIframe: new Map(), paired: new Set() };
    const iframes = Array.from(root.querySelectorAll('iframe')).filter(isMermaidIframe);
    const pres = Array.from(root.querySelectorAll('pre')).filter(isHiddenMermaidPre);
    const cand = [];
    iframes.forEach((f, i) => {
      let a = f.parentElement;
      for (let k = 1; a && k <= 4; k += 1, a = a.parentElement) {
        pres.forEach((p, j) => { if (a.contains(p)) cand.push({ k, i, j }); });
      }
    });
    // smallest level wins; a candidate keeps its smallest level only
    cand.sort((x, y) => (x.k - y.k) || (x.i - y.i) || (x.j - y.j));
    const usedI = new Set(); const usedJ = new Set();
    const byIframe = new Map(); const paired = new Set();
    for (const c of cand) {
      if (usedI.has(c.i) || usedJ.has(c.j)) continue;
      usedI.add(c.i); usedJ.add(c.j);
      byIframe.set(iframes[c.i], pres[c.j]);
      paired.add(pres[c.j]);
    }
    return { byIframe, paired };
  }

  function analyzeMermaidEmbed(el) {
    const t = tag(el);
    if (t === 'iframe') {
      if (!isMermaidIframe(el)) return null;
      const pre = pairMermaid(el).byIframe.get(el);
      if (!pre) return null; // no source: the embed handler reports the unreadable iframe as before
      return {
        type: 'diagram', count: 1, name: 'mermaid-embed',
        render: (ctx) => renderDiagramSource('mermaid', pre.textContent || '', ctx, el)
      };
    }
    if (t === 'pre' && isHiddenMermaidPre(el)) {
      if (pairMermaid(el).paired.has(el)) return null; // written at the iframe's place
      return {
        type: 'diagram', count: 1, name: 'mermaid-embed',
        render: (ctx) => renderDiagramSource('mermaid', el.textContent || '', ctx, el)
      };
    }
    return null;
  }

  // The hidden source of a pair: consumed by the iframe's block, must not be written (or counted) again.
  function analyzeMermaidSource(el) {
    if (tag(el) !== 'pre' || !isHiddenMermaidPre(el) || !pairMermaid(el).paired.has(el)) return null;
    return { type: 'code', count: 0, name: 'mermaid-embed-source', render: () => ({ markdown: '', copied: 0 }) };
  }

  // ---------------------------------------------------------------- registry

  // Order = priority: the first analyzer that claims an element wins.
  const FAMILIES = [
    { name: 'mermaid-embed', type: 'diagram', priority: 210, claimsUi: true, analyze: analyzeMermaidEmbed, censusMatch: (el) => !!analyzeMermaidEmbed(el) },
    { name: 'mermaid-embed-source', type: 'code', priority: 210, claimsUi: true, analyze: analyzeMermaidSource, censusSkip: (el) => !!analyzeMermaidSource(el) },
    { name: 'dil-flow', type: 'diagram', priority: 112, analyze: analyzeDilFlow, censusMatch: (el) => !!analyzeDilFlow(el) },
    { name: 'math', type: 'math', priority: 110, analyze: analyzeMath, censusSelector: MATH_CENSUS_SELECTOR },
    { name: 'diagram', type: 'diagram', priority: 105, analyze: analyzeDiagram, censusSelector: DIAGRAM_CENSUS_SELECTOR,
      // a <pre> that holds a rendered mermaid svg (Qwen) is one diagram, not a code block
      censusMatch: (el) => tag(el) === 'pre' && !!el.querySelector(MERMAID_SVG_SELECTOR) },
    { name: 'svg', type: 'svg', priority: 95, analyze: analyzeSvg },
    { name: 'image', type: 'image', priority: 90, analyze: analyzeImage, censusSelector: CHART_SELECTOR },
    { name: 'dil', type: 'text', priority: 100, analyze: analyzeDil, passthrough: true }
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
    censusMatch: family.censusMatch || null,
    passthrough: family.passthrough === true,
    claimsUi: family.claimsUi === true,
    censusSkip: family.censusSkip || null,
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
        if (d) { if (!d.ui && d.count) counts[d.type] += d.count; continue; }
        walk(child);
      }
    })(rootEl);
    return counts;
  }

  return { HANDLERS, register, census, renderDiagramSource, DIAGRAM_LANGS, version: 1 };
});
