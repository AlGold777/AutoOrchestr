// Append-only, bounded trace storage. It observes Debate; it never controls it.
(function initDebateTraceStore(root) {
  'use strict';

  const Schema = root.DebateTraceSchema || (typeof require === 'function' ? require('./debate-trace-schema') : null);
  const STORAGE_KEY = 'llmCodexDebateTrace.v1';
  const MAX_RUNS = 10;
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
    const maxRuns = Math.max(1, Number(options.maxRuns || MAX_RUNS));
    const maxEvents = Math.max(50, Number(options.maxEventsPerRun || MAX_EVENTS_PER_RUN));
    const listeners = new Set();
    const runs = new Map();
    const duplicateIds = new Map();
    const conflicts = new Map();
    let activeRunId = '';
    let receivedSeq = 0;
    let flushTimer = null;
    let dirty = false;

    const notify = (event, run) => listeners.forEach((listener) => {
      try { listener(event, run); } catch (_) {}
    });
    const compact = () => {
      while (runs.size > maxRuns) runs.delete(runs.keys().next().value);
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
    const flush = async () => {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (!dirty || !storage) return false;
      compact();
      dirty = false;
      return storageCall(storage, 'set', { [storageKey]: serialize() });
    };
    const scheduleFlush = (immediate = false) => {
      dirty = true;
      if (!storage) return;
      if (immediate) { void flush(); return; }
      if (flushTimer) return;
      flushTimer = setTimeout(() => { void flush(); }, Math.max(50, Number(options.flushDelayMs || 500)));
    };
    const ensureRun = (runId, seed = {}) => {
      const id = String(runId || activeRunId || '').trim();
      if (!id) return null;
      if (!runs.has(id)) {
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
      scheduleFlush(Schema.CRITICAL_FLUSH.has(event.eventType));
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
    const restore = async () => {
      const result = await storageCall(storage, 'get', storageKey);
      const snapshot = result?.[storageKey];
      if (!snapshot || !Array.isArray(snapshot.runs)) return false;
      receivedSeq = Math.max(0, Number(snapshot.receivedSeq || 0));
      activeRunId = String(snapshot.activeRunId || '');
      snapshot.runs.slice(-maxRuns).forEach((run) => {
        if (!run?.debateRunId) return;
        const events = (Array.isArray(run.events) ? run.events.slice(-maxEvents) : []).map((event) => (
          Schema.createEvent(event, { receivedSeq: event.receivedSeq, receivedAt: event.receivedAt })
        ));
        runs.set(String(run.debateRunId), {
          ...run,
          plan: Schema.sanitizePlan?.(run.plan) || null,
          events
        });
      });
      // Persist the sanitized migration immediately. Otherwise an old trace is
      // safe in memory/export but its raw content remains in chrome.storage
      // until some unrelated future event triggers a flush.
      dirty = true;
      await flush();
      return true;
    };
    const clear = async (runId = null) => {
      if (runId) runs.delete(String(runId));
      else { runs.clear(); activeRunId = ''; receivedSeq = 0; }
      dirty = true;
      await flush();
    };

    return Object.freeze({
      beginRun, append, flush, restore, clear, serialize,
      getRun: (runId = activeRunId) => runs.get(String(runId || '')) || null,
      getActiveRun: () => runs.get(activeRunId) || null,
      setActiveRun(runId) { const id = String(runId || ''); if (!runs.has(id)) return false; activeRunId = id; notify(null, runs.get(id)); return true; },
      listRuns: () => Array.from(runs.values()),
      getDuplicateIds: (runId = activeRunId) => (duplicateIds.get(String(runId || '')) || []).slice(),
      getConflicts: (runId = activeRunId) => (conflicts.get(String(runId || '')) || []).slice(),
      subscribe(listener) { if (typeof listener !== 'function') return () => {}; listeners.add(listener); return () => listeners.delete(listener); }
    });
  }

  const api = Object.freeze({ STORAGE_KEY, MAX_RUNS, MAX_EVENTS_PER_RUN, createStore });
  root.DebateTraceStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
