// content-scripts/answer-html-builder.js
// The ONE builder of an answer's html (inline computed styles incl. flex/grid layout, content svg -> picture, shadow-root
// diagrams, block icons, iframes, hidden content, Mermaid sources, clean code blocks). Side-effect free: it only defines
// window.AnswerHtmlBuilder. It is a content script (before content-utils.js, which delegates to it) AND is injected into a
// tab by the background (extractLatestAssistantSnapshotInPage) when the tab runs an older extension version, so the
// pulled html is built by the same code as the live one. Bump BUILDER_VERSION with every change of behaviour.
(function initAnswerHtmlBuilder(root) {
  'use strict';
  const BUILDER_VERSION = 2;
  if (root.AnswerHtmlBuilder && Number(root.AnswerHtmlBuilder.version) >= BUILDER_VERSION) return;
  const window = root;

  const INLINE_STYLE_PROPERTIES = [
    'color',
    'background-color',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'text-decoration',
    'text-transform',
    'line-height',
    'letter-spacing',
    'text-align',
    'white-space',
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'border-top',
    'border-right',
    'border-bottom',
    'border-left',
    'border-radius',
    'list-style-type',
    'list-style-position'
  ];

  // The inline styles of a captured answer (V10). A page element has dozens of computed values; writing all of them on every
  // element made the html of an answer ~20 times the size of its text (800 bytes per element) and filled the extension storage.
  // Now an inherited value equal to the one of the parent is not written (the parent carries it), the shorthands that repeat the
  // longhands are not written, and the neutral values (0px, transparent, no decoration) are not written. The root of a capture
  // carries all inherited values, so the answer looks the same where it is shown.
  const INLINE_INHERITED = new Set(['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-transform', 'line-height',
    'letter-spacing', 'text-align', 'white-space', 'list-style-type', 'list-style-position']);
  const isNeutralInlineValue = (prop, value) => {
    if (!value) return true;
    if (prop === 'background-color') return /^(transparent|rgba\(0, 0, 0, 0\))$/.test(value);
    if (prop === 'text-decoration') return /^none\b/.test(value);
    if (/^border-(top|right|bottom|left)$/.test(prop)) return /^(0px|none)\b/.test(value);
    return /^(margin|padding)-/.test(prop) || prop === 'border-radius' ? value === '0px' : false;
  };

  // Layout (flex / grid), written ONLY for flex and grid containers and their direct children, and only values
  // that differ from the defaults: declarative UI blocks (ChatGPT "DIL": boxes, rows, columns, cards) are
  // laid out by it; an ordinary answer has none of it and its html does not grow.
  const LAYOUT_CONTAINER = /^(?:inline-)?(?:flex|grid)$/;
  const layoutStyle = (computed, parentComputed) => {
    const get = (prop) => String(computed.getPropertyValue(prop) || '').trim();
    const out = [];
    const display = get('display');
    if (LAYOUT_CONTAINER.test(display)) {
      out.push(`display:${display}`);
      const put = (prop, skip) => { const value = get(prop); if (value && !skip.test(value)) out.push(`${prop}:${value}`); };
      if (/flex/.test(display)) {
        put('flex-direction', /^row$/);
        put('flex-wrap', /^nowrap$/);
      } else {
        put('grid-template-columns', /^none$/);
        put('grid-template-rows', /^none$/);
        put('grid-auto-flow', /^row$/);
      }
      put('align-items', /^(?:normal|stretch)$/);
      put('justify-content', /^(?:normal|flex-start|start)$/);
      put('align-content', /^(?:normal|stretch)$/);
      const rowGap = get('row-gap');
      const columnGap = get('column-gap');
      const zero = /^(?:normal|0px)$/;
      if (!zero.test(rowGap) && rowGap === columnGap) out.push(`gap:${rowGap}`);
      else {
        if (!zero.test(rowGap)) out.push(`row-gap:${rowGap}`);
        if (!zero.test(columnGap)) out.push(`column-gap:${columnGap}`);
      }
    }
    if (parentComputed && LAYOUT_CONTAINER.test(String(parentComputed.getPropertyValue('display') || '').trim())) {
      const flex = get('flex');
      if (flex && !/^0 1 auto$/.test(flex)) out.push(`flex:${flex}`);
      const alignSelf = get('align-self');
      if (alignSelf && !/^(?:auto|normal)$/.test(alignSelf)) out.push(`align-self:${alignSelf}`);
      const justifySelf = get('justify-self');
      if (justifySelf && !/^(?:auto|normal)$/.test(justifySelf)) out.push(`justify-self:${justifySelf}`);
    }
    return out.length ? `${out.join(';')};` : '';
  };

  const buildInlineStyle = (element, parent = null) => {
    if (!element || element.nodeType !== 1) return '';
    const computed = window.getComputedStyle?.(element);
    if (!computed) return '';
    const parentComputed = parent ? window.getComputedStyle?.(parent) : null;
    const layoutParent = element.parentElement ? window.getComputedStyle?.(element.parentElement) : null;
    return layoutStyle(computed, layoutParent) + INLINE_STYLE_PROPERTIES.map((prop) => {
      const value = String(computed.getPropertyValue(prop) || '').trim();
      if (!value) return '';
      if (INLINE_INHERITED.has(prop)) {
        if (parentComputed && String(parentComputed.getPropertyValue(prop) || '').trim() === value) return '';
      } else if (isNeutralInlineValue(prop, value)) {
        return '';
      }
      return `${prop}:${value};`;
    }).join('');
  };

  const applyInlineStyles = (source, target, parent = null) => {
    const style = buildInlineStyle(source, parent);
    // The computed form replaces the style the page itself wrote on the element (as before); nothing left to say removes it.
    if (style) {
      target.setAttribute('style', style);
    } else {
      target.removeAttribute('style');
    }
  };

  const cloneElementWithInlineStyles = (element) => {
    if (!element || element.nodeType !== 1) return null;
    const clone = element.cloneNode(true);
    const sourceWalker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT, null);
    const cloneWalker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT, null);
    let sourceNode = element;
    let cloneNode = clone;
    while (sourceNode && cloneNode) {
      // The root and its children carry every inherited value: the html of a capture without its root (innerHTML) stays whole.
      const parent = sourceNode === element || sourceNode.parentElement === element ? null : sourceNode.parentElement;
      applyInlineStyles(sourceNode, cloneNode, parent);
      sourceNode = sourceWalker.nextNode();
      cloneNode = cloneWalker.nextNode();
    }
    return clone;
  };

  const stripHiddenElements = (root) => {
    if (!root || root.nodeType !== 1) return;
    root.querySelectorAll('[style*="display: none"], [style*="visibility: hidden"]').forEach((node) => node.remove());
  };

  const RESPONSE_CLEANUP_SELECTORS = [
    'script',
    'style',
    'noscript',
    'svg',
    'canvas',
    'button',
    '[role="button"]',
    // tab strips switch views of a block (Diagram | Code): furniture, never the answer
    '[role="tablist"]',
    '[data-message-part-type="reasoning"]',
    'h6.screen-reader-model-response-label',
    '[aria-hidden="true"]',
    '[inert]',
    'header',
    'footer',
    'nav',
    'aside',
    'form'
  ].join(', ');

  // Content SVG (diagrams, charts) -> <img data:image/svg+xml;base64>. An image runs no
  // script and survives sanitizeHTML (utils/sanitize.js allows exactly this src form).
  // The same rules are duplicated in background/job-orchestrator.js
  // (extractLatestAssistantSnapshotInPage serializes into the page and cannot import this);
  // tests/answer-markdown-svg-html.test.js keeps the two in step.
  const SVG_IMG_MIN_SIDE = 48;
  // A picture is a diagram (content), not an icon, when it is wider than an icon AND any of: taller than an icon;
  // wide (a flat flowchart LR squeezed into a panel is 412x30 on the page); its view box is wide, or much bigger than
  // what is drawn; it carries a diagram mark (mermaid id/class, aria-roledescription, a diagram/preview container,
  // role=img with a caption); it has the parts of a diagram (nodes, many texts/paths). Icons (<= 48 on both sides,
  // few elements) keep being cut or turned into pictures by the icon rules.
  const DIAGRAM_MARK_RE = /mermaid|flowchart|diagram|диаграмм|график|chart/i;
  const isDiagramSized = (svg, rect) => {
    if (!(rect.width > SVG_IMG_MIN_SIDE)) return false;
    if (rect.height > SVG_IMG_MIN_SIDE || (rect.width >= 200 && rect.height >= 12)) return true;
    const box = String(svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (box.length === 4 && box.every(Number.isFinite) && (box[2] > 200 || (box[2] * box[3]) >= 4 * Math.max(1, rect.width * rect.height))) return true;
    const marks = `${svg.getAttribute('id') || ''} ${svg.getAttribute('class') || ''} ${svg.getAttribute('aria-roledescription') || ''} ${svg.getAttribute('aria-label') || ''}`;
    if (DIAGRAM_MARK_RE.test(marks)) return true;
    if (svg.closest('[data-code-block-preview-pane],[data-mermaid]')) return true;
    const holder = svg.closest('[role="img"][aria-label]');
    if (holder && DIAGRAM_MARK_RE.test(holder.getAttribute('aria-label') || '')) return true;
    return svg.querySelectorAll('g.node, .node').length >= 3 || svg.querySelectorAll('text, path').length >= 5;
  };
  const SVG_IMG_MAX_BASE64 = 400000;
  const SVG_IMG_TOTAL_MAX_BASE64 = 1500000;
  // Never content: page chrome and reasoning. A picture inside a button / aria-hidden wrapper is
  // content only when it is not an icon: it looks like a diagram (see looksLikeDiagram).
  const SVG_HARD_SKIP_ANCESTORS = '[inert], header, footer, nav, aside, form, [data-message-part-type="reasoning"]';
  const SVG_SOFT_SKIP_ANCESTORS = 'button, [role="button"], [aria-hidden="true"]';
  const looksLikeDiagram = (svg) => !!svg.querySelector('text, foreignObject')
    || svg.querySelectorAll('path, rect, circle, ellipse, line, polyline, polygon').length >= 6;
  const EMBED_SELECTOR = 'iframe, object, embed';
  // Small icons that are part of a declarative UI block (ChatGPT: [data-d-component] boxes, rows, arrows between
  // cards) are content: without them a scheme has no arrows and no markers. Anywhere else a small svg is
  // decoration and is cut. An icon is saved as a picture with currentColor replaced by its computed color
  // (an <img> cannot inherit the color). Over the limits, icons are dropped silently (decor); arrows between
  // blocks (an icon among siblings in a flex/grid parent) are exempt from the count limit.
  const ICON_MIN_SIDE = 6;
  const ICON_MAX_BASE64 = 11000;
  const ICON_MAX_COUNT = 60;
  const ICON_TOTAL_MAX_BASE64 = 300000;
  let lastInlineHtmlNotes = [];
  const utf8ToBase64 = (text) => {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  };
  const isBlockIcon = (svg, root) => {
    if (!svg.closest('[data-d-component]') || svg.getAttribute('aria-hidden') === 'true') return false;
    const up = (node) => node.parentElement || (node.getRootNode && node.getRootNode().host) || null;
    for (let node = up(svg); node && node !== root.parentElement; node = up(node)) {
      if (node.localName === 'svg' || node.matches?.(SVG_HARD_SKIP_ANCESTORS) || node.matches?.(SVG_SOFT_SKIP_ANCESTORS)) return false;
    }
    const rect = svg.getBoundingClientRect();
    return rect.width >= ICON_MIN_SIDE && rect.height >= ICON_MIN_SIDE && rect.width <= SVG_IMG_MIN_SIDE && rect.height <= SVG_IMG_MIN_SIDE;
  };
  const isConnectorIcon = (svg) => {
    // Between two blocks of a flex/grid parent (an arrow from one card to the next), not a marker at the start of a row.
    const parent = svg.parentElement;
    if (!parent || !svg.previousElementSibling || !svg.nextElementSibling) return false;
    return /flex|grid/.test(String(window.getComputedStyle(parent).display || ''));
  };
  const iconToImage = (svg, doc, state) => {
    const rect = svg.getBoundingClientRect();
    const connector = isConnectorIcon(svg);
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    const copy = svg.cloneNode(true);
    copy.querySelectorAll('script').forEach((node) => node.remove());
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    if (!copy.getAttribute('viewBox')) copy.setAttribute('viewBox', `0 0 ${width} ${height}`);
    copy.setAttribute('width', String(width));
    copy.setAttribute('height', String(height));
    ['maxWidth', 'minWidth', 'width', 'height', 'maxHeight', 'minHeight'].forEach((name) => { copy.style[name] = ''; });
    if (!copy.getAttribute('style')) copy.removeAttribute('style');
    const color = String(window.getComputedStyle(svg).color || '').trim() || '#000';
    const base64 = utf8ToBase64(new XMLSerializer().serializeToString(copy).replace(/currentColor/gi, color));
    if (base64.length > ICON_MAX_BASE64 || state.iconBytes + base64.length > ICON_TOTAL_MAX_BASE64
      || (!connector && state.iconCount >= ICON_MAX_COUNT)) return null;
    state.iconBytes += base64.length;
    if (!connector) state.iconCount += 1;
    const img = doc.createElement('img');
    img.setAttribute('src', `data:image/svg+xml;base64,${base64}`);
    img.setAttribute('alt', '');
    img.setAttribute('width', String(width));
    img.setAttribute('height', String(height));
    img.setAttribute('data-ao-keep', '1');
    return img;
  };
  // A picture that is not laid out (the tab that shows it is not the active one: display:none) has a 0x0 rectangle. A diagram
  // is still content: take the size it declares (view box, width/height), but only for something that looks like a diagram.
  const layoutRect = (svg) => {
    const rect = svg.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) return rect;
    const box = String(svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    const width = (box.length === 4 && box[2] > 0 ? box[2] : parseFloat(svg.getAttribute('width'))) || 0;
    const height = (box.length === 4 && box[3] > 0 ? box[3] : parseFloat(svg.getAttribute('height'))) || 0;
    const marks = `${svg.getAttribute('id') || ''} ${svg.getAttribute('class') || ''} ${svg.getAttribute('aria-roledescription') || ''}`;
    const diagram = DIAGRAM_MARK_RE.test(marks) || svg.querySelectorAll('g.node, .node').length >= 3 || svg.querySelectorAll('text, path').length >= 5;
    return width > 0 && height > 0 && diagram ? { width, height, top: 0, bottom: height, left: 0, right: width } : rect;
  };
  const isContentSvg = (svg, root) => {
    let inSoftWrapper = false;
    // The climb crosses shadow roots (a shadow root has no parentElement: continue through its host).
    const up = (node) => node.parentElement || (node.getRootNode && node.getRootNode().host) || null;
    for (let node = up(svg); node && node !== root.parentElement; node = up(node)) {
      if (node.localName === 'svg') return false;
      if (node.matches?.(SVG_HARD_SKIP_ANCESTORS)) return false;
      if (node.matches?.(SVG_SOFT_SKIP_ANCESTORS)) inSoftWrapper = true;
    }
    const rect = layoutRect(svg);
    if (!isDiagramSized(svg, rect)) return false;
    return !inSoftWrapper || looksLikeDiagram(svg);
  };
  // Fit the picture to its content (no empty field, nothing cut) and give it the size it has on the
  // page. The same code is in background/job-orchestrator.js (htmlWithSvgImages); the svg tests keep both equal.
  const fitSvgToContent = (svg, copy, rect) => {
    const parse = (value) => String(value || '').trim().split(/[\s,]+/).map(Number);
    const declared = parse(svg.getAttribute('viewBox'));
    const view = declared.length === 4 && declared.every(Number.isFinite) && declared[2] > 0 && declared[3] > 0
      ? { x: declared[0], y: declared[1], w: declared[2], h: declared[3] } : null;
    // Rendered scale, user units -> screen pixels (preserveAspectRatio "meet" uses the smaller ratio).
    const scale = view ? Math.min(rect.width / view.w, rect.height / view.h) : 1;
    let box = view || { x: 0, y: 0, w: rect.width, h: rect.height };
    try {
      const bbox = svg.getBBox();
      if (bbox && bbox.width > 0 && bbox.height > 0) {
        const pad = Math.min(8, Math.max(1, 0.02 * Math.max(bbox.width, bbox.height))); // up to 8 units for labels and strokes, less on a small drawing
        const fit = { x: bbox.x - pad, y: bbox.y - pad, w: bbox.width + 2 * pad, h: bbox.height + 2 * pad };
        // What was visible on the page: the content box cut by the declared view box.
        const x0 = view ? Math.max(fit.x, view.x) : fit.x;
        const y0 = view ? Math.max(fit.y, view.y) : fit.y;
        const x1 = view ? Math.min(fit.x + fit.w, view.x + view.w) : fit.x + fit.w;
        const y1 = view ? Math.min(fit.y + fit.h, view.y + view.h) : fit.y + fit.h;
        if (x1 - x0 > 0 && y1 - y0 > 0) box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
    } catch (_) {}
    // A diagram the page squeezed into a narrow panel (a wide flowchart drawn 30px high) keeps its own size (1 unit = 1px)
    // so that it stays legible; the card's max-width:100% still fits it to the card. Otherwise: the size it had on the page.
    const squeezed = view && scale > 0 && scale < 0.6;
    const pxPerUnit = squeezed ? 1 : (scale > 0 && Number.isFinite(scale) ? scale : 1);
    const width = Math.max(1, Math.round(box.w * pxPerUnit));
    const height = Math.max(1, Math.round(box.h * pxPerUnit));
    copy.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
    copy.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    copy.setAttribute('width', String(width));
    copy.setAttribute('height', String(height));
    // The page's own size limits (mermaid: max-width:1200px) would crop the standalone picture.
    ['maxWidth', 'minWidth', 'width', 'height', 'maxHeight', 'minHeight'].forEach((name) => { copy.style[name] = ''; });
    if (!copy.getAttribute('style')) copy.removeAttribute('style');
    return { width, height };
  };
  // The css that styles an svg living in a shadow root: every <style> of that root outside the svg, and its
  // constructable style sheets. Inside a standalone svg they must be a <style> of the svg itself.
  const shadowCssOf = (svg) => {
    const root = svg.getRootNode ? svg.getRootNode() : null;
    if (!root || !root.host) return '';
    const css = [];
    try { root.querySelectorAll('style').forEach((style) => { if (!style.closest('svg')) css.push(style.textContent || ''); }); } catch (_) {}
    try {
      (root.adoptedStyleSheets || []).forEach((sheet) => css.push(Array.from(sheet.cssRules || []).map((rule) => rule.cssText).join('\n')));
    } catch (_) {}
    return css.join('\n').trim();
  };
  // "Диаграмма Mermaid (sequence)": the kind comes from aria-roledescription (flowchart-v2 -> flowchart).
  const diagramAlt = (svg) => {
    const kind = String(svg.getAttribute('aria-roledescription') || '').toLowerCase().replace(/-(?:v\d+|beta)$/, '').trim();
    const mermaid = /mermaid|flowchart/i.test(`${svg.getAttribute('id') || ''} ${svg.getAttribute('class') || ''} ${kind}`)
      || /^(?:sequence|flowchart|state|class|er|gantt|pie|journey|mindmap|timeline|gitgraph|quadrantchart|requirement|c4)/.test(kind);
    return mermaid ? `Диаграмма Mermaid${kind ? ` (${kind})` : ''}` : 'Диаграмма';
  };
  const svgToImage = (svg, doc, state, rectOverride = null) => {
    const rect = rectOverride || layoutRect(svg);
    const copy = svg.cloneNode(true);
    copy.querySelectorAll('script').forEach((node) => node.remove());
    const outerCss = shadowCssOf(svg);
    if (outerCss) {
      const style = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
      style.textContent = outerCss;
      copy.insertBefore(style, copy.firstChild);
    }
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    const { width, height } = fitSvgToContent(svg, copy, rect);
    const base64 = utf8ToBase64(new XMLSerializer().serializeToString(copy));
    state.position += 1;
    if (base64.length > SVG_IMG_MAX_BASE64 || state.total + base64.length > SVG_IMG_TOTAL_MAX_BASE64) {
      state.notes.push({ type: 'svg', reason: 'диаграмма не сохранена в HTML: размер', position: state.position });
      const note = doc.createElement('p');
      note.textContent = '[диаграмма не сохранена: размер]';
      return note;
    }
    state.total += base64.length;
    const img = doc.createElement('img');
    img.setAttribute('src', `data:image/svg+xml;base64,${base64}`);
    img.setAttribute('alt', diagramAlt(svg));
    img.setAttribute('width', String(width));
    img.setAttribute('height', String(height));
    img.setAttribute('data-ao-keep', '1');
    return img;
  };
  // An iframe / object / embed would be removed by the sanitizer without a trace. Its content svg
  // (same-origin document or srcdoc) is saved as a picture like any diagram; anything else becomes a
  // visible note (host only: no path, query or credentials) and a copyReport entry.
  const embedToNode = (el, doc, state) => {
    const kind = String(el.localName || 'iframe');
    let inner = null;
    let rect = null;
    try { inner = el.contentDocument?.querySelector('svg') || null; } catch (_) { inner = null; }
    if (!inner && el.getAttribute('srcdoc')) {
      try {
        inner = new DOMParser().parseFromString(el.getAttribute('srcdoc'), 'text/html').querySelector('svg');
        if (inner) {
          const box = (inner.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
          const w = parseFloat(inner.getAttribute('width')) || box[2] || el.getBoundingClientRect().width;
          const h = parseFloat(inner.getAttribute('height')) || box[3] || el.getBoundingClientRect().height;
          rect = { width: w, height: h };
        }
      } catch (_) { inner = null; }
    }
    if (inner) {
      rect = rect || inner.getBoundingClientRect();
      if (isDiagramSized(inner, rect)) return svgToImage(inner, doc, state, rect);
    }
    let host = '';
    const address = el.getAttribute('src') || el.getAttribute('data') || '';
    try { host = address ? new URL(address, el.ownerDocument.baseURI).hostname : ''; } catch (_) { host = ''; }
    state.position += 1;
    state.notes.push({ type: 'embed', reason: `встроенный блок (${kind}) не скопирован: ${host || 'без адреса'}`, position: state.position });
    const note = doc.createElement('p');
    note.textContent = `[встроенный блок не скопирован: ${kind} ${host || 'без адреса'}]`;
    note.setAttribute('data-ao-keep', '1');
    return note;
  };
  // Pairs every svg of the source with its place in the structural copy, in document order, and
  // goes INTO open shadow roots: a shadow host has no light children, its copy is an empty element, so the
  // host (not the svg) is what is replaced there. The same walk is in background/job-orchestrator.js.
  const collectShadowSvgs = (scope, out) => {
    Array.from(scope.children).forEach((el) => {
      if (el.localName === 'svg') { out.push(el); return; }
      if (el.shadowRoot) collectShadowSvgs(el.shadowRoot, out);
      collectShadowSvgs(el, out);
    });
    return out;
  };
  const pairSvgTargets = (source, copy, out = []) => {
    const sourceChildren = Array.from(source.children);
    const copyChildren = Array.from(copy.children);
    if (sourceChildren.length !== copyChildren.length) return out;
    sourceChildren.forEach((child, index) => {
      const target = copyChildren[index];
      if (child.localName === 'svg') { out.push({ svgs: [child], target, host: false }); return; }
      if (child.shadowRoot) {
        const inner = collectShadowSvgs(child.shadowRoot, []);
        if (inner.length) out.push({ svgs: inner, target, host: child });
      }
      pairSvgTargets(child, target, out);
    });
    return out;
  };
  // sourceRoot has the layout (rects); cloneRoot is its structural copy that is edited.
  const replaceContentSvgs = (sourceRoot, cloneRoot, state) => {
    const doc = cloneRoot.ownerDocument;
    pairSvgTargets(sourceRoot, cloneRoot).forEach(({ svgs, target, host }) => {
      try {
        if (!host && !isContentSvg(svgs[0], sourceRoot)) {
          if (isBlockIcon(svgs[0], sourceRoot)) {
            const icon = iconToImage(svgs[0], doc, state);
            if (icon) target.replaceWith(icon);
          }
          return;
        }
        const content = svgs.filter((svg) => isContentSvg(svg, sourceRoot));
        if (!content.length) return;
        const images = content.map((svg) => svgToImage(svg, doc, state));
        if (!host) { target.replaceWith(images[0]); return; }
        if (images.length === 1) {
          if (images[0].localName === 'img') images[0].setAttribute('alt', host.getAttribute('aria-label') || 'Диаграмма');
          target.replaceWith(images[0]);
          return;
        }
        target.textContent = '';
        images.forEach((image) => target.append(image));
      } catch (_) {}
    });
    const embeds = Array.from(sourceRoot.querySelectorAll(EMBED_SELECTOR));
    const embedClones = Array.from(cloneRoot.querySelectorAll(EMBED_SELECTOR));
    if (embeds.length !== embedClones.length) return;
    embeds.forEach((el, index) => {
      try {
        // A Mermaid iframe next to its source is passed on as that source: no "not copied" note.
        if (/mermaid/i.test(el.getAttribute('title') || '') && mermaidSourceNear(el)) { embedClones[index].remove(); return; }
        embedClones[index].replaceWith(embedToNode(el, cloneRoot.ownerDocument, state));
      } catch (_) {}
    });
  };
  // Pictures and notes made above must survive the cleanup that removes buttons and hidden wrappers.
  const hoistKeptNodes = (clone, removing = null) => {
    clone.querySelectorAll('[data-ao-keep]').forEach((node) => {
      let top = null;
      for (let n = node.parentElement; n && n !== clone; n = n.parentElement) {
        if (n.matches(RESPONSE_CLEANUP_SELECTORS) || (removing && removing.has(n))) top = n;
      }
      if (top && top.parentNode) top.parentNode.insertBefore(node, top);
      node.removeAttribute('data-ao-keep');
    });
  };

  // Hidden content is found in the SOURCE page (computed display:none / visibility:hidden of the element or an
  // ancestor), not in the copy: inline styles do not carry display, so the copy cannot tell. A hidden <pre> that
  // holds Mermaid source is the diagram's source and is kept (as a mermaid code block) even though its panel is hidden.
  const MERMAID_SOURCE_RE = /^\s*(?:%%\{[\s\S]*?\}%%\s*)?(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|journey|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|C4Context)\b/;
  const walkPairs = (source, copy, visit) => {
    const sourceChildren = Array.from(source.children);
    const copyChildren = Array.from(copy.children);
    if (sourceChildren.length !== copyChildren.length) return;
    sourceChildren.forEach((child, index) => {
      visit(child, copyChildren[index]);
      walkPairs(child, copyChildren[index], visit);
    });
  };
  // The page draws a diagram lazily (when it comes into view): until then there is a status placeholder, not a picture.
  const LOADING_LABEL_RE = /диаграмм|diagram|mermaid|chart|график|схем/i;
  const isLoadingPlaceholder = (el) => el.getAttribute('role') === 'status' && LOADING_LABEL_RE.test(el.getAttribute('aria-label') || '')
    && !el.querySelector('svg, img, canvas, pre');
  const planHiddenAndMermaid = (source, copy) => {
    const hidden = new Set();
    const mermaid = [];
    const loading = [];
    walkPairs(source, copy, (s, c) => {
      let style = null;
      try { style = window.getComputedStyle(s); } catch (_) { style = null; }
      if (style && (style.display === 'none' || style.visibility === 'hidden')) hidden.add(c);
      if (s.localName === 'pre' && MERMAID_SOURCE_RE.test(s.textContent || '')) mermaid.push({ source: s, copy: c });
      if (isLoadingPlaceholder(s)) loading.push({ source: s, copy: c });
    });
    return { hidden, mermaid, loading };
  };
  const mermaidSourceNear = (el) => {
    let depth = 0;
    for (let n = el.parentElement; n && depth < 3; n = n.parentElement, depth += 1) {
      if (Array.from(n.querySelectorAll('pre')).some((pre) => MERMAID_SOURCE_RE.test(pre.textContent || ''))) return true;
    }
    return false;
  };

  const buildInlineHtml = (element, options = {}) => {
    if (!element || element.nodeType !== 1) return '';
    const includeRoot = options.includeRoot !== false;
    const clone = cloneElementWithInlineStyles(element) || element.cloneNode(true);
    const svgState = { total: 0, position: 0, notes: [], iconCount: 0, iconBytes: 0 };
    let plan = { hidden: new Set(), mermaid: [], loading: [] };
    try { plan = planHiddenAndMermaid(element, clone); } catch (_) {}
    // Mermaid source: a clean code block marked as such, kept even when its panel is hidden.
    plan.mermaid.forEach(({ source, copy }) => {
      try {
        const pre = clone.ownerDocument.createElement('pre');
        pre.setAttribute('data-code-lang', 'mermaid');
        const code = clone.ownerDocument.createElement('code');
        code.className = 'language-mermaid';
        code.textContent = source.textContent;
        pre.appendChild(code);
        pre.setAttribute('data-ao-keep', '1');
        copy.replaceWith(pre);
      } catch (_) {}
    });
    // A diagram the page has not drawn yet: say so (visible note + report), never a silent gap.
    plan.loading.forEach(({ source, copy }) => {
      try {
        const label = (source.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        svgState.position += 1;
        svgState.notes.push({ type: 'diagram', reason: `страница не отрисовала диаграмму: ${label}`, position: svgState.position });
        const note = clone.ownerDocument.createElement('p');
        note.textContent = `[диаграмма не отрисована страницей: ${label}]`;
        note.setAttribute('data-ao-keep', '1');
        copy.replaceWith(note);
      } catch (_) {}
    });
    try { replaceContentSvgs(element, clone, svgState); } catch (_) {}
    lastInlineHtmlNotes = svgState.notes;
    // Hidden content leaves the copy (the kept nodes above are moved out of hidden panels first).
    try {
      hoistKeptNodes(clone, plan.hidden);
      plan.hidden.forEach((node) => { if (node.parentNode) node.remove(); });
    } catch (_) {}
    // A <pre> that is only the shell of a rendered diagram (header with tabs and buttons, a hidden editor, canvases, the picture) is
    // not code: it becomes its picture. A <pre> that really holds the source (a visible editor with all lines) becomes a mermaid block.
    try {
      clone.querySelectorAll('pre').forEach((pre) => {
        const pictures = Array.from(pre.querySelectorAll('img[alt^="Диаграмма"]'));
        if (!pictures.length) return;
        const lines = Array.from(pre.querySelectorAll('.view-line')).map((line) => line.textContent.replace(/\u00a0/g, ' '));
        if (lines.length >= 2 && MERMAID_SOURCE_RE.test(lines.join('\n'))) {
          const source = clone.ownerDocument.createElement('pre');
          source.setAttribute('data-code-lang', 'mermaid');
          const code = clone.ownerDocument.createElement('code');
          code.className = 'language-mermaid';
          code.textContent = lines.join('\n');
          source.appendChild(code);
          pre.replaceWith(source);
          return;
        }
        const shell = clone.ownerDocument.createElement('div');
        pictures.forEach((picture) => shell.appendChild(picture));
        pre.replaceWith(shell);
      });
    } catch (_) {}
    // A provider's code block becomes a clean <pre data-code-lang><code class="language-x">exact text</code></pre>
    // (the engine's own detection, so the card, the html and the Markdown copy agree). No syntax highlighting is kept:
    // the code is plain text. Without the engine the old html is kept as it was.
    try {
      const engine = window.AnswerMarkdown;
      if (engine && typeof engine.normalizeCodeBlocks === 'function') engine.normalizeCodeBlocks(clone, { provider: options.provider || null });
    } catch (_) {}
    // A code block whose text is Mermaid source is a mermaid block even when the provider's own rules found no language
    // (DeepSeek's banner carries the Diagram | Code tabs, not a language).
    try {
      clone.querySelectorAll('pre').forEach((pre) => {
        if (pre.getAttribute('data-code-lang')) return;
        if (!MERMAID_SOURCE_RE.test(pre.textContent || '')) return;
        pre.setAttribute('data-code-lang', 'mermaid');
        const code = pre.querySelector('code');
        if (code && !code.className) code.className = 'language-mermaid';
      });
    } catch (_) {}
    try { hoistKeptNodes(clone); } catch (_) {}
    try { stripHiddenElements(clone); } catch (_) {}
    // The model's reasoning is not the answer (a node widened to the whole message holds both).
    try {
      Array.from(clone.querySelectorAll(REASONING_PREFILTER)).filter(isReasoningBlock).forEach((block) => { if (block.parentNode && block !== clone) block.remove(); });
    } catch (_) {}
    try {
      clone.querySelectorAll(RESPONSE_CLEANUP_SELECTORS).forEach((node) => node.remove());
    } catch (_) {}
    return includeRoot ? (clone.outerHTML || '') : (clone.innerHTML || '');
  };

  // ---------------------------------------------------------------------------- the answer of one turn
  // A model's answer can be several blocks (prose, a diagram widget, prose...). A node found by a selector
  // (".prose") may be only one of them. expandToTurn(node, peers) returns the node that holds the WHOLE answer of
  // the same turn: the common ancestor of `node` and its peers (other nodes the same selector found) that are in
  // the same turn, i.e. neither the common ancestor is a page/conversation container (several assistant turns, a
  // user message, the composer, navigation) nor a turn boundary lies between them (a user message, composer, form,
  // navigation, the first-level heading that carries the question). The ancestor is then widened while the
  // neighbours it takes in are only embedded/diagram/code/media blocks (a diagram after the last prose block).
  // status: 'same' | 'expanded' | 'split' (peers are in the same turn by every sign, but only a page-level container
  // would hold them: the caller must fail instead of returning half an answer).
  const ROLE_ASSISTANT_SEL = '[data-message-author-role="assistant"],[data-role="assistant"],[data-author-role="assistant"]';
  const ROLE_USER_SEL = '[data-message-author-role="user"],[data-role="user"],[data-author-role="user"]';
  // The user's own message is recognised by its NAME, whatever the provider calls it. A name is split into whole words
  // (user-message -> user, message); it is a user message when a word says "user" (user, human, prompt, query, question)
  // and no word says it is only part of the furniture around it (avatar, name, menu, select, related, suggested...).
  // Looked at: data-testid, the role attributes, aria-label; class names only as "who + what" (user-message, human-turn).
  const WHO_WORDS = new Set(['user', 'human', 'prompt', 'query', 'question']);
  const FURNITURE_WORDS = new Set(['avatar', 'name', 'username', 'icon', 'menu', 'profile', 'settings', 'badge', 'picture', 'image', 'img', 'select',
    'link', 'button', 'btn', 'action', 'actions', 'input', 'toolbar', 'toggle', 'related', 'suggested', 'suggestion', 'suggestions', 'follow', 'followup',
    'sidebar', 'header', 'footer', 'label', 'tooltip', 'popover', 'dialog', 'modal', 'copy', 'edit', 'time', 'timestamp']);
  const WHAT_WORDS = new Set(['message', 'msg', 'turn', 'bubble', 'text', 'content', 'query', 'prompt', 'question', 'row', 'item']);
  const words = (value) => String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const nameIsUser = (value, strict) => {
    const list = words(value);
    if (!list.length || list.some((word) => FURNITURE_WORDS.has(word))) return false;
    if (!list.some((word) => WHO_WORDS.has(word))) return false;
    // class names are common words everywhere: demand "who + what"; ids and roles may be the bare word
    return strict ? list.some((word) => WHAT_WORDS.has(word) && !WHO_WORDS.has(word)) : true;
  };
  const isUserMessage = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const roleAttr = [el.getAttribute('data-message-author-role'), el.getAttribute('data-role'), el.getAttribute('data-author-role')];
    if (roleAttr.some((value) => value && /^(?:user|human)$/i.test(value.trim()))) return true;
    if (nameIsUser(el.getAttribute('data-testid'), false) || nameIsUser(el.getAttribute('aria-label'), true)) return true;
    return nameIsUser(typeof el.className === 'string' ? el.className.replace(/\s+/g, '-') : '', true);
  };
  const USER_CANDIDATES_SEL = '[data-testid],[data-message-author-role],[data-role],[data-author-role],[aria-label],[class*="user" i],[class*="human" i],[class*="prompt" i],[class*="query" i],[class*="question" i]';
  const containsUserMessage = (el) => {
    try { return Array.from(el.querySelectorAll(USER_CANDIDATES_SEL)).some(isUserMessage); } catch (_) { return false; }
  };
  const insideUserMessage = (el) => {
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) if (isUserMessage(node)) return true;
    return false;
  };
  // A turn the page marks explicitly as one assistant answer: the answer never reaches beyond it.
  // DeepSeek marks the answer block itself (.ds-assistant-message-main-content): its header "Thought for N seconds" and the
  // reasoning sit next to it in the same message and are not the answer.
  const TURN_OWNER_SEL = `${ROLE_ASSISTANT_SEL},[role="article"],[data-testid="assistant-message"],[data-testid$="-assistant-message" i],[data-testid^="assistant-message" i],.ds-assistant-message-main-content`;
  const TURN_BOUNDARY_SEL = `${ROLE_USER_SEL},textarea,[contenteditable="true"],form,nav,h1`;
  const containsBoundary = (el) => Array.from(el.querySelectorAll(TURN_BOUNDARY_SEL)).some((mark) => !(mark.matches('textarea,[contenteditable="true"]') && isEditorInput(mark)));
  const PAGE_CHROME_SEL = 'textarea,[contenteditable="true"],form,nav';
  // Inputs that belong to a CODE EDITOR inside the answer (Monaco / CodeMirror of a diagram or code block: a hidden <textarea>,
  // a contenteditable layer) are not the page's composer. Only an input outside code blocks, not read-only and not hidden, is page chrome.
  const EDITOR_HOST_SEL = 'pre, code, [role="code"], .monaco-editor, .cm-editor, .CodeMirror, [class*="monaco" i], [class*="codemirror" i], [class*="code-editor" i], [data-mode-id]';
  const isEditorInput = (el) => {
    if (el.closest(EDITOR_HOST_SEL)) return true;
    if (el.hasAttribute('readonly') || el.getAttribute('aria-hidden') === 'true') return true;
    return false;
  };
  const containsPageChrome = (el) => {
    try {
      return Array.from(el.querySelectorAll(PAGE_CHROME_SEL)).some((node) => !isEditorInput(node));
    } catch (_) { return false; }
  };
  // A reasoning ("thinking") block of the model, whatever the provider names it (ds-think-content, thinking-container, thought-chain,
  // reasoning_block...): a WHOLE WORD of its class / id / testid / type says so. "thinker", "reasonable", "cotton" do not.
  // The same rule is duplicated in background/job-orchestrator.js (extractLatestAssistantSnapshotInPage) and content-scripts/answer-structure.js.
  const REASONING_WORDS = new Set(['think', 'thinking', 'thought', 'thoughts', 'reasoning', 'cot']);
  const REASONING_PREFILTER = '[class*="think" i],[class*="thought" i],[class*="reasoning" i],[class*="cot" i],[id*="think" i],[id*="thought" i],[id*="reasoning" i],[data-testid*="think" i],[data-testid*="thought" i],[data-testid*="reasoning" i],[data-type*="reasoning" i],[data-type*="think" i],[data-content-type*="reasoning" i]';
  const FLAG_WORDS = new Set(['has', 'have', 'with', 'no', 'is', 'show', 'hide', 'toggle']);
  const nameWords = (value) => String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const isReasoningBlock = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const marker = [typeof el.className === 'string' ? el.className : (el.className && el.className.baseVal) || '', el.id,
      el.getAttribute('data-testid'), el.getAttribute('data-type'), el.getAttribute('data-content-type')].filter(Boolean).join(' ');
    // "has-thoughts" / "no-thinking" are state flags of an ordinary container (Gemini's answer container), not a reasoning block.
    const list = nameWords(marker);
    return list.some((word, i) => REASONING_WORDS.has(word) && !(i > 0 && FLAG_WORDS.has(list[i - 1])));
  };
  const insideReasoning = (el) => {
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) if (isReasoningBlock(node)) return true;
    return false;
  };
  const containsReasoning = (el) => {
    try { return Array.from(el.querySelectorAll(REASONING_PREFILTER)).some(isReasoningBlock); } catch (_) { return false; }
  };
  // Several sibling elements of ONE "message" family (ds-message + ds-message, chat-message...) mean a container of SEVERAL TURNS:
  // an answer never reaches beyond one of them. Perplexity's several .prose of one turn are not a "message" family.
  // A class names a MESSAGE when "message"/"msg" ends it (ds-message, chat-message) or is followed by item/bubble/container/turn/row
  // (message-item): "hide-from-message-actions" is not a message.
  const MESSAGE_TAILS = new Set(['item', 'bubble', 'container', 'turn', 'row', 'wrapper', 'block']);
  const isMessageToken = (token) => {
    const list = nameWords(token);
    const at = list.findIndex((word) => word === 'message' || word === 'msg');
    if (at < 0) return false;
    return at === list.length - 1 || (at === list.length - 2 && MESSAGE_TAILS.has(list[at + 1]));
  };
  const familyOf = (el) => (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(isMessageToken).sort().join(' ');
  const hasMessageTwins = (el) => {
    try {
      // Look at the PARENT of every message-family element inside: a parent holding two of one family (an item with the user's
      // ds-message and the assistant's ds-message) is a container of several turns, whatever its own class is called.
      const seen = new Set();
      const members = Array.from(el.querySelectorAll('[class*="message" i],[class*="msg" i]'));
      for (const member of members) {
        const parent = member.parentElement;
        if (!parent || seen.has(parent) || !(parent === el || el.contains(parent))) continue;
        seen.add(parent);
        const counts = new Map();
        for (const child of Array.from(parent.children)) {
          const family = familyOf(child);
          if (!family) continue;
          counts.set(family, (counts.get(family) || 0) + 1);
          if (counts.get(family) >= 2) return true;
        }
      }
      return false;
    } catch (_) { return false; }
  };
  const TEXT_BLOCK_SEL = 'p,li,h1,h2,h3,h4,h5,h6,a,button,input,form,blockquote';
  const isPageLevel = (el) => {
    try {
      const assistants = el.querySelectorAll(ROLE_ASSISTANT_SEL).length + (el.matches(ROLE_ASSISTANT_SEL) ? 1 : 0);
      return assistants > 1 || containsUserMessage(el) || containsPageChrome(el) || hasMessageTwins(el)
        || /^(?:body|html|main)$/i.test(el.localName) || el.getAttribute('role') === 'main';
    } catch (_) { return false; }
  };
  const commonAncestor = (a, b) => { for (let n = a; n; n = n.parentElement) if (n.contains(b)) return n; return null; };
  const boundaryBetween = (scope, first, second) => {
    const [early, late] = (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) ? [first, second] : [second, first];
    const marks = Array.from(scope.querySelectorAll(TURN_BOUNDARY_SEL)).filter((mark) => !(mark.matches('textarea,[contenteditable="true"]') && isEditorInput(mark)));
    Array.from(scope.querySelectorAll(USER_CANDIDATES_SEL)).forEach((candidate) => { if (!marks.includes(candidate) && isUserMessage(candidate)) marks.push(candidate); });
    return marks.some((mark) => {
      if (early.contains(mark) || late.contains(mark) || mark.contains(early) || mark.contains(late)) return false;
      return (early.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING)
        && (mark.compareDocumentPosition(late) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
  };
  const expandToTurn = (node, peers = []) => {
    if (!node || node.nodeType !== 1) return { node, status: 'same', members: 1 };
    // The page marks this answer's turn explicitly: nothing outside it belongs to the answer.
    const owner = node.matches(TURN_OWNER_SEL) ? node : node.closest(TURN_OWNER_SEL);
    if (owner === node) return { node, status: 'same', members: 1 };
    let turn = node;
    let members = 1;
    let ambiguous = false;
    peers.forEach((peer) => {
      if (!peer || peer === node || node.contains(peer) || peer.contains(node)) return;
      if (owner && !owner.contains(peer)) return;
      const shared = commonAncestor(node, peer);
      if (!shared) return;
      if (boundaryBetween(shared, node, peer)) return;      // another turn: a question lies between
      if (isPageLevel(shared)) { ambiguous = true; return; }  // same turn by every sign, but only a page holds both
      turn = commonAncestor(turn, peer) || turn;
      members += 1;
    });
    if (ambiguous && members === 1) return { node, status: 'split', members };
    // Widen over neighbours that are only embedded / diagram / code / media blocks (never over text or links).
    let walker = turn;
    for (let level = 0; level < 4; level += 1) {
      const parent = walker.parentElement;
      if (!parent || (owner && !owner.contains(parent)) || isPageLevel(parent) || containsBoundary(parent) || containsUserMessage(parent)) break;
      const extra = Array.from(parent.children).filter((child) => child !== walker && !child.contains(walker) && !walker.contains(child));
      if (!extra.length) { walker = parent; continue; }
      const onlyMedia = extra.every((child) => !child.matches(TEXT_BLOCK_SEL) && !child.querySelector(TEXT_BLOCK_SEL)
        && !/^(?:script|style|template)$/i.test(child.localName));
      if (!onlyMedia || !extra.some((child) => child.querySelector('iframe,object,embed,pre,svg,img,canvas,figure,table') || /^(?:iframe|object|embed|pre|svg|img|canvas|figure|table)$/i.test(child.localName))) break;
      turn = parent;   // it took in media neighbours: this is the turn now
      walker = parent;
    }
    return { node: turn, status: turn === node ? 'same' : 'expanded', members };
  };

  root.AnswerHtmlBuilder = Object.freeze({
    version: BUILDER_VERSION,
    // options: { includeRoot (default true), provider (name for the code-block rules) }
    build: (element, options = {}) => buildInlineHtml(element, options),
    // A deep copy of an element with the computed styles written inline (ContentUtils.cloneElementWithInlineStyles).
    cloneWithStyles: (element) => cloneElementWithInlineStyles(element),
    // Diagrams / embeds the html could not keep (size, not copied): [{ type, reason, position }]
    getLastNotes: () => lastInlineHtmlNotes.slice(),
    expandToTurn,
    isUserMessage,
    insideUserMessage,
    containsUserMessage,
    containsPageChrome,
    isReasoningBlock,
    insideReasoning,
    containsReasoning,
    hasMessageTwins
  });
})(typeof window !== 'undefined' ? window : globalThis);
