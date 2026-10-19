/** @jest-environment jsdom */
// Mermaid in an answer card: the block shows the rendered DIAGRAM (local mermaid library, test double here), with a
// Diagram | Code switch; on any failure it stays CODE with a visible note; no empty block, no duplicates, no repeated render.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const SOURCE = 'flowchart LR\n  A[Start] --> B{Check}\n  B -->|yes| C[Done]';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 200.4 100.2" style="max-width: 200px; background-color: white"><g><text x="1" y="1">A</text></g></svg>';
const block = (src = SOURCE) => `<pre data-code-lang="mermaid"><code class="language-mermaid">${src}</code></pre>`;

let tools;
let mermaid;
function setup(render) {
  if (window.ResultsCodeBlocks) window.ResultsCodeBlocks.dispose();
  delete window.ResultsCodeBlocks;
  window.eval(read('results/code-blocks.js'));
  tools = window.ResultsCodeBlocks;
  mermaid = { initialize: jest.fn(), render: jest.fn(render || (async () => ({ svg: SVG }))) };
  tools.setMermaidLoader(jest.fn(async () => mermaid));
}
const card = (html) => { document.body.innerHTML = `<div class="debate-model-card-output" id="out">${html}</div>`; return document.getElementById('out'); };
const settle = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };
const wrapperOf = (out) => out.querySelector('.code-block');

afterEach(() => { if (window.ResultsCodeBlocks) window.ResultsCodeBlocks.dispose(); });

describe('rendered diagram', () => {
  test('the block shows the picture by default: image from the svg, no max-width style, viewBox size, switch in the header', async () => {
    setup();
    const out = card(`<p>text</p>${block()}`);
    tools.install(document);
    await settle();
    const wrapper = wrapperOf(out);
    expect(wrapper.classList.contains('is-diagram')).toBe(true);
    expect(wrapper.dataset.mode).toBe('diagram');
    const img = wrapper.querySelector('.code-block-diagram img');
    expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(img.getAttribute('width')).toBe('200');
    expect(img.getAttribute('height')).toBe('100');
    const decoded = Buffer.from(img.getAttribute('src').split(',')[1], 'base64').toString('utf8');
    expect(decoded).not.toMatch(/max-width/);
    expect(decoded).toContain('viewBox="0 0 200.4 100.2"');
    expect(wrapper.querySelectorAll('.code-block-view')).toHaveLength(2);
    expect(wrapper.querySelector('.code-block-header').getAttribute('data-lang')).toBe('mermaid');
    expect(wrapper.querySelectorAll('.code-block-copy')).toHaveLength(1);
  });

  test('mermaid is initialised once, strict, without auto start and without html labels; the library loads only on the first diagram', async () => {
    setup();
    card('<pre><code class="language-js">x()</code></pre>');
    tools.install(document);
    await settle();
    expect(mermaid.initialize).not.toHaveBeenCalled(); // no diagram yet: nothing loaded
    document.getElementById('out').innerHTML = block();
    await settle();
    await settle();
    expect(mermaid.initialize).toHaveBeenCalledTimes(1);
    const config = mermaid.initialize.mock.calls[0][0];
    expect(config).toMatchObject({ layout: 'dagre', startOnLoad: false, securityLevel: 'strict', htmlLabels: false });
    expect(['default', 'dark']).toContain(config.theme);
  });

  test('the switch shows the source (exact) and the diagram again; Copy copies the source in both modes', async () => {
    setup();
    const out = card(block());
    tools.install(document);
    await settle();
    const writeText = jest.fn(async () => {});
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    const wrapper = wrapperOf(out);
    wrapper.querySelector('.code-block-view[data-view="code"]').click();
    expect(wrapper.dataset.mode).toBe('code');
    expect(wrapper.querySelector('pre code').textContent).toBe(SOURCE);
    wrapper.querySelector('.code-block-copy').click();
    await settle();
    expect(writeText).toHaveBeenLastCalledWith(SOURCE);
    wrapper.querySelector('.code-block-view[data-view="diagram"]').click();
    expect(wrapper.dataset.mode).toBe('diagram');
    wrapper.querySelector('.code-block-copy').click();
    await settle();
    expect(writeText).toHaveBeenLastCalledWith(SOURCE);
  });

  test('the card text is unchanged by the diagram furniture', async () => {
    setup();
    const out = card(`<p>text</p>${block()}`);
    const before = out.textContent;
    tools.install(document);
    await settle();
    expect(out.textContent.replace(SOURCE, '')).toBe(before.replace(SOURCE, ''));
    expect(out.textContent).toBe(before);
  });
});

