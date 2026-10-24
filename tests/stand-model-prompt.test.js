/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');

const STAND = path.join(__dirname, '../docs/Pipeline scenarios/canvas-prototype');

// Загрузка стенда так же, как в tests/stand-validate.test.js.
document.body.innerHTML = '<div id="pipelineFlow"></div>';
require(path.join(STAND, 'state.js'));
window.BasicSchema = require('../disput/basic-schema');
window.ProtoBasicExport = require(path.join(STAND, 'basic-export.js'));
require(path.join(STAND, 'stand.js'));

const prompt = fs.readFileSync(path.join(STAND, 'model-prompt.md'), 'utf8');
const jsonBlocks = [...prompt.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
const NEW_WARN = ['Ответ User «', 'Артефакт объявлен в раунде из нескольких моделей', 'models['];
const isNewWarn = (msg) => NEW_WARN.some((p) => msg.startsWith(p)) || (msg.startsWith('Этап ') && msg.includes('все модели уже получали'));

describe('model-prompt.md: примеры и правила', () => {
  test('каждый пример JSON валиден, без ошибок стенда и без новых предупреждений', () => {
    expect(jsonBlocks.length).toBeGreaterThanOrEqual(2);
    jsonBlocks.forEach((text) => {
      const parsed = JSON.parse(text);
      const issues = window.ProtoStand.validate(text).issues;
      expect(issues.filter((i) => i.level === 'error')).toEqual([]);
      if (Array.isArray(parsed.steps)) {
        expect(issues.filter((i) => i.level === 'warn' && isNewWarn(i.msg))).toEqual([]);
      }
    });
  });

  test('запрос содержит ключевые слова новых правил', () => {
    expect(prompt).toContain('ЗАМЕНЯЕТ');
    expect(prompt).toContain('document');
    expect(prompt).toContain('chat');
    expect(prompt.toLowerCase()).toContain('в basic сейчас');
    expect(prompt).toContain('ПОЛНЫЙ текст');
    expect(prompt).toContain('по названию');
  });
});
