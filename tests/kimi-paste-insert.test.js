const fs = require('fs');
const path = require('path');
test('Kimi: переносы строк сохраняются вставкой paste после очистки Backspace', () => {
  const src = fs.readFileSync(path.join(__dirname, '../background/message-router.js'), 'utf8');
  const a = src.indexOf('async function dispatchProviderTrustedInput');
  const body = src.slice(a, a + 6000);
  expect(body).toMatch(/model === 'Kimi'/);
  expect(body).toMatch(/key: 'Backspace'/);
  expect(body).toMatch(/new ClipboardEvent\('paste'/);
});
