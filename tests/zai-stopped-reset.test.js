const fs = require('fs');
const path = require('path');
test('Z.ai: новый запрос сбрасывает stopped от прошлой остановки', () => {
  const src = fs.readFileSync(path.join(__dirname, '../content-scripts/content-zai.js'), 'utf8');
  const body = src.slice(src.indexOf('const injectAndGetResponse'));
  expect(body.slice(0, 700)).toMatch(/stopped = false;/);
});
