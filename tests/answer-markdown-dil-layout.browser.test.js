/** @jest-environment node */
/**
 * Real Chrome check for declarative UI blocks (ChatGPT "DIL": data-d-component boxes/rows with flex layout and small
 * svg icons/arrows). Builds the "scheme A" structure on a live page, runs ContentUtils.buildInlineHtml, puts the
 * result into a 700px card with the real card CSS and measures: cards in a column, icon and text of a card on one
 * row, an arrow picture between the cards, nothing wider than the card. RUN_HTML_EXPORT_BROWSER_TESTS=1, system Chrome.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const run = process.env.RUN_HTML_EXPORT_BROWSER_TESTS === '1' ? test : test.skip;

const PAGE_CSS = `body{margin:0;font:14px sans-serif}.msg{width:900px}
  [data-d-direction="col"]{display:flex;flex-direction:column;align-items:center;gap:4px}
  [data-d-direction="row"]{display:flex;flex-direction:row;align-items:center;gap:8px}
  .step{padding:12px;border:1px solid rgba(0,0,0,.1);border-radius:8px}
  .icon{color:rgb(93,93,93)}.arrow{color:rgb(143,143,143)}`;
const ICON = '<svg data-d-component="icon" class="icon" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M4 4h16"/><path d="M4 12h16"/></svg>';
const ARROW = '<svg data-d-component="icon" class="arrow" width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M12 4v12l-4-4"/></svg>';
const step = (label) => `<div data-d-component="box" data-d-direction="col" class="step"><div data-d-component="row" data-d-direction="row">${ICON}<p data-d-component="text" style="margin:0">${label}</p></div></div>`;
const SCHEME = `<div data-d-component="box" data-d-direction="col" id="scheme">${step('Step one')}${ARROW}${step('Step two')}${ARROW}${step('Step three')}</div>`;
const ORDINARY = `<h2>Title of the answer</h2><p>${'A normal paragraph of the answer with some words. '.repeat(6)}</p><ul><li>first item</li><li>second item</li><li>third <strong>item</strong></li></ul><pre><code>const a = 1;\nconst b = 2;</code></pre><table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>`;

const headVersion = () => {
  try { return execFileSync('git', ['show', 'HEAD:content-scripts/content-utils.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }); } catch (_) { return null; }
};

run('Chrome: a DIL scheme keeps its columns, rows and arrows inside a 700px card; an ordinary answer does not grow', async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await page.addInitScript(() => { window.chrome = { runtime: { id: 'x', sendMessage() {} } }; });
    const cardCss = read('styles/modals-responsive.css');
    await page.setContent(`<style>${PAGE_CSS}</style><style>${cardCss}</style><div class="msg" data-message-author-role="assistant"><div id="src"></div></div>
      <div id="card" class="debate-model-card-output" style="width:700px;max-height:none;overflow:visible"></div>`);
    await page.addScriptTag({ content: read('content-scripts/content-utils.js') });
    await page.evaluate((html) => { document.getElementById('src').innerHTML = `<p>Intro of the answer.</p>${html}`; }, SCHEME);
    const html = await page.evaluate(() => window.ContentUtils.buildInlineHtml(document.getElementById('src'), { includeRoot: false }));
    expect(html).toContain('display:flex');
    expect((html.match(/<img /g) || []).length).toBe(5); // three row icons, two arrows
    expect(html).not.toContain('<svg');

    const m = await page.evaluate((markup) => {
      const card = document.getElementById('card');
      card.innerHTML = markup;
      const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 }; };
      const steps = Array.from(card.querySelectorAll('div')).filter((el) => /border/.test(el.getAttribute('style') || '') && el.querySelector('p'));
      const rows = steps.map((el) => {
        const icon = el.querySelector('img');
        const text = el.querySelector('p');
        return { icon: box(icon), text: box(text) };
      });
      const arrows = Array.from(card.querySelectorAll('img')).filter((img) => img.parentElement.children.length > 1 && img.previousElementSibling && img.nextElementSibling);
      return { card: box(card), steps: steps.map(box), rows, arrows: arrows.map(box), maxRight: Math.max(...Array.from(card.querySelectorAll('*')).map((el) => el.getBoundingClientRect().right)) };
    }, html);

    expect(m.steps).toHaveLength(3);
    // a column: each step below the previous, same centre line
    for (let i = 1; i < 3; i += 1) {
      expect(m.steps[i].t).toBeGreaterThanOrEqual(m.steps[i - 1].b - 0.5);
      expect(Math.abs(m.steps[i].cx - m.steps[0].cx)).toBeLessThan(2);
    }
    // inside a step: icon and text on one row, icon first
    m.rows.forEach((row) => {
      expect(Math.abs(row.icon.cy - row.text.cy)).toBeLessThan(6);
      expect(row.icon.l).toBeLessThan(row.text.l);
    });
    // an arrow picture between each pair of steps
    expect(m.arrows).toHaveLength(2);
    m.arrows.forEach((arrow, i) => {
      expect(arrow.t).toBeGreaterThanOrEqual(m.steps[i].b - 0.5);
      expect(arrow.b).toBeLessThanOrEqual(m.steps[i + 1].t + 0.5);
      expect(arrow.w).toBeGreaterThan(8);
    });
    expect(m.maxRight).toBeLessThanOrEqual(m.card.r + 0.5);

    // Colour travelled: the arrow picture is painted in its computed colour, not black.
    const painted = await page.evaluate(async () => {
      const img = document.querySelectorAll('#card img')[1];
      const loaded = new Image(); loaded.src = img.src; await loaded.decode();
      const canvas = document.createElement('canvas'); canvas.width = 24; canvas.height = 24;
      const ctx = canvas.getContext('2d'); ctx.drawImage(loaded, 0, 0, 24, 24);
      const data = ctx.getImageData(0, 0, 24, 24).data;
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 200) return [data[i], data[i + 1], data[i + 2]];
      return null;
    });
    expect(painted).toEqual([143, 143, 143]);

    // Size: an ordinary answer is not larger than it was before layout support (HEAD's content-utils).
    const sizeNow = await page.evaluate((markup) => { document.getElementById('src').innerHTML = markup; return window.ContentUtils.buildInlineHtml(document.getElementById('src'), { includeRoot: false }).length; }, ORDINARY);
    const old = headVersion();
    if (old) {
      const page2 = await browser.newPage({ viewport: { width: 1500, height: 900 } });
      await page2.addInitScript(() => { window.chrome = { runtime: { id: 'x', sendMessage() {} } }; });
      await page2.setContent(`<style>${PAGE_CSS}</style><div id="src">${ORDINARY}</div>`);
      await page2.addScriptTag({ content: old });
      const sizeBefore = await page2.evaluate(() => window.ContentUtils.buildInlineHtml(document.getElementById('src'), { includeRoot: false }).length);
      console.log('ordinary answer html size: before', sizeBefore, 'after', sizeNow);
      expect(sizeNow).toBeLessThanOrEqual(sizeBefore);
    }
    const schemeNow = html.length;
    console.log('DIL scheme html size', schemeNow, 'for', (await page.evaluate(() => document.getElementById('src').textContent.length)), 'chars of the ordinary text');
  } finally {
    await browser.close();
  }
}, 120000);
