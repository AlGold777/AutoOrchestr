const fs = require('fs');
const path = require('path');
const Schema = require('../disput/basic-schema');
const Engine = require('../disput/custom-engine');

const base = (steps) => ({ schemaVersion: 1, origin: 'user', steps });
const round = (ref, models, extra = {}) => ({
  ref,
  kind: 'round',
  models: models.map((model) => (typeof model === 'string' ? { name: model } : model)),
  ...extra
});
const requestErrors = (schema) => Schema.validate(schema).filter((error) => error.path.endsWith('.request'));

describe('Basic personal request input validation', () => {
  test('a request without {вход} is rejected when an enabled earlier round can supply input', () => {
    const schema = base([
      round('r1', ['Source']),
      round('r2', [{ name: 'Writer', request: 'Write a reply to the task.' }])
    ]);

    expect(requestErrors(schema)).toEqual([{
      path: 'steps[1].models[0].request',
      message: 'есть возможный вход из более раннего шага, но в запросе нет {вход}'
    }]);
  });

  test.each([
    ['first step defaults to input none', [round('r1', [{ name: 'A', request: 'Write without incoming answers.' }])]],
    ['explicit input none', [round('r1', ['A']), round('r2', [{ name: 'B', request: 'No input needed.', input: 'none' }])]],
    ['empty request uses automatic assembly', [round('r1', ['A']), round('r2', [{ name: 'B', request: '' }])]],
    ['whitespace request uses automatic assembly', [round('r1', ['A']), round('r2', [{ name: 'B', request: '   ' }])]],
  ])('%s does not require an input placeholder', (_label, steps) => {
    expect(requestErrors(base(steps))).toEqual([]);
  });

  test('model input overrides round input in both directions', () => {
    const validOverride = base([
      round('r1', ['Source']),
      round('r2', [{ name: 'NoInput', request: 'Independent request.', input: 'none' }], { input: 'previous' })
    ]);
    expect(requestErrors(validOverride)).toEqual([]);

    const requiredOverride = base([
      round('r1', ['Source']),
      round('r2', [{ name: 'NeedsSource', request: 'Use {вход}.', input: 'previous' }], { input: 'none' })
    ]);
    expect(requestErrors(requiredOverride)).toEqual([]);

    const missingOverride = base([
      round('r1', ['Source']),
      round('r2', [{ name: 'NeedsSource', request: 'Use the source.', input: 'previous' }], { input: 'none' })
    ]);
    expect(requestErrors(missingOverride).map((error) => error.path)).toEqual(['steps[1].models[0].request']);
  });

  test('a disabled model is neither validated as a requester nor treated as a source', () => {
    const schema = base([
      round('r1', [{ name: 'OffSource', enabled: false }]),
      round('r2', [{ name: 'OffRequester', enabled: false, request: 'No {вход} here.' }])
    ]);

    expect(requestErrors(schema)).toEqual([]);
  });

  test('a request error in a later step is part of Basic preflight, before the first transport send', () => {
    const schema = base([
      round('r1', ['Source']),
      round('r2', [{ name: 'Writer', request: 'Write without the incoming answer.' }])
    ]);
    expect(requestErrors(schema)).toHaveLength(1);

    // The page assembles no engine steps on any schema error, then exits the run before
    // it reaches the engine transport. Keep this integration boundary explicit here:
    // CustomEngine alone cannot know about a later, not-yet-visited schema step.
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    const buildAt = source.indexOf('const buildBasicRun =');
    const runAt = source.indexOf('const runCustomFromPage = async');
    const engineAt = source.indexOf('await engine.run({', runAt);
    const buildBlock = source.slice(buildAt, source.indexOf('};', buildAt) + 2);
    const runBlock = source.slice(runAt, engineAt);
    expect(buildBlock).toContain('window.BasicSchema.validate(schema)');
    expect(buildBlock).toContain('steps: errors.length ? [] : window.BasicSchema.assemble(schema');
    expect(runBlock).toContain('if (built.errors.length)');
  });
});

describe('Basic personal request diagnostics', () => {
  test('missing {задача}, an explicit role, and an explicit task are warnings', () => {
    const diagnostic = Engine.requestDiagnostics({
      model: { promptTemplate: 'Do the work.', extra: 'Act as a reviewer.', task: 'Check the reasoning.' },
      hasInput: null,
      hasRole: true,
      hasTask: true
    });

    expect(diagnostic.errors).toEqual([]);
    expect(diagnostic.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('{задача}'),
      expect.stringContaining('Роль'),
      expect.stringContaining('Задание')
    ]));
    expect(diagnostic.warnings).toHaveLength(3);
  });

  test('inherited role/task flags do not warn, and an empty request has no diagnostics', () => {
    expect(Engine.requestDiagnostics({
      model: { promptTemplate: 'Use {задача}.', extra: '', task: '' },
      hasInput: null,
      hasRole: false,
      hasTask: false
    })).toEqual({ errors: [], warnings: [] });
    expect(Engine.requestDiagnostics({ model: { promptTemplate: '' }, hasInput: true, hasRole: true, hasTask: true }))
      .toEqual({ errors: [], warnings: [] });
  });

  test('runtime rejects an actual incoming answer before sending that participant request', async () => {
    const calls = [];
    const send = async (models, prompts) => {
      calls.push({ models, prompts });
      return { byModel: Object.fromEntries(models.map((name) => [name, { text: `answer from ${name}`, status: 'SUCCESS' }])) };
    };

    const error = await Engine.run({
      task: 'Task',
      steps: [
        { ref: 'r1', kind: 'round', input: 'none', models: ['Source'] },
        { ref: 'r2', kind: 'round', input: 'previous', models: [{ name: 'Writer', promptTemplate: 'Write a reply.' }] }
      ],
      send
    }).catch((caught) => caught);

    expect(error).toMatchObject({ code: 'invalid_request' });
    expect(calls).toHaveLength(1);
    expect(calls[0].models).toEqual(['Source']);
  });
});
