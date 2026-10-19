/** @jest-environment node */
/**
 * Real Chrome check (jsdom has no layout, getBBox or rendering): a diagram saved into answerHtml as an
 * <img data:image/svg+xml> must fill its picture (no tiny drawing in a big empty field), keep the scale it
 * had on the page, and stay inside a 700px card. Both code paths are measured: ContentUtils.buildInlineHtml
 * and the in-page extractor of the background. Runs with RUN_HTML_EXPORT_BROWSER_TESTS=1 (system Chrome).
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

const rect = (x, y, w, h, fill = '#36c') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
// Each case: the page markup of one diagram and the content box (user units) it really draws.
const CASES = {
  mermaidLike: {
    viewBox: [-50, -10, 1300, 400],
    html: `<svg id="d" width="100%" style="max-width:1200px;background-color:white" viewBox="-50 -10 1300 400"><style>.l{font:14px sans-serif}</style>
      ${rect(0, 0, 1000, 300)}<foreignObject x="20" y="20" width="200" height="40"><div xmlns="http://www.w3.org/1999/xhtml" class="l">Label</div></foreignObject></svg>`
  },
  fixedHeightPanel: {
    viewBox: [0, 0, 500, 200],
    html: `<div style="height:400px;width:100%"><svg id="d" width="100%" height="100%" viewBox="0 0 500 200">${rect(100, 60, 120, 60)}</svg></div>`
  },
  veryWide: { viewBox: [0, 0, 2000, 300], html: `<div style="overflow-x:auto"><svg id="d" width="2000" height="300" viewBox="0 0 2000 300">${rect(0, 0, 2000, 300)}</svg></div>` },
  veryTall: { viewBox: [0, 0, 400, 1800], html: `<svg id="d" width="400" height="1800" viewBox="0 0 400 1800">${rect(0, 0, 400, 1800)}</svg>` },
  offsetViewBox: { viewBox: [-300, -200, 800, 600], html: `<svg id="d" width="600" height="450" viewBox="-300 -200 800 600">${rect(-250, -150, 650, 450)}</svg>` }
};

const PAGE_CSS = 'body{margin:0;font:14px sans-serif}.msg{width:1400px}#card{width:700px;font-size:14px}#card img{max-width:100%;height:auto;display:block}';

async function measure(page, htmlString, extra) {
  return page.evaluate(async ({ htmlString: html, extra: more }) => {
    const card = document.getElementById('card');
    card.innerHTML = html;
    const img = card.querySelector('img');
    if (!img) return { noImage: true, html: html.slice(0, 200) };
    await img.decode();
    const rect = img.getBoundingClientRect();
    const svgText = atob(img.src.split(',')[1]);
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml').documentElement;
    const vb = doc.getAttribute('viewBox').split(/[\s,]+/).map(Number);
    return {
      viewBox: vb,
      attrs: { width: img.getAttribute('width'), height: img.getAttribute('height') },
      shown: { w: rect.width, h: rect.height },
      natural: { w: img.naturalWidth, h: img.naturalHeight },
      cardWidth: card.getBoundingClientRect().width,
      rootStyle: doc.getAttribute('style') || '',
      par: doc.getAttribute('preserveAspectRatio'),
      ...more
    };
  }, { htmlString, extra });
}

run('Chrome: diagrams keep their scale, fill their picture and stay inside a 700px card (both code paths)', async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await page.addInitScript(() => { window.chrome = { runtime: { id: 'x', sendMessage() {} } }; });
    await page.setContent(`<style>${PAGE_CSS}</style><div class="msg" data-message-author-role="assistant"><div id="src"></div></div><div id="card"></div>`);
    await page.addScriptTag({ content: read('content-scripts/content-utils.js') });
    const extractorSrc = sliceFunction(read('background/job-orchestrator.js'), 'extractLatestAssistantSnapshotInPage');
    await page.evaluate((source) => { window.__extract = new Function(`${source}; return extractLatestAssistantSnapshotInPage;`)(); }, extractorSrc);

    const report = {};
    for (const [name, spec] of Object.entries(CASES)) {
      await page.evaluate((html) => {
        document.getElementById('src').innerHTML = `<p>Intro text of the answer, long enough to be a candidate for the extractor.</p>${html}`;
      }, spec.html);
      // The drawn content box in user units, from the live DOM (truth for the fill ratio).
      const truth = await page.evaluate(() => {
        const svg = document.getElementById('d');
        const content = Array.from(svg.children).filter((el) => el.tagName.toLowerCase() === 'rect');
        const boxes = content.map((el) => el.getBBox());
        const x0 = Math.min(...boxes.map((b) => b.x)); const y0 = Math.min(...boxes.map((b) => b.y));
        const x1 = Math.max(...boxes.map((b) => b.x + b.width)); const y1 = Math.max(...boxes.map((b) => b.y + b.height));
        const r = svg.getBoundingClientRect();
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, pageWidth: r.width, pageHeight: r.height };
      });
      const viaUtils = await page.evaluate(() => window.ContentUtils.buildInlineHtml(document.getElementById('src'), { includeRoot: false }));
      const viaExtractor = await page.evaluate(() => window.__extract('GPT', 10, {}).html);
      for (const [path_, html] of [['buildInlineHtml', viaUtils], ['extractor', viaExtractor]]) {
        const m = await measure(page, html);
        expect(m.noImage).toBeUndefined();
        const fill = (truth.w * truth.h) / (m.viewBox[2] * m.viewBox[3]);
        report[`${name}/${path_}`] = { fill: Number(fill.toFixed(3)), shown: m.shown, viewBox: m.viewBox, attrs: m.attrs, page: [truth.pageWidth, truth.pageHeight] };
        if (fill < 0.85) console.log('LOW FILL', name, path_, JSON.stringify(report[`${name}/${path_}`]), JSON.stringify(truth));
        // Not a small drawing in a big field.
        expect(fill).toBeGreaterThanOrEqual(0.85);
        // Inside the card.
        expect(m.shown.w).toBeLessThanOrEqual(m.cardWidth + 0.5);
        // The size limits of the page (mermaid max-width) do not follow the picture; aspect ratio is the viewBox's.
        expect(m.rootStyle).not.toMatch(/max-width/);
        expect(m.par).toBe('xMidYMid meet');
        expect(m.shown.w / m.shown.h).toBeCloseTo(m.viewBox[2] / m.viewBox[3], 1);
        // Scale: the content is as large in the picture (at its own width) as it was on the page.
        const [, , vw, vh] = CASES[name].viewBox;
        const pageScale = Math.min(truth.pageWidth / vw, truth.pageHeight / vh);
        const contentOnPicture = Number(m.attrs.width) * truth.w / m.viewBox[2];
        expect(Math.abs(contentOnPicture - truth.w * pageScale) / (truth.w * pageScale)).toBeLessThan(0.03);
      }
      const a = await measure(page, viaUtils);
      const b = await measure(page, viaExtractor);
      expect(b.viewBox).toEqual(a.viewBox);
      expect(b.attrs).toEqual(a.attrs);
    }
    console.log('svg scale report', JSON.stringify(report));

    // Raster check (no foreignObject: it taints the canvas): the painted pixels fill the picture.
    const painted = await page.evaluate(async () => {
      document.getElementById('src').innerHTML = `<p>Intro text of the answer, long enough to be a candidate.</p>
        <svg id="d" width="100%" style="max-width:1200px" viewBox="-50 -10 1300 400"><rect x="0" y="0" width="1000" height="300" fill="#36c"/></svg>`;
      const html = window.ContentUtils.buildInlineHtml(document.getElementById('src'), { includeRoot: false });
      const holder = document.createElement('div');
      holder.innerHTML = html;
      const img = holder.querySelector('img');
      const loaded = new Image();
      loaded.src = img.src;
      await loaded.decode();
      const canvas = document.createElement('canvas');
      canvas.width = loaded.naturalWidth; canvas.height = loaded.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(loaded, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let minX = canvas.width; let minY = canvas.height; let maxX = 0; let maxY = 0;
      for (let y = 0; y < canvas.height; y += 1) for (let x = 0; x < canvas.width; x += 1) {
        if (data[(y * canvas.width + x) * 4 + 3] > 0) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      }
      return { fill: ((maxX - minX + 1) * (maxY - minY + 1)) / (canvas.width * canvas.height), size: [canvas.width, canvas.height] };
    });
    console.log('raster', JSON.stringify(painted));
    expect(painted.fill).toBeGreaterThanOrEqual(0.85);
  } finally {
    await browser.close();
  }
}, 120000);

test('the img rule is in the card CSS and in every HTML export', () => {
  expect(read('styles/modals-responsive.css')).toMatch(/\.debate-model-card-output img[\s\S]*?max-width: 100%;\s*height: auto;\s*display: block;/);
  expect(read('results/debate-export.js')).toContain('img{max-width:100%;height:auto;display:block}');
  const results = read('results.js');
  expect((results.match(/img \{ max-width: 100%; height: auto; display: block; \}/g) || []).length).toBeGreaterThanOrEqual(3);
});
