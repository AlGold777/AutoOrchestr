// shared/basic-telemetry.js
// Basic owns the execution record; transport observations are joined by explicit IDs only.
(function initBasicTelemetry(root) {
  'use strict';
  const list = (value) => Array.isArray(value) ? value : [];

  function classifyEntry(entry, runId, requestIds) {
    if (!entry || typeof entry !== 'object') {
      return { runSelection: 'invalid', selectionReason: 'invalid_entry', entry };
    }

    const scopes = [entry, entry.meta, entry.correlation].filter(Boolean);
    const runKeys = ['pipelineRunId', 'debateRunId', 'runId'];
    const explicitRuns = Array.from(new Set(scopes.flatMap(s => runKeys.map(k => s[k]).filter(Boolean))));

    // Conflicting run IDs inside the same event
    if (explicitRuns.length > 1) {
      return { runSelection: 'unassigned', selectionReason: 'conflicting_run_ids', entry };
    }

    // Proven other run
    if (explicitRuns.length === 1 && explicitRuns[0] !== runId) {
      return { runSelection: 'otherRun', selectionReason: 'other_run_identity', entry };
    }

    // Proven this run
    if (explicitRuns.length === 1 && explicitRuns[0] === runId) {
      return { runSelection: 'selected', selectionReason: 'explicit_run_id', entry };
    }

    // Scoped by stageId or batchId
    const isRunScoped = scopes.some(s =>
      String(s.stageId || '').startsWith(`custom:${runId}:`)
      || String(s.batchId || s.pipelineBatchId || '').startsWith(`${runId}:`)
    );
    if (isRunScoped) {
      return { runSelection: 'selected', selectionReason: 'run_scoped_stage_or_batch', entry };
    }

    // Associated with known attempt request IDs
    const hasKnownRequestId = scopes.some(s =>
      [s.requestId, s.transportRequestId].some(id => id && requestIds.has(id))
    );
    if (hasKnownRequestId) {
      return { runSelection: 'selected', selectionReason: 'known_attempt_request_id', entry };
    }

    // Unassigned (missing run identity)
    return { runSelection: 'unassigned', selectionReason: 'missing_run_identity', entry };
  }

  function processSource(rawList, runId, requestIds) {
    const selected = [];
    const unassigned = [];
    let otherRun = 0;
    let invalid = 0;

    rawList.forEach((item) => {
      const classified = classifyEntry(item, runId, requestIds);
      if (classified.runSelection === 'selected') {
        selected.push(classified.entry);
      } else if (classified.runSelection === 'unassigned') {
        unassigned.push(classified.entry ? { ...classified.entry, selectionReason: classified.selectionReason } : { selectionReason: classified.selectionReason });
      } else if (classified.runSelection === 'otherRun') {
        otherRun += 1;
      } else {
        invalid += 1;
      }
    });

    const totalScanned = rawList.length;
    const selection = {
      basis: 'explicit_run_or_request_identity',
      sourceRetained: totalScanned,
      totalScanned,
      selected: selected.length,
      unassigned: unassigned.length,
      otherRun,
      invalid,
      excluded: unassigned.length + otherRun + invalid
    };

    return { selected, unassigned, selection };
  }

  function buildReport({ customRun, delivery = null, events = [], executionActive = false, extensionVersion = null, exportedAt = new Date().toISOString() }) {
    if (!customRun?.runId) throw new Error('Basic run record required');
    const runId = customRun.runId;
    const requestIds = new Set(list(customRun.attempts).map(a => a.transportRequestId).filter(Boolean));

    const rawJournal = list(delivery?.journal);
    const rawEvents = list(events);

    // Initial pass to discover request IDs belonging to this run
    rawJournal.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const scopes = [entry, entry.meta, entry.correlation].filter(Boolean);
      const runKeys = ['pipelineRunId', 'debateRunId', 'runId'];
      const explicitRuns = Array.from(new Set(scopes.flatMap(s => runKeys.map(k => s[k]).filter(Boolean))));
      if (explicitRuns.some(id => id !== runId)) return;
      const belongs = (explicitRuns.length === 1 && explicitRuns[0] === runId) || scopes.some(s =>
        String(s.stageId || '').startsWith(`custom:${runId}:`)
        || String(s.batchId || s.pipelineBatchId || '').startsWith(`${runId}:`)
        || [s.requestId, s.transportRequestId].some(id => id && requestIds.has(id))
      );
      if (belongs) {
        Object.values(entry.requestIds || {}).filter(Boolean).forEach(id => requestIds.add(id));
        [entry.requestId, entry.transportRequestId].filter(Boolean).forEach(id => requestIds.add(id));
      }
    });

    const deliveryProcessed = processSource(rawJournal, runId, requestIds);
    const telemetryProcessed = processSource(rawEvents, runId, requestIds);

    return {
      format: 'basic-telemetry/2',
      extensionVersion,
      exportedAt,
      runId,
      executionActive,
      customRun,
      delivery: {
        journal: deliveryProcessed.selected,
        unassigned: deliveryProcessed.unassigned,
        selection: deliveryProcessed.selection,
        collection: delivery?.collection || null
      },
      telemetry: {
        events: telemetryProcessed.selected,
        unassigned: telemetryProcessed.unassigned,
        selection: telemetryProcessed.selection
      }
    };
  }

  root.BasicTelemetry = Object.freeze({ buildReport });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BasicTelemetry;
})(typeof window !== 'undefined' ? window : globalThis);
