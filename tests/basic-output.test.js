const Output = require('../disput/basic-output');

describe('Basic output: the words, the JSON Pointer and the JSON answer', () => {
  test('a word is a non-empty part after a split on white space (one helper for the engine and the tests)', () => {
    expect(Output.countWords('  one two\n\tthree  ')).toBe(3);
    expect(Output.countWords('')).toBe(0);
    expect(Output.countWords(' \n ')).toBe(0);
    expect(Output.countWords('a b')).toBe(2);
  });

  test('a JSON Pointer reads fields, array items and escapes ~0 and ~1; an absent value differs from null', () => {
    const value = { 'a/b': { 'c~d': 1 }, list: [{ x: null }], nothing: null };
    expect(Output.readPointer(value, '/a~1b/c~0d')).toEqual({ found: true, value: 1 });
    expect(Output.readPointer(value, '/list/0/x')).toEqual({ found: true, value: null });
    expect(Output.readPointer(value, '/nothing')).toEqual({ found: true, value: null });
    expect(Output.readPointer(value, '/missing').found).toBe(false);
    expect(Output.readPointer(value, '/list/3').found).toBe(false);
    expect(Output.readPointer(value, '').found).toBe(true);
  });

  test('forbidden segments are never read, even when the object has them as own keys', () => {
    const value = JSON.parse('{"__proto__": {"polluted": 1}, "constructor": {"x": 1}}');
    expect(Output.readPointer(value, '/__proto__/polluted').found).toBe(false);
    expect(Output.readPointer(value, '/constructor/x').found).toBe(false);
    expect(Output.readPointer({}, '/toString').found).toBe(false);
  });

  test('the JSON answer is one object: the whole text or one fence of json without text around it', () => {
    expect(Output.parseJsonAnswer('{"a": 1}')).toEqual({ a: 1 });
    expect(Output.parseJsonAnswer('  ```json\n{"a": 2}\n```  ')).toEqual({ a: 2 });
    expect(Output.parseJsonAnswer('Вот ответ:\n{"a": 3}')).toBeNull();
    expect(Output.parseJsonAnswer('[1, 2]')).toBeNull();
    expect(Output.parseJsonAnswer('null')).toBeNull();
    expect(Output.parseJsonAnswer('```json\n{"a": 4}\n```\nкомментарий')).toBeNull();
  });
});

describe('Basic output: the acceptance order and the reasons (5.1)', () => {
  const sections = { sections: ['Карта', 'Замечания'] };

  test('a section is a substring of a line, without regard to case; each section is named when missing', () => {
    expect(Output.checkAnswer('КАРТА: данные\nзамечания: нет', sections)).toEqual({ ok: true });
    expect(Output.checkAnswer('Карта: данные', sections)).toEqual({ ok: false, reason: 'missing_section', detail: '«Замечания»' });
  });

  test('the length is checked before the sections: a too long answer without a section is too_long', () => {
    const long = `${Array.from({ length: 4 }, () => 'слово').join(' ')}`;
    expect(Output.checkAnswer(long, { ...sections, strictLength: true }, { limit: 3 })).toEqual({ ok: false, reason: 'too_long', detail: '(4 из 3 слов)' });
  });

  test('strictLength: exactly the limit is allowed, one word more is not; without strictLength there is no length check', () => {
    const five = 'один два три четыре пять';
    expect(Output.checkAnswer(five, { strictLength: true }, { limit: 5 })).toEqual({ ok: true });
    expect(Output.checkAnswer(`${five} шесть`, { strictLength: true }, { limit: 5 })).toMatchObject({ reason: 'too_long' });
    expect(Output.checkAnswer(`${five} шесть`, {}, { limit: 5 })).toEqual({ ok: true });
  });

  test('json: an invalid answer and a missing required field are named; null is present', () => {
    const output = { format: 'json', requiredFields: ['/correctedMap', '/auditFindings'] };
    expect(Output.checkAnswer('текст', output)).toEqual({ ok: false, reason: 'invalid_output' });
    expect(Output.checkAnswer('{"correctedMap": {}}', output)).toEqual({ ok: false, reason: 'missing_field', detail: '/auditFindings' });
    expect(Output.checkAnswer('{"correctedMap": null, "auditFindings": []}', output)).toEqual({ ok: true, value: { correctedMap: null, auditFindings: [] } });
  });

  test('a declared artifact whose pointer does not resolve is missing_artifact, named by its id and pointer', () => {
    const output = { format: 'json', requiredFields: ['/correctedMap'], artifacts: [{ id: 'map', name: 'Corrected Map', pointer: '/correctedMap' }, { id: 'findings', name: 'F', pointer: '/auditFindings' }] };
    expect(Output.checkAnswer('{"correctedMap": 1}', output)).toMatchObject({ ok: false, reason: 'missing_artifact', detail: '«findings» (/auditFindings)' });
  });
});
