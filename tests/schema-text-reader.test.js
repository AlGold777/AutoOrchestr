'use strict';

const Reader = require('../disput/schema-text-reader');

describe('schema-text-reader', () => {
  test('reads clean JSON without notes or comment', () => {
    const r = Reader.read('{"schemaVersion":1,"steps":[]}');
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ schemaVersion: 1, steps: [] });
    expect(r.notes).toEqual([]);
    expect(r.comment).toBe('');
  });

  test('reads JSON from a model reply and keeps surrounding text as comment', () => {
    const text = 'Вот схема:\n```json\n{"schemaVersion":1,"steps":[]}\n```\nПроверьте её.';
    const r = Reader.read(text);
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ schemaVersion: 1, steps: [] });
    expect(r.comment).toContain('Вот схема:');
    expect(r.comment).toContain('Проверьте её.');
    expect(r.comment).not.toContain('```');
  });

  test('reads soft JSON with comments, unquoted keys and trailing commas', () => {
    const text = `{schemaVersion: 1, /* c */ steps: [ {ref: 'r1', kind: 'round', models: [{name: 'GPT',},],}, ], // конец
}`;
    const r = Reader.read(text);
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({
      schemaVersion: 1,
      steps: [{ ref: 'r1', kind: 'round', models: [{ name: 'GPT' }] }],
    });
    expect(r.notes.some((n) => n.includes('JSON исправлен автоматически'))).toBe(true);
  });

  test('reads a string containing // without treating it as a comment', () => {
    const r = Reader.read('{"task":"см. http://x.y // не комментарий"}');
    expect(r.ok).toBe(true);
    expect(r.value.task).toBe('см. http://x.y // не комментарий');
  });

  test('reports empty or whitespace-only text as empty', () => {
    const empty = Reader.read('');
    expect(empty.ok).toBe(false);
    expect(empty.value).toBeNull();
    expect(empty.errors[0]).toContain('пуст');

    const spaces = Reader.read('   \n\t  ');
    expect(spaces.ok).toBe(false);
    expect(spaces.errors[0]).toContain('пуст');
  });

  test('reports text without a brace as missing JSON', () => {
    const r = Reader.read('Извините, не могу.');
    expect(r.ok).toBe(false);
    expect(r.value).toBeNull();
    expect(r.errors[0]).toContain('нет JSON');
  });

  test('reports truncated reply with the last fully read step', () => {
    const text = '{"schemaVersion":1,"steps":[{"ref":"r1","kind":"round","models":[{"name":"GPT"}]},{"ref":"r2","kind":"round","models":[{"name":"Cl';
    const r = Reader.read(text);
    expect(r.ok).toBe(false);
    expect(r.value).toBeNull();
    expect(r.errors[0]).toContain('оборван');
    expect(r.errors[0]).toContain('r1');
  });

  test('reports truncated reply after two complete steps with the second step named', () => {
    const text = '{"schemaVersion":1,"steps":[{"ref":"r1","kind":"round","models":[{"name":"GPT"}]},{"ref":"r2","kind":"round","models":[{"name":"Claude"}]},{"ref":"r3","kind":"ro';
    const r = Reader.read(text);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain('оборван');
    expect(r.errors[0]).toContain('r2');
  });

  test('reports invalid JSON in the middle with a clear message', () => {
    const r = Reader.read('{"a": }');
    expect(r.ok).toBe(false);
    expect(r.value).toBeNull();
    expect(r.errors[0]).toContain('Неверный JSON');
  });

  test('takes the first object when the root is a list of objects', () => {
    const r = Reader.read('[{"schemaVersion":1,"steps":[]}]');
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ schemaVersion: 1, steps: [] });
    expect(r.notes.some((n) => n.includes('список'))).toBe(true);
  });

  test('rejects a root list that does not contain objects', () => {
    const r = Reader.read('[1,2]');
    expect(r.ok).toBe(false);
    expect(r.value).toBeNull();
    expect(r.errors[0]).toContain('объект');
  });

  test('reads the first of two consecutive JSON objects and notes the second', () => {
    const r = Reader.read('{"a":1} {"a":2}');
    expect(r.ok).toBe(true);
    expect(r.value.a).toBe(1);
    expect(r.notes.some((n) => n.includes('JSON-объектов'))).toBe(true);
  });

  test('drops copier service lines and notes them', () => {
    const r = Reader.read('[[AO-12]]\n{"a":1}\n[НЕ СКОПИРОВАНО: ответ обрезан]');
    expect(r.ok).toBe(true);
    expect(r.value.a).toBe(1);
    expect(r.notes.some((n) => n.includes('служебных строк'))).toBe(true);
    expect(r.comment).not.toContain('AO-12');
  });

  test('does not apply the stages to steps alias', () => {
    const r = Reader.read('{"stages":[]}');
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ stages: [] });
    expect(Object.prototype.hasOwnProperty.call(r.value, 'steps')).toBe(false);
  });

  test('reads typographic quotes as JSON string delimiters', () => {
    const r = Reader.read('{“a”: “b”}');
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ a: 'b' });
  });
});
