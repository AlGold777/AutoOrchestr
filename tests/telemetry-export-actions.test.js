const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'result_new.html'), 'utf8');
const pipelineHtml = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');
const resultsSource = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
const devtoolsSource = fs.readFileSync(path.join(__dirname, '..', 'results-devtools.js'), 'utf8');

describe('Telemetry export actions', () => {
  test('both result pages expose the extension-native sanitized B1 capture action', () => {
    expect(html).toContain('id="capture-b1-skeletons-btn"');
    expect(pipelineHtml).toContain('id="capture-b1-skeletons-btn"');
    expect(resultsSource).toContain("type: 'CAPTURE_B1_SANITIZED_SKELETONS'");
    expect(resultsSource).toContain("downloadDiagnosticsJson('B1 Sanitized Answer Skeletons'");
  });

  test('Telemetry exposes exactly the Platform filter', () => {
    [html, pipelineHtml].forEach((page) => {
      const start = page.indexOf('<div class="telemetry-filters">');
      const end = page.indexOf('</div>', start);
      const filters = page.slice(start, end);
      expect((filters.match(/<select /g) || []).length).toBe(1);
      expect(filters).toContain('id="telemetry-platform-select"');
      expect(filters).not.toContain('telemetry-task-select');
      expect(filters).not.toContain('telemetry-export-format-select');
    });
  });

  test('Platform options come from the ledger, not from a catalog or the header selection', () => {
    expect(devtoolsSource).toContain('event?.modelId || event?.platform || event?.llmName');
    expect(devtoolsSource).toContain('TELEMETRY_PSEUDO_MODELS.has(value)');
    // Захардкоженный каталог предлагал модели, по которым событий нет, а
    // подмешивание кнопок LLM из шапки делало «All platforms» неотличимым от
    // выбора в шапке — фильтр не работал ни в одну сторону.
    expect(devtoolsSource).not.toContain('TELEMETRY_PLATFORM_CATALOG');
    expect(devtoolsSource).not.toContain('resolveSelectedLlmNames');
    expect(devtoolsSource).not.toContain('getSelectedLlmSet');
  });

  test('the model dropdown is the only authority for the telemetry filter', () => {
    // Окно и оба экспорта обязаны сводиться к одному предикату, иначе таймлайн
    // и выгрузка расходятся при одном и том же значении фильтра.
    expect(devtoolsSource).toContain('const matchesTelemetryModel = (event, platformFilter');
    expect(devtoolsSource).toContain("if (!platformFilter || platformFilter === 'all') return true;");
    const usages = devtoolsSource.match(/matchesTelemetryModel\(event, platformFilter/g) || [];
    expect(usages.length).toBe(2);
    expect(devtoolsSource).toContain("const isTelemetryFilterActive = () => selectedTelemetryModel() !== 'all'");
  });

  test('JSON download icon precedes the textual MD export without changing action ids', () => {
    const jsonAt = html.indexOf('id="telemetry-export-json-btn"');
    const mdAt = html.indexOf('id="export-all-logs-md-telemetry"');
    expect(jsonAt).toBeGreaterThan(-1);
    expect(mdAt).toBeGreaterThan(jsonAt);
    const jsonButton = html.slice(html.lastIndexOf('<button', jsonAt), html.indexOf('</button>', jsonAt));
    expect(jsonButton).toContain('class="diag-icon-btn"');
    expect(jsonButton).toContain('class="ti ti-download"');
    expect(jsonButton).toContain('aria-label="Export telemetry as JSON"');
    expect(jsonButton).not.toContain('>Json');
  });

  test('JSON export downloads the raw event ring and loads no report builders', () => {
    [html, pipelineHtml].forEach((page) => {
      expect(page).not.toContain('proof-oriented-telemetry.js');
      expect(page).not.toContain('telemetry-export-runtime.js');
      expect(page).not.toContain('telemetry-digest.js');
    });
    expect(devtoolsSource).toContain("type: 'GET_DIAG_EVENTS'");
    expect(devtoolsSource).toContain('applyActiveTelemetryFilter(stored)');
    expect(devtoolsSource).not.toContain('Worker(');
  });

  test('Disput JSON download icon precedes the textual MD export', () => {
    const jsonAt = html.indexOf('id="disput-export-json"');
    const mdAt = html.indexOf('id="disput-export-md"');
    expect(jsonAt).toBeGreaterThan(-1);
    expect(mdAt).toBeGreaterThan(jsonAt);
    const jsonButton = html.slice(html.lastIndexOf('<button', jsonAt), html.indexOf('</button>', jsonAt));
    expect(jsonButton).toContain('class="diag-icon-btn"');
    expect(jsonButton).toContain('class="ti ti-download"');
    expect(jsonButton).toContain('aria-label="Export Disput telemetry as JSON"');
    expect(jsonButton).not.toContain('>Json');
  });

  test('Disput export whitelists diagnostic evidence and deep-redacts JSON', () => {
    expect(resultsSource).toContain('const buildSafeDebateDiagnosticEvidence = (meta = {}) =>');
    expect(resultsSource).toContain('evidence: { ...buildSafeDebateDiagnosticEvidence(meta), registeredRunId:');
    expect(resultsSource).not.toContain('evidence: meta');
    expect(resultsSource).toContain('window.SecretRedaction.redactDeep(payload)');
    // Exports are complete: "Only problems" filters the tab view, never the JSON/MD export.
    expect(resultsSource).not.toContain('applyDisputOnlyProblemsFilter');
    expect(resultsSource).not.toContain('window.DebateTraceProjections.filterProblems(payload');
    expect(resultsSource).toContain('const payload = buildDisputExportPayload(telemetryEvents);');
  });
});
