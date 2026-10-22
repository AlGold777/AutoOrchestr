const fs = require('fs');
const path = require('path');

const RESULTS_SRC = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
const TELEMETRY_SRC = fs.readFileSync(path.join(__dirname, '..', 'background', 'telemetry-logs.js'), 'utf8');
const ROUTER_SRC = fs.readFileSync(path.join(__dirname, '..', 'background', 'message-router.js'), 'utf8');
const DEVTOOLS_SRC = fs.readFileSync(path.join(__dirname, '..', 'results-devtools.js'), 'utf8');

describe('telemetry Markdown export regression', () => {
  test('page reload clears persisted telemetry before the new page session', () => {
    expect(RESULTS_SRC).toContain('clearTelemetryOnReload()');
    expect(RESULTS_SRC).toContain("detail: { source: 'page_reload' }");
  });

  test('Run Summary alone is sufficient to create the MD export', () => {
    const handlerAt = RESULTS_SRC.indexOf("event.target.closest('#export-all-logs-md, #export-all-logs-md-telemetry')");
    const handler = RESULTS_SRC.slice(handlerAt, handlerAt + 4200);
    expect(handler).toContain('const hasRunSummary = Boolean(');
    expect(handler).toContain('!hasLogs && !hasTelemetry && !hasRunSummary');
    expect(handler).toContain("downloadDiagnosticsMarkdown('All Logs'");
  });

  test('Markdown object URL is not revoked synchronously', () => {
    const fnAt = RESULTS_SRC.indexOf('const downloadDiagnosticsMarkdown =');
    const fn = RESULTS_SRC.slice(fnAt, fnAt + 1100);
    expect(fn).toContain('setTimeout(() => URL.revokeObjectURL(url), 1000)');
  });

  test('MD click captures logs and telemetry at click time with a bounded wait', () => {
    const handlerAt = RESULTS_SRC.indexOf("event.target.closest('#export-all-logs-md, #export-all-logs-md-telemetry')");
    const handler = RESULTS_SRC.slice(handlerAt, handlerAt + 4200);
    expect(RESULTS_SRC).toContain('const EXPORT_SNAPSHOT_DEADLINE_MS = 300;');
    expect(handler).toContain('const snapshotTs = Date.now();');
    expect(handler).toContain('const logsSnapshot = cloneLogsByModel(llmLogs);');
    expect(handler).toContain('getTelemetryEventsForExport(snapshotTs)');
    expect(handler).toContain('requestRunOutcomeSummary(EXPORT_SNAPSHOT_DEADLINE_MS)');
    expect(handler).toContain('buildAllLogsMarkdown(telemetryEvents, sources, logsSnapshot, runOutcomeSummary)');
  });

  test('GET_DIAG_EVENTS reads committed storage without waiting for the telemetry write chain', () => {
    expect(TELEMETRY_SRC).toContain('const readDiagnosticsEventsSnapshot = () => readDiagnosticsEvents();');
    expect(TELEMETRY_SRC).toContain('self.readDiagnosticsEventsSnapshot = readDiagnosticsEventsSnapshot;');
    const caseAt = ROUTER_SRC.indexOf("case 'GET_DIAG_EVENTS'");
    const handler = ROUTER_SRC.slice(caseAt, caseAt + 1400);
    expect(handler).toContain('self?.readDiagnosticsEventsSnapshot');
    expect(handler).not.toContain('readDiagnosticsEventsConsistent');
  });

  test('removed Only problems filter stays disabled in the Markdown bridge', () => {
    expect(DEVTOOLS_SRC).toContain('window.ProblemContextFilter.filterWithContext(events');
    expect(DEVTOOLS_SRC).toContain('telemetryBridge.isOnlyProblemsEnabled = () => false');
    expect(RESULTS_SRC).toContain('bridge.applyOnlyProblemsFilter(filtered)');
    expect(RESULTS_SRC).toContain('window.ProblemContextFilter.filterWithContext(source');
  });

  test('JSON export is the raw event ring and needs no derived report', () => {
    expect(DEVTOOLS_SRC).toContain("type: 'GET_DIAG_EVENTS'");
    expect(DEVTOOLS_SRC).toContain("format: TELEMETRY_EXPORT_FORMAT");
    expect(DEVTOOLS_SRC).not.toContain('GET_PROOF_TELEMETRY_SNAPSHOT');
  });

  test('content-tab diagnostics inherit run identity only from their mapped current tab', () => {
    const caseAt = ROUTER_SRC.indexOf("case 'DIAG_EVENT'");
    const handler = ROUTER_SRC.slice(caseAt, caseAt + 3500);
    expect(handler).toContain('senderTabId === expectedTabId');
    expect(handler).toContain('runSessionId: currentRunSessionId');
    expect(handler).toContain('dispatchId: currentEntry.lastDispatchMeta.dispatchId');
  });
});
