/** @jest-environment jsdom */
// The look of the diagrams WE draw from mermaid source: neutral monochrome (Perplexity-like), light and dark; the panel colors follow
// the page theme at the moment of drawing. A diagram that arrives as a picture of the source page's svg is never touched by this.
const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><g><text x="1" y="1">A</text></g></svg>';
let tools;
let mermaid;
const load = () => {
  if (window.ResultsCodeBlocks) window.ResultsCodeBlocks.dispose();
  delete window.ResultsCodeBlocks;
  window.eval(read('results/code-blocks.js'));
  tools = window.ResultsCodeBlocks;
  mermaid = { initialize: jest.fn(), render: jest.fn(async () => ({ svg: SVG })) };
  tools.setMermaidLoader(jest.fn(async () => mermaid));
};
const settle = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };
afterEach(() => { if (window.ResultsCodeBlocks) window.ResultsCodeBlocks.dispose(); document.body.removeAttribute('style'); });

describe('diagramConfig', () => {
  beforeEach(load);

  test('light: base theme with white blocks, thin grey borders, dark-grey lines, grey panel', () => {
    const c = tools.diagramConfig(false);
    expect(c).toMatchObject({ theme: 'base', look: 'classic', layout: 'dagre', securityLevel: 'strict', htmlLabels: false });
    expect(c.flowchart).toMatchObject({ htmlLabels: false, curve: 'linear' });
    expect(c.themeVariables).toMatchObject({
      background: '#f1f1f1', mainBkg: '#ffffff', nodeBkg: '#ffffff', primaryColor: '#ffffff', primaryBorderColor: '#d6d6d6', nodeBorder: '#d6d6d6',
      primaryTextColor: '#1f1f1f', textColor: '#1f1f1f', lineColor: '#666666', arrowheadColor: '#666666', secondaryColor: '#ffffff',
      tertiaryColor: '#f1f1f1', clusterBkg: '#f7f7f7', clusterBorder: '#d6d6d6', edgeLabelBackground: '#f1f1f1',
      noteBkgColor: '#ffffff', noteBorderColor: '#d6d6d6', noteTextColor: '#1f1f1f',
      actorBkg: '#ffffff', actorBorder: '#d6d6d6', actorTextColor: '#1f1f1f', actorLineColor: '#bdbdbd', signalColor: '#444444', signalTextColor: '#444444',
      labelBoxBkgColor: '#ffffff', labelBoxBorderColor: '#d6d6d6', stateBkg: '#ffffff', stateBorder: '#d6d6d6', specialStateColor: '#5f5f5f', transitionColor: '#666666'
    });
    expect(c.themeVariables.fontFamily).toMatch(/system-ui/);
    expect(c.themeVariables.fontSize).toBe('14px');
    expect(JSON.stringify(c)).not.toMatch(/ECECFF|9370DB/i);
  });

  test('dark: neutral dark set', () => {
    const c = tools.diagramConfig(true);
    expect(c.theme).toBe('base');
    expect(c.themeVariables).toMatchObject({ darkMode: true, background: '#2b2b2b', nodeBkg: '#3a3a3a', nodeBorder: '#555555', textColor: '#eeeeee', lineColor: '#aaaaaa', edgeLabelBackground: '#2b2b2b' });
  });
});

describe('the theme follows the page at the moment of drawing', () => {
  const draw = async (bodyBg) => {
    load();
    document.body.style.backgroundColor = bodyBg;
    document.body.innerHTML = '<div class="debate-model-card-output" id="out"><pre data-code-lang="mermaid"><code class="language-mermaid">flowchart LR\n A-->B</code></pre></div>';
    tools.install(document);
    await settle(); await settle();
    return document.querySelector('.code-block');
  };
  test('light page: light config, light panel marker', async () => {
    const wrapper = await draw('rgb(255, 255, 255)');
    expect(mermaid.initialize.mock.calls.pop()[0].themeVariables.background).toBe('#f1f1f1');
    expect(wrapper.dataset.diagramTheme).toBe('light');
  });
  test('dark page: dark config, dark panel marker', async () => {
    const wrapper = await draw('rgb(20, 20, 20)');
    expect(mermaid.initialize.mock.calls.pop()[0].themeVariables.background).toBe('#2b2b2b');
    expect(wrapper.dataset.diagramTheme).toBe('dark');
  });
});

test('panel CSS: light grey, rounded, padded, no frame; dark by the marker', () => {
  const css = read('styles/modals-responsive.css');
  expect(css).toMatch(/\.code-block-diagram\{padding:16px 20px;background:#f1f1f1;border-radius:8px;text-align:center\}/);
  expect(css).toMatch(/\.code-block\.is-diagram\{border:0;background:transparent\}/);
  expect(css).toMatch(/data-diagram-theme="dark"\] \.code-block-diagram:not\(\[data-failed\]\)\{background:#2b2b2b\}/);
});
