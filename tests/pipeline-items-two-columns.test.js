const fs = require('fs');
const path = require('path');

// Список pipelines: ровно две колонки, все шаблоны видны. Проверка по исходникам
// (renderPipelineList живёт внутри замыкания results.js и без полной страницы не вызывается).
const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// Берёт последний блок селектора: в pipeline.css .pipeline-items встречается дважды, актуален grid-блок ниже.
const blockOf = (css, selector) => {
  const start = css.lastIndexOf(`\n${selector} {`);
  if (start === -1) return '';
  return css.slice(start, css.indexOf('}', start));
};

describe('pipeline items two-column layout', () => {
  test('pipeline.css: строки задаются через --pipeline-rows, без жёстких трёх строк', () => {
    const css = read('styles/pipeline.css');
    const block = blockOf(css, '.pipeline-items');
    expect(block).toContain('grid-template-rows: repeat(var(--pipeline-rows, 8), max-content)');
    expect(block).toContain('grid-auto-columns: minmax(0, 1fr)');
    expect(block).toContain('width: calc(100% - 20px)');
    expect(block).not.toContain('repeat(3, max-content)');
    expect(block).not.toContain('170px');
    expect(block).toContain('display: grid;');
  });

  test('results.js: renderPipelineList выставляет --pipeline-rows = ceil(N/2), минимум 1', () => {
    const js = read('results.js');
    const start = js.indexOf('const renderPipelineList');
    const end = js.indexOf('const getPipelineNamesFromDom', start);
    const body = js.slice(start, end);
    expect(body).toContain(
      "pipelineItems.style.setProperty('--pipeline-rows', String(Math.max(1, Math.ceil(uniqueNames.length / 2))))"
    );
    // Строка с установкой переменной идёт после replaceChildren (после перестройки списка).
    expect(body.indexOf("setProperty('--pipeline-rows'")).toBeGreaterThan(body.indexOf('replaceChildren'));
  });

  test('формула rows: 15 имён -> 8, 1 имя -> 1, 0 имён -> 1', () => {
    const rows = (n) => Math.max(1, Math.ceil(n / 2));
    expect(rows(15)).toBe(8);
    expect(rows(1)).toBe(1);
    expect(rows(0)).toBe(1);
  });
});
