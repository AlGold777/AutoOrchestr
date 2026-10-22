/** @jest-environment node */
/**
 * Real Chrome: blocks that a page mounts through IntersectionObserver (as ChatGPT does for Mermaid) exist only after the
 * sweep up the answer; without the sweep they stay placeholders. RUN_HTML_EXPORT_BROWSER_TESTS=1 (system Chrome).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const run = process.env.RUN_HTML_EXPORT_BROWSER_TESTS === '1' ? test : test.skip;

const PAGE = `<style>body{margin:0}#scroller{height:300px;overflow-y:auto;border:1px solid #ccc}.slot{height:250px}</style>
<div id="scroller"><div data-message-author-role="assistant" id="answer">
  <p>Intro paragraph.</p>
  ${Array.from({ length: 6 }, (_, i) => `<div class="slot" data-n="${i}"><div role="status" aria-label="Загрузка диаграммы Mermaid" style="height:240px"></div></div>`).join('')}
  <p>Closing paragraph.</p></div></div>
<script>
  // what the page does: a placeholder becomes a drawn diagram when it comes into view
  const io = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    const holder = entry.target;
    io.unobserve(holder);
    holder.innerHTML = '<div data-code-block-preview-pane="mermaid" style="height:240px"><svg viewBox="0 0 100 50" width="100" height="50"><rect width="100" height="50"/></svg></div>';
  }), { root: document.getElementById('scroller') });
  document.querySelectorAll('.slot').forEach((slot) => io.observe(slot));
  const scroller = document.getElementById('scroller');
  // the generation just ended: the page is at the bottom
  scroller.scrollTop = scroller.scrollHeight;
</script>`;

const drawn = (page) => page.evaluate(() => document.querySelectorAll('#answer [data-code-block-preview-pane] svg').length);
const pending = (page) => page.evaluate(() => document.querySelectorAll('#answer [role="status"]').length);

async function open(browser) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.setContent(PAGE);
  await page.waitForTimeout(300); // let the observer draw what is in view at the bottom
  return page;
}

run('Chrome: without the sweep the diagrams above the view stay placeholders; with it they are all drawn and the position comes back', async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const without = await open(browser);
    const stuck = await pending(without);
    expect(stuck).toBeGreaterThan(0);          // the real situation: only the last blocks exist
    expect(await drawn(without)).toBeLessThan(6);

    const page = await open(browser);
    await page.addScriptTag({ content: read('shared/answer-materialize-sweep.js') });
    const before = await page.evaluate(() => document.getElementById('scroller').scrollTop);
    const report = await page.evaluate(() => window.AnswerMaterializeSweep.run({ provider: 'GPT' }));
    expect(report.visible).toBe(true);
    expect(report.reason).toBe('done');
    expect(report.changed).toBe(true);
    expect(report.placeholdersBefore).toBeGreaterThan(0);
    expect(report.placeholdersAfter).toBe(0);
    expect(report.durationMs).toBeLessThan(10000);
    expect(await pending(page)).toBe(0);
    expect(await drawn(page)).toBe(6);
    expect(await page.evaluate(() => document.getElementById('scroller').scrollTop)).toBe(before);   // position restored (the bottom)
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => globalThis.__AO_SWEEP_ACTIVE)).toBe(false);
  } finally {
    await browser.close();
  }
}, 120000);

run('Chrome: the user scrolling during the sweep stops it and the position comes back', async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await open(browser);
    await page.addScriptTag({ content: read('shared/answer-materialize-sweep.js') });
    const before = await page.evaluate(() => document.getElementById('scroller').scrollTop);
    const reportPromise = page.evaluate(() => window.AnswerMaterializeSweep.run({ provider: 'GPT', config: { settleMs: 120, settleCapMs: 300 } }));
    await page.waitForTimeout(150);
    await page.mouse.move(300, 150);
    await page.mouse.wheel(0, 40);
    const report = await reportPromise;
    expect(report.reason).toBe('user_input');
    expect(await page.evaluate(() => document.getElementById('scroller').scrollTop)).toBe(before);
  } finally {
    await browser.close();
  }
}, 120000);
