// shared/finalization-controller.js
// Single decision gate for terminal model-run finalization.

(function initFinalizationController(root) {
  'use strict';

  const STATUS_CONTRACT = root.LLMStatusContract || (() => {
    if (typeof require === 'function') {
      try { return require('./status-contract'); } catch (_) { /* browser/importScripts fallback below */ }
    }
    return {};
  })();

  const SUCCESS_STATUSES = Object.freeze(Array.from(STATUS_CONTRACT.SUCCESS_STATUSES || [
    'COPY_SUCCESS', 'SUCCESS', 'DONE', 'COMPLETE', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN'
  ]));
  const FAILURE_STATUSES = Object.freeze(Array.from(STATUS_CONTRACT.FAILURE_STATUSES || [
    'ERROR', 'CRITICAL_ERROR', 'RECOVERABLE_ERROR', 'UNRESPONSIVE', 'CIRCUIT_OPEN',
    'API_FAILED', 'NO_SEND', 'EXTRACT_FAILED', 'STREAM_TIMEOUT',
    'EXTERNAL_LLM_FAILURE', 'USER_ACTION_REQUIRED', 'UNCERTAIN'
  ]));
  const TERMINAL_STATUSES = Object.freeze(Array.from(STATUS_CONTRACT.TERMINAL_STATUSES || [
    ...SUCCESS_STATUSES,
    ...FAILURE_STATUSES.filter((status) => status !== 'RECOVERABLE_ERROR')
  ]));

  const STATUS_RANK = Object.freeze({
    SUCCESS: 4,
    COPY_SUCCESS: 4,
    DONE: 4,
    COMPLETE: 4,
    PARTIAL: 3,
    STREAM_TIMEOUT_HIDDEN: 3,
    STREAM_TIMEOUT: 3,
    ERROR: 2,
    RECOVERABLE_ERROR: 2,
    CRITICAL_ERROR: 2,
    UNRESPONSIVE: 2,
    CIRCUIT_OPEN: 2,
    API_FAILED: 2,
    EXTRACT_FAILED: 2,
    EXTERNAL_LLM_FAILURE: 2,
    USER_ACTION_REQUIRED: 2,
    UNCERTAIN: 2,
    NO_SEND: 1
  });

  function normalizeStatus(status) {
    if (typeof STATUS_CONTRACT.normalizeStatus === 'function') {
      return STATUS_CONTRACT.normalizeStatus(status);
    }
    return String(status || '').trim().toUpperCase();
  }

  function getStatusRank(status) {
    if (typeof STATUS_CONTRACT.getStatusRank === 'function') {
      return STATUS_CONTRACT.getStatusRank(status);
    }
    return Number(STATUS_RANK[normalizeStatus(status)] || 0);
  }

  function isTerminalStatus(status) {
    if (typeof STATUS_CONTRACT.isTerminalStatus === 'function') {
      return STATUS_CONTRACT.isTerminalStatus(status);
    }
    return TERMINAL_STATUSES.includes(normalizeStatus(status));
  }

  function isSuccessStatus(status) {
    if (typeof STATUS_CONTRACT.isSuccessStatus === 'function') {
      return STATUS_CONTRACT.isSuccessStatus(status);
    }
    return SUCCESS_STATUSES.includes(normalizeStatus(status));
  }

  function isFailureStatus(status) {
    if (typeof STATUS_CONTRACT.isFailureStatus === 'function') {
      return STATUS_CONTRACT.isFailureStatus(status);
    }
    return FAILURE_STATUSES.includes(normalizeStatus(status));
  }

  function buildDecision(action, reason, details = {}) {
    return {
      ok: action === 'accept' || action === 'keep_locked_status',
      action,
      reason,
      allowTerminalUpgrade: false,
      finalStatusOverride: null,
      ...details
    };
  }

  function resolveLockedStatus(entry = {}) {
    const lockedStatus = normalizeStatus(entry.finalStatus || entry.status || '');
    const locked = Boolean(entry.finalStatusRecorded && lockedStatus && isTerminalStatus(lockedStatus));
    return locked ? lockedStatus : '';
  }

  function tryFinalize(entry = {}, candidate = {}) {
    const incomingStatus = normalizeStatus(candidate.finalStatus || candidate.status || '');
    if (!incomingStatus || !isTerminalStatus(incomingStatus)) {
      return buildDecision('reject', 'incoming_not_terminal', { incomingStatus });
    }

    const lockedFinalStatus = resolveLockedStatus(entry);
    const hasLockedTerminal = !!lockedFinalStatus;
    const incomingRank = getStatusRank(incomingStatus);
    const lockedRank = getStatusRank(lockedFinalStatus);
    const incomingIsSuccess = isSuccessStatus(incomingStatus);
    const incomingIsFailure = isFailureStatus(incomingStatus);
    const lockedIsSuccess = isSuccessStatus(lockedFinalStatus);
    const lockedIsFailure = isFailureStatus(lockedFinalStatus);
    const manualTerminalOverride = !!candidate.allowManualTerminalOverride;

    const base = {
      incomingStatus,
      lockedFinalStatus,
      incomingRank,
      lockedRank,
      dispatchId: candidate.dispatchId || null
    };

    if (!hasLockedTerminal) {
      return buildDecision('accept', 'open_terminal_slot', base);
    }

    if (
      manualTerminalOverride
      && incomingIsSuccess
      && incomingRank > 0
      && incomingRank < lockedRank
    ) {
      return buildDecision('keep_locked_status', 'manual_recovery_kept_locked_status', {
        ...base,
        finalStatusOverride: lockedFinalStatus
      });
    }

    if (lockedIsSuccess && incomingIsFailure && !manualTerminalOverride) {
      return buildDecision('ignore', 'terminal_success_locked', base);
    }

    if (incomingRank > 0 && incomingRank < lockedRank && !manualTerminalOverride) {
      return buildDecision('ignore', 'terminal_rank_downgrade', base);
    }

    if (lockedIsFailure && incomingIsSuccess && candidate.allowRecoveredFinalOverride) {
      return buildDecision('accept', 'terminal_failure_upgraded_by_recovered_answer', {
        ...base,
        allowTerminalUpgrade: true
      });
    }

    if (incomingRank > lockedRank) {
      return buildDecision('accept', 'terminal_rank_upgrade', {
        ...base,
        allowTerminalUpgrade: true
      });
    }

    if (incomingStatus === lockedFinalStatus) {
      const lockedDispatchId = entry.confirmedDispatchId || entry.lastDispatchMeta?.dispatchId || null;
      const incomingDispatchId = candidate.dispatchId || null;
      const dispatchMatches = !incomingDispatchId || !lockedDispatchId || incomingDispatchId === lockedDispatchId;
      const previousAnswer = String(entry.answer || '').trim();
      const incomingAnswer = String(candidate.trimmedAnswer || '').trim();
      const answerIsDuplicate = !incomingAnswer || incomingAnswer === previousAnswer || previousAnswer.length >= incomingAnswer.length;
      if (dispatchMatches && answerIsDuplicate && !manualTerminalOverride) {
        return buildDecision('ignore', 'duplicate_terminal', {
          ...base,
          dispatchId: incomingDispatchId || lockedDispatchId || null,
          lockedDispatchId
        });
      }
    }

    return buildDecision('accept', hasLockedTerminal ? 'terminal_reaccepted_without_state_change' : 'open_terminal_slot', base);
  }

  const api = Object.freeze({
    tryFinalize,
    normalizeStatus,
    getStatusRank,
    isTerminalStatus,
    isSuccessStatus,
    isFailureStatus
  });

  root.FinalizationController = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
