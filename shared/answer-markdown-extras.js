// WP3: обработчики блоков AnswerMarkdown.registerBlock — артефакты/Canvas, источники, файлы, вывод code interpreter.
// Спецификация: docs/Architecture/answer-markdown-spec.md (разделы 7, 8, 10).
// Селекторы, помеченные UNVERIFIED, не подтверждены живым DOM (в репозитории их нет): это запросы на живой захват.
(function initAnswerMarkdownExtras(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AnswerMarkdownExtras = api;
  if (root.AnswerMarkdown && typeof root.AnswerMarkdown.registerBlock === 'function') api.register(root.AnswerMarkdown);
})(typeof self !== 'undefined' ? self : this, function factory() {
  'use strict';

  const SELECTORS = {
    // UNVERIFIED: Claude Artifacts / ChatGPT Canvas / Gemini Canvas — атрибуты предположительные.
    artifact: '[data-artifact], [data-artifact-id], [data-canvas], [data-testid="canvas"], [data-testid^="artifact"]',
    artifactContent: '[data-artifact-content], pre, [data-canvas-content]',
    artifactVersion: '[data-artifact-version]',
    // ПОДТВЕРЖДЕНО скелетом chatgpt.json: чип цитаты. Остальные — UNVERIFIED.
    citation: '[data-testid="webpage-citation-pill"], sup[data-citation], a[data-citation], [data-source-chip]',
    sourceList: '[data-source-list], [data-testid="sources"], [data-testid="source-list"]',
    searchCard: '[data-search-result], [data-testid="search-result"]',
    file: 'a[download], [data-file-name], [data-testid="file-attachment"]',
    output: '[data-code-interpreter], [data-testid="code-interpreter"], [data-code-output]',
    // Встроенные блоки: iframe/object/embed. Живой Claude с диаграммой не снят — не проверено вживую.
    embed: 'iframe, object, embed'
  };
  // Для census у WP1/WP5: селекторы тех же элементов, что поглощают обработчики.
  const CENSUS_SELECTORS = {
    artifact: SELECTORS.artifact,
    source: [SELECTORS.citation, SELECTORS.sourceList, SELECTORS.searchCard].join(', '),
    file: SELECTORS.file,
    output: SELECTORS.output,
    embed: SELECTORS.embed
  };

  const citationState = new WeakMap(); // report -> { byUrl: Map(url -> номер сноски) }

  function attr(el, ...names) {
    for (const n of names) {
      const v = el.getAttribute && el.getAttribute(n);
      if (v && v.trim()) return v.trim();
    }
    return '';
  }
  function txt(el, ctx) { return String((ctx && ctx.text ? ctx.text(el) : el.textContent) || '').trim(); }
  function oneLine(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function mdText(s) { return oneLine(s).replace(/([\[\]])/g, '\\$1'); }
  function guard(type, fn) {
    return function render(el, ctx) {
      try { return fn(el, ctx); } catch (e) {
        return { markdown: ctx.placeholder(type, 'исключение: ' + oneLine(e && e.message).slice(0, 60), el), copied: 0 };
      }
    };
  }

  // ---------- артефакты ----------
  function pickArtifactVersion(el) {
    const versions = Array.from(el.querySelectorAll(SELECTORS.artifactVersion));
    if (!versions.length) {
      const v = attr(el, 'data-artifact-version', 'data-version');
      const total = attr(el, 'data-artifact-versions', 'data-version-count');
      return { node: el, label: v ? (total ? `${v} из ${total}` : v) : '' };
    }
    const cur = versions.find((n) => n.getAttribute('aria-current') === 'true' || n.hasAttribute('data-current')
      || n.getAttribute('data-active') === 'true') || versions[versions.length - 1];
    const idx = versions.indexOf(cur) + 1;
    return { node: cur, label: `${idx} из ${versions.length}, актуальная` };
  }

  const artifactHandler = {
    name: 'extras-artifact', type: 'artifact', priority: 200, censusSelector: SELECTORS.artifact,
    match: (el) => el.matches && el.matches(SELECTORS.artifact),
    render: guard('artifact', (el, ctx) => {
      const title = attr(el, 'data-artifact-title', 'data-title', 'aria-label', 'title') || oneLine((el.querySelector('h1,h2,h3,[data-artifact-title]') || {}).textContent) || 'без названия';
      const kind = attr(el, 'data-artifact-type', 'data-type', 'data-language') || 'unknown';
      const ver = pickArtifactVersion(el);
      const marker = `Артефакт: ${oneLine(title)}, ${kind}${ver.label ? `, версия ${ver.label}` : ''}`;
      const holder = ver.node || el;
      const body = holder.matches(SELECTORS.artifactContent) ? holder : holder.querySelector(SELECTORS.artifactContent);
      if (!body || !txt(body, ctx)) {
        return { markdown: `${marker}\n\n${ctx.placeholder('artifact', 'содержимое панели недоступно (карточка без открытой панели)', el)}`, copied: 0 };
      }
      const isDoc = /^(document|markdown|text|doc)$/i.test(kind);
      const content = isDoc ? ctx.convertChildren(body).trim() : ctx.fence(ctx.text(body.querySelector('code') || body).replace(/\n$/, ''), kind.replace(/^application\/vnd\.ant\./, '').replace(/^text\//, ''));
      return { markdown: `${marker}\n\n${content}`, copied: 1 };
    })
  };

  // ---------- источники ----------
  function linkOf(el) { return el.tagName === 'A' ? el : el.querySelector('a[href]') || el.querySelector('a'); }

  const citationHandler = {
    name: 'extras-citation', type: 'source', priority: 200, censusSelector: SELECTORS.citation,
    match: (el) => el.matches && el.matches(SELECTORS.citation),
    render: guard('source', (el, ctx) => {
      const a = linkOf(el);
      const href = a && a.getAttribute('href');
      const label = oneLine(el.textContent) || attr(el, 'data-title', 'aria-label');
      if (!href) return { markdown: ctx.placeholder('source', `URL источника «${label.slice(0, 30)}» недоступен`, el), copied: 0 };
      const numeric = /^\[?\d+\]?$/.test(label);
      const title = numeric ? '' : label;
      // GFM-сноска: [^n] в тексте + определение в конце через ctx.addFooter (контракт запрошен у WP1).
      // Без addFooter — встроенная ссылка [текст](URL): связь утверждения с источником не теряется.
      if (typeof ctx.addFooter !== 'function') {
        return { markdown: `[${mdText(title || label || 'источник')}](${href})`, copied: 1 };
      }
      const st = citationState.get(ctx.report) || { byUrl: new Map() };
      citationState.set(ctx.report, st);
      if (!st.byUrl.has(href)) {
        const n = st.byUrl.size + 1;
        st.byUrl.set(href, n);
        ctx.addFooter(`[^${n}]: ${title ? `${mdText(title)} — ` : ''}${href}`);
      }
      return { markdown: `[^${st.byUrl.get(href)}]`, copied: 1 };
    })
  };

  function describeSource(item) {
    const a = linkOf(item);
    const href = a && a.getAttribute('href');
    const title = oneLine((item.querySelector('[data-title], h3, h4, strong') || a || item).textContent);
    const snippet = oneLine((item.querySelector('[data-snippet], p') || {}).textContent);
    return { href, title, snippet };
  }

  const sourceListHandler = {
    name: 'extras-source-list', type: 'source', priority: 190, censusSelector: `${SELECTORS.sourceList}, ${SELECTORS.searchCard}`,
    match: (el) => el.matches && (el.matches(SELECTORS.sourceList) || el.matches(SELECTORS.searchCard)),
    render: guard('source', (el, ctx) => {
      const isCard = el.matches(SELECTORS.searchCard);
      const items = isCard ? [el] : Array.from(el.children).filter((c) => oneLine(c.textContent));
      if (!items.length) return { markdown: ctx.placeholder('source', 'список источников пуст', el), copied: 0 };
      const lines = [];
      let missing = 0;
      items.forEach((item, i) => {
        const s = describeSource(item);
        if (!s.href) { missing += 1; lines.push(`${i + 1}. ${mdText(s.title) || 'без названия'}`); return; }
        lines.push(`${i + 1}. [${mdText(s.title || s.href)}](${s.href})${s.snippet && s.snippet !== s.title ? ` — ${s.snippet}` : ''}`);
      });
      // один список/карточка = один блок для счёта: при потерях URL — одна заглушка, copied=0
      if (missing) lines.push(ctx.placeholder('source', `у ${missing} из ${items.length} источников нет URL`, el));
      return { markdown: (isCard ? '' : 'Источники:\n\n') + lines.join('\n'), copied: missing ? 0 : 1 };
    })
  };

  // ---------- файлы ----------
  const fileHandler = {
    name: 'extras-file', type: 'file', priority: 200, censusSelector: SELECTORS.file,
    match: (el) => el.matches && el.matches(SELECTORS.file),
    render: guard('file', (el, ctx) => {
      const a = el.tagName === 'A' ? el : el.querySelector('a[href]');
      const href = a && a.getAttribute('href');
      const name = attr(el, 'download', 'data-file-name') || (a && attr(a, 'download')) || oneLine(el.textContent) || 'файл';
      const type = attr(el, 'data-file-type', 'type') || (a && attr(a, 'type')) || ((/\.([a-z0-9]{1,6})$/i.exec(name) || [])[1] || 'unknown');
      if (!href) return { markdown: ctx.placeholder('file', `URL файла «${name.slice(0, 30)}» недоступен`, el), copied: 0 };
      const hasExt = /\.[a-z0-9]{1,6}$/i.test(name);
      return { markdown: `[${mdText(hasExt || type === 'unknown' ? name : `${name} (${type})`)}](${href})`, copied: 1 };
    })
  };

  // ---------- Perplexity: карточка файла-артефакта ----------
  // Подтверждено живой страницей 2026-11-08: у карточки нет href (кнопка aria-label + иконка #pplx-icon-file-type-*),
  // файл открывается панелью просмотра по адресу сессии ?preview=1. Без этого обработчика остаётся голый текст.
  function pplxFileIcon(el) {
    for (const u of Array.from(el.querySelectorAll('use'))) {
      const h = u.getAttribute('xlink:href') || u.getAttribute('href') || '';
      if (h.startsWith('#pplx-icon-file-type-')) return h;
    }
    return '';
  }
  const pplxFileHandler = {
    name: 'extras-perplexity-file', type: 'file', priority: 200,
    censusMatch: (el) => pplxFileHandler.match(el),
    match: (el) => el.tagName === 'DIV' && Boolean(pplxFileIcon(el)) && Array.from(el.children).some((c) => c.tagName === 'BUTTON' && c.getAttribute('aria-label')),
    render: guard('file', (el) => {
      const btn = Array.from(el.children).find((c) => c.tagName === 'BUTTON' && c.getAttribute('aria-label'));
      const base = (btn.getAttribute('aria-label') || '').trim();
      const ext = (pplxFileIcon(el).split('file-type-')[1] || '').toLowerCase();
      const name = base && ext && !new RegExp(`\\.${ext}$`, 'i').test(base) ? `${base}.${ext}` : (base || 'файл');
      const loc = el.ownerDocument.location;
      return { markdown: `[${mdText(name)}](${loc.origin}${loc.pathname}?preview=1)`, copied: 1 };
    })
  };

  // ---------- code interpreter ----------
  const outputHandler = {
    name: 'extras-output', type: 'output', priority: 200, censusSelector: SELECTORS.output,
    match: (el) => el.matches && el.matches(SELECTORS.output),
    render: guard('output', (el, ctx) => {
      const parts = [];
      const lang = attr(el, 'data-language') || 'python';
      el.querySelectorAll('pre, table, img, a[download], a[href][data-file-name]').forEach((n) => {
        if (n.tagName !== 'PRE' && n.closest('pre')) return;
        if (n.tagName !== 'TABLE' && n.closest('table')) return;
        if (n.tagName === 'PRE') {
          const out = n.closest('[data-role="output"], [data-output], [data-code-output]');
          const text = ctx.text(n.querySelector('code') || n).replace(/\n$/, '');
          parts.push(out ? `Вывод:\n\n${ctx.fence(text, '')}` : `Код:\n\n${ctx.fence(text, lang)}`);
        } else if (n.tagName === 'TABLE') {
          const w = n.ownerDocument.createElement('div'); // convertChildren обходит потомков, поэтому таблица кладётся в обёртку
          w.appendChild(n.cloneNode(true));
          parts.push(ctx.convertChildren(w).trim()); // pipe-таблица GFM средствами движка
        } else if (n.tagName === 'IMG') {
          const src = n.getAttribute('src');
          parts.push(src ? `![${mdText(n.getAttribute('alt') || 'график')}](${src})` : ctx.placeholder('image', 'график без src', n));
        } else {
          const f = fileHandler.render(n, ctx);
          if (f) parts.push(f.markdown);
        }
      });
      if (!parts.length) return { markdown: ctx.placeholder('output', 'вывод code interpreter не найден', el), copied: 0 };
      return { markdown: parts.join('\n\n'), copied: 1 };
    })
  };

  // ---------- встроенные блоки: iframe / object / embed ----------
  // Содержимое читается, только если оно доступно: srcdoc, same-origin contentDocument. Иначе — заглушка, не пропуск.
  function embedDocument(el) {
    const srcdoc = el.getAttribute('srcdoc');
    if (srcdoc) { try { return new DOMParser().parseFromString(srcdoc, 'text/html'); } catch (_) { return null; } }
    try { return el.contentDocument || null; } catch (_) { return null; } // cross-origin бросает/даёт null
  }
  function hostOf(url) { try { return new URL(url, 'http://x').host; } catch (_) { return ''; } }

  const embedHandler = {
    name: 'extras-embed', type: 'artifact', priority: 200, censusSelector: SELECTORS.embed, claimsUi: true,
    match: (el) => el.matches && el.matches(SELECTORS.embed),
    render: guard('artifact', (el, ctx) => {
      const tag = el.tagName.toLowerCase();
      const title = oneLine(attr(el, 'title', 'aria-label', 'name')) || 'без названия';
      const src = attr(el, 'src', 'data');
      const marker = `Встроенный блок: ${tag}, ${title}`;
      const doc = embedDocument(el);
      const body = doc && doc.documentElement;
      if (!body || !oneLine(body.textContent) && !body.querySelector('svg, canvas, img')) {
        const why = `${tag} не прочитан (${src ? `cross-origin или нет доступа, src=${hostOf(src) || 'неизвестен'}` : 'нет src/srcdoc'})`;
        return { markdown: `${marker}\n\n${ctx.placeholder('artifact', why, el)}`, copied: 0 };
      }
      const svgs = Array.from(body.querySelectorAll('svg'));
      if (svgs.length === 1 && !oneLine((body.querySelector('body') || body).textContent.replace(svgs[0].textContent, ''))) {
        let out = svgs[0].outerHTML;
        if (!/^<svg\b[^>]*\sxmlns=/i.test(out)) out = out.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
        return { markdown: `${marker}\n\n${ctx.fence(out, 'svg')}`, copied: 1 };
      }
      return { markdown: `${marker}\n\n${ctx.fence(body.outerHTML, 'html')}`, copied: 1 };
    })
  };

  // ---------- svg-диаграмма в обёртке button/role=button/aria-hidden ----------
  // Движок и content-utils считают такие обёртки интерфейсом и вырезают. Эвристика (не проверено вживую):
  // контентная картинка — не иконка: >=4 фигур или <text> или viewBox от 100x100.
  function isContentSvg(svg) {
    if (svg.querySelector('text')) return true;
    if (svg.querySelectorAll('path, rect, circle, ellipse, line, polyline, polygon').length >= 4) return true;
    const vb = String(svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    return vb.length === 4 && vb[2] >= 100 && vb[3] >= 100;
  }
  const wrappedSvgHandler = {
    name: 'extras-wrapped-svg', type: 'svg', priority: 200, claimsUi: true, // claimsUi: match() должен вызываться ДО проверки isUiNode (запрос к WP1)
    match: (el) => el.matches && el.matches('button, [role="button"], [aria-hidden="true"]')
      && Array.from(el.querySelectorAll('svg')).some(isContentSvg),
    render: guard('svg', (el, ctx) => {
      const svg = Array.from(el.querySelectorAll('svg')).find(isContentSvg);
      let out = svg.outerHTML;
      if (!/^<svg\b[^>]*\sxmlns=/i.test(out)) out = out.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
      return { markdown: ctx.fence(out, 'svg'), copied: 1 };
    })
  };

  const handlers = [artifactHandler, embedHandler, wrappedSvgHandler, citationHandler, sourceListHandler, fileHandler, pplxFileHandler, outputHandler];

  function register(engine) {
    handlers.forEach((h) => engine.registerBlock(h));
    return handlers.length;
  }

  return { SELECTORS, CENSUS_SELECTORS, handlers, register, isContentSvg };
});
