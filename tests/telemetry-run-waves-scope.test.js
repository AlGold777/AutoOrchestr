const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// Evaluates the run-scope helpers exactly as they are written in the source file.
const loadScopeFn = (source, startMarker, endMarker, exportName) => {
  const block = source.slice(source.indexOf(startMarker), source.indexOf(endMarker));
  const parseRunSessionIdFromDispatchId = (dispatchId) => {
    const parts = String(dispatchId || '').trim().split(':');
    if (parts.length < 3) return null;
    const middle = Number(parts[1]);
    return Number.isFinite(middle) && middle > 0 ? middle : null;
  };
  const resolveTelemetryPlatformName = (event) => event?.platform || event?.llmName || 'unknown';
  const resolveRoundLabel = (event) => String(event?.label || '').toUpperCase();
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'parseRunSessionIdFromDispatchId', 'resolveTelemetryPlatformName', 'resolveRoundLabel',
    `${block}\nreturn { ${exportName} };`
  );
  return factory(parseRunSessionIdFromDispatchId, resolveTelemetryPlatformName, resolveRoundLabel)[exportName];
};

const RESULTS_SRC = read('results.js');
const DEVTOOLS_SRC = read('results-devtools.js');

// Two waves of the current pipeline run (P1) and one event of an older run (P0).
const events = () => [
  { ts: 100, platform: 'A', label: 'old', meta: { pipelineRunId: 'P0', runSessionId: 5 } },
  { ts: 1000, platform: 'A', label: 'w1', meta: { pipelineRunId: 'P1', runSessionId: 10 } },
  { ts: 1500, platform: 'B', label: 'w1b', meta: { pipelineRunId: 'P1', runSessionId: 10 } },
  { ts: 2000, platform: 'A', label: 'w2', meta: { pipelineRunId: 'P1', runSessionId: 11 } },
  { ts: 1200, platform: 'C', label: 'no-pipeline-w1', meta: { runSessionId: 10 } },
  { ts: 2100, platform: 'C', label: 'no-pipeline-w2', meta: { runSessionId: 11 } },
  { ts: 50, platform: 'C', label: 'no-pipeline-old', meta: { runSessionId: 5 } }
];
// Events without pipelineRunId follow the runSessionId rule: only the latest wave (11) is kept.
const EXPECTED_LABELS = ['no-pipeline-w2', 'w1', 'w1b', 'w2'];

describe('DevTools live cards keep all waves of the current pipelineRunId', () => {
  const filterEventsToCurrentRun = loadScopeFn(
    DEVTOOLS_SRC,
    'const resolveEventRunSessionId = (event) => {',
    'const formatTelemetryTimestamp',
    'filterEventsToCurrentRun'
  );

  test('keeps events of every wave of the same pipelineRunId and drops another run', () => {
    const result = filterEventsToCurrentRun(events());
    const labels = result.events.map((event) => event.label).sort();
    expect(labels).toEqual([...EXPECTED_LABELS].sort());
    expect(result.events.some((event) => event.label === 'old')).toBe(false);
    expect(result.events.some((event) => event.label === 'no-pipeline-old')).toBe(false);
  });
});

describe('MD All Logs export keeps all waves of the current pipelineRunId', () => {
  const filterTelemetryByRunSession = loadScopeFn(
    RESULTS_SRC,
    'const resolveTelemetryRunSessionId = (event) => {',
    'const resolveDiagnosticRunSessionId = (entry) => {',
    'filterTelemetryByRunSession'
  );

  test('scopes to the latest pipelineRunId across waves', () => {
    const result = filterTelemetryByRunSession(events());
    expect(result.pipelineRunId).toBe('P1');
    expect(result.events.map((event) => event.label).sort()).toEqual([...EXPECTED_LABELS].sort());
  });
});

describe('reload and filter wiring', () => {
  test('results.js passes the pipelineRunId of the run to the diagnostics filter', () => {
    expect(RESULTS_SRC).toContain('runScope.maxTs,\n            runScope.pipelineRunId');
    expect(RESULTS_SRC).toContain('const entryPipelineRunId = resolveTelemetryPipelineRunId(entry);');
  });
});
