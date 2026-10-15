// shared/run-guard.js
// Prevents overlapping orchestrator runs from sharing mutable background state.

(function initRunGuard(root) {
  'use strict';

  // A submitted prompt whose final status is not recorded yet means a provider
  // tab is still generating. Starting a new run then would type the next prompt
  // into a generating conversation or capture the old answer as the new one.
  // Bounded by the longest tab generation window so a lost final can never
  // block the transport forever.
  const DEFAULT_GENERATION_GUARD_MS = 20 * 60 * 1000;
  const STOPPED_STATUSES = new Set(['STOPPED', 'CANCELLED']);

  function generationGuardMs() {
    const limits = root.TransportContract?.CONTENT_LIMITS_MS?.long;
    const margin = Number(root.TransportContract?.PANEL_WAIT_MARGIN_MS || 0);
    return limits ? limits.hardMax + limits.streamStart + margin : DEFAULT_GENERATION_GUARD_MS;
  }

  function findGeneratingModel(llms, now = Date.now()) {
    if (!llms || typeof llms !== 'object') return null;
    const guardMs = generationGuardMs();
    return Object.keys(llms).find((name) => {
      const entry = llms[name];
      if (!entry || entry.cardAnswerComplete || entry.finalStatusRecorded) return false;
      if (STOPPED_STATUSES.has(String(entry.status || '').toUpperCase())) return false;
      const submittedAt = Number(entry.promptSubmittedAt || 0);
      return submittedAt > 0 && now - submittedAt < guardMs;
    }) || null;
  }

  // Every model of the previous batch has its final answer (or was stopped): what the rounds still do is housekeeping
  // (collect passes that skip finalized models, results-tab focus). No models: not "all done".
  function allModelsFinal(llms) {
    if (!llms || typeof llms !== 'object') return false;
    const names = Object.keys(llms);
    if (!names.length) return false;
    return names.every((name) => {
      const entry = llms[name];
      if (!entry) return true;
      return Boolean(entry.cardAnswerComplete || entry.finalStatusRecorded) || STOPPED_STATUSES.has(String(entry.status || '').toUpperCase());
    });
  }

  function canStartNewRun(session, options = {}, llms = null) {
    if (options.force === true) return { ok: true };
    // The next batch of a Basic run (pipelineContext.custom) does not wait for the tail of the rounds of the batch before it
    // when all its models have answered: the old rounds stop on their own when the new session starts (isSessionActive).
    const tailOnly = options.pipelineContext?.custom === true && allModelsFinal(llms);
    if (session?.roundsInProgress && !tailOnly) {
      return {
        ok: false,
        errorCode: 'RUN_ALREADY_ACTIVE',
        activeSessionId: session.sessionId || session.pipelineRunId || null
      };
    }
    // New tabs do not share a conversation with a still-generating tab.
    const generatingModel = options.forceNewTabs === true ? null : findGeneratingModel(llms);
    if (generatingModel) {
      return {
        ok: false,
        errorCode: 'RUN_ALREADY_ACTIVE',
        reason: 'model_still_generating',
        model: generatingModel,
        activeSessionId: session?.sessionId || session?.pipelineRunId || null
      };
    }
    return { ok: true };
  }

  const api = Object.freeze({
    canStartNewRun,
    findGeneratingModel,
    allModelsFinal
  });

  root.RunGuard = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
