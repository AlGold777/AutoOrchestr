const Anonymization = require('../disput/debate-anonymization');

describe('Disput sections II–III contracts', () => {
  test('anonymization round trips and prefers longer names', () => {
    const map = Anonymization.createAliasMap(['Model','Model Pro']); const hidden = Anonymization.anonymizeText('Model Pro uses Model', map);
    expect(Anonymization.deanonymizeText(hidden, map)).toBe('Model Pro uses Model');
  });
});
