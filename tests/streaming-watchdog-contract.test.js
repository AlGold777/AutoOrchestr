const fs = require('fs');
const path = require('path');

describe('streaming watchdog contract', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'content-scripts', 'unified-answer-pipeline.js'),
    'utf8'
  );

  test('profile timeouts are not changed by platform speed multipliers', () => {
    expect(source).not.toMatch(/modelSpeedMultiplier/);
    expect(source).toContain('soft: baseTimeouts.soft');
    expect(source).toContain('hard: Math.max(baseTimeouts.hard');
  });

  test('watchdog never fires before the lifecycle detector decides', () => {
    expect(source).toContain('completionWaitMs?.()');
    expect(source).toMatch(/hard: Math\.max\(baseTimeouts\.hard, lifecycleWaitMs \? lifecycleWaitMs \+ COMPLETION_DECISION_MARGIN_MS : 0\)/);
  });

  test('hard timeout races both streaming coordination modes', () => {
    expect(source).toContain('const hardTimeoutPromise = new Promise');
    expect(source).toMatch(/Promise\.race\(\[\s*Promise\.all\(\[scrollPromise, answerPromise\]\),\s*hardTimeoutPromise/);
    expect((source.match(/hardTimeoutPromise/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});
