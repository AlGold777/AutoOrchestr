/** @jest-environment jsdom */
const StageCard = require('../results/stage-card');
const Schema = require('../disput/basic-schema');

const choice = (extra = {}) => ({ prompts: [], roles: [''], settings: { order: '', input: '', task: '' }, first: false, inheritedTask: 'INHERITED', disabled: false, ...extra });
const build = (extra) => StageCard.buildModel({ round: 2, participants: [], roleChoice: choice(extra) });

describe('Round card of Basic: model', () => {
  test('the first round has the order only; the default input is nothing there and the previous step later', () => {
    const first = build({ first: true }).settings;
    expect(first.input).toBeNull();
    expect(first.task).toEqual({ value: '', placeholder: '', sent: false });
    const later = build().settings;
    expect(later.input.options[0].label).toBe('По умолчанию (ответы предыдущего шага)');
    expect(later.task).toEqual({ value: '', placeholder: 'INHERITED', sent: true });
  });

  test('the task is offered with any input; with nothing it is sent only when written here, so the shared task is not suggested', () => {
    expect(build({ settings: { order: '', input: 'none', task: '' } }).settings.task).toEqual({ value: '', placeholder: '', sent: false });
    expect(build({ settings: { order: '', input: 'none', task: 'MINE' } }).settings.task.value).toBe('MINE');
    expect(build({ settings: { order: '', input: 'all', task: 'T' } }).settings.task).toEqual({ value: 'T', placeholder: 'INHERITED', sent: true });
    expect(build({ settings: { order: 'sequential', input: 'previous', task: '' } }).settings.order.value).toBe('sequential');
  });

  test('a card without settings stays as it was: the role only', () => {
    expect(StageCard.buildModel({ round: 2, participants: [], roleChoice: { prompts: [], roles: [''] } }).settings).toBeUndefined();
  });
});

describe('Round card of Basic: render', () => {
  test('a change of a field is reported with its name; disabled fields are disabled', () => {
    const container = document.createElement('div');
    const seen = [];
    StageCard.render(container, build({ settings: { order: '', input: 'all', task: '' } }), { onSetting: (field, value) => seen.push([field, value]) });
    const order = container.querySelector('.stage-card-order-select');
    order.value = 'sequential';
    order.dispatchEvent(new Event('change'));
    const input = container.querySelector('.stage-card-input-select');
    input.value = 'none';
    input.dispatchEvent(new Event('change'));
    const task = container.querySelector('.stage-card-task');
    task.value = 'TEXT';
    task.dispatchEvent(new Event('change'));
    expect(seen).toEqual([['order', 'sequential'], ['input', 'none'], ['task', 'TEXT']]);
    const locked = document.createElement('div');
    StageCard.render(locked, build({ disabled: true, settings: { order: '', input: 'all', task: '' } }), {});
    expect([...locked.querySelectorAll('select, textarea')].every((node) => node.disabled)).toBe(true);
  });

  test('text of the task and the options are written as text, not as markup', () => {
    const container = document.createElement('div');
    StageCard.render(container, build({ settings: { order: '', input: 'all', task: '<img src=x onerror=alert(1)>' }, inheritedTask: '<b>x</b>' }), {});
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.stage-card-task').value).toBe('<img src=x onerror=alert(1)>');
    expect(container.querySelector('.stage-card-task').placeholder).toBe('<b>x</b>');
  });
});

describe('Round card of Basic: schema', () => {
  test('order, input and task of a round come back as the settings of its card, and only for rounds', () => {
    const settings = Schema.toSettings({ schemaVersion: 1, origin: 'user', steps: [
      { ref: 'r1', kind: 'round', models: [] },
      { ref: 'r2', kind: 'round', order: 'sequential', input: 'all', task: 'T', models: [] },
      { ref: 'final', kind: 'synthesis', task: 'S', models: [] }
    ] });
    expect(settings.customRoundSettings).toEqual({ r2: { order: 'sequential', input: 'all', task: 'T' } });
  });
});

