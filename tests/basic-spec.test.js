const Spec = require('../disput/basic-spec');
const Schema = require('../disput/basic-schema');
const fixture = require('./fixtures/basic-architecture-s01-s30.json');

const SPEC_KEYS = ['purpose', 'inputs', 'result', 'application', 'readiness', 'rules', 'boundaries', 'failure'];
const byKey = (list, key) => list.find((item) => item.key === key);

// Template A: one round of three models and the synthesis: a round of one model with a role.
const templateA = () => ({
  schemaVersion: 1,
  origin: 'user',
  steps: [
    { ref: 'r1', kind: 'round', models: [{ name: 'GPT' }, { name: 'Claude', role: 'critic' }, { name: 'Gemini', enabled: false }] },
    { ref: 'r2', kind: 'round', models: [{ name: 'Claude', role: 'interaction_meta_synthesis' }] }
  ]
});

describe('Basic spec: the interface and the three layers', () => {
  test('the module gives build and toMarkdown, and the name goes into the model', () => {
    expect(Object.keys(Spec).sort()).toEqual(['build', 'toMarkdown']);
    expect(Spec.build(templateA(), { name: 'A' }).name).toBe('A');
    expect(Spec.build(templateA()).name).toBe('');
  });

  test('template A: the whole, the scheme, the stages and the missing author fields', () => {
    const schema = templateA();
    expect(Schema.validate(schema)).toEqual([]);
    const model = Spec.build(schema, { name: 'A' });

    expect(model.whole.map((item) => item.key)).toEqual([...SPEC_KEYS, 'ownerInvolvement', 'volume']);
    SPEC_KEYS.forEach((key) => expect(byKey(model.whole, key)).toMatchObject({ value: '', source: 'missing' }));
    expect(byKey(model.whole, 'ownerInvolvement')).toMatchObject({ source: 'schema', value: 'User решает после каждого этапа' });
    expect(byKey(model.whole, 'volume').value).toContain('этапов: 2; участников: 2; запросов не меньше 3');

    expect(model.scheme.stages.map((item) => item.title)).toEqual(['Раунд 1', 'Раунд 2']);
    expect(model.scheme.links).toEqual([{ from: 1, to: 2, label: 'ответы этапа «Раунд 1»' }]);

    const [round, synthesis] = model.stages;
    expect(round.participants).toEqual([
      { name: 'GPT', role: '', id: '', words: 300 },
      { name: 'Claude', role: 'critic', id: '', words: 300 }
    ]);
    expect(round.count).toBe(2);
    expect(round).not.toHaveProperty('order');
    // The first round has no input, and Basic's task is not sent to it: nothing is written, so nothing is shown as default.
    expect(round.input.value).toBe('нет: этап получает только задание');
    expect(round.task).toMatchObject({ value: '', source: 'missing' });
    expect(round.title).toMatchObject({ value: 'Раунд 1', source: 'schema' });
    expect(round.goal).toMatchObject({ value: '', source: 'missing' });

    expect(synthesis.title).toMatchObject({ value: 'Раунд 2', source: 'schema' });
    expect(synthesis.kindLabel).toBe('раунд');
    expect(synthesis.participants).toEqual([{ name: 'Claude', role: 'interaction_meta_synthesis', id: '', words: 300 }]);
    expect(synthesis.input.value).toBe('ответы: «Раунд 1»');
    expect(synthesis.task).toMatchObject({ value: '', source: 'default' });
    expect(synthesis.output.value).toContain('ответ в свободной форме (выход не задан)');
    expect(synthesis.output.value).toContain('предел слов: 300');
    expect(synthesis.output.value).toContain('строгая длина: нет');

    expect(model.completeness.total).toBe(8 + 4 * 2);
    expect(model.completeness.filled).toBe(0);
    expect(model.completeness.missing).toEqual(expect.arrayContaining(['spec.purpose', 'spec.failure', 'r1.title', 'r1.goal', 'r2.quality']));
    expect(model.completeness.missing).toHaveLength(16);
  });

  test('toMarkdown: the title, the three layers, stage names, and the mark of a missing field', () => {
    const md = Spec.toMarkdown(Spec.build(templateA(), { name: 'A' }));
    expect(md.startsWith('# Спецификация pipeline «A»')).toBe(true);
    ['## Pipeline в целом', '## Схема процесса', '## 1. Раунд 1', '## 2. Раунд 2'].forEach((heading) => expect(md).toContain(heading));
    expect(md).toContain('- **Назначение:** _не заполнено_');
    expect(md).toContain('- **Задание этапа:** _умолчание Basic_');
    expect(md).toContain('Заполнено полей автора: 0 из 16.');
  });
});

