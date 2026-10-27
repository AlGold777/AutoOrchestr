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
    expect(warnings).toEqual([
      'Шаг gate:g1: input «previous» импортирован как связь с ближайшим предыдущим этапом стенда; при прогоне Basic предыдущим может оказаться более ранний результат.',
      'Проверка Basic импортирована как обычный этап: ветвление по вердикту не перенесено.',
      'Шаг final: input «previous» импортирован как связь с ближайшим предыдущим этапом стенда; при прогоне Basic предыдущим может оказаться более ранний результат.',
      'Синтез Basic импортирован как раунд из одной модели с ролью.'
    ]);
  });

  test('a synthesis of a Basic file imports as a one-model round with the role as text and the task kept', () => {
    const basic = { schemaVersion: 1, origin: 'user', steps: [
      { ref: 'r1', kind: 'round', models: [{ name: 'Claude' }, { name: 'GPT' }] },
      { ref: 'final', kind: 'synthesis', task: 'Сведи ответы', input: ['r1'], models: [{ name: 'Gemini' }] }
    ] };
    const { schema, warnings } = Exchange.fromBasic(basic);
    expect(schema.steps[1]).toMatchObject({ block: 'round', task: 'Сведи ответы', inputs: ['s1'], models: [{ name: 'Gemini', role: 'свести' }] });
    expect(schema.steps[1].model).toBeUndefined();
    expect(warnings).toEqual([
      'Шаг final: необязательный вход (r1) Basic перенесён как связь со стендом; необязательность не сохраняется.',
      'Синтез Basic импортирован как раунд из одной модели с ролью.'
    ]);
  });

  test('a route of a Basic file is skipped with a remark and does not break the import', () => {
    const basic = { schemaVersion: 1, origin: 'user', steps: [
      { ref: 'r1', kind: 'round', models: [{ name: 'Claude' }] },
      { ref: 'route:x', kind: 'route', input: ['r1'], routes: [] },
      { ref: 'r2', kind: 'round', models: [{ name: 'GPT' }] }
    ] };
    const { schema, warnings } = Exchange.fromBasic(basic);
    expect(schema.steps.map((st) => st.block)).toEqual(['round', 'round']);
    expect(warnings).toEqual([
      'Маршрут Basic не импортирован: в черновой схеме ветвления нет.',
      'Шаг r2: input «previous» импортирован как связь с ближайшим предыдущим этапом стенда; при прогоне Basic предыдущим может оказаться более ранний результат.'
    ]);
  });

  test('a source artifact used as input becomes an inline Basic file', () => {
    const { schema: basic, warnings, errors } = Exchange.toBasic({ task: 'T', artifacts: [{ name: 'Бриф', content: 'текст' }], steps: [
      { id: 's1', block: 'round', title: 'R', why: 'w', models: [{ name: 'Claude' }], task: 'Сделай', inputs: ['in.Бриф'] }] });
    expect(basic.steps[0].files).toEqual([{ id: expect.stringMatching(/-in-1$/), name: 'Бриф.txt', content: 'текст' }]);
    expect(basic.steps[0].input).toBe('none');
    expect(warnings).toEqual([]);
    expect(errors).toEqual([]);
    expect(Schema.validate(basic)).toEqual([]);
  });

  test('an attachment input keeps the exact filename and a generated file id', () => {
    const { schema: basic, errors } = Exchange.toBasic({ task: 'T', artifacts: [{ name: 'макет', attachment: 'brief.final.pdf' }], steps: [
      { id: 's1', block: 'owner', ask: 'Прочитай', inputs: ['in.макет'] }] });
    expect(basic.steps[0].files).toEqual([{ id: expect.stringMatching(/-in-1$/), name: 'brief.final.pdf' }]);
    expect(errors).toEqual([]);
    expect(Schema.validate(basic)).toEqual([]);
  });

  test('inline source files do not receive a duplicate txt extension', () => {
    const { schema: basic } = Exchange.toBasic({ task: 'T', artifacts: [{ name: 'brief.txt', content: 'text' }], steps: [
      { id: 's1', block: 'round', models: [{ name: 'Claude' }], inputs: ['in.brief.txt'] }
    ] });
    expect(basic.steps[0].files[0].name).toBe('brief.txt');
  });

  test('source file IDs are fresh per export and shared across consumers within one export', () => {
    const stand = { task: 'T', artifacts: [{ name: 'Brief', content: 'text' }], steps: [
      { id: 's1', block: 'round', models: [{ name: 'Claude' }], inputs: ['in.Brief'] },
      { id: 's2', block: 'owner', ask: 'Review', inputs: ['in.Brief'] }
    ] };
    const first = Exchange.toBasic(stand).schema;
    const second = Exchange.toBasic(stand).schema;
    const firstId = first.steps[0].files[0].id;
    expect(firstId).not.toBe('in-1');
    expect(first.steps[1].files[0].id).toBe(firstId);
    expect(second.steps[0].files[0].id).not.toBe(firstId);
    expect(second.steps[1].files[0].id).toBe(second.steps[0].files[0].id);
  });

  test('ordinary artifacts become declared JSON outputs with exact semantic inputs', () => {
    const { schema: basic, errors } = Exchange.toBasic({ task: 'T', steps: [
      { id: 's1', block: 'round', title: 'R', models: [{ name: 'Claude' }], artifacts: [{ name: 'План' }, { name: 'Риски' }] },
      { id: 's2', block: 'round', title: 'Продолжение', models: [{ name: 'GPT' }], inputs: ['s1.План'] }
    ] });
    expect(basic.steps[0].output).toMatchObject({
      format: 'json', requiredFields: ['/a1', '/a2'],
      artifacts: [{ id: 'a1', name: 'План', pointer: '/a1' }, { id: 'a2', name: 'Риски', pointer: '/a2' }]
    });
    expect(basic.steps[0].output.form).toContain('«План»');
    expect(basic.steps[1].input).toEqual([{ artifact: { step: 'r1', participant: 'Claude', id: 'a1' }, version: 'latest', required: true }]);
    expect(errors).toEqual([]);
    expect(Schema.validate(basic)).toEqual([]);
  });

  test('shared output declarations export with multiple models, but artifact references remain ambiguous', () => {
    const { schema: basic, errors } = Exchange.toBasic({ task: 'T', steps: [
      { id: 's1', block: 'round', models: [{ name: 'Claude' }, { name: 'GPT' }], artifacts: [{ name: 'Итог' }] },
      { id: 's2', block: 'round', models: [{ name: 'Gemini' }], inputs: ['s1.Итог'] }
    ] });
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('участника артефакта нельзя определить')
    ]));
    expect(basic.steps[0].output.artifacts).toEqual([{ id: 'a1', name: 'Итог', pointer: '/a1' }]);
    expect(Schema.validate(basic)).toEqual([]);
  });

  test('ordinary outputs cannot be combined with read or form documents', () => {
    const { errors } = Exchange.toBasic({ task: 'T', steps: [
      { id: 's1', block: 'round', models: [{ name: 'Claude' }], artifacts: [{ name: 'Документ', document: 'read' }, { name: 'Дополнение' }] }
    ] });
    expect(errors).toContain('Этап s1: обычные артефакты не перенесены вместе с document «Документ»: несовместимые выходы.');
  });

  test('read documents retain exact artifact addresses while form references are rejected', () => {
    const read = Exchange.toBasic({ task: 'T', steps: [
      { id: 's1', block: 'round', models: [{ name: 'Claude' }], artifacts: [{ name: 'Док', description: 'Описание', document: 'read' }] },
      { id: 's2', block: 'round', models: [{ name: 'GPT' }], inputs: ['s1.Док'] }
    ] });
    expect(read.schema.steps[0].output.artifacts).toEqual([{ id: 'doc', name: 'Док', pointer: '', description: 'Описание' }]);
    expect(read.schema.steps[1].input).toEqual([{ artifact: { step: 'r1', participant: 'Claude', id: 'doc' }, version: 'latest', required: true }]);
    expect(read.errors).toEqual([]);
    const form = Exchange.toBasic({ task: 'T', steps: [
      { id: 's1', block: 'round', models: [{ name: 'Claude' }], artifacts: [{ name: 'Опрос', document: 'form' }] },
      { id: 's2', block: 'round', models: [{ name: 'GPT' }], inputs: ['s1.Опрос'] }
    ] });
    expect(form.schema.steps[0].output).toEqual({ format: 'json', document: 'form' });
    expect(form.errors.some((error) => error.includes('document form не объявляет адресуемый выходной артефакт'))).toBe(true);
  });

  test('owner ordinary artifacts export as JSON and are addressable by the owner participant', () => {
    const { schema: basic, errors } = Exchange.toBasic({ task: 'T', steps: [
      { id: 's1', block: 'owner', ask: 'Подготовьте итог', artifacts: [{ name: 'Решение', description: 'Выбор User' }] },
      { id: 's2', block: 'round', models: [{ name: 'Claude' }], inputs: ['s1.Решение'] }
    ] });
    expect(basic.steps[0].output).toMatchObject({ format: 'json', requiredFields: ['/a1'], artifacts: [
      { id: 'a1', name: 'Решение', pointer: '/a1', description: 'Выбор User' }
    ] });
    expect(basic.steps[1].input).toEqual([{ artifact: { step: 'owner:s1', participant: 'owner', id: 'a1' }, version: 'latest', required: true }]);
    expect(errors).toEqual([]);
    expect(Schema.validate(basic)).toEqual([]);
  });

  test('an absent or unsupported source input is an export error', () => {
    const missing = Exchange.toBasic({ task: 'T', steps: [{ id: 's1', block: 'round', models: [{ name: 'Claude' }], inputs: ['in.Файл'] }] });
    expect(missing.errors.some((error) => error.includes('исходный файл «Файл» не найден'))).toBe(true);
    const fileStep = Exchange.toBasic({ task: 'T', steps: [
      { id: 's1', block: 'file', inputs: [] },
      { id: 's2', block: 'round', models: [{ name: 'Claude' }], inputs: ['s1'] }
    ] });
    expect(fileStep.errors.some((error) => error.includes('вид file в Basic не поддерживается'))).toBe(true);
    expect(fileStep.errors.some((error) => error.includes('зависит от этапа file'))).toBe(true);
    const dangling = Exchange.toBasic({ task: 'T', steps: [
      { id: 's1', block: 'round', models: [{ name: 'Claude' }], inputs: ['missing'] }
    ] });
    expect(dangling.errors.some((error) => error.includes('отсутствует или не поддерживается'))).toBe(true);
    const backward = Exchange.toBasic({ task: 'T', steps: [
      { id: 's1', block: 'round', models: [{ name: 'Claude' }], inputs: ['s2'] },
      { id: 's2', block: 'round', models: [{ name: 'GPT' }] }
    ] });
    expect(backward.errors.some((error) => error.includes('источник должен быть раньше потребителя'))).toBe(true);
  });

  test('stand step inputs export as required whole-step Basic sources', () => {
    const { schema: basic, warnings } = Exchange.toBasic({ task: 'T', steps: [
      { id: 's1', block: 'round', title: 'Первый', models: [{ name: 'Claude' }], task: 'Сделай первое' },
      { id: 's2', block: 'round', title: 'Второй', models: [{ name: 'GPT' }], task: 'Продолжи', inputs: ['s1'] }
    ] });

    expect(basic.steps[1].input).toEqual([{ step: 'r1', required: true }]);
    expect(warnings).toEqual([]);
    expect(Schema.validate(basic)).toEqual([]);
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

  test('file blocks Basic does not have produce an export error', () => {
    const { schema: basic, errors } = Exchange.toBasic({ task: 'T', steps: [
      { id: 's1', block: 'round', title: 'R', why: 'w', models: [{ name: 'Claude' }], task: 'Сделай' },
      { id: 's2', block: 'file', title: 'F', why: 'w', file: 'x.md', mode: 'overwrite', inputs: ['s1'] }] });
    expect(errors.some((error) => error.includes('s2 (file)'))).toBe(true);
    expect(Schema.validate(basic)).toEqual([]);
  });

  test('unknown stand blocks are export errors', () => {
    const { errors } = Exchange.toBasic({ task: 'T', steps: [
      { id: 's1', block: 'unexpected', title: 'X' },
      { id: 's2', block: 'round', models: [{ name: 'Claude' }] }
    ] });
    expect(errors.some((error) => error.includes('unexpected') && error.includes('Basic такого блока нет'))).toBe(true);
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

  test('импорт предупреждает о необязательных, адресных и previous-входах с потерей смысла', () => {
    const { warnings } = Exchange.fromBasic({ schemaVersion: 1, origin: 'user', steps: [
      { ref: 'r1', kind: 'round', models: [{ name: 'Claude' }], output: { artifacts: [{ id: 'draft', name: 'Черновик' }] } },
      { ref: 'r2', kind: 'round', input: [
        { step: 'r1', participant: 'Claude' },
        { artifact: { step: 'r1', participant: 'Claude', id: 'draft' }, version: 'latest', required: true }
      ], models: [{ name: 'GPT' }] },
      { ref: 'r3', kind: 'round', input: 'previous', models: [{ name: 'Gemini' }] },
      { ref: 'r4', kind: 'round', input: 'all', models: [{ name: 'Claude', input: 'none' }] }
    ] });
    expect(warnings).toEqual([
      'Шаг r2: необязательный вход (участник «Claude») Basic перенесён как связь со стендом; необязательность не сохраняется.',
      'Шаг r2: адрес участника Claude этапа r1 сведён к связи со всем этапом.',
      'Шаг r2: адрес артефакта (артефакт «draft» участника «Claude») сведён к связи со всем этапом r1; артефакт и его версия не переносятся.',
      'Шаг r3: input «previous» импортирован как связь с ближайшим предыдущим этапом стенда; при прогоне Basic предыдущим может оказаться более ранний результат.',
      'Шаг r4: индивидуальный models[].input не перенесён на стенд.',
      'Шаг r4: input «all» собирает имеющиеся ответы всех предыдущих этапов; на стенде связи выглядят обязательными, и повторный экспорт сделает их обязательными.'
    ]);
  });

  test('Import Basic warns when files have no stand representation', () => {
    const { warnings } = Exchange.fromBasic({ schemaVersion: 1, origin: 'user', steps: [
      { ref: 'r1', kind: 'round', files: [{ id: 'in-1', name: 'brief.txt', content: 'x' }], models: [{ name: 'Claude', files: [{ id: 'model-1', name: 'extra.txt' }] }] }
    ] });
    expect(warnings).toContain('Шаг r1: входные файлы Basic не представлены в формате стенда и не перенесены.');
    expect(warnings).toContain('Шаг r1: файлы участника «Claude» Basic не представлены в формате стенда и не перенесены.');
  });

  test('B-2: раунд после шага User без input берёт этот шаг', () => {
    const { schema } = Exchange.fromBasic({ schemaVersion: 1, origin: 'user', steps: [
      { ref: 'owner:u', kind: 'owner', task: 'Уточните' },
      { ref: 'r1', kind: 'round', models: [{ name: 'Claude' }] }] });
    expect(schema.steps[1].inputs).toEqual(['s1']);
  });

  test('B-2: раунд после раунда и шага User без input берёт шаг User', () => {
    const { schema } = Exchange.fromBasic({ schemaVersion: 1, origin: 'user', steps: [
      { ref: 'r1', kind: 'round', models: [{ name: 'Claude' }] },
      { ref: 'owner:u', kind: 'owner', task: 'Уточните' },
      { ref: 'r2', kind: 'round', models: [{ name: 'GPT' }] }] });
    expect(schema.steps[2].inputs).toEqual(['s2']);
  });

  test('B-2: первый раунд без input не получает входа', () => {
    const { schema } = Exchange.fromBasic({ schemaVersion: 1, origin: 'user', steps: [
      { ref: 'r1', kind: 'round', models: [{ name: 'Claude' }] }] });
    expect('inputs' in schema.steps[0]).toBe(false);
  });

  test('B-2: явный input "none" у раунда после шага User не даёт входа', () => {
    const { schema } = Exchange.fromBasic({ schemaVersion: 1, origin: 'user', steps: [
      { ref: 'owner:u', kind: 'owner', task: 'Уточните' },
      { ref: 'r1', kind: 'round', input: 'none', models: [{ name: 'Claude' }] }] });
    expect('inputs' in schema.steps[1]).toBe(false);
  });

  test('S-5: круг Basic → стенд → Basic сохраняет связь раундов', () => {
    const basic = { schemaVersion: 1, origin: 'user', steps: [
      { ref: 'r1', kind: 'round', models: [{ name: 'Claude' }] },
      { ref: 'r2', kind: 'round', models: [{ name: 'GPT' }] }] };
    const back = Exchange.toBasic(Exchange.fromBasic(basic).schema).schema;
    expect(back.steps[1].input).toEqual([{ step: 'r1', required: true }]);
  });

  test('S-5: вход на пропущенный route не остаётся висячей ссылкой', () => {
    const { schema } = Exchange.fromBasic({ schemaVersion: 1, origin: 'user', steps: [
      { ref: 'r1', kind: 'round', models: [{ name: 'Claude' }] },
      { ref: 'route:x', kind: 'route', input: ['r1'], routes: [] },
      { ref: 'r2', kind: 'round', input: ['route:x'], models: [{ name: 'GPT' }] }] });
    expect(schema.steps.find((st) => st.id === 's3').inputs).toBeUndefined();
  });
});

describe('Документ для User и чат при обмене со стендом', () => {
  const docSchema = (artifact = { name: 'ТЗ', description: 'д', document: 'read' }, models = [{ name: 'Claude' }]) => ({
    task: 'T',
    steps: [
      { id: 's1', block: 'round', title: 'Черновик ТЗ', why: 'зачем', models, artifacts: [artifact], task: 'Напиши ТЗ' },
      { id: 's2', block: 'owner', title: 'Правки User', why: 'зачем', ask: 'Что исправить?', document: 's1' },
      { id: 's3', block: 'round', title: 'Исправление', why: 'зачем', inputs: ['s2'], models: [{ name: 'Claude' }], task: 'Исправь' }
    ]
  });

  test('а) read: раунд переносится с output.document и артефактом, owner — с ref раунда', () => {
    const { schema: basic, warnings } = Exchange.toBasic(docSchema());
    expect(Schema.validate(basic)).toEqual([]);
    expect(warnings).toEqual([]);
    const [round, owner] = basic.steps;
    expect(round.output).toEqual({ document: 'read', artifacts: [{ id: 'doc', name: 'ТЗ', pointer: '', description: 'д' }] });
    expect(owner.document).toBe('r1');
  });

  test('б) form: output { format: json, document: form } без artifacts', () => {
    const { schema: basic } = Exchange.toBasic(docSchema({ name: 'Опросник', description: 'д', document: 'form' }));
    expect(basic.steps[0].output).toEqual({ format: 'json', document: 'form' });
    expect(Schema.validate(basic)).toEqual([]);
  });

  test('в) раунд из нескольких моделей: перенос документа завершится ошибкой', () => {
    const { schema: basic, errors } = Exchange.toBasic(docSchema(undefined, [{ name: 'Claude' }, { name: 'GPT' }]));
    expect(basic.steps[0].output).toBeUndefined();
    expect(errors).toContain('Этап s1: документ «ТЗ» не перенесён: в Basic документ для User даёт раунд из одной модели.');
  });

  test('г) chat new переносится в шаг Basic', () => {
    const schema = docSchema();
    schema.steps[2].chat = 'new';
    const { schema: basic } = Exchange.toBasic(schema);
    expect(basic.steps[2].chat).toBe('new');
    expect(Schema.validate(basic)).toEqual([]);
  });

  test('д) круг: Basic → стенд → Basic снова проходит проверку', () => {
    const { schema: basic } = Exchange.toBasic(docSchema());
    basic.steps[2].chat = 'continue';
    const { schema } = Exchange.fromBasic(basic);
    expect(schema.steps[0].artifacts).toEqual([{ name: 'ТЗ', document: 'read' }]);
    expect(schema.steps[1].document).toBe('s1');
    expect(schema.steps[2].chat).toBe('continue');
    const { schema: again } = Exchange.toBasic(schema);
    expect(Schema.validate(again)).toEqual([]);
  });

  test('д) круг для form: опросник возвращается артефактом form', () => {
    const { schema: basic } = Exchange.toBasic(docSchema({ name: 'Опросник', description: 'д', document: 'form' }));
    const { schema } = Exchange.fromBasic(basic);
    expect(schema.steps[0].artifacts).toEqual([{ name: 'Опросник', document: 'form' }]);
  });
});
