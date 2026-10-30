/** @jest-environment node */
/**
 * Real Chrome, a DeepSeek-like VIRTUAL list (div.ds-scroll-area > ds-virtual-list-item mounted and unmounted while scrolling; the last
 * turn holds the user's message, the reasoning and the answer .ds-markdown.ds-assistant-message-main-content). The upward pass of a
 * manual pull (force) finds the scroller and the answer, climbs to the start of the answer although the answer node is unmounted and
 * mounted again on the way, and comes back; the report says why it stopped. A tab that reports "hidden" for a moment is waited for.
 * RUN_HTML_EXPORT_BROWSER_TESTS=1 (system Chrome).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const run = process.env.RUN_HTML_EXPORT_BROWSER_TESTS === '1' ? test : test.skip;

const PAGE = `<style>body{margin:0}.ds-scroll-area{height:800px;overflow-y:auto;position:relative}.spacer{position:relative;height:28000px}
  .ds-virtual-list-item{position:absolute;left:0;right:0}.ds-message{box-sizing:border-box}</style>
  <main><div class="ds-virtual-list"><div class="ds-scroll-area" id="area"><div class="spacer" id="spacer"></div></div></div></main>`;

run.each([[false], [true]])('Chrome: a virtual list (the answer node re-created on every scroll: %s): the pass reaches the start of the last answer and returns', async (remount) => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    await page.addInitScript(() => { window.chrome = { runtime: { id: 'x', sendMessage() {} } }; });
    await page.setContent(PAGE);
    for (const file of ['shared/answer-markdown.js', 'shared/answer-markdown-blocks.js', 'shared/answer-markdown-extras.js', 'shared/answer-markdown-providers.js',
      'content-scripts/answer-html-builder.js', 'content-scripts/answer-pipeline-selectors.js', 'shared/answer-materialize-sweep.js']) await page.addScriptTag({ content: read(file) });
    const result = await page.evaluate(async (remount) => {
      const area = document.getElementById('area');
      const spacer = document.getElementById('spacer');
      // 40 earlier turns of 560px, then the last turn (user 200 + reasoning 400 + answer 5000) at y = 22400
      const items = [];
      for (let i = 0; i < 40; i += 1) items.push({ top: i * 560, height: 560, html: `<div class="ds-message x${i}"><p>Question ${i}</p></div><div class="ds-message"><div class="ds-markdown ds-assistant-message-main-content"><p>Old ${i}</p></div></div>` });
      const LAST_TOP = 22400;
      items.push({ top: LAST_TOP, height: 5600, html: `<div class="ds-message d29f3d7d" style="height:200px"><p>The prompt</p></div>
        <div class="ds-message"><div class="_74c0879" style="height:400px"><div class="ds-think-content"><div class="ds-markdown"><p>reasoning</p></div></div></div>
        <div class="ds-markdown ds-assistant-message-main-content" id="last-answer" style="height:5000px"><p>The answer</p></div></div>` });
      const mounted = new Map();
      let unmounts = 0;
      const sync = () => {
        const lo = area.scrollTop - 800; const hi = area.scrollTop + 1600;
        items.forEach((item, index) => {
          const visible = item.top + item.height > lo && item.top < hi;
          // a virtual list may drop and re-create a node it already holds: the old node is detached and reads as all zeros
          if (remount && visible && mounted.has(index) && index === items.length - 1) { mounted.get(index).remove(); mounted.delete(index); unmounts += 1; }
          if (visible && !mounted.has(index)) {
            const el = document.createElement('div');
            el.className = 'ds-virtual-list-item';
            el.style.cssText = `top:${item.top}px;height:${item.height}px`;
            el.innerHTML = item.html;
            spacer.appendChild(el); mounted.set(index, el);
          } else if (!visible && mounted.has(index)) { mounted.get(index).remove(); mounted.delete(index); unmounts += 1; }
        });
      };
      area.addEventListener('scroll', sync);
      area.scrollTop = area.scrollHeight; sync();
      const startTop = area.scrollTop;
      const answerTop = LAST_TOP + 200 + 400;
      let lowest = startTop;
      const trail = []; area.addEventListener('scroll', () => { lowest = Math.min(lowest, area.scrollTop); trail.push(Math.round(area.scrollTop)); });
      const emitted = [];
      const report = await window.AnswerMaterializeSweep.run({ provider: 'DeepSeek', force: true, emit: (r) => emitted.push(r.reason), config: { settleMs: 40, settleCapMs: 150, activeTailMs: 10 } });
      await new Promise((r) => setTimeout(r, 100));
      return { trail: trail.slice(0, 40), report, startTop, endTop: area.scrollTop, lowest, answerTop, unmounts, emitted };
    }, remount);
    if (process.env.DBG) console.log(JSON.stringify({ trail: result.trail, steps: result.report.steps, stoppedBy: result.report.stoppedBy, reason: result.report.reason }));
    expect(result.report.answerFound).toBe(true);
    expect(result.report.stoppedBy).toBe('answer_top');
    expect(result.lowest).toBeGreaterThanOrEqual(result.answerTop - 800 * 0.25 - 2);
    expect(result.lowest).toBeLessThan(result.answerTop + 800);
    expect(result.endTop).toBe(result.startTop);
    expect(result.emitted).toHaveLength(1);
    if (remount) expect(result.unmounts).toBeGreaterThan(2);
  } finally {
    await browser.close();
  }
}, 90000);

run('Chrome: a tab that is "hidden" for a moment after activation is waited for, not given up on', async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    await page.addInitScript(() => { window.chrome = { runtime: { id: 'x', sendMessage() {} } }; });
    await page.setContent(`<style>#s{height:600px;overflow:auto}</style><main><div id="s"><div data-message-author-role="assistant" id="a" style="height:3000px"><p>x</p></div></div></main>`);
    await page.addScriptTag({ content: read('shared/answer-materialize-sweep.js') });
    const out = await page.evaluate(async () => {
      let hidden = true;
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
      setTimeout(() => { hidden = false; }, 150);
      document.getElementById('s').scrollTop = 99999;
      return window.AnswerMaterializeSweep.run({ provider: 'GPT', force: true, config: { settleMs: 20, settleCapMs: 60, activeTailMs: 5 } });
    });
    expect(out.visible).toBe(true);
    expect(out.reason).not.toBe('page_hidden');
    expect(out.steps).toBeGreaterThan(0);
  } finally {
    await browser.close();
  }
}, 60000);
