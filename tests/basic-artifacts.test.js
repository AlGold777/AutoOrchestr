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

  test('a stale version is not current any more, but stays in the history; an older valid one is never the latest (ТЗ 3.4)', () => {
    const registry = Artifacts.createRegistry();
    Artifacts.register(registry, { id: 'map', name: 'M', lineage, source, answerRef: 't1', pointer: '' });
    Artifacts.register(registry, { id: 'map', name: 'M', lineage, source: { step: 'r8', participant: 'author-A', visit: 2 }, answerRef: 't2', pointer: '' });
    expect(Artifacts.markInvalid(registry, (entry) => entry.source.visit === 2)).toBe(1);
    // The line waits for a new version: its latest is none, the older valid version is not put in its place.
    expect(Artifacts.latest(registry, lineage)).toBeNull();
    expect(Artifacts.version(registry, lineage, { step: 'r8', participant: 'author-A', visit: 2 })).toMatchObject({ valid: false, content: { answerRef: 't2' } });
    // The author of a revision starts from the last valid version of its line (its declared input), not from the stale one.
    expect(Artifacts.latest(registry, lineage, { base: true }).content.answerRef).toBe('t1');
    expect(Artifacts.markInvalid(registry, () => true)).toBe(1);
    expect(Artifacts.latest(registry, lineage, { base: true })).toBeNull();
  });

  test('a new valid version after the stale one ends the wait: it is the latest', () => {
    const registry = Artifacts.createRegistry();
    Artifacts.register(registry, { id: 'map', name: 'M', lineage, source, answerRef: 't1', pointer: '' });
    Artifacts.register(registry, { id: 'map', name: 'M', lineage, source: { step: 'r8', participant: 'author-A', visit: 2 }, answerRef: 't2', pointer: '' });
    Artifacts.markInvalid(registry, (entry) => entry.source.visit === 2);
    Artifacts.register(registry, { id: 'map', name: 'M', lineage, source: { step: 'r8', participant: 'author-A', visit: 3 }, answerRef: 't3', pointer: '' });
    expect(Artifacts.latest(registry, lineage).content.answerRef).toBe('t3');
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
    expect(at('basic-control.js')).toBeGreaterThan(-1);
    expect(at('basic-artifacts.js')).toBeLessThan(at('custom-engine.js'));
    expect(at('basic-output.js')).toBeLessThan(at('custom-engine.js'));
    expect(at('basic-control.js')).toBeLessThan(at('custom-engine.js'));
  });
});
