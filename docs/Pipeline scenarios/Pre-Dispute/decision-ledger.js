// shared/decision-ledger.js
// Lightweight per-model causal decision log.

(function initDecisionLedger(root) {
  'use strict';

  const DEFAULT_LIMIT = 80;

  function append(entry = {}, record = {}, options = {}) {
    if (!entry || typeof entry !== 'object') return null;
    const limit = Math.max(1, Number(options.limit || DEFAULT_LIMIT));
    const nextRecord = {
      schemaVersion: 1,
      ts: Number(record.ts || Date.now()),
      decision: String(record.decision || 'unknown'),
      reason: record.reason ? String(record.reason) : null,
      source: record.source ? String(record.source) : null,
      inputs: record.inputs && typeof record.inputs === 'object' ? record.inputs : {},
      resultingState: record.resultingState || entry.finalStatus || entry.status || null
    };
    entry.decisionLedger = Array.isArray(entry.decisionLedger) ? entry.decisionLedger : [];
    entry.decisionLedger.push(nextRecord);
    if (entry.decisionLedger.length > limit) {
      entry.decisionLedger = entry.decisionLedger.slice(-limit);
    }
    entry.lastDecisionRecord = nextRecord;
    return nextRecord;
  }

  function get(entry = {}) {
    return Array.isArray(entry.decisionLedger) ? entry.decisionLedger : [];
  }

  const api = Object.freeze({
    append,
    get
  });

  root.DecisionLedger = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
