const fs = require('fs');
const path = require('path');
test('Kimi: запрос вставляется paste-событием после selectionchange (отладчик отключён)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../content-scripts/content-kimi.js'), 'utf8');
  expect(src).toMatch(/pastePromptIntoLexical/);
  expect(src).toMatch(/new Event\('selectionchange'\)/);
  expect(src).toMatch(/new ClipboardEvent\('paste'/);
  expect(src).toMatch(/let prepared = await pastePromptIntoLexical/);
});
