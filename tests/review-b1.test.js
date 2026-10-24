const Schema = require('../disput/basic-schema');

describe('review B1: validate на имени вида шага из Object.prototype', () => {
  test.each(['toString', 'constructor', 'hasOwnProperty'])('kind «%s» даёт ошибку проверки, а не исключение', (kind) => {
    const schema = { schemaVersion: 1, origin: 'user', steps: [{ ref: 'r1', kind, models: [] }] };
    let errors;
    expect(() => { errors = Schema.validate(schema); }).not.toThrow();
    expect(errors.some((e) => e.path === 'steps[0].kind')).toBe(true);
  });
});
