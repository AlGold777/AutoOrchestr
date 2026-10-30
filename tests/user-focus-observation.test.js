const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'human-presence.js'),
  'utf8'
);

describe('user focus observation is not an automation lease', () => {
  test('tab activation records user observation without starting a visit lease', () => {
    const activation = SOURCE.slice(
      SOURCE.indexOf('function handleTabActivation'),
      SOURCE.indexOf('function clearExpiredProgrammaticFocus')
    );
    expect(activation).toContain('recordUserFocusObservation(tabId, llmName)');
    expect(activation).not.toContain("startTabVisit(tabId, llmName, 'user_focus')");
  });

  test('user observation has no lease, hard cap or focus-stuck timer', () => {
    const observation = SOURCE.slice(
      SOURCE.indexOf('function recordUserFocusObservation'),
      SOURCE.indexOf('function clearExpiredProgrammaticFocus')
    );
    expect(observation).toContain("source: 'user_focus'");
    expect(observation).toContain("'USER_FOCUS_OBSERVATION_STARTED'");
    expect(observation).not.toContain("'LEASE_GRANTED'");
    expect(observation).not.toContain('scheduleVisitHardCapTimer');
    expect(observation).not.toContain('focusStuckTimer = setTimeout');
  });

  test('legacy calls with user_focus are routed into the observation contract', () => {
    const startVisit = SOURCE.slice(
      SOURCE.indexOf('function startTabVisit'),
      SOURCE.indexOf('function finalizeTabVisit')
    );
    expect(startVisit).toContain("if (source === 'user_focus')");
    expect(startVisit).toContain('return recordUserFocusObservation(tabId, llmName)');
  });
});
