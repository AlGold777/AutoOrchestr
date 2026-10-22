/** @jest-environment jsdom */
// A diagram rendered into an OPEN SHADOW ROOT (Claude: div[data-mermaid][role=img] with the svg inside the
// shadow) is invisible to cloneNode and querySelectorAll: it must still reach answerHtml as a picture,
// carrying the shadow-level styles, and count as a block for the completeness check.
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

const SHADOW_CSS = '.node rect{fill:#ececff;stroke:#9370db}.edgeLabel{background:#fff}';
const SVG = `<svg id="mermaid-r1-b1" aria-roledescription="flowchart-v2" viewBox="0 0 306 1388" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-width:306px">
  <style>#mermaid-r1-b1 .label{font-family:sans-serif}</style>
  <g><g class="node default src" id="mermaid-r1-b1-flowchart-O1-7"><rect width="120" height="40"/><text>Задачи</text></g>
  <g class="node default core" id="mermaid-r1-b1-flowchart-R1-3"><rect y="80" width="120" height="40"/><text>Ядро</text></g></g></svg>`;

function addDiagram(parent, { css = SHADOW_CSS, svg = SVG, label = 'Диаграмма Mermaid' } = {}) {
  const host = document.createElement('div');
  host.setAttribute('dir', 'ltr');
  host.setAttribute('data-mermaid', 'true');
  host.setAttribute('role', 'img');
  host.setAttribute('aria-label', label);
  parent.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${css}</style><div>${svg}</div>`;
  const inner = shadow.querySelector('svg');
  sizeOf(inner, 306, 1388);
  return { host, shadow, svg: inner };
}
const page = () => {
  document.body.innerHTML = '<main><div data-message-author-role="assistant" id="msg"><p>Answer text that is long enough to be chosen as the answer.</p><div id="slot"></div><p>After the diagram.</p></div></main>';
  return document.getElementById('slot');
};
const hostOf = (html) => { const h = document.createElement('div'); h.innerHTML = html; return h; };

beforeEach(() => {
  ['ContentUtils', 'AnswerStructure', 'AnswerMarkdown'].forEach((k) => { delete window[k]; });
  window.chrome = { runtime: { id: 'x', sendMessage: jest.fn() } };
  window.eval(read('content-scripts/answer-html-builder.js'));
  window.eval(read('content-scripts/content-utils.js'));
  window.eval(read('content-scripts/answer-structure.js'));
});

describe('shadow-hosted diagram -> picture', () => {
  test('buildInlineHtml: the host becomes one <img> with the aria-label as alt; no empty div is left', () => {
    addDiagram(page());
    const html = window.ContentUtils.buildInlineHtml(document.getElementById('msg'), { includeRoot: false });
    const host = hostOf(html);
    const imgs = host.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('alt')).toBe('Диаграмма Mermaid');
    expect(host.querySelector('[data-mermaid], [role="img"]')).toBeNull();
    expect(host.querySelectorAll('div')).toHaveLength(1); // only the old #slot wrapper, nothing empty inside it
    expect(host.querySelector('#slot').children).toHaveLength(1);
  });

  test('the shadow-level styles and the svg\'s own styles are both inside the picture', () => {
    addDiagram(page());
    const img = hostOf(window.ContentUtils.buildInlineHtml(document.getElementById('msg'), { includeRoot: false })).querySelector('img');
    const svg = decode(img.getAttribute('src'));
    expect(svg).toContain('.node rect{fill:#ececff;stroke:#9370db}');
    expect(svg).toContain('#mermaid-r1-b1 .label{font-family:sans-serif}');
    expect(svg.indexOf('.node rect')).toBeLessThan(svg.indexOf('<g'));
    expect(svg).toContain('Задачи');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).not.toMatch(/max-width/);
  });

  test('a small icon in a shadow host stays out; two diagrams in one host give two pictures', () => {
    const slot = page();
    const icon = addDiagram(slot, { svg: '<svg viewBox="0 0 16 16"><path d="M0 0"/></svg>', label: 'icon' });
    sizeOf(icon.svg, 16, 16);
    expect(hostOf(window.ContentUtils.buildInlineHtml(document.getElementById('msg'), { includeRoot: false })).querySelector('img')).toBeNull();

    const two = addDiagram(page(), {});
    const second = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    second.innerHTML = '<g><rect width="10" height="10"/><text>B</text></g>';
    second.setAttribute('viewBox', '0 0 300 200');
    two.shadow.appendChild(second);
    sizeOf(second, 300, 200);
    const host = hostOf(window.ContentUtils.buildInlineHtml(document.getElementById('msg'), { includeRoot: false }));
    expect(host.querySelectorAll('img')).toHaveLength(2);
  });

  test('the in-page extractor does the same, with the same picture', () => {
    addDiagram(page());
    const fromPage = hostOf(window.ContentUtils.buildInlineHtml(document.getElementById('msg'), { includeRoot: false })).querySelector('img');
    const out = extractor('GPT', 10, {});
    expect(out.ok).toBe(true);
    const img = hostOf(out.html).querySelector('img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('alt')).toBe('Диаграмма Mermaid');
    expect(decode(img.getAttribute('src'))).toBe(decode(fromPage.getAttribute('src')));
    expect(hostOf(out.html).querySelector('[data-mermaid]')).toBeNull();
  });

  test('an svg in a shadow host inside a button-like wrapper is judged by the same rules (crossing the shadow border)', () => {
    const slot = page();
    const wrapper = document.createElement('div');
    wrapper.setAttribute('role', 'button');
    slot.appendChild(wrapper);
    addDiagram(wrapper);
    const imgs = hostOf(window.ContentUtils.buildInlineHtml(document.getElementById('msg'), { includeRoot: false })).querySelectorAll('img');
    expect(imgs).toHaveLength(1); // looks like a diagram (text inside): kept
    // and inside page chrome it is dropped
    const slot2 = page();
    const nav = document.createElement('nav');
    slot2.appendChild(nav);
    addDiagram(nav);
    expect(hostOf(window.ContentUtils.buildInlineHtml(document.getElementById('msg'), { includeRoot: false })).querySelector('img')).toBeNull();
  });
});

describe('AnswerStructure sees the host as a block', () => {
  test('a shadow host with a picture is a non-text block, counted once', () => {
    const slot = page();
    addDiagram(slot);
    const blocks = window.AnswerStructure.enumerateContentBlocks(document.getElementById('msg'));
    const hosts = blocks.filter((block) => block.nonText);
    expect(hosts).toHaveLength(1);
    expect(hosts[0].role).toBe('img');
    // the paragraphs are still blocks, and nothing from inside the shadow is listed again
    expect(blocks.filter((block) => block.tag === 'p')).toHaveLength(2);
    expect(blocks.some((block) => block.tag === 'text' || block.tag === 'g')).toBe(false);
  });

  test('an answer element that leaves the diagram out is reported as not covering the message', () => {
    const slot = page();
    addDiagram(slot);
    const root = document.getElementById('msg');
    const paragraph = root.querySelector('p');
    const report = window.AnswerStructure.inspect(root, paragraph);
    expect(report.complete).toBe(false);
    expect(report.issues).toContain('uncovered_message_blocks');
    expect(report.omittedBlocks.some((block) => block.nonText && block.role === 'img')).toBe(true);
    expect(window.AnswerStructure.inspect(root, root).complete).toBe(true);
  });
});
