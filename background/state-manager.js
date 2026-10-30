// background/state-manager.js
// Central state updates for LLM status and UI broadcasts.

'use strict';

function clonePlainForStateTelemetry(value) {
  if (!value || typeof value !== 'object') return null;
  try {
    const clone = JSON.parse(JSON.stringify(value));
    const redactTextField = (target, key) => {
      if (!target || !Object.prototype.hasOwnProperty.call(target, key)) return;
      const text = String(target[key] || '');
      target[`${key}Length`] = text.trim().length;
      delete target[key];
    };
    redactTextField(clone, 'answer');
    redactTextField(clone, 'answerHtml');
    redactTextField(clone, 'answerMarkdown');
    redactTextField(clone, 'pendingFinalAnswer');
    return clone;
  } catch (_) {
    return { unserializable: true };
  }
}

function snapshotLegacyModelState(entry = {}) {
  return {
    status: entry?.status || null,
    finalStatus: entry?.finalStatus || null,
    finalStatusRecorded: !!entry?.finalStatusRecorded,
    finalizedAt: entry?.finalizedAt || null,
    answerLength: String(entry?.answer || '').trim().length,
    pendingFinalAnswerLength: String(entry?.pendingFinalAnswer || '').trim().length
  };
}

function summarizeModelRunStateForTelemetry(state = null) {
  if (!state || typeof state !== 'object') return null;
  return {
    uiStatus: state.uiStatus || null,
    liveStatus: state.liveStatus || null,
    terminalStatus: state.terminalStatus || null,
    terminalState: state.terminalState || null,
    executionState: state.executionState || null,
    generationState: state.generationState || null,
    extractionState: state.extractionState || null,
    answerState: state.answerState || null,
    dispatchId: state.dispatchId || null,
    tabId: state.tabId || null,
    answerLength: Number(state.answerLength || 0),
    answerHash: state.answerHash || null,
    postTerminalNoiseCount: Number(state.postTerminalNoiseCount || 0),
    lastTransition: state.lastTransition || null,
    lastTransitionAt: state.lastTransitionAt || null
  };
}

function emitStateMachineTelemetry(llmName, label, { level = 'info', details = '', meta = {} } = {}) {
  if (!llmName || !label) return null;
  if (typeof self.emitTelemetry === 'function') {
    return self.emitTelemetry(llmName, label, {
      level,
      details,
      meta: {
        stateTelemetry: true,
        stateOwner: 'modelRunState',
        ...(meta || {})
      },
      force: true
    });
  }
  if (typeof self.broadcastDiagnostic === 'function') {
    return self.broadcastDiagnostic(llmName, {
      type: 'TELEMETRY',
      label,
      details,
      level,
      meta: {
        stateTelemetry: true,
        stateOwner: 'modelRunState',
        ...(meta || {})
      }
    });
  }
  return null;
}

function detectModelStateDivergence(llmName, entry = {}, source = 'unknown', extra = {}) {
  const normalizeStatus = self.LLMStatusContract?.normalizeStatus || ((value) => String(value || '').trim().toUpperCase());
  const state = entry?.modelRunState || null;
  if (!llmName || !entry || !state) return false;
  const legacyStatus = normalizeStatus(entry.status || '');
  const legacyFinalStatus = normalizeStatus(entry.finalStatus || '');
  const modelUiStatus = normalizeStatus(state.uiStatus || '');
  const modelTerminalStatus = normalizeStatus(state.terminalStatus || '');
  const statusDiverged = !!legacyStatus && !!modelUiStatus && legacyStatus !== modelUiStatus;
  const finalDiverged = !!modelTerminalStatus && !!legacyFinalStatus && legacyFinalStatus !== modelTerminalStatus;
  const missingLegacyFinal = !!modelTerminalStatus && !legacyFinalStatus && !!entry.finalStatusRecorded;
  if (!statusDiverged && !finalDiverged && !missingLegacyFinal) return false;

  const divergenceKey = [
    source,
    legacyStatus,
    legacyFinalStatus,
    modelUiStatus,
    modelTerminalStatus,
    state.terminalState || ''
  ].join('|');
  const now = Date.now();
  if (entry.lastStateDivergenceKey === divergenceKey && (now - Number(entry.lastStateDivergenceAt || 0)) < 5000) {
    return true;
  }
  entry.lastStateDivergenceKey = divergenceKey;
  entry.lastStateDivergenceAt = now;
  emitStateMachineTelemetry(llmName, 'STATE_DIVERGENCE_DETECTED', {
    level: 'warning',
    details: `${legacyStatus || 'UNKNOWN'} != ${modelUiStatus || 'UNKNOWN'}`,
    meta: {
      source,
      legacy: snapshotLegacyModelState(entry),
      modelRunState: summarizeModelRunStateForTelemetry(state),
      statusDiverged,
      finalDiverged,
      missingLegacyFinal,
      ...(extra || {})
    }
  });
  return true;
}

