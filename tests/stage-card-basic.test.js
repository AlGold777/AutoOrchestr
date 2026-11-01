/** @jest-environment jsdom */
const StageCard = require('../results/stage-card');
const Schema = require('../disput/basic-schema');

const choice = (extra = {}) => ({ prompts: [], roles: [''], settings: { input: '', task: '' }, first: false, inheritedTask: 'INHERITED', disabled: false, ...extra });
const build = (extra) => StageCard.buildModel({ round: 2, participants: [], roleChoice: choice(extra) });

describe('Round card of Basic: model', () => {
  test('the first round has no input choice; the default input is nothing there and the previous step later; there is no order', () => {
    const first = build({ first: true }).settings;
    expect(first.input).toBeNull();
    expect(first.task).toEqual({ value: '', placeholder: '', sent: false });
    const later = build().settings;
    expect(later.input.options[0].label).toBe('По умолчанию (ответы последнего этапа с принятым результатом)');
    expect(later.task).toEqual({ value: '', placeholder: 'INHERITED', sent: true });
    expect(later).not.toHaveProperty('order');
    expect(later).not.toHaveProperty('require');
  });

  test('the task is offered with any input; with nothing it is sent only when written here, so the shared task is not suggested', () => {
    expect(build({ settings: { input: 'none', task: '' } }).settings.task).toEqual({ value: '', placeholder: '', sent: false });
    expect(build({ settings: { input: 'none', task: 'MINE' } }).settings.task.value).toBe('MINE');
    expect(build({ settings: { input: 'all', task: 'T' } }).settings.task).toEqual({ value: 'T', placeholder: 'INHERITED', sent: true });
  });

  test('a card without settings stays as it was: the role only', () => {
    expect(StageCard.buildModel({ round: 2, participants: [], roleChoice: { prompts: [], roles: [''] } }).settings).toBeUndefined();
  });
});

describe('Round card of Basic: render', () => {
  test('a change of a field is reported with its name; disabled fields are disabled', () => {
    const container = document.createElement('div');
    const seen = [];
    StageCard.render(container, build({ settings: { input: 'all', task: '' } }), { onSetting: (field, value) => seen.push([field, value]) });
    expect(container.querySelector('.stage-card-order-select')).toBeNull();
    expect(container.querySelector('.stage-card-require-select')).toBeNull();
    const input = container.querySelector('.stage-card-input-select');
    input.value = 'none';
    input.dispatchEvent(new Event('change'));
    const task = container.querySelector('.stage-card-task');
    task.value = 'TEXT';
    task.dispatchEvent(new Event('change'));
    expect(seen).toEqual([['input', 'none'], ['task', 'TEXT']]);
    const locked = document.createElement('div');
    StageCard.render(locked, build({ disabled: true, earlier: [{ ref: 'r1', label: 'Раунд 1', enabled: true }], settings: { input: [{ step: 'r1', required: true }], task: '' } }), {});
    expect([...locked.querySelectorAll('select, textarea, input')].every((node) => node.disabled)).toBe(true);
  });

  test('text of the task and the options are written as text, not as markup', () => {
    const container = document.createElement('div');
    StageCard.render(container, build({ settings: { input: 'all', task: '<img src=x onerror=alert(1)>' }, inheritedTask: '<b>x</b>' }), {});
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.stage-card-task').value).toBe('<img src=x onerror=alert(1)>');
    expect(container.querySelector('.stage-card-task').placeholder).toBe('<b>x</b>');
  });
});

describe('Round card of Basic: schema', () => {
  test('input and task of a round come back as the settings of its card, and only for rounds', () => {
    const settings = Schema.toSettings({ schemaVersion: 1, origin: 'user', steps: [
      { ref: 'r1', kind: 'round', models: [] },
      { ref: 'r2', kind: 'round', input: 'all', task: 'T', models: [] },
      { ref: 'owner:o', kind: 'owner', task: 'S', models: [] }
    ] });
    expect(settings.customRoundSettings).toEqual({ r2: { input: 'all', task: 'T' } });
  });
});

describe('Round card of Basic: the first round shows its task', () => {
  test('the task field of the first round is on the card with the input nothing (P00 sends the explicit task)', () => {
    const container = document.createElement('div');
    StageCard.render(container, build({ first: true, settings: { input: '', task: 'FIRST TASK' } }), {});
    const task = container.querySelector('.stage-card-task');
    expect(task).not.toBeNull();
    expect(task.value).toBe('FIRST TASK');
    expect(container.querySelector('.stage-card-task-label').textContent).toContain('при входе «ничего» отправляется только оно');
  });
});

