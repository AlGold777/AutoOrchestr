/** @jest-environment node */
/**
 * Real Chrome (real layout): Qwen's pre.qwen-markdown-code with a rendered Mermaid svg — visible, and hidden by the active "Код" tab
 * (display:none, a 0x0 rectangle) — becomes a picture that fits a 700px card, without the header, buttons and tab texts.
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
const SVG = `<svg id="mermaid-179244703972" aria-roledescription="flowchart-v2" width="100%" viewBox="0 0 363 376" style="max-width:363px"><style>#mermaid-179244703972 .node rect{fill:#dde}</style><g>${Array.from({ length: 4 }, (_, i) => `<g class="node default" transform="translate(${60 + (i % 2) * 150}, ${40 + i * 80})"><rect x="-50" y="-25" width="100" height="50"/><text>Step ${i}</text></g>`).join('')}</g></svg>`;
const pre = (svgHolder) => `<pre class="qwen-markdown-code" style="width:736px;margin:0"><div class="qwen-markdown-code" style="height:40px"><div>mermaid</div><div><button class="qwen-markdown-mermaid-btn" style="width:20px;height:20px">Код</button><button class="qwen-markdown-mermaid-btn">превью</button></div></div>
  <div class="qwen-markdown-code mermaid" style="height:290px"><div style="display:none"><div class="monaco-editor" role="code"><div class="view-lines"><div class="view-line">graph TD</div></div></div></div>${svgHolder}<canvas width="2" height="2"></canvas></div></pre>`;
const extractorSrc = sliceFunction(read('background/job-orchestrator.js'), 'extractLatestAssistantSnapshotInPage');

run('Chrome: a Qwen diagram pre (visible svg, and svg hidden by the Код tab) is a picture in a 700px card, in both collection paths', async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    await page.addInitScript(() => { window.chrome = { runtime: { id: 'x', sendMessage() {} } }; });
    await page.setContent(`<style>body{margin:0;font:14px sans-serif}#card img{max-width:100%;height:auto;display:block}</style>
      <div class="qwen-markdown qwen-markdown-loose" id="msg" style="width:900px"><p>Intro paragraph of the answer, long enough to be the answer.</p>
        ${pre(`<div style="width:702px;height:257px">${SVG}</div>`)}
        ${pre(`<div style="display:none">${SVG}</div>`)}
        <p>Closing paragraph.</p></div><div id="card" style="width:700px"></div>`);
    for (const file of ['shared/answer-markdown.js', 'shared/answer-markdown-blocks.js', 'shared/answer-markdown-extras.js', 'shared/answer-markdown-providers.js',
      'content-scripts/answer-html-builder.js', 'content-scripts/content-utils.js']) await page.addScriptTag({ content: read(file) });
    await page.evaluate((source) => { window.__extract = new Function(`${source}; return extractLatestAssistantSnapshotInPage;`)(); }, extractorSrc);
    const states = await page.evaluate(() => Array.from(document.querySelectorAll('svg[id^="mermaid"]'), (s) => { const r = s.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    expect(states[0][0]).toBeGreaterThan(300);
    expect(states[1]).toEqual([0, 0]);          // hidden by the active tab: no layout

    for (const how of ['page', 'extractor']) {
      const html = await page.evaluate((mode) => (mode === 'extractor'
        ? window.__extract('Qwen', 10, {}).html
        : window.ContentUtils.buildInlineHtml(document.getElementById('msg'), { includeRoot: false, provider: 'Qwen' })), how);
      ['<button', 'Код', 'превью', 'monaco', '<canvas', 'qwen-markdown-code'].forEach((furniture) => expect(html).not.toContain(furniture));
      const m = await page.evaluate(async (markup) => {
        const card = document.getElementById('card');
        card.innerHTML = markup;
        const imgs = Array.from(card.querySelectorAll('img'));
        await Promise.all(imgs.map((img) => img.decode()));
        return { count: imgs.length, alts: imgs.map((i) => i.getAttribute('alt')), shown: imgs.map((i) => { const r = i.getBoundingClientRect(); return [r.width, r.height]; }), natural: imgs.map((i) => [i.naturalWidth, i.naturalHeight]), cardW: card.getBoundingClientRect().width };
      }, html);
      expect(m.count).toBe(2);
      expect(m.alts).toEqual(['Диаграмма Mermaid (flowchart)', 'Диаграмма Mermaid (flowchart)']);
      m.shown.forEach(([w, h]) => { expect(w).toBeLessThanOrEqual(m.cardW + 0.5); expect(w).toBeGreaterThan(100); expect(h).toBeGreaterThan(100); });
      m.natural.forEach(([w, h]) => { expect(w).toBeGreaterThan(100); expect(h).toBeGreaterThan(100); });
    }
  } finally {
    await browser.close();
  }
}, 120000);