describe('Round card of Basic: the first round shows its task', () => {
  test('the task field of the first round is on the card with the input nothing (P00 sends the explicit task)', () => {
    const container = document.createElement('div');
    StageCard.render(container, build({ first: true, settings: { order: '', input: '', task: 'FIRST TASK' } }), {});
    const task = container.querySelector('.stage-card-task');
    expect(task).not.toBeNull();
    expect(task.value).toBe('FIRST TASK');
    expect(container.querySelector('.stage-card-task-label').textContent).toContain('при входе «ничего» отправляется только оно');
  });
});

describe('Step controls of Basic: input «выбранные этапы»', () => {
  const earlier = [
    { ref: 'r1', label: 'Раунд 1', enabled: true },
    { ref: 'synth:a', label: 'Синтез после раунда 1', enabled: true },
    { ref: 'r2', label: 'Раунд 2', enabled: false }
  ];
  const roundWith = (settings) => build({ earlier, enabledCount: 2, settings: { order: '', input: '', task: '', ...settings } });

  test('the input offers «выбранные этапы»; the list keeps the canvas order and marks switched-off steps', () => {
    const input = roundWith({}).settings.input;
    expect(input.options.map((item) => item.value)).toEqual(['', 'none', 'previous', 'all', 'steps']);
    expect(input.steps.map((item) => [item.ref, item.disabled, item.checked])).toEqual([['r1', false, false], ['synth:a', false, false], ['r2', true, false]]);
  });

  test('an array input is the «выбранные этапы» choice; the order of the array is the order of choice', () => {
    const model = roundWith({ input: ['synth:a', 'r1'] });
    expect(model.settings.input.value).toBe('steps');
    expect(model.settings.input.steps.map((item) => [item.ref, item.checked, item.number])).toEqual([['r1', true, 2], ['synth:a', true, 1], ['r2', false, 0]]);
    expect(model.settings.task.sent).toBe(true);
  });

  test('a choice without a picked step stays «выбранные этапы» while the card asks for it', () => {
    expect(build({ earlier, settings: { order: '', input: '', task: '' }, drafts: { input: 'steps' } }).settings.input.value).toBe('steps');
  });

  test('checking a step is reported as the step and its new state; the owner sees a list entry that is not a step as a note', () => {
    const container = document.createElement('div');
    const seen = [];
    StageCard.render(container, roundWith({ input: ['r1', { step: 'r2', participant: 'GPT' }] }), { onSetting: (field, value) => seen.push([field, value]) });
    const boxes = container.querySelectorAll('.stage-card-steps input[type="checkbox"]');
    expect(boxes.length).toBe(3);
    expect(boxes[1].checked).toBe(false);
    boxes[1].checked = true;
    boxes[1].dispatchEvent(new Event('change'));
    expect(seen).toEqual([['steps', { ref: 'synth:a', checked: true }]]);
    expect(container.querySelector('.stage-card-steps').textContent).toContain('заданы в JSON');
    expect(container.querySelector('.stage-card-steps').textContent).toContain('(выключен)');
  });

  test('the toggle keeps the entries that are not step refs in place and does not repeat a step', () => {
    const object = { step: 'r2', participant: 'GPT' };
    expect(StageCard.stepsAfterToggle(['r1', object], 'synth:a', true)).toEqual(['r1', object, 'synth:a']);
    expect(StageCard.stepsAfterToggle(['r1', object, 'synth:a'], 'r1', false)).toEqual([object, 'synth:a']);
    expect(StageCard.stepsAfterToggle(['r1'], 'r1', true)).toEqual(['r1']);
  });

  test('the synthesis has its own input choice: the default (previous) and «выбранные этапы», no nothing and no all', () => {
    const fields = StageCard.stepFieldsModel({ kind: 'synthesis', settings: { input: ['r1'] }, earlier, enabledCount: 2 });
    expect(fields.input.options.map((item) => item.value)).toEqual(['', 'previous', 'steps']);
    expect(fields.input.value).toBe('steps');
    expect(StageCard.stepFieldsModel({ kind: 'synthesis', settings: {}, earlier }).input.value).toBe('');
  });
});

