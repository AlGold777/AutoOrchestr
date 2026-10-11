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

// The conditions of a rule route (6.2): strict JSON equality, membership, existence; a missing field matches nothing.
describe('Basic route conditions (6.2)', () => {
  const read = (value) => (source, pointer) => (source === 0 ? require('../disput/basic-output').readPointer(value, pointer) : { found: false });

  test('eq compares JSON values strictly: no coercion, key order of an object does not matter, array order does', () => {
    expect(Control.sameJson({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(Control.sameJson([1, 2], [2, 1])).toBe(false);
    expect(Control.sameJson(1, '1')).toBe(false);
    expect(Control.sameJson(null, 0)).toBe(false);
    expect(Control.sameJson({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });

  test('atomic conditions: eq, in (a member of the list), exists; a missing field or a source without an answer does not match eq or in', () => {
    const value = { route: 'close', tags: ['x'] };
    expect(Control.matches({ source: 0, pointer: '/route', op: 'eq', value: 'close' }, read(value))).toBe(true);
    expect(Control.matches({ source: 0, pointer: '/route', op: 'in', value: ['hold', 'close'] }, read(value))).toBe(true);
    expect(Control.matches({ source: 0, pointer: '/route', op: 'in', value: ['hold'] }, read(value))).toBe(false);
    expect(Control.matches({ source: 0, pointer: '/missing', op: 'exists' }, read(value))).toBe(false);
    expect(Control.matches({ source: 0, pointer: '/missing', op: 'eq', value: null }, read(value))).toBe(false);
    expect(Control.matches({ source: 0, pointer: '/route', op: 'exists' }, () => ({ found: false }))).toBe(false);
  });

  test('all and any are non-empty lists of conditions; both are read from the same sources', () => {
    const value = { route: 'close', ok: true };
    const yes = { source: 0, pointer: '/ok', op: 'exists' };
    const no = { source: 0, pointer: '/route', op: 'eq', value: 'hold' };
    expect(Control.matches({ all: [yes, { source: 0, pointer: '/route', op: 'eq', value: 'close' }] }, read(value))).toBe(true);
    expect(Control.matches({ all: [yes, no] }, read(value))).toBe(false);
    expect(Control.matches({ any: [no, yes] }, read(value))).toBe(true);
  });

  test('json of an answer: a whole json value or one fence of json; text that is not json is not a value', () => {
    expect(Control.jsonValueOf('{"route":"close"}')).toEqual({ ok: true, value: { route: 'close' } });
    expect(Control.jsonValueOf('```json\n["a"]\n```')).toEqual({ ok: true, value: ['a'] });
    expect(Control.jsonValueOf('"text"')).toEqual({ ok: true, value: 'text' });
    expect(Control.jsonValueOf('не json').ok).toBe(false);
  });

  test('the answer of a model route: one json object whose route is one of the cases; anything else is invalid_route', () => {
    expect(Control.routeOf('{"route":"close"}', ['close', 'revise'])).toEqual({ ok: true, fields: { route: 'close' } });
    expect(Control.routeOf('{"route":"hold"}', ['close', 'revise']).reason).toBe('invalid_route');
    expect(Control.routeOf('{"route":5}', ['close']).reason).toBe('invalid_route');
    expect(Control.routeOf('Выбираю close', ['close']).reason).toBe('invalid_route');
    expect(Control.routeOf('{"route":"close"}', ['close']).detail).toBeUndefined();
    expect(Control.routeOf('{"route":"x"}', ['close', 'revise']).detail).toContain('close, revise');
  });
});
