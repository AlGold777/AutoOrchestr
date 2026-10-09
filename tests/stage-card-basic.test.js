/** @jest-environment jsdom */
const StageCard = require('../results/stage-card');
const Schema = require('../disput/basic-schema');

const choice = (extra = {}) => ({ prompts: [], roles: [''], settings: { order: '', input: '', task: '' }, first: false, inheritedTask: 'INHERITED', disabled: false, ...extra });
const build = (extra) => StageCard.buildModel({ round: 2, participants: [], roleChoice: choice(extra) });

describe('Round card of Basic: model', () => {
  test('the first round has the order only; the default input is nothing there and the previous step later', () => {
    const first = build({ first: true }).settings;
    expect(first.input).toBeNull();
    expect(first.task).toBeNull();
    const later = build().settings;
    expect(later.input.options[0].label).toBe('По умолчанию (ответы предыдущего шага)');
    expect(later.task).toEqual({ value: '', placeholder: 'INHERITED' });
  });

  test('the task is offered only while the input is not nothing', () => {
    expect(build({ settings: { order: '', input: 'none', task: '' } }).settings.task).toBeNull();
    expect(build({ settings: { order: '', input: 'all', task: 'T' } }).settings.task.value).toBe('T');
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
