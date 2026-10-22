/** @jest-environment node */
/**
 * Real Chrome: a code block of a card downloads a file with the expected name and exact content (page.waitForEvent('download')),
 * "Просмотр" opens the dialog, and the html preview draws a synthetic page WITHOUT running its script (sandboxed iframe + CSP).
 * RUN_HTML_EXPORT_BROWSER_TESTS=1 (system Chrome).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const run = process.env.RUN_HTML_EXPORT_BROWSER_TESTS === '1' ? test : test.skip;
const ORIGIN = 'https://app.example.test';
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


const PY = 'def f():\n    return "привет"\n';
const HTML = '<h1 id="t">Hello preview</h1><script>document.getElementById("t").textContent="EXECUTED";</script>';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const pageHtml = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/styles/modals-responsive.css"><style>body{margin:0;padding:16px;font:14px sans-serif}</style>
  <div class="debate-model-card" data-llm-name="Qwen"><div id="card" class="debate-model-card-output" style="width:700px">
    <pre data-code-lang="python"><code>${esc(PY)}</code></pre><pre data-code-lang="html"><code>${esc(HTML)}</code></pre></div></div>
  <script src="/stub.js"></script><script src="/results/debate-export.js"></script><script src="/results/code-blocks.js"></script>`;

run('Chrome: download, viewer and a script-free html preview', async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const { page, problems } = await open(browser, pageHtml);
    await page.evaluate(() => window.ResultsCodeBlocks.install(document));
    const blocks = page.locator('.code-block');
    await blocks.nth(0).locator('.code-block-download').waitFor();
    const header = await blocks.nth(0).locator('.code-block-header').evaluate((el) => Array.from(el.querySelectorAll('button')).map((b) => getComputedStyle(b, '::before').content));
    expect(header).toEqual(['"Просмотр"', '"Скачать"', '"Copy"']);

    const [download] = await Promise.all([page.waitForEvent('download'), blocks.nth(0).locator('.code-block-download').click()]);
    expect(download.suggestedFilename()).toBe('Qwen-python-1.py');
    expect(fs.readFileSync(await download.path(), 'utf8')).toBe(PY);

    await blocks.nth(1).locator('.code-block-open').click();
    const dialog = page.locator('.code-viewer[role="dialog"]');
    await dialog.waitFor();
    const frame = dialog.locator('iframe');
    expect(await frame.getAttribute('sandbox')).toBe('');
    const inner = page.frameLocator('.code-viewer iframe');
    await inner.locator('#t').waitFor();
    expect(await inner.locator('#t').textContent()).toBe('Hello preview');   // the script did not run
    const box = await dialog.boundingBox();
    expect(box.width).toBeGreaterThan(600);
    await page.keyboard.press('Escape');
    expect(await page.locator('.code-viewer').count()).toBe(0);
    expect(await page.evaluate(() => document.activeElement.className)).toContain('code-block-open');
    expect(problems.filter((p) => /Uncaught|EvalError/i.test(p))).toEqual([]);
  } finally {
    await browser.close();
  }
}, 90000);
