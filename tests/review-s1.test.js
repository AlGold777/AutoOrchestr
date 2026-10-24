const Schema = require('../disput/basic-schema');
const Exchange = require('../docs/Pipeline scenarios/canvas-prototype/basic-export');

const round = (id, extra = {}) => ({ id, block: 'round', title: id, why: 'w', task: 'Сделай', models: [{ name: 'Claude' }], ...extra });

describe('review S1: Export стенда → Basic не теряет молча', () => {
  test('run.maxWords вне 300/500/700/1000 не пропадает без предупреждения', () => {
    const { schema, warnings } = Exchange.toBasic({ task: 'T', run: { maxWords: 800 }, steps: [round('s1')] });
    const kept = schema.run && schema.run.maxWords === 800;
    expect(kept || warnings.some((w) => w.includes('maxWords'))).toBe(true);
  });

  test('вход этапа на непереносимый file-этап: есть предупреждение о разорванной связи', () => {
    const { schema, warnings } = Exchange.toBasic({ task: 'T', steps: [
      { id: 's1', block: 'file', title: 'F', why: 'w', file: 'x.md', mode: 'overwrite' },
      round('s2', { inputs: ['s1'] })] });
    expect(Schema.validate(schema)).toEqual([]);
    expect(warnings.some((w) => /s2/.test(w) && /вход|input/i.test(w))).toBe(true);
  });

  test('вход «s1.Артефакт» не превращается молча во весь ответ этапа', () => {
    const { schema, warnings } = Exchange.toBasic({ task: 'T', steps: [
      round('s1', { artifacts: [{ name: 'Артефакт', description: 'd' }] }),
      round('s2', { inputs: ['s1.Артефакт'] })] });
    expect(Schema.validate(schema)).toEqual([]);
    expect(schema.steps[1].input).toEqual(['r1']);
    expect(warnings.some((w) => w.includes('Артефакт'))).toBe(true);
  });
});
