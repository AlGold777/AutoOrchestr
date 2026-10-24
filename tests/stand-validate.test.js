/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');

const STAND = path.join(__dirname, '../docs/Pipeline scenarios/canvas-prototype');

// Загрузка стенда: state.js сам кладёт window.ProtoState, stand.js ищет элементы страницы при старте.
// Заглушка страницы: stand.js при старте требует #pipelineFlow (остальные id необязательны).
document.body.innerHTML = '<div id="pipelineFlow"></div>';
require(path.join(STAND, 'state.js'));
window.BasicSchema = require('../disput/basic-schema');
window.ProtoBasicExport = require(path.join(STAND, 'basic-export.js'));
require(path.join(STAND, 'stand.js'));

const validate = (steps, extra = {}) => window.ProtoStand.validate(JSON.stringify({ task: 'T', steps, ...extra })).issues;
const warns = (issues, text) => issues.filter((i) => i.level === 'warn' && i.msg.includes(text));
const errors = (issues) => issues.filter((i) => i.level === 'error');

const m = (name, extra = {}) => ({ name, ...extra });
const round = (id, models, extra = {}) => ({ id, block: 'round', title: `Этап ${id}`, why: 'зачем', models, task: 'Задание', ...extra });
const owner = (id, extra = {}) => ({ id, block: 'owner', title: `User ${id}`, why: 'зачем', ask: 'Что исправить?', ...extra });

describe('Стенд: предупреждения о схеме (пакет 1)', () => {
  describe('W1: ответ User должен читать этап ниже', () => {
    const W1 = 'не читает ни один этап ниже';

    test('предупреждает, если ниже нет этапа, который читает ответ User', () => {
      const issues = validate([
        round('s1', [m('Claude')]),
        owner('s2'),
        round('s3', [m('Claude')], { inputs: ['s1'] })
      ]);
      expect(warns(issues, W1).map((i) => i.step)).toEqual(['s2']);
    });

    test('не предупреждает, если этап ниже читает ответ User по id', () => {
      const issues = validate([
        round('s1', [m('Claude')]),
        owner('s2'),
        round('s3', [m('Claude')], { inputs: ['s2'] })
      ]);
      expect(warns(issues, W1)).toEqual([]);
    });

    test('не предупреждает, если User — последний этап', () => {
      const issues = validate([
        round('s1', [m('Claude')]),
        owner('s2')
      ]);
      expect(warns(issues, W1)).toEqual([]);
    });
  });

  describe('W2: артефакт раунда из нескольких моделей', () => {
    const W2 = 'Артефакт объявлен в раунде из нескольких моделей';
    const artifacts = [{ name: 'План', description: 'д' }];

    test('предупреждает о раунде из двух моделей с артефактом', () => {
      const issues = validate([round('s1', [m('Claude'), m('GPT')], { artifacts })]);
      expect(warns(issues, W2)).toHaveLength(1);
    });

    test('не предупреждает о раунде из одной модели с артефактом', () => {
      const issues = validate([round('s1', [m('Claude')], { artifacts })]);
      expect(warns(issues, W2)).toEqual([]);
    });

    test('не считает выключенную модель', () => {
      const issues = validate([round('s1', [m('Claude'), m('GPT', { enabled: false })], { artifacts })]);
      expect(warns(issues, W2)).toEqual([]);
    });
  });

  describe('W3: личное задание модели заменяет общее задание этапа', () => {
    const W3 = 'заменяет общее task этапа';

    test('предупреждает, если у модели задан свой task рядом с общим task этапа', () => {
      const issues = validate([round('s1', [m('Claude'), m('GPT', { task: 'Личное' })])]);
      const found = warns(issues, W3);
      expect(found).toHaveLength(1);
      expect(found[0].msg).toBe('models[1].task заменяет общее task этапа для этих моделей (общее задание им не отправляется): повторите общие требования в личных заданиях или уберите личные.');
    });

    test('не предупреждает, если задано только общее task', () => {
      const issues = validate([round('s1', [m('Claude'), m('GPT')])]);
      expect(warns(issues, W3)).toEqual([]);
    });

    test('не предупреждает, если общего task нет', () => {
      const issues = validate([round('s1', [m('Claude', { task: 'Личное' }), m('GPT', { task: 'Личное 2' })], { task: undefined })]);
      expect(warns(issues, W3)).toEqual([]);
    });
  });
});

