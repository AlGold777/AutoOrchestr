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

  function codeBlocksRuntime(doc, containerSelector, observe, hooks) {
    const WRAP = 'code-block';
    const HEADER = 'code-block-header';
    const BUTTON = 'code-block-copy';
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
      header.appendChild(button);
      return header;
    };

    // Idempotent: a block already wrapped with its header is left alone; a wrapper whose header was lost
    // (saved html passes through the sanitizer, which removes buttons) gets a new header.
    const decorate = (container) => {
      if (!container || !container.querySelectorAll) return 0;
      let made = 0;
      container.querySelectorAll('pre').forEach((pre) => {
        const parent = pre.parentElement;
        const lang = languageOf(pre);
        if (parent && parent.classList.contains(WRAP)) {
          const header = parent.querySelector(`:scope > .${HEADER}`);
          if (!header || !header.querySelector(`.${BUTTON}`)) {
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

    // The pre of an old saved card, of a path that sets html directly, of a later growth of the answer.
    const decorateIn = (node) => {
      if (!node || node.nodeType !== 1) return;
      const owners = [];
      if (node.matches && node.matches(containerSelector)) owners.push(node);
      else if (node.closest && node.closest(containerSelector)) owners.push(node.closest(containerSelector));
      if (node.querySelectorAll) node.querySelectorAll(containerSelector).forEach((el) => owners.push(el));
      owners.forEach(decorate);
    };
    decorateIn(doc.body || doc.documentElement);
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
          nodes.forEach(decorateIn);
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
  const loadMermaid = (doc) => {
    if (!mermaidPromise) {
      mermaidPromise = Promise.resolve().then(() => (mermaidLoader || defaultLoader)()).then((mermaid) => {
        // securityLevel strict: labels are sanitized by mermaid; htmlLabels off: plain svg text, which an <img> shows reliably.
        // layout dagre: the library's default for flowcharts is elk, whose 1.6 MB chunk is not shipped (scripts/vendor-mermaid.js).
        mermaid.initialize({ layout: 'dagre', startOnLoad: false, securityLevel: 'strict', theme: pageIsDark(doc) ? 'dark' : 'default', htmlLabels: false, flowchart: { htmlLabels: false } });
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
    const key = hashSource(source);
    if (diagramCache.has(key)) return Promise.resolve(diagramCache.get(key));
    const job = renderChain.then(async () => {
      const id = `mermaid-card-${(diagramCounter += 1)}`;
      let timer = null;
      try {
        const mermaid = await loadMermaid(doc);
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('превышено время отрисовки')), MERMAID_TIMEOUT_MS); });
        const { svg } = await Promise.race([mermaid.render(id, source), timeout]);
        return toImage(doc, svg);
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
        header.insertBefore(views, header.querySelector('.code-block-copy'));
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

  return { install, decorateCodeBlocks, unwrapCodeBlocks, codeBlocksRuntime, setMermaidLoader, dispose, PAGE_SELECTOR, MERMAID_TIMEOUT_MS };
});
