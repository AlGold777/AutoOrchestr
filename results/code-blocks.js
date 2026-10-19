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

  function codeBlocksRuntime(doc, containerSelector, observe) {
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
          return;
        }
        const wrapper = doc.createElement('div');
        wrapper.className = WRAP;
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(buildHeader(lang));
        wrapper.appendChild(pre);
        made += 1;
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

    doc.addEventListener('click', async (event) => {
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
    }, true);

    // The pre of an old saved card, of a path that sets html directly, of a later growth of the answer.
    const decorateIn = (node) => {
      if (!node || node.nodeType !== 1) return;
      const owners = [];
      if (node.matches && node.matches(containerSelector)) owners.push(node);
      else if (node.closest && node.closest(containerSelector)) owners.push(node);
      if (node.querySelectorAll) node.querySelectorAll(containerSelector).forEach((el) => owners.push(el));
      owners.forEach(decorate);
    };
    decorateIn(doc.body || doc.documentElement);
    if (observe && win.MutationObserver) {
      let queued = false;
      const pending = new Set();
      new win.MutationObserver((mutations) => {
        mutations.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) pending.add(n); }));
        if (queued || !pending.size) return;
        queued = true;
        win.setTimeout(() => {
          queued = false;
          const nodes = Array.from(pending);
          pending.clear();
          nodes.forEach(decorateIn);
        }, 0);
      }).observe(doc.body || doc.documentElement, { childList: true, subtree: true });
    }
    return { decorate };
  }

  let installed = null;
  function install(doc, selector = PAGE_SELECTOR) {
    if (!installed) installed = codeBlocksRuntime(doc, selector, true);
    return installed;
  }
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

  return { install, decorateCodeBlocks, unwrapCodeBlocks, codeBlocksRuntime, PAGE_SELECTOR };
});