describe('failures keep the code, with a note', () => {
  const noteOf = (out) => wrapperOf(out).querySelector('.code-block-diagram').getAttribute('data-note');

  test('a syntax error: code mode, the first line of the reason in the note, the switch is not offered', async () => {
    setup(async () => { throw new Error('Parse error on line 2:\n...expecting SEMI\nmore detail'); });
    const out = card(block('flowchart LR\n  A -->'));
    tools.install(document);
    await settle();
    const wrapper = wrapperOf(out);
    expect(wrapper.dataset.diagram).toBe('failed');
    expect(wrapper.dataset.mode).toBe('code');
    expect(noteOf(out)).toBe('Не удалось отрисовать диаграмму: Parse error on line 2:');
    expect(wrapper.querySelector('img')).toBeNull();
    expect(wrapper.querySelector('pre code').textContent).toBe('flowchart LR\n  A -->');
    wrapper.querySelector('.code-block-view[data-view="diagram"]').click();
    expect(wrapper.dataset.mode).toBe('code'); // nothing to switch to
  });

  test('no library: code with a note', async () => {
    setup();
    tools.setMermaidLoader(async () => { throw new Error('Failed to fetch dynamically imported module'); });
    const out = card(block());
    tools.install(document);
    await settle();
    expect(wrapperOf(out).dataset.mode).toBe('code');
    expect(noteOf(out)).toContain('Не удалось отрисовать диаграмму: Failed to fetch');
  });

  test('a render that does not finish in 5 s: code with a note, the card is not blocked', async () => {
    jest.useFakeTimers();
    setup(() => new Promise(() => {}));
    const out = card(block());
    tools.install(document);
    await jest.advanceTimersByTimeAsync(10);
    expect(wrapperOf(out).dataset.mode).toBe('code'); // the code shows while it renders
    await jest.advanceTimersByTimeAsync(tools.MERMAID_TIMEOUT_MS + 10);
    jest.useRealTimers();
    await settle();
    expect(noteOf(out)).toContain('превышено время отрисовки');
  });

  test('while rendering, the code is shown (never an empty block)', async () => {
    let finish;
    setup(() => new Promise((resolve) => { finish = resolve; }));
    const out = card(block());
    tools.install(document);
    await settle();
    expect(wrapperOf(out).dataset.mode).toBe('code');
    expect(wrapperOf(out).dataset.diagram).toBe('loading');
    finish({ svg: SVG });
    await settle();
    expect(wrapperOf(out).dataset.mode).toBe('diagram');
  });
});

describe('idempotence and cache', () => {
  test('decorating again adds nothing and renders nothing again; the same source in another card is drawn at once without a second render', async () => {
    setup();
    const out = card(block());
    tools.install(document);
    await settle();
    tools.decorateCodeBlocks(out);
    tools.decorateCodeBlocks(out);
    await settle();
    expect(out.querySelectorAll('.code-block')).toHaveLength(1);
    expect(out.querySelectorAll('img')).toHaveLength(1);
    expect(mermaid.render).toHaveBeenCalledTimes(1);
    // the card is rendered again (new html): the cache answers synchronously
    out.innerHTML = block();
    tools.decorateCodeBlocks(out);
    const wrapper = wrapperOf(out);
    expect(wrapper.dataset.diagram).toBe('ready');
    expect(wrapper.dataset.mode).toBe('diagram');
    expect(mermaid.render).toHaveBeenCalledTimes(1);
  });

  test('saved html that still says "ready" or "loading" but has no picture is drawn again', async () => {
    setup();
    const out = card(`<div class="code-block is-diagram" data-diagram="ready" data-mode="diagram">${block()}</div>`);
    tools.install(document);
    await settle();
    expect(out.querySelectorAll('img')).toHaveLength(1);
    expect(out.querySelectorAll('.code-block-copy')).toHaveLength(1);
  });
});

describe('stylesheet', () => {
  test('the page stylesheet hides the code in diagram mode and the picture in code mode, and fits the picture to the card', () => {
    const css = read('styles/modals-responsive.css');
    expect(css).toMatch(/\.code-block\.is-diagram\[data-mode="diagram"\] pre\{position:absolute;width:1px;height:1px;/);
    expect(css).toMatch(/\.code-block\.is-diagram\[data-mode="code"\] \.code-block-diagram:not\(\[data-failed\]\)\{display:none\}/);
    expect(css).toMatch(/\.code-block-diagram img\{max-width:100%;height:auto/);
    expect(css).toContain('.code-block-view[data-view="diagram"]::before{content:"Диаграмма"}');
  });
});
