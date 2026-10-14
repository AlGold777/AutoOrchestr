const ProblemSpec = require('../disput/debate-problem-spec');
const Anonymization = require('../disput/debate-anonymization');
const Routing = require('../disput/debate-capability-registry');

describe('Disput sections II–III contracts', () => {
  test('ProblemSpec extracts type, constraints and evidence mode', () => {
    const spec = ProblemSpec.extract({ topic: 'Сравни подходы. Не используй внешние API. Только факты.' });
    expect(spec.taskType).toBe('analysis'); expect(spec.constraints).toHaveLength(2); expect(spec.evidenceMode).toBe('preferred');
  });
  test('research requirements are explicit and block unsupported model sets', () => {
    expect(Routing.validateRequirements({ models: ['GPT', 'Claude'], tools: ['web_research'] }))
      .toEqual({ ok: false, missingTools: ['web_research'] });
    expect(Routing.validateRequirements({ models: ['Perplexity'], tools: ['web_research'] }).ok).toBe(true);
  });
  test('anonymization round trips and prefers longer names', () => {
    const map = Anonymization.createAliasMap(['Model','Model Pro']); const hidden = Anonymization.anonymizeText('Model Pro uses Model', map);
    expect(Anonymization.deanonymizeText(hidden, map)).toBe('Model Pro uses Model');
  });
});
