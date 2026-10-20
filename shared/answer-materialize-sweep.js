// shared/answer-materialize-sweep.js
// "Sweep up the answer": a model page draws some blocks of an answer (Mermaid diagrams, code previews, images) only when they
// come into view. After the generation is confirmed finished and the page was pulled down, the answer is walked upward to its start
// so that those blocks are drawn, then the position is restored; the extraction that follows sees them.
//
// Observer effect: the sweep is NOT a sign of life. It sends no heartbeat/progress; while it runs (and shortly after)
// globalThis.__AO_SWEEP_ACTIVE is true, which activity detectors must ignore. It only reads the DOM and moves the scroll position.
// It stops at once when the user scrolls, types or touches the page, and puts the position back.
(function initAnswerMaterializeSweep(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AnswerMaterializeSweep = api;
})(typeof window !== 'undefined' ? window : globalThis, function factory() {
  'use strict';

  const DEFAULTS = Object.freeze({
    budgetMs: 10000,       // per model, all passes together
    maxPasses: 2,
    stepRatio: 0.6,        // a step = 60% of the window height
    settleMs: 250,         // DOM quiet time after a step
    settleCapMs: 600,      // the longest wait for that quiet
    placeholderWaitMs: 1500,
    unknownSteps: 3,       // when the start of the answer is unknown: at most this many steps (~1.8 windows), never "to the page start"
    topReserve: 0.25,      // the walk may stop this part of the window BEFORE the start of the answer
    activeTailMs: 400      // __AO_SWEEP_ACTIVE stays true this long after the end
  });
  // An "unripe" block: a status placeholder the page replaces when the block is drawn.
  const UNRIPE_LABEL_RE = /загрузк|loading|диаграмм|diagram|rendering|mermaid|отрисов/i;
  const BLOCK_SELECTOR = 'p, li, pre, table, blockquote, h1, h2, h3, h4, svg, img, canvas, iframe, [data-code-block-preview-pane], [data-mermaid]';
  const ANSWER_ROLE_SELECTOR = '[data-message-author-role="assistant"], [data-role="assistant"], [data-author-role="assistant"]';
  const USER_EVENTS = ['wheel', 'touchstart', 'keydown', 'mousedown'];

  const isUnripe = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const status = el.getAttribute('role') === 'status' || el.getAttribute('aria-busy') === 'true';
    if (!status) return false;
    const label = `${el.getAttribute('aria-label') || ''} ${(el.textContent || '').slice(0, 80)}`;
    return UNRIPE_LABEL_RE.test(label) && !el.querySelector('svg, img, canvas, pre');
  };
  const unripeIn = (scope) => Array.from(scope.querySelectorAll('[role="status"], [aria-busy="true"]')).filter(isUnripe);
  const countBlocks = (scope) => scope.querySelectorAll(BLOCK_SELECTOR).length;

  const isRoot = (doc, node) => node === doc.body || node === doc.documentElement || node === doc.scrollingElement;
  const isReverse = (win, node) => { try { return win.getComputedStyle(node).flexDirection === 'column-reverse'; } catch (_) { return false; } };

  // The scrolling ancestor of the answer; without an answer element the conversation viewport (the largest scrollable under main).
  function findScroller(doc, answerEl) {
    const win = doc.defaultView;
    const scrollable = (node) => {
      if (!node || isRoot(doc, node)) return false;
      if (!(node.scrollHeight - node.clientHeight > 4)) return false;
      const style = win.getComputedStyle(node);
      return /(auto|scroll|overlay)/.test(style.overflowY) && node.getClientRects().length > 0;
    };
    if (answerEl) {
      for (let node = answerEl.parentElement; node; node = node.parentElement) if (scrollable(node)) return node;
    } else {
      const pool = Array.from(doc.querySelectorAll('main *, [role="main"] *, main, [role="main"]'))
        .filter((node) => scrollable(node) && !node.closest('nav, aside, pre, [role="navigation"], [role="listbox"]'));
      pool.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
      if (pool[0]) return pool[0];
    }
    const rootEl = doc.scrollingElement || doc.documentElement;
    return rootEl && rootEl.scrollHeight - rootEl.clientHeight > 4 ? rootEl : null;
  }

  // The LAST answer of the page. The same choice as the answer collection: the provider's own selectors of
  // AnswerPipelineSelectors (messageRoot), minus the user's message, the reasoning block and page-level containers
  // (AnswerHtmlBuilder), widened to the whole turn (expandToTurn); without them the general marks of an answer.
  const PROVIDER_KEYS = { gpt: 'chatgpt', chatgpt: 'chatgpt', claude: 'claude', gemini: 'gemini', grok: 'grok', perplexity: 'perplexity', qwen: 'qwen',
    deepseek: 'deepseek', lechat: 'lechat', mistral: 'lechat', zai: 'zai', kimi: 'kimi' };
  const GENERIC_ANSWER_SELECTORS = [ANSWER_ROLE_SELECTOR, '[data-testid*="assistant" i]', '[class*="assistant" i][class*="message" i]', 'model-response',
    '[role="article"]', '.markdown, .prose'];
  const lastInDocument = (list) => list.reduce((best, node) => (!best || (best.compareDocumentPosition(node) & 4 /* FOLLOWING */) ? node : best), null);
  function findAnswerElement(doc, provider) {
    const win = doc.defaultView || globalThis;
    const builder = win.AnswerHtmlBuilder || globalThis.AnswerHtmlBuilder || null;
    const platform = (win.AnswerPipelineSelectors || globalThis.AnswerPipelineSelectors || {}).PLATFORM_SELECTORS || {};
    const key = PROVIDER_KEYS[String(provider || '').toLowerCase().replace(/[^a-z]/g, '')] || '';
    const accepted = (node) => {
      try {
        if (node.closest('textarea, input, button, nav, header, footer, form, [contenteditable="true"], [hidden], [inert], [aria-hidden="true"], [data-message-author-role="user"], [data-role="user"]')) return false;
        if (!builder) return true;
        if (builder.insideUserMessage && builder.insideUserMessage(node)) return false;
        if (builder.insideReasoning && builder.insideReasoning(node)) return false;
        if (builder.containsUserMessage && builder.containsUserMessage(node)) return false;
        if (builder.hasMessageTwins && builder.hasMessageTwins(node)) return false;
        return true;
      } catch (_) { return false; }
    };
    const collect = (selector) => {
      try { return Array.from(doc.querySelectorAll(selector)).filter(accepted); } catch (_) { return []; }
    };
    const lists = [];
    if (key && platform[key] && platform[key].messageRoot) lists.push(platform[key].messageRoot);
    GENERIC_ANSWER_SELECTORS.forEach((selector) => lists.push(selector));
    for (const selector of lists) {
      let found = collect(selector);
      // an outer node that holds another candidate is a container, not the answer
      found = found.filter((outer) => !found.some((inner) => inner !== outer && outer.contains(inner)));
      const best = lastInDocument(found);
      if (!best) continue;
      if (builder && typeof builder.expandToTurn === 'function') {
        try {
          const peers = found.filter((node) => node !== best).slice(-8);
          const turn = builder.expandToTurn(best, peers);
          // A widening that swallows several turns (the user's question not recognised as a boundary) is not the answer's turn:
          // the walk would reach far above it. Allowed: a few blocks of the same turn, not much more text than the node itself.
          const grew = turn && turn.node && turn.node !== best
            ? (turn.node.textContent || '').length > (best.textContent || '').length * 3 + 2000 : false;
          if (turn && turn.status !== 'split' && turn.node && !grew && accepted(turn.node)) return turn.node;
        } catch (_) { /* the node itself */ }
      }
      return best;
    }
    return null;
  }

  // The state each answer element had when the last sweep ended: an unchanged page is not walked again.
  const lastSweepState = new WeakMap();

  async function run(options = {}) {
    const doc = options.doc || (typeof document !== 'undefined' ? document : null);
    const win = doc && doc.defaultView;
    const cfg = { ...DEFAULTS, ...(options.config || {}) };
    const startedAt = Date.now();
    const report = {
      provider: options.provider || null, passes: 0, steps: 0, durationMs: 0, heightBefore: 0, heightAfter: 0,
      blocksBefore: 0, blocksAfter: 0, placeholdersBefore: 0, placeholdersAfter: 0, changed: false, visible: true, reason: 'done',
      answerFound: false, answerHeight: 0, scrolledPx: 0, stoppedBy: null
    };
    const finish = (reason) => {
      report.reason = reason;
      if (!report.stoppedBy) report.stoppedBy = 'none';
      report.durationMs = Date.now() - startedAt;
      try { if (typeof options.emit === 'function') options.emit(report); } catch (_) { /* telemetry only */ }
      return report;
    };
    if (!doc || !win) return finish('no_document');
    // A page that is not shown does not draw lazy blocks (no intersections): say so, do not pretend.
    if (doc.visibilityState === 'hidden') {
      report.visible = false;
      return finish('page_hidden');
    }
    // The element the caller tracks may be only one block of the last turn: when the resolver finds the turn around it, use that.
    let answerEl = options.answerEl || null;
    const resolved = findAnswerElement(doc, options.provider);
    if (!answerEl) answerEl = resolved;
    else if (resolved && resolved !== answerEl && resolved.contains(answerEl)) answerEl = resolved;
    report.answerFound = !!answerEl;
    report.answerHeight = answerEl ? Math.round(answerEl.getBoundingClientRect().height) : 0;
    const scroller = findScroller(doc, answerEl);
    const scope = answerEl || scroller || doc.body;
    report.placeholdersBefore = unripeIn(scope).length;
    report.blocksBefore = countBlocks(scope);
    if (!scroller) {
      report.heightBefore = report.heightAfter = 0;
      report.blocksAfter = report.blocksBefore;
      report.placeholdersAfter = report.placeholdersBefore;
      return finish('no_scroller');
    }
    const reverse = !isRoot(doc, scroller) && isReverse(win, scroller);
    const getTop = () => (isRoot(doc, scroller) ? Number(win.scrollY || scroller.scrollTop || 0) : scroller.scrollTop);
    const setTop = (value) => {
      if (isRoot(doc, scroller)) win.scrollTo({ top: Math.max(0, value), behavior: 'instant' });
      else scroller.scrollTo({ top: value, behavior: 'instant' });
    };
    const minTop = () => (reverse ? -(scroller.scrollHeight - scroller.clientHeight) : 0);
    report.heightBefore = scroller.scrollHeight;
    const stateKey = `${scroller.scrollHeight}|${countBlocks(scope)}|${unripeIn(scope).length}`;
    if (answerEl && lastSweepState.get(answerEl) === stateKey) {
      report.heightAfter = report.heightBefore;
      report.blocksAfter = report.blocksBefore;
      report.placeholdersAfter = report.placeholdersBefore;
      return finish('unchanged_since_last_sweep');
    }
    // The answer fits the window: nothing can be outside the view.
    if (scroller.scrollHeight - scroller.clientHeight <= 4) {
      report.heightAfter = report.heightBefore;
      report.blocksAfter = report.blocksBefore;
      report.placeholdersAfter = report.placeholdersBefore;
      report.stoppedBy = 'fits_viewport';
      return finish('fits_viewport');
    }

    const savedTop = getTop();
    let aborted = false;
    const onUser = () => { aborted = true; };
    USER_EVENTS.forEach((name) => doc.addEventListener(name, onUser, { capture: true, passive: true }));
    root_setActive(true);
    const over = () => Date.now() - startedAt > cfg.budgetMs;
    const sleep = (ms) => new Promise((resolve) => win.setTimeout(resolve, ms));
    // Read-only observation: resolves when the DOM was quiet for settleMs (or after the cap).
    const settle = () => new Promise((resolve) => {
      let timer = null;
      let observer = null;
      const done = () => { if (observer) observer.disconnect(); win.clearTimeout(timer); win.clearTimeout(cap); resolve(); };
      const cap = win.setTimeout(done, cfg.settleCapMs);
      const arm = () => { win.clearTimeout(timer); timer = win.setTimeout(done, cfg.settleMs); };
      if (win.MutationObserver) { observer = new win.MutationObserver(arm); observer.observe(scope, { childList: true, subtree: true, attributes: true }); }
      arm();
    });
    const signature = () => `${scroller.scrollHeight}|${countBlocks(scope)}|${unripeIn(scope).length}`;
    const frameTop = () => (isRoot(doc, scroller) ? 0 : scroller.getBoundingClientRect().top);
    // The start of the answer is in the window (it may be above the top by at most the reserve).
    const answerTopVisible = () => {
      if (!answerEl) return false;
      return answerEl.getBoundingClientRect().top >= frameTop() - cfg.topReserve * scroller.clientHeight;
    };
    let lowest = savedTop;  // the smallest scroll position reached (the farthest walk up)

    try {
      for (let pass = 0; pass < cfg.maxPasses && !aborted && !over(); pass += 1) {
        const before = signature();
        report.passes += 1;
        // 1. Walk up in steps of a part of the window until the start of the answer is in view.
        const step = Math.max(40, Math.floor(scroller.clientHeight * cfg.stepRatio));
        let stepsDone = 0;
        // With the answer known: no more steps than its distance needs (+2); unknown: a few steps, never "to the page start".
        const stepCap = answerEl
          ? Math.ceil(Math.max(0, frameTop() - answerEl.getBoundingClientRect().top) / step) + 2
          : cfg.unknownSteps;
        while (!aborted && !over()) {
          if (answerTopVisible()) { report.stoppedBy = report.stoppedBy || 'answer_top'; break; }
          if (getTop() <= minTop() + 1) { report.stoppedBy = report.stoppedBy || 'answer_top'; break; }
          if (stepsDone >= stepCap) { report.stoppedBy = answerEl ? 'answer_top' : 'unknown_cap'; break; }
          setTop(Math.max(minTop(), getTop() - step));
          lowest = Math.min(lowest, getTop());
          report.steps += 1;
          stepsDone += 1;
          await settle();
        }
        // After the last step the start of the answer must not stay above the window: bring it to the top edge (no overshoot).
        if (answerEl && !aborted) {
          const delta = answerEl.getBoundingClientRect().top - frameTop();
          if (delta < -2) { setTop(getTop() + delta); lowest = Math.min(lowest, getTop()); }
        }
        // 2. Bring every still-unripe placeholder into the middle of the view and wait until the page replaces it.
        for (const placeholder of unripeIn(scope)) {
          if (aborted || over()) break;
          try { placeholder.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (_) { /* not scrollable */ }
          const waitStart = Date.now();
          while (!aborted && !over() && Date.now() - waitStart < cfg.placeholderWaitMs && placeholder.isConnected && isUnripe(placeholder)) {
            await sleep(100);
          }
        }
        await settle();
        // Another pass only while something changed (height, number of blocks, unripe placeholders).
        if (signature() === before) break;
      }
    } finally {
      try { setTop(savedTop); } catch (_) { /* detached */ }
      USER_EVENTS.forEach((name) => doc.removeEventListener(name, onUser, true));
      win.setTimeout(() => root_setActive(false), cfg.activeTailMs);
    }
    report.scrolledPx = Math.max(0, Math.round(savedTop - lowest));
    if (!report.stoppedBy) report.stoppedBy = aborted ? 'user_input' : (over() ? 'budget' : (answerEl ? 'answer_top' : 'unknown_cap'));
    else if (aborted) report.stoppedBy = 'user_input';
    else if (over()) report.stoppedBy = 'budget';
    if (!answerEl) report.note = 'answer_start_unknown';
    report.heightAfter = scroller.scrollHeight;
    report.blocksAfter = countBlocks(scope);
    report.placeholdersAfter = unripeIn(scope).length;
    if (answerEl && !aborted) lastSweepState.set(answerEl, `${report.heightAfter}|${report.blocksAfter}|${report.placeholdersAfter}`);
    report.changed = report.heightAfter !== report.heightBefore || report.blocksAfter !== report.blocksBefore
      || report.placeholdersAfter !== report.placeholdersBefore;
    return finish(aborted ? 'user_input' : (over() ? 'budget' : 'done'));
  }

  // activity detectors read this flag and ignore DOM changes while it is set
  // (a counter on the global, shared by every copy of this module that a tab may hold)
  function root_setActive(on) {
    globalThis.__AO_SWEEP_COUNT = Math.max(0, Number(globalThis.__AO_SWEEP_COUNT || 0) + (on ? 1 : -1));
    globalThis.__AO_SWEEP_ACTIVE = globalThis.__AO_SWEEP_COUNT > 0;
  }

  return { run, isUnripe, unripeIn, findScroller, findAnswerElement, DEFAULTS, UNRIPE_LABEL_RE };
});
