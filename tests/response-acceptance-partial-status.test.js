const A = require('../disput/debate-response-acceptance');

const long = Array.from({ length: 40 }, (_, i) => `слово${i}`).join(' ') + '.';

describe('an answer that ended without proof (PARTIAL)', () => {
  test.each(['Проверяя архитектуру', 'Запуск интерпретатора кода…Пропустить'])(
    'a status line «%s» is not an answer', (text) => {
      expect(A.evaluate({ text, meta: { completion: 'partial', status: 'PARTIAL' } }).reason).toBe('partial_short');
    });

  test('a real long answer with the same status is still accepted', () => {
    expect(A.evaluate({ text: long, meta: { completion: 'partial', status: 'PARTIAL' } }).ok).toBe(true);
  });

  test('a short answer proven complete, or with another status, is accepted', () => {
    expect(A.evaluate({ text: 'Да.', meta: { completion: 'complete', status: 'SUCCESS' } }).ok).toBe(true);
    expect(A.evaluate({ text: 'Проверяя архитектуру', meta: { status: 'SUCCESS' } }).ok).toBe(true);
  });
});
