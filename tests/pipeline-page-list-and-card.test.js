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

describe('model card of the first round', () => {
  test('поле «Задание раунда» есть у любого раунда; у R1 без входа наследуется только задание шага', () => {
    expect(js).toContain(": [['task', 'Задание раунда'], ...disciplineRows];");
    expect(js).not.toContain("step.input !== 'none' ? [['task', 'Задание раунда']]");
    expect(js).toContain("step.input === 'none' ? (typeof step.task === 'string' ? step.task : '') : null");
    expect(js).toContain("key === 'task' ? (noInputTask ?? inherited.task.value)");
  });
});

describe('model block tooltip', () => {
  test('подсказка блока — запрос из карточки: свой запрос или автоматическая сборка, та же, что в окне модели', () => {
    expect(js).toContain('block.dataset.cardRequest = safeRead(() => customBlockRequestText(block), \'\') || model?.task || \'\';');
    expect(js).toContain('setCanvasTooltip(block, name && round ? `${name} - R${round}` : name, modelTooltipText(block.dataset.cardRequest));');
    const text = js.slice(js.indexOf('const customBlockRequestText'), js.indexOf('const customBlockRequestText') + 400);
    expect(text).toContain('promptTemplate');
    expect(text).toContain('customBlockRequestPreview(block)?.template');
    expect(js).toContain(': customBlockRequestPreview(block);');
  });

  test('в подсказке задача коротко и задание; строки {задача} и {вход} с их заголовками не показываются', () => {
    const from = js.indexOf('const FILLED_REQUEST_LINES');
    const source = js.slice(from, js.indexOf('const setModelTooltip', from));
    // eslint-disable-next-line no-new-func
    const build = (task, brief) => new Function('currentRunTask', 'taskBriefFor', `${source}; return modelTooltipText;`)(() => task, () => brief);
    const request = 'Задача:\n{задача}\n\nОтветы выбранных источников:\n\nВход:\n{вход}\n\nЗадание:\nНапиши итог.\n\nФормат ответа:\nСписок.';
    expect(build('Полная задача', 'Кратко о задаче')(request)).toBe('Кратко о задаче\n\nЗадание:\nНапиши итог.\n\nФормат ответа:\nСписок.');
    expect(build('а'.repeat(400), '')('Задача:\n{задача}')).toBe(`${'а'.repeat(300)}…`);
    expect(build('', '')('Ответы предыдущего шага:\n\nОтвет 1:\n{вход}\n\nЗадание:\nПроверь.')).toBe('Задача не введена.\n\nЗадание:\nПроверь.');
    expect(build('Задача', '')('Ты — критик. Разбери {задача} по пунктам.')).toBe('Задача\n\nТы — критик. Разбери {задача} по пунктам.');
  });
});
