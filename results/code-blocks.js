// results/code-blocks.js
// Every <pre> of a shown answer becomes a code block with a header (language) and a "Copy" button.
// The header and the button carry NO text of their own (label and "Copied" come from CSS ::before), so the
// text of a card (innerText / textContent: copy, TXT, hand-over to another model) is unchanged.
// The copy takes the text of <pre><code> exactly (indentation, empty lines).
(function installCodeBlocks(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ResultsCodeBlocks = api;
})(typeof self !== 'undefined' ? self : globalThis, function factory() {
  'use strict';

  // Answer cards: feed cards and the model answer panels (and the revisions inside a card).
  const PAGE_SELECTOR = '.debate-model-card-output, .llm-panel .output, .post-terminal-answer-revision-body';

  // ------------------------------------------------------------------ language -> file, preview kinds
  const EXTENSIONS = {
    python: 'py', py: 'py', javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', tsx: 'tsx', jsx: 'jsx', json: 'json', html: 'html', css: 'css',
    bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh', powershell: 'ps1', ps1: 'ps1', sql: 'sql', yaml: 'yml', yml: 'yml', xml: 'xml',
    markdown: 'md', md: 'md', mermaid: 'mmd', svg: 'svg', csv: 'csv', java: 'java', kotlin: 'kt', swift: 'swift', go: 'go', rust: 'rs',
    c: 'c', cpp: 'cpp', 'c++': 'cpp', csharp: 'cs', cs: 'cs', 'c#': 'cs', php: 'php', ruby: 'rb', rb: 'rb', dockerfile: '', toml: 'toml', ini: 'ini',
    diff: 'patch', patch: 'patch'
  };
  const extensionOf = (lang) => {
    const key = String(lang || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(EXTENSIONS, key) ? EXTENSIONS[key] : 'txt';
  };
  const safeNamePart = (value, fallback) => String(value || '').replace(/[\\/:*?"<>|\u0000-\u001f\s]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 40) || fallback;
  // <model or "code">-<language>-<N>.<ext>   (Dockerfile has no extension)
  const downloadName = (model, lang, index) => {
    const language = safeNamePart(String(lang || '').toLowerCase() === 'code' ? 'text' : lang, 'text');
    const ext = extensionOf(lang);
    return `${safeNamePart(model, 'code')}-${language}-${index}${ext ? `.${ext}` : ''}`;
  };
  const PREVIEW_KINDS = { html: 'html', svg: 'svg', markdown: 'markdown', md: 'markdown', mermaid: 'mermaid', json: 'json', csv: 'csv' };
  const previewKind = (lang) => PREVIEW_KINDS[String(lang || '').trim().toLowerCase()] || '';
  const HTML_PREVIEW_CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">';
  const toBase64 = (text) => {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  };
  // A svg picture is shown only when it holds nothing active (it is an <img>, nothing runs in it anyway; this is a second fence).
  const svgIsPlain = (text) => /^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(text) && !/<script\b|\son[a-z]+\s*=|<foreignObject\b|javascript:/i.test(text);
  const parseCsv = (text) => {
    const rows = [];
    let row = []; let cell = ''; let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i += 1; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  };
  const LINE_NUMBER_NODES = '.line-number, .line-numbers, .line-numbers-rows, [class*="line-num" i], [class*="linenumber" i], [data-line-number], [data-linenumber], .cm-gutters, .hljs-ln-numbers, td.hljs-ln-line.hljs-ln-n';

  function codeBlocksRuntime(doc, containerSelector, observe, hooks) {
    const WRAP = 'code-block';
    const HEADER = 'code-block-header';
    const BUTTON = 'code-block-copy';
    const OPEN = 'code-block-open';
    const DOWNLOAD = 'code-block-download';
    const win = doc.defaultView || window;

    const languageOf = (pre) => {
      const own = pre.getAttribute('data-code-lang');
      if (own) return own;
      const holder = pre.querySelector('code');
      const match = /(?:^|\s)(?:language|lang)-([\w+#.-]+)/i.exec(`${pre.className} ${holder ? holder.className : ''}`);
      return match ? match[1] : 'code';
    };

    const textOf = (pre) => {
      const code = pre.querySelector('code');
      return (code || pre).textContent;
    };

    const buildHeader = (lang) => {
      const header = doc.createElement('div');
      header.className = HEADER;
      header.setAttribute('data-lang', lang);
      header.setAttribute('contenteditable', 'false');
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = BUTTON;
      button.setAttribute('aria-label', 'Копировать код');
      button.title = 'Копировать код';
      // Просмотр / Скачать: always present, whatever the provider's own block had. Labels come from CSS (no text nodes).
      [[OPEN, 'Просмотр кода'], [DOWNLOAD, 'Скачать код']].forEach(([cls, label]) => {
        const extra = doc.createElement('button');
        extra.type = 'button';
        extra.className = cls;
        extra.setAttribute('aria-label', label);
        extra.title = label;
        header.appendChild(extra);
      });
      header.appendChild(button);
      return header;
    };

    // Idempotent: a block already wrapped with its header is left alone; a wrapper whose header was lost
    // (saved html passes through the sanitizer, which removes buttons) gets a new header.
    const decorate = (container) => {
      if (!container || !container.querySelectorAll) return 0;
      let made = 0;
      container.querySelectorAll('pre').forEach((pre) => {
        // Line numbers of a raw saved <pre> (gutters, number cells) are not code: removed here, inside the pre only.
        try { pre.querySelectorAll(LINE_NUMBER_NODES).forEach((node) => node.remove()); } catch (_) { /* keep the pre as it is */ }
        const parent = pre.parentElement;
        const lang = languageOf(pre);
        if (parent && parent.classList.contains(WRAP)) {
          const header = parent.querySelector(`:scope > .${HEADER}`);
          if (!header || !header.querySelector(`.${BUTTON}`) || !header.querySelector(`.${OPEN}`) || !header.querySelector(`.${DOWNLOAD}`)) {
            if (header) header.remove();
            parent.insertBefore(buildHeader(lang), pre);
            made += 1;
          }
          if (hooks && hooks.block) hooks.block(parent, pre, lang);
          return;
        }
        const wrapper = doc.createElement('div');
        wrapper.className = WRAP;
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(buildHeader(lang));
        wrapper.appendChild(pre);
        made += 1;
        if (hooks && hooks.block) hooks.block(wrapper, pre, lang);
      });
      return made;
    };

    const writeClipboard = async (text) => {
      try {
        if (win.navigator && win.navigator.clipboard && win.navigator.clipboard.writeText) {
          await win.navigator.clipboard.writeText(text);
          return true;
        }
      } catch (_) { /* fall through to the textarea route */ }
      const area = doc.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      doc.body.appendChild(area);
      area.select();
      let ok = false;
      try { ok = doc.execCommand('copy'); } catch (_) { ok = false; }
      area.remove();
      return ok;
    };

    const onCopyClick = async (event) => {
      const button = event.target && event.target.closest ? event.target.closest(`.${BUTTON}`) : null;
      if (!button) return;
      const block = button.closest(`.${WRAP}`);
      const pre = block && block.querySelector('pre');
      if (!pre) return;
      event.preventDefault();
      event.stopPropagation();
      const ok = await writeClipboard(textOf(pre));
      button.classList.toggle('is-copied', ok);
      button.classList.toggle('is-failed', !ok);
      win.setTimeout(() => { button.classList.remove('is-copied', 'is-failed'); }, 1500);
    };
    doc.addEventListener('click', onCopyClick, true);


    // ---------------------------------------------------------------- download and viewer
    const modelOf = (block) => {
      const holder = block.closest('[data-llm-name]');
      return holder ? holder.getAttribute('data-llm-name') : '';
    };
    const indexOf = (block) => {
      const owner = block.closest(containerSelector) || doc;
      return Array.from(owner.querySelectorAll(`.${WRAP}`)).indexOf(block) + 1 || 1;
    };
    // The same download as the exports (DebateExport.downloadText: Blob + temporary a[download] + revokeObjectURL).
    const saveText = (name, text) => {
      const exporter = win.DebateExport;
      if (exporter && typeof exporter.downloadText === 'function') return exporter.downloadText(name, text, doc);
      const url = win.URL.createObjectURL(new win.Blob([text], { type: 'text/plain;charset=utf-8' }));
      const anchor = doc.createElement('a');
      anchor.href = url; anchor.download = name;
      doc.body.appendChild(anchor); anchor.click(); anchor.remove();
      win.URL.revokeObjectURL(url);
      return true;
    };
    const flash = (button, cls) => {
      button.classList.add(cls);
      win.setTimeout(() => { button.classList.remove(cls); }, 1500);
    };
    const downloadBlock = (block, pre, button) => {
      const text = textOf(pre);
      const ok = text ? saveText(downloadName(modelOf(block), languageOf(pre), indexOf(block)), text) : false;
      if (button) flash(button, ok ? 'is-downloaded' : 'is-failed');
      return ok;
    };

    let viewer = null;
    const closeViewer = () => {
      if (!viewer) return;
      const { overlay, opener, onKey } = viewer;
      doc.removeEventListener('keydown', onKey, true);
      overlay.remove();
      viewer = null;
      if (opener && opener.focus && opener.isConnected) opener.focus();
    };
    const el = (tag, cls, text) => {
      const node = doc.createElement(tag);
      if (cls) node.className = cls;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const openViewer = (block, pre, opener) => {
      closeViewer();
      const lang = languageOf(pre);
      const text = textOf(pre);
      const kind = previewKind(lang);
      const overlay = el('div', 'code-viewer-overlay');
      const dialog = el('div', 'code-viewer');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', `Просмотр кода: ${lang}`);
      const head = el('div', 'code-viewer-head');
      head.appendChild(el('span', 'code-viewer-lang', lang));
      const body = el('div', 'code-viewer-body');
      const mkButton = (cls, label) => { const b = el('button', `code-viewer-btn ${cls}`, label); b.type = 'button'; return b; };
      let mode = kind ? 'preview' : 'code';
      let wrapOn = false;
      const modeButtons = {};
      const controls = el('span', 'code-viewer-controls');
      if (kind) {
        [['preview', 'Просмотр'], ['code', 'Код']].forEach(([key, label]) => {
          const b = mkButton('code-viewer-mode', label);
          b.setAttribute('data-mode', key);
          modeButtons[key] = b;
          controls.appendChild(b);
        });
      }
      const wrapButton = mkButton('code-viewer-wrap', 'Перенос строк');
      wrapButton.setAttribute('aria-pressed', 'false');
      const copyButton = mkButton('code-viewer-copy', 'Копировать');
      const saveButton = mkButton('code-viewer-save', 'Скачать');
      const closeButton = mkButton('code-viewer-close', 'Закрыть');
      closeButton.setAttribute('aria-label', 'Закрыть');
      [wrapButton, copyButton, saveButton, closeButton].forEach((b) => controls.appendChild(b));
      head.appendChild(controls);
      dialog.append(head, body);
      overlay.appendChild(dialog);

      const showCode = () => {
        const codePre = el('pre', 'code-viewer-code');
        codePre.style.whiteSpace = wrapOn ? 'pre-wrap' : 'pre';
        codePre.appendChild(el('code', '', text));
        body.replaceChildren(codePre);
      };
      const showNote = (note) => { body.appendChild(el('div', 'code-viewer-note', note)); };
      const showPreview = async () => {
        body.replaceChildren();
        try {
          if (kind === 'html') {
            const frame = el('iframe', 'code-viewer-frame');
            frame.setAttribute('sandbox', '');   // no scripts, no same-origin, no forms, no popups
            frame.setAttribute('title', 'Просмотр html');
            frame.setAttribute('srcdoc', `${HTML_PREVIEW_CSP}${text}`);
            body.appendChild(frame);
          } else if (kind === 'svg') {
            if (!svgIsPlain(text)) { showCode(); showNote('Картинка svg содержит активные элементы: показан код.'); return; }
            const img = el('img', 'code-viewer-img');
            img.setAttribute('alt', 'svg');
            img.setAttribute('src', `data:image/svg+xml;base64,${toBase64(text)}`);
            body.appendChild(img);
          } else if (kind === 'markdown') {
            const md = win.MarkdownToHtml && win.MarkdownToHtml.render;
            if (typeof md !== 'function') { showCode(); return; }
            const holder = el('div', 'code-viewer-md');
            const html = md(text);
            holder.innerHTML = typeof win.sanitizeHTML === 'function' ? win.sanitizeHTML(html) : '';
            if (typeof win.sanitizeHTML !== 'function') holder.textContent = text;
            body.appendChild(holder);
          } else if (kind === 'json') {
            let pretty = text;
            try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch (_) { /* not json: as it is */ }
            const codePre = el('pre', 'code-viewer-code');
            codePre.style.whiteSpace = wrapOn ? 'pre-wrap' : 'pre';
            codePre.appendChild(el('code', '', pretty));
            body.appendChild(codePre);
          } else if (kind === 'csv') {
            const rows = parseCsv(text);
            if (!rows.length || rows.length > 200) { showCode(); if (rows.length > 200) showNote('Больше 200 строк: показан код.'); return; }
            const table = el('table', 'code-viewer-table');
            rows.forEach((cells, i) => {
              const tr = el('tr');
              cells.forEach((cell) => tr.appendChild(el(i === 0 ? 'th' : 'td', '', cell)));
              table.appendChild(tr);
            });
            body.appendChild(table);
          } else if (kind === 'mermaid') {
            const ready = block.querySelector(':scope > .code-block-diagram img');
            let src = ready && ready.getAttribute('src');
            if (!src) {
              const result = await renderDiagram(doc, text);
              if (!viewer || viewer.overlay !== overlay) return;
              if (!result.ok) { mode = 'code'; refresh(); showNote(`Не удалось отрисовать диаграмму: ${result.reason}`); return; }
              src = result.src;
            }
            const img = el('img', 'code-viewer-img');
            img.setAttribute('alt', 'Диаграмма Mermaid');
            img.setAttribute('src', src);
            body.appendChild(img);
          }
        } catch (error) {
          showCode();
          showNote(`Не удалось показать просмотр: ${shortReason(error)}`);
        }
      };
      function refresh() {
        Object.keys(modeButtons).forEach((key) => modeButtons[key].setAttribute('aria-pressed', String(mode === key)));
        wrapButton.hidden = mode === 'preview' && kind !== 'json';
        if (mode === 'preview') showPreview(); else showCode();
      }
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) { closeViewer(); return; }
        const target = event.target && event.target.closest ? event.target.closest('button') : null;
        if (!target) return;
        if (target === closeButton) closeViewer();
        else if (target === copyButton) writeClipboard(text).then((ok) => flash(copyButton, ok ? 'is-copied' : 'is-failed'));
        else if (target === saveButton) {
          const ok = text ? saveText(downloadName(modelOf(block), lang, indexOf(block)), text) : false;
          flash(saveButton, ok ? 'is-downloaded' : 'is-failed');
        } else if (target === wrapButton) {
          wrapOn = !wrapOn;
          wrapButton.setAttribute('aria-pressed', String(wrapOn));
          refresh();
        } else if (target.classList.contains('code-viewer-mode')) {
          mode = target.getAttribute('data-mode');
          refresh();
        }
      });
      // Esc closes; Tab stays inside the dialog.
      const onKey = (event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeViewer(); return; }
        if (event.key !== 'Tab') return;
        const focusable = Array.from(dialog.querySelectorAll('button:not([hidden]), iframe, [tabindex]:not([tabindex="-1"])'));
        if (!focusable.length) return;
        const first = focusable[0]; const last = focusable[focusable.length - 1];
        const active = doc.activeElement;
        if (event.shiftKey && (active === first || !dialog.contains(active))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (active === last || !dialog.contains(active))) { event.preventDefault(); first.focus(); }
      };
      doc.addEventListener('keydown', onKey, true);
      doc.body.appendChild(overlay);
      viewer = { overlay, opener, onKey };
      refresh();
      closeButton.focus();
    };

    const onActionClick = (event) => {
      const target = event.target && event.target.closest ? event.target.closest(`.${OPEN}, .${DOWNLOAD}`) : null;
      if (!target) return;
      const block = target.closest(`.${WRAP}`);
      const pre = block && block.querySelector('pre');
      if (!pre) return;
      event.preventDefault();
      event.stopPropagation();
      if (target.classList.contains(OPEN)) openViewer(block, pre, target); else downloadBlock(block, pre, target);
    };
    doc.addEventListener('click', onActionClick, true);

    // The pre of an old saved card, of a path that sets html directly, of a later growth of the answer.
    // Many added nodes usually belong to one container: every container is decorated once per batch.
    // Decorating it once per node made an answer with many code blocks cost blocks × nodes.
    const decorateIn = (nodes) => {
      const owners = new Set();
      nodes.forEach((node) => {
        if (!node || node.nodeType !== 1) return;
        const own = node.closest ? node.closest(containerSelector) : null;
        if (own) owners.add(own);
        if (node.querySelectorAll) node.querySelectorAll(containerSelector).forEach((el) => owners.add(el));
      });
      owners.forEach(decorate);
    };
    decorateIn([doc.body || doc.documentElement]);
    let observer = null;
    if (observe && win.MutationObserver) {
      let queued = false;
      const pending = new Set();
      observer = new win.MutationObserver((mutations) => {
        mutations.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) pending.add(n); }));
        if (queued || !pending.size) return;
        queued = true;
        win.setTimeout(() => {
          queued = false;
          const nodes = Array.from(pending);
          pending.clear();
          decorateIn(nodes);
        }, 0);
      });
      observer.observe(doc.body || doc.documentElement, { childList: true, subtree: true });
    }
    return {
      decorate,
      // Removes what install() attached to the document (used by tests that load the module again).
      dispose() {
        if (observer) observer.disconnect();
        doc.removeEventListener('click', onCopyClick, true);
        doc.removeEventListener('click', onActionClick, true);
        closeViewer();
      }
    };
  }

  // ------------------------------------------------------------------ Mermaid diagrams
  // pre[data-code-lang=mermaid] is shown as the DIAGRAM (rendered from its source by the local mermaid library, loaded
  // on the first such block), with a "Диаграмма | Код" switch in the header. Until the picture is ready, and whenever
  // it cannot be made, the block stays CODE with a visible note: never an empty block. The picture is an <img data:svg>
  // (no script runs in it). Header texts come from CSS (no text nodes: the card text stays the same).
  const MERMAID_TIMEOUT_MS = 5000;
  const diagramCache = new Map(); // source hash -> { ok, src, width, height } | { ok:false, reason }
  let mermaidLoader = null;       // replaceable for tests
  let mermaidPromise = null;
  let renderChain = Promise.resolve();
  let diagramCounter = 0;
  const loadingWrappers = new WeakSet();

  const hashSource = (text) => {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return `${text.length}:${(hash >>> 0).toString(16)}`;
  };
  const shortReason = (error) => String((error && error.message) || error || 'неизвестная ошибка')
    .split('\n').map((line) => line.trim()).find(Boolean).replace(/\s+/g, ' ').slice(0, 100);
  const defaultLoader = () => {
    const rt = typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function' ? chrome.runtime : null;
    const url = rt ? rt.getURL('lib/mermaid/mermaid.esm.min.mjs') : '/lib/mermaid/mermaid.esm.min.mjs';
    return import(url).then((module) => module.default || module);
  };
  const pageIsDark = (doc) => {
    try {
      const color = doc.defaultView.getComputedStyle(doc.body).backgroundColor.match(/\d+(?:\.\d+)?/g);
      if (!color) return false;
      const [r, g, b] = color.map(Number);
      return (0.299 * r + 0.587 * g + 0.114 * b) < 110;
    } catch (_) { return false; }
  };
  // The look of the diagrams WE draw from mermaid source: neutral monochrome (white blocks, thin grey borders, square corners, thin
  // dark-grey lines, small filled arrowheads on a light grey panel), not mermaid's lilac default. Diagrams that arrive as a picture of
  // the source page's own svg keep the page's look (they never pass here). Panel colors: styles/modals-responsive.css (.code-block-diagram).
  const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  const DIAGRAM_COLORS = {
    light: { panel: '#f1f1f1', node: '#ffffff', border: '#d6d6d6', text: '#1f1f1f', line: '#666666', cluster: '#f7f7f7', lifeline: '#bdbdbd', signal: '#444444', special: '#5f5f5f' },
    dark: { panel: '#2b2b2b', node: '#3a3a3a', border: '#555555', text: '#eeeeee', line: '#aaaaaa', cluster: '#333333', lifeline: '#666666', signal: '#cccccc', special: '#aaaaaa' }
  };
  const diagramConfig = (dark) => {
    const c = dark ? DIAGRAM_COLORS.dark : DIAGRAM_COLORS.light;
    return {
      layout: 'dagre',
      startOnLoad: false,
      // securityLevel strict: labels are sanitized by mermaid; htmlLabels off: plain svg text, which an <img> shows reliably.
      // layout dagre: the library's default for flowcharts is elk, whose 1.6 MB chunk is not shipped (scripts/vendor-mermaid.js).
      securityLevel: 'strict',
      theme: 'base',
      look: 'classic',
      htmlLabels: false,
      fontFamily: FONT,
      themeVariables: {
        darkMode: !!dark,
        background: c.panel, mainBkg: c.node, nodeBkg: c.node, primaryColor: c.node, primaryBorderColor: c.border, nodeBorder: c.border,
        primaryTextColor: c.text, textColor: c.text, nodeTextColor: c.text, titleColor: c.text,
        lineColor: c.line, arrowheadColor: c.line, secondaryColor: c.node, secondaryBorderColor: c.border, secondaryTextColor: c.text,
        tertiaryColor: c.panel, tertiaryBorderColor: c.border, tertiaryTextColor: c.text,
        clusterBkg: c.cluster, clusterBorder: c.border, edgeLabelBackground: c.panel, labelBackground: c.panel,
        noteBkgColor: c.node, noteBorderColor: c.border, noteTextColor: c.text,
        actorBkg: c.node, actorBorder: c.border, actorTextColor: c.text, actorLineColor: c.lifeline,
        signalColor: c.signal, signalTextColor: c.signal, labelBoxBkgColor: c.node, labelBoxBorderColor: c.border, labelTextColor: c.text,
        loopTextColor: c.text, activationBkgColor: c.cluster, activationBorderColor: c.border, sequenceNumberColor: c.node,
        stateBkg: c.node, stateBorder: c.border, specialStateColor: c.special, transitionColor: c.line, transitionLabelColor: c.text,
        compositeBackground: c.cluster, compositeBorder: c.border, compositeTitleBackground: c.node, innerEndBackground: c.special,
        fontFamily: FONT, fontSize: '14px'
      },
      flowchart: { htmlLabels: false, curve: 'linear', padding: 12, useMaxWidth: false },
      sequence: { useMaxWidth: false },
      state: { useMaxWidth: false }
    };
  };
  const loadMermaid = (doc) => {
    if (!mermaidPromise) {
      mermaidPromise = Promise.resolve().then(() => (mermaidLoader || defaultLoader)()).then((mermaid) => {
        // securityLevel strict: labels are sanitized by mermaid; htmlLabels off: plain svg text, which an <img> shows reliably.
        // layout dagre: the library's default for flowcharts is elk, whose 1.6 MB chunk is not shipped (scripts/vendor-mermaid.js).
        return mermaid;
      });
      mermaidPromise.catch(() => { mermaidPromise = null; });
    }
    return mermaidPromise;
  };
  const toImage = (doc, svgText) => {
    const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml').documentElement;
    if (!parsed || parsed.localName !== 'svg') throw new Error('mermaid вернул не svg');
    const box = (parsed.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    const width = Math.max(1, Math.round(box[2] || parseFloat(parsed.getAttribute('width')) || 300));
    const height = Math.max(1, Math.round(box[3] || parseFloat(parsed.getAttribute('height')) || 150));
    parsed.setAttribute('width', String(width));
    parsed.setAttribute('height', String(height));
    parsed.removeAttribute('style'); // mermaid's max-width would crop the standalone picture
    parsed.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const bytes = new TextEncoder().encode(new XMLSerializer().serializeToString(parsed));
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { ok: true, src: `data:image/svg+xml;base64,${btoa(binary)}`, width, height };
  };
  const renderDiagram = (doc, source) => {
    const dark = pageIsDark(doc);
    const key = `${hashSource(source)}${dark ? ':dark' : ''}`;
    if (diagramCache.has(key)) return Promise.resolve(diagramCache.get(key));
    const job = renderChain.then(async () => {
      const id = `mermaid-card-${(diagramCounter += 1)}`;
      let timer = null;
      try {
        const mermaid = await loadMermaid(doc);
        mermaid.initialize(diagramConfig(dark));   // the look follows the page's theme at the moment of drawing
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('превышено время отрисовки')), MERMAID_TIMEOUT_MS); });
        const { svg } = await Promise.race([mermaid.render(id, source), timeout]);
        return { ...toImage(doc, svg), dark };
      } catch (error) {
        return { ok: false, reason: shortReason(error) };
      } finally {
        clearTimeout(timer);
        doc.getElementById(id)?.remove();            // mermaid's temporary nodes
        doc.getElementById(`d${id}`)?.remove();
      }
    });
    renderChain = job.catch(() => {});
    return job.then((result) => { diagramCache.set(key, result); return result; });
  };

  const showDiagram = (wrapper, result) => {
    const holder = wrapper.querySelector(':scope > .code-block-diagram');
    if (!holder) return;
    if (result.ok) {
      const img = wrapper.ownerDocument.createElement('img');
      img.setAttribute('src', result.src);
      img.setAttribute('alt', 'Диаграмма Mermaid');
      img.setAttribute('width', String(result.width));
      img.setAttribute('height', String(result.height));
      holder.replaceChildren(img);
      wrapper.dataset.diagramTheme = result.dark ? 'dark' : 'light';
      wrapper.dataset.diagram = 'ready';
      wrapper.dataset.mode = 'diagram';
    } else {
      wrapper.dataset.diagram = 'failed';
      wrapper.dataset.mode = 'code';
      holder.setAttribute('data-note', `Не удалось отрисовать диаграмму: ${result.reason}`);
      holder.setAttribute('data-failed', '');
    }
  };

  const diagramHook = {
    block(wrapper, pre, lang) {
      if (String(lang).toLowerCase() !== 'mermaid') return;
      const doc = wrapper.ownerDocument;
      wrapper.classList.add('is-diagram');
      const header = wrapper.querySelector(':scope > .code-block-header');
      if (header && !header.querySelector('.code-block-views')) {
        const views = doc.createElement('span');
        views.className = 'code-block-views';
        ['diagram', 'code'].forEach((view) => {
          const button = doc.createElement('button');
          button.type = 'button';
          button.className = 'code-block-view';
          button.setAttribute('data-view', view);
          button.setAttribute('aria-label', view === 'diagram' ? 'Показать диаграмму' : 'Показать код');
          views.appendChild(button);
        });
        header.insertBefore(views, header.querySelector('.code-block-open') || header.querySelector('.code-block-copy'));
      }
      if (!wrapper.querySelector(':scope > .code-block-diagram')) {
        const holder = doc.createElement('div');
        holder.className = 'code-block-diagram';
        wrapper.insertBefore(holder, pre);
      }
      // A wrapper that came back from saved html keeps its data-diagram but not its running render: start again.
      const holderNow = wrapper.querySelector(':scope > .code-block-diagram');
      if ((wrapper.dataset.diagram === 'loading' && !loadingWrappers.has(wrapper))
        || (wrapper.dataset.diagram === 'ready' && !(holderNow && holderNow.querySelector('img')))) delete wrapper.dataset.diagram;
      if (wrapper.dataset.diagram) return; // idempotent: already rendering / ready / failed
      const source = (pre.querySelector('code') || pre).textContent;
      const cached = diagramCache.get(hashSource(source));
      wrapper.dataset.mode = 'code';        // the code shows until the picture is ready
      if (cached) { showDiagram(wrapper, cached); return; }
      wrapper.dataset.diagram = 'loading';
      loadingWrappers.add(wrapper);
      renderDiagram(doc, source).then((result) => { loadingWrappers.delete(wrapper); if (wrapper.isConnected !== false) showDiagram(wrapper, result); });
    }
  };

  let installed = null;
  let onViewClick = null;
  let viewDoc = null;
  function install(doc, selector = PAGE_SELECTOR) {
    if (!installed) {
      installed = codeBlocksRuntime(doc, selector, true, diagramHook);
      onViewClick = (event) => {
        const button = event.target && event.target.closest ? event.target.closest('.code-block-view') : null;
        if (!button) return;
        const wrapper = button.closest('.code-block');
        if (!wrapper || wrapper.dataset.diagram !== 'ready') return; // while loading, or when it failed, only the code exists
        event.preventDefault();
        event.stopPropagation();
        wrapper.dataset.mode = button.getAttribute('data-view') === 'code' ? 'code' : 'diagram';
      };
      doc.addEventListener('click', onViewClick, true);
      viewDoc = doc;
    }
    return installed;
  }
  function dispose() {
    if (installed) installed.dispose();
    if (viewDoc && onViewClick) viewDoc.removeEventListener('click', onViewClick, true);
    installed = null; onViewClick = null; viewDoc = null;
  }
  function setMermaidLoader(loader) { mermaidLoader = typeof loader === 'function' ? loader : null; mermaidPromise = null; diagramCache.clear(); }
  // Explicit call after html was set into a container (idempotent): the page's render paths use it.
  function decorateCodeBlocks(container) {
    return installed ? installed.decorate(container) : 0;
  }

  // The text a card/export builder must take: the output with the code-block furniture unwrapped.
  function unwrapCodeBlocks(container) {
    if (!container || !container.querySelectorAll) return container;
    container.querySelectorAll('.code-block').forEach((wrapper) => {
      const pre = wrapper.querySelector(':scope > pre');
      if (pre) wrapper.replaceWith(pre); else wrapper.remove();
    });
    return container;
  }

  return { install, decorateCodeBlocks, unwrapCodeBlocks, codeBlocksRuntime, setMermaidLoader, dispose, PAGE_SELECTOR, MERMAID_TIMEOUT_MS, diagramConfig, downloadName, extensionOf, previewKind };
});
