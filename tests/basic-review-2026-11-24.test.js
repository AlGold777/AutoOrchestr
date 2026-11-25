// Defects of the Basic review 2026-11-24 (docs/Pipeline scenarios/reviews/basic-review-2026-11-24.md), each fixed in place.
const Schema = require('../disput/basic-schema');
const Output = require('../disput/basic-output');
const Files = require('../disput/basic-input-files');

const v2 = (steps) => ({ schemaVersion: 2, origin: 'user', steps });

describe('Basic review 2026-11-24', () => {
  test('R-1: an explicit participant keeps the delivery mark and the correction request; its other fields stay empty', () => {
    const [step] = Schema.assemble(v2([{ ref: 'r1', kind: 'round', models: [{ name: 'GPT', id: 'g2', label: 'GPT 2', settingsMode: 'explicit' }] }]));
    expect(step.models[0].discipline).toEqual({
      limit: '', content: '',
      delivery: Schema.DEFAULTS.discipline.delivery,
      correction: Schema.DEFAULTS.discipline.correction
    });
  });

  test('R-2: an explicit participant without its own input is checked with input none, as it runs', () => {
    const schema = v2([
      { ref: 'r1', kind: 'round', models: [{ name: 'GPT', id: 'GPT' }] },
      { ref: 'r2', kind: 'round', input: 'previous', models: [{ name: 'Claude', id: 'c2', settingsMode: 'explicit', request: 'Напиши свой ответ' }] }
    ]);
    expect(Schema.validate(schema)).toEqual([]);
    expect(Schema.assemble(schema)[1].models[0].input).toBe('none');
  });

  test('R-3: a step ref that names a key of Object.prototype is refused and never reaches the settings', () => {
    const schema = v2([{ ref: '__proto__', kind: 'round', task: 'T', models: [{ name: 'GPT', id: 'g1', task: 'mine' }] }]);
    expect(Schema.validate(schema)).toEqual([{ path: 'steps[0].ref', message: 'ref «__proto__» недопустим' }]);
    expect(({}).g1).toBeUndefined();
  });

  test('R-4: a switched-off participant switched on by «+» without a chosen participant keeps its own settings', () => {
    const schema = v2([{ ref: 'r1', kind: 'round', models: [{ name: 'G', id: 'g', enabled: false, onCanvas: true, task: 't' }] }]);
    expect(Schema.addToRound(schema, 'r1', { name: 'G' }).schema.steps[0].models).toEqual([{ name: 'G', id: 'g', task: 't' }]);
  });

  test('R-5: the marks of a document are not counted as words of the answer', () => {
    const output = { strictLength: true, format: 'text', document: 'read', artifacts: [{ id: 'doc', pointer: '' }] };
    expect(Output.checkAnswer('[[DOC: doc]] one two three four five [[/DOC]]', output, { limit: 5 }))
      .toEqual({ ok: true, documents: { doc: 'one two three four five' } });
  });

  test('R-6: only the newest run snapshots of input files are kept', async () => {
    const values = new Map();
    const store = {
      put(record, key) { values.set(JSON.stringify(key), record); },
      delete(key) { values.delete(JSON.stringify(key)); },
      openCursor(done) {
        const request = {};
        const keys = [...values.keys()].map((key) => JSON.parse(key)).filter((key) => Array.isArray(key) && key[0] === 'run');
        let at = 0;
        const step = () => setTimeout(() => {
          const key = keys[at];
          request.result = key ? { primaryKey: key, value: values.get(JSON.stringify(key)), continue: () => { at += 1; step(); } } : null;
          request.onsuccess();
          if (!key) done();
        }, 0);
        step();
        return request;
      }
    };
    const db = { objectStoreNames: { contains: () => true }, transaction() {
      // As in IndexedDB, the transaction completes after its last request: a fixed delay lost that race under load.
      const tx = { objectStore: () => ({ ...store, openCursor: () => store.openCursor(() => tx.oncomplete()) }) };
      return tx;
    } };
    const indexedDB = { cmp: () => 0, open: () => { const request = {}; setTimeout(() => { request.result = db; request.onupgradeneeded?.({ oldVersion: 2 }); request.onsuccess?.(); }, 0); return request; } };
    const savedRange = global.IDBKeyRange;
    global.IDBKeyRange = { bound: () => 'runs' };
    const now = jest.spyOn(Date, 'now');
    try {
      const files = Files.createStore({ indexedDB });
      for (let index = 1; index <= 12; index += 1) {
        now.mockReturnValue(1000 + index);
        // eslint-disable-next-line no-await-in-loop
        await files.putRun(`run-${index}`, { f: { name: 'a.txt' } });
      }
      const kept = [...values.keys()].map((key) => JSON.parse(key)[1]).sort();
      expect(kept).toHaveLength(10);
      expect(kept).not.toContain('run-1');
      expect(kept).not.toContain('run-2');
      expect(kept).toContain('run-12');
    } finally {
      now.mockRestore();
      global.IDBKeyRange = savedRange;
    }
  });
});