// Excludes volatile fields (tick timestamps) so a state snapshot compares equal
// across repeated polls when nothing observable actually changed.
function fingerprintModelRunStateForDedupe(state) {
  if (!state || typeof state !== 'object') return JSON.stringify(state ?? null);
  const { lastTransitionAt, ...rest } = state;
  return JSON.stringify(rest);
}

function commitModelRunTransition(llmName, entry, transition, payload = {}) {
  if (!entry || !self.ModelRunState?.applyModelRunTransition) {
    return { ok: false, applied: false, reason: 'model_run_state_unavailable', state: null };
  }
  const source = payload?.source || payload?.reason || 'unknown';
  const legacyBefore = snapshotLegacyModelState(entry);
  const previousState = summarizeModelRunStateForTelemetry(entry.modelRunState || null);
  const result = self.ModelRunState.applyModelRunTransition(entry, transition, payload);
  const nextState = summarizeModelRunStateForTelemetry(entry.modelRunState || result?.state || null);
  const legacyAfter = snapshotLegacyModelState(entry);
  const normalizedTransition = String(transition || '').toUpperCase();
  const shouldEmitTransitionTelemetry = (() => {
    if (payload?.silent === true) return false;
    if (payload?.forceTelemetry === true) return true;
    // POST_TERMINAL_NOISE updates counters, but exporting every ignored DOM/lifecycle echo
    // makes All Logs unreadable and hides the real terminal transition.
    if (normalizedTransition === 'POST_TERMINAL_NOISE') return false;
    if (normalizedTransition !== 'STATUS_UPDATE') return true;
    // STATUS_UPDATE fires on every streaming poll (~1-2s) even when nothing
    // observable changed (same status, same answer length) -- a stuck/looping
    // model was seen emitting hundreds of identical MODEL_RUN_TRANSITION events
    // this way (telemetry export bloat, run 1785185340505). Only skip the repeat
    // when the actual state snapshot is unchanged from the previous STATUS_UPDATE.
    const dedupeKey = `${normalizedTransition}|${fingerprintModelRunStateForDedupe(previousState)}|${fingerprintModelRunStateForDedupe(nextState)}|${JSON.stringify(legacyBefore)}|${JSON.stringify(legacyAfter)}`;
    const isRepeat = entry.lastModelRunTransitionDedupeKey === dedupeKey;
    entry.lastModelRunTransitionDedupeKey = dedupeKey;
    return !isRepeat;
  })();
  if (shouldEmitTransitionTelemetry) {
    const emittedPreviousState = summarizeModelRunStateForTelemetry(result?.previousState) || previousState;
    // These four fields are four views of one state, and the "after" views are
    // usually byte-identical to the "before" ones (legacyAfter matched
    // legacyBefore in 47/47 transitions on a real run). Emitting an identical
    // twin adds no diagnostic signal, so omit it: a missing twin reads as
    // "unchanged from its counterpart".
    const legacyChanged = JSON.stringify(legacyBefore) !== JSON.stringify(legacyAfter);
    const runStateChanged = JSON.stringify(emittedPreviousState) !== JSON.stringify(nextState);
    emitStateMachineTelemetry(llmName, 'MODEL_RUN_TRANSITION', {
      level: result?.applied === false ? 'warning' : 'info',
      details: `${normalizedTransition}:${result?.reason || 'accepted'}`,
      meta: {
        transition: normalizedTransition,
        applied: result?.applied !== false,
        reason: result?.reason || null,
        source,
        ...(runStateChanged ? { previousState: emittedPreviousState } : {}),
        nextState,
        legacyBefore,
        ...(legacyChanged ? { legacyAfter } : {}),
        payload: {
          status: payload?.status || null,
          reason: payload?.reason || null,
          dispatchId: payload?.dispatchId || null,
          tabId: payload?.tabId || null,
          runSessionId: payload?.runSessionId || null,
          manualRecovery: !!payload?.manualRecovery,
          allowTerminalUpgrade: !!payload?.allowTerminalUpgrade
        }
      }
    });
  }
  // Divergence is meaningful after legacy projection. Checking immediately after
  // a transition creates expected transient noise: FSM has moved, legacy fields
  // may not have been projected yet.
  if (payload?.detectDivergence === true) {
    detectModelStateDivergence(llmName, entry, `transition:${normalizedTransition}`, {
      transition: normalizedTransition,
      transitionReason: result?.reason || null
    });
  }
  return result;
}

