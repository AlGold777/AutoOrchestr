// shared/pipeline-fsm.js
// Pipeline run control state + compaction helpers for MV3 lifecycle resilience.

(function initPipelineFsm(root) {
  'use strict';

  const STORAGE_KEY = 'llm_pipeline_fsm_v1';
  const STATES = Object.freeze({
    IDLE: 'IDLE',
    STARTING: 'STARTING',
    DISPATCHING: 'DISPATCHING',
    AWAITING_APPROVAL: 'AWAITING_APPROVAL',
    AWAITING_FINAL: 'AWAITING_FINAL',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
    FAILED: 'FAILED',
    STOPPED: 'STOPPED'
  });

  const DEFAULT_LIMITS = Object.freeze({
    // Authoritative run content must survive restart intact. Zero means no
    // truncation; callers building previews may still opt into explicit caps.
    maxAnswerChars: 0,
    maxHtmlChars: 0,
    maxTextChars: 0,
    maxLogEntries: 30,
    maxEventEntries: 24,
    maxListEntries: 20,
    maxStringFields: 5000,
    maxPayloadBytes: 32768,
    maxSnapshotsPerModel: 6,
    maxRoundsRetained: 6,
    maxAgeMs: 6 * 60 * 60 * 1000,
    dropPartialAfterFinal: true,
    dropPayloadAfterExport: true
  });

  const now = () => Date.now();
  const normalizeRunId = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  const normalizeId = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

  const trimString = (value, limit) => {
    const text = String(value || '');
    const max = Math.max(0, Number(limit) || 0);
    return max > 0 && text.length > max ? text.slice(0, max) : text;
  };

  const trimArrayTail = (value, limit) => (Array.isArray(value) ? value.slice(-Math.max(0, Number(limit) || 0)) : value);

  const safeJsonByteLength = (value) => {
    try {
      return JSON.stringify(value || {}).length;
    } catch (_) {
      return 0;
    }
  };

  const compactPayloadObject = (value, maxBytes) => {
    const cloned = clonePlain(value);
    if (!cloned || typeof cloned !== 'object') return cloned;
    if (safeJsonByteLength(cloned) <= maxBytes) return cloned;
    const next = { ...cloned };
    ['html', 'answerHtml', 'pendingFinalAnswerHtml', 'payloadHtml'].forEach((field) => {
      if (typeof next[field] === 'string') {
        next[field] = trimString(next[field], Math.max(0, Math.floor(maxBytes / 2)));
      }
    });
    ['answer', 'pendingFinalAnswer', 'payload', 'responseMeta', 'logs', 'snapshots'].forEach((field) => {
      if (safeJsonByteLength(next) <= maxBytes) return;
      if (Array.isArray(next[field])) {
        next[field] = next[field].slice(-(field === 'logs' ? 8 : 4));
      } else if (next[field] && typeof next[field] === 'object') {
        next[field] = clonePlain(next[field]);
      } else if (typeof next[field] === 'string') {
        next[field] = trimString(next[field], Math.max(0, Math.floor(maxBytes / 3)));
      }
    });
    if (safeJsonByteLength(next) <= maxBytes) return next;
    return {
      __compacted: true,
      keys: Object.keys(next).slice(0, 24)
    };
  };

  const clonePlain = (value) => {
    if (!value || typeof value !== 'object') return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return null;
    }
  };

  const createDispatchRecord = () => ({
    dispatchId: null,
    tabId: null,
    tabSessionId: null,
    pipelineRoundId: null,
    pipelineBatchId: null,
    stage: null,
    status: null,
    finalStatus: null,
    finalAt: null,
    readyAt: null,
    submittedAt: null,
    updatedAt: 0
  });

  const createState = (seed = {}) => ({
    schemaVersion: 1,
    pipelineRunId: normalizeRunId(seed.pipelineRunId),
    sessionId: Number(seed.sessionId || seed.runSessionId || 0) || null,
    state: seed.state || STATES.IDLE,
    stage: seed.stage || null,
    round: seed.round || null,
    startedAt: Number(seed.startedAt || 0) || null,
    updatedAt: Number(seed.updatedAt || 0) || now(),
    cancelledAt: Number(seed.cancelledAt || 0) || null,
    cancelReason: seed.cancelReason || null,
    completedAt: Number(seed.completedAt || 0) || null,
    terminalStatus: seed.terminalStatus || null,
    terminalReason: seed.terminalReason || null,
    activeDispatches: seed.activeDispatches && typeof seed.activeDispatches === 'object'
      ? clonePlain(seed.activeDispatches) || {}
      : {},
    recentEvents: Array.isArray(seed.recentEvents) ? seed.recentEvents.slice(-DEFAULT_LIMITS.maxEventEntries) : [],
    totals: seed.totals && typeof seed.totals === 'object' ? { ...seed.totals } : {},
    payload: seed.payload && typeof seed.payload === 'object' ? { ...seed.payload } : {}
  });

  const compactJobStateForStorage = (state = {}, limits = {}) => {
    if (!state || typeof state !== 'object') return state;
    const mergedLimits = { ...DEFAULT_LIMITS, ...(limits || {}) };
    const compacted = {};

    const compactSession = (session = {}) => {
      const next = {};
      [
        'startTime', 'totalModels', 'selectedModels', 'completed', 'failed', 'focusSwitches',
        'telemetrySampled', 'telemetrySampleRate', 'completedAt', 'runSummaryEmitted',
        'pipelineRunId', 'pipelineState', 'pipelineStage', 'pipelineRoundId', 'pipelineBatchId',
        'pipelineControl', 'roundDurations', 'roundStarts', 'runMetrics', 'boundTabIds',
        'acceptedFinals', 'roundSnapshots', 'roundSummaries', 'roundHistory', 'lastExportAt',
        'exportedAt', 'forceNewTabs', 'roundsInProgress', 'roundPhase',
        'mv3RehydratedAt', 'mv3RehydrationCount', 'roundsRecoveredFromStuckAt',
        // A retry after an MV3 restart must resend the exact per-model prompt
        // (role, delivery token), not the shared fallback prompt.
        'promptsByModel', 'pipelineContext'
      ].forEach((key) => {
        if (typeof session[key] !== 'undefined') {
          const value = clonePlain(session[key]);
          if (key === 'promptsByModel' && value && typeof value === 'object') {
            next[key] = Object.fromEntries(Object.entries(value).map(([model, text]) => [model, trimString(text, mergedLimits.maxTextChars)]));
          } else if (Array.isArray(value) && ['roundHistory', 'roundSnapshots', 'roundSummaries'].includes(key)) {
            next[key] = trimArrayTail(value, mergedLimits.maxRoundsRetained);
          } else if (value && typeof value === 'object' && key === 'pipelineControl') {
            next[key] = compactPayloadObject(value, mergedLimits.maxPayloadBytes);
          } else {
            next[key] = value;
          }
        }
      });
      return next;
    };

    const compactString = (value, limit) => trimString(value, limit);

    Object.keys(state).forEach((key) => {
      if (key === 'llms' || key === 'session' || key === 'attachments') return;
      if (key === 'prompt') {
        compacted.prompt = compactString(state.prompt, mergedLimits.maxTextChars);
        return;
      }
      compacted[key] = clonePlain(state[key]);
    });

    compacted.session = compactSession(state.session || {});
    compacted.attachments = Array.isArray(state.attachments)
      ? state.attachments.map((item) => ({
        name: trimString(item?.name, 256),
        size: Number(item?.size || 0) || 0,
        type: trimString(item?.type, 256)
      }))
      : [];

    const llms = state.llms && typeof state.llms === 'object' ? state.llms : {};
    compacted.llms = {};
    Object.entries(llms).forEach(([llmName, entry]) => {
      if (!entry || typeof entry !== 'object') return;
      const next = {};
      [
        'llmName', 'tabId', 'requestId', 'dispatchId', 'confirmedDispatchId', 'dispatchAttempts',
        'dispatchSource', 'submitSource', 'status', 'statusReason', 'finalStatus', 'finalStatusRecorded',
        'finalizedAt', 'promptSubmittedAt', 'lastDispatchAt', 'lastRuntimeActivityAt',
        'lastRuntimeActivitySource', 'lastDispatchMeta', 'recentDispatchIds', 'typedCharacters',
        'dispatchCheckpoint', 'lastCommandAcceptedAt', 'lastCommandAcceptedDispatchId',
        'completionAuthorityAttempt', 'runIdentity', 'pendingFinalAnswerDispatchId',
        'generationEpoch', 'preDispatchAnswerSignature', 'preDispatchAnswerHash',
        'preDispatchAnswerDispatchId', 'preDispatchAnswerCapturedAt',
        'preDispatchAnswerNodeCount', 'preDispatchAnswerNodeCountDispatchId',
        'messageSent', 'dispatchInFlight', 'dispatchState', 'typingActive', 'typingStartedAt',
        'typingEndedAt', 'typingGuardUntil', 'typingGuardReason', 'csBusyUntil',
        'lifecycleReadyAt', 'lifecycleReadyMeta', 'hardStopDeferredAt', 'hardStopDeferredDispatchId',
        'earlyTerminalGuard', 'earlyTerminalGuardNextPingAt', 'finalizationEvidence',
        'answerLength', 'answerHash', 'answerAcceptedAt', 'modelRunState', 'statusContract',
        'postTerminalNoiseCount', 'lastFinalEmitKey', 'lastFinalEmittedAt', 'statusData',
        'budgetTimers', 'recoveryBudgets', 'runId', 'responseMeta', 'responseSource', 'pipelineRunId', 'pipelineRoundId',
        'pipelineBatchId', 'pipelineState', 'pipelineStage', 'pipelineTabSessionId',
        'round4ForceFinalKey', 'round4ForceFinalAt', 'transientBlocker',
        'transientBlockerActive', 'transientBlockerActiveAt', 'transientBlockerRunSessionId',
        'transientBlockerDispatchId', 'transientBlockerTabId', 'lastClearedTransientBlockerToken',
        'perplexityPaywallResumeCount', 'transportRequestId'
      ].forEach((field) => {
        if (typeof entry[field] !== 'undefined') {
          next[field] = clonePlain(entry[field]);
        }
      });
      next.answer = compactString(entry.answer, mergedLimits.maxAnswerChars);
      next.answerHtml = compactString(entry.answerHtml, mergedLimits.maxHtmlChars);
      next.pendingFinalAnswer = compactString(entry.pendingFinalAnswer, mergedLimits.maxAnswerChars);
      next.pendingFinalAnswerHtml = compactString(entry.pendingFinalAnswerHtml, mergedLimits.maxHtmlChars);
      if (mergedLimits.dropPartialAfterFinal && entry.finalStatusRecorded) {
        delete next.pendingFinalAnswer;
        delete next.pendingFinalAnswerHtml;
      }
      next.responseMeta = compactPayloadObject(entry.responseMeta, mergedLimits.maxPayloadBytes);
      next.payload = compactPayloadObject(entry.payload, mergedLimits.maxPayloadBytes);
      next.snapshots = trimArrayTail(entry.snapshots, mergedLimits.maxSnapshotsPerModel);
      next.acceptedFinals = trimArrayTail(entry.acceptedFinals, mergedLimits.maxSnapshotsPerModel);
      next.recentDispatchIds = trimArrayTail(entry.recentDispatchIds, mergedLimits.maxListEntries);
      next.roundHistory = trimArrayTail(entry.roundHistory, mergedLimits.maxRoundsRetained);
      next.logs = Array.isArray(entry.logs) ? entry.logs.slice(-mergedLimits.maxLogEntries).map((log) => ({
        ...clonePlain(log),
        details: compactString(log?.details, mergedLimits.maxStringFields),
        label: compactString(log?.label, mergedLimits.maxStringFields)
      })) : [];
      next.budgetTimers = {};
      if (entry.budgetTimers && typeof entry.budgetTimers === 'object') {
        Object.keys(entry.budgetTimers).forEach((phase) => {
          const timer = entry.budgetTimers[phase];
          next.budgetTimers[phase] = {
            startedAt: Number(timer?.startedAt || 0) || null,
            budgetMs: Number(timer?.budgetMs || 0) || null
          };
        });
      }
      compacted.llms[llmName] = next;
    });

    return compacted;
  };

  const normalizeControlState = (raw = {}) => {
    const state = createState(raw || {});
    state.updatedAt = Number(raw?.updatedAt || now()) || now();
    if (Array.isArray(raw?.recentEvents)) {
      state.recentEvents = raw.recentEvents.slice(-DEFAULT_LIMITS.maxEventEntries);
    }
    return state;
  };

  const appendRecentEvent = (state, event = {}) => {
    if (!state) return state;
    const next = {
      ts: now(),
      type: normalizeId(event?.type) || null,
      state: normalizeId(event?.state) || null,
      llmName: normalizeId(event?.llmName) || null,
      dispatchId: normalizeId(event?.dispatchId) || null,
      tabId: Number(event?.tabId || 0) || null,
      tabSessionId: normalizeId(event?.tabSessionId) || null,
      reason: normalizeId(event?.reason) || null
    };
    state.recentEvents = Array.isArray(state.recentEvents) ? state.recentEvents.concat(next).slice(-DEFAULT_LIMITS.maxEventEntries) : [next];
    state.updatedAt = next.ts;
    return state;
  };

  const ensureDispatch = (state, llmName) => {
    if (!state.activeDispatches || typeof state.activeDispatches !== 'object') {
      state.activeDispatches = {};
    }
    if (!state.activeDispatches[llmName]) {
      state.activeDispatches[llmName] = createDispatchRecord();
    }
    return state.activeDispatches[llmName];
  };

  const setState = (state, nextState, extra = {}) => {
    state.state = nextState;
    if (typeof extra.stage !== 'undefined') state.stage = extra.stage;
    if (typeof extra.round !== 'undefined') state.round = extra.round;
    if (typeof extra.pipelineRunId !== 'undefined') state.pipelineRunId = normalizeRunId(extra.pipelineRunId);
    if (typeof extra.sessionId !== 'undefined') state.sessionId = Number(extra.sessionId || 0) || null;
    if (typeof extra.reason !== 'undefined') state.terminalReason = extra.reason || state.terminalReason || null;
    if (typeof extra.terminalStatus !== 'undefined') state.terminalStatus = extra.terminalStatus || null;
    if (typeof extra.payload !== 'undefined' && extra.payload) {
      state.payload = { ...(state.payload || {}), ...(clonePlain(extra.payload) || {}) };
    }
    state.updatedAt = now();
    return appendRecentEvent(state, { type: 'STATE', state: nextState, reason: extra.reason });
  };

  const startRun = (raw = {}) => {
    const state = createState({
      pipelineRunId: raw.pipelineRunId,
      sessionId: raw.sessionId,
      startedAt: raw.startedAt || now(),
      state: raw.state || STATES.STARTING,
      stage: raw.stage || 'dispatch',
      round: raw.round || null,
      payload: raw.payload || {},
      totals: raw.totals || {}
    });
    return appendRecentEvent(state, {
      type: 'START',
      state: state.state,
      reason: raw.reason || 'start_run'
    });
  };

  const registerDispatch = (state, meta = {}) => {
    if (!state) return null;
    const llmName = normalizeId(meta.llmName);
    if (!llmName) return null;
    const dispatch = ensureDispatch(state, llmName);
    dispatch.dispatchId = normalizeId(meta.dispatchId) || dispatch.dispatchId;
    dispatch.tabId = Number(meta.tabId || 0) || dispatch.tabId || null;
    dispatch.tabSessionId = normalizeId(meta.tabSessionId) || dispatch.tabSessionId || null;
    dispatch.pipelineRoundId = normalizeId(meta.pipelineRoundId) || dispatch.pipelineRoundId || null;
    dispatch.pipelineBatchId = normalizeId(meta.pipelineBatchId) || dispatch.pipelineBatchId || null;
    dispatch.stage = normalizeId(meta.stage) || dispatch.stage || null;
    dispatch.status = normalizeId(meta.status) || dispatch.status || null;
    dispatch.updatedAt = now();
    state.pipelineRunId = normalizeRunId(meta.pipelineRunId) || state.pipelineRunId || null;
    state.sessionId = Number(meta.sessionId || state.sessionId || 0) || null;
    if (meta.stage) state.stage = meta.stage;
    return appendRecentEvent(state, {
      type: 'DISPATCH',
      llmName,
      dispatchId: dispatch.dispatchId,
      tabId: dispatch.tabId,
      tabSessionId: dispatch.tabSessionId,
      reason: meta.reason || 'dispatch_registered'
    });
  };

  const markReady = (state, meta = {}) => {
    const llmName = normalizeId(meta.llmName);
    if (!state || !llmName) return state;
    const dispatch = ensureDispatch(state, llmName);
    if (meta.tabId) dispatch.tabId = Number(meta.tabId || 0) || dispatch.tabId || null;
    if (meta.tabSessionId) dispatch.tabSessionId = normalizeId(meta.tabSessionId);
    if (meta.dispatchId) dispatch.dispatchId = normalizeId(meta.dispatchId);
    dispatch.readyAt = now();
    dispatch.updatedAt = dispatch.readyAt;
    if (meta.pipelineRunId) state.pipelineRunId = normalizeRunId(meta.pipelineRunId);
    if (meta.stage) state.stage = meta.stage;
    return appendRecentEvent(state, {
      type: 'READY',
      llmName,
      dispatchId: dispatch.dispatchId,
      tabId: dispatch.tabId,
      tabSessionId: dispatch.tabSessionId,
      reason: meta.reason || 'ready'
    });
  };

  const markSubmitted = (state, meta = {}) => {
    const llmName = normalizeId(meta.llmName);
    if (!state || !llmName) return state;
    const dispatch = ensureDispatch(state, llmName);
    if (meta.dispatchId) dispatch.dispatchId = normalizeId(meta.dispatchId);
    if (meta.tabSessionId) dispatch.tabSessionId = normalizeId(meta.tabSessionId);
    dispatch.submittedAt = now();
    dispatch.updatedAt = dispatch.submittedAt;
    if (meta.pipelineRunId) state.pipelineRunId = normalizeRunId(meta.pipelineRunId);
    if (meta.stage) state.stage = meta.stage;
    return appendRecentEvent(state, {
      type: 'SUBMITTED',
      llmName,
      dispatchId: dispatch.dispatchId,
      tabSessionId: dispatch.tabSessionId,
      reason: meta.reason || 'submitted'
    });
  };

  const markAwaitingFinal = (state, meta = {}) => {
    if (!state) return state;
    return setState(state, STATES.AWAITING_FINAL, {
      ...meta,
      stage: meta.stage || 'awaiting_final',
      payload: meta.payload || {}
    });
  };

  const markAwaitingApproval = (state, meta = {}) => {
    if (!state) return state;
    return setState(state, STATES.AWAITING_APPROVAL, {
      ...meta,
      stage: meta.stage || 'awaiting_approval',
      payload: meta.payload || {}
    });
  };

  const markDispatching = (state, meta = {}) => {
    if (!state) return state;
    return setState(state, STATES.DISPATCHING, {
      ...meta,
      stage: meta.stage || 'dispatching',
      payload: meta.payload || {}
    });
  };

  const markFinal = (state, meta = {}) => {
    const llmName = normalizeId(meta.llmName);
    if (!state || !llmName) return { ok: false, reason: 'missing_llm' };
    const currentState = normalizeId(state.state) || STATES.IDLE;
    if ([STATES.CANCELLED, STATES.STOPPED, STATES.FAILED].includes(currentState)) {
      return { ok: false, reason: `pipeline_terminal_${currentState.toLowerCase()}`, state };
    }
    const dispatch = ensureDispatch(state, llmName);
    const dispatchId = normalizeId(meta.dispatchId) || dispatch.dispatchId || null;
    if (dispatch.finalStatus && dispatch.finalStatus === meta.finalStatus && dispatch.finalAt && dispatchId && dispatchId === dispatch.dispatchId) {
      return { ok: false, reason: 'duplicate_final', state };
    }
    if (dispatch.dispatchId && dispatchId && dispatch.dispatchId !== dispatchId) {
      return { ok: false, reason: 'dispatch_mismatch', state };
    }
    if (dispatch.tabSessionId && meta.tabSessionId && dispatch.tabSessionId !== normalizeId(meta.tabSessionId)) {
      return { ok: false, reason: 'tab_session_mismatch', state };
    }
    dispatch.finalStatus = normalizeId(meta.finalStatus) || null;
    dispatch.finalAt = now();
    dispatch.status = normalizeId(meta.finalStatus) || dispatch.status || null;
    dispatch.updatedAt = dispatch.finalAt;
    state.completedAt = state.completedAt || dispatch.finalAt;
    state.terminalStatus = normalizeId(meta.finalStatus) || state.terminalStatus || null;
    state.terminalReason = meta.reason || state.terminalReason || null;
    state.pipelineRunId = normalizeRunId(meta.pipelineRunId) || state.pipelineRunId || null;
    state.sessionId = Number(meta.sessionId || state.sessionId || 0) || null;
    if (meta.cancelled === true || meta.finalStatus === STATES.CANCELLED) {
      return { ok: true, state: setState(state, STATES.CANCELLED, meta) };
    }
    return { ok: true, state: setState(state, STATES.COMPLETED, meta) };
  };

  const cancelRun = (state, meta = {}) => {
    if (!state) return state;
    state.cancelledAt = now();
    state.cancelReason = meta.reason || 'cancelled';
    state.terminalReason = state.cancelReason;
    state.pipelineRunId = normalizeRunId(meta.pipelineRunId) || state.pipelineRunId || null;
    return setState(state, STATES.CANCELLED, {
      ...meta,
      reason: state.cancelReason,
      stage: meta.stage || state.stage || 'cancelled',
      payload: meta.payload || {}
    });
  };

  const stopRun = (state, meta = {}) => {
    if (!state) return state;
    state.terminalReason = meta.reason || 'stopped';
    return setState(state, STATES.STOPPED, {
      ...meta,
      reason: state.terminalReason,
      stage: meta.stage || state.stage || 'stopped'
    });
  };

  const completeRun = (state, meta = {}) => {
    if (!state) return state;
    const currentState = normalizeId(state.state) || STATES.IDLE;
    if ([STATES.CANCELLED, STATES.STOPPED, STATES.FAILED, STATES.COMPLETED].includes(currentState)) {
      return state;
    }
    state.completedAt = state.completedAt || now();
    state.terminalReason = meta.reason || state.terminalReason || 'completed';
    state.terminalStatus = meta.finalStatus || state.terminalStatus || 'SUCCESS';
    state.pipelineRunId = normalizeRunId(meta.pipelineRunId) || state.pipelineRunId || null;
    return setState(state, STATES.COMPLETED, {
      ...meta,
      reason: state.terminalReason,
      terminalStatus: state.terminalStatus,
      stage: meta.stage || state.stage || 'completed'
    });
  };

  const transition = (state, event = {}) => {
    const current = state && typeof state === 'object' ? state : createState();
    const stateName = String(event.state || event.pipelineState || '').trim().toUpperCase();
    switch (stateName) {
      case STATES.STARTING:
        return startRun({
          pipelineRunId: event.pipelineRunId || current.pipelineRunId || null,
          sessionId: event.sessionId || current.sessionId || null,
          stage: event.stage || current.stage || 'dispatch',
          round: event.round || current.round || null,
          payload: event.payload || {}
        });
      case STATES.DISPATCHING:
        return markDispatching(current, event);
      case STATES.AWAITING_APPROVAL:
        return markAwaitingApproval(current, event);
      case STATES.AWAITING_FINAL:
        return markAwaitingFinal(current, event);
      case STATES.COMPLETED:
        return completeRun(current, event);
      case STATES.CANCELLED:
        return cancelRun(current, event);
      case STATES.FAILED:
        return stopRun(current, event);
      case STATES.STOPPED:
        return stopRun(current, event);
      default:
        return normalizeControlState({
          ...current,
          ...event,
          updatedAt: now()
        });
    }
  };

  const shouldAcceptEvent = (state, envelope = {}) => {
    const current = state && typeof state === 'object' ? state : createState();
    const pipelineRunId = normalizeRunId(envelope.pipelineRunId);
    const currentRunId = normalizeRunId(current.pipelineRunId);
    const llmName = normalizeId(envelope.llmName);
    const dispatch = llmName ? current.activeDispatches?.[llmName] || null : null;
    const incomingDispatchId = normalizeId(envelope.dispatchId);
    const incomingTabSessionId = normalizeId(envelope.tabSessionId);
    const kind = normalizeId(envelope.kind) || 'response';
    const incomingFinalStatus = normalizeId(envelope.finalStatus);
    const allowRecoveredFinal = envelope.allowRecoveredFinal === true;
    if (current.state === STATES.CANCELLED) {
      if (!pipelineRunId || !currentRunId || pipelineRunId === currentRunId) {
        return { ok: false, reason: 'pipeline_cancelled' };
      }
    }
    if (currentRunId && pipelineRunId && currentRunId !== pipelineRunId) {
      return { ok: false, reason: 'pipeline_run_mismatch' };
    }
    if (dispatch && incomingDispatchId && dispatch.dispatchId && dispatch.dispatchId !== incomingDispatchId) {
      return { ok: false, reason: 'dispatch_mismatch' };
    }
    if (dispatch && incomingTabSessionId && dispatch.tabSessionId && dispatch.tabSessionId !== incomingTabSessionId) {
      return { ok: false, reason: 'tab_session_mismatch' };
    }
    if (kind === 'ready' && dispatch?.tabSessionId && incomingTabSessionId && dispatch.tabSessionId !== incomingTabSessionId) {
      return { ok: false, reason: 'stale_ready' };
    }
    if (kind === 'final' && dispatch?.finalStatus && dispatch.dispatchId === incomingDispatchId) {
      const previousFailure = ['ERROR', 'CRITICAL_ERROR', 'UNRESPONSIVE', 'CIRCUIT_OPEN', 'API_FAILED', 'NO_SEND', 'EXTRACT_FAILED', 'STREAM_TIMEOUT', 'EXTERNAL_LLM_FAILURE', 'USER_ACTION_REQUIRED', 'UNCERTAIN'].includes(String(dispatch.finalStatus || '').toUpperCase());
      const incomingSuccess = ['COPY_SUCCESS', 'SUCCESS', 'DONE', 'COMPLETE', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN'].includes(String(incomingFinalStatus || '').toUpperCase());
      if (allowRecoveredFinal && previousFailure && incomingSuccess) {
        return { ok: true, reason: 'recovered_final_override' };
      }
      // Run 1782944449199: Perplexity locked PARTIAL (truncated snapshot), the
      // user's status-indicator double-click recovered the full answer, but the
      // SUCCESS candidate was dropped here as duplicate_final because the
      // recovered override only covered failure->success. A partial->full-success
      // upgrade of the same dispatch is a legitimate recovered final too.
      const previousPartial = ['PARTIAL', 'STREAM_TIMEOUT_HIDDEN', 'STREAM_TIMEOUT'].includes(String(dispatch.finalStatus || '').toUpperCase());
      const incomingFullSuccess = ['COPY_SUCCESS', 'SUCCESS', 'DONE', 'COMPLETE'].includes(String(incomingFinalStatus || '').toUpperCase());
      if (allowRecoveredFinal && previousPartial && incomingFullSuccess) {
        return { ok: true, reason: 'recovered_partial_upgrade' };
      }
      return { ok: false, reason: 'duplicate_final' };
    }
    return { ok: true, reason: 'accepted' };
  };

  const persistControlState = async (state = null) => {
    if (!chrome?.storage?.session) return null;
    const control = normalizeControlState(state || {});
    try {
      await chrome.storage.session.set({ [STORAGE_KEY]: control });
    } catch (err) {
      console.warn('[PipelineFSM] Failed to persist control state', err);
    }
    return control;
  };

  const loadControlState = async () => {
    if (!chrome?.storage?.session?.get) return createState();
    try {
      const data = await chrome.storage.session.get(STORAGE_KEY);
      return normalizeControlState(data?.[STORAGE_KEY] || {});
    } catch (err) {
      console.warn('[PipelineFSM] Failed to load control state', err);
      return createState();
    }
  };

  const hydrateJobState = (jobState = {}, controlState = null) => {
    if (!jobState || typeof jobState !== 'object') return jobState;
    const control = normalizeControlState(controlState || jobState?.session?.pipelineControl || {});
    if (!jobState.session || typeof jobState.session !== 'object') {
      jobState.session = {};
    }
    jobState.session.pipelineRunId = control.pipelineRunId || jobState.session.pipelineRunId || null;
    jobState.session.pipelineState = control.state;
    jobState.session.pipelineStage = control.stage || null;
    jobState.session.pipelineRoundId = control.round || null;
    jobState.session.pipelineControl = control;
    return jobState;
  };

  const api = Object.freeze({
    STORAGE_KEY,
    STATES,
    DEFAULT_LIMITS,
    createState,
    createDispatchRecord,
    normalizeControlState,
    compactJobStateForStorage,
    startRun,
    registerDispatch,
    markReady,
    markSubmitted,
    markAwaitingApproval,
    markAwaitingFinal,
    markDispatching,
    markFinal,
    completeRun,
    cancelRun,
    stopRun,
    transition,
    shouldAcceptEvent,
    persistControlState,
    loadControlState,
    hydrateJobState
  });

  root.PipelineFSM = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
