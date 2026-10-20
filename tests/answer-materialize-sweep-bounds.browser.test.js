/** @jest-environment node */
/**
 * Real Chrome: a 30 000px conversation with a long last answer that draws diagrams lazily. The sweep climbs to the START OF THE LAST
 * ANSWER (not the page start), draws the lazy blocks, and comes back down; the scroll position never goes above the start of the
 * answer by more than the reserve (a quarter of the window).
 * RUN_HTML_EXPORT_BROWSER_TESTS=1 (system Chrome).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const run = process.env.RUN_HTML_EXPORT_BROWSER_TESTS === '1' ? test : test.skip;

const turns = (n) => Array.from({ length: n }, (_, i) => `<div data-message-author-role="user" style="height:60px"><p>Question ${i}</p></div>
  <div data-message-author-role="assistant" style="height:500px"><p>Old answer ${i}</p></div>`).join('');
const lastAnswer = `<div data-message-author-role="user" style="height:60px"><p>Question last</p></div>
  <div data-message-author-role="assistant" id="last">${Array.from({ length: 8 }, (_, i) => `<p style="height:400px;margin:0">Paragraph ${i}</p>
    <div class="lazy" role="status" aria-label="Загрузка диаграммы Mermaid" style="height:300px"></div>`).join('')}</div>`;

run('Chrome: the sweep goes up to the start of the last answer of a 30 000px page and back, drawing the lazy blocks', async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await page.addInitScript(() => { window.chrome = { runtime: { id: 'x', sendMessage() {} } }; });
    await page.setContent(`<style>body{margin:0}#scroller{height:800px;overflow-y:auto}</style>
      <main><div id="scroller">${turns(50)}${lastAnswer}</div></main>`);
    for (const file of ['shared/answer-markdown.js', 'shared/answer-markdown-blocks.js', 'shared/answer-markdown-extras.js', 'shared/answer-markdown-providers.js',
      'content-scripts/answer-html-builder.js', 'content-scripts/answer-pipeline-selectors.js', 'shared/answer-materialize-sweep.js']) await page.addScriptTag({ content: read(file) });
    const result = await page.evaluate(async () => {
      const scroller = document.getElementById('scroller');
      // lazy blocks: drawn when they come into the scroller's view
      const io = new IntersectionObserver((entries) => entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.removeAttribute('role'); entry.target.removeAttribute('aria-label');
        entry.target.innerHTML = '<svg viewBox="0 0 10 10" width="10" height="10"></svg>';
        entry.target.classList.remove('lazy');
      }), { root: scroller });
      document.querySelectorAll('.lazy').forEach((el) => io.observe(el));
      scroller.scrollTop = scroller.scrollHeight;
      const startTop = scroller.scrollTop;
      const answerTop = document.getElementById('last').offsetTop;
      let lowest = startTop;
      scroller.addEventListener('scroll', () => { lowest = Math.min(lowest, scroller.scrollTop); });
      const report = await window.AnswerMaterializeSweep.run({ provider: 'GPT', config: { settleMs: 60, settleCapMs: 200, placeholderWaitMs: 400, activeTailMs: 10 } });
      await new Promise((r) => setTimeout(r, 100));
      return { report, startTop, endTop: scroller.scrollTop, lowest, answerTop, height: scroller.scrollHeight, lazyLeft: document.querySelectorAll('.lazy').length };
    });
    expect(result.height).toBeGreaterThan(29000);
    expect(result.report.answerFound).toBe(true);
    expect(result.report.stoppedBy).toBe('answer_top');
    expect(result.lowest).toBeGreaterThanOrEqual(result.answerTop - 800 * 0.25 - 2);   // never above the start of the answer by more than the reserve
    expect(result.lowest).toBeLessThan(result.answerTop + 800);                        // and it did reach the start
    expect(result.endTop).toBe(result.startTop);                                       // back down
    expect(result.lazyLeft).toBe(0);
    expect(result.report.scrolledPx).toBeLessThanOrEqual(result.startTop - result.answerTop + 800 * 0.25 + 2);
  } finally {
    await browser.close();
  }
}, 90000);
