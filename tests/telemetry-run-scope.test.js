/** @jest-environment node */
// Diagnostics export covers every wave of one pipeline run, never another run,
// and the diagnostics ring survives browser start/install.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const ROUTER_SRC = read('background/message-router.js');
const ORCH_SRC = read('background/job-orchestrator.js');
const INDEX_SRC = read('background/index.js');
const RUN_STATE = require('../background/pipeline-run-state.js');

function extractGetDiagEventsBody() {
  const start = ROUTER_SRC.indexOf("case 'GET_DIAG_EVENTS': {");
  const end = ROUTER_SRC.indexOf("case 'CLEAR_DIAG_EVENTS'", start);
  const inner = ROUTER_SRC.slice(start + "case 'GET_DIAG_EVENTS': {".length, end);
  return inner.replace(/\s*return true;\s*\}\s*$/, '\n');
}

function runGetDiagEvents({ stored, session, message = {} }) {
  const body = extractGetDiagEventsBody();
  const fn = vm.runInNewContext(
    `(function (message, sendResponse) {\n${body}\n})`,
    {
      self: {},
      jobState: { session },
      readDiagnosticsEventsFromStorage: async () => structuredClone(stored),
      diagTrimDiagnosticsBuffer: (arr) => arr,
      DIAGNOSTICS_EXPORT_MAX_ITEMS: 4000,
      console
    }
  );
  return new Promise((resolve) => {
    fn({ ...message }, (response) => resolve(response));
  });
}

// Extract the runSessionIds-scoped snippet of startProcessReservedRun so the
// exact production expression is evaluated, not a copy of it.
function evaluatePreviousRunSessionIds(jobState, pipelineContext) {
  const start = ORCH_SRC.indexOf('  const previousSession = jobState?.session || null;');
  const end = ORCH_SRC.indexOf('    : [];\n', start) + '    : [];\n'.length;
  const snippet = ORCH_SRC.slice(start, end);
  const sandbox = { jobState, pipelineContext };
  vm.createContext(sandbox);
  vm.runInContext(`${snippet}\nresult = previousRunSessionIds;`, sandbox);
  return sandbox.result;
}

describe('pipeline run session ids', () => {
  test('create records the run session ids including the new wave start time', () => {
    const state = RUN_STATE.create({ startedAt: 300, previousRunSessionIds: [100, 200] });
    expect(state.session.runSessionIds).toEqual([100, 200, 300]);
    expect(state.session.startTime).toBe(300);
  });

  test('create without previous ids starts the list fresh', () => {
    const state = RUN_STATE.create({ startedAt: 300 });
    expect(state.session.runSessionIds).toEqual([300]);
  });

  test('startProcess carries earlier waves of the same pipelineRunId', () => {
    const prev = { pipelineRunId: 'run-A', startTime: 200, runSessionIds: [100, 200] };
    expect(evaluatePreviousRunSessionIds({ session: prev }, { pipelineRunId: 'run-A' })).toEqual([100, 200]);
  });

  test('startProcess falls back to the previous startTime when no list exists', () => {
    const prev = { pipelineRunId: 'run-A', startTime: 200 };
    expect(evaluatePreviousRunSessionIds({ session: prev }, { pipelineRunId: 'run-A' })).toEqual([200]);
  });

  test('a different pipelineRunId starts a new list', () => {
    const prev = { pipelineRunId: 'run-A', startTime: 200, runSessionIds: [100, 200] };
    expect(evaluatePreviousRunSessionIds({ session: prev }, { pipelineRunId: 'run-B' })).toEqual([]);
    expect(evaluatePreviousRunSessionIds({ session: prev }, null)).toEqual([]);
  });

  test('the list is persisted with jobState (no separate store)', () => {
    expect(ORCH_SRC).toMatch(/saveJobState\(jobState\)/);
    expect(ORCH_SRC).toContain('previousRunSessionIds,');
  });
});

describe('GET_DIAG_EVENTS run scope', () => {
  const stored = [
    { meta: { runSessionId: 100 }, label: 'wave1' },
    { meta: { runSessionId: 200 }, label: 'wave2' },
    { meta: { runSessionId: 300 }, label: 'wave3' },
    { meta: { runSessionId: 999 }, label: 'other-run' },
    { label: 'setup-line' }
  ];

  test('exports events of all waves of the current pipeline run', async () => {
    const res = await runGetDiagEvents({
      stored,
      session: { startTime: 300, runSessionIds: [100, 200, 300] }
    });
    expect(res.success).toBe(true);
    expect(res.events.map((e) => e.label)).toEqual(['wave1', 'wave2', 'wave3', 'setup-line']);
  });

  test('does not export another run and keeps events without run identity', async () => {
    const res = await runGetDiagEvents({
      stored,
      session: { startTime: 300, runSessionIds: [100, 200, 300] }
    });
    expect(res.events.some((e) => e.label === 'other-run')).toBe(false);
    expect(res.events.some((e) => e.label === 'setup-line')).toBe(true);
  });

  test('sessions without the list fall back to the current startTime', async () => {
    const res = await runGetDiagEvents({ stored, session: { startTime: 300 } });
    expect(res.events.map((e) => e.label)).toEqual(['wave3', 'setup-line']);
  });

  test('allRunSessions still returns the whole buffer', async () => {
    const res = await runGetDiagEvents({
      stored,
      session: { startTime: 300, runSessionIds: [100, 200, 300] },
      message: { allRunSessions: true }
    });
    expect(res.events).toHaveLength(stored.length);
  });
});

describe('diagnostics ring survives browser start and install', () => {
  test('startup and install listeners no longer clear the ring', () => {
    expect(ROUTER_SRC).not.toContain('clearDiagnosticsStorageOnStartup');
    expect(ROUTER_SRC).not.toMatch(/runtime\.onStartup\.addListener\(\s*clearDiagnostics/);
    expect(ROUTER_SRC).not.toMatch(/runtime\.onInstalled\.addListener\(\s*clearDiagnostics/);
  });

  test('the ring key is not a volatile local key', () => {
    const block = INDEX_SRC.slice(INDEX_SRC.indexOf('const EXTENSION_VOLATILE_LOCAL_KEYS = ['));
    const arr = block.slice(0, block.indexOf('];'));
    expect(arr).not.toContain("'__diagnostics_events__'");
    expect(arr).toContain("'jobState'");
  });

  test('explicit clear and run-start clear are kept', () => {
    expect(ROUTER_SRC).toContain("case 'CLEAR_DIAG_EVENTS'");
    expect(ROUTER_SRC).toContain('clearDiagnosticsRuntimeLogs();');
    expect(ROUTER_SRC).toContain('if (!continuesPipelineRun) {');
  });
});
