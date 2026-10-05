(function initModelSelectionToolbar() {
  if (window.__codexModelSelectionToolbarLoaded) return;
  window.__codexModelSelectionToolbarLoaded = true;

  const STORAGE_KEY = 'llmComparatorFavoriteEntries';
  const TOOLBAR_ID = 'codex-model-selection-toolbar';
  const GAP_PX = 7;
  const OFFSET_X_PX = 14;

  const PLATFORM_MODEL_NAMES = {
    chatgpt: 'GPT',
    claude: 'Claude',
    gemini: 'Gemini',
    grok: 'Grok',
    perplexity: 'Perplexity',
    qwen: 'Qwen',
    deepseek: 'DeepSeek',
    lechat: 'Le Chat',
    zai: 'Z.ai',
    kimi: 'Kimi',
    generic: 'Model'
  };

  const safeStorageGet = (keys) => new Promise((resolve) => {
    try {
      chrome?.storage?.local?.get?.(keys, (result) => resolve(result || {}));
    } catch (_) {
      resolve({});
    }
  });

  const safeStorageSet = (payload) => new Promise((resolve) => {
    try {
      chrome?.storage?.local?.set?.(payload, () => resolve(true));
    } catch (_) {
      resolve(false);
    }
  });

  const detectPlatform = () => window.AnswerPipelineSelectors?.detectPlatform?.() || 'generic';
  const getModelName = () => PLATFORM_MODEL_NAMES[detectPlatform()] || 'Model';
  const getModelKey = () => String(getModelName() || 'Model').trim().toLowerCase().replace(/\s+/g, ' ') || 'model';

  const getPlatformSelectors = () => {
    const platform = detectPlatform();
    return window.AnswerPipelineSelectors?.PLATFORM_SELECTORS?.[platform]
      || window.AnswerPipelineSelectors?.PLATFORM_SELECTORS?.[platform === 'chatgpt' ? 'gpt' : platform]
      || null;
  };

  const splitSelectorList = (selectorValue) => String(selectorValue || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  const getSelectionRootSelectors = () => {
    const selectors = getPlatformSelectors();
    const candidates = [];
    if (selectors?.lastMessage) candidates.push(...splitSelectorList(selectors.lastMessage));
    if (selectors?.response) candidates.push(...splitSelectorList(selectors.response));
    return Array.from(new Set(candidates));
  };

  const normalizeHtml = (html = '') => {
    if (!html) return '';
    if (typeof sanitizeHTML === 'function') return sanitizeHTML(String(html || ''));
    return String(html || '');
  };

  const stripBackgroundColorStyles = (node) => {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node;
    if (el.style && typeof el.style.backgroundColor === 'string') {
      el.style.backgroundColor = '';
      if (typeof el.style.removeProperty === 'function') {
        el.style.removeProperty('background-color');
      }
      if (el.getAttribute?.('style') === '') {
        el.removeAttribute('style');
      }
    }
    Array.from(el.children || []).forEach(stripBackgroundColorStyles);
  };

  const buildSelectionSnapshot = () => {
    const selection = window.getSelection?.();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) return null;
    if (!selection.rangeCount) return null;
    const range = selection.getRangeAt(0).cloneRange();
    const anchor = range.commonAncestorContainer?.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer;
    if (!anchor) return null;

    const selectors = getSelectionRootSelectors();
    const withinResponse = selectors.length
      ? selectors.some((selector) => {
        try {
          return Boolean(anchor.closest?.(selector));
        } catch (_) {
          return false;
        }
      })
      : false;
    if (!withinResponse) return null;

    let html = '';
    try {
      const fragment = range.cloneContents();
      const container = document.createElement('div');
      container.appendChild(fragment);
      html = normalizeHtml(container.innerHTML || '');
    } catch (err) {
      console.warn('[MODEL-SEL] selection html snapshot failed', err);
    }

    return {
      range,
      text: String(selection.toString() || '').trim(),
      html
    };
  };

  const toolbarStyles = `
    #${TOOLBAR_ID} {
      position: fixed;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 5px 6px;
      border: 1px solid rgba(15, 23, 42, 0.16);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.98);
      box-shadow: 0 14px 30px rgba(15, 23, 42, 0.18);
      color: #0f172a;
      font: 600 12px/1.1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transform: translateY(-1px);
      transition: opacity 0.12s ease, transform 0.12s ease, visibility 0s linear 0.12s;
    }
    #${TOOLBAR_ID}.is-visible {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: translateY(0);
      transition: opacity 0.12s ease, transform 0.12s ease;
    }
    #${TOOLBAR_ID} .selection-toolbar-row {
      display: flex;
      align-items: center;
      gap: 4px;
      width: 100%;
    }
    #${TOOLBAR_ID} .selection-toolbar-extra[hidden] { display: none; }
    #${TOOLBAR_ID} .stb.selection-toolbar-toggle {
      box-sizing: border-box;
      width: 30px;
      min-width: 30px;
      padding: 0;
      justify-content: center;
    }
    #${TOOLBAR_ID} .selection-toolbar-chevron {
      display: block;
      flex: none;
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
      pointer-events: none;
      transition: transform 0.15s ease;
    }
    #${TOOLBAR_ID} .selection-toolbar-toggle[aria-expanded="true"] .selection-toolbar-chevron { transform: rotate(180deg); }
    #${TOOLBAR_ID} .stb[data-block="left"] { justify-content: flex-start; padding-left: 8px; }
    #${TOOLBAR_ID} .stb[data-block="right"] { justify-content: flex-end; padding-right: 8px; }
    #${TOOLBAR_ID} .stb {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 30px;
      height: 28px;
      border: 1px solid rgba(148, 163, 184, 0.44);
      border-radius: 8px;
      background: #ffffff;
      color: #334155;
      padding: 0 8px;
      font: inherit;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }
    #${TOOLBAR_ID} .stb:hover {
      border-color: rgba(71, 85, 105, 0.75);
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
    }
    #${TOOLBAR_ID} .stb.col {
      min-width: 18px;
      padding: 0 6px;
      border-color: rgba(148, 163, 184, 0.38);
      color: #111827;
    }
    #${TOOLBAR_ID} .stb.col::before {
      content: "";
      width: 12px;
      height: 12px;
      border-radius: 999px;
      background: var(--swatch-color, #e5e7eb);
      border: 1px solid rgba(15, 23, 42, 0.10);
      display: inline-block;
    }
    #${TOOLBAR_ID} .stb[data-color="#FFEB3B"] { --swatch-color: #FFEB3B; }
    #${TOOLBAR_ID} .stb[data-color="#05e56d"] { --swatch-color: #05e56d; }
    #${TOOLBAR_ID} .stb[data-color="#f44336"] { --swatch-color: #f44336; }
    #${TOOLBAR_ID} .stb[data-clear-highlight]::before {
      content: "";
      width: 12px;
      height: 12px;
      border: 1px solid #64748b;
      border-radius: 2px;
      background: linear-gradient(135deg, transparent 44%, #64748b 45%, #64748b 55%, transparent 56%);
      display: inline-block;
    }
    #${TOOLBAR_ID} .stb[data-cmd="bold"]::before {
      content: "B";
      font-weight: 800;
      font-size: 12px;
      line-height: 1;
    }
    #${TOOLBAR_ID} .stb[data-cmd="italic"]::before {
      content: "I";
      font-style: italic;
      font-weight: 700;
      font-size: 12px;
      line-height: 1;
    }
    #${TOOLBAR_ID} .stb[data-fav]::before {
      content: "☆";
      font-size: 16px;
      line-height: 1;
    }
    #${TOOLBAR_ID} .stb[data-fav].active::before,
    #${TOOLBAR_ID} .stb[data-fav][aria-pressed="true"]::before {
      content: "★";
    }
    #${TOOLBAR_ID} .stb[data-fav].active,
    #${TOOLBAR_ID} .stb[data-fav][aria-pressed="true"] {
      border-color: #1f3b4c;
      color: #1f3b4c;
    }
    #${TOOLBAR_ID} .stb-label {
      font-size: 11px;
      line-height: 1;
      margin-left: 1px;
    }
    #${TOOLBAR_ID} .selection-sep {
      width: 1px;
      height: 14px;
      background: rgba(15, 23, 42, 0.12);
      flex: 0 0 auto;
      margin: 2px 3px;
    }
  `;

  const style = document.createElement('style');
  style.textContent = toolbarStyles;
  document.head.appendChild(style);

  const toolbar = document.createElement('div');
  toolbar.id = TOOLBAR_ID;
  toolbar.setAttribute('aria-hidden', 'true');
  toolbar.innerHTML = `
    <div class="selection-toolbar-row">
    <button type="button" class="stb selection-toolbar-toggle" data-more="1" title="More formatting" aria-label="More formatting" aria-expanded="false" aria-controls="${TOOLBAR_ID}-extra"><svg class="selection-toolbar-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.25 6 4.75 4 4.75-4"/></svg></button>
    <button class="stb" data-clear-highlight="1" title="Remove highlight" aria-label="Remove highlight"><span class="stb-label">No colour</span></button>
    <button class="stb col" data-color="#FFEB3B" title="Yellow highlight" aria-label="Yellow highlight"><span class="stb-label">Yellow</span></button>
    <button class="stb col" data-color="#05e56d" title="Green highlight" aria-label="Green highlight"><span class="stb-label">Green</span></button>
    <button class="stb col" data-color="#f44336" title="Red highlight" aria-label="Red highlight"><span class="stb-label">Red</span></button>
    <div class="selection-sep" aria-hidden="true"></div>
    <button class="stb" data-cmd="bold" title="Bold" aria-label="Bold"><span class="stb-label">Bold</span></button>
    <button class="stb" data-cmd="italic" title="Italic" aria-label="Italic"><span class="stb-label">Italic</span></button>
    <div class="selection-sep" aria-hidden="true"></div>
    <button class="stb" data-fav="1" title="Add selected fragment to favorites" aria-label="Add selected fragment to favorites" aria-pressed="false"><span class="stb-label">Favourite</span></button>
    </div>
    <div class="selection-toolbar-row selection-toolbar-extra" id="${TOOLBAR_ID}-extra" hidden>
      <button type="button" class="stb" data-block="left" title="Align left" aria-label="Align left">≡</button>
      <button type="button" class="stb" data-block="center" title="Align center" aria-label="Align center">≡</button>
      <button type="button" class="stb" data-block="right" title="Align right" aria-label="Align right">≡</button>
      <button type="button" class="stb" data-block="list" title="Bulleted list" aria-label="Bulleted list">☷</button>
      <button type="button" class="stb" data-block="outdent" title="Decrease indent" aria-label="Decrease indent">⇤</button>
      <button type="button" class="stb" data-block="indent" title="Increase indent" aria-label="Increase indent">⇥</button>
    </div>
  `;
  document.body.appendChild(toolbar);

  const selectionState = {
    range: null,
    target: null
  };

  let syncHandle = null;
  let favoriteActivationPending = false;
  let suppressFavoriteClickUntil = 0;

  const setToolbarExtra = (expanded) => {
    const extra = toolbar.querySelector('.selection-toolbar-extra');
    const toggle = toolbar.querySelector('[data-more]');
    const oldHeight = toolbar.offsetHeight;
    extra.hidden = !expanded;
    toggle.setAttribute('aria-expanded', String(expanded));
    if (toolbar.classList.contains('is-visible') && toolbar.style.top) {
      const top = Number.parseFloat(toolbar.style.top) || 0;
      toolbar.style.top = `${Math.max(8, top - (toolbar.offsetHeight - oldHeight))}px`;
    }
  };

  const hideToolbar = () => {
    selectionState.range = null;
    selectionState.target = null;
    toolbar.classList.remove('is-visible');
    toolbar.setAttribute('aria-hidden', 'true');
    setToolbarExtra(false);
  };

  const normalizeSelectionTarget = (node) => {
    let current = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const selectors = getSelectionRootSelectors();
    while (current && current !== document.body && current !== document.documentElement) {
      if (selectors.some((selector) => {
        try { return current.matches?.(selector); } catch (_) { return false; }
      })) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  };

  const setFavoriteButtonState = (isActive) => {
    const button = toolbar.querySelector('[data-fav]');
    if (!button) return;
    button.classList.toggle('active', Boolean(isActive));
    button.setAttribute('aria-pressed', String(Boolean(isActive)));
    button.title = isActive ? 'Remove selected fragment from favorites' : 'Add selected fragment to favorites';
    button.setAttribute('aria-label', button.title);
  };

  const findFavoriteEntryIndex = (entries = [], text = '') => {
    const normalizedText = String(text || '').trim();
    const modelKey = getModelKey();
    return entries.findIndex((entry) => entry?.kind === 'fragment'
      && String(entry.modelKey || '').trim() === modelKey
      && String(entry.text || '').trim() === normalizedText);
  };

  const syncFavoriteButtonState = async (text = '') => {
    const entries = await loadFavoriteEntries();
    setFavoriteButtonState(findFavoriteEntryIndex(entries, text) !== -1);
  };

  const showToolbar = (range, target) => {
    if (!range || !target || range.collapsed) {
      hideToolbar();
      return;
    }
    const rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) {
      hideToolbar();
      return;
    }
    setToolbarExtra(false);
    const toolbarWidth = toolbar.offsetWidth || 220;
    const toolbarHeight = toolbar.offsetHeight || 34;
    let top = rect.top - toolbarHeight - GAP_PX;
    let left = rect.left + (rect.width / 2) - (toolbarWidth / 2) + OFFSET_X_PX;
    top = Math.max(8, top);
    left = Math.max(8, Math.min(left, window.innerWidth - toolbarWidth - 8));
    selectionState.range = range;
    selectionState.target = target;
    toolbar.style.top = `${top}px`;
    toolbar.style.left = `${left}px`;
    toolbar.classList.add('is-visible');
    toolbar.setAttribute('aria-hidden', 'false');
    syncFavoriteButtonState(range.toString()).catch(() => setFavoriteButtonState(false));
  };

  const getSelectionHtml = () => {
    const range = selectionState.range;
    if (!range || range.collapsed) return '';
    try {
      const fragment = range.cloneContents();
      const container = document.createElement('div');
      container.appendChild(fragment);
      return normalizeHtml(container.innerHTML || '').trim();
    } catch (err) {
      console.warn('[MODEL-SEL] selection html failed', err);
      return '';
    }
  };

  const wrapSelectionRange = (tagName, stylePatch = {}) => {
    const range = selectionState.range;
    const target = selectionState.target;
    if (!range || range.collapsed || !target) return false;
    try {
      if (!target.contains(range.startContainer) || !target.contains(range.endContainer)) return false;
      const wrapper = document.createElement(tagName);
      Object.entries(stylePatch).forEach(([key, value]) => {
        wrapper.style[key] = value;
      });
      const fragment = range.extractContents();
      if (Object.prototype.hasOwnProperty.call(stylePatch, 'backgroundColor')) {
        Array.from(fragment.childNodes || []).forEach(stripBackgroundColorStyles);
      }
      wrapper.appendChild(fragment);
      range.insertNode(wrapper);
      window.getSelection?.()?.removeAllRanges?.();
      hideToolbar();
      return true;
    } catch (err) {
      console.warn('[MODEL-SEL] formatting failed', err);
      return false;
    }
  };

  const applySelectionStyle = (command, value = null) => {
    let applied = false;
    if (command === 'hiliteColor') {
      applied = wrapSelectionRange('span', { backgroundColor: value || '#FFEB3B' });
    } else if (command === 'bold') {
      applied = wrapSelectionRange('strong');
    } else if (command === 'italic') {
      applied = wrapSelectionRange('em');
    }

    if (!applied && command && document.queryCommandSupported?.(command)) {
      try {
        const sel = window.getSelection?.();
        sel?.removeAllRanges?.();
        if (selectionState.range) sel?.addRange?.(selectionState.range);
        document.execCommand(command, false, value);
      } catch (_) {}
    }

    window.getSelection?.()?.removeAllRanges?.();
    hideToolbar();
  };

  const applySelectionBlock = (command) => {
    window.SelectionBlockFormat?.apply(selectionState.range, selectionState.target, command);
    window.getSelection?.()?.removeAllRanges?.();
    hideToolbar();
  };

  const clearSelectionHighlight = () => {
    const range = selectionState.range;
    const target = selectionState.target;
    if (!range || range.collapsed || !target) return false;
    const candidates = new Set();
    let current = range.commonAncestorContainer?.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer;
    while (current && current !== target.parentElement) {
      if (current.style?.backgroundColor) candidates.add(current);
      if (current === target) break;
      current = current.parentElement;
    }
    target.querySelectorAll?.('[style*="background"]').forEach((el) => {
      try { if (range.intersectsNode(el)) candidates.add(el); } catch (_) {}
    });
    candidates.forEach((el) => {
      if (!el.style?.backgroundColor) return;
      el.style.removeProperty('background-color');
      if (el.style.color) el.style.removeProperty('color');
      if (el.getAttribute('style') === '') el.removeAttribute('style');
    });
    window.getSelection?.()?.removeAllRanges?.();
    hideToolbar();
    return candidates.size > 0;
  };

  const loadFavoriteEntries = async () => {
    const data = await safeStorageGet([STORAGE_KEY]);
    return Array.isArray(data?.[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
  };

  const toggleFavoriteEntry = async ({ text = '', html = '' } = {}) => {
    const current = await loadFavoriteEntries();
    const index = findFavoriteEntryIndex(current, text);
    if (index !== -1) {
      current.splice(index, 1);
      await safeStorageSet({ [STORAGE_KEY]: current });
      return false;
    }
    const normalizedText = String(text || '').trim();
    const normalizedHtml = normalizeHtml(String(html || '').trim());
    if (!normalizedText && !normalizedHtml) return false;
    current.push({
      id: `fav-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'fragment',
      sourceName: getModelName(),
      modelKey: getModelKey(),
      sourceOutputId: '',
      text: normalizedText,
      html: normalizedHtml,
      timeLabel: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    await safeStorageSet({ [STORAGE_KEY]: current });
    return true;
  };

  const activateFavorite = async () => {
    if (favoriteActivationPending) return;
    const text = selectionState.range?.toString?.() || '';
    const html = getSelectionHtml();
    if (!String(text || '').trim() && !String(html || '').trim()) return;
    favoriteActivationPending = true;
    // The toolbar stays open on purpose: the star is the only feedback that the
    // fragment was stored, so hiding it here would leave the result invisible.
    // It closes on the next click outside, like any other dismissal.
    try {
      const isActive = await toggleFavoriteEntry({ text, html });
      setFavoriteButtonState(isActive);
    } finally {
      favoriteActivationPending = false;
    }
  };

  const scheduleToolbarSync = () => {
    if (syncHandle) cancelAnimationFrame(syncHandle);
    syncHandle = requestAnimationFrame(() => {
      syncHandle = null;
      const snap = buildSelectionSnapshot();
      if (!snap) {
        hideToolbar();
        return;
      }
      const target = normalizeSelectionTarget(snap.range.commonAncestorContainer);
      if (!target) {
        hideToolbar();
        return;
      }
      showToolbar(snap.range, target);
    });
  };

  toolbar.addEventListener('pointerdown', (event) => {
    const favoriteButton = event.target.closest?.('[data-fav]');
    event.preventDefault();
    event.stopPropagation();
    if (!favoriteButton) return;
    suppressFavoriteClickUntil = Date.now() + 750;
    activateFavorite().catch((err) => console.warn('[MODEL-SEL] favorite activation failed', err));
  });

  toolbar.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  toolbar.addEventListener('click', async (event) => {
    const btn = event.target.closest('button');
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    const color = btn.dataset.color || '';
    const cmd = btn.dataset.cmd || '';
    if (btn.dataset.more) {
      setToolbarExtra(toolbar.querySelector('.selection-toolbar-extra').hidden);
      return;
    }
    if (btn.dataset.block) {
      applySelectionBlock(btn.dataset.block);
      return;
    }
    if (btn.dataset.clearHighlight) {
      clearSelectionHighlight();
      return;
    }
    if (color) {
      applySelectionStyle('hiliteColor', color);
      return;
    }
    if (cmd) {
      applySelectionStyle(cmd);
      return;
    }
    if (btn.dataset.fav) {
      if (Date.now() < suppressFavoriteClickUntil) return;
      await activateFavorite();
    }
  });

  document.addEventListener('mouseup', (event) => {
    if (event.target?.closest?.(`#${TOOLBAR_ID}`)) return;
    scheduleToolbarSync();
  }, true);

  document.addEventListener('keyup', (event) => {
    if (event.key !== 'Shift' && event.key !== 'Control' && event.key !== 'Alt' && event.key !== 'Meta') {
      scheduleToolbarSync();
    }
  }, true);

  document.addEventListener('selectionchange', () => {
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(String(document.activeElement.tagName || '').toUpperCase())) return;
    scheduleToolbarSync();
  }, true);

  document.addEventListener('mousedown', (event) => {
    if (event.target?.closest?.(`#${TOOLBAR_ID}`)) return;
    const selectors = getSelectionRootSelectors();
    if (!selectors.length) {
      hideToolbar();
      return;
    }
    if (!event.target?.closest?.(selectors.join(','))) {
      hideToolbar();
    }
  }, true);

  document.addEventListener('click', (event) => {
    if (event.target?.closest?.(`#${TOOLBAR_ID}`)) return;
    const selectors = getSelectionRootSelectors();
    if (!selectors.length) {
      hideToolbar();
      return;
    }
    if (!event.target?.closest?.(selectors.join(','))) {
      hideToolbar();
    }
  }, true);
})();
