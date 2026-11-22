const fs = require('fs');
const path = require('path');
const SecretCheck = require('../shared/secret-check');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const A = 'abcdefghijklmnopqrstuvwxyz0123456789';

describe('SecretCheck', () => {
  test.each([
    ['sk-ant-api03-' + A, 'ключ API'],
    ['sk-' + A.slice(10), 'ключ API'],
    ['ghp_' + A, 'токен GitHub'],
    ['AKIA' + 'ABCDEFGHIJKLMNOP', 'ключ AWS'],
    ['AIza' + 'A'.repeat(35), 'ключ Google'],
    ['xoxb-1234567890-abcdefghij', 'токен Slack'],
    ['-----BEGIN RSA PRIVATE KEY-----', 'приватный ключ'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcdefghijk', 'токен JWT'],
    ['карта 4111 1111 1111 1111 ок', 'номер карты'],
    ['4111-1111-1111-1111', 'номер карты'],
    ['4111111111111111', 'номер карты']
  ])('finds %s', (text, name) => {
    expect(SecretCheck.find(`текст ${text} конец`)).toContain(name);
  });

  test('several findings, no repeats, no values', () => {
    const found = SecretCheck.find(`sk-${A} sk-${A.toUpperCase().slice(0, 30)}x 4111111111111111`);
    expect(found).toEqual(['ключ API', 'номер карты']);
    expect(JSON.stringify(found)).not.toContain(A);
  });

  test('ordinary text is not found', () => {
    ['Обычный текст запроса.', 'пиши на ivan@example.com', 'звони +7 999 123-45-67', 'число 4111111111111112', '1234567890123456789012', 'слово sk- в тексте', 'sk-short', 'sk-image-generation-model-version-x', 'Код 1234567890128', 'артикул 79927398713', ''].forEach((text) => {
      expect(SecretCheck.find(text)).toEqual([]);
    });
    expect(SecretCheck.find(null)).toEqual([]);
  });

  test('wiring: before results.js in result_new.html, not in the pipeline panel', () => {
    const html = read('result_new.html');
    expect(html.indexOf('src="shared/secret-check.js"')).toBeGreaterThan(-1);
    expect(html.indexOf('src="shared/secret-check.js"')).toBeLessThan(html.indexOf('src="results.js"'));
    expect(read('pipeline_panel.html')).not.toContain('secret-check');
    const source = read('results.js');
    expect(source.indexOf('window.SecretCheck?.find(finalPrompt)')).toBeGreaterThan(source.indexOf('finalPrompt = applySelectedModifiersToPrompt(finalPrompt);'));
    expect(source.indexOf('window.SecretCheck?.find(finalPrompt)')).toBeLessThan(source.indexOf('replaceCurrentMainRequestIds(transportRequestIds);'));
  });
});
