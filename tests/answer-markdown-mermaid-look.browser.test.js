/** @jest-environment node */
/**
 * Real Chrome, the REAL mermaid library: four diagram types drawn by us (flowchart with a rhombus and edge labels, sequence,
 * stateDiagram-v2, flowchart with subgraphs) get the neutral monochrome look (white blocks, thin grey borders, dark-grey lines,
 * no lilac #ECECFF / #9370DB). Screenshots go to the scratchpad for a visual comparison with Perplexity.
 * RUN_HTML_EXPORT_BROWSER_TESTS=1 (system Chrome).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const run = process.env.RUN_HTML_EXPORT_BROWSER_TESTS === '1' ? test : test.skip;
const ORIGIN = 'https://app.example.test';
const SHOTS = process.env.MERMAID_LOOK_DIR || '/private/tmp/claude-501/-Users-restart-Documents-GitHub-AutoOrchestr--claude-worktrees-html-export-text-highlighting-ef5b62/f30aca3e-9d7b-47a2-9c79-79a63d0427f8/scratchpad';
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const DIAGRAMS = {
  flowchart: 'flowchart TD\n  A[Запрос] --> B{Данные верны?}\n  B -->|да| C[Сохранить]\n  B -->|нет| D[Показать ошибку]\n  D --> A\n  C --> E[Готово]',
  sequence: 'sequenceDiagram\n  participant U as Пользователь\n  participant S as Сервер\n  U->>S: Запрос\n  S-->>U: Ответ\n  U->>S: Подтверждение',
  state: 'stateDiagram-v2\n  [*] --> Ожидание\n  Ожидание --> Работа: старт\n  Работа --> Ожидание: стоп\n  Работа --> [*]',
  subgraph: 'flowchart LR\n  subgraph SRC["Источники"]\n    A1["Документы"]\n    A2["Календарь"]\n  end\n  subgraph CORE["Ядро"]\n    B1["Люди"] --> B2["События"]\n  end\n  A1 --> B1\n  A2 --> B2'
};
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

const pageHtml = (block, bg) => `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/styles/modals-responsive.css"><style>body{margin:0;padding:16px;background:${bg};font:14px sans-serif}</style>
  <div id="card" class="debate-model-card-output" style="width:700px;max-height:none;overflow:visible">${block}</div>
  <script src="/stub.js"></script><script src="/results/code-blocks.js"></script>`;

describe.each([['light', '#ffffff'], ['dark', '#1a1a1a']])('%s page', (theme, bg) => {
  run.each(Object.keys(DIAGRAMS))(`Chrome: ${theme} look of %s`, async (kind) => {
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    try {
      fs.mkdirSync(SHOTS, { recursive: true });
      const block = `<pre data-code-lang="mermaid"><code class="language-mermaid">${escapeHtml(DIAGRAMS[kind])}</code></pre>`;
      const { page } = await open(browser, pageHtml(block, bg));
      await page.evaluate(() => window.ResultsCodeBlocks.install(document));
      await page.waitForFunction(() => ['ready', 'failed'].includes(document.querySelector('.code-block')?.dataset.diagram), null, { timeout: 20000 });
      expect(await page.evaluate(() => document.querySelector('.code-block').dataset.diagram)).toBe('ready');
      // the picture's svg inlined into the page, to read its computed styles
      const facts = await page.evaluate(() => {
        const img = document.querySelector('.code-block-diagram img');
        const text = decodeURIComponent(escape(atob(img.src.split(',')[1])));
        const holder = document.createElement('div');
        holder.id = 'probe';
        holder.innerHTML = text;
        document.body.appendChild(holder);
        const rgb = (v) => String(v);
        const fills = new Set(); const strokes = new Set();
        holder.querySelectorAll('rect, polygon, path, circle, line').forEach((el) => {
          const cs = getComputedStyle(el);
          fills.add(rgb(cs.fill)); strokes.add(rgb(cs.stroke));
        });
        const pick = (sel, prop) => Array.from(holder.querySelectorAll(sel)).map((el) => getComputedStyle(el)[prop]);
        const out = {
          text, fills: Array.from(fills), strokes: Array.from(strokes),
          nodeFill: pick('.node rect, .node polygon, .node path.basic, rect.basic, rect.actor, .state-start', 'fill'),
          nodeStroke: pick('.node rect, .node polygon, rect.actor', 'stroke'),
          edgeStroke: pick('.flowchart-link, .messageLine0, .messageLine1, .transition, path.transition', 'stroke'),
          panel: getComputedStyle(document.querySelector('.code-block-diagram')).backgroundColor,
          radius: getComputedStyle(document.querySelector('.code-block-diagram')).borderTopLeftRadius,
          padding: getComputedStyle(document.querySelector('.code-block-diagram')).paddingLeft
        };
        holder.remove();
        return out;
      });
      expect(facts.text).not.toMatch(/ECECFF|9370DB/i);
      expect(facts.panel).toBe(theme === 'light' ? 'rgb(241, 241, 241)' : 'rgb(43, 43, 43)');
      expect(facts.radius).toBe('8px');
      expect(facts.padding).toBe('20px');
      const nodeFillWanted = theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(58, 58, 58)';
      const borderWanted = theme === 'light' ? 'rgb(214, 214, 214)' : 'rgb(85, 85, 85)';
      const lineWanted = theme === 'light' ? ['rgb(102, 102, 102)', 'rgb(68, 68, 68)'] : ['rgb(170, 170, 170)', 'rgb(204, 204, 204)'];
      if (kind !== 'state') {
        expect(facts.nodeFill.length).toBeGreaterThan(0);
        facts.nodeFill.forEach((fill) => expect([nodeFillWanted, 'none', 'rgba(0, 0, 0, 0)']).toContain(fill));
        expect(facts.nodeFill).toContain(nodeFillWanted);
        expect(facts.nodeStroke).toContain(borderWanted);
      } else {
        expect(facts.fills).toContain(nodeFillWanted);
        expect(facts.strokes).toContain(borderWanted);
      }
      expect(facts.edgeStroke.length).toBeGreaterThan(0);
      facts.edgeStroke.forEach((stroke) => expect(lineWanted).toContain(stroke));
      await page.locator('.code-block').screenshot({ path: path.join(SHOTS, `mermaid-look-${theme}-${kind}.png`) });
    } finally {
      await browser.close();
    }
  }, 120000);
});
