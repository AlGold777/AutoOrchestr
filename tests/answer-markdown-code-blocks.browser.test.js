/** @jest-environment node */
/**
 * Real Chrome: a code block in a card has a header and a Copy button; a click puts the EXACT text on the clipboard;
 * long lines scroll inside the block; the card text (innerText) is unchanged by the furniture; the exported HTML
 RUN_HTML_EXPORT_BROWSER_TESTS=1 (system Chrome).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const run = process.env.RUN_HTML_EXPORT_BROWSER_TESTS === '1' ? test : test.skip;
const CODE = 'def f(x):\n\n    if x:\n\treturn  1   \n    return 2  # ' + 'long '.repeat(80) + '\n';
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const PRE = `<pre data-code-lang="python"><code class="language-python">${escapeHtml(CODE)}</code></pre>`;

async function open(browser, url, html) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
  await context.route(url, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  const page = await context.newPage();
  await page.goto(url);
  return page;
}

run('Chrome: Copy button on top of a code block in a card', async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const css = read('styles/modals-responsive.css');
    const cardPage = `<!doctype html><meta charset="utf-8"><style>body{margin:0;font:14px sans-serif}${css}</style>
      <div class="debate-model-card-output" id="card" style="width:600px;max-height:none;overflow:visible"><p>before</p>${PRE}<p>after</p></div>`;
    const page = await open(browser, 'https://card.example.test/', cardPage);
    const undecorated = await page.evaluate(() => document.getElementById('card').innerText);
    await page.addScriptTag({ content: read('results/code-blocks.js') });
    await page.evaluate(() => window.ResultsCodeBlocks.install(document));

    // The furniture adds no text to the card.
    expect(await page.evaluate(() => document.getElementById('card').innerText)).toBe(undecorated);
    expect(await page.evaluate(() => document.getElementById('card').textContent.includes('Copy'))).toBe(false);

    // Header above the code, label and button visible, long lines scroll inside the block (the card keeps its width).
    const geometry = await page.evaluate(() => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, r: r.right, w: r.width }; };
      const wrapper = document.querySelector('.code-block');
      const pre = wrapper.querySelector('pre');
      return {
        header: box(wrapper.querySelector('.code-block-header')), pre: box(pre), wrapper: box(wrapper), card: box(document.getElementById('card')),
        button: box(wrapper.querySelector('.code-block-copy')),
        scrolls: pre.scrollWidth > pre.clientWidth, whiteSpace: getComputedStyle(pre).whiteSpace, overflowX: getComputedStyle(pre).overflowX,
        font: getComputedStyle(pre).fontFamily, label: getComputedStyle(wrapper.querySelector('.code-block-header'), '::before').content,
        buttonLabel: getComputedStyle(wrapper.querySelector('.code-block-copy'), '::before').content
      };
    });
    expect(geometry.header.b).toBeLessThanOrEqual(geometry.pre.t + 0.5);
    expect(geometry.button.w).toBeGreaterThan(30);
    expect(geometry.wrapper.r).toBeLessThanOrEqual(geometry.card.r + 0.5);
    expect(geometry.scrolls).toBe(true);
    expect(geometry.whiteSpace).toBe('pre');
    expect(geometry.overflowX).toBe('auto');
    expect(geometry.font).toMatch(/mono|Menlo|Consolas/i);
    expect(geometry.label).toContain('python');
    expect(geometry.buttonLabel).toContain('Copy');

    // Click -> the clipboard holds the exact text; feedback appears and goes away.
    await page.locator('.code-block-copy').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CODE);
    expect(await page.locator('.code-block-copy').evaluate((el) => el.classList.contains('is-copied'))).toBe(true);
    expect(await page.locator('.code-block-copy').evaluate((el) => getComputedStyle(el, '::before').content)).toContain('Скопировано');
    await page.waitForFunction(() => !document.querySelector('.code-block-copy').classList.contains('is-copied'), null, { timeout: 4000 });

  } finally {
    await browser.close();
  }
}, 120000);

const MERMAID = 'flowchart LR\n  A[Start] --> B{Check}\n  B -->|yes| C[Done]';
run('Chrome: Perplexity-like Mermaid (cross-origin iframe + hidden source) becomes one visible mermaid code block with Copy', async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const css = read('styles/modals-responsive.css');
    const page = await open(browser, 'https://pplx.example.test/', `<!doctype html><meta charset="utf-8"><style>body{margin:0;font:14px sans-serif}.src-panel{display:none}</style>
      <div id="msg"><p>Intro paragraph of the answer.</p><div class="d"><iframe title="Mermaid diagram" sandbox="allow-scripts" src="https://render.example.test/m"></iframe>
      <div class="src-panel"><pre>${MERMAID}</pre></div></div><div class="hidden-note" style="visibility:hidden">HIDDEN-NOTE</div><p>Closing.</p></div>
      <style>${css}</style><div id="card" class="debate-model-card-output" style="width:600px;max-height:none;overflow:visible"></div>`);
    await page.evaluate(() => { window.chrome = { runtime: { id: 'x', sendMessage() {} } }; });
    await page.addScriptTag({ content: read('shared/answer-markdown.js') });
    await page.addScriptTag({ content: read('content-scripts/content-utils.js') });
    await page.addScriptTag({ content: read('results/code-blocks.js') });
    const html = await page.evaluate(() => window.ContentUtils.buildInlineHtml(document.getElementById('msg'), { includeRoot: false }));
    expect(html).not.toContain('iframe');
    expect(html).not.toContain('HIDDEN-NOTE');
    expect(html).not.toContain('не скопирован');
    await page.evaluate((markup) => { document.getElementById('card').innerHTML = markup; window.ResultsCodeBlocks.install(document); }, html);
    const shown = await page.evaluate(() => {
      const wrapper = document.querySelector('#card .code-block');
      const r = wrapper.querySelector('pre').getBoundingClientRect();
      return { count: document.querySelectorAll('#card .code-block').length, label: getComputedStyle(wrapper.querySelector('.code-block-header'), '::before').content, visible: r.width > 0 && r.height > 0 };
    });
    expect(shown.count).toBe(1);
    expect(shown.label).toContain('mermaid');
    expect(shown.visible).toBe(true);
    await page.locator('.code-block-copy').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(MERMAID);
  } finally {
    await browser.close();
  }
}, 120000);
