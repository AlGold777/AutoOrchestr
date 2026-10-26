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

describe('Basic output: этап 1 — опросник (document: form) и документ для чтения', () => {
  const form = { format: 'json', document: 'form' };
  const good = JSON.stringify({ items: [
    { id: 'budget', type: 'one', question: 'Бюджет', options: ['до 10k', 'больше'], required: true },
    { id: 'notes', type: 'text', question: 'Что ещё' }
  ] });

  test('этап 1: верный опросник проходит, в том числе в ограждении ```json', () => {
    expect(Output.checkAnswer(good, form)).toMatchObject({ ok: true });
    expect(Output.checkAnswer(`\`\`\`json\n${good}\n\`\`\``, form)).toMatchObject({ ok: true });
  });

  test.each([
    ['нет items', {}],
    ['items пустой массив', { items: [] }],
    ['пункт без id', { items: [{ type: 'text', question: 'Q' }] }],
    ['повтор id', { items: [{ id: 'a', type: 'text', question: 'Q' }, { id: 'a', type: 'text', question: 'Q2' }] }],
    ['type не из списка', { items: [{ id: 'a', type: 'select', question: 'Q' }] }],
    ['one без options', { items: [{ id: 'a', type: 'one', question: 'Q' }] }],
    ['many с пустым options', { items: [{ id: 'a', type: 'many', question: 'Q', options: [] }] }],
    ['text с options', { items: [{ id: 'a', type: 'text', question: 'Q', options: ['x'] }] }],
    ['пустой question', { items: [{ id: 'a', type: 'text', question: '' }] }],
    ['required не boolean', { items: [{ id: 'a', type: 'text', question: 'Q', required: 'yes' }] }],
    ['options с пустой строкой', { items: [{ id: 'a', type: 'one', question: 'Q', options: ['x', ''] }] }],
    ['options с повтором', { items: [{ id: 'a', type: 'one', question: 'Q', options: ['x', 'x'] }] }]
  ])('этап 1: дефект опросника (%s) → invalid_form с непустым detail', (_name, value) => {
    const result = Output.checkAnswer(JSON.stringify(value), form);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_form');
    expect(typeof result.detail).toBe('string');
    expect(result.detail.length).toBeGreaterThan(0);
  });

  test('этап 1: документ для чтения не накладывает ограничений на ответ', () => {
    const spec = [{ id: 'spec', name: 'ТЗ', pointer: '' }];
    expect(Output.checkAnswer('{"any": 1}', { format: 'json', document: 'read', artifacts: spec })).toMatchObject({ ok: true });
    expect(Output.checkAnswer('обычный текст\n[[DOC: spec]]\nтекст\n[[/DOC]]', { document: 'read', artifacts: spec })).toMatchObject({ ok: true });
  });
});

describe('Basic output: этап 2 — документ для чтения между метками [[DOC: id]] … [[/DOC]]', () => {
  const readText = { document: 'read', artifacts: [{ id: 'spec', name: 'ТЗ', pointer: '' }] };

  test('этап 2: extractDocument берёт текст между метками, обрезает пробелы и переводы строк по краям', () => {
    expect(Output.extractDocument('вступление\n[[DOC: spec]]\n# ТЗ\nтекст\n[[/DOC]]\nхвост', 'spec')).toBe('# ТЗ\nтекст');
    expect(Output.extractDocument('[[DOC:  spec ]]\nтекст\n[[/DOC]]', 'spec')).toBe('текст');
    expect(Output.extractDocument('[[DOC: spec]]a[[/DOC]] [[DOC: spec]]b[[/DOC]]', 'spec')).toBe('a');
  });

  test('этап 2: extractDocument — null без открывающей метки, без закрывающей, при пустом тексте, чужом id и другом регистре', () => {
    expect(Output.extractDocument('текст\n[[/DOC]]', 'spec')).toBeNull();
    expect(Output.extractDocument('[[DOC: spec]]\nтекст', 'spec')).toBeNull();
    expect(Output.extractDocument('[[DOC: spec]]  \n \n[[/DOC]]', 'spec')).toBeNull();
    expect(Output.extractDocument('[[DOC: other]]\nтекст\n[[/DOC]]', 'spec')).toBeNull();
    expect(Output.extractDocument('[[DOC: Spec]]\nтекст\n[[/DOC]]', 'spec')).toBeNull();
  });

  test('этап 2: ответ с метками проходит, документ попадает в documents по id', () => {
    const result = Output.checkAnswer('Вот:\n[[DOC: spec]]\n# ТЗ\nтекст\n[[/DOC]]', readText);
    expect(result.ok).toBe(true);
    expect(result.documents).toEqual({ spec: '# ТЗ\nтекст' });
  });

  test('этап 2: ответ без меток (обычный текст целиком) — missing_artifact, без подстановки ответа', () => {
    const result = Output.checkAnswer('Обычный текст без меток', readText);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_artifact');
    expect(result.detail).toContain('spec');
    expect(result.detail).toContain('[[DOC: spec]]');
    expect(result.documents).toBeUndefined();
  });

  test('этап 2: ответ только с открывающей меткой — missing_artifact', () => {
    const result = Output.checkAnswer('[[DOC: spec]]\nтекст без закрытия', readText);
    expect(result).toMatchObject({ ok: false, reason: 'missing_artifact' });
    expect(result.detail).toContain('[[DOC: spec]]');
  });

  test('этап 2: json с документом для чтения и указателем — прежнее поведение: поле есть — ok, нет — missing_artifact', () => {
    const jsonRead = { format: 'json', document: 'read', artifacts: [{ id: 'doc', name: 'Д', pointer: '/body' }] };
    expect(Output.checkAnswer('{"body": "текст"}', jsonRead)).toEqual({ ok: true, value: { body: 'текст' } });
    expect(Output.checkAnswer('{"other": 1}', jsonRead)).toMatchObject({ ok: false, reason: 'missing_artifact', detail: '«doc» (/body)' });
  });

  test('этап 2: опросник (document: form) и текст с артефактом без document — как раньше', () => {
    expect(Output.checkAnswer(JSON.stringify({ items: [] }), { format: 'json', document: 'form' })).toMatchObject({ ok: false, reason: 'invalid_form' });
    expect(Output.checkAnswer('обычный текст', { artifacts: [{ id: 'a', name: 'A', pointer: '' }] })).toEqual({ ok: true });
  });
});
