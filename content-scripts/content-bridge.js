(function () {
  if (window.__ExtMainBridge) return;
  window.__ExtMainBridge = true;
  let bridgeToken = (() => {
    try {
      const raw = '__LLM_BRIDGE_TOKEN__';
      // Inline injection templates the placeholder with the real token. When the
      // file is injected verbatim via chrome.scripting.executeScript (CSP-safe
      // MAIN-world path) the placeholder survives untouched and the token
      // arrives through the one-shot setter below instead.
      const placeholder = ['__LLM_BRIDGE', 'TOKEN__'].join('_');
      return raw === placeholder ? null : raw;
    } catch (_) {
      return null;
    }
  })();
  if (!bridgeToken) {
    // One-shot setter for the file-based MAIN-world injection: the token
    // travels through chrome.scripting args (extension API), never the DOM.
    // Returns false when already consumed, letting the background detect a
    // page script that raced to hijack the setter.
    let tokenConsumed = false;
    window.__LLM_BRIDGE_SET_TOKEN__ = (token) => {
      if (tokenConsumed || typeof token !== 'string' || !token) return false;
      tokenConsumed = true;
      bridgeToken = token;
      try { delete window.__LLM_BRIDGE_SET_TOKEN__; } catch (_) {}
      return true;
    };
  }
  const isTrustedBridgeEvent = (ev) => {
    const detail = ev?.detail && typeof ev.detail === 'object' ? ev.detail : null;
    if (!detail) return false;
    if (!bridgeToken) return false;
    return detail.bridgeToken === bridgeToken && detail.bridgeSource === 'content-script';
  };
  if (window.__RESULTS_TEST_DEBUG__) {
    window.__ExtMainBridgeTestHooks = {
      isTrustedBridgeEvent,
      bridgeToken
    };
  }

  const dataUrlToFile = (item) => {
    try {
      const match = (item?.base64 || '').match(/^data:([^;]+);base64,(.*)$/);
      const base64Part = match ? match[2] : item?.base64 || '';
      const binary = atob(base64Part);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
      return new File([bytes], item.name || 'file', { type: item.type || 'application/octet-stream' });
    } catch (err) {
      console.warn('[MainBridge] dataUrlToFile failed', err);
      return null;
    }
  };

  const toFiles = (arr) => (arr || []).map(dataUrlToFile).filter(Boolean);

  const safeQuery = (root, selector) => {
    try {
      return root.querySelector(selector);
    } catch (_) {
      return null;
    }
  };

  const collectShadowRoots = (root = document, maxRoots = 150) => {
    const roots = [];
    const queue = [root];
    const seen = new Set();
    while (queue.length && roots.length < maxRoots) {
      const current = queue.shift();
      let walker = null;
      try {
        walker = document.createTreeWalker(current, NodeFilter.SHOW_ELEMENT);
      } catch (_) {
        continue;
      }
      let node = walker.currentNode;
      while (node) {
        const shadow = node.shadowRoot;
        if (shadow && !seen.has(shadow)) {
          seen.add(shadow);
          roots.push(shadow);
          if (roots.length >= maxRoots) break;
          queue.push(shadow);
        }
        node = walker.nextNode();
      }
    }
    return roots;
  };

  const querySelectorDeep = (selector, shadowRoots = null) => {
    const direct = safeQuery(document, selector);
    if (direct) return direct;
    const roots = shadowRoots || collectShadowRoots();
    for (const root of roots) {
      const found = safeQuery(root, selector);
      if (found) return found;
    }
    return null;
  };

  const findFirst = (sels = [], shadowRoots = null) => {
    for (const sel of sels) {
      const el = querySelectorDeep(sel, shadowRoots);
      if (el) return el;
    }
    return null;
  };

  const setNativeValue = (el, value) => {
    try {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      const setter = desc && desc.set;
      const ownSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      (ownSetter || setter)?.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {
      try {
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (_) {}
    }
  };

  const dispatchDrop = (el, dt, finishDragLifecycle = false) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect?.() || { left: 0, top: 0, width: 0, height: 0 };
    const coords = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    for (const t of ['dragenter', 'dragover', 'drop']) {
      const ev = new DragEvent(t, Object.assign({ bubbles: true, cancelable: true, dataTransfer: dt }, coords));
      ev.preventDefault?.();
      el.dispatchEvent(ev);
    }
    if (finishDragLifecycle) {
      // ChatGPT keeps its full-composer DRAG&DROP overlay open without leave/end.
      // Qwen consumes drop asynchronously, so it must not receive this cleanup.
      setTimeout(() => {
        for (const t of ['dragleave', 'dragend']) {
          try {
            el.dispatchEvent(new DragEvent(t, Object.assign({ bubbles: true, cancelable: true, dataTransfer: dt }, coords)));
          } catch (_) {}
        }
      }, 0);
    }
    return true;
  };

  window.addEventListener('EXT_ATTACH', (ev) => {
    try {
      if (!isTrustedBridgeEvent(ev)) return;
      const d = ev.detail || {};
      const files = toFiles(d.attachments);
      if (!files.length) return;
      const dt = new DataTransfer();
      files.forEach((f) => dt.items.add(f));
      dt.effectAllowed = 'copy';
      const shadowRoots = collectShadowRoots();

      // Composer fallback when no explicit drop/paste targets were provided.
      const DEFAULT_COMPOSER = ['[contenteditable="true"]', 'textarea', '[role="textbox"]'];
      const mode = d.mode || 'auto';

      const tryDrop = () => {
        const selectors = (d.dropSelectors && d.dropSelectors.length) ? d.dropSelectors : DEFAULT_COMPOSER;
        for (const sel of selectors) {
          const el = querySelectorDeep(sel, shadowRoots);
          if (el && dispatchDrop(el, dt, d.finishDragLifecycle === true)) return true;
        }
        return false;
      };
      const tryInput = () => {
        const attachBtn = findFirst(d.attachSelectors || [], shadowRoots);
        if (attachBtn) { try { attachBtn.click(); } catch (_) {} }
        const fileInput = findFirst(d.inputSelectors || [], shadowRoots)
          || querySelectorDeep('input[type="file"]', shadowRoots);
        if (!fileInput) return false;
        try { fileInput.files = dt.files; } catch (_) {}
        try {
          fileInput.dispatchEvent(new Event('input', { bubbles: true }));
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        } catch (_) {}
        return false;
      };
      const tryPaste = () => {
        const selectors = (d.pasteSelectors && d.pasteSelectors.length)
          ? d.pasteSelectors
          : ((d.dropSelectors && d.dropSelectors.length) ? d.dropSelectors : DEFAULT_COMPOSER);
        const targets = selectors.map((sel) => querySelectorDeep(sel, shadowRoots)).filter(Boolean);
        for (const el of targets) {
          try {
            try { el.focus?.(); } catch (_) {}
            const evPaste = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
            if (!evPaste.clipboardData) {
              Object.defineProperty(evPaste, 'clipboardData', { value: dt });
            }
            // Exactly one paste. This used to fire the same event twice as a
            // blind retry, which on a provider where paste actually works
            // (Kimi) attached the file twice and sent the prompt with two
            // copies of it. Retrying is the cascade's job in
            // attachment-handler.js: it observes whether the file landed and
            // moves to the next delivery vector if it did not.
            el.dispatchEvent(evPaste);
            return true;
          } catch (_) {}
        }
        return false;
      };

      // Explicit per-model mode (GPT → paste, Qwen → drop) takes precedence over
      // the legacy auto order (drop → input → paste).
      if (mode === 'drop') { tryDrop(); return; }
      if (mode === 'paste') { tryPaste(); return; }
      if (mode === 'input') { tryInput(); return; }
      if (tryDrop()) return;
      if (tryInput()) return;
      tryPaste();
    } catch (err) {
      console.warn('[MainBridge] EXT_ATTACH error', err);
    }
  });

  window.addEventListener('EXT_SET_TEXT', (ev) => {
    try {
      if (!isTrustedBridgeEvent(ev)) return;
      const d = ev.detail || {};
      const text = d.text || '';
      const shadowRoots = collectShadowRoots();
      const sel = findFirst(d.selectors || [], shadowRoots);
      if (!sel) return;
      if ('value' in sel) {
        setNativeValue(sel, text);
      } else {
        try { sel.focus?.({ preventScroll: true }); } catch (_) { try { sel.focus?.(); } catch (_) {} }
        const doc = sel.ownerDocument || document;
        const selection = doc.getSelection?.();
        const range = doc.createRange?.();
        range?.selectNodeContents(sel);
        selection?.removeAllRanges?.();
        if (range) selection?.addRange?.(range);
        let editorHandled = false;
        try {
          const beforeInput = new InputEvent('beforeinput', {
            bubbles: true, cancelable: true, composed: true,
            inputType: 'insertReplacementText', data: text
          });
          sel.dispatchEvent(beforeInput);
          editorHandled = beforeInput.defaultPrevented;
        } catch (_) {}
        if (editorHandled) return;
        const inserted = doc.execCommand?.('insertText', false, text) === true;
        if (!inserted && !String(sel.innerText || sel.textContent || '').includes(text)) {
          sel.textContent = text;
        }
        sel.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
        sel.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      }
    } catch (err) {
      console.warn('[MainBridge] EXT_SET_TEXT error', err);
    }
  });
})();
