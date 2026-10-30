// L-29: a PARTIAL without proof of completion is not accepted for direct_answer tasks either:
// allowShort must not bypass partial_unproven / capped_unproven.
const A = require('../disput/debate-response-acceptance');

const short = 'Да, согласен.';
const long = Array.from({ length: 40 }, (_, i) => `слово${i}`).join(' ') + '.';

describe('L-29: unproven PARTIAL is refused whatever the task class', () => {
  test.each([short, long])('direct_answer PARTIAL without completion is partial_unproven: %s', (text) => {
    const r = A.evaluate({ text, meta: { status: 'PARTIAL', completion: 'partial', taskClass: 'direct_answer' } });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('partial_unproven');
  });

  test('allowShort flag alone does not accept an unproven PARTIAL', () => {
    const r = A.evaluate({ text: short, meta: { status: 'PARTIAL', allowShort: true } });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('partial_unproven');
  });

  test('reason partial_unproven from the delivery layer is refused for direct_answer', () => {
    const r = A.evaluate({ text: short, meta: { reason: 'partial_unproven', taskClass: 'direct_answer' } });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('partial_unproven');
  });

  test('capped_unproven stays refused for direct_answer', () => {
    const r = A.evaluate({ text: short, meta: { status: 'PARTIAL', reason: 'capped_unproven', taskClass: 'direct_answer' } });
    expect(r.reason).toBe('capped_unproven');
  });

  test('a direct_answer PARTIAL proven complete is still accepted', () => {
    expect(A.evaluate({ text: short, meta: { status: 'PARTIAL', completion: 'complete', taskClass: 'direct_answer' } }).ok).toBe(true);
  });

  test('a direct_answer SUCCESS short answer is still accepted', () => {
    expect(A.evaluate({ text: 'Готово', meta: { status: 'SUCCESS', taskClass: 'direct_answer' } }).ok).toBe(true);
  });
});