describe('Step controls of Basic: require, owner, output', () => {
  const fields = (settings, extra = {}) => StageCard.stepFieldsModel({ kind: 'round', settings, earlier: [], enabledCount: 3, ...extra });

  test('require is any by default, all, or a number up to the enabled models; the number field shows only for a number', () => {
    expect(fields({}).require.value).toBe('');
    expect(fields({ require: 2 }).require).toMatchObject({ value: 'count', count: 2, max: 3 });
    expect(fields({}, { drafts: { require: 'count' } }).require.value).toBe('count');
    const container = document.createElement('div');
    const seen = [];
    StageCard.renderStepFields(container, fields({ require: 2 }), (field, value) => seen.push([field, value]));
    const count = container.querySelector('.stage-card-require-count');
    expect(count.value).toBe('2');
    expect(count.max).toBe('3');
    count.value = '1';
    count.dispatchEvent(new Event('change'));
    container.querySelector('.stage-card-require-select').value = 'all';
    container.querySelector('.stage-card-require-select').dispatchEvent(new Event('change'));
    expect(seen).toEqual([['require', 1], ['require', 'all']]);
  });

  test('owner asks the owner after the step: a checkbox that reports approve or nothing, and the round card marks it', () => {
    expect(fields({ owner: 'approve' }).owner.checked).toBe(true);
    const container = document.createElement('div');
    const seen = [];
    StageCard.renderStepFields(container, fields({}), (field, value) => seen.push([field, value]));
    const box = container.querySelector('.stage-card-owner-check');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(seen).toEqual([['owner', 'approve']]);
    const round = StageCard.buildModel({ round: 2, participants: [], roleChoice: { prompts: [], roles: [''], settings: { order: '', input: '', task: '', owner: 'approve' }, earlier: [], enabledCount: 1 } });
    expect(round.badges).toContain('владелец: одобрение');
  });

  test('output: name, form and sections (one per line) and strict length are the fields; a json format turns the sections off', () => {
    const settings = { output: { name: 'Итог', form: 'Форма', sections: ['Карта', 'Замечания'], strictLength: true } };
    expect(fields(settings).output).toMatchObject({ name: 'Итог', form: 'Форма', sections: 'Карта\nЗамечания', strictLength: true, json: false });
    const json = fields({ output: { format: 'json', requiredFields: ['/a'] } }).output;
    expect(json.json).toBe(true);
    const container = document.createElement('div');
    StageCard.renderStepFields(container, fields({ output: { format: 'json' } }), () => {});
    expect(container.querySelector('.stage-card-output-sections').disabled).toBe(true);
  });

  test('the output edit keeps the fields the card does not edit and drops the empty ones', () => {
    const current = { name: 'Old', form: 'F', sections: ['A'], strictLength: true, format: 'json', requiredFields: ['/x'], artifacts: [{ id: 'map', name: 'Карта' }] };
    expect(StageCard.outputAfterEdit(current, { name: '', form: '', sections: [], strictLength: false })).toEqual({ format: 'json', requiredFields: ['/x'], artifacts: [{ id: 'map', name: 'Карта' }] });
    expect(StageCard.outputAfterEdit({ format: 'json', sections: ['A'] }, { name: 'N', form: '', sections: ['B'], strictLength: true }))
      .toEqual({ name: 'N', format: 'json', strictLength: true });
    expect(StageCard.outputAfterEdit({}, { name: 'N', form: 'F', sections: ['Карта', ''], strictLength: false })).toEqual({ name: 'N', form: 'F', sections: ['Карта'] });
  });
});

