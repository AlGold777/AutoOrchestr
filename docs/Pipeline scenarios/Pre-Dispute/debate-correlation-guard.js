(function initDebateCorrelationGuard(root) {
  'use strict';
  function validate(expected = {}, received = {}) {
    const keys = ['pipelineRunId', 'pipelineStageId', 'stageAttemptId', 'pipelineBatchId'];
    const missing = keys.find((key) => expected[key] && !received[key]);
    if (missing) return { ok: false, reason: missing === 'pipelineRunId' ? 'STALE_EVENT_REJECTED' : 'CORRELATION_REJECTED', field: missing, missing: true };
    const mismatch = keys.find((key) => expected[key] && received[key] && String(expected[key]) !== String(received[key]));
    return mismatch ? { ok: false, reason: mismatch === 'pipelineRunId' ? 'STALE_EVENT_REJECTED' : 'CORRELATION_REJECTED', field: mismatch } : { ok: true, reason: '' };
  }
  const api = Object.freeze({ validate }); root.DebateCorrelationGuard = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