function emitStateProjectionCommitted(llmName, entry = {}, source = 'unknown', beforeLegacy = null, projection = {}) {
  if (!llmName || !entry) return null;
  const modelRunState = entry.modelRunState || null;
  const legacyBefore = beforeLegacy || null;
  const legacyAfter = snapshotLegacyModelState(entry);
  const legacyChanged = JSON.stringify(legacyBefore || {}) !== JSON.stringify(legacyAfter || {});
  const modelRunStateSummary = summarizeModelRunStateForTelemetry(modelRunState);
  // projectModelRunStateToLegacy() runs on every streaming poll; when the legacy
  // projection and modelRunState summary are both unchanged from the last commit
  // for this source, this is a repeat no-op and doesn't need its own telemetry
  // event (same bloat source as MODEL_RUN_TRANSITION above, run 1785185340505).
  const projectionDedupeKey = `${source}|${legacyChanged}|${fingerprintModelRunStateForDedupe(modelRunStateSummary)}`;
  const isRepeat = !legacyChanged && entry.lastStateProjectionDedupeKey === projectionDedupeKey;
  entry.lastStateProjectionDedupeKey = projectionDedupeKey;
  const saved = isRepeat ? null : emitStateMachineTelemetry(llmName, 'STATE_PROJECTION_COMMITTED', {
    level: 'info',
    details: source,
    meta: {
      source,
      stateOwner: 'legacyProjection',
      legacyChanged,
      legacyBefore,
      legacyAfter,
      modelRunState: modelRunStateSummary,
      projection: clonePlainForStateTelemetry(projection)
    }
  });
  detectModelStateDivergence(llmName, entry, `projection:${source}`);
  return saved;
}