describe('Gate window of Basic: model and edits', () => {
  const gate = {
    ref: 'gate:1', kind: 'gate', models: [{ name: 'GPT', request: 'R', enabled: false }, { name: 'Claude' }],
    criteria: ['полнота', 'ясность'], pass: 'any',
    onFail: { goto: 'r1', maxLoops: 2, feedback: [{ step: 'r1', participant: 'GPT' }], invalidate: ['r1'], resumeAt: 'gate:1' },
    onPass: 'ask'
  };
  const names = ['GPT', 'Claude', 'Gemini'];

  test('the window shows the criteria, every available checker with its state, and the transitions as they are', () => {
    const model = StageCard.gateWindowModel(gate, { names, refs: ['r1', 'gate:1', 'r2'] });
    expect(model.criteria).toBe('полнота\nясность');
    expect(model.checkers).toEqual([{ name: 'GPT', checked: false }, { name: 'Claude', checked: true }, { name: 'Gemini', checked: false }]);
    expect(model.pass).toBe('any');
    expect(model.onFail).toEqual({ mode: 'goto', goto: 'r1', maxLoops: 2 });
    expect(model.onPass).toEqual({ mode: 'ask' });
    expect(model.refs).toEqual(['r1', 'r2']);
  });

  test('a missing value is shown as the default, not written: pass and onFail stop, onPass the next step', () => {
    const model = StageCard.gateWindowModel({ ref: 'gate:2', kind: 'gate', models: [] }, { names });
    expect(model.pass).toBe('');
    expect(model.onFail).toEqual({ mode: 'stop' });
    expect(model.onPass).toEqual({ mode: 'next' });
    const after = StageCard.gateAfterEdit({ ref: 'gate:2', kind: 'gate', models: [] }, { field: 'pass', value: '' });
    expect(after).toEqual({ ref: 'gate:2', kind: 'gate', models: [] });
  });

  test('criteria are one per line; empty lines are dropped and an empty list is not written', () => {
    expect(StageCard.gateAfterEdit(gate, { field: 'criteria', value: ' а \n\n б ' }).criteria).toEqual(['а', 'б']);
    expect(StageCard.gateAfterEdit(gate, { field: 'criteria', value: '  \n' })).not.toHaveProperty('criteria');
  });

  test('a checker is switched off in place (its other fields stay) and back on without enabled; a new one is added', () => {
    const off = StageCard.gateAfterEdit(gate, { field: 'checker', name: 'Claude', checked: false });
    expect(off.models).toEqual([{ name: 'GPT', request: 'R', enabled: false }, { name: 'Claude', enabled: false }]);
    const on = StageCard.gateAfterEdit(gate, { field: 'checker', name: 'GPT', checked: true });
    expect(on.models).toEqual([{ name: 'GPT', request: 'R' }, { name: 'Claude' }]);
    const added = StageCard.gateAfterEdit(gate, { field: 'checker', name: 'Gemini', checked: true });
    expect(added.models[2]).toEqual({ name: 'Gemini' });
  });

  test('a goto keeps feedback, invalidate and resumeAt; the loop limit is a number; a switch to ask drops the goto', () => {
    const loops = StageCard.gateAfterEdit(gate, { field: 'onFail', mode: 'goto', goto: 'r2', maxLoops: '3', stop: '' });
    expect(loops.onFail).toEqual({ goto: 'r2', maxLoops: 3, feedback: [{ step: 'r1', participant: 'GPT' }], invalidate: ['r1'], resumeAt: 'gate:1' });
    expect(StageCard.gateAfterEdit(gate, { field: 'onFail', mode: 'ask' }).onFail).toBe('ask');
    expect(StageCard.gateAfterEdit(gate, { field: 'onFail', mode: 'stop' }).onFail).toBe('stop');
    expect(StageCard.gateAfterEdit(gate, { field: 'onPass', mode: 'next' })).not.toHaveProperty('onPass');
  });

  test('a transition the window does not edit (its shape is other) stays unchanged by the other fields', () => {
    const odd = { ...gate, onPass: { goto: 'r1', maxLoops: 1 } };
    expect(StageCard.gateWindowModel(odd, { names }).onPass).toEqual({ mode: 'goto', goto: 'r1', maxLoops: 1 });
    const json = { ...gate, onFail: { stop: 'конец', maxLoops: 1 } };
    expect(StageCard.gateWindowModel(json, { names }).onFail).toEqual({ mode: 'json' });
    expect(StageCard.gateAfterEdit(json, { field: 'criteria', value: 'x' }).onFail).toEqual({ stop: 'конец', maxLoops: 1 });
  });

  test('the window reports each change with its field name; disabled controls are disabled', () => {
    const container = document.createElement('div');
    const seen = [];
    StageCard.renderGateWindow(container, StageCard.gateWindowModel(gate, { names, refs: ['r1'] }), (edit) => seen.push(edit));
    const criteria = container.querySelector('.stage-card-criteria');
    criteria.value = 'новый';
    criteria.dispatchEvent(new Event('change'));
    container.querySelector('.stage-card-pass-select').value = 'all';
    container.querySelector('.stage-card-pass-select').dispatchEvent(new Event('change'));
    const check = container.querySelectorAll('.stage-card-checker-check')[2];
    check.checked = true;
    check.dispatchEvent(new Event('change'));
    const mode = container.querySelector('.stage-card-onPass-mode');
    mode.value = 'goto';
    mode.dispatchEvent(new Event('change'));
    expect(seen.map((edit) => edit.field)).toEqual(['criteria', 'pass', 'checker', 'onPass']);
    expect(seen[2]).toEqual({ field: 'checker', name: 'Gemini', checked: true });
    expect(seen[3]).toEqual({ field: 'onPass', mode: 'goto', goto: '', maxLoops: '', stop: '' });
    const locked = document.createElement('div');
    StageCard.renderGateWindow(locked, StageCard.gateWindowModel(gate, { names, disabled: true }), () => {});
    expect([...locked.querySelectorAll('select, textarea, input')].every((node) => node.disabled)).toBe(true);
  });
});

