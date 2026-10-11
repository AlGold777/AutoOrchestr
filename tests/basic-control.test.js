const Control = require('../disput/basic-control');

// The verdict of a gate answer (6.1): a text ends with the verdict line; a fail names its unmet criteria above it.
describe('Basic gate verdict (6.1)', () => {
  test('a text answer that ends with ВЕРДИКТ: ПРОШЁЛ passes', () => {
    expect(Control.verdictOf('Разбор.\nВЕРДИКТ: ПРОШЁЛ')).toEqual({ ok: true, verdict: 'pass', unmet: [] });
  });

  test('a fail names every unmet criterion of the lines above the verdict, in their order', () => {
    const answer = 'Разбор.\nНЕ ВЫПОЛНЕНО: нет срока\nНЕ ВЫПОЛНЕНО: нет бюджета\nВЕРДИКТ: НЕ ПРОШЁЛ';
    expect(Control.verdictOf(answer)).toEqual({ ok: true, verdict: 'fail', unmet: ['нет срока', 'нет бюджета'] });
  });

  test.each([
    ['no verdict line at all', 'Разбор без вердикта.'],
    ['the verdict is not the last line', 'ВЕРДИКТ: ПРОШЁЛ\nХвост после вердикта.'],
    ['a fail without a НЕ ВЫПОЛНЕНО line above it', 'Разбор.\nВЕРДИКТ: НЕ ПРОШЁЛ'],
    ['a НЕ ВЫПОЛНЕНО line with no text', 'Разбор.\nНЕ ВЫПОЛНЕНО:\nВЕРДИКТ: НЕ ПРОШЁЛ'],
    ['a verdict in other words', 'Разбор.\nВЕРДИКТ: ok']
  ])('%s is no_verdict', (_label, answer) => {
    const result = Control.verdictOf(answer);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_verdict');
    expect(result.detail).toEqual(expect.any(String));
  });

  test('a json answer: verdict pass or fail; a fail needs a non-empty list of unmet criteria', () => {
    expect(Control.verdictOf('{"verdict":"pass"}', { json: true })).toEqual({ ok: true, verdict: 'pass', unmet: [] });
    expect(Control.verdictOf('{"verdict":"fail","unmet":["срок"]}', { json: true })).toEqual({ ok: true, verdict: 'fail', unmet: ['срок'] });
    expect(Control.verdictOf('{"verdict":"fail","unmet":[]}', { json: true }).reason).toBe('no_verdict');
    expect(Control.verdictOf('{"verdict":"fail"}', { json: true }).reason).toBe('no_verdict');
    expect(Control.verdictOf('{"verdict":"maybe"}', { json: true }).reason).toBe('no_verdict');
    expect(Control.verdictOf('не json', { json: true }).reason).toBe('no_verdict');
  });

  test('the pass rule: all needs every verdict to pass, any needs one; no verdict never passes', () => {
    expect(Control.passed(['pass', 'pass'], 'all')).toBe(true);
    expect(Control.passed(['pass', 'fail'], 'all')).toBe(false);
    expect(Control.passed(['pass', 'fail'], 'any')).toBe(true);
    expect(Control.passed(['fail', 'fail'], 'any')).toBe(false);
    expect(Control.passed([], 'any')).toBe(false);
  });

  test('the instruction names the verdict lines (text) and the fields (json)', () => {
    expect(Control.verdictInstruction(false)).toContain('ВЕРДИКТ: НЕ ПРОШЁЛ');
    expect(Control.verdictInstruction(true)).toContain('verdict');
    expect(Control.verdictInstruction(true)).toContain('unmet');
  });
});
