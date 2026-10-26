/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');

const STAND = path.join(__dirname, '../docs/Pipeline scenarios/canvas-prototype');
const canvasSource = fs.readFileSync(path.join(STAND, 'canvas.js'), 'utf8');

const emptyDiscipline = () => ({ limit: '', content: '', delivery: '', correction: '', lines: [] });
const model = (name) => ({ name, enabled: true, role: 'None', task: '', request: '', maxWords: '', discipline: emptyDiscipline() });

describe('S-6: превью запроса на стенде берёт задание раунда при входе «ничего»', () => {
  beforeAll(() => {
    window.ProtoState = {
      models: ['Claude'],
      selectedModel: 'Claude',
      defaults: { roundTask: 'ОБЩЕЕ', discipline: emptyDiscipline(), modelNotes: {}, roundPrompts: {} },
      run: { policy: 'auto', maxWords: 300 },
      rounds: [
        { ref: 'r1', input: 'none', task: 'ЗАДАНИЕ-РАУНДА', role: 'None', models: [model('Claude')], artifacts: [] },
        { ref: 'r2', input: 'previous', task: 'ЗАДАНИЕ-РАУНДА', role: 'None', models: [model('Claude')], artifacts: [] }
      ],
      emptyDiscipline,
      protoModel: model,
      onChange() {}
    };
    // eslint-disable-next-line global-require
    require(path.join(STAND, 'cards.js'));
  });

  test('S-6: при входе «ничего» запрос содержит задание раунда и не содержит общее из ▶', () => {
    const text = window.ProtoCards.previewPrompt('round', 0, 'Claude');
    expect(text).toContain('Задание:\nЗАДАНИЕ-РАУНДА');
    expect(text).not.toContain('ОБЩЕЕ');
  });

  test('S-6: при входе «предыдущий» задание раунда попадает в запрос', () => {
    const text = window.ProtoCards.previewPrompt('round', 1, 'Claude');
    expect(text).toContain('Задание:\nЗАДАНИЕ-РАУНДА');
  });
});

describe('S-8: холст хранит роли id, галочка Send убрана', () => {
  test('S-8: в canvas.js нет чекбокса Send', () => {
    expect(canvasSource).not.toContain('model-send-checkbox');
  });

  test('S-8: в canvas.js роли заданы id (interaction_meta_synthesis)', () => {
    expect(canvasSource).toContain('interaction_meta_synthesis');
  });

  test('S-8: в canvas.js нет sourceMode: \'send\'', () => {
    expect(canvasSource).not.toContain("sourceMode: 'send'");
  });
});
