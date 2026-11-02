const fs = require('fs');
const path = require('path');

// Список pipelines: три колонки по четыре схемы, дальше следующий ряд колонок. Проверка по исходникам
// (renderPipelineList живёт внутри замыкания results.js и без полной страницы не вызывается).
const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const blockOf = (css, selector) => {
  const start = css.lastIndexOf(`\n${selector} {`);
  if (start === -1) return '';
  return css.slice(start, css.indexOf('}', start));
};

describe('pipeline items three-column layout', () => {
  test('pipeline.css: сетка из трёх колонок, места выставляет скрипт', () => {
    const block = blockOf(read('styles/pipeline.css'), '.pipeline-items');
    expect(block).toContain('display: grid;');
    expect(block).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    expect(block).not.toContain('grid-auto-flow: column');
    expect(block).not.toContain('--pipeline-rows');
  });

  test('results.js: layoutPipelineItems размещает по четыре в колонке и после двенадцати начинает новый ряд', () => {
    const js = read('results.js');
    expect(js).toContain('const PIPELINE_ITEMS_PER_COLUMN = 4;');
    expect(js).toContain('const PIPELINE_ITEM_COLUMNS = 3;');
    const start = js.indexOf('const renderPipelineList');
    const end = js.indexOf('const getPipelineNamesFromDom', start);
    expect(js.slice(start, end)).toContain('layoutPipelineItems();');
  });

  test('формула мест: 1-4 — колонка 1, 5-8 — колонка 2, 9-12 — колонка 3, 13-й — колонка 1 во втором ряду', () => {
    const place = (index) => {
      const inBlock = index % 12;
      return [Math.floor(inBlock / 4) + 1, Math.floor(index / 12) * 4 + (inBlock % 4) + 1];
    };
    expect(place(0)).toEqual([1, 1]);
    expect(place(3)).toEqual([1, 4]);
    expect(place(4)).toEqual([2, 1]);
    expect(place(11)).toEqual([3, 4]);
    expect(place(12)).toEqual([1, 5]);
    expect(place(17)).toEqual([2, 6]);
  });
});
