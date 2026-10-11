const Engine = require('../disput/custom-engine');

// A scripted transport (as in custom-engine.test.js): answers[model] is a list of replies, one per request to that model.
function transport(answers) {
  const calls = [];
  const used = {};
  const send = async (models, prompts, meta) => {
    calls.push({ models: models.slice(), prompts: { ...prompts }, meta });
    const byModel = {};
    models.forEach((model) => {
      const index = used[model] || 0;
      used[model] = index + 1;
      const reply = (answers[model] || [])[index];
      byModel[model] = typeof reply === 'object' ? reply : { text: reply || '', status: reply ? 'SUCCESS' : 'TIMEOUT' };
    });
    return { byModel, closedByOwner: false };
  };
  return { send, calls };
}

const routeOf = (value) => JSON.stringify({ route: value });
const r1 = { ref: 'r1', kind: 'round', input: 'none', models: ['A'] };
const source = [{ step: 'r1', participant: 'A' }];
const when = (value) => ({ source: 0, pointer: '/route', op: 'eq', value });
const rules = (extra = {}) => ({
  by: 'rule',
  cases: [
    { id: 'close', when: when('close'), action: { goto: 'r3' } },
    { id: 'revise', when: when('revise'), action: { goto: 'r2' } }
  ],
  otherwise: { goto: 'r4' },
  ...extra
});
const steps = (select, input = source) => [
  r1,
  { ref: 'route:audit', kind: 'route', input, select },
  { ref: 'r2', kind: 'round', models: ['B'] },
  { ref: 'r3', kind: 'round', models: ['C'] },
  { ref: 'r4', kind: 'round', models: ['D'] }
];

