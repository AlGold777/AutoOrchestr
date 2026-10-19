/** @jest-environment jsdom */
// The sweep up the answer: lazily drawn blocks (diagram placeholders) are materialized by walking the answer upward after the
// generation is confirmed finished; the position is restored; the sweep is no sign of life; user input stops it.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const FAST = { settleMs: 5, settleCapMs: 25, placeholderWaitMs: 40, activeTailMs: 10 };
const LABEL = 'Загрузка диаграммы Mermaid';

let Sweep;
function load() {
  delete window.AnswerMaterializeSweep;
  delete globalThis.__AO_SWEEP_ACTIVE;
  delete globalThis.__AO_SWEEP_COUNT;
  window.eval(read('shared/answer-materialize-sweep.js'));
  Sweep = window.AnswerMaterializeSweep;
}

// A conversation viewport: 3000px of content in a 600px window, blocks at fixed y; a block flagged lazy is a placeholder
// until its y comes into the window (what an IntersectionObserver does on a real page).
function mount(blocks) {
  document.body.innerHTML = '<div id="scroller" style="overflow-y:auto"><div data-message-author-role="assistant" id="answer"></div></div>';
  const scroller = document.getElementById('scroller');
  const answer = document.getElementById('answer');
  let top = 2400; // after the generation the page sits at the bottom
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => 3000 });
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 600 });
  Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => top, set: (v) => { top = Math.max(0, Math.min(2400, v)); } });
  scroller.getClientRects = () => [{}];
  scroller.getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600 });
  const moves = [];
  scroller.scrollTo = ({ top: value }) => { top = Math.max(0, Math.min(2400, value)); moves.push(top); scroller.dispatchEvent(new Event('scroll')); mountVisible(); };
  answer.getBoundingClientRect = () => ({ top: -top, bottom: 3000 - top, left: 0, right: 800, width: 800, height: 3000 });
  blocks.forEach((block, index) => {
    const el = document.createElement('div');
    el.dataset.y = String(block.y);
    if (block.lazy) {
      el.setAttribute('role', 'status');
      el.setAttribute('aria-label', LABEL);
      el.dataset.lazy = '1';
    } else {
      el.setAttribute('data-code-block-preview-pane', 'mermaid');
      el.innerHTML = '<svg viewBox="0 0 10 10"></svg>';
    }
    el.id = `b${index}`;
    answer.appendChild(el);
  });
  answer.insertAdjacentHTML('afterbegin', '<p>First paragraph of the answer.</p>');
  function mountVisible() {
    answer.querySelectorAll('[data-lazy="1"]').forEach((el) => {
      const y = Number(el.dataset.y);
      if (y + 240 > top && y < top + 600) {
        el.removeAttribute('role');
        el.removeAttribute('aria-label');
        el.removeAttribute('data-lazy');
        el.setAttribute('data-code-block-preview-pane', 'mermaid');
        el.innerHTML = '<svg viewBox="0 0 10 10"></svg>';
      }
    });
  }
  // scrollIntoView puts the element in the middle of the window
  answer.querySelectorAll('div').forEach((el) => { el.scrollIntoView = () => scroller.scrollTo({ top: Number(el.dataset.y) - 180 }); });
  return { scroller, answer, moves, top: () => top, mountVisible };
}
const pending = (answer) => answer.querySelectorAll('[role="status"]').length;
const drawn = (answer) => answer.querySelectorAll('[data-code-block-preview-pane] svg').length;

beforeEach(load);
// the previous sweep's "active" tail must be over before the next test counts
afterEach(() => new Promise((resolve) => setTimeout(resolve, 40)));

