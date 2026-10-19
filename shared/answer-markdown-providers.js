// Provider rules for AnswerMarkdown (WP4): UI-node filter, code-block markup, table roots, answer roots.
// Contract: docs/Architecture/answer-markdown-spec.md §4.1 (registerProvider). Facts about each site's DOM come only
// from tests/fixtures/live-answer-skeletons/*.json and the repo selectors; anything else is a conservative heuristic
// and is marked "unverified" in docs/Architecture/answer-markdown-matrix.md.
(function initAnswerMarkdownProviders(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.AnswerMarkdownProviders = api;
    if (root.AnswerMarkdown && typeof root.AnswerMarkdown.registerProvider === 'function') api.register(root.AnswerMarkdown);
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function factory() {
  'use strict';

  const VERSION = 1;

  // ---- helpers -----------------------------------------------------------------------------------------------

  const matches = (el, sel) => {
    try { return !!el && el.nodeType === 1 && el.matches(sel); } catch (_) { return false; }
  };
  const closest = (el, sel) => {
    try { return el && el.nodeType === 1 ? el.closest(sel) : null; } catch (_) { return null; }
  };
  const query = (el, sel) => {
    try { return el ? el.querySelector(sel) : null; } catch (_) { return null; }
  };
  const queryAll = (el, sel) => {
    try { return el ? Array.from(el.querySelectorAll(sel)) : []; } catch (_) { return []; }
  };
  const selfOrQuery = (el, sel) => (matches(el, sel) ? el : query(el, sel));
  const isTag = (el, tag) => !!el && el.nodeType === 1 && el.tagName === tag;

  // Interface chrome common to every site. No aria-hidden / svg here: KaTeX layers and SVG diagrams are content.
  const COMMON_UI = [
    'button', '[role="button"]', '[role="toolbar"]', 'script', 'style', 'noscript',
    '.line-numbers', '.line-numbers-rows', '.cm-gutters', '[data-line-number]', '[data-linenumber]'
  ].join(', ');

  // Line numbers / gutters inside a code element (looser than COMMON_UI, applied only inside code).
  const CODE_NOISE = [
    COMMON_UI, 'svg', '.linenumber', '.line-number', '.linenumbers', '.gutter', '.hljs-ln-numbers',
    '.token.line-number', '[class*="line-number" i]'
  ].join(', ');

  const LINE_CLASSES = ['line', 'cm-line', 'view-line'];
  const isLineEl = (el) => !!el && el.nodeType === 1 && LINE_CLASSES.some((c) => el.classList.contains(c));

  // Exact text of a code element: no whitespace normalisation, UI/line-number nodes skipped, <br> -> \n,
  // directly adjacent per-line spans (shiki / CodeMirror) joined with \n.
  function exactText(node, skip) {
    if (!node) return '';
    let out = '';
    const walk = (n) => {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) { out += c.data; continue; }
        if (c.nodeType !== 1) continue;
        if (skip(c)) continue;
        if (c.tagName === 'BR') { out += '\n'; continue; }
        walk(c);
        if (isLineEl(c) && c.nextSibling && c.nextSibling.nodeType === 1 && isLineEl(c.nextSibling)) out += '\n';
      }
    };
    walk(node);
    return out;
  }

  const LANG_ALIASES = {
    javascript: 'js', typescript: 'ts', shell: 'bash', 'shell script': 'bash', sh: 'bash', zsh: 'bash',
    python3: 'python', py: 'python', yml: 'yaml', 'plain text': '', plaintext: '', text: '', txt: ''
  };
  const NOT_A_LANG = /^(copy|copied|copy code|code|download|run|edit|preview|wrap|collapse|expand|save|share|open)$/i;

  function normalizeLang(raw) {
    const s = String(raw == null ? '' : raw).replace(/ /g, ' ').trim().toLowerCase();
    if (!s || NOT_A_LANG.test(s)) return '';
    if (Object.prototype.hasOwnProperty.call(LANG_ALIASES, s)) return LANG_ALIASES[s];
    return /^[a-z0-9+#._-]{1,24}$/.test(s) ? s : '';
  }

  function langFromAttrs(el) {
    if (!el || el.nodeType !== 1) return '';
    for (const a of ['data-language', 'data-lang', 'data-code-language']) {
      const v = normalizeLang(el.getAttribute(a));
      if (v) return v;
    }
    for (const c of Array.from(el.classList)) {
      const m = /^(?:language|lang|highlight-source)-([A-Za-z0-9+#._-]+)$/.exec(c);
      if (m) { const v = normalizeLang(m[1]); if (v) return v; }
    }
    return '';
  }

  // Short stand-alone label ("python", "JSON") in the block header, outside the code itself.
  function headerLabelLang(pre) {
    let a = pre;
    for (let depth = 0; depth < 2; depth += 1) {
      const p = a.parentElement;
      if (!p || queryAll(p, 'pre').length !== 1) return '';
      if ((p.textContent || '').length - (pre.textContent || '').length > 40) return '';
      for (const el of queryAll(p, '*')) {
        if (el === pre || pre.contains(el) || el.contains(pre)) continue;
        if (matches(el, 'button, [role="button"], svg, img, p, li, td, th, h1, h2, h3, h4, h5, h6')) continue;
        if (closest(el, 'button, [role="button"]')) continue;
        if (Array.from(el.children).some((c) => !isTag(c, 'SVG') && !isTag(c, 'IMG'))) continue;
        const v = normalizeLang(el.textContent);
        if (v) return v;
      }
      a = p;
    }
    return '';
  }

  function finishCode(codeEl, lang) {
    let text = exactText(codeEl, (n) => matches(n, CODE_NOISE));
    // a rendering artefact (<pre><code>...\n</code></pre>), not content: one final newline is dropped
    if (text.endsWith('\n')) text = text.slice(0, -1);
    return { lang: lang || '', text };
  }

  // ---- generic rules (any provider) ----------------------------------------------------------------------------

  function genericCodeBlock(el) {
    if (!el || el.nodeType !== 1) return null;
    let pre = null;
    if (isTag(el, 'PRE')) pre = el;
    else if (isTag(el, 'CODE-BLOCK')) pre = query(el, 'pre'); // unverified custom element (Gemini), see matrix
    if (!pre) return null;
    const code = query(pre, 'code') || pre;
    const lang = langFromAttrs(code) || langFromAttrs(pre) || langFromAttrs(pre.parentElement) || headerLabelLang(pre);
    return finishCode(code, lang);
  }

  const TABLE_BLOCKERS = 'pre, h1, h2, h3, h4, h5, h6, blockquote, p, ul, ol, hr';

  // A wrapper qualifies when its only content is one <table> (+ interface chrome).
  function genericTableRoot(el) {
    if (!el || el.nodeType !== 1) return null;
    if (isTag(el, 'TABLE')) return el;
    const tables = queryAll(el, 'table');
    if (tables.length !== 1) return null;
    const stray = queryAll(el, TABLE_BLOCKERS).some((n) => !closest(n, 'table'));
    return stray ? null : tables[0];
  }

  // ---- per-provider rule sets ----------------------------------------------------------------------------------

  const gpt = {
    ui: ['[class*="tableContainer"] .relative.h-0.self-end'],
    // Outer <pre> holds a CodeMirror viewer (<pre class="cm-content"><code>) and, in the labelled variant,
    // a sticky header with the language label. Fixture: gpt.html (skeleton chatgpt.json).
    codeBlock(el) {
      let outer = null;
      if (isTag(el, 'PRE') && el.classList.contains('cm-content')) outer = (el.parentElement && closest(el.parentElement, 'pre')) || el;
      else if (isTag(el, 'PRE') && query(el, '.cm-content')) outer = el;
      if (!outer) return null;
      const cm = outer.classList.contains('cm-content') ? outer : query(outer, '.cm-content');
      const label = query(outer, '.select-none.sticky [class*="cursor-default"]');
      return finishCode(cm, label ? normalizeLang(label.textContent) : '');
    },
    answerRoot: (el) => selfOrQuery(el, '.markdown')
  };

  const gemini = {
    ui: [
      'copy-button', 'message-actions', 'regenerate-button', 'thumb-up-button', 'thumb-down-button', 'mat-icon',
      'gem-icon', 'gem-icon-button', 'gem-popover', 'mat-menu', 'thinking-overlay', 'h6.screen-reader-model-response-label',
      'h2.screen-reader-model-response-label', 'election-info-disclaimer', 'freemium-rag-disclaimer', 'sensitive-memories-banner'
    ],
    answerRoot: (el) => selfOrQuery(el, 'structured-content-container.model-response-text, structured-content-container')
  };

  const claude = {
    ui: ['.sr-only', '[role="status"]'],
    answerRoot: (el) => selfOrQuery(el, '.font-claude-response')
  };

  const grok = {
    ui: ['.thinking-container'],
    // [data-testid="code-block"] is the fenced block here (header span.font-mono + .shiki pre > code > span.line).
    // Fixture: grok.html (skeleton grok.json).
    codeBlock(el) {
      const wrap = isTag(el, 'PRE') ? closest(el, '[data-testid="code-block"]') : el;
      if (!matches(wrap, '[data-testid="code-block"]') || isTag(wrap, 'CODE')) return null;
      const pre = query(wrap, '.shiki pre') || query(wrap, 'pre');
      if (!pre) return null;
      let lang = '';
      for (const s of queryAll(wrap, 'span.font-mono')) {
        if (!pre.contains(s) && !closest(s, 'button')) { lang = normalizeLang(s.textContent); if (lang) break; }
      }
      return finishCode(query(pre, 'code') || pre, lang);
    },
    answerRoot: (el) => selfOrQuery(el, '.response-content-markdown')
  };

  const lechat = {
    ui: ['[data-message-part-type="reasoning"]'],
    // Trap: here data-testid="code-block" sits on INLINE <code>, so it must not be treated as a fenced block
    // (genericCodeBlock never matches a lone <code>). Fenced-block markup is unknown (not in skeleton).
    answerRoot: (el) => selfOrQuery(el, '[data-message-part-type="answer"]')
  };

  const qwen = {
    ui: ['.qwen-markdown-table-header', '.qwen-chat-thinking-tool-status-card-wraper', '.qwen-chat-tool-status-card', '.copy-response-button'],
    answerRoot: (el) => selfOrQuery(el, '.qwen-markdown')
  };

  const deepseek = {
    ui: ['.md-code-block-banner-wrap', '.ds-button', '.code-info-button-text', '.md-code-block > svg'],
    // .md-code-block > banner (first span outside .ds-button = language) + <pre> (plain text in spans).
    // Class names in the banner are hashed, so the language is found structurally. Fixture: deepseek.html.
    codeBlock(el) {
      const wrap = matches(el, '.md-code-block') ? el : (isTag(el, 'PRE') ? closest(el, '.md-code-block') : null);
      if (!wrap) return null;
      const pre = Array.from(wrap.children).find((c) => isTag(c, 'PRE')) || query(wrap, 'pre');
      if (!pre) return null;
      let lang = '';
      for (const s of queryAll(query(wrap, '.md-code-block-banner') || wrap, 'span')) {
        if (closest(s, '.ds-button, [role="button"]') || pre.contains(s)) continue;
        lang = normalizeLang(s.textContent);
        if (lang) break;
      }
      return finishCode(query(pre, 'code') || pre, lang);
    },
    // a reasoning block may also use .ds-markdown (unverified): the answer is the last one
    answerRoot: (el) => { const all = matches(el, '.ds-markdown') ? [el] : queryAll(el, '.ds-markdown'); return all.length ? all[all.length - 1] : null; }
  };

  const perplexity = {
    ui: ['.citation-nbsp'],
    answerRoot: (el) => selfOrQuery(el, '[id^="markdown-content-"]')
  };

  const zai = {
    ui: ['.thinking-chain-container', '.copy-response-button'],
    answerRoot: (el) => selfOrQuery(el, '.chat-assistant.markdown-prose')
  };

  const kimi = {
    ui: [],
    // repo selector (answer-pipeline-selectors.js, kimi): the reasoning trace must not become the answer
    answerRoot: (el) => {
      const all = (matches(el, '.markdown-container') ? [el] : queryAll(el, '.markdown-container')).filter((n) => !closest(n, '[class*="think" i], [class*="thought" i], [class*="reason" i]'));
      return all.length ? all[all.length - 1] : null;
    }
  };

  const SPECS = { GPT: gpt, Gemini: gemini, Claude: claude, Grok: grok, 'Le Chat': lechat, Qwen: qwen, DeepSeek: deepseek, Perplexity: perplexity, 'Z.ai': zai, Kimi: kimi };

  function buildRules(spec) {
    const uiSel = [COMMON_UI].concat(spec.ui || []).join(', ');
    return {
      isUiNode: (el) => matches(el, uiSel),
      codeBlock(el) {
        try {
          return (spec.codeBlock ? spec.codeBlock(el) : null) || genericCodeBlock(el);
        } catch (_) { return null; }
      },
      // Scroll wrappers of every known provider (ChatGPT tableContainer/tableWrapper, DeepSeek ds-scroll-area,
      // Grok table-container, Qwen table-wrapper/scroll-wrapper) contain only the <table> plus chrome buttons,
      // so one structural rule covers them; see the matrix for the confirmed class names.
      tableRoot(el) {
        try { return genericTableRoot(el); } catch (_) { return null; }
      },
      answerRoot(el) {
        try { return spec.answerRoot ? spec.answerRoot(el) || null : null; } catch (_) { return null; }
      }
    };
  }

  const RULES = {};
  Object.keys(SPECS).forEach((name) => { RULES[name] = buildRules(SPECS[name]); });

  function register(AnswerMarkdown) {
    if (!AnswerMarkdown || typeof AnswerMarkdown.registerProvider !== 'function') return false;
    Object.keys(RULES).forEach((name) => AnswerMarkdown.registerProvider(name, RULES[name]));
    return true;
  }

  return { VERSION, RULES, PROVIDERS: Object.keys(RULES), register, exactText, normalizeLang, genericCodeBlock, genericTableRoot };
});
