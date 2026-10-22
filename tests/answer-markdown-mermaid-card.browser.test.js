/** @jest-environment node */
/**
 * Real Chrome, the REAL mermaid library from lib/mermaid, under the extension's default CSP (script-src 'self', no eval):
 * a Perplexity-like flowchart source in a card block is drawn as a picture that fits a 700px card, the switch shows the
 * exact source, a syntax error leaves the code with a note, and no CSP violation happens.
 * RUN_HTML_EXPORT_BROWSER_TESTS=1 (system Chrome).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const run = process.env.RUN_HTML_EXPORT_BROWSER_TESTS === '1' ? test : test.skip;
const ORIGIN = 'https://app.example.test';
const SOURCE = [
  'flowchart LR',
  '  subgraph SRC["📥 Источники"]',
  '    A1["Документы<br>и фото"]',
  '    A2["📅 Календарь"]',
  '  end',
  '  subgraph CORE["⚙️ Ядро семьи"]',
  '    B1["Люди"] --> B2["События"]',
  '  end',
  '  A1 --> B1',
  '  A2 --> B2',
  '  B2 --> C1["✅ Готово"]'
].join('\n');
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

async function open(browser, html) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
  await context.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const csp = { 'Content-Security-Policy': "script-src 'self'; object-src 'self'" };
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', headers: csp, body: html });
    if (url.pathname === '/stub.js') return route.fulfill({ contentType: 'text/javascript', headers: csp, body: `window.chrome={runtime:{getURL:(p)=>'${ORIGIN}/'+p}};window.__violations=[];document.addEventListener('securitypolicyviolation',(e)=>window.__violations.push(e.violatedDirective+' '+e.blockedURI));` });
    const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript', headers: csp, body: fs.readFileSync(file) });
  });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (message) => { if (message.type() === 'error') problems.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 400) problems.push(`HTTP ${response.status()} ${response.url()}`); });
  page.on('pageerror', (error) => problems.push(String(error)));
  await page.goto(`${ORIGIN}/`);
  return { page, problems };
}
const pageHtml = (block) => `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/styles/modals-responsive.css"><style>body{margin:0;font:14px sans-serif}</style>
  <div id="card" class="debate-model-card-output" style="width:700px;max-height:none;overflow:visible"><p>before</p>${block}</div>
  <script src="/stub.js"></script><script src="/results/code-blocks.js"></script>`;

run('Chrome: real mermaid draws a Perplexity-like flowchart in the card, under the default CSP', async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const block = `<pre data-code-lang="mermaid"><code class="language-mermaid">${escapeHtml(SOURCE)}</code></pre>`;
    const { page, problems } = await open(browser, pageHtml(block));
    await page.evaluate(() => window.ResultsCodeBlocks.install(document));
    const textBefore = await page.evaluate(() => document.getElementById('card').innerText);

    await page.waitForFunction(() => document.querySelector('.code-block')?.dataset.diagram && document.querySelector('.code-block').dataset.diagram !== 'loading', null, { timeout: 15000 });
    const state = await page.evaluate(() => {
      const wrapper = document.querySelector('.code-block');
      const img = wrapper.querySelector('.code-block-diagram img');
      const r = img ? img.getBoundingClientRect() : null;
      const card = document.getElementById('card').getBoundingClientRect();
      return {
        diagram: wrapper.dataset.diagram, mode: wrapper.dataset.mode, note: wrapper.querySelector('.code-block-diagram').getAttribute('data-note'),
        shown: r && { w: r.width, h: r.height }, naturalW: img && img.naturalWidth, cardW: card.width, right: r && r.right, cardRight: card.right,
        preVisible: wrapper.querySelector('pre').getBoundingClientRect().height > 2, violations: window.__violations,
        label: getComputedStyle(wrapper.querySelector('.code-block-header'), '::before').content
      };
    });
    expect(problems.filter((p) => /HTTP 4|Failed to load|dynamically imported/i.test(p))).toEqual([]);
    expect(state.note).toBeNull();
    expect(state.diagram).toBe('ready');
    expect(state.mode).toBe('diagram');
    expect(state.shown.w).toBeGreaterThan(100);
    expect(state.shown.h).toBeGreaterThan(40);
    expect(state.right).toBeLessThanOrEqual(state.cardRight + 0.5);
    expect(state.preVisible).toBe(false);
    expect(state.violations).toEqual([]);
    expect(state.label).toContain('mermaid');
    expect(problems.filter((p) => /Content Security|unsafe-eval|EvalError/i.test(p))).toEqual([]);

    // The picture really holds the diagram: painted pixels, and the labels (emoji, <br>) are in the svg.
    const painted = await page.evaluate(async () => {
      const img = document.querySelector('.code-block-diagram img');
      const decoded = atob(img.src.split(',')[1]);
      const loaded = new Image(); loaded.src = img.src; await loaded.decode();
      const canvas = document.createElement('canvas'); canvas.width = loaded.naturalWidth; canvas.height = loaded.naturalHeight;
      const ctx = canvas.getContext('2d'); ctx.drawImage(loaded, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let colored = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0) colored += 1;
      return { colored, total: canvas.width * canvas.height, hasLabels: ['Источники', 'Календарь', 'Готово'].every((word) => new TextDecoder().decode(Uint8Array.from(decoded, (c) => c.charCodeAt(0))).includes(word)) };
    });
    expect(painted.colored).toBeGreaterThan(painted.total * 0.05);
    expect(painted.hasLabels).toBe(true);

    // The switch: the exact source, then back; the card text is the same as before the furniture.
    await page.locator('.code-block-view[data-view="code"]').click();
    expect(await page.evaluate(() => document.querySelector('.code-block pre code').textContent)).toBe(SOURCE);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.code-block pre')).display)).not.toBe('none');
    await page.locator('.code-block-copy').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SOURCE);
    await page.locator('.code-block-view[data-view="diagram"]').click();
    expect(await page.evaluate(() => document.querySelector('.code-block').dataset.mode)).toBe('diagram');
    expect(await page.evaluate(() => document.getElementById('card').innerText)).toBe(textBefore);
  } finally {
    await browser.close();
  }
}, 120000);

run('Chrome: a syntax error in the source leaves the code with a visible note', async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const bad = 'flowchart LR\n  A[Start] --> \n  B{{{';
    const { page } = await open(browser, pageHtml(`<pre data-code-lang="mermaid"><code class="language-mermaid">${escapeHtml(bad)}</code></pre>`));
    await page.evaluate(() => window.ResultsCodeBlocks.install(document));
    await page.waitForFunction(() => ['failed', 'ready'].includes(document.querySelector('.code-block')?.dataset.diagram), null, { timeout: 15000 });
    const state = await page.evaluate(() => {
      const wrapper = document.querySelector('.code-block');
      const holder = wrapper.querySelector('.code-block-diagram');
      return {
        diagram: wrapper.dataset.diagram, mode: wrapper.dataset.mode, note: holder.getAttribute('data-note'), noteShown: getComputedStyle(holder, '::before').content,
        preVisible: wrapper.querySelector('pre').getBoundingClientRect().height > 0, text: wrapper.querySelector('pre code').textContent,
        holderVisible: holder.getBoundingClientRect().height > 0, views: getComputedStyle(wrapper.querySelector('.code-block-views')).display
      };
    });
    expect(state.diagram).toBe('failed');
    expect(state.mode).toBe('code');
    expect(state.note).toMatch(/^Не удалось отрисовать диаграмму: .+/);
    expect(state.note).not.toMatch(/Failed to fetch|dynamically imported/); // a real syntax error, not a missing library
    expect(state.noteShown).toContain('Не удалось отрисовать диаграмму');
    expect(state.preVisible).toBe(true);
    expect(state.holderVisible).toBe(true);
    expect(state.text).toBe(bad);
    expect(state.views).toBe('none');
  } finally {
    await browser.close();
  }
}, 120000);
