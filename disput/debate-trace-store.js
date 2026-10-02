// In-memory telemetry for the current Debate run only. No persisted run history.
(function initDebateTraceStore(root) {
  'use strict';

  const Schema = root.DebateTraceSchema || (typeof require === 'function' ? require('./debate-trace-schema') : null);
  const STORAGE_KEY = 'llmCodexDebateTrace.v1';
  const MAX_EVENTS_PER_RUN = 3000;

  const storageCall = (storage, method, value) => new Promise((resolve) => {
    if (!storage || typeof storage[method] !== 'function') return resolve(method === 'get' ? {} : false);
    try {
      const callback = (result) => resolve(method === 'get' ? (result || {}) : true);
      const returned = storage[method](value, callback);
      if (returned && typeof returned.then === 'function') returned.then((result) => callback(result)).catch(() => resolve(method === 'get' ? {} : false));
    } catch (_) { resolve(method === 'get' ? {} : false); }
  });

  function createStore(options = {}) {
    const storage = options.storage || null;
    const storageKey = String(options.storageKey || STORAGE_KEY);
    const maxEvents = Math.max(50, Number(options.maxEventsPerRun || MAX_EVENTS_PER_RUN));
    const listeners = new Set();
    const runs = new Map();
    const duplicateIds = new Map();
    const conflicts = new Map();
    let activeRunId = '';
    let receivedSeq = 0;

    const notify = (event, run) => listeners.forEach((listener) => {
      try { listener(event, run); } catch (_) {}
    });
    const compact = () => {
      runs.forEach((run) => {
        if (run.events.length <= maxEvents) return;
        const critical = run.events.filter((event) => Schema.CRITICAL_FLUSH.has(event.eventType));
        const criticalIds = new Set(critical.map((event) => event.eventId));
        const regular = run.events.filter((event) => !criticalIds.has(event.eventId));
        run.events = regular.slice(-Math.max(0, maxEvents - critical.length)).concat(critical.slice(-maxEvents))
          .sort((a, b) => a.receivedSeq - b.receivedSeq);
      });
    };
    const serialize = () => ({
      schemaVersion: Schema.VERSION,
      receivedSeq,
      activeRunId,
      runs: Array.from(runs.values()).map((run) => ({ ...run, events: run.events.slice() }))
    });
    const purgeStoredRuns = async () => {
      // Remove snapshots written by previous versions; never read or restore them.
      return storageCall(storage, 'remove', [...new Set([storageKey, STORAGE_KEY, 'llmCodexDebateTrace'])]);
    };
    const ensureRun = (runId, seed = {}) => {
      const id = String(runId || activeRunId || '').trim();
      if (!id) return null;
      if (!runs.has(id)) {
        runs.clear();
        duplicateIds.clear();
        conflicts.clear();
        receivedSeq = 0;
        runs.set(id, {
          debateRunId: id,
          createdAt: Number(seed.createdAt || 0) || Date.now(),
          updatedAt: Number(seed.updatedAt || 0) || Date.now(),
          plan: Schema.sanitizePlan?.(seed.plan) || null,
          topology: String(seed.topology || ''),
          presetId: String(seed.presetId || ''),
          sessionId: String(seed.sessionId || ''),
          events: []
        });
      }
      return runs.get(id);
    };
    const append = (input = {}) => {
      const correlation = Schema.normalizeCorrelation(input.correlation || {});
      const runId = correlation.debateRunId || activeRunId;
      // A late event from an earlier run cannot recreate its history or replace the current trace.
      if (activeRunId && runId !== activeRunId) return null;
      const run = ensureRun(runId, input.run || {});
      if (!run) return null;
      const event = Schema.createEvent({ ...input, correlation: { debateRunId: runId, ...correlation } }, {
        receivedSeq: receivedSeq + 1,
        receivedAt: Date.now()
      });
      const existing = run.events.find((item) => item.eventId === event.eventId);
      if (existing) {
        if (existing.semanticHash === event.semanticHash) {
          duplicateIds.set(runId, (duplicateIds.get(runId) || []).concat(event.eventId));
        } else {
          conflicts.set(runId, (conflicts.get(runId) || []).concat({
            eventId: event.eventId,
            existingSemanticHash: existing.semanticHash,
            incomingSemanticHash: event.semanticHash
          }));
        }
        return null;
      }
      receivedSeq += 1;
      run.events.push(event);
      run.updatedAt = event.receivedAt;
      activeRunId = runId;
      compact();
      notify(event, run);
      return event;
    };
    const beginRun = (seed = {}) => {
      const runId = String(seed.debateRunId || seed.runId || '').trim();
      if (!runId) return null;
      activeRunId = runId;
      const run = ensureRun(runId, {
        plan: seed.plan || null,
        topology: seed.topology,
        presetId: seed.presetId,
        sessionId: seed.sessionId
      });
      if (seed.plan) run.plan = Schema.sanitizePlan?.(seed.plan) || null;
      if (!run.events.some((event) => event.eventType === 'RUN_CREATED')) {
        append({
          eventType: 'RUN_CREATED', source: Schema.SOURCES.APPLICATION,
          correlation: { debateRunId: runId, planId: seed.plan?.planId, sessionId: seed.sessionId },
          payload: { topology: seed.topology || '', presetId: seed.presetId || '', runPolicy: seed.plan?.runPolicy || '' }
        });
      }
      if (seed.plan && !run.events.some((event) => event.eventType === 'PLAN_COMPILED')) {
        const safePlan = Schema.sanitizePlan?.(seed.plan) || null;
        append({
          eventType: 'PLAN_COMPILED', source: Schema.SOURCES.APPLICATION,
          correlation: { debateRunId: runId, planId: seed.plan.planId, sessionId: seed.sessionId },
          payload: {
            planId: safePlan?.planId || '',
            presetId: safePlan?.presetId || '',
            topology: safePlan?.topology || '',
            stageCount: safePlan?.stages?.length || 0
          }
        });
      }
      return run;
    };
    const clear = async (runId = null) => {
      if (runId && String(runId) !== activeRunId) return;
      runs.clear();
      duplicateIds.clear();
      conflicts.clear();
      activeRunId = '';
      receivedSeq = 0;
      await purgeStoredRuns();
    };

    return Object.freeze({
      beginRun, append, purgeStoredRuns, clear, serialize,
      getRun: (runId = activeRunId) => runs.get(String(runId || '')) || null,
      getActiveRun: () => runs.get(activeRunId) || null,
      getDuplicateIds: (runId = activeRunId) => (duplicateIds.get(String(runId || '')) || []).slice(),
      getConflicts: (runId = activeRunId) => (conflicts.get(String(runId || '')) || []).slice(),
      subscribe(listener) { if (typeof listener !== 'function') return () => {}; listeners.add(listener); return () => listeners.delete(listener); }
    });
  }

  const api = Object.freeze({ STORAGE_KEY, MAX_EVENTS_PER_RUN, createStore });
  root.DebateTraceStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
