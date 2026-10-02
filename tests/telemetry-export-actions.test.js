const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'result_new.html'), 'utf8');
const pipelineHtml = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');
const resultsSource = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
const devtoolsSource = fs.readFileSync(path.join(__dirname, '..', 'results-devtools.js'), 'utf8');
const messageRouterSource = fs.readFileSync(path.join(__dirname, '..', 'background', 'message-router.js'), 'utf8');
const proofStoreSource = fs.readFileSync(path.join(__dirname, '..', 'background', 'proof-telemetry-store.js'), 'utf8');
const exportBootstrapSource = fs.readFileSync(path.join(__dirname, '..', 'results-telemetry-export-bootstrap.js'), 'utf8');
const exportWorkerSource = fs.readFileSync(path.join(__dirname, '..', 'workers', 'telemetry-export-worker.js'), 'utf8');
const exportRuntimeSource = fs.readFileSync(path.join(__dirname, '..', 'shared', 'telemetry-export-runtime.js'), 'utf8');

describe('Telemetry export actions', () => {
  test('both result pages expose the extension-native sanitized B1 capture action', () => {
    expect(html).toContain('id="capture-b1-skeletons-btn"');
    expect(pipelineHtml).toContain('id="capture-b1-skeletons-btn"');
    expect(resultsSource).toContain("type: 'CAPTURE_B1_SANITIZED_SKELETONS'");
    expect(resultsSource).toContain("downloadDiagnosticsJson('B1 Sanitized Answer Skeletons'");
  });

  test('Telemetry exposes exactly the Platform and Tasks filters', () => {
    const reportTypes = [
      'cutted',
      'false-success',
      'old-answer',
      'no-delivery',
      'prompt-not-inserted',
      'prompt-not-sent',
      'late-end'
    ];
    [html, pipelineHtml].forEach((page) => {
      const start = page.indexOf('<div class="telemetry-filters">');
      const end = page.indexOf('</div>', start);
      const filters = page.slice(start, end);
      expect((filters.match(/<select /g) || []).length).toBe(2);
      expect(filters).toContain('id="telemetry-platform-select"');
      expect(filters).toContain('id="telemetry-task-select"');
      expect(filters).not.toContain('telemetry-type-select');
      expect(filters).not.toContain('telemetry-preset-select');
      expect(filters).not.toContain('telemetry-only-problems');
      const taskStart = filters.indexOf('id="telemetry-task-select"');
      const taskEnd = filters.indexOf('</select>', taskStart);
      const taskValues = Array.from(filters.slice(taskStart, taskEnd).matchAll(/<option value="([^"]+)"/g), (match) => match[1]);
      expect(taskValues).toEqual(['all', ...reportTypes]);
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
    expect(usages.length).toBe(3);
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

  test('JSON export loads and builds the proof-oriented schema 5 container', () => {
    expect(html).toContain('src="shared/proof-oriented-telemetry.js"');
    expect(pipelineHtml).toContain('src="shared/proof-oriented-telemetry.js"');
    expect(html).not.toContain('src="shared/telemetry-export.js"');
    expect(pipelineHtml).not.toContain('src="shared/telemetry-export.js"');
    expect(devtoolsSource).toContain('window.ProofOrientedTelemetry.buildAllPresets');
    expect(devtoolsSource).toContain('window.ProofOrientedTelemetry.buildStandaloneReport');
    expect(devtoolsSource).toContain('window.ProofOrientedTelemetry?.REPORT_EVENT_TYPES');
    expect(devtoolsSource).toContain("type: 'GET_PROOF_TELEMETRY_SNAPSHOT'");
    expect(devtoolsSource).toContain('canonicalLedger: true');
    expect(devtoolsSource).not.toContain('nativeLedgerAvailable ? proofSnapshot.events : grouped');
    // Канонический экспорт сужается по модели тем же предикатом, что и окно, но
    // сохраняет run-level события (SYSTEM): без них отчёт остаётся без конфигурации запуска.
    expect(devtoolsSource).toContain('matchesTelemetryModel(event, platformFilter, { keepSystem: true })');
    expect(devtoolsSource).not.toContain("Select a platform for a standalone task report");
    expect(devtoolsSource).toContain('selectIncidentReports?.(canonicalEvents');
    expect(devtoolsSource).toContain('platform: selectedModelId');
    expect(devtoolsSource).toContain('describeSelectedIncident(selection)');
    expect(devtoolsSource).toContain('targets.length');
    expect(devtoolsSource).toContain('incident-${target.rank + 1}');
    expect(devtoolsSource).toContain("proofTelemetryShadowCompare");
  });

  test('full all-presets construction and serialization run outside the results UI', () => {
    expect(devtoolsSource).toContain("new Worker(chrome.runtime.getURL('workers/telemetry-export-worker.js'))");
    expect(devtoolsSource).toContain('buildTelemetryJsonInWorker(canonicalEvents, buildOptions, exportFormat');
    expect(exportWorkerSource).toContain("'BUILD_CANONICAL_EVIDENCE_JSON'");
    expect(exportWorkerSource).toContain('self.ProofOrientedTelemetry.buildAllPresets');
    expect(exportWorkerSource).toContain('self.ProofOrientedTelemetry.buildCanonicalEvidence');
    expect(exportWorkerSource).toContain('self.SecretRedaction.redactDeep(Array.isArray(request.events) ? request.events : [])');
    expect(exportWorkerSource).toContain('JSON.stringify(payload)');
    const allPresetsBranch = devtoolsSource.slice(
      devtoolsSource.indexOf("if (task === 'all') {"),
      devtoolsSource.indexOf('const selectedModelId')
    );
    expect(allPresetsBranch).not.toContain('window.ProofOrientedTelemetry.buildAllPresets(');
  });

  test('worker timeout still downloads every canonical event as recovery JSON', () => {
    expect(devtoolsSource).toContain('const FULL_EXPORT_WORKER_TIMEOUT_MS = 20000;');
    expect(devtoolsSource).toContain("containerType: 'canonical-ledger-recovery'");
    expect(devtoolsSource).toContain('allCanonicalEventsPreserved: true');
    expect(devtoolsSource).toContain("filename.replace(/all-presets|canonical-evidence/, 'canonical-recovery')");
    expect(devtoolsSource).toContain('Telemetry build ${reason} — canonical recovery JSON exported');
  });

  test('large export orchestration is cancellable, single-flight and always cleans up resources', () => {
    expect(exportRuntimeSource).toContain("activeJob?.cancel('superseded by a newer telemetry export')");
    expect(exportRuntimeSource).toContain("'TELEMETRY_EXPORT_CANCELLED'");
    expect(exportRuntimeSource).toContain("'TELEMETRY_EXPORT_STAGE_TIMEOUT'");
    expect(exportRuntimeSource).toContain('worker.terminate()');
    expect(exportRuntimeSource).toContain('urlApi.revokeObjectURL(url)');
    expect(exportRuntimeSource).toContain("String(stageName).startsWith('report:')");
    expect(devtoolsSource).toContain("if (outcome.status === 'cancelled') return;");
  });

  test('export progress remains outside the observed telemetry ledger', () => {
    expect(exportWorkerSource).toContain("onProgress: (name) => stage(requestId, name, startedAt)");
    expect(exportWorkerSource).not.toMatch(/recordProof|appendEvent|chrome\.runtime\.sendMessage|chrome\.storage/);
    const workerBuild = devtoolsSource.slice(
      devtoolsSource.indexOf('const buildTelemetryJsonInWorker'),
      devtoolsSource.indexOf('const buildCanonicalTelemetryRecovery')
    );
    expect(workerBuild).not.toMatch(/recordProof|appendEvent|recordTelemetry|persist/);
    expect(exportRuntimeSource).not.toMatch(/recordProof|appendEvent|recordTelemetry|persist/);
    expect(devtoolsSource).toContain('window.__PROOF_TELEMETRY_LAST_EXPORT_METRICS__ = Object.freeze({');
    expect(devtoolsSource).toContain('snapshotRequestMs:');
    expect(devtoolsSource).toContain('persistenceBoundaryMs:');
    expect(devtoolsSource).toContain('stageTimingsMs:');
    expect(devtoolsSource).toContain('blobDownloadMs:');
  });

  test('both pages expose Digest, Canonical evidence and Full forensic without changing the default', () => {
    for (const page of [html, pipelineHtml]) {
      expect(page).toContain('id="telemetry-export-format-select"');
      expect(page).toContain('<option value="digest" selected>Digest</option>');
      expect(page).toContain('<option value="canonical-evidence">Canonical evidence</option>');
      expect(page).toContain('<option value="full-forensic">Full forensic</option>');
      expect(page).toContain('src="shared/telemetry-export-runtime.js"');
    }
    expect(devtoolsSource).toContain("const telemetryExportFormat = () => exportFormatSelect?.value || 'digest'");
    // Имя файла несёт модель — поведение закрыто tests/telemetry-export-filename.test.js.
    expect(devtoolsSource).toContain("telemetry-canonical-evidence-${modelSlug}-${Date.now()}.json");
  });

  test('JSON snapshot has a short queue wait and exports a marked committed fallback', () => {
    expect(messageRouterSource).toContain('Promise.race([barrierSnapshot, barrierDeadline])');
    expect(messageRouterSource).toContain('setTimeout(() => resolve(timeoutToken), 750)');
    expect(messageRouterSource).toContain('ledger.snapshotCommitted?.({');
    expect(messageRouterSource).toContain('success: true,\n                ...committed,');
    expect(messageRouterSource).not.toContain("error: 'proof_telemetry_snapshot_incomplete'");
    expect(devtoolsSource).not.toContain("proofSnapshot?.error === 'proof_telemetry_snapshot_incomplete'");
    expect(devtoolsSource).toContain('Exporting committed snapshot');
    expect(devtoolsSource).toContain('snapshotConsistency: proofSnapshot.snapshotConsistency');
    expect(devtoolsSource).toContain('snapshotBarrierTimedOut: proofSnapshot.barrierTimedOut === true');
    expect(proofStoreSource).toContain("durability: 'relaxed'");
    expect(proofStoreSource).not.toContain("durability: 'strict'");
  });

  test('JSON snapshot bypasses unrelated background initialization', () => {
    const listenerAt = messageRouterSource.indexOf('chrome.runtime.onMessage.addListener');
    const earlySnapshotAt = messageRouterSource.indexOf("if (message?.type === 'GET_PROOF_TELEMETRY_SNAPSHOT')", listenerAt);
    const initializationGateAt = messageRouterSource.indexOf('if (!isInitialStateReady())', listenerAt);
    expect(listenerAt).toBeGreaterThan(-1);
    expect(earlySnapshotAt).toBeGreaterThan(listenerAt);
    expect(initializationGateAt).toBeGreaterThan(earlySnapshotAt);
    expect(messageRouterSource).toContain('void respondProofTelemetrySnapshot(message, sendResponse)');
  });

  test('both result pages install the JSON export bootstrap before the heavy results script', () => {
    [html, pipelineHtml].forEach((page) => {
      const bootstrapAt = page.indexOf('src="results-telemetry-export-bootstrap.js"');
      const resultsAt = page.indexOf('src="results.js"');
      expect(bootstrapAt).toBeGreaterThan(-1);
      expect(resultsAt).toBeGreaterThan(bootstrapAt);
    });
    expect(exportBootstrapSource).toContain("event.stopImmediatePropagation()");
    expect(exportBootstrapSource).toContain("new CustomEvent('telemetry-export-json-request')");
    expect(devtoolsSource).toContain("addEventListener('telemetry-export-json-request'");
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
    expect(resultsSource).toContain('evidence: buildSafeDebateDiagnosticEvidence(meta)');
    expect(resultsSource).not.toContain('evidence: meta');
    expect(resultsSource).toContain('window.SecretRedaction.redactDeep(payload)');
    // Exports are complete: "Only problems" filters the tab view, never the JSON/MD export.
    expect(resultsSource).not.toContain('applyDisputOnlyProblemsFilter');
    expect(resultsSource).not.toContain('window.DebateTraceProjections.filterProblems(payload');
    expect(resultsSource).toContain('const payload = buildDisputExportPayload(telemetryEvents);');
  });
});