describe('Route window of Basic: model and edits', () => {
  const route = {
    ref: 'route:1', kind: 'route', input: [{ step: 'r1', participant: 'GPT' }], models: [],
    select: {
      by: 'rule', conflict: 'first',
      cases: [
        { id: 'close', label: 'Закрыть', when: { source: 0, pointer: '/route', op: 'eq', value: 'close' }, action: { goto: 'r2', maxLoops: 2, feedback: [{ step: 'r1' }] } },
        { id: 'both', when: { all: [{ source: 0, pointer: '/a', op: 'exists' }, { source: 0, pointer: '/b', op: 'in', value: [1, 2] }] }, action: { stop: 'конец' } }
      ],
      otherwise: { goto: 'r2' }
    }
  };

  test('the window shows the kind, the conditions with their values, a composite as kept, and the otherwise', () => {
    const model = StageCard.routeWindowModel(route, { names: ['GPT', 'Claude'], refs: ['r1', 'route:1', 'r2'] });
    expect(model.by).toBe('rule');
    expect(model.conflict).toBe('first');
    expect(model.sources).toEqual([]);
    expect(model.otherSources).toBe(0);
    expect(model.cases[0]).toEqual({ id: 'close', label: 'Закрыть', composite: false,
      when: { source: 0, pointer: '/route', op: 'eq', value: 'close' }, action: { mode: 'goto', goto: 'r2', maxLoops: 2 } });
    expect(model.cases[1].composite).toBe(true);
    expect(model.cases[1].action).toEqual({ mode: 'stop', stop: 'конец' });
    expect(model.otherwise).toEqual({ mode: 'goto', goto: 'r2', maxLoops: '' });
    expect(model.refs).toEqual(['r1', 'r2']);
  });

  test('a condition value is typed as text or JSON: a quoted text, a number, a list for in, nothing for exists', () => {
    const edit = (when) => StageCard.routeAfterEdit(route, { field: 'case', index: 0, id: 'close', label: '', when, action: { mode: 'goto', goto: 'r2', maxLoops: '' } });
    expect(edit({ source: '0', pointer: '/n', op: 'eq', value: '3' }).select.cases[0].when).toEqual({ source: 0, pointer: '/n', op: 'eq', value: 3 });
    expect(edit({ source: '0', pointer: '/n', op: 'eq', value: '"x"' }).select.cases[0].when.value).toBe('x');
    expect(edit({ source: '0', pointer: '/n', op: 'in', value: 'a, 2' }).select.cases[0].when.value).toEqual(['a', 2]);
    expect(edit({ source: '0', pointer: '/n', op: 'exists', value: 'ignored' }).select.cases[0].when).toEqual({ source: 0, pointer: '/n', op: 'exists' });
    expect(edit({ source: '', pointer: '/n', op: 'eq', value: 'x' }).select.cases[0].when).not.toHaveProperty('source');
  });

  test('a composite condition stays as it is when the case is edited without a new condition', () => {
    const after = StageCard.routeAfterEdit(route, { field: 'case', index: 1, id: 'both', label: 'Оба', when: undefined, action: { mode: 'stop', stop: 'конец' } });
    expect(after.select.cases[1]).toEqual({ id: 'both', label: 'Оба', when: route.select.cases[1].when, action: { stop: 'конец' } });
  });

  test('the action of a case keeps feedback when it stays a goto; a stop reason is text', () => {
    const goto = StageCard.routeAfterEdit(route, { field: 'case', index: 0, id: 'close', label: 'Закрыть', when: route.select.cases[0].when, action: { mode: 'goto', goto: 'r1', maxLoops: '4' } });
    expect(goto.select.cases[0].action).toEqual({ goto: 'r1', maxLoops: 4, feedback: [{ step: 'r1' }] });
    const stop = StageCard.routeAfterEdit(route, { field: 'case', index: 0, id: 'close', label: 'Закрыть', when: route.select.cases[0].when, action: { mode: 'stop', stop: 'готово' } });
    expect(stop.select.cases[0].action).toEqual({ stop: 'готово' });
  });

  test('a case is added with a free id and removed by its place; the otherwise goes to a goto or away', () => {
    const added = StageCard.routeAfterEdit(route, { field: 'caseAdd' });
    expect(added.select.cases[2]).toEqual({ id: 'case3' });
    expect(StageCard.routeAfterEdit(route, { field: 'caseRemove', index: 0 }).select.cases.map((item) => item.id)).toEqual(['both']);
    expect(StageCard.routeAfterEdit(route, { field: 'otherwise', mode: 'none' }).select).not.toHaveProperty('otherwise');
  });

  test('a change of the kind drops what the new kind does not have, and keeps the rest', () => {
    const model = StageCard.routeAfterEdit(route, { field: 'by', value: 'model' });
    expect(model.select.by).toBe('model');
    expect(model.select).not.toHaveProperty('conflict');
    expect(model.select).not.toHaveProperty('otherwise');
    expect(model.select.cases[0]).toEqual({ id: 'close', label: 'Закрыть', action: { goto: 'r2', maxLoops: 2, feedback: [{ step: 'r1' }] } });
    expect(model.input).toEqual(route.input);
    const owner = StageCard.routeAfterEdit(model, { field: 'by', value: 'owner' });
    expect(owner.models).toEqual([]);
    expect(StageCard.routeAfterEdit(route, { field: 'model', value: 'Claude' }).models).toEqual([{ name: 'Claude' }]);
  });

  test('the window reports each change: the kind, the conflict, a case as a whole, an add and a remove', () => {
    const container = document.createElement('div');
    const seen = [];
    StageCard.renderRouteWindow(container, StageCard.routeWindowModel(route, { names: ['GPT'], refs: ['r1', 'r2'] }), (edit) => seen.push(edit));
    const by = container.querySelector('.stage-card-route-by');
    by.value = 'rule';
    by.dispatchEvent(new Event('change'));
    const conflict = container.querySelector('.stage-card-route-conflict');
    conflict.value = 'owner';
    conflict.dispatchEvent(new Event('change'));
    const id = container.querySelectorAll('.stage-card-case-id')[0];
    id.value = 'shut';
    id.dispatchEvent(new Event('change'));
    container.querySelector('.stage-card-case-add').click();
    container.querySelectorAll('.stage-card-case-remove')[1].click();
    expect(seen.map((edit) => edit.field)).toEqual(['by', 'conflict', 'case', 'caseAdd', 'caseRemove']);
    expect(seen[2]).toEqual({ field: 'case', index: 0, id: 'shut', label: 'Закрыть', when: { source: 0, pointer: '/route', op: 'eq', value: 'close' },
      action: { mode: 'goto', goto: 'r2', maxLoops: 2 } });
    expect(seen[4]).toEqual({ field: 'caseRemove', index: 1 });
  });

  test('a model route shows the model and its task, a rule shows the conditions; a composite is said to be kept', () => {
    const container = document.createElement('div');
    StageCard.renderRouteWindow(container, StageCard.routeWindowModel({ ...route, models: [{ name: 'GPT' }], select: { by: 'model', cases: [{ id: 'a', label: 'A', action: { goto: 'r2' } }] }, task: 'Выберите' }, { names: ['GPT'], refs: ['r2'] }), () => {});
    expect(container.querySelector('.stage-card-route-model').value).toBe('GPT');
    expect(container.querySelector('.stage-card-route-task').value).toBe('Выберите');
    expect(container.querySelector('.stage-card-case-when')).toBeNull();
    const rule = document.createElement('div');
    StageCard.renderRouteWindow(rule, StageCard.routeWindowModel(route, { names: ['GPT'], refs: ['r1', 'r2'] }), () => {});
    expect(rule.querySelectorAll('.stage-card-case-source').length).toBe(1);
    expect(rule.textContent).toContain('Составное условие (all/any): сохраняется как есть');
  });

  test('controlSummary of a route names its kind and the count of cases', () => {
    expect(StageCard.controlSummary(route)).toBe('по правилу, вариантов: 2');
    expect(StageCard.controlSummary({ kind: 'route', select: {} })).toBe('вид не выбран, вариантов: 0');
  });

  test('the sources of a rule are the answers of the earlier participants; checked ones keep their place in the input, others stay as they are', () => {
    const earlier = [{ ref: 'r1', label: 'Раунд 1', participants: [{ id: 'GPT', name: 'GPT' }, { id: 'claude-a', name: 'Claude' }] }];
    const withArtifact = { ...route, input: [{ step: 'r1', participant: 'GPT' }, { artifact: { step: 'r1', participant: 'GPT', id: 'report' }, version: 'latest' }] };
    const model = StageCard.routeWindowModel(withArtifact, { names: ['GPT'], earlier });
    expect(model.sources).toEqual([
      { step: 'r1', participant: 'GPT', label: 'Раунд 1 · GPT', checked: true, number: 0 },
      { step: 'r1', participant: 'claude-a', label: 'Раунд 1 · Claude', checked: false, number: -1 }
    ]);
    expect(model.otherSources).toBe(1);
    const added = StageCard.routeAfterEdit(withArtifact, { field: 'source', step: 'r1', participant: 'claude-a', checked: true });
    expect(added.input).toEqual([{ step: 'r1', participant: 'GPT' }, { artifact: { step: 'r1', participant: 'GPT', id: 'report' }, version: 'latest' }, { step: 'r1', participant: 'claude-a' }]);
    const removed = StageCard.routeAfterEdit(withArtifact, { field: 'source', step: 'r1', participant: 'GPT', checked: false });
    expect(removed.input).toEqual([{ artifact: { step: 'r1', participant: 'GPT', id: 'report' }, version: 'latest' }]);
    expect(StageCard.routeAfterEdit({ ...route, input: [{ step: 'r1', participant: 'GPT' }] }, { field: 'source', step: 'r1', participant: 'GPT', checked: false })).not.toHaveProperty('input');
  });
});

