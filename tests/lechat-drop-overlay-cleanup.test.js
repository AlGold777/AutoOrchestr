const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('Le Chat: оверлей «Drop your files here» закрывается после имитации перетаскивания', () => {
  test('обработчик вложений завершает перетаскивание для Le Chat', () => {
    const src = read('content-scripts/attachment-handler.js');
    const block = src.slice(src.indexOf("'Le Chat': {"));
    expect(block.slice(0, 200)).toContain('finishDragLifecycle: true');
  });

  test('собственная drop-последовательность Le Chat шлёт dragleave и dragend', () => {
    const src = read('content-scripts/content-lechat.js');
    const fn = src.slice(src.indexOf('const dispatchDropSequence'));
    expect(fn.slice(0, 1600)).toContain("['dragleave', 'dragend']");
  });
});