describe('Custom engine rule routes (6.2)', () => {
  test('the case whose condition holds is taken: its target runs, the other targets do not', async () => {
    const { send, calls } = transport({ A: [routeOf('close')], C: ['c'], D: ['d'] });
    const events = [];
    const result = await Engine.run({ task: 'T', steps: steps(rules()), send, onEvent: (kind, fields) => events.push([kind, fields]) });
    // The chosen target r3 runs; the step after it runs as the linear next (r4). The target r2 does not run.
    expect(result.stopReason).toBe('steps_done');
    expect(calls.map((call) => call.models)).toEqual([['A'], ['C'], ['D']]);
    expect(events).toContainEqual(['custom_route', expect.objectContaining({ ref: 'route:audit', case: 'close', by: 'rule', reason: 'rule' })]);
    expect(result.steps.find((step) => step.ref === 'route:audit').route).toEqual({ id: 'close', by: 'rule', reason: 'rule' });
  });

  test('three ways: the case that names revise goes to its own target; close and otherwise are the other two ways', async () => {
    const { send, calls } = transport({ A: [routeOf('revise')], B: ['b'], C: ['c'], D: ['d'] });
    await Engine.run({ task: 'T', steps: steps(rules()), send });
    expect(calls.map((call) => call.models)).toEqual([['A'], ['B'], ['C'], ['D']]);
  });

  test('no case holds: otherwise is taken; the answer is compared with eq, a missing field does not match', async () => {
    const { send, calls } = transport({ A: ['{"other":1}'], D: ['d'] });
    await Engine.run({ task: 'T', steps: steps(rules()), send });
    expect(calls.map((call) => call.models)).toEqual([['A'], ['D']]);
  });

  test('no case holds and no otherwise: route_not_found, nothing else is sent', async () => {
    const { send, calls } = transport({ A: [routeOf('hold')] });
    const result = await Engine.run({ task: 'T', steps: steps(rules({ otherwise: undefined })), send });
    expect(result.stopReason).toBe('route_not_found');
    expect(calls.map((call) => call.models)).toEqual([['A']]);
  });

  test('several cases hold: conflict stop is the default, route_ambiguous, nothing else is sent', async () => {
    const select = { by: 'rule', cases: [
      { id: 'a', when: { source: 0, pointer: '/route', op: 'exists' }, action: { goto: 'r2' } },
      { id: 'b', when: { source: 0, pointer: '/route', op: 'exists' }, action: { goto: 'r3' } }
    ] };
    const { send, calls } = transport({ A: [routeOf('close')] });
    const result = await Engine.run({ task: 'T', steps: steps(select), send });
    expect(result.stopReason).toBe('route_ambiguous');
    expect(calls).toHaveLength(1);
  });

  test('conflict first takes the first case of the list, and the journal says so', async () => {
    const select = { by: 'rule', conflict: 'first', cases: [
      { id: 'a', when: { source: 0, pointer: '/route', op: 'exists' }, action: { goto: 'r3' } },
      { id: 'b', when: { source: 0, pointer: '/route', op: 'exists' }, action: { goto: 'r2' } }
    ] };
    const { send, calls } = transport({ A: [routeOf('close')], C: ['c'], D: ['d'] });
    const events = [];
    await Engine.run({ task: 'T', steps: steps(select), send, onEvent: (kind, fields) => events.push([kind, fields]) });
    expect(calls.map((call) => call.models)).toEqual([['A'], ['C'], ['D']]);
    expect(events).toContainEqual(['custom_route', expect.objectContaining({ case: 'a', reason: 'conflict_first' })]);
  });

  test('conflict owner: the owner chooses among the matching cases only; a choice outside them is no_decision', async () => {
    const select = { by: 'rule', conflict: 'owner', cases: [
      { id: 'a', when: { source: 0, pointer: '/route', op: 'exists' }, action: { goto: 'r3' } },
      { id: 'b', when: { source: 0, pointer: '/route', op: 'exists' }, action: { goto: 'r2' } },
      { id: 'c', when: when('never'), action: { goto: 'r4' } }
    ] };
    const chooseRoute = jest.fn(async () => 'b');
    const { send, calls } = transport({ A: [routeOf('close')], B: ['b'], C: ['c'], D: ['d'] });
    const result = await Engine.run({ task: 'T', steps: steps(select), send, chooseRoute });
    expect(chooseRoute.mock.calls[0][0]).toEqual(expect.objectContaining({ stepRef: 'route:audit', visit: 1, choices: ['a', 'b'], reason: 'conflict' }));
    expect(result.stopReason).toBe('steps_done');
    expect(calls.map((call) => call.models)).toEqual([['A'], ['B'], ['C'], ['D']]);

    const wrong = await Engine.run({ task: 'T', steps: steps(select), send: transport({ A: [routeOf('close')] }).send, chooseRoute: async () => 'c' });
    expect(wrong.stopReason).toBe('no_decision');
  });

  test('a source that is not JSON stops the run before the choice: invalid_route_input', async () => {
    const { send, calls } = transport({ A: ['это не json'] });
    const result = await Engine.run({ task: 'T', steps: steps(rules()), send });
    expect(result.stopReason).toBe('invalid_route_input');
    expect(calls).toHaveLength(1);
  });

  test('an optional source without an answer does not match; a required one stops the run before the choice', async () => {
    const optional = steps(rules(), [{ step: 'nope', participant: 'A' }]);
    const { send, calls } = transport({ A: [routeOf('close')], D: ['d'] });
    const result = await Engine.run({ task: 'T', steps: optional, send });
    expect(result.stopReason).toBe('steps_done');
    expect(calls.map((call) => call.models)).toEqual([['A'], ['D']]);

    const required = steps(rules(), [{ step: 'nope', participant: 'A', required: true }]);
    const stopped = transport({ A: [routeOf('close')], D: ['d'] });
    expect((await Engine.run({ task: 'T', steps: required, send: stopped.send })).stopReason).toBe('missing_input');
    expect(stopped.calls.map((call) => call.models)).toEqual([['A']]);
  });

  test('the route answer is not an answer of its step: the next step with previous gets the answer before the route', async () => {
    const select = { by: 'model', cases: [{ id: 'close', label: 'Закрыть', action: { goto: 'r2' } }] };
    const routed = [r1, { ref: 'route:m', kind: 'route', models: [{ name: 'M' }], task: 'Выбери', select },
      { ref: 'r2', kind: 'round', models: ['B'] }];
    const { send, calls } = transport({ A: ['карта'], M: [routeOf('close')], B: ['b'] });
    await Engine.run({ task: 'T', steps: routed, send });
    expect(calls[2].prompts.B).toContain('карта');
    expect(calls[2].prompts.B).not.toContain('"route"');
  });

  test('refused before the first request: a target the plan does not have, a rule without a list of sources, a condition on an unknown source, a bad conflict', async () => {
    const cases = [
      [steps({ by: 'rule', cases: [{ id: 'a', when: when('x'), action: { goto: 'nope' } }] }), 'unknown_target', 'nope'],
      [steps({ by: 'rule', cases: [{ id: 'a', when: { source: 3, pointer: '/route', op: 'exists' }, action: { goto: 'r2' } }] }), 'invalid_field', 'source'],
      [steps({ by: 'rule', cases: [{ id: 'a', when: { source: 0, pointer: 'route', op: 'exists' }, action: { goto: 'r2' } }] }), 'invalid_field', 'pointer'],
      [steps({ by: 'rule', conflict: 'random', cases: [{ id: 'a', when: when('x'), action: { goto: 'r2' } }] }), 'invalid_field', 'conflict'],
      [steps({ by: 'rule', cases: [{ id: 'a', action: { goto: 'r2' } }] }), 'invalid_field', 'when'],
      [steps({ by: 'rule', cases: [{ id: 'a', when: when('x'), action: { goto: 'r2' } }] }, 'previous'), 'invalid_input', 'input'],
      [steps({ by: 'owner', cases: [{ id: 'a', action: { goto: 'r2' } }] }), 'invalid_field', 'label'],
      [steps({ by: 'model', cases: [{ id: 'a', label: 'А', action: { goto: 'r2' } }] }), 'invalid_field', 'models']
    ];
    for (const [list, code, mention] of cases) {
      const { send, calls } = transport({ A: [routeOf('x')] });
      const error = await Engine.run({ task: 'T', steps: list, send }).catch((item) => item);
      expect(error).toBeInstanceOf(Engine.EngineError);
      expect(error.code).toBe(code);
      expect(error.message).toContain(mention);
      expect(calls).toHaveLength(0);
    }
  });
});

