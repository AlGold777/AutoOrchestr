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
});
