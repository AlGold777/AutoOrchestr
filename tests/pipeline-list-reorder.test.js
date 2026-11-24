const fs = require('fs');
const path = require('path');

// Список pipelines: свою схему перетаскивают на другое место, шаблоны остаются первыми, порядок сохраняется.
// Проверка по исходникам: обработчики живут в замыкании results.js; чистая функция перестановки берётся из исходника.
const js = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

const sourceOf = (name) => {
  const start = js.indexOf(`const ${name} = `);
  const end = js.indexOf('\n        };', start);
  return js.slice(start, end + '\n        };'.length);
};
// eslint-disable-next-line no-new-func
const movePipelineInOrder = new Function(`${sourceOf('movePipelineInOrder')}\nreturn movePipelineInOrder;`)();

describe('pipeline list reorder', () => {
  const order = ['Default', 'A', 'B', 'C', 'Meta'];

  test('брошенная на шаблон схема встаёт сразу после него', () => {
    expect(movePipelineInOrder(order, 'Meta', 'Default', true)).toEqual(['Default', 'Meta', 'A', 'B', 'C']);
  });

  test('перед и после схемы под курсором', () => {
    expect(movePipelineInOrder(order, 'A', 'C', false)).toEqual(['Default', 'B', 'A', 'C', 'Meta']);
    expect(movePipelineInOrder(order, 'A', 'C', true)).toEqual(['Default', 'B', 'C', 'A', 'Meta']);
  });

  test('на себя или на неизвестное имя — порядок не меняется', () => {
    expect(movePipelineInOrder(order, 'A', 'A', true)).toEqual(order);
    expect(movePipelineInOrder(order, 'A', 'X', true)).toEqual(order);
  });

  test('перетаскиваются только свои схемы; порядок нормализуется, перерисовывается и сохраняется', () => {
    expect(js).toContain('item.draggable = allowDelete;');
    const start = js.indexOf("pipelineItems?.addEventListener('drop'");
    const drop = js.slice(start, js.indexOf('});', start));
    expect(drop).toContain('normalizePipelineOrder(movePipelineInOrder(');
    expect(drop).toContain('renderPipelineList(pipelineStore.order');
    expect(drop).toContain('persistPipelineStore();');
    const dragstart = js.slice(js.indexOf("pipelineItems?.addEventListener('dragstart'"));
    expect(dragstart.slice(0, 400)).toContain('pipelineRunActive');
  });
});
