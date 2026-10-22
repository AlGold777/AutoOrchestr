const fs = require('fs');
const path = require('path');

const TELEMETRY_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'telemetry-logs.js'),
  'utf8'
);
const ROUTER_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'message-router.js'),
  'utf8'
);
const RESULTS_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'results.js'),
  'utf8'
);

describe('telemetry retention and serialization', () => {
  test('all telemetry writers share one serialized mutation chain', () => {
    expect(TELEMETRY_SRC).toContain('let diagnosticsMutationChain = Promise.resolve()');
    expect(TELEMETRY_SRC).toContain('function mutateDiagnosticsEventsConsistent');
    expect(TELEMETRY_SRC).toContain('await mutateDiagnosticsEventsConsistent((arr) =>');
    expect(ROUTER_SRC).toContain('self.mutateDiagnosticsEventsConsistent(appendEvent)');
  });

  test('a full multi-model run fits in storage and export budgets', () => {
    expect(TELEMETRY_SRC).toContain('const DIAGNOSTICS_EVENTS_MAX_ITEMS = 4000');
    expect(TELEMETRY_SRC).toContain('const DIAGNOSTICS_EVENTS_MAX_BYTES = 3000000');
    expect(ROUTER_SRC).toContain('const DIAGNOSTICS_EXPORT_MAX_ITEMS = 4000');
    expect(RESULTS_SRC).toContain("type: 'GET_DIAG_EVENTS', limit: 2000");
  });

  test('per-model logs retain critical events and suppress post-terminal layer noise', () => {
    expect(TELEMETRY_SRC).toContain('const MAX_LOG_ENTRIES = 120');
    expect(TELEMETRY_SRC).toContain('buffer.findIndex((item) => !isPinnedTelemetryEvent(item))');
    expect(TELEMETRY_SRC).toContain("label.startsWith('ANSWER: LAYER ')");
  });
});