describe('Стенд: поля документа и чат (пакет 2)', () => {
  const docRound = (id = 's1') => round(id, [m('Claude')], { artifacts: [{ name: 'ТЗ', description: 'д', document: 'read' }] });

  test('признак document у артефакта User предупреждает', () => {
    const issues = validate([owner('s1', { artifacts: [{ name: 'ТЗ', description: 'д', document: 'read' }] })]);
    expect(warns(issues, 'Признак document у артефакта только в раунде из одной модели.')).toHaveLength(1);
  });

  test('document у артефакта со значением не из read | form предупреждает', () => {
    const issues = validate([round('s1', [m('Claude')], { artifacts: [{ name: 'ТЗ', description: 'д', document: 'x' }] })]);
    expect(warns(issues, 'document: «x» — ожидается read | form.')).toHaveLength(1);
  });

  test('два артефакта-документа в одном раунде предупреждают один раз', () => {
    const issues = validate([round('s1', [m('Claude')], { artifacts: [
      { name: 'ТЗ', description: 'д', document: 'read' },
      { name: 'Опрос', description: 'д', document: 'form' }
    ] })]);
    expect(warns(issues, 'В раунде не больше одного артефакта-документа.')).toHaveLength(1);
  });

  test('document у User: этапа выше нет', () => {
    const issues = validate([docRound('s1'), owner('s2', { document: 'nope' })]);
    expect(warns(issues, 'document: этапа «nope» выше нет.')).toHaveLength(1);
  });

  test('document у User: ссылка на этап ниже — этапа выше нет', () => {
    const issues = validate([owner('s1', { document: 's2' }), docRound('s2')]);
    expect(warns(issues, 'document: этапа «s2» выше нет.')).toHaveLength(1);
  });

  test('document у User: источник не раунд', () => {
    const issues = validate([owner('s1'), owner('s2', { document: 's1' })]);
    expect(warns(issues, 'document: источник — раунд.')).toHaveLength(1);
  });

  test('document у User: раунд из двух моделей', () => {
    const issues = validate([
      round('s1', [m('Claude'), m('GPT')], { artifacts: [{ name: 'ТЗ', description: 'д', document: 'read' }] }),
      owner('s2', { document: 's1' })
    ]);
    expect(warns(issues, 'document: документ для User даёт раунд из одной модели.')).toHaveLength(1);
  });

  test('document у User: в раунде нет артефакта с document', () => {
    const issues = validate([round('s1', [m('Claude')], { artifacts: [{ name: 'ТЗ', description: 'д' }] }), owner('s2', { document: 's1' })]);
    expect(warns(issues, 'document: у раунда «s1» нет артефакта с признаком document (read или form).')).toHaveLength(1);
  });

  test('корректная схема с документом для User проходит без предупреждений о документе', () => {
    const issues = validate([
      docRound('s1'),
      owner('s2', { document: 's1' }),
      round('s3', [m('Claude')], { inputs: ['s2'] })
    ]);
    expect(issues.filter((i) => i.msg.includes('document') || i.msg.includes('Признак document') || i.msg.includes('W1') || i.msg.includes('не читает'))).toEqual([]);
    expect(errors(issues)).toEqual([]);
  });

  test('chat: значение не из new | continue — предупреждение ENUMS', () => {
    const issues = validate([round('s1', [m('Claude')], { chat: 'x' })]);
    expect(warns(issues, 'chat: «x» — ожидается new | continue.')).toHaveLength(1);
  });

  test('chat: new проходит без предупреждения', () => {
    const issues = validate([round('s1', [m('Claude')], { chat: 'new' })]);
    expect(warns(issues, 'chat:')).toEqual([]);
  });
});

describe('Стенд: примеры каталога и схемы showcase', () => {
  const NEW = ['не читает ни один этап ниже', 'Артефакт объявлен в раунде из нескольких моделей', 'заменяет общее task этапа',
    'Признак document у артефакта', 'document:', 'В раунде не больше одного артефакта-документа.', 'chat:'];
  const newWarnings = (schema) => window.ProtoStand.validate(JSON.stringify(schema)).issues
    .filter((i) => i.level === 'warn' && NEW.some((t) => i.msg.includes(t))).map((i) => i.msg);

  test('новые предупреждения не ломают примеры каталога и showcase: ошибок нет, предупреждения только новых видов', () => {
    const examples = JSON.parse(fs.readFileSync(path.join(STAND, 'stand-examples.json'), 'utf8'));
    const showcase = JSON.parse(fs.readFileSync(path.join(STAND, 'showcase-robot-vacuum v1.json'), 'utf8'));
    [...Object.values(examples).map((e) => e.schema || e), showcase].forEach((schema) => {
      expect(errors(window.ProtoStand.validate(JSON.stringify(schema)).issues)).toEqual([]);
      expect(newWarnings(schema).every((msg) => NEW.some((t) => msg.includes(t)))).toBe(true);
    });
  });
});