describe('Custom engine model and owner routes (6.2)', () => {
  const tail = [{ ref: 'r2', kind: 'round', models: ['B'] }, { ref: 'r3', kind: 'round', models: ['C'] }];
  const modelRoute = (cases) => ({ ref: 'route:m', kind: 'route', models: [{ name: 'M' }], task: 'Выбери вариант по отчёту.', select: { by: 'model', cases } });
  const cases = [
    { id: 'close', label: 'Закрыть', action: { goto: 'r3' } },
    { id: 'revise', label: 'Доработать', action: { goto: 'r2' } }
  ];

  test('a model route gets the labels and answers with its id: the chosen case runs; the request is a route phase', async () => {
    const { send, calls } = transport({ A: ['отчёт'], M: [routeOf('revise')], B: ['b'], C: ['c'] });
    const result = await Engine.run({ task: 'T', steps: [r1, modelRoute(cases), ...tail], send });
    expect(result.stopReason).toBe('steps_done');
    expect(calls[1].prompts.M).toContain('close — Закрыть');
    expect(calls[1].prompts.M).toContain('revise — Доработать');
    expect(calls[1].meta.phase).toBe('route');
    expect(calls.map((call) => call.models)).toEqual([['A'], ['M'], ['B'], ['C']]);
  });

  test('an answer that names no case is corrected once; after the attempts the owner chooses, never a fallback', async () => {
    const chooseRoute = jest.fn(async () => 'revise');
    const { send, calls } = transport({ A: ['отчёт'], M: ['{"route":"x"}', '{"route":"y"}'], B: ['b'], C: ['c'] });
    const result = await Engine.run({ task: 'T', steps: [r1, modelRoute(cases), ...tail], send, chooseRoute });
    expect(calls.map((call) => call.models)).toEqual([['A'], ['M'], ['M'], ['B'], ['C']]);
    expect(calls[2].prompts.M).toContain('не назвал вариант маршрута');
    expect(chooseRoute.mock.calls[0][0]).toEqual(expect.objectContaining({ stepRef: 'route:m', choices: ['close', 'revise'], reason: 'invalid_route' }));
    expect(result.stopReason).toBe('steps_done');
  });

  test('a cancelled owner decision stops the run; an absent one is no_decision', async () => {
    const twice = { M: ['{"route":"x"}', '{"route":"y"}'] };
    const cancelled = await Engine.run({ task: 'T', steps: [r1, modelRoute(cases), ...tail], send: transport({ A: ['отчёт'], ...twice }).send, chooseRoute: async () => null });
    expect(cancelled.stopReason).toBe('stopped');
    const absent = await Engine.run({ task: 'T', steps: [r1, modelRoute(cases), ...tail], send: transport({ A: ['отчёт'], ...twice }).send });
    expect(absent.stopReason).toBe('no_decision');
  });

  test('an owner route: the owner chooses a case from all of them, with the reason owner', async () => {
    const chooseRoute = jest.fn(async () => 'close');
    const select = { by: 'owner', cases: [{ id: 'close', label: 'Закрыть', action: { goto: 'r3' } }, { id: 'revise', label: 'Доработать', action: { goto: 'r2' } }] };
    const { send, calls } = transport({ A: ['отчёт'], C: ['c'] });
    const result = await Engine.run({ task: 'T', steps: [r1, { ref: 'route:o', kind: 'route', models: [], select }, { ref: 'r2', kind: 'round', models: ['B'] }, { ref: 'r3', kind: 'round', models: ['C'] }], send, chooseRoute });
    expect(chooseRoute.mock.calls[0][0]).toEqual(expect.objectContaining({ choices: ['close', 'revise'], reason: 'owner' }));
    expect(result.stopReason).toBe('steps_done');
    expect(calls.map((call) => call.models)).toEqual([['A'], ['C']]);
  });

  test('a model route with two models, or without a task, is refused before the first request', async () => {
    const twoModels = { ref: 'route:m', kind: 'route', models: [{ name: 'M' }, { name: 'N' }], task: 'Выбери', select: { by: 'model', cases } };
    const noTask = { ref: 'route:m', kind: 'route', models: [{ name: 'M' }], select: { by: 'model', cases } };
    for (const step of [twoModels, noTask]) {
      const { send, calls } = transport({ A: ['a'] });
      const error = await Engine.run({ task: 'T', steps: [r1, step], send }).catch((item) => item);
      expect(error.code).toBe('invalid_field');
      expect(calls).toHaveLength(0);
    }
  });
});
