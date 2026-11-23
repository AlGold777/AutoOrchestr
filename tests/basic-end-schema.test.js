const Schema = require('../disput/basic-schema');

const base = (steps, extra = {}) => ({ schemaVersion: 2, origin: 'user', steps, ...extra });
const round = (ref, models, extra = {}) => ({ ref, kind: 'round', models: models.map((name) => (typeof name === 'string' ? { name, id: name } : name)), ...extra });
const owner = (ref, extra = {}) => ({ ref, kind: 'owner', task: 'Проверь итог', models: [], ...extra });
const errorsOf = (schema) => Schema.validate(schema);
const pathsOf = (schema) => errorsOf(schema).map((error) => error.path);
const artifactOutput = { format: 'json', requiredFields: ['/plan'], artifacts: [{ id: 'plan', name: 'План', pointer: '/plan' }] };

// r1: A answers with a document `plan`; r2: A and B answer; r3 is switched off.
const steps = () => [
  round('r1', [{ name: 'A', id: 'A', output: artifactOutput }]),
  round('r2', ['A', 'B']),
  round('r3', [{ name: 'A', id: 'A', enabled: false }])
];

describe('Basic end: the validator accepts a correct end', () => {
  test('a schema without end is valid as before', () => {
    expect(errorsOf(base(steps()))).toEqual([]);
  });

  test('a round, a participant and an artifact are valid sources', () => {
    const schema = base(steps(), {
      end: { from: ['r2', { step: 'r2', participant: 'B' }, { artifact: { step: 'r1', participant: 'A', id: 'plan' }, version: 'latest' }] }
    });
    expect(errorsOf(schema)).toEqual([]);
  });

  test('end may stand after a User step', () => {
    const schema = base([round('r1', ['A']), owner('owner:u1'), round('r2', ['A'])], { end: { from: ['r2'] } });
    expect(errorsOf(schema)).toEqual([]);
  });
});

describe('Basic end: the validator names the place of each error', () => {
  test('an empty from list is an error at end.from', () => {
    expect(pathsOf(base(steps(), { end: { from: [] } }))).toContain('end.from');
  });

  test('a User step is not a source', () => {
    const schema = base([round('r1', ['A']), owner('owner:u1')], { end: { from: ['owner:u1'] } });
    expect(pathsOf(schema)).toContain('end.from[0]');
  });

  test('a switched-off round is not a source', () => {
    expect(pathsOf(base(steps(), { end: { from: ['r3'] } }))).toContain('end.from[0]');
  });

  test('a participant switched off in its round is not a source', () => {
    const schema = base([round('r1', ['A', { name: 'B', id: 'B', enabled: false }])], { end: { from: [{ step: 'r1', participant: 'B' }] } });
    expect(pathsOf(schema)).toContain('end.from[0].participant');
  });

  test('a round that does not exist is an error at end.from[i]', () => {
    expect(pathsOf(base(steps(), { end: { from: ['r9'] } }))).toContain('end.from[0]');
  });

  test('an undeclared participant is an error at end.from[i]', () => {
    const paths = pathsOf(base(steps(), { end: { from: [{ step: 'r2', participant: 'Z' }] } }));
    expect(paths.some((path) => path.startsWith('end.from[0]'))).toBe(true);
  });

  test('an undeclared artifact is an error at end.from[i]', () => {
    const schema = base(steps(), { end: { from: [{ artifact: { step: 'r1', participant: 'A', id: 'other' }, version: 'latest' }] } });
    expect(pathsOf(schema).some((path) => path.startsWith('end.from[0]'))).toBe(true);
  });

  test('a repeated source is an error at its place', () => {
    expect(pathsOf(base(steps(), { end: { from: ['r2', 'r2'] } }))).toContain('end.from[1]');
  });

  test('an artifact version other than latest is refused', () => {
    const schema = base(steps(), { end: { from: [{ artifact: { step: 'r1', participant: 'A', id: 'plan' }, version: { step: 'r1', participant: 'A', visit: 1 } }] } });
    expect(pathsOf(schema)).toContain('end.from[0].version');
  });

  test('end must be an object and unknown keys are refused', () => {
    expect(pathsOf(base(steps(), { end: ['r2'] }))).toContain('end');
    expect(pathsOf(base(steps(), { end: { from: ['r2'], extra: 1 } }))).toContain('end.extra');
  });
});

describe('Basic end: endSources', () => {
  test('without end the last round with an enabled model is the source', () => {
    expect(Schema.endSources(base(steps()))).toEqual([{ step: 'r2' }]);
  });

  test('without end and without an enabled round there is no source', () => {
    expect(Schema.endSources(base([round('r1', [{ name: 'A', id: 'A', enabled: false }])]))).toEqual([]);
  });

  test('an empty from list gives no source', () => {
    expect(Schema.endSources(base(steps(), { end: { from: [] } }))).toEqual([]);
  });

  test('the sources are normalized to step, participant and artifact', () => {
    const schema = base(steps(), {
      end: { from: ['r2', { step: 'r2', participant: 'B' }, { artifact: { step: 'r1', participant: 'A', id: 'plan' }, version: 'latest' }] }
    });
    expect(Schema.endSources(schema)).toEqual([
      { step: 'r2' },
      { step: 'r2', participant: 'B' },
      { step: 'r1', participant: 'A', artifact: 'plan' }
    ]);
  });
});

describe('Basic end: toCanvas', () => {
  const models = ['A', 'B'];

  test('toCanvas gives the end sources of the schema', () => {
    const schema = base(steps(), { end: { from: ['r1', { step: 'r2', participant: 'B' }] } });
    const canvas = Schema.toCanvas(schema, { models });
    expect(canvas.errors).toEqual([]);
    expect(canvas.end).toEqual({ sources: [{ step: 'r1' }, { step: 'r2', participant: 'B' }] });
  });

  test('without end the canvas gives the default source', () => {
    const canvas = Schema.toCanvas(base(steps()), { models });
    expect(canvas.end).toEqual({ sources: [{ step: 'r2' }] });
  });
});