describe('Basic spec: the author fields', () => {
  test('a text the author wrote is shown as it is, with source author; a blank one is missing', () => {
    const schema = {
      schemaVersion: 1,
      origin: 'user',
      spec: { purpose: '  Назначение, как написал автор.  ', rules: '   ' },
      steps: [{ ref: 'r1', kind: 'round', title: 'Сбор', goal: 'Цель этапа', quality: 'Без повторов', models: [{ name: 'GPT' }] }]
    };
    const model = Spec.build(schema);
    expect(byKey(model.whole, 'purpose')).toEqual({ key: 'purpose', label: 'Назначение', value: '  Назначение, как написал автор.  ', source: 'author' });
    expect(byKey(model.whole, 'rules')).toMatchObject({ value: '', source: 'missing' });
    const [stage] = model.stages;
    expect(stage.title).toMatchObject({ value: 'Сбор', source: 'author' });
    expect(stage.goal).toMatchObject({ value: 'Цель этапа', source: 'author' });
    expect(stage.quality).toMatchObject({ value: 'Без повторов', source: 'author' });
    expect(stage.rules).toMatchObject({ value: '', source: 'missing' });
    expect(model.scheme.stages[0].title).toBe('Сбор');
    // The title, the goal and the quality are written; the other seven spec fields and the rules are not.
    expect(model.completeness).toEqual({ filled: 4, total: 8 + 4, missing: expect.arrayContaining(['spec.rules', 'r1.rules']) });
    expect(model.completeness.missing).toHaveLength(8);
    expect(Spec.toMarkdown(model)).toContain('- **Общие правила и ограничения:** _не заполнено_');
  });
});