describe('Owner window of Basic: model and edits', () => {
  const owner = { ref: 'owner:1', kind: 'owner', models: [], task: 'Передайте текст', input: 'previous', output: { name: 'Итог', sections: ['Вывод'], format: 'json', requiredFields: ['/answer'] } };

  test('the window shows the task and the output; a json output has no sections', () => {
    const model = StageCard.ownerWindowModel(owner);
    expect(model.task).toBe('Передайте текст');
    expect(model.output).toEqual({ name: 'Итог', form: '', sections: 'Вывод', strictLength: false, json: true });
    expect(StageCard.controlSummary(owner)).toBe('задание: Передайте текст');
    expect(StageCard.controlSummary({ ref: 'owner:2', kind: 'owner', models: [] })).toBe('задание не задано');
  });

  test('a task is written as typed, an empty one is not; the input stays; the output keeps its other fields', () => {
    expect(StageCard.ownerAfterEdit(owner, { field: 'task', value: '  ' })).not.toHaveProperty('task');
    expect(StageCard.ownerAfterEdit(owner, { field: 'task', value: 'Новый текст' }).task).toBe('Новый текст');
    const plain = { ref: 'owner:3', kind: 'owner', models: [], task: 'T', output: { requiredFields: ['/a'], format: 'json', artifacts: [{ id: 'report' }] } };
    const edited = StageCard.ownerAfterEdit({ ...plain, output: { format: 'json', requiredFields: ['/a'], artifacts: [{ id: 'report' }], name: 'old' } }, { field: 'output', value: { name: '', form: 'кратко', sections: ['x'], strictLength: true } });
    expect(edited.output).toEqual({ format: 'json', requiredFields: ['/a'], artifacts: [{ id: 'report' }], form: 'кратко', strictLength: true });
    expect(StageCard.ownerAfterEdit({ ref: 'owner:4', kind: 'owner', models: [] }, { field: 'output', value: { name: '', form: '', sections: [''], strictLength: false } })).not.toHaveProperty('output');
  });

  test('the window reports the task and the output; a json output disables the sections', () => {
    const container = document.createElement('div');
    const seen = [];
    StageCard.renderOwnerWindow(container, StageCard.ownerWindowModel({ ...owner, output: { name: 'Итог', sections: ['Вывод', 'Доводы'] } }), (edit) => seen.push(edit));
    const task = container.querySelector('.stage-card-owner-task');
    task.value = 'Текст';
    task.dispatchEvent(new Event('change'));
    container.querySelector('.stage-card-output-strict').checked = true;
    container.querySelector('.stage-card-output-strict').dispatchEvent(new Event('change'));
    expect(seen[0]).toEqual({ field: 'task', value: 'Текст' });
    expect(seen[1]).toEqual({ field: 'output', value: { name: 'Итог', form: '', sections: ['Вывод', 'Доводы'], strictLength: true } });
    const json = document.createElement('div');
    StageCard.renderOwnerWindow(json, StageCard.ownerWindowModel(owner), () => {});
    expect(json.querySelector('.stage-card-output-sections').disabled).toBe(true);
  });
});

