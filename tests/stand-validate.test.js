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
    'Признак document у артефакта', 'document:', 'В раунде не больше одного артефакта-документа.', 'chat:', 'все модели уже получали'];
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

describe('Стенд: поставляемые примеры не нарушают правила W1–W4', () => {
  const BAD = ['Ответ User «', 'Артефакт объявлен в раунде из нескольких моделей', 'models[', 'все модели уже получали'];
  const schemas = () => {
    const examples = JSON.parse(fs.readFileSync(path.join(STAND, 'stand-examples.json'), 'utf8'));
    const named = ['showcase-robot-vacuum v1.json', 'coldstart-robot-vacuum v1.json'];
    return [
      ...Object.entries(examples).map(([k, v]) => [`stand-examples.json:${k}`, v.schema || v]),
      ...named.map((f) => [f, JSON.parse(fs.readFileSync(path.join(STAND, f), 'utf8'))])
    ];
  };

  test('ни один из поставляемых примеров и показательных схем не даёт предупреждений W1–W4', () => {
    const problems = [];
    schemas().forEach(([name, schema]) => {
      window.ProtoStand.validate(JSON.stringify(schema)).issues
        .filter((i) => i.level === 'warn' && BAD.some((t) => i.msg.includes(t)))
        .forEach((i) => problems.push(`${name}: ${i.msg}`));
    });
    expect(problems).toEqual([]);
  });
});

describe('Стенд: повторная вставка документа во входы (пакет 3)', () => {
  const REUSE = 'все модели уже получали';
  const reuse = (issues) => issues.filter((i) => i.level === 'warn' && i.msg.includes(REUSE)).map((i) => ({ step: i.step, msg: i.msg }));
  const plan = [{ name: 'План', description: 'д' }];

  test('(1) автор берёт свой документ по ссылке из входов — предупреждение', () => {
    const issues = validate([
      round('s1', [m('Claude')], { artifacts: plan }),
      round('s2', [m('Claude')], { inputs: ['s1.План'] })
    ]);
    expect(reuse(issues)).toEqual([{ step: 's2', msg: 'Этап s2: все модели уже получали «s1.План» (этап s1, тот же чат). Уберите вход и сошлитесь на документ по названию в задании.' }]);
  });

  test('(2) оба получили в s2 — предупреждение для s3, не для s2', () => {
    const issues = validate([
      round('s1', [m('Claude'), m('GPT')]),
      round('s2', [m('Claude'), m('GPT')], { inputs: ['s1'] }),
      round('s3', [m('Claude'), m('GPT')], { inputs: ['s1'] })
    ]);
    expect(reuse(issues).map((i) => i.step)).toEqual(['s3']);
    expect(reuse(issues)[0].msg).toBe('Этап s3: все модели уже получали «s1» (этап s2, тот же чат). Уберите вход и сошлитесь на документ по названию в задании.');
  });

  test('(3а) GPT ещё не видела документ — предупреждения нет', () => {
    const issues = validate([
      round('s1', [m('Claude')], { artifacts: plan }),
      round('s2', [m('Claude'), m('GPT')], { inputs: ['s1.План'] })
    ]);
    expect(reuse(issues)).toEqual([]);
  });

  test('(3б) новый чат на этапе N — предупреждения нет', () => {
    const issues = validate([
      round('s1', [m('Claude')], { artifacts: plan }),
      round('s2', [m('Claude')], { inputs: ['s1.План'], chat: 'new' })
    ]);
    expect(reuse(issues)).toEqual([]);
  });

  test('(3в) сброс чата между автором и N — предупреждения нет', () => {
    const issues = validate([
      round('s1', [m('Claude')], { artifacts: plan }),
      round('s_mid', [m('Claude')], { chat: 'new' }),
      round('s2', [m('Claude')], { inputs: ['s1.План'] })
    ]);
    expect(reuse(issues)).toEqual([]);
  });

  test('(3г) новая версия «План» в s2: предупреждение только про s2.План, про s1.План нет', () => {
    const issues = validate([
      round('s1', [m('Claude')], { artifacts: plan }),
      round('s2', [m('Claude')], { artifacts: plan }),
      round('s3', [m('Claude')], { inputs: ['s2.План'] })
    ]);
    const found = reuse(issues);
    expect(found.map((i) => i.step)).toEqual(['s3']);
    expect(found[0].msg).toContain('«s2.План» (этап s2');
    expect(issues.some((i) => i.msg.includes('s1.План') && i.msg.includes(REUSE))).toBe(false);
  });

  test('(3д) owner читает документ — предупреждения для owner нет', () => {
    const issues = validate([
      round('s1', [m('Claude')], { artifacts: [{ name: 'ТЗ', description: 'д', document: 'read' }] }),
      owner('s2', { document: 's1' })
    ]);
    expect(reuse(issues)).toEqual([]);
  });

  test('(3е) исходный артефакт in.Бриф: у одной модели из двух — нет; у всех — предупреждение для s2', () => {
    const src = { artifacts: [{ name: 'Бриф', content: 'текст брифа' }] };
    const one = validate([
      round('s1', [m('Claude')], { inputs: ['in.Бриф'] }),
      round('s2', [m('Claude')], { inputs: ['in.Бриф'] })
    ], src);
    expect(reuse(one)).toEqual([{ step: 's2', msg: 'Этап s2: все модели уже получали «in.Бриф» (этап s1, тот же чат). Уберите вход и сошлитесь на документ по названию в задании.' }]);
    const two = validate([
      round('s1', [m('Claude')], { inputs: ['in.Бриф'] }),
      round('s2', [m('Claude'), m('GPT')], { inputs: ['in.Бриф'] })
    ], src);
    expect(reuse(two)).toEqual([]);
  });

  test('повтор одной и той же строки во входах этапа считается один раз', () => {
    const issues = validate([
      round('s1', [m('Claude')], { artifacts: plan }),
      round('s2', [m('Claude')], { inputs: ['s1.План', 's1.План'] })
    ]);
    expect(reuse(issues)).toHaveLength(1);
  });

  test('выключенная модель не считается: у включённой есть документ — предупреждение', () => {
    const issues = validate([
      round('s1', [m('Claude')], { artifacts: plan }),
      round('s2', [m('Claude'), m('GPT', { enabled: false })], { inputs: ['s1.План'] })
    ]);
    expect(reuse(issues).map((i) => i.step)).toEqual(['s2']);
  });
});
