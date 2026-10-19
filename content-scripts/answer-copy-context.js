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

  /**
   * collect(messageEl, options) -> context для AnswerMarkdown.convert({ context }).
   * options: { turn?, isLatest?, document?, scroller?, assistantSelector?, userSelector?, expand? (по умолчанию false) }
   * Результат: { version, regenerated, generating, truncated, collapsed, continuationParts, lazy, notes[] };
   * непубличные (не сериализуются): .parts — элементы продолжений, .versionInfo.
   */
  function collect(messageEl, options) {
    const opts = options || {};
    const ctx = { version: null, regenerated: false, generating: false, truncated: false, collapsed: 0, continuationParts: 0, lazy: false, notes: [] };
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

    ctx.lazy = detectLazy(messageEl, opts);
    if (ctx.lazy) ctx.notes.push('ответ частично вне видимой области списка (виртуализация); полнота не гарантирована');
    if (ctx.generating) ctx.notes.push('генерация идёт');
    if (ctx.truncated) ctx.notes.push('ответ оборван («Continue generating»)');
    return ctx;
  }

  return { collect, STREAMING_SELECTOR, STOP_SELECTOR, REGENERATE_SELECTOR, CONTINUE_RE, VERSION_RE, MORE_RE };
});