describe('Step controls of Basic: input «выбранные этапы»', () => {
  const earlier = [
    { ref: 'r1', label: 'Раунд 1', enabled: true },
    { ref: 'r2', label: 'Раунд 2', enabled: true },
    { ref: 'r3', label: 'Раунд 3', enabled: false }
  ];
  const roundWith = (settings) => build({ earlier, settings: { input: '', task: '', ...settings } });

  test('the input offers «выбранные этапы»; the list keeps the canvas order and marks switched-off steps', () => {
    const input = roundWith({}).settings.input;
    expect(input.options.map((item) => item.value)).toEqual(['', 'none', 'previous', 'all', 'steps']);
    expect(input.steps.map((item) => [item.ref, item.disabled, item.checked])).toEqual([['r1', false, false], ['r2', false, false], ['r3', true, false]]);
  });

  test('an array input is the «выбранные этапы» choice; the order of the array is the order of choice', () => {
    const model = roundWith({ input: ['r2', 'r1'] });
    expect(model.settings.input.value).toBe('steps');
    expect(model.settings.input.steps.map((item) => [item.ref, item.checked, item.number])).toEqual([['r1', true, 2], ['r2', true, 1], ['r3', false, 0]]);
    expect(model.settings.task.sent).toBe(true);
  });

  test('a choice without a picked step stays «выбранные этапы» while the card asks for it', () => {
    expect(build({ earlier, settings: { input: '', task: '' }, drafts: { input: 'steps' } }).settings.input.value).toBe('steps');
  });

  test('checking a step is reported as the step and its new state; the owner sees a list entry that is not a step as a note', () => {
    const container = document.createElement('div');
    const seen = [];
    StageCard.render(container, roundWith({ input: ['r1', { step: 'r2', participant: 'GPT' }] }), { onSetting: (field, value) => seen.push([field, value]) });
    const boxes = container.querySelectorAll('.stage-card-step-option > label:first-child input[type="checkbox"]');
    expect(boxes.length).toBe(3);
    expect(boxes[1].checked).toBe(false);
    boxes[1].checked = true;
    boxes[1].dispatchEvent(new Event('change'));
    expect(seen).toEqual([['steps', { ref: 'r2', checked: true }]]);
    expect(container.querySelector('.stage-card-steps').textContent).toContain('заданы в JSON');
    expect(container.querySelector('.stage-card-steps').textContent).toContain('(выключен)');
  });

  test('the toggle keeps the entries that are not step refs in place and does not repeat a step', () => {
    const object = { step: 'r2', participant: 'GPT' };
    expect(StageCard.stepsAfterToggle(['r1', object], 'r3', true)).toEqual(['r1', object, 'r3']);
    expect(StageCard.stepsAfterToggle(['r1', object, 'r3'], 'r1', false)).toEqual([object, 'r3']);
    expect(StageCard.stepsAfterToggle(['r1'], 'r1', true)).toEqual(['r1']);
  });

  test('whole-step required setting preserves order and all participant or artifact addresses', () => {
    const participant = { step: 'r2', participant: 'GPT', required: true };
    const artifact = { artifact: { step: 'r1', participant: 'Claude', id: 'map' }, version: 'latest' };
    expect(StageCard.stepRequiredAfterToggle(['r1', participant, artifact], 'r1', true)).toEqual([
      { step: 'r1', required: true }, participant, artifact
    ]);
    expect(StageCard.stepRequiredAfterToggle([{ step: 'r3', required: true }, participant, artifact], 'r3', false)).toEqual([
      { step: 'r3', required: false }, participant, artifact
    ]);
    expect(StageCard.stepsAfterToggle([{ step: 'r1', required: true }, participant, artifact], 'r1', false)).toEqual([participant, artifact]);
  });

  test('a selected step has its own required checkbox; the caption explains previous is optional', () => {
    const required = roundWith({ input: [{ step: 'r1', required: true }, { artifact: { step: 'r2', participant: 'GPT', id: 'map' } }] });
    expect(required.settings.input.steps[0]).toMatchObject({ checked: true, required: true });
    expect(required.settings.input.objectRefs).toBe(1);
    const container = document.createElement('div');
    const seen = [];
    StageCard.render(container, required, { onSetting: (field, value) => seen.push([field, value]) });
    expect(container.querySelector('.stage-card-steps').textContent).toContain('Этапы для входа (номер — порядок выбора)');
    expect(container.querySelector('.stage-card-steps').textContent).toContain('пропускает этапы без ответа');
    const requiredBox = container.querySelector('.stage-card-step-required');
    expect(requiredBox.checked).toBe(true);
    requiredBox.checked = false;
    requiredBox.dispatchEvent(new Event('change'));
    expect(seen).toEqual([['stepRequired', { ref: 'r1', required: false }]]);
  });

  test('the card has no window of a synthesis: a synthesis is a round of one model with a role', () => {
    expect(StageCard).not.toHaveProperty('stepFieldsModel');
    expect(StageCard).not.toHaveProperty('renderStepFields');
  });
});

