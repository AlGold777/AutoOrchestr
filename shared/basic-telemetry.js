// Basic owns the execution record; transport observations are joined by explicit IDs only.
(function initBasicTelemetry(root) {
  'use strict';
  const list = (value) => Array.isArray(value) ? value : [];
  function buildReport({ customRun, delivery = null, events = [], executionActive = false, extensionVersion = null, exportedAt = new Date().toISOString() }) {
    if (!customRun?.runId) throw new Error('Basic run record required');
    const runId = customRun.runId;
    const requestIds = new Set(list(customRun.attempts).map(a => a.transportRequestId).filter(Boolean));
    const scopes = entry => [entry, entry?.meta, entry?.correlation].filter(Boolean);
    const runKeys = ['pipelineRunId', 'debateRunId', 'runId'];
    const explicitRuns = entry => scopes(entry).flatMap(s => runKeys.map(k => s[k]).filter(Boolean));
    const belongs = entry => {
      const runs = explicitRuns(entry);
      if (runs.some(id => id !== runId)) return false;
      return runs.includes(runId) || scopes(entry).some(s =>
        String(s.stageId || '').startsWith(`custom:${runId}:`)
        || String(s.batchId || s.pipelineBatchId || '').startsWith(`${runId}:`)
        || [s.requestId, s.transportRequestId].some(id => id && requestIds.has(id)));
    };
    const journal = list(delivery?.journal);
    journal.filter(belongs).forEach(entry => {
      Object.values(entry.requestIds || {}).filter(Boolean).forEach(id => requestIds.add(id));
      [entry.requestId, entry.transportRequestId].filter(Boolean).forEach(id => requestIds.add(id));
    });
    const selectedJournal = journal.filter(belongs);
    const selectedEvents = list(events).filter(belongs);
    return {
      format: 'basic-telemetry/1', extensionVersion, exportedAt, runId, executionActive, customRun,
      delivery: { journal: selectedJournal, collection: delivery?.collection || null },
      telemetry: { events: selectedEvents, selection: {
        basis: 'explicit_run_or_request_identity', sourceRetained: list(events).length,
        selected: selectedEvents.length, excluded: list(events).length - selectedEvents.length
      } }
    };
  }
  root.BasicTelemetry = Object.freeze({ buildReport });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BasicTelemetry;
})(typeof window !== 'undefined' ? window : globalThis);