describe('Basic spec: the links of the input', () => {
  // Stages: 1 r1 (answer with a name), 2 r2 (previous), 3 owner (previous), 4 r3 (previous: the owner's answer),
  // 5 r4 (a list: a participant of r1, r2, an artifact of r3), 6 r5 (all answer steps before it).
  const linked = () => ({
    schemaVersion: 1,
    origin: 'user',
    steps: [
      { ref: 'r1', kind: 'round', models: [{ name: 'A' }, { name: 'B' }], output: { name: 'Decision Policy', form: 'Текст' } },
      { ref: 'r2', kind: 'round', input: 'previous', models: [{ name: 'C' }] },
      { ref: 'owner:g', kind: 'owner', input: 'previous', task: 'Проверьте полноту', models: [] },
      { ref: 'r3', kind: 'round', input: 'previous', models: [{ name: 'D' }] },
      {
        ref: 'r4', kind: 'round', models: [{ name: 'E' }],
        input: [{ step: 'r1', participant: 'A' }, 'r2', { artifact: { step: 'r3', participant: 'D', id: 'doc' }, version: 'latest' }]
      },
      { ref: 'r5', kind: 'round', input: 'all', models: [{ name: 'F' }] }
    ]
  });

  test('previous takes the nearest earlier answer step; its output name is the label', () => {
    const model = Spec.build(linked());
    expect(model.scheme.links.filter((link) => link.to === 2)).toEqual([{ from: 1, to: 2, label: 'Decision Policy' }]);
    expect(model.stages[1].input.value).toBe('ответы: «Раунд 1»');
  });

  test('an owner step is an answer step: the step after it reads the owner answer', () => {
    const model = Spec.build(linked());
    expect(model.scheme.links.filter((link) => link.to === 3)).toEqual([{ from: 2, to: 3, label: 'ответы этапа «Раунд 2»' }]);
    expect(model.scheme.links.filter((link) => link.to === 4)).toEqual([{ from: 3, to: 4, label: 'ответы этапа «User g»' }]);
    expect(model.stages[3].input.value).toBe('ответы: «User g»');
  });

  test('all takes every earlier answer step', () => {
    const model = Spec.build(linked());
    expect(model.scheme.links.filter((link) => link.to === 6)).toEqual([
      { from: 1, to: 6, label: 'Decision Policy' },
      { from: 2, to: 6, label: 'ответы этапа «Раунд 2»' },
      { from: 3, to: 6, label: 'ответы этапа «User g»' },
      { from: 4, to: 6, label: 'ответы этапа «Раунд 3»' },
      { from: 5, to: 6, label: 'ответы этапа «Раунд 4»' }
    ]);
    expect(model.stages[5].input.value).toBe('ответы: «Раунд 1», «Раунд 2», «User g», «Раунд 3», «Раунд 4»');
  });

  test('a list takes the named sources: a participant, a step, an artifact (the label is the step label)', () => {
    const model = Spec.build(linked());
    expect(model.stages[4].input.value).toBe('ответы: «Раунд 1» (участник A), «Раунд 2», «Раунд 3» (участник D) (артефакт doc)');
    expect(model.scheme.links.filter((link) => link.to === 5)).toEqual([
      { from: 1, to: 5, label: 'Decision Policy', participant: 'A' },
      { from: 2, to: 5, label: 'ответы этапа «Раунд 2»' },
      { from: 4, to: 5, label: 'ответы этапа «Раунд 3»', participant: 'D' }
    ]);
  });

  test('a source of a switched-off step is named as switched off and gives no link', () => {
    const schema = { schemaVersion: 1, origin: 'user', steps: [
      { ref: 'r1', kind: 'round', models: [{ name: 'A' }] },
      { ref: 'r2', kind: 'round', models: [{ name: 'B', enabled: false }] },
      { ref: 'r3', kind: 'round', input: ['r2'], models: [{ name: 'C' }] }
    ] };
    const model = Spec.build(schema);
    expect(model.stages.map((stage) => stage.ref)).toEqual(['r1', 'r3']);
    expect(model.stages[1].input.value).toBe('ответы: выключенный этап «r2»');
    expect(model.scheme.links).toEqual([]);
  });
});

