const Schema = require('../disput/basic-schema');

const schemaOf = (steps) => ({ schemaVersion: 1, origin: 'user', steps });
const stepOf = (schema, ref) => schema.steps.find((step) => step.ref === ref);

describe('Basic: a model added to a round', () => {
  test('participants asked different things are separate assignments; the same assignment is one group', () => {
    const schema = schemaOf([{ ref: 'r1', kind: 'round', task: 'Общее', models: [
      { name: 'GPT', task: 'Найди слабые места' },
      { name: 'DeepSeek', task: 'Предложи исправления', role: 'critic' },
      { name: 'Qwen', task: 'Найди слабые места' },
      { name: 'Claude' },
      { name: 'Grok', enabled: false, task: 'не считается' }
    ] }]);
    const groups = Schema.roundAssignments(schema, 'r1');
    expect(groups.map((group) => [group.id, group.labels, group.task, group.role])).toEqual([
      ['GPT', ['GPT', 'Qwen'], 'Найди слабые места', ''],
      ['DeepSeek', ['DeepSeek'], 'Предложи исправления', 'critic'],
      ['Claude', ['Claude'], 'Общее', '']
    ]);
  });

  test('the new model takes the settings of the chosen participant, with Send on', () => {
    const schema = schemaOf([
      { ref: 'r1', kind: 'round', models: [{ name: 'GPT' }] },
      { ref: 'r2', kind: 'round', models: [
        { name: 'GPT', task: 'А', maxWords: 300, input: 'all', discipline: { content: 'кратко' } },
        { name: 'DeepSeek', task: 'Б', role: 'critic' }
      ] }
    ]);
    const { schema: next, id } = Schema.addToRound(schema, 'r2', { name: 'Claude', like: 'DeepSeek', newId: 'x' });
    expect(id).toBe('Claude');
    expect(stepOf(next, 'r2').models[2]).toEqual({ id: 'Claude', name: 'Claude', task: 'Б', role: 'critic' });
    expect(Schema.validate(next)).toEqual([]);
    expect(schema.steps[1].models).toHaveLength(2);
  });

  test('without a chosen participant the new model inherits the round', () => {
    const schema = schemaOf([{ ref: 'r1', kind: 'round', task: 'Т', models: [] }]);
    const { schema: next } = Schema.addToRound(schema, 'r1', { name: 'GPT' });
    expect(stepOf(next, 'r1').models).toEqual([{ id: 'GPT', name: 'GPT' }]);
    expect(Schema.validate(next)).toEqual([]);
  });

  test('a model of another round joins as the same participant; a second one of a model gets a new id and label', () => {
    const schema = schemaOf([
      { ref: 'r1', kind: 'round', models: [{ name: 'GPT' }, { name: 'Claude' }] },
      { ref: 'r2', kind: 'round', models: [{ name: 'Claude', task: 'К' }] }
    ]);
    const same = Schema.addToRound(schema, 'r2', { name: 'GPT', like: 'Claude' });
    expect(stepOf(same.schema, 'r2').models[1]).toEqual({ id: 'GPT', name: 'GPT', task: 'К' });
    const second = Schema.addToRound(schema, 'r2', { name: 'Claude', like: 'Claude', newId: 'uuid-1' });
    expect(stepOf(second.schema, 'r2').models[1]).toEqual({ id: 'uuid-1', name: 'Claude', label: 'Claude 2', task: 'К' });
    expect(Schema.validate(second.schema)).toEqual([]);
  });

  test('a switched-off participant of that model in the round is switched on with the chosen settings', () => {
    const schema = schemaOf([{ ref: 'r1', kind: 'round', models: [
      { name: 'GPT', task: 'А' }, { name: 'Claude', enabled: false, onCanvas: true, task: 'старое' }
    ] }]);
    const { schema: next } = Schema.addToRound(schema, 'r1', { name: 'Claude', like: 'GPT' });
    expect(stepOf(next, 'r1').models).toEqual([{ id: 'GPT', name: 'GPT', task: 'А' }, { id: 'Claude', name: 'Claude', task: 'А' }]);
  });

  test('an unknown participant to copy is an error, not a change', () => {
    const schema = schemaOf([{ ref: 'r1', kind: 'round', models: [{ name: 'GPT' }] }]);
    expect(Schema.addToRound(schema, 'r1', { name: 'Claude', like: 'Nobody' })).toEqual({ error: 'в r1 нет участника «Nobody»' });
  });
});
