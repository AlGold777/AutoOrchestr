/** @jest-environment node */
/**
 * Real Chrome (real layout, getBBox, foreignObject labels): a DeepSeek-like md-code-block with a Mermaid svg (viewBox 735x1904
 * drawn into 752x256) becomes a picture that is legible in a 700px card, without the banner (tabs, Download, Fullscreen).
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
const NODES = Array.from({ length: 13 }, (_, i) => `<g class="node default" id="flowchart-N${i}-${i}" transform="translate(${(i % 2) * 300 + 100}, ${i * 140 + 30})"><rect x="-80" y="-30" width="160" height="60" fill="#ececff"/><foreignObject x="-70" y="-20" width="140" height="40"><div xmlns="http://www.w3.org/1999/xhtml" style="display:table-cell"><span class="nodeLabel">Step ${i}</span></div></foreignObject></g>`).join('');
const BLOCK = `<div class="md-code-block md-code-block-light" style="width:752px">
  <div class="md-code-block-banner-wrap"><div class="md-code-block-banner" style="height:42px"><div class="ds-segmented" role="tablist"><div role="tab" aria-selected="true">Diagram</div><div role="tab" aria-selected="false">Code</div></div>
  <div class="ds-button" role="button">Download</div><div class="ds-button" role="button">Fullscreen</div></div></div>
  <style>.scope{color:red}</style>
  <div class="body" style="width:752px;height:256px"><svg class="flowchart mermaid-svg" id="mermaid-svg-5" role="graphics-document document" width="100%" height="100%" viewBox="-33.4 -33.4 735.3 1904.4"><style>#mermaid-svg-5 .node rect{fill:#dde}</style><g>${NODES}</g></svg></div></div>`;
const extractorSrc = sliceFunction(read('background/job-orchestrator.js'), 'extractLatestAssistantSnapshotInPage');

run('Chrome: a DeepSeek Mermaid block becomes a legible picture without the banner, in both collection paths', async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    await page.addInitScript(() => { window.chrome = { runtime: { id: 'x', sendMessage() {} } }; });
    await page.setContent(`<style>body{margin:0;font:14px sans-serif}#card img{max-width:100%;height:auto;display:block}</style>
      <div class="ds-markdown" id="msg" style="width:900px"><p>Intro paragraph of the answer, long enough to be the answer.</p><h3>Scenario</h3>${BLOCK}<p>Closing paragraph.</p></div>
      <div id="card" style="width:700px"></div>`);
    for (const file of ['shared/answer-markdown.js', 'shared/answer-markdown-blocks.js', 'shared/answer-markdown-extras.js', 'shared/answer-markdown-providers.js',
      'content-scripts/answer-html-builder.js', 'content-scripts/content-utils.js']) await page.addScriptTag({ content: read(file) });
    await page.evaluate((source) => { window.__extract = new Function(`${source}; return extractLatestAssistantSnapshotInPage;`)(); }, extractorSrc);
    const onPage = await page.evaluate(() => { const r = document.querySelector('svg.mermaid-svg').getBoundingClientRect(); return { w: r.width, h: r.height }; });
    expect(Math.round(onPage.w)).toBe(752);
    expect(Math.round(onPage.h)).toBe(256);

    for (const how of ['page', 'extractor']) {
      const html = await page.evaluate((mode) => (mode === 'extractor'
        ? window.__extract('DeepSeek', 10, {}).html
        : window.ContentUtils.buildInlineHtml(document.getElementById('msg'), { includeRoot: false, provider: 'DeepSeek' })), how);
      for (const ui of ['Download', 'Fullscreen', 'tablist', 'ds-button', 'Diagram<']) expect(html).not.toContain(ui);
      const m = await page.evaluate(async (markup) => {
        const card = document.getElementById('card');
        card.innerHTML = markup;
        const imgs = card.querySelectorAll('img');
        const img = imgs[0];
        if (!img) return { count: 0 };
        await img.decode();
        const r = img.getBoundingClientRect();
        return { count: imgs.length, alt: img.getAttribute('alt'), attrs: [Number(img.getAttribute('width')), Number(img.getAttribute('height'))], shown: [r.width, r.height], natural: [img.naturalWidth, img.naturalHeight], cardW: card.getBoundingClientRect().width };
      }, html);
      expect(m.count).toBe(1);
      expect(m.alt).toBe('Диаграмма Mermaid');
      expect(m.attrs[0]).toBeGreaterThan(400);            // legible: 1 unit = 1px (the nodes span ~480 units), not the 0.13 scale of the 256px-high page view
      expect(m.attrs[1]).toBeGreaterThan(1500);
      expect(m.shown[0]).toBeLessThanOrEqual(m.cardW + 0.5);
      expect(m.shown[0]).toBeGreaterThan(300);
      expect(m.shown[1]).toBeGreaterThan(m.shown[0]);      // the tall shape is kept
    }
  } finally {
    await browser.close();
  }
}, 120000);
