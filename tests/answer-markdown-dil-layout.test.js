/** @jest-environment jsdom */
// Declarative UI blocks (ChatGPT "DIL": data-d-component boxes/rows/arrows laid out with flex): the layout and the
// small block icons must reach answerHtml; an ordinary answer must not grow. Real layout is in the Chrome test.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const ORCH = read('background/job-orchestrator.js');

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
const extractor = new Function(`${sliceFunction(ORCH, 'extractLatestAssistantSnapshotInPage')}; return extractLatestAssistantSnapshotInPage;`)();
const decode = (src) => Buffer.from(src.replace('data:image/svg+xml;base64,', ''), 'base64').toString('utf8');
const sizeOf = (el, w, h) => { el.getBoundingClientRect = () => ({ width: w, height: h, top: 0, bottom: h, left: 0, right: w }); };

const CSS = `
  [data-d-direction="col"]{display:flex;flex-direction:column;align-items:center;gap:4px}
  [data-d-direction="row"]{display:flex;flex-direction:row;align-items:center;gap:8px}
  .card{padding:12px;border:1px solid rgba(0,0,0,.1);border-radius:8px}
  .icon{color:rgb(93, 93, 93)} .arrow{color:rgb(143, 143, 143)}`;
const ICON = '<svg data-d-component="icon" class="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M0 0h24"/><path d="M1 1"/></svg>';
const ARROW = '<svg data-d-component="icon" class="arrow" fill="currentColor" viewBox="0 0 24 24"><path d="M12 4l8 8"/></svg>';
const SCHEME = `<div data-d-component="box" data-d-direction="col" id="scheme">
  <div data-d-component="box" data-d-direction="col" class="card"><div data-d-component="row" data-d-direction="row">${ICON}<p data-d-component="text">Step one</p></div></div>
  ${ARROW}
  <div data-d-component="box" data-d-direction="col" class="card"><div data-d-component="row" data-d-direction="row">${ICON}<p data-d-component="text">Step two</p></div></div></div>`;

function mount(inner) {
  document.body.innerHTML = `<style>${CSS}</style><main><div data-message-author-role="assistant" id="msg"><p>${'Answer text long enough to be the answer. '.repeat(3)}</p>${inner}</div></main>`;
  document.querySelectorAll('#msg svg').forEach((svg) => sizeOf(svg, svg.classList.contains('arrow') ? 18 : 16, svg.classList.contains('arrow') ? 18 : 16));
}
const run = () => window.ContentUtils.buildInlineHtml(document.getElementById('msg'), { includeRoot: false });
const host = (html) => { const h = document.createElement('div'); h.innerHTML = html; return h; };

beforeEach(() => {
  delete window.ContentUtils;
  window.chrome = { runtime: { id: 'x', sendMessage: jest.fn() } };
  window.eval(read('content-scripts/answer-html-builder.js'));
  window.eval(read('content-scripts/content-utils.js'));
});

describe('layout of flex containers', () => {
  test('flex containers and their non-default values reach the html; defaults are not written', () => {
    mount(SCHEME);
    const out = host(run());
    const scheme = out.querySelector('div');
    const style = (el) => el.getAttribute('style') || '';
    const all = Array.from(out.querySelectorAll('div'));
    const flexBoxes = all.filter((el) => /display:flex/.test(style(el)));
    expect(flexBoxes.length).toBeGreaterThanOrEqual(5);
    const column = flexBoxes.find((el) => /flex-direction:column/.test(style(el)));
    expect(style(column)).toMatch(/align-items:center/);
    const row = flexBoxes.find((el) => !/flex-direction/.test(style(el)) && /align-items:center/.test(style(el)));
    expect(row).toBeTruthy(); // row is the default direction: not written
    expect(scheme).toBeTruthy();
  });

  test('an ordinary answer carries no layout and does not grow', () => {
    mount('<h2>Title</h2><ul><li>a</li><li>b</li></ul><pre><code>x = 1</code></pre><table><tr><td>c</td></tr></table>');
    const html = run();
    expect(html).not.toMatch(/display:|flex|grid|gap/);
    // markup + inline typography only: well under 3x the text for a short answer, and no layout tokens
    expect(html.length).toBeLessThan(document.getElementById('msg').textContent.length * 8 + 600);
  });
});

