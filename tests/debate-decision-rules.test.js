const History = require('../disput/debate-rule-history');

describe('cross-run rule history', () => {
  test('calculates firing and post-action progress rates', () => {
    const result = History.summarize([{
      runId: 'r1',
      ruleEvaluations: [
        { eventType: 'RULE_EVALUATED', ruleId: 'weak', triggerId: 'WEAK_EVIDENCE', status: 'fired' },
        { eventType: 'RULE_FIRED', ruleId: 'weak', triggerId: 'WEAK_EVIDENCE', status: 'fired' },
        { eventType: 'RULE_EVALUATED', ruleId: 'weak', triggerId: 'WEAK_EVIDENCE', status: 'suppressed' }
      ],
      progressWindow: [{ triggerId: 'WEAK_EVIDENCE', stateChanged: true }]
    }]);
    expect(result.byRule.weak).toMatchObject({ evaluated: 2, fired: 1, suppressed: 1, completed: 1, changed: 1, fireRate: 0.5, progressRate: 1 });
  });
});
