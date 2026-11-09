/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');

const results = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
require('../results/basic-card-verdict.js');

const sameAnswer = (a, b) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
const bodyWith = (html) => {
  const body = document.createElement('div');
  body.innerHTML = html;
  return body;
};

describe('лента Basic показывает ответ с форматированием страницы', () => {
  test('ответ пакета хранит html и передаёт его в карточку', () => {
    expect(results.match(/answerHtml: String\(envelope\.answerHtml \|\| envelope\.html \|\| ''\)/g)).toHaveLength(2);
    expect(results).toContain('updateDebateModelCardOutput(model, text, replyHtml, {');
    expect(results).toContain('updateDebateModelCardOutput(entry.model, answer, replyHtml, {');
    expect(results).not.toContain("updateDebateModelCardOutput(model, text, '', {");
    expect(results).not.toContain("updateDebateModelCardOutput(entry.model, answer, '', {");
  });

  test('запись только текста не трогает карточку с тем же ответом в форматировании', () => {
    const body = bodyWith('<h2>Итог</h2><ul><li>Первый пункт</li></ul>');
    expect(window.BasicCardVerdict.keepsStructure(body, 'ИтогПервый пункт', sameAnswer)).toBe(true);
  });

  test('другой ответ или карточка без форматирования записываются', () => {
    expect(window.BasicCardVerdict.keepsStructure(bodyWith('<h2>Итог</h2>'), 'Другой ответ', sameAnswer)).toBe(false);
    expect(window.BasicCardVerdict.keepsStructure(bodyWith('<p>Итог</p>'), 'Итог', sameAnswer)).toBe(false);
    expect(window.BasicCardVerdict.keepsStructure(null, 'Итог', sameAnswer)).toBe(false);
  });
});

describe('markdown-копия карточки', () => {
  const start = results.indexOf('const applyAnswerCopyToCard = ');
  const end = results.indexOf('const paintCopyMarker = ', start);
  const apply = (pending) => new Function('answerCopyPending', 'paintCopyMarker', `${results.slice(start, end)}; return applyAnswerCopyToCard;`)(pending, () => {});

  test('повторная запись того же запроса копию не стирает', () => {
    const pending = { GPT: { markdown: '## md', report: null, requestId: 'r1' } };
    const card = document.createElement('div');
    const applyCopy = apply(pending);
    applyCopy(card, 'GPT', 'r1');
    applyCopy(card, 'GPT', 'r1');
    expect(card._answerCopy.markdown).toBe('## md');
  });

  test('ответ другого запроса копию снимает', () => {
    const pending = { GPT: { markdown: '## md', report: null, requestId: 'r1' } };
    const card = document.createElement('div');
    const applyCopy = apply(pending);
    applyCopy(card, 'GPT', 'r1');
    applyCopy(card, 'GPT', 'r2');
    expect(card._answerCopy).toBeUndefined();
  });
});
