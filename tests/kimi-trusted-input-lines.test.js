const fs = require('fs');
const path = require('path');
test('Kimi: доверенный ввод вставляет строки отдельно с Shift+Enter', () => {
  const src = fs.readFileSync(path.join(__dirname, '../background/message-router.js'), 'utf8');
  const a = src.indexOf('async function dispatchProviderTrustedInput');
  const body = src.slice(a, a + 5000);
  expect(body).toMatch(/model === 'Kimi'/);
  expect(body).toMatch(/modifiers: 8/);
  expect(body).toMatch(/split\('\\n'\)/);
});