describe('Basic spec: the owner, the participants and the stage kinds', () => {
  test('the run policy and the steps of the owner', () => {
    const schema = {
      schemaVersion: 1,
      origin: 'user',
      run: { policy: 'auto' },
      steps: [
        { ref: 'r1', kind: 'round', models: [{ name: 'A' }] },
        { ref: 'owner:s01', kind: 'owner', input: ['r1'], task: 'Утвердить', output: { name: 'Policy', form: 'Текст' } },
        { ref: 'r2', kind: 'round', owner: 'approve', models: [{ name: 'B' }, { name: 'C' }] }
      ]
    };
    const model = Spec.build(schema);
    expect(byKey(model.whole, 'ownerInvolvement').value).toBe('User решает только при проблемах; утверждает этапы: Раунд 2; этапы User: User s01');
    expect(model.stages[1]).toMatchObject({ kindLabel: 'User', count: 0, participants: [] });
    expect(model.stages[1].owner.value).toBe('этап выполняет User');
    expect(model.stages[1].task).toMatchObject({ value: 'Утвердить', source: 'schema' });
    expect(model.stages[2].owner.value).toBe('User утверждает ответ этапа');
    expect(model.stages[2].task).toMatchObject({ value: '', source: 'default' });
    // The owner reads r1 (its input); r2 reads the owner by default (previous), so the owner's output name is the label.
    expect(model.scheme.links).toEqual([{ from: 1, to: 2, label: 'ответы этапа «Раунд 1»' }, { from: 2, to: 3, label: 'Policy' }]);
  });

  test('a participant switched off is not a participant; a step without participants is skipped', () => {
    const schema = {
      schemaVersion: 1,
      origin: 'user',
      steps: [
        { ref: 'r1', kind: 'round', models: [{ name: 'A' }, { name: 'B', enabled: false }] },
        { ref: 'r2', kind: 'round', models: [{ name: 'C', enabled: false }] },
        { ref: 'r3', kind: 'round', models: [{ name: 'A' }] }
      ]
    };
    const model = Spec.build(schema);
    expect(model.stages.map((stage) => stage.ref)).toEqual(['r1', 'r3']);
    expect(model.stages[0].participants.map((item) => item.name)).toEqual(['A']);
    expect(byKey(model.whole, 'volume').value).toContain('этапов: 2; участников: 1; запросов не меньше 2');
  });

  test('the scheme lists the stages in order without transitions: there are no branches', () => {
    const schema = {
      schemaVersion: 1,
      origin: 'user',
      steps: [
        { ref: 'r1', kind: 'round', models: [{ name: 'A' }] },
        { ref: 'owner:ok', kind: 'owner', input: 'previous', task: 'Решите, принять ли ответ', models: [] },
        { ref: 'r2', kind: 'round', models: [{ name: 'B' }] }
      ]
    };
    const model = Spec.build(schema);
    expect(model.scheme.stages.map((stage) => [stage.title, stage.kindLabel])).toEqual([['Раунд 1', 'раунд'], ['User ok', 'User'], ['Раунд 2', 'раунд']]);
    expect(model.scheme.stages.every((stage) => !('transitions' in stage))).toBe(true);
  });
});

describe('Basic spec: the Basic fixture S01–S30', () => {
  test('it builds every stage the assembly keeps, without errors, and renders all of them', () => {
    const model = Spec.build(fixture, { name: 'S01-S30' });
    const assembled = Schema.assemble(fixture);
    expect(model.stages).toHaveLength(assembled.length);
    expect(model.stages.length).toBeGreaterThan(30);
    expect(model.scheme.stages).toHaveLength(model.stages.length);
    expect(model.completeness.total).toBe(8 + 4 * model.stages.length);
    expect(model.completeness.filled).toBe(0);
    expect(model.completeness.missing).toHaveLength(model.completeness.total);
    model.stages.forEach((stage) => expect(stage.title.value).not.toBe(''));
    expect(model.scheme.links.length).toBeGreaterThan(0);

    const md = Spec.toMarkdown(model);
    model.stages.forEach((stage) => expect(md).toContain(`## ${stage.number}. ${stage.title.value}`));
    expect(md).toContain('## Схема процесса');
    expect(byKey(model.whole, 'ownerInvolvement').value).toContain('User решает только при проблемах');
  });
});

describe('Basic spec: empty and partial schemas', () => {
  test('a schema with one step, or none, does not fail', () => {
    expect(Spec.build({}).stages).toEqual([]);
    expect(Spec.build(null).completeness.total).toBe(8);
    expect(Spec.build({ steps: [{ ref: 'r1', kind: 'round', models: [] }] }).stages).toEqual([]);
    const one = Spec.build({ steps: [{ ref: 'r1', kind: 'round', models: [{ name: 'X' }] }] });
    expect(one.stages.map((stage) => stage.title.value)).toEqual(['Раунд 1']);
    expect(Spec.toMarkdown(one)).toContain('## 1. Раунд 1');
    expect(Spec.toMarkdown(Spec.build({}))).toContain('_Этапов нет._');
    expect(() => Spec.toMarkdown({})).not.toThrow();
  });
});
