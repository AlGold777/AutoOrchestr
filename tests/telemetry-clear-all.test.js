// Locks the telemetry "clear all" control: a trash button sits to the right of the
// JSON export in the telemetry toolbar and wipes the backend diag/telemetry store
// plus every telemetry window (Rounds, Timeline, Summary) and the diagnostics Logs
// view, so the next export starts clean. (The real clear button had been removed by
// mistake, leaving only a filter-reset.)
const fs = require('fs');
const path = require('path');

const HTML_SRC = fs.readFileSync(path.join(__dirname, '..', 'result_new.html'), 'utf8');
const DEVTOOLS_SRC = fs.readFileSync(path.join(__dirname, '..', 'results-devtools.js'), 'utf8');
const RESULTS_SRC = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

describe('telemetry clear-all control', () => {
  test('trash button exists right after the JSON export, in the telemetry actions', () => {
    // The main Telemetry tab: the TheCycle tab before it has its own telemetry-actions toolbar.
    const panelIdx = HTML_SRC.indexOf('id="telemetry-tabpanel"');
    expect(panelIdx).toBeGreaterThan(-1);
    const actionsIdx = HTML_SRC.indexOf('class="telemetry-actions"', panelIdx);
    expect(actionsIdx).toBeGreaterThan(-1);
    // Slice to the end of the actions container rather than a fixed width, so
    // adding a control to the toolbar cannot push a later button out of view.
    const block = HTML_SRC.slice(actionsIdx, HTML_SRC.indexOf('</div>', actionsIdx));
    // order: Json export button then the clear-all trash button
    const jsonIdx = block.indexOf('id="telemetry-export-json-btn"');
    const clearIdx = block.indexOf('id="telemetry-clear-all-btn"');
    expect(jsonIdx).toBeGreaterThan(-1);
    expect(clearIdx).toBeGreaterThan(jsonIdx);
    expect(block).toContain('ti ti-trash');
  });

  test('clear-all wipes telemetry caches and re-renders empty windows', () => {
    const fnIdx = DEVTOOLS_SRC.indexOf('const clearAllTelemetry =');
    expect(fnIdx).toBeGreaterThan(-1);
    const fn = DEVTOOLS_SRC.slice(fnIdx, fnIdx + 1400);
    expect(fn).toContain("type: 'CLEAR_DIAG_EVENTS'");
    expect(fn).toContain('telemetryCache = []');
    expect(fn).toContain('telemetryScopedCache = []');
    expect(fn).toContain('telemetryFilteredCache = []');
    expect(fn).toContain('telemetryEventKeys = new Set()');
    expect(fn).toContain('renderTelemetry([])');
    // tells results.js to drop its diagnostics Logs view too
    expect(fn).toContain("new CustomEvent('diagnostics-clear-request'");
  });

  test('button is wired both directly and via the delegated action handler', () => {
    expect(DEVTOOLS_SRC).toContain("telemetryClearAllBtn && telemetryClearAllBtn.addEventListener('click', clearAllTelemetry)");
    expect(DEVTOOLS_SRC).toContain('#telemetry-clear-all-btn');
    expect(DEVTOOLS_SRC).toMatch(/target\.id === 'telemetry-clear-all-btn'[\s\S]*?clearAllTelemetry\(\)/);
  });

  test('results.js clears the diagnostics Logs view on the clear-all event', () => {
    expect(RESULTS_SRC).toMatch(/addEventListener\('diagnostics-clear-request'[\s\S]*?clearDiagnosticsView\(\)/);
  });
});
