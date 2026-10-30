/** @jest-environment node */
/**
 * Real Chrome, the structure of ChatGPT's declarative blocks as found in a real export (class Box-…, data-d-direction /
 * data-d-align / data-d-justify / data-d-has-border, page styles with CSS variables). Every way the answer's html is
 * collected must give COMPUTED styles with the flex layout (no var(), no raw page style) — the live content script, a pull
 * from a tab whose scripts are older (the background injects the builder), and the injection-failed fallback must say so.
 * RUN_HTML_EXPORT_BROWSER_TESTS=1 (system Chrome).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const run = process.env.RUN_HTML_EXPORT_BROWSER_TESTS === '1' ? test : test.skip;
const sliceFunction = (src, name) => {
  const start = src.indexOf(`function ${name}(`);
  const open = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced');
};

const PAGE_CSS = `:root{--spacing:0.25rem}body{margin:0;font:14px sans-serif}.msg{width:900px}
  .Box-qIMv6G{display:flex}
  [data-d-direction="col"]{flex-direction:column}[data-d-direction="row"]{flex-direction:row}
  [data-d-align="center"]{align-items:center}[data-d-justify="center"]{justify-content:center}
  [data-d-has-border]{border:1px solid rgba(0,0,0,.1);border-radius:8px}
  .icon{color:rgb(93,93,93)}.arrow{color:rgb(143,143,143)}`;
const ICON = '<svg data-d-component="icon" class="icon" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M4 4h16"/><path d="M4 12h16"/></svg>';
const ARROW = '<svg data-d-component="icon" class="arrow" width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M12 4v12l-4-4"/></svg>';
const step = () => `<div class="Box-qIMv6G" data-d-component="box" data-d-direction="col" data-d-align="center" data-d-has-border="" style="padding-block: calc(var(--spacing, 0.25rem) * 3); padding-inline: calc(var(--spacing, 0.25rem) * 4); gap: calc(var(--spacing, 0.25rem) * 1);">
  <div class="Box-qIMv6G" data-d-component="row" data-d-direction="row" data-d-align="center" style="gap: calc(var(--spacing, 0.25rem) * 2);">${ICON}<p data-d-component="text" style="margin:0">x</p></div></div>`;
const SCHEME = `<div class="Box-qIMv6G" data-d-component="box" data-d-direction="col" data-d-align="center" data-d-justify="center" id="scheme" style="gap: calc(var(--spacing, 0.25rem) * 2);">${step()}${ARROW}${step()}${ARROW}${step()}</div>`;

async function layoutOf(page, html) {
  return page.evaluate((markup) => {
    const card = document.getElementById('card');
    card.innerHTML = markup;
    const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 }; };
    const steps = Array.from(card.querySelectorAll('div')).filter((el) => el.querySelector(':scope > div > p') && /border/.test(el.getAttribute('style') || ''));
    return {
      steps: steps.map(box),
      rows: steps.map((el) => ({ icon: box(el.querySelector('img')), text: box(el.querySelector('p')) })),
      arrows: Array.from(card.querySelectorAll('img')).filter((img) => img.previousElementSibling && img.nextElementSibling).map(box),
      card: box(card), maxRight: Math.max(...Array.from(card.querySelectorAll('*')).map((el) => el.getBoundingClientRect().right))
    };
  }, html);
}
function expectColumnLayout(m) {
  expect(m.steps).toHaveLength(3);
  for (let i = 1; i < 3; i += 1) {
    expect(m.steps[i].t).toBeGreaterThanOrEqual(m.steps[i - 1].b - 0.5);
    expect(Math.abs(m.steps[i].cx - m.steps[0].cx)).toBeLessThan(2);
  }
  m.rows.forEach((row) => { expect(Math.abs(row.icon.cy - row.text.cy)).toBeLessThan(6); expect(row.icon.l).toBeLessThan(row.text.l); });
  expect(m.arrows).toHaveLength(2);
  expect(m.maxRight).toBeLessThanOrEqual(m.card.r + 0.5);
}
function expectComputedLayout(html) {
  expect(html).toContain('display:flex');
  expect(html).toContain('flex-direction:column');
  expect(html).toContain('align-items:center');
  expect(html).toMatch(/gap:\s*8px/);          // calc(var(--spacing) * 2), computed
  expect(html).toMatch(/padding-top:\s*12px/); // calc(var(--spacing) * 3), computed
  expect(html).not.toMatch(/style="[^"]*var\(/);
  expect(html).not.toContain('Box-qIMv6G'.toUpperCase());
}

run('Chrome: ChatGPT declarative blocks keep their flex layout through every collection path', async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const cardCss = read('styles/modals-responsive.css');
    const extractorSrc = sliceFunction(read('background/job-orchestrator.js'), 'extractLatestAssistantSnapshotInPage');
    const open = async (preload) => {
      const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
      await page.addInitScript(() => { window.chrome = { runtime: { id: 'x', sendMessage() {} } }; });
      await page.setContent(`<style>${PAGE_CSS}</style><style>${cardCss}</style>
        <div class="msg" data-message-author-role="assistant" id="msg"><p>Intro of the answer.</p>${SCHEME}</div>
        <div id="card" class="debate-model-card-output" style="width:700px;max-height:none;overflow:visible"></div>`);
      await page.evaluate((source) => { window.__extract = new Function(`${source}; return extractLatestAssistantSnapshotInPage;`)(); }, extractorSrc);
      await preload(page);
      return page;
    };

    // 1. The live content script: ContentUtils delegating to the builder.
    const live = await open(async (page) => {
      await page.addScriptTag({ content: read('content-scripts/answer-html-builder.js') });
      await page.addScriptTag({ content: read('content-scripts/content-utils.js') });
    });
    const liveHtml = await live.evaluate(() => window.ContentUtils.buildInlineHtml(document.getElementById('msg'), { includeRoot: false }));
    expectComputedLayout(liveHtml);
    expectColumnLayout(await layoutOf(live, liveHtml));

    // 2. A tab with OLDER scripts (an old ContentUtils without the builder): the background injects the builder, then the pull.
    const stale = await open(async (page) => {
      await page.evaluate(() => { window.ContentUtils = { buildInlineHtml: (el) => el.innerHTML }; }); // what an older tab has
      await page.addScriptTag({ content: read('content-scripts/answer-html-builder.js') });  // = chrome.scripting.executeScript({ files })
    });
    const pulled = await stale.evaluate(() => window.__extract('GPT', 5, {}));
    expect(pulled.ok).toBe(true);
    expectComputedLayout(pulled.html);
    expectColumnLayout(await layoutOf(stale, pulled.html));
    expect(pulled.copyReport.placeholders.filter((item) => item.type === 'html')).toEqual([]);
    // the two paths give the same html
    const strip = (html) => html.replace(/\s+/g, ' ');
    expect(strip(pulled.html)).toBe(strip(liveHtml));

    // 3. Injection failed: the pull is NOT silently raw html — the report says it was built the fallback way.
    const failed = await open(async () => {});
    const raw = await failed.evaluate(() => window.__extract('GPT', 5, {}));
    expect(raw.ok).toBe(true);
    expect(raw.html).toContain('var(--spacing');          // the page's own styles: this is what the user saw
    expect(raw.copyReport.complete).toBe(false);
    expect(raw.copyReport.placeholders).toContainEqual({ type: 'html', reason: 'html собран запасным путём (без раскладки и стилей)', position: 0 });
  } finally {
    await browser.close();
  }
}, 120000);
