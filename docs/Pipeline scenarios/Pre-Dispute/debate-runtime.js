// Generic UI-facing runtime projection. Execution is owned by DebateOrchestrator.
(function initDebateRuntime(root) {
  'use strict';
  const TERMINAL = new Set(['completed', 'error', 'cancelled']);
  function createState(overrides = {}) {
    return {
      active: false, status: 'idle', phase: 'idle', participants: [], eventLog: [],
      ...overrides
    };
  }
  const setStatus = (state, status, active = !TERMINAL.has(status)) => {
    if (state) { state.status = status; state.active = active; }
    return state;
  };
  const mapMessageStatusToTurnStatus = (message = {}) => {
    const status = String(message.status || message.metadata?.status || '').toUpperCase();
    if (status === 'APPROVED') return 'approved';
    if (status === 'REJECTED') return 'rejected';
    if (status === 'PRINTING') return 'streaming';
    if (message.failed || ['ERROR', 'FAILED'].includes(status)) return 'failed';
    if (['SUCCESS', 'COMPLETED'].includes(status)) return 'accepted';
    if (['CANCELLED', 'ABORTED'].includes(status)) return 'cancelled';
    return 'pending';
  };
  const normalizeBoolean = (value) => value === true || value === 'true';
  const normalizeKind = (value, fallback = 'answer') => String(value || fallback).trim().toLowerCase() || fallback;
  const api = Object.freeze({
    createState, mapMessageStatusToTurnStatus, normalizeBoolean, normalizeKind,
    turnKind: (turn = {}) => normalizeKind(turn.kind || turn.type),
    turnStatus: (turn = {}) => String(turn.status || mapMessageStatusToTurnStatus(turn)),
    markRunning: (state) => setStatus(state, 'running', true),
    markPaused: (state) => setStatus(state, 'paused', true),
    markPausedByModerator: (state) => setStatus(state, 'paused', true),
    markTechnicalPause: (state) => setStatus(state, 'technical_pause', true),
    markCompleted: (state) => setStatus(state, 'completed', false),
    markCompletedByModerator: (state) => setStatus(state, 'completed', false),
    markError: (state) => setStatus(state, 'error', false),
    markCancelled: (state) => setStatus(state, 'cancelled', false),
    canRoutePublic: () => false
  });
  root.DebateFSM = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
