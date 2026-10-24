const Exchange = require('../docs/Pipeline scenarios/canvas-prototype/basic-export');

describe('review S2: Import файла Basic на стенд не теряет молча', () => {
  test('модель с enabled:false не становится включённой без замечания', () => {
    const { schema, warnings } = Exchange.fromBasic({ schemaVersion: 1, origin: 'user', steps: [
      { ref: 'r1', kind: 'round', models: [{ name: 'Claude', enabled: false }, { name: 'GPT' }] }] });
    const names = schema.steps[0].models.map((m) => m.name);
    expect(!names.includes('Claude') || warnings.some((w) => w.includes('Claude'))).toBe(true);
  });

  test('input "all" шага Basic не пропадает без замечания', () => {
    const { schema, warnings } = Exchange.fromBasic({ schemaVersion: 1, origin: 'user', steps: [
      { ref: 'r1', kind: 'round', models: [{ name: 'Claude' }] },
      { ref: 'r2', kind: 'round', input: 'all', models: [{ name: 'GPT' }] }] });
    const inputs = schema.steps[1].inputs;
    expect((Array.isArray(inputs) && inputs.length > 0) || warnings.some((w) => w.includes('all'))).toBe(true);
  });
});