function projectModelRunStateToLegacy(llmName, entry = {}, projection = {}, source = 'unknown') {
  if (!llmName || !entry || typeof entry !== 'object') {
    return { ok: false, reason: 'missing_entry' };
  }
  const beforeLegacy = snapshotLegacyModelState(entry);
  const has = (key) => Object.prototype.hasOwnProperty.call(projection || {}, key);

  if (has('answer')) entry.answer = projection.answer;
  if (has('answerHtml')) entry.answerHtml = projection.answerHtml;
  if (has('answerMarkdown')) entry.answerMarkdown = projection.answerMarkdown;
  if (has('copyReport')) entry.copyReport = projection.copyReport;
  if (has('status')) entry.status = projection.status;
  if (has('statusReason')) entry.statusReason = projection.statusReason;
  if (has('statusData')) entry.statusData = projection.statusData;
  if (has('responseMeta')) entry.responseMeta = projection.responseMeta;
  if (has('finalStatusRecorded')) entry.finalStatusRecorded = !!projection.finalStatusRecorded;
  if (has('finalizedAt')) entry.finalizedAt = projection.finalizedAt;
  if (has('finalStatus')) entry.finalStatus = projection.finalStatus;
  if (has('hardStopDeferredAt')) entry.hardStopDeferredAt = projection.hardStopDeferredAt;
  if (has('hardStopDeferredDispatchId')) entry.hardStopDeferredDispatchId = projection.hardStopDeferredDispatchId;
  if (has('earlyTerminalGuard')) entry.earlyTerminalGuard = projection.earlyTerminalGuard;
  if (has('earlyTerminalGuardNextPingAt')) entry.earlyTerminalGuardNextPingAt = projection.earlyTerminalGuardNextPingAt;
  if (has('transientBlocker')) entry.transientBlocker = projection.transientBlocker;
  if (has('transientBlockerActive')) entry.transientBlockerActive = projection.transientBlockerActive;
  if (has('transientBlockerActiveAt')) entry.transientBlockerActiveAt = projection.transientBlockerActiveAt;
  if (has('transientBlockerRunSessionId')) entry.transientBlockerRunSessionId = projection.transientBlockerRunSessionId;
  if (has('transientBlockerDispatchId')) entry.transientBlockerDispatchId = projection.transientBlockerDispatchId;
  if (has('transientBlockerTabId')) entry.transientBlockerTabId = projection.transientBlockerTabId;

  entry.statusContract = self.LLMStatusContract?.deriveStatusContract
    ? self.LLMStatusContract.deriveStatusContract(entry)
    : null;

  emitStateProjectionCommitted(llmName, entry, source, beforeLegacy, projection);
  return {
    ok: true,
    legacyBefore: beforeLegacy,
    legacyAfter: snapshotLegacyModelState(entry),
    modelRunState: entry.modelRunState || null
  };
}

