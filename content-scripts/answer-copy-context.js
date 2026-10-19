// WP3: контекст копирования ответа (спецификация: docs/Architecture/answer-markdown-spec.md, разделы 12 «неполный ответ» и 13).
// Не зависит от AnswerMarkdown. По умолчанию только читает DOM; клики/раскрытие — за options.expand.
(function initAnswerCopyContext(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AnswerCopyContext = api;
})(typeof self !== 'undefined' ? self : this, function factory() {
  'use strict';

  // ПОДТВЕРЖДЕНО репозиторием (answer-pipeline-selectors.js, скелеты claude.json/gemini.json): data-is-streaming, aria-busy, data-streaming,
  // data-generating, кнопка Stop. Остальное — не проверено вживую.
  const STREAMING_SELECTOR = '[data-is-streaming="true"], [aria-busy="true"], [data-streaming="true"], [data-generating="true"]';
  const STOP_SELECTOR = 'button[aria-label*="Stop" i], button[data-testid="stop-button"], button[data-testid*="stop"], button[data-testid="grok-stop-button"], .send-button-container.stop';
  // Подтверждено: gemini.json data-test-id=regenerate-button, zai.json aria-label=Regenerate; тексты «1/3» и «Continue generating» — не проверено вживую.
  const REGENERATE_SELECTOR = 'button[data-testid*="regenerate"], button[data-test-id="regenerate-button"], button[aria-label*="Regenerate" i], button[aria-label*="Try again" i]';
  const CONTINUE_RE = /^\s*(continue generating|continue|продолжить(?: генерацию)?|продолжить ответ)\s*$/i;
  const VERSION_RE = /^\s*(\d+)\s*\/\s*(\d+)\s*$/;
  const MORE_RE = /^\s*(show more|show all|read more|see more|развернуть|показать (?:больше|ещё|еще|полностью))\s*$/i;
  const DEFAULT_ASSISTANT = '[data-message-author-role="assistant"], [data-author-role="assistant"], [data-role="assistant"], [data-is-streaming]';
  const DEFAULT_USER = '[data-message-author-role="user"], [data-author-role="user"], [data-role="user"]';

  function visible(el) {
    if (!el || el.hidden) return false;
    return !(el.closest && el.closest('[hidden], [aria-hidden="true"]'));
  }
  function enabled(el) { return !el.disabled && el.getAttribute('aria-disabled') !== 'true'; }
  function label(el) { return (el.textContent || el.getAttribute('aria-label') || '').trim(); }

  function detectGenerating(el, opts) {
    if ((el.matches && el.matches(STREAMING_SELECTOR)) || el.closest(STREAMING_SELECTOR) || el.querySelector(STREAMING_SELECTOR)) return true;
    // Кнопка Stop относится ко всей странице: учитываем только для последнего ответа.
    if (opts.isLatest && opts.document) {
      return Array.from(opts.document.querySelectorAll(STOP_SELECTOR)).some((b) => visible(b) && enabled(b));
    }
    return false;
  }

  function scopes(el, opts) {
    const list = [el];
    if (opts.turn && opts.turn !== el) list.push(opts.turn);
    return list;
  }

  function detectTruncated(el, opts) {
    return scopes(el, opts).some((s) => Array.from(s.querySelectorAll('button, [role="button"]')).some((b) => visible(b) && enabled(b) && CONTINUE_RE.test(label(b))));
  }

  function detectVersion(el, opts) {
    for (const s of scopes(el, opts)) {
      const nodes = s.querySelectorAll('span, div, button, p');
      for (const n of nodes) {
        if (n.children.length) continue;
        const m = VERSION_RE.exec(n.textContent || '');
        if (m && Number(m[2]) > 1 && Number(m[1]) >= 1 && Number(m[1]) <= Number(m[2]) && visible(n)) {
          return { version: `${m[1]}/${m[2]}`, index: Number(m[1]), total: Number(m[2]) };
        }
      }
    }
    return null;
  }

  function collapsedNodes(el) {
    const found = [];
    el.querySelectorAll('details:not([open])').forEach((n) => found.push({ node: n, kind: 'details' }));
    el.querySelectorAll('[aria-expanded="false"]').forEach((n) => {
      const ctl = n.getAttribute('aria-controls');
      const controlsInside = ctl && el.querySelector(`[id="${String(ctl).replace(/"/g, '\\"')}"]`);
      if (controlsInside || MORE_RE.test(label(n))) found.push({ node: n, kind: 'aria' });
    });
    el.querySelectorAll('button, [role="button"], a').forEach((n) => {
      if (MORE_RE.test(label(n)) && !found.some((f) => f.node === n)) found.push({ node: n, kind: 'more' });
    });
    return found;
  }

  function expandAll(el) {
    let n = 0;
    collapsedNodes(el).forEach(({ node, kind }) => {
      if (kind === 'details') node.open = true; else node.click();
      n += 1;
    });
    return n;
  }

  function findContinuations(el, opts) {
    const anchor = opts.turn || el;
    const asst = opts.assistantSelector || DEFAULT_ASSISTANT;
    const user = opts.userSelector || DEFAULT_USER;
    const parts = [];
    for (let s = anchor.nextElementSibling; s; s = s.nextElementSibling) {
      if (s.matches(user) || s.querySelector(user)) break;
      if (s.matches(asst) || s.querySelector(asst)) parts.push(s.matches(asst) ? s : s.querySelector(asst));
    }
    return parts;
  }

  // Виртуализация: без layout в jsdom определить нельзя; в браузере — сообщение выходит за видимую область прокрутки.
  // Не проверено вживую; побочных эффектов нет.
  function detectLazy(el, opts) {
    const sc = opts.scroller;
    if (!sc || !sc.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    const v = sc.getBoundingClientRect();
    if (!(r.height || v.height)) return false;
    return r.top < v.top - 1 || r.bottom > v.bottom + 1;
  }

  // ---- блоки хода вне выбранного элемента (диаграмма/виджет рядом с текстовым сегментом) ----
  // Только общие признаки, НЕ ПРОВЕРЕНО ВЖИВУЮ: разметки Claude с диаграммой в репозитории нет.
  const OUTSIDE_LIMIT = 50;
  const COMPOSER_SELECTOR = 'textarea, [contenteditable="true"], form, [data-testid*="composer" i]';
  const ARTIFACT_WORD_RE = /artifact/i;
  const WIDGET_WORD_RE = /diagram|chart|visual|widget|mermaid|canvas/i;
  const MIN_SIDE = 48;

  function resolveTurn(el, opts) {
    if (opts.turn) return opts.turn;
    if (opts.turnSelector) { const t = el.closest(opts.turnSelector); if (t) return t; }
    const asst = opts.assistantSelector || DEFAULT_ASSISTANT;
    const user = opts.userSelector || DEFAULT_USER;
    const count = (n) => n.querySelectorAll(asst).length + (n.matches(asst) ? 1 : 0);
    let cur = el;
    const base = count(el);
    for (let p = el.parentElement; p && p !== el.ownerDocument.body && p !== el.ownerDocument.documentElement; p = p.parentElement) {
      if (p.querySelector(user) || p.matches(user) || p.querySelector(COMPOSER_SELECTOR)) break;
      if (count(p) > Math.max(base, 1)) break;
      cur = p;
    }
    return cur === el ? null : cur;
  }

  function sizeOf(n) {
    let w = 0; let h = 0;
    try { const r = n.getBoundingClientRect(); w = r.width; h = r.height; } catch (_) { /* нет раскладки */ }
    if (!(w && h)) { w = parseFloat(n.getAttribute('width')) || 0; h = parseFloat(n.getAttribute('height')) || 0; }
    if (!(w && h) && n.getAttribute) {
      const vb = String(n.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
      if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) { w = vb[2]; h = vb[3]; }
    }
    return { w, h, known: Boolean(w && h) };
  }
  function bigEnough(n) {
    const s = sizeOf(n);
    if (s.known) return s.w > MIN_SIDE && s.h > MIN_SIDE;
    return n.localName === 'svg' ? Boolean(n.querySelector('text')) || n.querySelectorAll('path, rect, circle, ellipse, line, polyline, polygon').length >= 4 : true;
  }
  function markerText(n) {
    return ['id', 'class', 'aria-label', 'data-testid', 'data-test-id'].map((a) => n.getAttribute(a) || '').join(' ')
      + Array.from(n.attributes).filter((a) => a.name.startsWith('data-')).map((a) => a.name).join(' ');
  }
  function classifyOutside(n) {
    const tag = n.localName;
    if (tag === 'iframe' || tag === 'object' || tag === 'embed') return 'embed';
    if (tag === 'canvas') return 'canvas';
    if (tag === 'video' || tag === 'audio') return 'media';
    if (tag === 'svg') return bigEnough(n) ? 'svg' : null;
    if (tag === 'img') return bigEnough(n) ? 'image' : null;
    if (tag === 'pre') return 'code';
    if (n.shadowRoot) return 'widget';
    if (tag === 'button' || tag === 'a' || tag === 'input' || tag === 'textarea' || tag === 'nav' || tag === 'header' || tag === 'footer') return null;
    const m = markerText(n);
    if (ARTIFACT_WORD_RE.test(m)) return 'artifact';
    if (WIDGET_WORD_RE.test(m)) return 'widget';
    const role = n.getAttribute('role');
    if (role === 'img' || role === 'figure' || role === 'dialog' || tag === 'figure') return 'widget';
    return null;
  }
  function hintOf(n) {
    const parts = [n.localName];
    const id = n.getAttribute('id');
    if (id) parts.push('#' + id.replace(/\d+/g, '0'));
    ['role', 'data-testid', 'data-test-id'].forEach((a) => { if (n.getAttribute(a)) parts.push(`${a}=${n.getAttribute(a)}`); });
    return parts.join(' ').slice(0, 120);
  }

  function findOutsideBlocks(el, turn) {
    const blocks = [];
    let truncated = 0;
    const walk = (node) => {
      for (const child of Array.from(node.children)) {
        if (child === el) continue;
        if (child.contains(el)) { walk(child); continue; }
        const type = classifyOutside(child);
        if (type) {
          if (blocks.length < OUTSIDE_LIMIT) {
            blocks.push({ type, tag: child.localName, hint: hintOf(child), position: blocks.length + 1,
              beforeSelected: Boolean(el.compareDocumentPosition(child) & 2) });
          } else truncated += 1;
          continue; // вложенное внутри найденного блока отдельно не считаем
        }
        if (child.matches(COMPOSER_SELECTOR) || child.matches('button, nav, header, footer, [aria-hidden="true"]:not(:has(svg))')) {
          // кнопки и обёртки: только svg-диаграммы внутри кнопок/aria-hidden
          if (!child.querySelector('svg')) continue;
        }
        walk(child);
      }
    };
    walk(turn);
    return { blocks, truncated };
  }

  // Артефакты и встроенные блоки. Селекторы по общим признакам, НЕ ПРОВЕРЕНО ВЖИВУЮ (реального образца Claude с артефактом/диаграммой нет).
  const ARTIFACT_REF_SELECTOR = '[data-testid*="artifact" i], [aria-label*="artifact" i], [class*="artifact" i]';
  const ARTIFACT_PANEL_SELECTOR = '[data-artifact], [data-canvas], [data-testid*="artifact" i], [role="dialog"][aria-label*="artifact" i], [role="complementary"][aria-label*="artifact" i], [role="dialog"][aria-label*="canvas" i]';
  const EMBED_SELECTOR = 'iframe, object, embed';

  function detectArtifacts(el, opts) {
    const doc = opts.document || el.ownerDocument;
    const refs = Array.from(el.querySelectorAll(ARTIFACT_REF_SELECTOR));
    const panels = doc ? Array.from(doc.querySelectorAll(ARTIFACT_PANEL_SELECTOR)).filter((p) => !el.contains(p) && !p.contains(el)) : [];
    return { refs: refs.length, panels };
  }

  /**
   * collect(messageEl, options) -> context для AnswerMarkdown.convert({ context }).
   * options: { turn?, isLatest?, document?, scroller?, assistantSelector?, userSelector?, expand? (по умолчанию false) }
   * Результат: { version, regenerated, generating, truncated, collapsed, continuationParts, lazy, artifactRefs, artifactPanels, embeds, outsideBlocks[], outsideBlocksTruncated, notes[] };
   * outsideBlocks: [{type:'embed'|'svg'|'image'|'canvas'|'media'|'widget'|'artifact'|'code', tag, hint, position, beforeSelected}] — нетекстовые блоки хода вне messageEl.
   * options.turn / options.turnSelector задают контейнер хода; иначе — ближайший предок без пользовательского сообщения и композера.
   * непубличные (не сериализуются): .parts — элементы продолжений, .artifactPanelEls — панели артефактов вне сообщения, .versionInfo.
   */
  function collect(messageEl, options) {
    const opts = options || {};
    const ctx = { version: null, regenerated: false, generating: false, truncated: false, collapsed: 0, continuationParts: 0, lazy: false, artifactRefs: 0, artifactPanels: 0, embeds: 0, outsideBlocks: [], outsideBlocksTruncated: 0, notes: [] };
    if (!messageEl || !messageEl.querySelector) {
      ctx.notes.push('элемент ответа не передан');
      return ctx;
    }
    ctx.generating = detectGenerating(messageEl, opts);
    ctx.truncated = detectTruncated(messageEl, opts);
    const v = detectVersion(messageEl, opts);
    if (v) { ctx.version = v.version; ctx.regenerated = true; }
    else if (scopes(messageEl, opts).some((s) => s.querySelector(REGENERATE_SELECTOR)) && opts.regeneratedHint === true) ctx.regenerated = true;

    let nodes = collapsedNodes(messageEl);
    if (opts.expand === true && nodes.length) {
      expandAll(messageEl);
      ctx.notes.push(`раскрыто свёрнутых блоков: ${nodes.length}`);
      nodes = collapsedNodes(messageEl).filter((f) => f.kind !== 'details');
    }
    ctx.collapsed = nodes.length;
    if (ctx.collapsed) ctx.notes.push(`нераскрытых блоков: ${ctx.collapsed}`);

    const parts = findContinuations(messageEl, opts);
    ctx.continuationParts = parts.length;
    Object.defineProperty(ctx, 'parts', { value: parts, enumerable: false });
    Object.defineProperty(ctx, 'versionInfo', { value: v, enumerable: false });

    const turn = resolveTurn(messageEl, opts);
    ctx.outsideBlocks = [];
    ctx.outsideBlocksTruncated = 0;
    if (!turn) ctx.notes.push('контейнер хода не определён');
    else {
      const o = findOutsideBlocks(messageEl, turn);
      ctx.outsideBlocks = o.blocks;
      ctx.outsideBlocksTruncated = o.truncated;
      if (o.blocks.length) ctx.notes.push(`вне выбранного элемента в ходе нетекстовых блоков: ${o.blocks.length + o.truncated}`);
      Object.defineProperty(ctx, 'turnEl', { value: turn, enumerable: false });
    }
    const art = detectArtifacts(messageEl, opts);
    ctx.artifactRefs = art.refs;
    ctx.artifactPanels = art.panels.length;
    ctx.embeds = messageEl.querySelectorAll(EMBED_SELECTOR).length;
    Object.defineProperty(ctx, 'artifactPanelEls', { value: art.panels, enumerable: false });
    if (art.refs && !art.panels.length) ctx.notes.push('в сообщении есть артефакт, панель не найдена: содержимое не прочитано');
    if (ctx.embeds) ctx.notes.push(`встроенных блоков (iframe/object/embed): ${ctx.embeds}`);

    ctx.lazy = detectLazy(messageEl, opts);
    if (ctx.lazy) ctx.notes.push('ответ частично вне видимой области списка (виртуализация); полнота не гарантирована');
    if (ctx.generating) ctx.notes.push('генерация идёт');
    if (ctx.truncated) ctx.notes.push('ответ оборван («Continue generating»)');
    return ctx;
  }

  return { collect, STREAMING_SELECTOR, STOP_SELECTOR, REGENERATE_SELECTOR, CONTINUE_RE, VERSION_RE, MORE_RE };
});