describe('N07: the text of the owner window', () => {
  test('shows the task, the input items with their labels and texts, the expected output and the reason of a repeat', () => {
    const text = StageCard.ownerAskMessage({
      task: 'Утвердите политику',
      input: [{ label: 'Раунд 1, участник S01-producer, визит 1', text: 'ПРЕДЛОЖЕНИЕ' }, { label: 'Файл', file: { name: 'a.pdf' } }],
      output: { name: 'Decision Policy', form: 'Текст политики' },
      reason: 'empty', reasonText: 'пустой ответ', detail: 'x'
    });
    expect(text).toContain('Утвердите политику');
    expect(text).toContain('Вам передано:');
    expect(text).toContain('— Раунд 1, участник S01-producer, визит 1:\nПРЕДЛОЖЕНИЕ');
    expect(text).toContain('— Файл:\n[файл «a.pdf»]');
    expect(text).toContain('Ожидается: Decision Policy — Текст политики');
    expect(text).toContain('Прошлый ответ не принят: пустой ответ (x).');
  });

  test('a task alone gives the task alone; a long input is cut for display with its size named', () => {
    expect(StageCard.ownerAskMessage({ task: 'Только задание', input: [] })).toBe('Только задание');
    const long = StageCard.ownerAskMessage({ task: 'T', input: [{ label: 'L', text: 'x'.repeat(7000) }] });
    expect(long).toContain('(показано 6000 из 7000 символов)');
  });
});