function updateModelState(llmName, status, data = {}) {
  if (!llmName || !status) return;
  const contract = self.LLMStatusContract || {};
  const runState = self.ModelRunState || {};
  const normalizeStatus = contract.normalizeStatus || ((value) => String(value || '').trim().toUpperCase());
  const normalizedStatus = normalizeStatus(status);

  if (jobState?.llms?.[llmName]) {
    const entry = jobState.llms[llmName];
    const currentStatus = entry.status;
    const contractTerminalBlocksNonTerminal = Boolean(
      contract.isTerminalStatus
      && (entry.finalStatusRecorded || entry.finalizedAt || entry.finalStatus)
      && contract.isTerminalStatus(entry.finalStatus || currentStatus)
      && !contract.isTerminalStatus(normalizedStatus)
      && data?.force !== true
      && data?.reset !== true
    );
    const terminalRunBlocksNonTerminal = Boolean(
      runState.isTerminalRunState
      && runState.isTerminalRunState(entry)
      && !(runState.isTerminalStatus ? runState.isTerminalStatus(normalizedStatus) : contract.isTerminalStatus?.(normalizedStatus))
    );
    if (terminalRunBlocksNonTerminal || contractTerminalBlocksNonTerminal) {
      if (self.commitModelRunTransition) {
        self.commitModelRunTransition(llmName, entry, 'POST_TERMINAL_NOISE', {
          label: normalizedStatus,
          source: 'updateModelState_terminal_guard',
          status: normalizedStatus,
          runSessionId: jobState?.session?.startTime || null,
          dispatchId: entry?.lastDispatchMeta?.dispatchId || entry?.confirmedDispatchId || null,
          tabId: entry?.tabId || null
        });
      } else if (runState.recordPostTerminalNoise) {
        runState.recordPostTerminalNoise(entry, { label: normalizedStatus });
      }
      const terminalGuardReason = contractTerminalBlocksNonTerminal
        ? 'legacy_terminal_blocks_non_terminal_status'
        : 'terminal_blocks_non_terminal_status';
      globalThis.LLMLog?.debug?.(`[State Update] Skipping ${llmName}: ${normalizedStatus} blocked by terminal guard (${terminalGuardReason})`);
      appendLogEntry(llmName, {
        type: 'STATUS',
        label: 'STATUS_IGNORED',
        details: `${currentStatus || 'UNKNOWN'} -> ${normalizedStatus} (${terminalGuardReason})`,
        level: 'info',
        meta: {
          currentStatus: currentStatus || null,
          incomingStatus: normalizedStatus,
          reason: terminalGuardReason,
          modelRunState: entry.modelRunState || null
        }
      });
      return;
    }
    const decision = contract.shouldApplyStatusUpdate
      ? contract.shouldApplyStatusUpdate(currentStatus, normalizedStatus, data)
      : { apply: true, reason: 'no_contract' };
    if (!decision.apply) {
      globalThis.LLMLog?.debug?.(`[State Update] Skipping ${llmName}: ${normalizedStatus} blocked by ${decision.reason} (current: ${currentStatus})`);
      appendLogEntry(llmName, {
        type: 'STATUS',
        label: 'STATUS_IGNORED',
        details: `${currentStatus || 'UNKNOWN'} -> ${normalizedStatus} (${decision.reason})`,
        level: 'info',
        meta: {
          currentStatus: currentStatus || null,
          incomingStatus: normalizedStatus,
          reason: decision.reason,
          currentRank: decision.currentRank,
          incomingRank: decision.incomingRank
        }
      });
      return;
    }

    if (self.commitModelRunTransition) {
      self.commitModelRunTransition(llmName, entry, 'STATUS_UPDATE', {
        ...(data || {}),
        status: normalizedStatus,
        source: data?.source || 'updateModelState',
        runSessionId: jobState?.session?.startTime || null,
        dispatchId: entry?.lastDispatchMeta?.dispatchId || entry?.confirmedDispatchId || null,
        tabId: entry?.tabId || null
      });
    } else if (runState.applyModelRunTransition) {
      runState.applyModelRunTransition(entry, 'STATUS_UPDATE', {
        ...(data || {}),
        status: normalizedStatus,
        runSessionId: jobState?.session?.startTime || null,
        dispatchId: entry?.lastDispatchMeta?.dispatchId || entry?.confirmedDispatchId || null,
        tabId: entry?.tabId || null
      });
    }
    projectModelRunStateToLegacy(llmName, entry, {
      status: normalizedStatus,
      statusData: data || null
    }, 'updateModelState');
  }

  const severity = (() => {
    if (['CRITICAL_ERROR', 'API_FAILED', 'NO_SEND', 'EXTRACT_FAILED', 'STREAM_TIMEOUT', 'EXTERNAL_LLM_FAILURE', 'USER_ACTION_REQUIRED'].includes(normalizedStatus)) return 'error';
    if (['RECOVERABLE_ERROR', 'ERROR', 'UNRESPONSIVE', 'CIRCUIT_OPEN', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN', 'UNCERTAIN'].includes(normalizedStatus)) return 'warning';
    return 'info';
  })();

  appendLogEntry(llmName, {
    type: 'STATUS',
    label: `Status: ${normalizedStatus}`,
    details: data?.message || '',
    level: severity,
    meta: {
      status: normalizedStatus,
      modelRunState: jobState?.llms?.[llmName]?.modelRunState || null
    }
  });
  globalThis.LLMLog?.debug?.(`[State Update] ${llmName} -> ${normalizedStatus}`);
  const outgoingData = {
    ...(data || {}),
    modelRunState: jobState?.llms?.[llmName]?.modelRunState || null
  };
  sendMessageToResultsTab({
    type: 'STATUS_UPDATE',
    llmName,
    status: normalizedStatus,
    data: outgoingData,
    logs: getLogSnapshot(llmName)
  });
  broadcastGlobalState();
}

self.updateModelState = updateModelState;
self.commitModelRunTransition = commitModelRunTransition;
self.detectModelStateDivergence = detectModelStateDivergence;
self.emitStateProjectionCommitted = emitStateProjectionCommitted;
self.projectModelRunStateToLegacy = projectModelRunStateToLegacy;
self.summarizeModelRunStateForTelemetry = summarizeModelRunStateForTelemetry;
self.snapshotLegacyModelState = snapshotLegacyModelState;

globalThis.LLMLog?.debug?.('[StateManager] Module loaded');
