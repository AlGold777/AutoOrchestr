(function initDebateRuleHistory(root) {
  'use strict';
  const VERSION = 1;
  const STORAGE_KEY = 'llmCodexDebateRuleHistory.v1';
  function summarize(runs = []) {
    const byRule = {};
    runs.forEach((run) => {
      (run.ruleEvaluations || []).filter((entry) => !entry.eventType || entry.eventType === 'RULE_EVALUATED').forEach((entry) => {
      const id = String(entry.ruleId || entry.triggerId || 'unknown');
      const stats = byRule[id] || { ruleId: id, triggerId: entry.triggerId || id, evaluated: 0, fired: 0, suppressed: 0, completed: 0, changed: 0 };
      stats.evaluated += 1;
      if (entry.status === 'fired') stats.fired += 1;
      else stats.suppressed += 1;
      byRule[id] = stats;
      });
      (run.progressWindow || []).forEach((entry) => {
        const candidate = Object.values(byRule).find((item) => item.triggerId === entry.triggerId);
        if (!candidate) return;
        candidate.completed += 1;
        if (entry.stateChanged === true) candidate.changed += 1;
      });
    });
    Object.values(byRule).forEach((item) => {
      item.fireRate = item.evaluated ? item.fired / item.evaluated : 0;
      item.progressRate = item.completed ? item.changed / item.completed : null;
    });
    return Object.freeze({ version: VERSION, runCount: runs.length, byRule: Object.freeze(byRule) });
  }
  function createStore(options = {}) {
    const storage = options.storage; const key = options.key || STORAGE_KEY; const maxRuns = Math.max(10, Number(options.maxRuns || 100));
    let runs = [];
    const persist = async () => { if (storage?.set) await storage.set({ [key]: { version: VERSION, runs } }); };
    return Object.freeze({
      async restore() { if (!storage?.get) return runs; const value = await storage.get(key); runs = Array.isArray(value?.[key]?.runs) ? value[key].runs.slice(-maxRuns) : []; return runs; },
      async record(aggregate = {}) {
        if (!aggregate.runId) return null;
        const record = { runId: aggregate.runId, topology: aggregate.topology, profileId: aggregate.executionPlan?.profileId || aggregate.executionPlan?.presetId || '', completedAt: aggregate.completedAt || Date.now(), status: aggregate.status, epistemicOutcome: aggregate.epistemicOutcome || '', ruleEvaluations: (aggregate.ruleEvaluations || []).slice(), progressWindow: (aggregate.progressWindow || []).slice() };
        runs = runs.filter((item) => item.runId !== record.runId).concat(record).slice(-maxRuns); await persist(); return record;
      },
      list: () => runs.slice(), summary: () => summarize(runs), clear: async () => { runs = []; await persist(); }
    });
  }
  const api = Object.freeze({ VERSION, STORAGE_KEY, summarize, createStore });
  root.DebateRuleHistory = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
