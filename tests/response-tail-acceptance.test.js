// Field report (8): Le Chat appends the time after the delivery token ("[[AO-…]] 8:55pm"). The token
// was stripped, "…8:55pm" read as a cut-off ending, every answer was rejected (3 model calls per
// stage) and the stage failed. Fix: drop provider chrome after the token; a transport-complete
// answer is not "incomplete"; every rejection is journaled with its reason.
const Delivery = require('../shared/message-delivery');
const Acceptance = require('../disput/debate-response-acceptance');
const Diagnosis = require('../shared/message-delivery-diagnosis');

const BODY = 'Это содержательный ответ модели, который заканчивается обычным предложением.';

describe('provider chrome after the delivery token', () => {
  test('a short tail on the token line is dropped, the answer stays intact', () => {
    expect(Delivery.clean(`${BODY}\n[[AO-atc9p3]] 8:55pm`)).toBe(BODY);
    expect(Delivery.clean(`${BODY} [[AO-atc9p3]] 8:55pm`)).toBe(BODY);
    expect(Delivery.clean(`${BODY}\n[[AO-atc9p3]]`)).toBe(BODY);
  });

  test('text on other lines, and tokens that are not the answer end, are not touched', () => {
    const multi = `Первый абзац.\n[[AO-atc9p3]] 8:55pm\nВторой абзац остаётся.`;
    expect(Delivery.clean(multi)).toBe('Первый абзац.\n\nВторой абзац остаётся.');
    expect(Delivery.clean(`${BODY} [[AO-atc9p3]] ${'очень длинный хвост '.repeat(5)}`)).toContain('очень длинный хвост');
  });
});

describe('the ending check needs proof only when the transport gave none', () => {
  const unfinished = 'Конец ответа без знака препинания и без тайм штампа вообще нет';

  test('without proof an unfinished last line is rejected; with a complete completion it is accepted', () => {
    expect(Acceptance.evaluate({ text: unfinished, meta: {} })).toMatchObject({ ok: false, reason: 'incomplete_ending' });
    expect(Acceptance.evaluate({ text: unfinished, meta: { completion: 'partial' } })).toMatchObject({ ok: false, reason: 'incomplete_ending' });
    expect(Acceptance.evaluate({ text: unfinished, meta: { completion: 'complete' } }).ok).toBe(true);
  });

  test('other rules still apply to a complete answer (empty, too long)', () => {
    expect(Acceptance.evaluate({ text: '', meta: { completion: 'complete' } }).reason).toBe('empty');
    expect(Acceptance.evaluate({ text: 'слово '.repeat(50).trim(), meta: { completion: 'complete', maxWords: 10 } }).reason).toBe('too_long');
  });
});

describe('delivery report', () => {
  const T0 = Date.parse('2026-10-02T05:11:00.000Z');
  const at = (s) => new Date(T0 + s * 1000).toISOString();

  test('rejections are grouped per model and reason, with the count', () => {
    const journal = [
      { at: at(10), kind: 'response_rejected', model: 'Le Chat', stage: 'stage-1', attempt: 1, reason: 'incomplete_ending', chars: 2800 },
      { at: at(25), kind: 'response_rejected', model: 'Le Chat', stage: 'stage-1', attempt: 2, reason: 'incomplete_ending', chars: 2790 },
      { at: at(50), kind: 'response_rejected', model: 'Le Chat', stage: 'stage-2', attempt: 1, reason: 'incomplete_ending', chars: 3000 },
      { at: at(60), kind: 'response_rejected', model: 'GPT', stage: 'stage-2', attempt: 1, reason: 'too_long', chars: 9000 }
    ];
    const problems = Diagnosis.diagnose(journal, { now: T0 + 100000 }).problems.filter((p) => p.code === 'response_rejected');
    expect(problems).toHaveLength(2);
    const lechat = problems.find((p) => p.model === 'Le Chat');
    expect(lechat).toMatchObject({ severity: 'warning', count: 3 });
    expect(lechat.reason).toBe('incomplete_ending ×3 · этапов: 2');
    expect(problems.find((p) => p.model === 'GPT').reason).toBe('too_long ×1 · этапов: 1');
  });
});