describe('Step controls of Basic: owner, output', () => {
  const three = ['A', 'B', 'C'].map((name) => ({ name, input: true, send: true }));
  const roundCard = (settings, extra = {}) => StageCard.buildModel({ round: 2, participants: three,
    roleChoice: choice({ earlier: [], settings: { input: '', task: '', ...settings }, ...extra }) });
  const fields = (settings, extra = {}) => roundCard(settings, extra).settings;
  const renderFields = (container, settings, onSetting) => StageCard.render(container, roundCard(settings), { onSetting });

  test('owner asks the owner after the step: a checkbox that reports approve or nothing, and the round card marks it', () => {
    expect(fields({ owner: 'approve' }).owner.checked).toBe(true);
    const container = document.createElement('div');
    const seen = [];
    renderFields(container, {}, (field, value) => seen.push([field, value]));
    const box = container.querySelector('.stage-card-owner-check');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(seen).toEqual([['owner', 'approve']]);
    const round = StageCard.buildModel({ round: 2, participants: [], roleChoice: { prompts: [], roles: [''], settings: { input: '', task: '', owner: 'approve' }, earlier: [] } });
    expect(round.badges).toContain('User: одобрение');
  });

  test('output: name, form and sections (one per line) and strict length are the fields; a json format turns the sections off', () => {
    const settings = { output: { name: 'Итог', form: 'Форма', sections: ['Карта', 'Замечания'], strictLength: true } };
    expect(fields(settings).output).toMatchObject({ name: 'Итог', form: 'Форма', sections: 'Карта\nЗамечания', strictLength: true, json: false });
    const json = fields({ output: { format: 'json', requiredFields: ['/a'] } }).output;
    expect(json.json).toBe(true);
    const container = document.createElement('div');
    renderFields(container, { output: { format: 'json' } }, () => {});
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

describe('Owner window of Basic: model and edits', () => {
  const owner = { ref: 'owner:1', kind: 'owner', models: [], task: 'Передайте текст', input: 'previous', output: { name: 'Итог', sections: ['Вывод'], format: 'json', requiredFields: ['/answer'] } };

  test('the window shows the task and the output; a json output has no sections', () => {
    const model = StageCard.ownerWindowModel(owner);
    expect(model.task).toBe('Передайте текст');
    expect(model.output).toEqual({ name: 'Итог', form: '', sections: 'Вывод', strictLength: false, json: true });
    expect(StageCard.controlSummary(owner)).toBe('Передайте текст');
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

describe('Owner goal (Назначение этапа) and the owner question', () => {
  const owner = { ref: 'owner:7', kind: 'owner', models: [], task: 'Утвердите текст' };

  test('the goal is in the model and an edit sets or removes it', () => {
    expect(StageCard.ownerWindowModel({ ...owner, goal: 'Проверить юридическую часть' }).goal).toBe('Проверить юридическую часть');
    expect(StageCard.ownerWindowModel(owner).goal).toBe('');
    expect(StageCard.ownerAfterEdit(owner, { field: 'goal', value: 'Цель' }).goal).toBe('Цель');
    expect(StageCard.ownerAfterEdit({ ...owner, goal: 'Цель' }, { field: 'goal', value: '  ' })).not.toHaveProperty('goal');
    expect(StageCard.ownerAfterEdit({ ...owner, goal: 'Цель' }, { field: 'task', value: 'Новое' }).goal).toBe('Цель');
  });

  test('the owner question starts with the goal before the task; without a goal the text is as before', () => {
    const withGoal = StageCard.ownerAskMessage({ task: 'Утвердите текст', goal: 'Проверить юридическую часть' });
    expect(withGoal).toBe('Назначение: Проверить юридическую часть\nУтвердите текст');
    expect(StageCard.ownerAskMessage({ task: 'Утвердите текст', goal: '' })).toBe('Утвердите текст');
  });

  test('the window has the goal field with its hint, and an edit of the goal goes out as a goal edit', () => {
    const container = document.createElement('div');
    const seen = [];
    StageCard.renderOwnerWindow(container, StageCard.ownerWindowModel({ ...owner, goal: 'Цель' }), (edit) => seen.push(edit));
    const goal = container.querySelector('.stage-card-owner-goal');
    expect(goal.value).toBe('Цель');
    expect(container.textContent).toContain('Для чего этот этап и что человек должен сделать — видит User в окне вопроса');
    goal.value = 'Новая цель';
    goal.dispatchEvent(new Event('change'));
    expect(seen[0]).toEqual({ field: 'goal', value: 'Новая цель' });
  });
});

describe('Этап 1: документ для User в окне владельца', () => {
  const owner = { ref: 'owner:9', kind: 'owner', models: [], task: 'Утвердите текст' };
  const sources = [{ ref: 'r1', label: 'r1 · GPT', declared: true }, { ref: 'r2', label: 'r2 · Claude (вид документа не объявлен)', declared: false }];

  test('этап 1: ownerWindowModel отдаёт документ и его источники; без источников — пусто', () => {
    expect(StageCard.ownerWindowModel(owner).document).toEqual({ value: '', sources: [] });
    expect(StageCard.ownerWindowModel({ ...owner, document: 'r1' }, { documentSources: sources }).document).toEqual({
      value: 'r1',
      sources: [{ ref: 'r1', label: 'r1 · GPT', declared: true }, { ref: 'r2', label: 'r2 · Claude (вид документа не объявлен)', declared: false }]
    });
  });

  test('этап 1: ownerAfterEdit ставит документ; пустое значение или пробелы убирают поле, остальные поля не меняются', () => {
    const step = { ...owner, goal: 'Цель', document: 'r1' };
    expect(StageCard.ownerAfterEdit(step, { field: 'document', value: 'r2' })).toEqual({ ...step, document: 'r2' });
    expect(StageCard.ownerAfterEdit(step, { field: 'document', value: '' })).not.toHaveProperty('document');
    expect(StageCard.ownerAfterEdit(step, { field: 'document', value: '   ' })).not.toHaveProperty('document');
    expect(StageCard.ownerAfterEdit(step, { field: 'document', value: '   ' }).goal).toBe('Цель');
    expect(StageCard.ownerAfterEdit(step, { field: 'document', value: '   ' }).task).toBe('Утвердите текст');
  });

  test('этап 1: окно показывает select документа с «нет», источниками, недоступным значением и отправляет change', () => {
    const container = document.createElement('div');
    const seen = [];
    StageCard.renderOwnerWindow(container, StageCard.ownerWindowModel({ ...owner, document: 'gone' }, { documentSources: sources }), (edit) => seen.push(edit));
    const select = container.querySelector('select.stage-card-owner-document');
    expect(select).not.toBeNull();
    expect(select.getAttribute('aria-label')).toBe('Документ для User');
    const options = Array.from(select.options);
    expect(options[0].value).toBe('');
    expect(options[0].textContent).toBe('нет');
    expect(options.map((o) => o.value)).toEqual(['', 'r1', 'r2', 'gone']);
    expect(options[1].textContent).toBe('r1 · GPT');
    expect(options[3].textContent).toBe('gone (недоступен)');
    expect(select.value).toBe('gone');
    expect(container.textContent).toContain('Раунд выше с одной моделью. Вид документа задаёт output.document раунда: read — для чтения, form — опросник.');
    select.value = 'r2';
    select.dispatchEvent(new Event('change'));
    expect(seen[seen.length - 1]).toEqual({ field: 'document', value: 'r2' });
  });

  test('этап 1: при disabled select выключен', () => {
    const container = document.createElement('div');
    StageCard.renderOwnerWindow(container, StageCard.ownerWindowModel({ ...owner, document: 'r1' }, { disabled: true, documentSources: sources }), () => {});
    expect(container.querySelector('select.stage-card-owner-document').disabled).toBe(true);
  });
});
