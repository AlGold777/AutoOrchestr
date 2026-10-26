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
