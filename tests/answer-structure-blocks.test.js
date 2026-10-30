/** @jest-environment jsdom */
// The flat answer text keeps its block structure (M-6, L-23): paragraphs, list items, table rows and code
// do not run together into one line. Inline text stays joined by spaces; acceptance still reads the same words.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function load() {
  delete window.AnswerStructure;
  window.eval(read('content-scripts/answer-structure.js'));
}
const flat = (html) => {
  document.body.innerHTML = `<div class="answer" id="a">${html}</div>`;
  return window.AnswerStructure.linearizeText(document.getElementById('a'));
};

beforeEach(load);

describe('linearizeText keeps paragraphs', () => {
  test('two paragraphs are separated by a blank line', () => {
    expect(flat('<p>Первый абзац.</p><p>Второй абзац.</p>')).toBe('Первый абзац.\n\nВторой абзац.');
  });

  test('a line break inside a paragraph is a single newline', () => {
    expect(flat('<p>строка один<br>строка два</p>')).toBe('строка один\nстрока два');
  });

  test('source line breaks between tags are not kept as line breaks', () => {
    expect(flat('<p>один\n   два</p>\n\n<p>три</p>')).toBe('один два\n\nтри');
  });
});

describe('linearizeText keeps lists and headings', () => {
  test('list items are separate lines', () => {
    expect(flat('<p>Пункты:</p><ul><li>первый</li><li>второй <b>жирный</b></li></ul>'))
      .toBe('Пункты:\n\nпервый\nвторой жирный');
  });

  test('a heading is its own block', () => {
    expect(flat('<h2>Раздел</h2><p>Текст раздела.</p>')).toBe('Раздел\n\nТекст раздела.');
  });
});

describe('linearizeText keeps table rows and code', () => {
  test('a table is one line per row, cells separated by a pipe', () => {
    const html = '<table><thead><tr><th>Замечание</th><th>Причина</th></tr></thead>'
      + '<tbody><tr><td>П.1</td><td>Принято частично</td></tr><tr><td>П.6</td><td>Отклонено</td></tr></tbody></table>';
    const text = flat(html);
    expect(text.split('\n')).toEqual(['Замечание | Причина', 'П.1 | Принято частично', 'П.6 | Отклонено']);
  });

  test('code keeps its own line breaks and indentation', () => {
    const text = flat('<p>Пример:</p><pre><code>def f(x):\n    return x\n</code></pre><p>Конец.</p>');
    expect(text).toContain('def f(x):\n    return x');
    expect(text.startsWith('Пример:\n\ndef f(x):')).toBe(true);
    expect(text.endsWith('Конец.')).toBe(true);
  });
});

describe('linearizeText keeps the words the acceptance reads', () => {
  test('the delivery mark stays in the text and the text has no extra blank runs', () => {
    const text = flat('<p>Итог.</p><p></p><p></p><p>[[AO-a1b2c3]]</p>');
    expect(text).toContain('[[AO-a1b2c3]]');
    expect(text).not.toMatch(/\n{3,}/);
  });

  test('a flat answer of plain words is unchanged', () => {
    expect(flat('<span>просто</span> <span>текст</span>')).toBe('просто текст');
  });
});

describe('linearizeText on the provider fixtures (M-6)', () => {
  const fixture = (name) => fs.readFileSync(path.join(ROOT, 'tests/fixtures/answer-markdown', `${name}.html`), 'utf8');

  test('the GPT table is one line per row: header, then the body row, cells joined by a pipe', () => {
    document.body.innerHTML = `<div id="a">${fixture('gpt').match(/<table.*<\/table>/)[0]}</div>`;
    const lines = window.AnswerStructure.linearizeText(document.getElementById('a')).split('\n');
    expect(lines).toEqual(['Key | Value', 'a | one']);
  });

  test('the DeepSeek table: header and row on their own lines, code kept inside its cell', () => {
    document.body.innerHTML = `<div id="a">${fixture('deepseek')}</div>`;
    const text = window.AnswerStructure.linearizeText(document.getElementById('a'));
    expect(text.split('\n')).toEqual(expect.arrayContaining(['A | B', 'x y|z | 1']));
  });

  test('the Qwen table: header and body row are separate lines', () => {
    document.body.innerHTML = `<div id="a">${fixture('qwen')}</div>`;
    const lines = window.AnswerStructure.linearizeText(document.getElementById('a')).split('\n');
    expect(lines).toEqual(expect.arrayContaining(['A', 'x']));
  });

});
