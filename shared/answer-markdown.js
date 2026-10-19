// shared/answer-markdown.js
// DOM -> canonical Markdown for LLM answers, with a completeness report.
// Contract: docs/Architecture/answer-markdown-spec.md (section 4.1).
// Only DOM APIs are used (no browser globals), so the module runs as a content script and under jsdom.
//
// Silent loss is not allowed: every block the census finds in the DOM is either copied
// or replaced by a placeholder made through ctx.placeholder (see report.mismatches).

(function initAnswerMarkdown(root) {
  'use strict';

  const REPORT_VERSION = 1;
  const PLACEHOLDER_RE = /\[НЕ СКОПИРОВАНО: тип=([^,\]]+), причина=([^\]]*?), позиция=(\d+)\]/;

  const KNOWN_TYPES = ['heading', 'list', 'quote', 'hr', 'code', 'table', 'math', 'diagram', 'svg',
    'image', 'link', 'artifact', 'source', 'file', 'output'];
  const DIAGRAM_LANGS = new Set(['mermaid', 'plantuml', 'puml', 'dot', 'graphviz', 'd2']);

  // context.outsideBlocks[].type -> report type
  const DIAGRAM_HINT_RE = /диаграм|diagram|chart|график|svg|mermaid|схем/i;
  const OUTSIDE_TYPES = {
    embed: (b) => (DIAGRAM_HINT_RE.test(String(b.hint || '')) ? 'diagram' : 'artifact'),
    widget: (b) => (DIAGRAM_HINT_RE.test(String(b.hint || '')) ? 'diagram' : 'artifact'),
    artifact: (b) => (DIAGRAM_HINT_RE.test(String(b.hint || '')) ? 'diagram' : 'artifact'),
    svg: () => 'svg',
    image: () => 'image',
    canvas: () => 'diagram',
    media: () => 'file',
    code: () => 'code'
  };

  const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'head', 'link', 'meta', 'button',
    'select', 'option', 'textarea', 'iframe', 'object', 'embed']);
  const BLOCK_TAGS = new Set(['address', 'article', 'aside', 'blockquote', 'body', 'dd', 'details', 'dialog',
    'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5',
    'h6', 'header', 'hr', 'html', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table',
    'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul']);
  const BLOCK_SELECTOR = Array.from(BLOCK_TAGS).join(',');
  const MATH_SELECTOR = '.katex, .katex-display, mjx-container, math, .MathJax, .MathJax_Display, [data-math]';
  const DIAGRAM_SELECTOR = '.mermaid, [data-mermaid]';
  const COPY_LABEL_RE = /^\s*(copy|copied|скопировать|скопировано)\b/i;
  const LINE_NUMBER_RE = /(^|[\s_-])(line-?numbers?|linenumber|gutter|hljs-ln-numbers|hljs-ln-n)([\s_-]|$)/i;

  // Private-use sentinels: protect already-rendered fragments / hard breaks from whitespace collapsing.
  const TOK_OPEN = '';
  const TOK_CLOSE = '';
  const BR = '';
  const TOKEN_RE = /(\d+)/g;

  // ---------------------------------------------------------------- registries

  const blockHandlers = [];
  const providers = new Map();
  let registrationOrder = 0;

  function registerBlock(handler, internal) {
    if (!handler || typeof handler.name !== 'string' || !handler.name
      || typeof handler.match !== 'function' || typeof handler.render !== 'function') {
      throw new TypeError('registerBlock: handler needs name, match() and render()');
    }
    const entry = {
      name: handler.name,
      type: handler.type || 'code',
      priority: Number.isFinite(handler.priority) ? handler.priority : 0,
      match: handler.match,
      render: handler.render,
      censusSelector: typeof handler.censusSelector === 'string' ? handler.censusSelector : '',
      claimsUi: handler.claimsUi === true,
      isDefault: Boolean(internal),
      order: registrationOrder++
    };
    const existing = blockHandlers.findIndex((h) => h.name === entry.name);
    if (existing >= 0) blockHandlers.splice(existing, 1);
    blockHandlers.push(entry);
    blockHandlers.sort((a, b) => (b.priority - a.priority) || (Number(a.isDefault) - Number(b.isDefault))
      || (a.order - b.order));
    return function unregister() {
      const i = blockHandlers.indexOf(entry);
      if (i >= 0) blockHandlers.splice(i, 1);
    };
  }

  function registerProvider(name, rules) {
    if (typeof name !== 'string' || !name) throw new TypeError('registerProvider: name required');
    providers.set(name, rules && typeof rules === 'object' ? rules : {});
  }

  function rulesFor(options) {
    const name = options && options.provider;
    return (name && providers.get(name)) || {};
  }

  // ---------------------------------------------------------------- DOM helpers

  function tagOf(node) {
    return node && node.nodeType === 1 ? String(node.localName || node.nodeName).toLowerCase() : '';
  }

  // style/script/noscript/template carry no visible text in any namespace (svg:style, svg:script too).
  const SILENT_TAGS = new Set(['style', 'script', 'noscript', 'template']);

  // textContent without the text of SILENT_TAGS descendants; otherwise exact (nothing is normalized).
  function cleanText(node) {
    if (node.nodeType === 3) return node.data;
    if (node.nodeType !== 1 && node.nodeType !== 11) return '';
    if (node.nodeType === 1 && SILENT_TAGS.has(tagOf(node))) return '';
    let out = '';
    for (const c of (node.nodeType === 1 ? childrenOf(node) : Array.from(node.childNodes))) out += cleanText(c);
    return out;
  }

  function childrenOf(node) {
    if (node.nodeType === 1) {
      if (node.shadowRoot) return Array.from(node.shadowRoot.childNodes);
      if (tagOf(node) === 'slot' && typeof node.assignedNodes === 'function') {
        const assigned = node.assignedNodes({ flatten: true });
        if (assigned && assigned.length) return Array.from(assigned);
      }
    }
    return Array.from(node.childNodes);
  }

  function safe(fn, fallback) {
    try { return fn(); } catch (_) { return fallback; }
  }

  function inlineStyle(el, prop) {
    return safe(() => (el.style && el.style[prop]) || '', '');
  }

  // Minimal ctx for claimsUi handlers' match() when called outside a conversion (census, UI filter).
  const LIGHT_CTX = Object.freeze({
    provider: null, options: {}, position: 0, report: null,
    convertChildren: () => '', fence, placeholder: () => '', text: (el) => cleanText(el)
  });

  // A handler with claimsUi:true that matches the element takes it out of the "interface" class:
  // it is counted by the census and reaches the handler even if it is an iframe/role=button/aria-hidden node.
  function isClaimed(el) {
    for (const h of blockHandlers) {
      if (h.claimsUi && safe(() => h.match(el, LIGHT_CTX), false)) return true;
    }
    return false;
  }

  function isUiNode(el, rules) {
    if (isClaimed(el)) return false;
    const tag = tagOf(el);
    if (SKIP_TAGS.has(tag)) return true;
    if (tag === 'input') return el.getAttribute('type') !== 'checkbox';
    if (el.hasAttribute('hidden') || el.hasAttribute('inert')) return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    if (el.getAttribute('role') === 'button') return true;
    if (COPY_LABEL_RE.test(el.getAttribute('aria-label') || '')) return true;
    if (inlineStyle(el, 'display') === 'none' || inlineStyle(el, 'visibility') === 'hidden') return true;
    if (rules && typeof rules.isUiNode === 'function' && safe(() => rules.isUiNode(el), false)) return true;
    return false;
  }

  function hasBlockDescendant(el) {
    if (el.shadowRoot) return true;
    return safe(() => Boolean(el.querySelector(BLOCK_SELECTOR)), false);
  }

  function isBlockish(el) {
    const tag = tagOf(el);
    if (BLOCK_TAGS.has(tag)) return true;
    if (tag === 'a' || tag === 'br' || tag === 'img') return false;
    return hasBlockDescendant(el);
  }

  function isLinkEl(el) {
    if (tagOf(el) !== 'a') return false;
    const href = (el.getAttribute('href') || '').trim();
    return Boolean(href) && !/^javascript:/i.test(href);
  }

  function langOf(el) {
    const probe = (node) => {
      if (!node || node.nodeType !== 1) return '';
      const data = node.getAttribute('data-language') || node.getAttribute('data-lang')
        || node.getAttribute('data-code-language') || '';
      if (data.trim()) return data.trim();
      const cls = node.getAttribute('class') || '';
      const m = /(?:^|\s)(?:language|lang|highlight-source)-([\w+#.-]+)/i.exec(cls);
      return m ? m[1] : '';
    };
    let lang = probe(el);
    if (!lang) {
      const code = safe(() => el.querySelector('code'), null);
      lang = probe(code);
    }
    if (!lang) lang = probe(el.parentElement);
    return lang.toLowerCase().replace(/[^\w+#.-]/g, '');
  }

  // ---------------------------------------------------------------- census

  // Built-in type of an element (null if it is not a countable block). `absorbs` = census does not descend.
  function builtinType(el, rules) {
    const tag = tagOf(el);
    if (tag === 'pre') return DIAGRAM_LANGS.has(langOf(el)) ? 'diagram' : 'code';
    if (rules && typeof rules.codeBlock === 'function') {
      const cb = safe(() => rules.codeBlock(el), null);
      if (cb && typeof cb.text === 'string') return DIAGRAM_LANGS.has(String(cb.lang || '').toLowerCase()) ? 'diagram' : 'code';
    }
    if (safe(() => el.matches(MATH_SELECTOR), false)) return 'math';
    if (safe(() => el.matches(DIAGRAM_SELECTOR), false)) return 'diagram';
    if (tag === 'svg') return 'svg';
    if (tag === 'img' || tag === 'canvas') return 'image';
    return null;
  }

  function censusType(el, rules) {
    for (const h of blockHandlers) {
      if (h.censusSelector && safe(() => el.matches(h.censusSelector), false)) return { type: h.type, absorbs: true };
    }
    const b = builtinType(el, rules);
    if (b) return { type: b, absorbs: b !== 'image' };
    switch (tagOf(el)) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return { type: 'heading', absorbs: false };
      case 'ul': case 'ol': return { type: 'list', absorbs: false };
      case 'blockquote': return { type: 'quote', absorbs: false };
      case 'hr': return { type: 'hr', absorbs: false };
      case 'table': return { type: 'table', absorbs: false };
      case 'a': return isLinkEl(el) ? { type: 'link', absorbs: false } : null;
      default: return null;
    }
  }

  function censusInto(node, rules, counts, includeSelf) {
    if (node.nodeType !== 1) return;
    if (isUiNode(node, rules)) return;
    let absorbs = false;
    if (includeSelf) {
      const t = censusType(node, rules);
      if (t) {
        counts[t.type] = (counts[t.type] || 0) + 1;
        absorbs = t.absorbs;
      }
    }
    if (absorbs) return;
    for (const child of childrenOf(node)) censusInto(child, rules, counts, true);
  }

  function resolveRoot(element, rules) {
    return (rules && typeof rules.answerRoot === 'function' && safe(() => rules.answerRoot(element), null)) || element;
  }

  function census(element, options) {
    const counts = {};
    if (!element || element.nodeType !== 1) return counts;
    const rules = rulesFor(options);
    censusInto(resolveRoot(element, rules), rules, counts, true);
    return counts;
  }

  // ---------------------------------------------------------------- text normalization (spec 4.1, section 11)

  const SPECIAL_SPACES_RE = /[   -   ]/g;
  const PICTO_RE = /[\p{Extended_Pictographic}️\u{1F3FB}-\u{1F3FF}]/u;
  const JOINER_SCRIPT_RE = /[؀-ۿݐ-ݿऀ-෿]/;

  // Plain text: NBSP/narrow spaces -> space; zero-width removed except ZWJ inside emoji sequences and
  // ZWNJ inside Arabic-script/Indic words; whitespace runs collapse. Code, diagrams and <pre> never come here.
  function normalizeText(s) {
    let out = s.replace(SPECIAL_SPACES_RE, ' ').replace(/[​⁠﻿­-]/g, '');
    if (/[‌‍]/.test(out)) {
      const chars = Array.from(out);
      out = chars.filter((ch, i) => {
        if (ch === '‍') return PICTO_RE.test(chars[i - 1] || '') || PICTO_RE.test(chars[i + 1] || '');
        if (ch === '‌') return JOINER_SCRIPT_RE.test(chars[i - 1] || '') && JOINER_SCRIPT_RE.test(chars[i + 1] || '');
        return true;
      }).join('');
    }
    return out.replace(/[ \t\n\r\f\v]+/g, ' ');
  }

  // Escape only what would change meaning; each character is visited once, so nothing is escaped twice.
  function escapeText(s) {
    const isSp = (c) => c === '' || /\s/.test(c);
    const isWord = (c) => c !== '' && /[\p{L}\p{N}]/u.test(c);
    let out = s.replace(/\\(?=[!-/:-@[-`{-~])|`|\*|_|~~|<(?=[A-Za-z/!?])|&(?=#?\w+;)/g, (m, offset) => {
      const prev = s[offset - 1] || '';
      const next = s[offset + m.length] || '';
      switch (m) {
        case '*': return (prev && next && isSp(prev) && isSp(next)) ? m : '\\*';
        case '_':
          if (isWord(prev) && isWord(next)) return m;
          return (prev && next && isSp(prev) && isSp(next)) ? m : '\\_';
        case '~~': return '\\~\\~';
        default: return '\\' + m;
      }
    });
    out = out.replace(/\[([^[\]\n]*)\]\(/g, '\\[$1\\](');
    return out;
  }

  function escapeLineStarts(s) {
    return s
      .replace(/(^|)(#{1,6})(?=\s|$)/g, '$1\\$2')
      .replace(/(^|)>/g, '$1\\>')
      .replace(/(^|)([-+*])(?=\s)/g, '$1\\$2')
      .replace(/(^|)(\d+)([.)])(?=\s)/g, '$1$2\\$3')
      .replace(/(^|)(?=(?:-{3,}|={3,}|_{3,}|\*{3,})(?:|$))/g, '$1\\');
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fence(text, lang) {
    const runs = String(text).match(/`+/g) || [];
    const longest = runs.reduce((m, r) => Math.max(m, r.length), 0);
    const f = '`'.repeat(Math.max(3, longest + 1));
    const info = String(lang || '').replace(/[^\w+#.-]/g, '');
    return text === '' ? `${f}${info}\n${f}` : `${f}${info}\n${text}\n${f}`;
  }

  function codeSpan(text) {
    const flat = String(text).replace(/\r?\n/g, ' ');
    const runs = flat.match(/`+/g) || [];
    const longest = runs.reduce((m, r) => Math.max(m, r.length), 0);
    const d = '`'.repeat(longest + 1);
    const pad = /^`|`$/.test(flat) || (/^ .* $/.test(flat) && flat.trim() !== '') ? ' ' : '';
    return `${d}${pad}${flat}${pad}${d}`;
  }

  function linkUrl(href) {
    return href.trim().replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
  }

  // ---------------------------------------------------------------- conversion state

  function createState(rules, options, found) {
    return {
      rules,
      options: options || {},
      found,
      copied: {},
      placeholders: [],   // { type, reason, position, countType }
      tokens: [],
      footers: [],
      pos: 0,
      cell: 0,
      depth: 0
    };
  }

  function addCopied(st, type, n) {
    if (!n) return;
    st.copied[type] = (st.copied[type] || 0) + n;
  }

  function addPlaceholder(st, type, reason, position, countType) {
    const t = String(type || 'блок').replace(/[,[\]\n\r]/g, ' ').replace(/\s+/g, ' ').trim() || 'блок';
    const r = String(reason || 'неизвестно').replace(/[\]\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || 'неизвестно';
    st.placeholders.push({ type: t, reason: r, position, countType: countType === undefined ? t : countType });
    return `[НЕ СКОПИРОВАНО: тип=${t}, причина=${r}, позиция=${position}]`;
  }

  function token(st, md) {
    st.tokens.push(md);
    return TOK_OPEN + (st.tokens.length - 1) + TOK_CLOSE;
  }

  function makeCtx(st, position, currentType) {
    const ctx = {
      provider: st.options.provider || null,
      options: st.options,
      position,
      report: null,
      convertChildren: (el) => flow(childrenOf(el), st).join('\n\n'),
      fence,
      placeholder: (type, reason) => addPlaceholder(st, type, reason, position, currentType),
      text: (el) => cleanText(el)
    };
    // internal: built-in handlers reach the conversion state through ctx._st (not part of the public contract)
    Object.defineProperty(ctx, '_st', { value: st, enumerable: false });
    // one stable live object per conversion (handlers may use it as a WeakMap key)
    if (!st.view) {
      st.view = {
        found: st.found,
        copied: st.copied,
        get placeholders() { return st.placeholders.map(({ type, reason, position: p }) => ({ type, reason, position: p })); }
      };
    }
    ctx.report = st.view;
    // addFooter(line): definitions (e.g. GFM footnotes "[^1]: ...") appended once, in order, after the body
    ctx.addFooter = (line) => {
      const l = String(line || '').trim();
      if (l && !st.footers.includes(l)) st.footers.push(l);
    };
    return ctx;
  }

  // ---------------------------------------------------------------- handlers: dispatch

  const NO_HANDLER = Symbol('no-handler');

  function runHandlers(el, st) {
    for (const h of blockHandlers) {
      const position = st.pos + 1;
      let matched;
      try {
        matched = h.match(el, makeCtx(st, position, h.type));
      } catch (err) {
        st.pos = position;
        return { markdown: addPlaceholder(st, h.type, `ошибка обработчика ${h.name}: ${err && err.message}`, position, h.type) };
      }
      if (!matched) continue;
      const ctx = makeCtx(st, position, h.type);
      let result;
      const absorbBefore = (!h.isDefault) ? absorbedInner(el, st) : null;
      try {
        result = h.render(el, ctx);
        if (result && typeof result === 'string') result = { markdown: result };
        if (result && typeof result.markdown !== 'string') throw new Error('render вернул не строку markdown');
      } catch (err) {
        st.pos = position;
        return { markdown: addPlaceholder(st, h.type, `ошибка обработчика ${h.name}: ${err && err.message}`, position, h.type) };
      }
      if (!result) continue;
      st.pos = position;
      const type = result.type || h.type;
      addCopied(st, type, result.copied === undefined ? 1 : result.copied);
      if (absorbBefore) {
        for (const k of Object.keys(absorbBefore)) st.found[k] = Math.max(0, (st.found[k] || 0) - absorbBefore[k]);
      }
      return { markdown: result.markdown, type };
    }
    return NO_HANDLER;
  }

  // Descendants swallowed by a handler that the census did not count as its own block are not "found" separately.
  function absorbedInner(el, st) {
    if (censusType(el, st.rules)) return null;
    const inner = {};
    censusInto(el, st.rules, inner, false);
    return inner;
  }

  // ---------------------------------------------------------------- flow (block level)

  function flow(nodes, st) {
    const blocks = [];
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const s = finishInline(inlineNodes(run, st), st, true);
      run = [];
      if (s) blocks.push(s);
    };
    if (st.depth > 120) {
      blocks.push(addPlaceholder(st, 'блок', 'слишком глубокая вложенность', st.pos + 1, null));
      return blocks;
    }
    st.depth++;
    try {
      for (const node of nodes) {
        if (node.nodeType === 3) { run.push(node); continue; }
        if (node.nodeType !== 1) continue;
        if (isUiNode(node, st.rules)) continue;
        const res = runHandlers(node, st);
        if (res !== NO_HANDLER) {
          const blockLike = res.markdown.includes('\n') || res.type === 'svg' || res.type === 'diagram' || BLOCK_TAGS.has(tagOf(node)) || hasBlockDescendant(node);
          if (blockLike) { flush(); if (res.markdown) blocks.push(res.markdown); } else run.push({ md: res.markdown });
          continue;
        }
        const tag = tagOf(node);
        if (/^h[1-6]$/.test(tag)) { flush(); blocks.push(renderHeading(node, st)); continue; }
        if (tag === 'ul' || tag === 'ol') { flush(); blocks.push(renderList(node, st)); continue; }
        if (tag === 'blockquote') { flush(); blocks.push(renderQuote(node, st)); continue; }
        if (tag === 'hr') { flush(); st.pos++; addCopied(st, 'hr', 1); blocks.push('---'); continue; }
        if (isBlockish(node)) {
          flush();
          for (const b of flow(childrenOf(node), st)) blocks.push(b);
          continue;
        }
        run.push(node);
      }
      flush();
    } finally {
      st.depth--;
    }
    return blocks.filter((b) => b !== '');
  }

  function renderHeading(el, st) {
    st.pos++;
    addCopied(st, 'heading', 1);
    const text = finishInline(inlineNodes(childrenOf(el), st), st, false);
    if (!text) return '';
    if (st.cell) return `**${text}**`;
    return `${'#'.repeat(Number(tagOf(el)[1]))} ${text}`;
  }

  function renderQuote(el, st) {
    st.pos++;
    addCopied(st, 'quote', 1);
    const blocks = flow(childrenOf(el), st);
    if (st.cell) return blocks.join(' ');
    const body = blocks.join('\n\n');
    if (!body) return '>';
    return body.split('\n').map((l) => (l === '' ? '>' : `> ${l}`)).join('\n');
  }

  function joinItemBlocks(blocks) {
    let out = '';
    blocks.forEach((b, i) => {
      if (i === 0) { out = b; return; }
      out += (/^(\d+[.)]|[-*+])\s/.test(b) ? '\n' : '\n\n') + b;
    });
    return out;
  }

  function renderList(el, st) {
    st.pos++;
    addCopied(st, 'list', 1);
    const ordered = tagOf(el) === 'ol';
    const startAttr = parseInt(el.getAttribute('start'), 10);
    let n = Number.isFinite(startAttr) ? startAttr : 1;
    const items = [];
    for (const child of childrenOf(el)) {
      if (child.nodeType === 3 && !child.data.trim()) continue;
      if (child.nodeType === 1 && isUiNode(child, st.rules)) continue;
      const isLi = tagOf(child) === 'li';
      const valueAttr = isLi ? parseInt(child.getAttribute('value'), 10) : NaN;
      if (Number.isFinite(valueAttr)) n = valueAttr;
      const blocks = isLi ? flow(childrenOf(child), st) : flow([child], st);
      if (st.cell) {
        items.push(`• ${blocks.join(' ')}`.trim());
        continue;
      }
      const marker = ordered ? `${n}.` : '-';
      if (ordered) n++;
      const indent = ' '.repeat(marker.length + 1);
      const lines = joinItemBlocks(blocks).split('\n');
      items.push(lines.map((l, i) => (i === 0 ? `${marker} ${l}`.trimEnd() : (l === '' ? '' : indent + l))).join('\n'));
    }
    return items.join('\n');
  }

  // ---------------------------------------------------------------- inline

  function wrapMarks(marker, inner) {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
    if (!m[2]) return inner;
    return `${m[1]}${marker}${m[2]}${marker}${m[3]}`;
  }

  function inlineNodes(nodes, st) {
    let out = '';
    for (const node of nodes) {
      if (node.nodeType === 3) { out += escapeText(normalizeText(node.data)); continue; }
      if (node.md !== undefined && node.nodeType === undefined) { out += token(st, node.md); continue; }
      if (node.nodeType !== 1) continue;
      if (isUiNode(node, st.rules)) continue;
      out += inlineElement(node, st);
    }
    return out;
  }

  function inlineElement(el, st) {
    const res = runHandlers(el, st);
    if (res !== NO_HANDLER) return token(st, res.markdown);
    const tag = tagOf(el);
    const kids = () => inlineNodes(childrenOf(el), st);
    switch (tag) {
      case 'br': return BR;
      case 'wbr': return '';
      case 'strong': case 'b': return wrapMarks('**', kids());
      case 'em': case 'i': return wrapMarks('*', kids());
      case 'del': case 's': case 'strike': return wrapMarks('~~', kids());
      case 'sup': case 'sub': { const inner = kids(); return inner ? `<${tag}>${inner}</${tag}>` : ''; }
      case 'code': return token(st, codeSpan(cleanText(el)));
      case 'input':
        return el.getAttribute('type') === 'checkbox' ? (el.hasAttribute('checked') ? '[x] ' : '[ ] ') : '';
      case 'a': {
        const inner = kids();
        if (!isLinkEl(el)) return inner;
        addCopied(st, 'link', 1);
        const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
        const url = linkUrl(el.getAttribute('href'));
        return `${m[1]}[${m[2] || escapeText(url)}](${url})${m[3]}`;
      }
      default:
        break;
    }
    if (/^h[1-6]$/.test(tag) || tag === 'ul' || tag === 'ol' || tag === 'blockquote' || tag === 'hr' || isBlockish(el)) {
      const blocks = flow([el], st);
      return token(st, blocks.join(' ').replace(/\s*\n\s*/g, ' '));
    }
    return kids();
  }

  function finishInline(s, st, lineEscapes) {
    let out = s.replace(/ * */g, BR).replace(/ {2,}/g, ' ');
    out = out.replace(new RegExp(`^(?: |${BR})+|(?: |${BR})+$`, 'g'), '');
    if (lineEscapes) out = escapeLineStarts(out);
    const brText = st.cell ? '<br>' : (lineEscapes ? '  \n' : ' ');
    out = out.split(BR).join(brText);
    // Tokens are resolved in one pass; token bodies are final and never re-scanned.
    return out.replace(TOKEN_RE, (_, i) => st.tokens[Number(i)]);
  }

  // ---------------------------------------------------------------- code blocks (core)

  function rawCodeText(node, rules) {
    let out = '';
    const walk = (n) => {
      if (n.nodeType === 3) { out += n.data; return; }
      if (n.nodeType !== 1) return;
      const tag = tagOf(n);
      if (tag === 'br') { out += '\n'; return; }
      if (isCodeUi(n, rules)) return;
      const block = tag === 'div' || tag === 'p' || tag === 'li' || tag === 'tr';
      if (block && out && !out.endsWith('\n')) out += '\n';
      for (const c of childrenOf(n)) walk(c);
    };
    for (const c of childrenOf(node)) walk(c);
    return out;
  }

  function isCodeUi(el, rules) {
    const tag = tagOf(el);
    if (tag === 'button' || tag === 'svg' || SILENT_TAGS.has(tag) || el.getAttribute('role') === 'button') return true;
    if (COPY_LABEL_RE.test(el.getAttribute('aria-label') || '')) return true;
    if (el.hasAttribute('data-line-number') || el.hasAttribute('data-ln')) return true;
    if (LINE_NUMBER_RE.test(el.getAttribute('class') || '')) return true;
    if (inlineStyle(el, 'userSelect') === 'none' || inlineStyle(el, 'webkitUserSelect') === 'none') return true;
    if (el.hasAttribute('hidden')) return true;
    return Boolean(rules && typeof rules.isUiNode === 'function' && safe(() => rules.isUiNode(el), false));
  }

  function extractCode(el, rules) {
    const provided = rules && typeof rules.codeBlock === 'function' ? safe(() => rules.codeBlock(el), null) : null;
    if (provided && typeof provided.text === 'string') {
      return { lang: String(provided.lang || '').toLowerCase().replace(/[^\w+#.-]/g, ''), text: provided.text };
    }
    const codes = Array.from(el.querySelectorAll('code')).filter((c) => !c.parentElement || !c.parentElement.closest('code'));
    const source = codes.length === 1 ? codes[0] : el;
    let text = rawCodeText(source, rules);
    text = text.replace(/\r\n/g, '\n').replace(/\n$/, '');
    return { lang: langOf(el), text };
  }

  function renderCode(el, ctx, st) {
    const { lang, text } = extractCode(el, st.rules);
    const type = DIAGRAM_LANGS.has(lang) ? 'diagram' : 'code';
    if (st.cell) {
      if (!text.includes('\n')) return { markdown: codeSpan(text).replace(/\|/g, '\\|'), type };
      const html = escapeHtml(text).replace(/\|/g, '&#124;').replace(/\n/g, '&#10;');
      const cls = lang ? ` class="language-${lang}"` : '';
      return { markdown: `<pre><code${cls}>${html}</code></pre>`, type };
    }
    return { markdown: fence(text, lang), type };
  }

  // ---------------------------------------------------------------- tables

  function tableRows(table) {
    const rows = [];
    const visit = (parent, section) => {
      for (const c of childrenOf(parent)) {
        if (c.nodeType !== 1) continue;
        const tag = tagOf(c);
        if (tag === 'tr') {
          const cells = childrenOf(c).filter((x) => x.nodeType === 1 && (tagOf(x) === 'td' || tagOf(x) === 'th') && !isUiNode(x, null));
          rows.push({ cells, head: section === 'thead' });
        } else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') visit(c, tag);
      }
    };
    visit(table, '');
    return rows;
  }

  function cellAlign(cell) {
    const a = (cell.getAttribute('align') || inlineStyle(cell, 'textAlign') || '').toLowerCase();
    return a === 'left' || a === 'center' || a === 'right' ? a : '';
  }

  function cellMarkdown(cell, st) {
    st.cell++;
    try {
      const blocks = flow(childrenOf(cell), st);
      return blocks.join('\n').replace(/\n/g, '<br>').replace(/(?<!\\)\|/g, '\\|').trim();
    } finally {
      st.cell--;
    }
  }

  function plainCell(cell, rules) {
    return rawCodeText(cell, rules).split('\n')
      .map((l) => normalizeText(l).trim()).filter((l, i, arr) => l || (i > 0 && i < arr.length - 1))
      .join('\n').trim();
  }

  function renderTable(el, ctx, st) {
    const table = tagOf(el) === 'table' ? el : (safe(() => st.rules.tableRoot(el), null) || el);
    if (st.cell) {
      return { markdown: ctx.placeholder('table', 'вложенная таблица внутри ячейки', el), copied: 0 };
    }
    const rows = tableRows(table);
    if (!rows.length) return { markdown: '' };
    const merged = rows.some((r) => r.cells.some((c) => parseInt(c.getAttribute('colspan'), 10) > 1 || parseInt(c.getAttribute('rowspan'), 10) > 1));
    if (merged) {
      const html = rows.map((r) => `<tr>${r.cells.map((c) => {
        const t = tagOf(c);
        const span = ['colspan', 'rowspan'].map((a) => (parseInt(c.getAttribute(a), 10) > 1 ? ` ${a}="${parseInt(c.getAttribute(a), 10)}"` : '')).join('');
        return `<${t}${span}>${escapeHtml(plainCell(c, st.rules)).replace(/\n/g, '<br>')}</${t}>`;
      }).join('')}</tr>`).join('\n');
      return { markdown: `<table>\n${html}\n</table>` };
    }
    const cols = rows.reduce((m, r) => Math.max(m, r.cells.length), 0);
    const hasHead = rows[0].head || (rows[0].cells.length > 0 && rows[0].cells.every((c) => tagOf(c) === 'th'));
    const matrix = rows.map((r) => {
      const cells = r.cells.map((c) => cellMarkdown(c, st));
      while (cells.length < cols) cells.push('');
      return cells;
    });
    const headRow = hasHead ? matrix.shift() : new Array(cols).fill('');
    const aligns = [];
    for (let i = 0; i < cols; i++) {
      const src = (hasHead ? rows[0].cells[i] : null) || (rows[hasHead ? 1 : 0] && rows[hasHead ? 1 : 0].cells[i]);
      const a = src ? cellAlign(src) : '';
      aligns.push(a === 'left' ? ':---' : a === 'center' ? ':---:' : a === 'right' ? '---:' : '---');
    }
    const line = (cells) => `| ${cells.map((c) => c || ' ').join(' | ')} |`.replace(/\|  \|/g, '| |');
    return { markdown: [line(headRow), `| ${aligns.join(' | ')} |`, ...matrix.map(line)].join('\n') };
  }

  // ---------------------------------------------------------------- images and fallbacks

  function renderImage(el, ctx) {
    const src = (el.getAttribute('src') || el.getAttribute('data-src') || '').trim();
    if (!src) return { markdown: ctx.placeholder('image', 'у изображения нет src', el), copied: 0 };
    const alt = (el.getAttribute('alt') || '').replace(/\s+/g, ' ').replace(/[[\]]/g, '\\$&').trim();
    return { markdown: `![${alt}](${linkUrl(src)})` };
  }

  function registerDefaults() {
    registerBlock({
      name: 'core-code', type: 'code', priority: 0,
      match: (el, ctx) => tagOf(el) === 'pre'
        || Boolean(stRulesFromCtx(ctx).codeBlock && safe(() => { const c = stRulesFromCtx(ctx).codeBlock(el); return c && typeof c.text === 'string'; }, false)),
      render: (el, ctx) => renderCode(el, ctx, ctx._st)
    }, true);
    registerBlock({
      name: 'core-table', type: 'table', priority: 0,
      match: (el, ctx) => tagOf(el) === 'table'
        || Boolean(stRulesFromCtx(ctx).tableRoot && safe(() => stRulesFromCtx(ctx).tableRoot(el), null)),
      render: (el, ctx) => renderTable(el, ctx, ctx._st)
    }, true);
    registerBlock({
      name: 'core-image', type: 'image', priority: 0,
      match: (el) => tagOf(el) === 'img',
      render: renderImage
    }, true);
    // Types whose real handlers live in other packages: until one is registered, a placeholder, never silence.
    ['math', 'diagram', 'svg', 'image'].forEach((type) => {
      registerBlock({
        name: `core-unhandled-${type}`, type, priority: -100,
        match: (el, ctx) => tagOf(el) !== 'pre' && builtinType(el, stRulesFromCtx(ctx)) === type,
        render: (el, ctx) => ({ markdown: ctx.placeholder(type, type === 'svg' || type === 'diagram' ? 'нет обработчика диаграммы' : 'обработчик типа не подключён', el), copied: 0 })
      }, true);
    });
  }

  function stRulesFromCtx(ctx) {
    return ctx._st.rules;
  }

  // ---------------------------------------------------------------- convert

  function convert(element, options) {
    const opts = options || {};
    const provider = opts.provider || null;
    const context = opts.context && typeof opts.context === 'object' ? opts.context : {};
    const flags = {};
    if (context.generating) flags.generating = true;
    if (context.truncated) flags.truncated = true;
    if (Number(context.collapsed) > 0) flags.collapsed = Number(context.collapsed);
    if (context.version !== undefined && context.version !== null) flags.version = String(context.version);
    if (context.regenerated) flags.regenerated = true;

    if (!element || element.nodeType !== 1) {
      const ph = `[НЕ СКОПИРОВАНО: тип=ответ, причина=нет DOM-элемента, позиция=1]`;
      return {
        markdown: ph,
        report: {
          version: REPORT_VERSION, provider, found: {}, copied: {},
          placeholders: [{ type: 'ответ', reason: 'нет DOM-элемента', position: 1 }],
          mismatches: [], flags, complete: false
        }
      };
    }

    const rules = rulesFor(opts);
    const rootEl = resolveRoot(element, rules);
    const found = census(rootEl, opts);
    const st = createState(rules, opts, found);

    let blocks;
    try {
      blocks = flow([rootEl], st);
    } catch (err) {
      blocks = [addPlaceholder(st, 'ответ', `сбой конвертера: ${err && err.message}`, st.pos + 1, null)];
    }
    if (Number(context.artifactRefs) > 0 && !(Number(context.artifactPanels) > 0)) {
      st.found.artifact = (st.found.artifact || 0) + 1;
      blocks.push(addPlaceholder(st, 'artifact',
        `панель артефакта не найдена: ссылок ${Number(context.artifactRefs)}, панелей 0`, st.pos + 1, 'artifact'));
    }
    let markdown = blocks.join('\n\n');
    if (st.footers.length) markdown += (markdown ? '\n\n' : '') + st.footers.join('\n');

    // Blocks of the assistant turn that lie outside the converted element (WP3: context.outsideBlocks).
    // Their content is unreachable here, so each one is a counted placeholder appended at the end.
    const outside = Array.isArray(context.outsideBlocks) ? context.outsideBlocks.filter((b) => b && typeof b === 'object') : [];
    if (outside.length) {
      const lines = outside.map((b, i) => {
        const type = OUTSIDE_TYPES[b.type] ? OUTSIDE_TYPES[b.type](b) : 'artifact';
        st.found[type] = (st.found[type] || 0) + 1;
        const hint = String(b.hint || b.tag || b.type || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        const pos = Number.isFinite(Number(b.position)) && Number(b.position) > 0 ? Math.floor(Number(b.position)) : st.pos + 1 + i;
        return addPlaceholder(st, type, `блок вне выбранного элемента ответа${b.beforeSelected ? ' (перед ним)' : ''}: ${hint || 'без описания'}`, pos, type);
      });
      markdown += (markdown ? '\n\n' : '') + lines.join('\n\n');
      flags.outsideBlocks = outside.length;
    }
    if (context.outsideBlocksTruncated) {
      const n = Number(context.outsideBlocksTruncated);
      const what = Number.isFinite(n) && n > 0 ? `ещё ${n} блоков` : 'часть блоков';
      markdown += (markdown ? '\n\n' : '') + addPlaceholder(st, 'блок', `${what} вне выбранного элемента не перечислены`, st.pos + 1 + outside.length, null);
      flags.outsideBlocks = flags.outsideBlocks || 0;
    }
    if (Array.isArray(context.notes) && context.notes.some((n) => /контейнер хода не определён/i.test(String(n)))) {
      flags.turnUnresolved = true;
    }

    const max = Number(opts.maxChars);
    if (Number.isFinite(max) && max > 0 && markdown.length > max) {
      markdown = markdown.slice(0, max).replace(/\s+$/, '')
        + '\n\n' + addPlaceholder(st, 'текст', 'превышен maxChars', st.pos + 1, null);
      flags.truncated = true;
    }

    const mismatches = [];
    const types = new Set([...Object.keys(st.found), ...Object.keys(st.copied)]);
    for (const p of st.placeholders) if (p.countType) types.add(p.countType);
    for (const type of types) {
      const f = st.found[type] || 0;
      const c = st.copied[type] || 0;
      const p = st.placeholders.filter((x) => x.countType === type).length;
      if (f !== c + p) mismatches.push({ type, found: f, copied: c, placeholders: p });
    }
    const foundOut = {};
    for (const k of Object.keys(st.found)) if (st.found[k] > 0) foundOut[k] = st.found[k];

    const report = {
      version: REPORT_VERSION,
      provider,
      found: foundOut,
      copied: st.copied,
      placeholders: st.placeholders.map(({ type, reason, position }) => ({ type, reason, position })),
      mismatches,
      flags,
      complete: false
    };
    report.complete = !flags.turnUnresolved && !mismatches.length && !st.placeholders.length && !flags.generating
      && !flags.truncated && !(flags.collapsed > 0);
    return { markdown, report };
  }

  registerDefaults();

  const api = Object.freeze({
    convert, census, registerBlock, registerProvider, PLACEHOLDER_RE, REPORT_VERSION
  });
  root.AnswerMarkdown = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
