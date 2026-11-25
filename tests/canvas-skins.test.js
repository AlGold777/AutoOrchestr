const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Скины холста pipeline', () => {
  const skinCss = read('styles/canvas-skin-minimal.css');

  test('скин подключён в styles.css и включается атрибутом на <html>', () => {
    expect(read('styles.css')).toContain('@import url("styles/canvas-skin-minimal.css");');
    expect(read('results.js')).toContain("document.documentElement.setAttribute('data-canvas-skin', skin.id)");
  });

  test('каждое правило скина ограничено атрибутом [data-canvas-skin="minimal"]', () => {
    const rules = skinCss.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.split('{')[0].trim()).filter(Boolean);
    expect(rules.length).toBeGreaterThan(10);
    rules.forEach((selectorList) => {
      selectorList.split(',').map((s) => s.trim()).forEach((selector) => {
        expect(selector.startsWith('[data-canvas-skin="minimal"]')).toBe(true);
      });
    });
  });

  test('переключатель есть в pipeline_panel.html, выбор хранится в localStorage', () => {
    expect(read('pipeline_panel.html')).toContain('id="pipeline-skin-toggle"');
    const js = read('results.js');
    expect(js).toContain("const CANVAS_SKIN_KEY = 'pipelineCanvasSkin';");
    expect(js).toContain("localStorage.setItem(CANVAS_SKIN_KEY, canvasSkin)");
  });

  test('скин не меняет размеры блоков и связей', () => {
    expect(skinCss).not.toMatch(/--pipeline-block-(width|height)/);
    // Связи скин только красит: свойства размеров и положения в их правилах запрещены.
    const paintOnly = ['stroke', 'stroke-width', 'stroke-linecap', 'fill', 'opacity'];
    const linkRules = skinCss.replace(/\/\*[\s\S]*?\*\//g, '').split('}')
      .map((rule) => rule.split('{'))
      .filter(([selector, body]) => body && /\.(connector-|merge-line|arrow-head)/.test(selector));
    expect(linkRules.length).toBeGreaterThan(0);
    linkRules.forEach(([, body]) => {
      body.split(';').map((line) => line.split(':')[0].trim()).filter(Boolean)
        .forEach((property) => expect(paintOnly).toContain(property));
    });
  });
});
