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
    unboundedSteps: 12,    // when the start of the answer is unknown: at most this many steps
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

  function findAnswerElement(doc) {
    const all = doc.querySelectorAll(ANSWER_ROLE_SELECTOR);
    return all.length ? all[all.length - 1] : null;
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
      blocksBefore: 0, blocksAfter: 0, placeholdersBefore: 0, placeholdersAfter: 0, changed: false, visible: true, reason: 'done'
    };
    const finish = (reason) => {
      report.reason = reason;
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
    const answerEl = options.answerEl || findAnswerElement(doc);
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
    const answerTopVisible = () => {
      if (!answerEl) return false;
      const rect = answerEl.getBoundingClientRect();
      const frame = isRoot(doc, scroller) ? { top: 0 } : scroller.getBoundingClientRect();
      return rect.top >= frame.top - 4;
    };

    try {
      for (let pass = 0; pass < cfg.maxPasses && !aborted && !over(); pass += 1) {
        const before = signature();
        report.passes += 1;
        // 1. Walk up in steps of a part of the window until the start of the answer is in view.
        const step = Math.max(40, Math.floor(scroller.clientHeight * cfg.stepRatio));
        let stepsDone = 0;
        while (!aborted && !over()) {
          if (answerTopVisible() || getTop() <= minTop() + 1) break;
          if (!answerEl && stepsDone >= cfg.unboundedSteps) break;
          setTop(Math.max(minTop(), getTop() - step));
          report.steps += 1;
          stepsDone += 1;
          await settle();
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
