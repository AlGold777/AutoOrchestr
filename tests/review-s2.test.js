const Exchange = require('../docs/Pipeline scenarios/canvas-prototype/basic-export');

describe('review S2: Import файла Basic на стенд не теряет молча', () => {
  test('модель с enabled:false не становится включённой без замечания', () => {
    const { schema, warnings } = Exchange.fromBasic({ schemaVersion: 1, origin: 'user', steps: [
      { ref: 'r1', kind: 'round', models: [{ name: 'Claude', enabled: false }, { name: 'GPT' }] }] });
    const claude = schema.steps[0].models.find((m) => m.name === 'Claude');
    expect(claude && claude.enabled === false).toBe(true);
    expect(warnings).toEqual([]);
  });

  test('input "all" шага Basic не пропадает без замечания', () => {
    const { schema, warnings } = Exchange.fromBasic({ schemaVersion: 1, origin: 'user', steps: [
      { ref: 'r1', kind: 'round', models: [{ name: 'Claude' }] },
      { ref: 'r2', kind: 'round', input: 'all', models: [{ name: 'GPT' }] }] });
    const inputs = schema.steps[1].inputs;
    expect((Array.isArray(inputs) && inputs.length > 0) || warnings.some((w) => w.includes('all'))).toBe(true);
  });
});
