// Canonical construction/projection of background pipeline execution state.
(function initPipelineRunState(root) {
  'use strict';

  function create({ prompt = '', selectedModels = [], useApiFallback = true, forceNewTabs = true, attachments = [], sourceView = null, pipelineContext = null, telemetrySampled = false, telemetrySampleRate = null, startedAt = Date.now(), promptsByModel = null, previousRunSessionIds = [] } = {}) {
    return {
      prompt,
      llms: {},
      responsesCollected: 0,
      evaluationStarted: false,
      useApiFallback,
      session: {
        startTime: startedAt,
        // Every wave of one pipeline run gets its own startTime; the list keeps
        // all of them so diagnostics export can cover the whole run.
        runSessionIds: [...(Array.isArray(previousRunSessionIds) ? previousRunSessionIds : []), startedAt],
        totalModels: selectedModels.length,
        selectedModels: selectedModels.slice(),
        completed: 0,
        failed: 0,
        focusSwitches: 0,
        boundTabIds: [],
        telemetrySampled,
        telemetrySampleRate,
        forceNewTabs: forceNewTabs !== false,
        roundsInProgress: false,
        roundPhase: null,
        sourceView,
        pipelineRunId: pipelineContext?.pipelineRunId || null,
        pipelineState: 'STARTING',
        pipelineStage: 'dispatch',
        pipelineRoundId: null,
        pipelineBatchId: null,
        pipelineContext,
        promptsByModel
      },
      attachments: Array.isArray(attachments) ? attachments : []
    };
  }

  function applyControl(jobState, control) {
    if (!jobState || !control) return jobState;
    jobState.session = jobState.session || {};
    jobState.session.pipelineControl = control;
    jobState.session.pipelineRunId = control.pipelineRunId || jobState.session.pipelineRunId || null;
    jobState.session.pipelineState = control.state || jobState.session.pipelineState || 'IDLE';
    jobState.session.pipelineStage = control.stage || null;
    jobState.session.pipelineRoundId = control.round || null;
    return jobState;
  }

  const api = Object.freeze({ create, applyControl });
  root.PipelineRunState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