describe('materialization sweep', () => {
  test('3 placeholders above the view + 2 drawn: all drawn after the sweep, position restored, one report', async () => {
    const page = mount([{ y: 100, lazy: true }, { y: 700, lazy: true }, { y: 1200, lazy: true }, { y: 1800 }, { y: 2300 }]);
    expect(pending(page.answer)).toBe(3);
    const emitted = [];
    const report = await Sweep.run({ answerEl: page.answer, provider: 'GPT', config: FAST, emit: (r) => emitted.push(r) });
    expect(pending(page.answer)).toBe(0);
    expect(drawn(page.answer)).toBe(5);
    expect(page.top()).toBe(2400);
    expect(report).toMatchObject({ provider: 'GPT', placeholdersBefore: 3, placeholdersAfter: 0, changed: true, visible: true, reason: 'done' });
    expect(report.blocksAfter).toBeGreaterThan(report.blocksBefore);
    expect(report.steps).toBeGreaterThan(0);
    expect(report.passes).toBeGreaterThanOrEqual(1);
    expect(report.passes).toBeLessThanOrEqual(2);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(emitted).toEqual([report]);
    expect(Object.keys(report).sort()).toEqual(['blocksAfter', 'blocksBefore', 'changed', 'durationMs', 'heightAfter', 'heightBefore', 'passes', 'placeholdersAfter', 'placeholdersBefore', 'provider', 'reason', 'steps', 'visible']);
  });

  test('steps go upward by about 0.6 of the window and stop when the start of the answer is in view', async () => {
    const page = mount([{ y: 1800 }]);
    await Sweep.run({ answerEl: page.answer, config: FAST });
    const ups = page.moves.slice(0, -1); // the last move is the return
    expect(ups[0]).toBe(2400 - 360);
    ups.slice(1).forEach((value, i) => expect(ups[i] - value).toBeLessThanOrEqual(360));
    expect(page.moves[page.moves.length - 1]).toBe(2400);
  });

  test('a page with nothing to draw: one cheap pass, no change; the next call on the unchanged page is skipped', async () => {
    const page = mount([{ y: 1800 }, { y: 2300 }]);
    const first = await Sweep.run({ answerEl: page.answer, config: FAST });
    expect(first.passes).toBe(1);
    expect(first.changed).toBe(false);
    const second = await Sweep.run({ answerEl: page.answer, config: FAST });
    expect(second.reason).toBe('unchanged_since_last_sweep');
    expect(second.steps).toBe(0);
  });

  test('an answer that fits the window is not walked', async () => {
    const page = mount([{ y: 100 }]);
    Object.defineProperty(page.scroller, 'scrollHeight', { get: () => 600 });
    const report = await Sweep.run({ answerEl: page.answer, config: FAST });
    expect(['fits_viewport', 'no_scroller']).toContain(report.reason); // nothing to scroll
    expect(page.moves).toEqual([]);
  });

  test('the user touching the page stops the sweep at once and the position comes back', async () => {
    const page = mount([{ y: 100, lazy: true }, { y: 700, lazy: true }, { y: 1200, lazy: true }]);
    const promise = Sweep.run({ answerEl: page.answer, config: { ...FAST, settleMs: 30, settleCapMs: 60 } });
    await new Promise((resolve) => setTimeout(resolve, 15));
    document.dispatchEvent(new Event('wheel', { bubbles: true }));
    const report = await promise;
    expect(report.reason).toBe('user_input');
    expect(page.top()).toBe(2400);
    expect(pending(page.answer)).toBeGreaterThan(0); // not finished: it gave way to the user
  });

  test('a page that is not shown (background tab) cannot draw lazy blocks: reported, not pretended', async () => {
    const page = mount([{ y: 100, lazy: true }]);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    const report = await Sweep.run({ answerEl: page.answer, config: FAST });
    delete document.visibilityState;
    expect(report).toMatchObject({ visible: false, reason: 'page_hidden', changed: false, placeholdersBefore: 0 });
    expect(page.moves).toEqual([]);
    expect(pending(page.answer)).toBe(1);
  });

  test('the budget limits the sweep', async () => {
    const page = mount([{ y: 100, lazy: true }, { y: 700, lazy: true }]);
    const report = await Sweep.run({ answerEl: page.answer, config: { ...FAST, budgetMs: 1, settleMs: 20, settleCapMs: 40 } });
    expect(['budget', 'done']).toContain(report.reason);
    expect(page.top()).toBe(2400);
  });

  test('a placeholder that never changes is waited for only a limited time', async () => {
    const page = mount([{ y: 100, lazy: true }]);
    page.answer.querySelector('[data-lazy]').removeAttribute('data-lazy'); // the page will never draw it
    const startedAt = Date.now();
    const report = await Sweep.run({ answerEl: page.answer, config: FAST });
    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(report.placeholdersAfter).toBe(1);
    expect(report.changed).toBe(false);
  });
});

describe('no sign of life', () => {
  test('__AO_SWEEP_ACTIVE is set while it runs and cleared after; activity observers ignore the page while it is set', async () => {
    const page = mount([{ y: 100, lazy: true }]);
    let during = null;
    const seen = [];
    const promise = Sweep.run({ answerEl: page.answer, config: FAST, emit: (r) => { during = globalThis.__AO_SWEEP_ACTIVE; seen.push(r.reason, globalThis.__AO_SWEEP_COUNT); } });
    await promise;
    expect(during).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(globalThis.__AO_SWEEP_ACTIVE).toBe(false);
    expect(read('content-utils/response-lifecycle-detector.js')).toMatch(/new MutationObserver\(\(mutations\) => \{\s*\/\/[^\n]*\n\s*if \(globalThis\.__AO_SWEEP_ACTIVE === true\) return;/);
    expect(read('content-scripts/unified-answer-watcher.js')).toMatch(/if \(globalThis\.__AO_SWEEP_ACTIVE === true\) return;/);
  });

  test('the module sends no messages and touches no heartbeat', () => {
    const source = read('shared/answer-materialize-sweep.js').replace(/\/\/[^\n]*/g, ''); // code only, comments aside
    expect(source).not.toMatch(/sendMessage|heartbeat|Heartbeat|markModelRuntimeActivity|appendCompletionWitness/);
  });
});

describe('wiring', () => {
  test('main path: the gate\'s expandDeferred runs the sweep after forceBottom; Get it runs it right after the bottom nudge, in the focus lock', () => {
    const lifecycle = read('content-utils/response-lifecycle-detector.js');
    expect(lifecycle.indexOf('forceBottom:')).toBeLessThan(lifecycle.indexOf('expandDeferred: async () => {'));
    expect(lifecycle).toContain("emitLifecycleTelemetry('ANSWER_MATERIALIZE_SWEEP'");
    const orchestrator = read('background/job-orchestrator.js');
    expect(orchestrator).toContain('await runMaterializeSweepInTab(llmName, tabId);');
    expect(orchestrator.indexOf('scrollPreparation: results')).toBeGreaterThan(-1);
    expect(orchestrator).toContain("emitTelemetry(llmName, 'ANSWER_MATERIALIZE_SWEEP'");
    const manifest = JSON.parse(read('manifest.json'));
    expect(manifest.content_scripts.some((block) => (block.js || []).includes('shared/answer-materialize-sweep.js'))).toBe(true);
    expect(require('../scripts/build-bundles').COMMON_FILES).toContain('shared/answer-materialize-sweep.js');
  });
});