describe('block icons', () => {
  test('icons and the arrow between cards become <img data:image/svg+xml> with currentColor replaced', () => {
    mount(SCHEME);
    const out = host(run());
    const imgs = Array.from(out.querySelectorAll('img'));
    expect(imgs).toHaveLength(3); // two row icons and the arrow between the cards
    const svgs = imgs.map((img) => decode(img.getAttribute('src')));
    expect(svgs.every((svg) => !/currentColor/i.test(svg))).toBe(true);
    expect(svgs.filter((svg) => svg.includes('rgb(93, 93, 93)'))).toHaveLength(2);
    expect(svgs.filter((svg) => svg.includes('rgb(143, 143, 143)'))).toHaveLength(1);
    expect(imgs[0].getAttribute('width')).toBe('16');
    expect(imgs[0].getAttribute('alt')).toBe('');
    expect(out.querySelector('svg')).toBeNull();
  });

  test('a small svg outside a UI block, in a button, or aria-hidden is still cut', () => {
    mount(`<p>text ${ICON.replace('data-d-component="icon" ', '')}</p><button>${ICON}</button><div data-d-component="box"><span aria-hidden="true">${ICON}</span></div><div data-d-component="box" role="button">${ICON}</div>`);
    expect(host(run()).querySelector('img')).toBeNull();
  });

  test('over the limits icons are dropped silently, arrows between blocks are kept', () => {
    const many = `<div data-d-component="box" data-d-direction="col">${Array.from({ length: 80 }, () => `<div data-d-component="row" data-d-direction="row">${ICON}<p>t</p></div>`).join('')}</div>`;
    mount(many);
    expect(host(run()).querySelectorAll('img').length).toBe(60);
    mount(`<div data-d-component="box" data-d-direction="col">${Array.from({ length: 80 }, () => `<p>t</p>${ARROW}`).join('') + '<p>end</p>'}</div>`);
    const imgs = host(run()).querySelectorAll('img');
    expect(imgs.length).toBeGreaterThan(60);
    expect(window.ContentUtils.getLastInlineHtmlNotes()).toEqual([]); // no placeholder entries for decor
  });

  test('the in-page extractor produces the same pictures (it uses the same ContentUtils)', () => {
    mount(SCHEME);
    const out = extractor('GPT', 10, {});
    expect(out.ok).toBe(true);
    const fromPage = host(run()).querySelectorAll('img');
    const fromExtractor = host(out.html).querySelectorAll('img');
    expect(fromExtractor).toHaveLength(fromPage.length);
    expect(Array.from(fromExtractor, (i) => i.getAttribute('src'))).toEqual(Array.from(fromPage, (i) => i.getAttribute('src')));
  });
});

describe('sanitizer and card CSS leave the layout alone', () => {
  test('sanitizeHTML keeps display:flex styles and the icon pictures', () => {
    window.eval(read('lib/purify.min.js'));
    delete window.sanitizeHTML;
    window.eval(read('utils/sanitize.js'));
    mount(SCHEME);
    const clean = window.sanitizeHTML(run());
    const out = host(clean);
    expect(Array.from(out.querySelectorAll('div')).filter((el) => /display:\s*flex/.test(el.getAttribute('style') || '')).length).toBeGreaterThanOrEqual(5);
    expect(out.querySelectorAll('img')).toHaveLength(3);
  });

  test('no card or export rule overrides display on nested blocks', () => {
    const css = read('styles/modals-responsive.css');
    const rules = css.match(/\.debate-model-card-output[^{]*\{[^}]*\}/g) || [];
    expect(rules.filter((rule) => /\bdisplay\s*:/.test(rule) && /\b(div|\*)\b/.test(rule.split('{')[0]))).toEqual([]);
    expect(read('results/debate-export.js')).not.toMatch(/\.response-body div\s*\{[^}]*display/);
  });
});
