const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Digest = require('../shared/report-digest');
const source = fs.readFileSync(path.join(__dirname, '../results.js'), 'utf8');
const start = source.indexOf("    document.addEventListener('click', async (event) => {\n        const button = event.target.closest('#disput-extract');");
const end = source.indexOf("    document.addEventListener('click', (event) => {\n        const btn = event.target.closest('#export-diagnostics-html');", start);
const report = () => ({
  metadata: { debateRunId: 'run-1' },
  stageExecutions: [], events: [], diagnoses: [],
  runOutcome: {}, health: {}, integrity: {}
});

function setup(payload = report(), digest = Digest) {
  document.body.innerHTML = '<button id="disput-extract">Extract</button><select id="disput-extract-type"><option value="transport">transport</option></select>';
  const downloads = [];
  const notices = [];
  let handler;
  const context = {
    document: { addEventListener: (_, fn) => { handler = fn; }, getElementById: (id) => document.getElementById(id) },
    window: { ReportDigest: digest, MessageDeliveryView: { buildReport: async () => ({ journal: [{ kind: 'prepared', requestId: 'r1' }] }) } },
    getTelemetryEventsForExport: async () => [], buildDisputExportPayload: () => payload,
    formatDiagnosticsExportStamp: () => '20261003_00-30',
    downloadDiagnosticsJson: (base, data, button, options) => { downloads.push({ data, name: options.fileName }); return true; },
    downloadDiagnosticsMarkdown: (base, data, button, options) => { downloads.push({ data, name: options.fileName }); return true; },
    flashButtonFeedback: jest.fn(), showNotification: (message) => notices.push(message), console: { error: jest.fn() }
  };
  vm.runInNewContext(source.slice(start, end), context);
  const button = document.getElementById('disput-extract');
  return { run: () => handler({ target: button }), button, downloads, notices, context };
}

test('Extract downloads the complete snapshot and its deterministic digest with matching filenames', async () => {
  const payload = report();
  payload.events = [{ eventType: 'RUN_STARTED', sourceTimestamp: 1000, correlation: {}, payload: {} }];
  const before = JSON.stringify(payload);
  const ui = setup(payload);
  await ui.run();
  expect(ui.downloads.map((d) => d.name)).toEqual(['Disput Flow 20261003_00-30.json', 'extract_transport_20261003_00-30.md']);
  expect(ui.downloads[0].data.events).toHaveLength(1);
  expect(ui.downloads[1].data).toBe(Digest.renderTransportMarkdown(Digest.extractTransport(ui.downloads[0].data, ui.downloads[0].name)));
  expect(JSON.stringify(payload)).toBe(before);
  expect(ui.button.disabled).toBe(false);
});

test('browser module needs no Node APIs and has the same output as the report script', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../shared/report-digest.js'), 'utf8'), context);
  expect(JSON.stringify(context.window.ReportDigest.extractTransport(report(), 'source.json'))).toBe(JSON.stringify(Digest.extractTransport(report(), 'source.json')));
});

test('failure leaves the raw report downloaded and releases the button', async () => {
  const ui = setup(report(), { extractTransport: () => { throw new Error('bad report'); } });
  await ui.run();
  expect(ui.downloads).toHaveLength(1);
  expect(ui.notices[0]).toContain('bad report');
  expect(ui.button.disabled).toBe(false);
  expect(ui.button.hasAttribute('aria-busy')).toBe(false);
});

test('duplicate clicks during snapshot loading do not create extra downloads', async () => {
  const ui = setup();
  let release;
  ui.context.getTelemetryEventsForExport = () => new Promise((resolve) => { release = resolve; });
  const running = ui.run();
  await ui.run();
  release([]);
  await running;
  expect(ui.downloads).toHaveLength(2);
});

test('both pages default to all records and load the digest before the UI handler', () => {
  for (const file of ['pipeline_panel.html', 'result_new.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    expect(html).toMatch(/id="disput-only-problems">/);
    expect(html).toContain('id="disput-extract-type"');
    expect(html.indexOf('src="shared/report-digest.js"')).toBeLessThan(html.indexOf('src="results.js"'));
  }
});

test('a failed raw download prevents extraction and reports the error', async () => {
  const extractTransport = jest.fn();
  const ui = setup(report(), { extractTransport });
  ui.context.downloadDiagnosticsJson = () => false;
  await ui.run();
  expect(extractTransport).not.toHaveBeenCalled();
  expect(ui.notices[0]).toContain('Could not download Disput Flow');
  expect(ui.button.disabled).toBe(false);
});

test('Markdown failure keeps only the raw JSON download and releases the Extract button', async () => {
  const ui = setup();
  ui.context.downloadDiagnosticsMarkdown = () => false;
  await ui.run();
  expect(ui.downloads).toHaveLength(1);
  expect(ui.notices[0]).toContain('Could not download transport extract Markdown');
  expect(ui.button.disabled).toBe(false);
  expect(ui.button.hasAttribute('aria-busy')).toBe(false);
});

test('real report builder resolves application from the page bridge, without a lexical debateApplication', () => {
  const builderStart = source.indexOf('    function buildDisputExportPayload(');
  const builderEnd = source.indexOf('    function buildDisputTelemetryMarkdown(', builderStart);
  const buildReport = jest.fn((trace, options) => ({ trace, options }));
  const revision = { revisionId: 'rev1' };
  const context = {
    window: { __debateApplication: {
      getActiveRevision: () => revision,
      getOrchestrator: () => ({ getState: () => ({ stages: [{ stageInstanceId: 'stage1', plannedStageId: 'plan1', planRevisionId: 'rev1' }] }) })
    }, DebateTraceSchema: { sanitize: value => value }, DebateTraceProjections: { buildReport } },
    debateTraceStore: { getActiveRun: () => ({ debateRunId: 'r1' }), getDuplicateIds: () => [] },
    chrome: { runtime: { getManifest: () => ({ version: 'test' }) } }
  };
  vm.runInNewContext(source.slice(builderStart, builderEnd), context);
  const result = context.buildDisputExportPayload([]);
  expect(result.options.planning.revision).toBe(revision);
  expect(result.options.planning.instances[0]).toMatchObject({ stageId: 'stage1', plannedStageId: 'plan1' });
  delete context.window.__debateApplication;
  expect(() => context.buildDisputExportPayload([])).not.toThrow();
});

test('size-budget aggregation downloads JSON and Markdown and releases the actual Extract handler', async () => {
  const payload=report();payload.events=[{eventType:'MANUAL_RECOVERY_REQUESTED',sourceTimestamp:1000,correlation:{},payload:{details:'Ж'.repeat(130000)}}];
  const ui=setup(payload);
  await ui.run();
  expect(ui.downloads).toHaveLength(2);
  expect(ui.downloads[0].name).toBe('Disput Flow 20261003_00-30.json');
  expect(ui.downloads[1].name).toBe('extract_transport_20261003_00-30.md');
  expect(ui.downloads[0].data.events[0].payload.details).toHaveLength(130000);
  expect(ui.downloads[1].data).toContain('mode=aggregated');
  expect(Buffer.byteLength(ui.downloads[1].data)).toBeLessThanOrEqual(Digest.COMPRESSION.markdownMaxBytes);
  expect(ui.notices).toHaveLength(0);
  expect(ui.button.disabled).toBe(false);
  expect(ui.button.hasAttribute('aria-busy')).toBe(false);
});
