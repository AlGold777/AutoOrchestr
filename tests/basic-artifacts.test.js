const Artifacts = require('../disput/basic-artifacts');

describe('Basic artifact registry (5.3)', () => {
  const lineage = { step: 'r8', participant: 'author-A', id: 'map' };
  const source = { step: 'r8', participant: 'author-A', visit: 1 };

  test('a version is registered once: the same line and source is the same entry (idempotent)', () => {
    const registry = Artifacts.createRegistry();
    const first = Artifacts.register(registry, { id: 'map', name: 'Corrected Map', lineage, source, answerRef: 't1', pointer: '/correctedMap' });
    const again = Artifacts.register(registry, { id: 'map', name: 'Corrected Map', lineage, source, answerRef: 't1', pointer: '/correctedMap' });
    expect(first.created).toBe(true);
    expect(again).toEqual({ entry: first.entry, created: false });
    expect(registry.entries).toHaveLength(1);
  });

  test('the entry keeps a reference to the answer and a pointer, never a copy of the content', () => {
    const registry = Artifacts.createRegistry();
    const { entry } = Artifacts.register(registry, { id: 'map', name: 'Corrected Map', lineage, source, answerRef: 't1', pointer: '/correctedMap', inputs: [{ step: 'r7', participant: 'x', id: 'y' }] });
    expect(entry).toEqual({ id: 'map', name: 'Corrected Map', lineage, source, content: { answerRef: 't1', pointer: '/correctedMap' }, valid: true, inputs: [{ step: 'r7', participant: 'x', id: 'y' }] });
  });

  test('the latest version is the last registered valid one of the line; two authors are two lines', () => {
    const registry = Artifacts.createRegistry();
    const otherLine = { step: 'r8', participant: 'author-B', id: 'map' };
    Artifacts.register(registry, { id: 'map', name: 'M', lineage, source, answerRef: 't1', pointer: '' });
    Artifacts.register(registry, { id: 'map', name: 'M', lineage: otherLine, source: { step: 'r8', participant: 'author-B', visit: 1 }, answerRef: 't2', pointer: '' });
    expect(Artifacts.latest(registry, lineage).content.answerRef).toBe('t1');
    expect(Artifacts.latest(registry, otherLine).content.answerRef).toBe('t2');
    expect(Artifacts.latest(registry, { step: 'r8', participant: 'author-C', id: 'map' })).toBeNull();
  });

  test('markInvalid удалён: в модуле нет функции пометки устаревших версий', () => {
    expect(Artifacts.markInvalid).toBeUndefined();
  });

  test('a version with valid false (a record of an older run) is not current; an older valid one is never the latest, but starts a revision (ТЗ 3.4)', () => {
    const registry = Artifacts.createRegistry();
    Artifacts.register(registry, { id: 'map', name: 'M', lineage, source, answerRef: 't1', pointer: '' });
    Artifacts.register(registry, { id: 'map', name: 'M', lineage, source: { step: 'r8', participant: 'author-A', visit: 2 }, answerRef: 't2', pointer: '' });
    registry.entries[1].valid = false;
    expect(Artifacts.latest(registry, lineage)).toBeNull();
    expect(Artifacts.version(registry, lineage, { step: 'r8', participant: 'author-A', visit: 2 })).toMatchObject({ valid: false, content: { answerRef: 't2' } });
    expect(Artifacts.latest(registry, lineage, { base: true }).content.answerRef).toBe('t1');
    registry.entries[0].valid = false;
    expect(Artifacts.latest(registry, lineage, { base: true })).toBeNull();
  });

  test('a specific version is found by its creator step, participant and visit; an unknown one is null', () => {
    const registry = Artifacts.createRegistry();
    Artifacts.register(registry, { id: 'map', name: 'M', lineage, source, answerRef: 't1', pointer: '' });
    expect(Artifacts.version(registry, lineage, source).content.answerRef).toBe('t1');
    expect(Artifacts.version(registry, lineage, { step: 'r8', participant: 'author-A', visit: 2 })).toBeNull();
  });
});

// The pages that load the engine (pipeline_panel.html and result_new.html) load the modules before it: the engine uses them at run time.
describe('the pages load the Basic modules', () => {
  const fs = require('fs');
  const path = require('path');
  test.each(['pipeline_panel.html', 'result_new.html'])('%s: basic-artifacts.js and basic-output.js come before custom-engine.js', (page) => {
    const html = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
    const at = (name) => html.indexOf(`src="disput/${name}"`);
    expect(at('basic-artifacts.js')).toBeGreaterThan(-1);
    expect(at('basic-output.js')).toBeGreaterThan(-1);
    expect(at('basic-artifacts.js')).toBeLessThan(at('custom-engine.js'));
    expect(at('basic-output.js')).toBeLessThan(at('custom-engine.js'));
  });
});

describe('Basic artifact registry: description of an artifact', () => {
  const lineage = { step: 'r9', participant: 'author-B', id: 'map' };
  const source = { step: 'r9', participant: 'author-B', visit: 1 };

  test('a description is stored on the entry; without one the entry has no description field', () => {
    const registry = Artifacts.createRegistry();
    const { entry } = Artifacts.register(registry, { id: 'map', name: 'Map', lineage, source, answerRef: 't1', pointer: '', description: 'Для проверки' });
    expect(entry.description).toBe('Для проверки');
    const plain = Artifacts.register(Artifacts.createRegistry(), { id: 'map', name: 'Map', lineage, source, answerRef: 't1', pointer: '' });
    expect(plain.entry).not.toHaveProperty('description');
  });
});

describe('Basic artifacts: the final version of each document of a run', () => {
  const steps = [
    { ref: 'r1', kind: 'round', models: [{ id: 'GPT', name: 'GPT' }], output: { document: 'read', artifacts: [{ id: 'table', name: 'Таблица', pointer: '' }] } },
    { ref: 'owner:t', kind: 'owner', models: [], document: 'r1' },
    { ref: 'r2', kind: 'round', models: [{ id: 'GPT', name: 'GPT' }], output: { document: 'read', artifacts: [{ id: 'table', name: 'Таблица', pointer: '', revisionOf: {} }] } },
    { ref: 'r3', kind: 'round', models: [{ id: 'Claude', name: 'Claude' }], output: { artifacts: [{ id: 'note', name: 'Заметка', pointer: '' }] } }
  ];
  const line = { step: 'r1', participant: 'GPT', id: 'table' };
  const entry = (lineage, step, participant, answerRef, valid = true) => ({ id: lineage.id, name: 'x', lineage, source: { step, participant, visit: 1 }, content: { answerRef, pointer: '' }, valid });

  test('a document line gives its last version (the model revision after the owner approval); an ordinary artifact is not a document', () => {
    const entries = [entry(line, 'r1', 'GPT', 't1'), entry(line, 'owner:t', 'owner', 't2'), entry(line, 'r2', 'GPT', 't3'),
      entry({ step: 'r3', participant: 'Claude', id: 'note' }, 'r3', 'Claude', 't4')];
    expect(Artifacts.finalDocuments(steps, entries).map((item) => item.content.answerRef)).toEqual(['t3']);
  });

  test('a stale last version is not written; the line keeps its last valid one', () => {
    const entries = [entry(line, 'r1', 'GPT', 't1'), entry(line, 'r2', 'GPT', 't3', false)];
    expect(Artifacts.finalDocuments(steps, entries).map((item) => item.content.answerRef)).toEqual(['t1']);
  });
});
