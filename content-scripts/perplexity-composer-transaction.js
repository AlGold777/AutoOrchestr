// Perplexity composer ownership and draft-acceptance contract.
(function initPerplexityComposerTransaction(root) {
  'use strict';

  const DEFAULT_SELECTORS = [
    'textarea[data-testid="search-input"]',
    'form[role="search"] textarea',
    'form textarea[placeholder*="Ask" i]',
    '[data-testid*="composer" i] [contenteditable="true"]',
    'form [contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="plaintext-only"]',
    'textarea[placeholder*="question" i]',
    'textarea[placeholder*="вопрос" i]',
    'form textarea'
  ];
  const PROMOTION_PATTERN = /(upgrade|try pro|go pro|perplexity pro|pro plan|subscription|pricing|обновить тариф|подписк|тариф)/i;
  const EXCLUDED_OWNER_SELECTOR = [
    '#llm-notes-sidebar', '.notes-sidebar', '[data-llm-extension]',
    '[data-extension-owned]', '[id^="selectors-"]'
  ].join(',');

  const normalize = (value) => String(value || '').normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

  // 2.81.120: innerText depends on layout and can come back empty or stale in a
  // background tab, which made a correctly inserted draft read as absent. For a
  // contenteditable both projections are valid after normalization, so take
  // whichever actually carries content.
  const read = (element) => {
    if (!element) return '';
    if (typeof element.value === 'string') return element.value;
    const inner = String(element.innerText || '');
    const text = String(element.textContent || '');
    return inner.length >= text.length ? inner : text;
  };

  const promptMatches = (value, prompt) => {
    const actual = normalize(value);
    const expected = normalize(prompt);
    if (!actual || !expected) return false;
    const first = actual.indexOf(expected);
    if (first >= 0) return actual.indexOf(expected, first + expected.length) < 0;
    const width = Math.min(32, Math.max(12, Math.floor(expected.length / 3)));
    const head = expected.slice(0, width);
    const tail = expected.slice(-width);
    const count = (needle) => {
      let hits = 0;
      let offset = 0;
      while (needle && offset <= actual.length - needle.length) {
        const found = actual.indexOf(needle, offset);
        if (found < 0) break;
        hits += 1;
        offset = found + needle.length;
        if (hits > 1) break;
      }
      return hits;
    };
    return count(head) === 1 && count(tail) === 1;
  };

  const promptFingerprint = (prompt = '') => {
    const value = normalize(prompt);
    return `${value.length}:${value.slice(0, 48)}:${value.slice(-48)}`;
  };

  // Content commands are acknowledged before the asynchronous provider
  // transaction finishes. The background retry supervisor can therefore send a
  // second GET_ANSWER while the first request is still preparing the same
  // composer. Keep one transaction per tab and suppress that duplicate before
  // it can clear/insert the prompt again.
  // Dispatch ids look like "<model>:<run start ms>:<n>". A dispatch of a LATER run start than the
  // active one belongs to a later stage: the background never sends it while the earlier request of
  // the same model is unfinished, so the old transaction is a leftover that never settled.
  const runStartOf = (dispatchId) => {
    const match = /:(\d{10,}):/.exec(String(dispatchId || ''));
    return match ? Number(match[1]) : null;
  };
  const createDispatchGate = () => {
    let active = null;
    const begin = ({ dispatchId = null, prompt = '' } = {}) => {
      const fingerprint = promptFingerprint(prompt);
      let supersededDispatchId = null;
      if (active) {
        const sameDispatch = Boolean(dispatchId && active.dispatchId && dispatchId === active.dispatchId);
        const samePrompt = Boolean(fingerprint && fingerprint === active.promptFingerprint);
        const nextRun = runStartOf(dispatchId);
        const activeRun = runStartOf(active.dispatchId);
        // Field report: stage 1's transaction never settled (the page navigated, the wait hung), so
        // stage 2's request was refused as "different request while provider transaction active" and
        // the model dropped out of the run. A newer stage replaces the stale transaction; a parallel
        // duplicate inside the same run is still refused.
        if (!sameDispatch && !samePrompt && nextRun != null && activeRun != null && nextRun > activeRun) {
          supersededDispatchId = active.dispatchId;
          active = null;
        } else {
          return {
            accepted: false,
            duplicate: sameDispatch || samePrompt,
            activeDispatchId: active.dispatchId,
            activeStartedAt: active.startedAt
          };
        }
      }
      const token = Object.freeze({
        dispatchId: dispatchId || null,
        promptFingerprint: fingerprint,
        startedAt: Date.now()
      });
      active = token;
      return { accepted: true, duplicate: false, token, ...(supersededDispatchId ? { supersededDispatchId } : {}) };
    };
    const finish = (token) => {
      if (!token || active !== token) return false;
      active = null;
      return true;
    };
    const snapshot = () => active ? {
      dispatchId: active.dispatchId,
      startedAt: active.startedAt
    } : null;
    return Object.freeze({ begin, finish, snapshot });
  };

  const rectOf = (element) => {
    try { return element?.getBoundingClientRect?.() || null; } catch (_) { return null; }
  };

  const isVisible = (element) => {
    if (!element?.isConnected || element.disabled || element.getAttribute?.('aria-disabled') === 'true') return false;
    const rect = rectOf(element);
    let style = null;
    try { style = (element.ownerDocument?.defaultView || root).getComputedStyle(element); } catch (_) {}
    return Boolean(rect && rect.width > 0 && rect.height > 0
      && style?.display !== 'none' && style?.visibility !== 'hidden');
  };

  const isSendControl = (button) => {
    if (!isVisible(button)) return false;
    const label = [button.getAttribute?.('aria-label'), button.getAttribute?.('title'),
      button.getAttribute?.('data-testid'), button.textContent].filter(Boolean).join(' ');
    return /send|submit|ask|arrow-up|paper-plane|отправ|enviar/i.test(label)
      || String(button.getAttribute?.('type') || '').toLowerCase() === 'submit';
  };

  // 2.81.120: the scope used to collapse to composer.parentElement whenever the
  // editor was not inside a form/search/composer container. Field evidence: the
  // live Perplexity composer reports inForm:false and inSearch:false, its Send
  // control lives further up the tree, so hasSendControl was false on every
  // attempt and a correctly inserted draft could never be accepted. Walk a bounded
  // number of ancestors instead, nearest scope first so the closest Send wins.
  const SEND_CONTROL_MAX_DEPTH = 6;
  const resolveSendControl = (composer) => {
    if (!composer) return null;
    const scopes = [];
    const semanticScope = composer.closest?.('form,[role="search"],[data-testid*="composer" i]');
    if (semanticScope) scopes.push(semanticScope);
    let node = composer.parentElement;
    for (let depth = 0; node && depth < SEND_CONTROL_MAX_DEPTH; depth += 1) {
      if (!scopes.includes(node)) scopes.push(node);
      node = node.parentElement;
    }
    for (const scope of scopes) {
      let buttons = [];
      try { buttons = Array.from(scope.querySelectorAll('button,[role="button"]')); } catch (_) { buttons = []; }
      const found = buttons.find(isSendControl);
      if (found) return found;
    }
    return null;
  };

  const describe = (element, score = null) => {
    const rect = rectOf(element);
    return {
      tag: String(element?.tagName || '').toLowerCase(),
      role: element?.getAttribute?.('role') || null,
      testId: element?.getAttribute?.('data-testid') || null,
      contenteditable: element?.getAttribute?.('contenteditable') || null,
      inForm: !!element?.closest?.('form'),
      inSearch: !!element?.closest?.('[role="search"]'),
      hasSendControl: !!resolveSendControl(element),
      rect: rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null,
      score
    };
  };

  const scoreComposer = (element) => {
    if (!isVisible(element) || element.closest?.(EXCLUDED_OWNER_SELECTOR)) return -Infinity;
    let score = 0;
    if (element.matches?.('textarea[data-testid="search-input"]')) score += 100;
    if (element.closest?.('form[role="search"]')) score += 70;
    if (element.closest?.('[data-testid*="composer" i]')) score += 60;
    if (element.closest?.('form')) score += 35;
    if (resolveSendControl(element)) score += 80;
    if (element.getAttribute?.('role') === 'textbox') score += 20;
    if (element.isContentEditable || element.matches?.('textarea')) score += 15;
    const rect = rectOf(element);
    const viewportHeight = Number(element.ownerDocument?.defaultView?.innerHeight || root.innerHeight || 0);
    if (rect && viewportHeight && rect.top >= viewportHeight * 0.45) score += 20;
    return score;
  };

  const collectCandidates = (doc = root.document, selectors = DEFAULT_SELECTORS) => {
    const unique = new Set();
    selectors.forEach((selector) => {
      try { doc.querySelectorAll(selector).forEach((node) => unique.add(node)); } catch (_) {}
    });
    return Array.from(unique).map((element) => ({ element, score: scoreComposer(element) }))
      .filter((candidate) => Number.isFinite(candidate.score))
      .sort((a, b) => b.score - a.score);
  };

  const resolveComposer = (doc = root.document, selectors = DEFAULT_SELECTORS) => {
    const candidates = collectCandidates(doc, selectors);
    const winner = candidates[0] || null;
    return {
      element: winner?.element || null,
      score: winner?.score ?? null,
      diagnostics: candidates.slice(0, 8).map(({ element, score }) => describe(element, score))
    };
  };

  const ownsPromotionClose = (container, button, doc = root.document) => {
    if (!container || !button || container === doc.body || container === doc.documentElement) return false;
    if (container.querySelector?.(DEFAULT_SELECTORS.join(','))) return false;
    const text = String(container.innerText || container.textContent || '').replace(/\s+/g, ' ').trim();
    if (!PROMOTION_PATTERN.test(text) || text.length > 1800) return false;
    const rect = rectOf(container);
    const buttonRect = rectOf(button);
    if (!rect || !buttonRect || !rect.width || !rect.height || !buttonRect.width || !buttonRect.height) return false;
    const view = doc.defaultView || root;
    const viewportArea = Math.max(1, Number(view.innerWidth || 0) * Number(view.innerHeight || 0));
    const explicitModal = container.matches?.('[role="dialog"],dialog[open],[aria-modal="true"],[data-testid*="modal" i]');
    if (!explicitModal && rect.width * rect.height > viewportArea * 0.6) return false;
    const label = [button.getAttribute?.('aria-label'), button.getAttribute?.('title'),
      button.getAttribute?.('data-testid'), button.innerText, button.textContent]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (/^(close|dismiss|not now|maybe later|закрыть|не сейчас|позже|×|✕)$/i.test(label)) return true;
    const smallIcon = buttonRect.width <= 64 && buttonRect.height <= 64 && !!button.querySelector?.('svg');
    const topRight = buttonRect.left >= rect.left + rect.width * 0.55
      && buttonRect.top <= rect.top + Math.min(110, rect.height * 0.35);
    return smallIcon && topRight;
  };

  const findOwnedPromotionClose = (doc = root.document) => {
    const buttons = Array.from(doc.querySelectorAll('button,[role="button"]'));
    for (const button of buttons) {
      let container = button.parentElement;
      for (let depth = 0; container && depth < 8; depth += 1, container = container.parentElement) {
        if (ownsPromotionClose(container, button, doc)) return { button, container };
      }
    }
    return null;
  };

  const clear = (element) => {
    try { element.focus?.({ preventScroll: true }); } catch (_) { element.focus?.(); }
    if ('value' in element) {
      const proto = Object.getPrototypeOf(element);
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
        || Object.getOwnPropertyDescriptor(root.HTMLTextAreaElement?.prototype || {}, 'value')?.set
        || Object.getOwnPropertyDescriptor(root.HTMLInputElement?.prototype || {}, 'value')?.set;
      if (setter) setter.call(element, ''); else element.value = '';
    } else {
      try {
        const selection = element.ownerDocument?.getSelection?.();
        const range = element.ownerDocument?.createRange?.();
        range?.selectNodeContents(element);
        selection?.removeAllRanges?.();
        if (range) selection?.addRange?.(range);
        element.ownerDocument?.execCommand?.('delete', false, null);
      } catch (_) {}
      if (read(element).trim()) element.textContent = '';
    }
    try { element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null, composed: true })); } catch (_) {}
  };

  const insert = async (element, prompt, options = {}) => {
    const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    if (!element || !prompt) return { ok: false, reason: 'missing_composer_or_prompt' };
    if ('value' in element) clear(element);
    try { element.focus?.({ preventScroll: true }); } catch (_) { element.focus?.(); }
    let method = 'unknown';
    if ('value' in element) {
      const proto = Object.getPrototypeOf(element);
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
        || Object.getOwnPropertyDescriptor(root.HTMLTextAreaElement?.prototype || {}, 'value')?.set
        || Object.getOwnPropertyDescriptor(root.HTMLInputElement?.prototype || {}, 'value')?.set;
      if (setter) setter.call(element, prompt); else element.value = prompt;
      try { element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, composed: true, inputType: 'insertText', data: prompt })); } catch (_) {}
      try { element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: prompt })); } catch (_) {}
      try { element.dispatchEvent(new Event('change', { bubbles: true, composed: true })); } catch (_) {}
      method = 'native_value';
    } else {
      try {
        const doc = element.ownerDocument || root.document;
        const selection = doc.getSelection?.();
        const range = doc.createRange?.();
        range?.selectNodeContents(element);
        selection?.removeAllRanges?.();
        if (range) selection?.addRange?.(range);
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true, cancelable: true, composed: true, inputType: 'insertText', data: prompt
        });
        element.dispatchEvent(beforeInput);
        if (beforeInput.defaultPrevented) {
          await sleep(Number(options.settleMs || 160));
          return { ok: promptMatches(read(element), prompt), method: 'editor_beforeinput', value: read(element) };
        }
        // 2.81.122: execCommand reports success even when the tab holds no focus
        // and nothing was actually inserted. The old guard trusted that return
        // value, so the range fallback never ran and the draft stayed empty.
        // Field evidence: history entries with insertMethod
        // "beforeinput_exec_command" alongside inserted:false, on a tab whose
        // lease had already been released to another provider mid-insert.
        // Verify the content, never the return value.
        doc.execCommand?.('insertText', false, prompt);
        let usedFallback = false;
        if (!promptMatches(read(element), prompt)) {
          const fallbackRange = doc.createRange?.();
          fallbackRange?.selectNodeContents(element);
          fallbackRange?.deleteContents?.();
          fallbackRange?.insertNode?.(doc.createTextNode(prompt));
          usedFallback = true;
        }
        element.dispatchEvent(new InputEvent('input', {
          bubbles: true, composed: true, inputType: 'insertText', data: prompt
        }));
        // Report the path that actually delivered the text: the method name is
        // what made this defect diagnosable in field telemetry.
        method = usedFallback ? 'beforeinput_range' : 'beforeinput_exec_command';
      } catch (_) {
        element.textContent = prompt;
        element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        method = 'dom_fallback';
      }
    }
    await sleep(Number(options.settleMs || 160));
    return promptMatches(read(element), prompt)
      ? { ok: true, method, value: read(element) }
      : { ok: false, method, reason: 'prompt_not_present', value: read(element) };
  };

  const prepare = async ({ doc = root.document, prompt = '', selectors = DEFAULT_SELECTORS,
    attempts = 3, settleMs = 180, sleep, insertStrategy } = {}) => {
    const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const history = [];
    for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
      const resolved = resolveComposer(doc, selectors);
      const composer = resolved.element;
      if (!composer) {
        history.push({ attempt, reason: 'composer_not_found', candidates: resolved.diagnostics });
        await wait(settleMs);
        continue;
      }
      const result = insertStrategy
        ? await insertStrategy(composer, prompt, { attempt, settleMs })
        : await insert(composer, prompt, { sleep: wait, settleMs });
      await wait(settleMs);
      const live = resolveComposer(doc, selectors);
      const acceptedComposer = promptMatches(read(live.element), prompt)
        ? live.element
        : (composer.isConnected && promptMatches(read(composer), prompt) ? composer : null);
      const sendControl = acceptedComposer ? resolveSendControl(acceptedComposer) : null;
      // Frameworks may replace the node during insertion. The current owned
      // editor and its Send control are the proof, not the old node's verdict.
      const accepted = Boolean(acceptedComposer && sendControl && isVisible(sendControl));
      history.push({
        attempt,
        insertMethod: result?.method || null,
        inserted: Boolean(acceptedComposer),
        nodeReplaced: !!live.element && live.element !== composer,
        sendControlReady: !!sendControl && isVisible(sendControl),
        selected: describe(acceptedComposer || live.element || composer, live.score),
        candidates: live.diagnostics
      });
      if (accepted) {
        return { ok: true, method: result?.method || 'live_composer_verified', composer: acceptedComposer, sendControl, history };
      }
      await wait(settleMs);
    }
    const last = history[history.length - 1] || {};
    return {
      ok: false,
      reason: last.inserted ? 'send_control_not_ready' : (last.reason || 'prompt_not_present'),
      history
    };
  };

  const clickSend = (composer, prompt) => {
    if (!isVisible(composer) || !promptMatches(read(composer), prompt)) {
      return {ok: false, reason: 'composer_prompt_mismatch'};
    }
    const control = resolveSendControl(composer);
    if (!control) return {ok: false, reason: 'enabled_send_control_not_found'};
    control.click();
    // A click is an attempt; callers must verify page submission separately.
    return {ok: true, method: 'dom_send_control_click'};
  };

  const api = Object.freeze({
    DEFAULT_SELECTORS,
    normalize,
    read,
    promptMatches,
    createDispatchGate,
    isVisible,
    resolveSendControl,
    clickSend,
    describe,
    scoreComposer,
    collectCandidates,
    resolveComposer,
    ownsPromotionClose,
    findOwnedPromotionClose,
    insert,
    prepare
  });
  root.PerplexityComposerTransaction = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
