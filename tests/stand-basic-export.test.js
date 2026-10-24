const fs = require('fs');
const path = require('path');
const Schema = require('../disput/basic-schema');
const Exchange = require('../docs/Pipeline scenarios/canvas-prototype/basic-export');
const examples = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/Pipeline scenarios/canvas-prototype/stand-examples.json'), 'utf8'));
const list = Array.isArray(examples) ? examples : Object.values(examples);

describe('Stand ↔ Basic exchange', () => {
  test.each(list.map((e, i) => [i, e.schema || e]))('example %s: the stand schema exports to a valid Basic schema', (i, schema) => {
    const { schema: basic, warnings } = Exchange.toBasic(schema);
    if (warnings.some((w) => w.startsWith('Нечего экспортировать'))) return;
    expect(Schema.validate(basic)).toEqual([]);
  });

  test('defaults.synthesisTask of the stand is not exported: Basic has no synthesis, the warning says how to write it', () => {
    const { schema: basic, warnings } = Exchange.toBasic({ task: 'T', defaults: { roundTask: 'R', synthesisTask: 'S' },
      steps: [{ id: 's1', block: 'round', title: 'R', why: 'w', models: [{ name: 'Claude' }], task: 'Сделай' }] });
    expect(basic.defaults).toEqual({ roundTask: 'R' });
    expect(Schema.validate(basic)).toEqual([]);
    expect(warnings.some((w) => w.includes('defaults.synthesisTask'))).toBe(true);
  });

  test('a stand check is a plain model step: no gate is exported', () => {
    const { schema: basic } = Exchange.toBasic(list.map((e) => e.schema || e)[0]);
    expect(basic.steps.some((st) => st.kind === 'gate')).toBe(false);
  });

  test('a gate of a Basic file imports as a round with the criteria in the task and a remark', () => {
    const basic = { schemaVersion: 1, origin: 'user', steps: [
      { ref: 'r1', kind: 'round', models: [{ name: 'Claude' }] },
      { ref: 'gate:g1', kind: 'gate', criteria: ['полнота', 'сроки'], models: [{ name: 'GPT' }], onFail: { goto: 'r1', maxLoops: 2 }, onPass: { return: true } },
      { ref: 'final', kind: 'synthesis', models: [{ name: 'Claude' }] }
    ] };
    const { schema, warnings } = Exchange.fromBasic(basic);
    expect(schema.steps.map((st) => st.block)).toEqual(['round', 'round', 'round']);
    expect(schema.steps[1].models).toEqual([{ name: 'GPT' }]);
    expect(schema.steps[1].task).toBe('Критерии проверки: полнота; сроки');
    expect(warnings).toEqual(['Проверка Basic импортирована как обычный этап: ветвление по вердикту не перенесено.',
      'Синтез Basic импортирован как раунд из одной модели с ролью.']);
  });

  test('a synthesis of a Basic file imports as a one-model round with the role as text and the task kept', () => {
    const basic = { schemaVersion: 1, origin: 'user', steps: [
      { ref: 'r1', kind: 'round', models: [{ name: 'Claude' }, { name: 'GPT' }] },
      { ref: 'final', kind: 'synthesis', task: 'Сведи ответы', input: ['r1'], models: [{ name: 'Gemini' }] }
    ] };
    const { schema, warnings } = Exchange.fromBasic(basic);
    expect(schema.steps[1]).toMatchObject({ block: 'round', task: 'Сведи ответы', inputs: ['s1'], models: [{ name: 'Gemini', role: 'свести' }] });
    expect(schema.steps[1].model).toBeUndefined();
    expect(warnings).toEqual(['Синтез Basic импортирован как раунд из одной модели с ролью.']);
  });

  test('a route of a Basic file is skipped with a remark and does not break the import', () => {
    const basic = { schemaVersion: 1, origin: 'user', steps: [
      { ref: 'r1', kind: 'round', models: [{ name: 'Claude' }] },
      { ref: 'route:x', kind: 'route', input: ['r1'], routes: [] },
      { ref: 'r2', kind: 'round', models: [{ name: 'GPT' }] }
    ] };
    const { schema, warnings } = Exchange.fromBasic(basic);
    expect(schema.steps.map((st) => st.block)).toEqual(['round', 'round']);
    expect(warnings).toEqual(['Маршрут Basic не импортирован: в черновой схеме ветвления нет.']);
  });

  test('source artifacts of the stand are not exported to Basic and the warning names them', () => {
    const { warnings } = Exchange.toBasic({ task: 'T', artifacts: [{ name: 'Бриф', content: 'текст' }], steps: [
      { id: 's1', block: 'round', title: 'R', why: 'w', models: [{ name: 'Claude' }], task: 'Сделай', inputs: ['in.Бриф'] }] });
    expect(warnings.some((w) => w.includes('Бриф'))).toBe(true);
  });

  test('description and run travel both ways', () => {
    const { schema: basic } = Exchange.toBasic({ task: 'T', description: 'Презентация', run: { policy: 'auto', maxWords: 500 },
      steps: [{ id: 's1', block: 'round', title: 'R', why: 'w', models: [{ name: 'Claude' }], task: 'Сделай' }] });
    expect(basic.description).toBe('Презентация');
    expect(basic.run).toEqual({ policy: 'auto', maxWords: 500 });
    const back = Exchange.fromBasic(basic).schema;
    expect(back.description).toBe('Презентация');
    expect(back.steps[0]).toMatchObject({ id: 's1', block: 'round', models: [{ name: 'Claude' }] });
  });

  test('blocks Basic does not have are skipped with a warning', () => {
    const { schema: basic, warnings } = Exchange.toBasic({ task: 'T', steps: [
      { id: 's1', block: 'round', title: 'R', why: 'w', models: [{ name: 'Claude' }], task: 'Сделай' },
      { id: 's2', block: 'file', title: 'F', why: 'w', file: 'x.md', mode: 'overwrite', inputs: ['s1'] }] });
    expect(warnings.some((w) => w.includes('s2'))).toBe(true);
    expect(Schema.validate(basic)).toEqual([]);
  });

  test('S-4/S-5: модель стенда с enabled:false уходит в Basic с enabled:false и проходит проверку', () => {
    const { schema: basic } = Exchange.toBasic({ task: 'T', steps: [
      { id: 's1', block: 'round', title: 'R', why: 'w', task: 'Сделай', models: [{ name: 'Claude', enabled: false }, { name: 'GPT' }] }] });
    expect(basic.steps[0].models[0].enabled).toBe(false);
    expect(Schema.validate(basic)).toEqual([]);
  });

  test('S-5: без input второй раунд Basic берёт предыдущий шаг', () => {
    const { schema } = Exchange.fromBasic({ schemaVersion: 1, origin: 'user', steps: [
      { ref: 'r1', kind: 'round', models: [{ name: 'Claude' }] },
      { ref: 'r2', kind: 'round', models: [{ name: 'GPT' }] }] });
    expect(schema.steps[1].inputs).toEqual(['s1']);
  });

  test('S-5: input "previous" берёт предыдущий шаг', () => {
    const { schema } = Exchange.fromBasic({ schemaVersion: 1, origin: 'user', steps: [
      { ref: 'r1', kind: 'round', models: [{ name: 'Claude' }] },
      { ref: 'r2', kind: 'round', input: 'previous', models: [{ name: 'GPT' }] }] });
    expect(schema.steps[1].inputs).toEqual(['s1']);
  });

  test('S-5: input "all" берёт все шаги выше', () => {
    const { schema } = Exchange.fromBasic({ schemaVersion: 1, origin: 'user', steps: [
      { ref: 'r1', kind: 'round', models: [{ name: 'Claude' }] },
      { ref: 'r2', kind: 'round', models: [{ name: 'GPT' }] },
      { ref: 'r3', kind: 'round', input: 'all', models: [{ name: 'Gemini' }] }] });
    expect(schema.steps[2].inputs).toEqual(['s1', 's2']);
  });

  test('S-5: input "none" не даёт поля inputs', () => {
    const { schema } = Exchange.fromBasic({ schemaVersion: 1, origin: 'user', steps: [
      { ref: 'r1', kind: 'round', models: [{ name: 'Claude' }] },
      { ref: 'r2', kind: 'round', input: 'none', models: [{ name: 'GPT' }] }] });
    expect('inputs' in schema.steps[1]).toBe(false);
  });

  test('S-5: круг Basic → стенд → Basic сохраняет связь раундов', () => {
    const basic = { schemaVersion: 1, origin: 'user', steps: [
      { ref: 'r1', kind: 'round', models: [{ name: 'Claude' }] },
      { ref: 'r2', kind: 'round', models: [{ name: 'GPT' }] }] };
    const back = Exchange.toBasic(Exchange.fromBasic(basic).schema).schema;
    expect(back.steps[1].input).toEqual(['r1']);
  });

  test('S-5: вход на пропущенный route не остаётся висячей ссылкой', () => {
    const { schema } = Exchange.fromBasic({ schemaVersion: 1, origin: 'user', steps: [
      { ref: 'r1', kind: 'round', models: [{ name: 'Claude' }] },
      { ref: 'route:x', kind: 'route', input: ['r1'], routes: [] },
      { ref: 'r2', kind: 'round', input: ['route:x'], models: [{ name: 'GPT' }] }] });
    expect(schema.steps.find((st) => st.id === 's3').inputs).toBeUndefined();
  });
});
