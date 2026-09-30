// shared/transport-contract.js
// Single source of truth for the browser transport contract between the
// Pipeline panel and the background: request identity, terminal status
// classification and the panel wait deadline. Loaded by extension pages and by
// the background service worker (see background/index.js).
(function initTransportContract(root) {
  'use strict';

  const VERSION = '1.0.0';

  // Final statuses the background can publish for a model (handleLLMResponse /
  // deriveFailureFinalStatus) plus legacy terminal aliases seen in messages.
  const COMPLETE_STATUSES = Object.freeze(['SUCCESS', 'DONE', 'FINAL', 'COPY_SUCCESS', 'COMPLETE']);
  const PARTIAL_STATUSES = Object.freeze(['PARTIAL', 'STREAM_TIMEOUT', 'STREAM_TIMEOUT_HIDDEN', 'TIMEOUT']);
  const FAILED_STATUSES = Object.freeze([
    'ERROR', 'CRITICAL_ERROR', 'FAILED', 'NO_SEND', 'EXTRACT_FAILED', 'EXTERNAL_LLM_FAILURE',
    'UNCERTAIN', 'USER_ACTION_REQUIRED', 'CIRCUIT_OPEN', 'UNRESPONSIVE'
  ]);
  const CANCELLED_STATUSES = Object.freeze(['CANCELLED', 'STOPPED']);
  const TERMINAL_STATUSES = Object.freeze([
    ...COMPLETE_STATUSES, ...PARTIAL_STATUSES, ...FAILED_STATUSES, ...CANCELLED_STATUSES
  ]);

  const COMPLETION = Object.freeze({
    COMPLETE: 'complete',
    PARTIAL: 'partial',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    PENDING: 'pending'
  });

  const normalizeStatus = (value) => String(value || '').trim().toUpperCase();
  const has = (list, status) => list.includes(status);

  function isTerminalStatus(status) {
    return has(TERMINAL_STATUSES, normalizeStatus(status));
  }

  // Status and text are independent facts: text may exist for a failed or
  // incomplete generation, and a complete status may carry no usable text.
  function classifyCompletion(status, text = '') {
    const normalized = normalizeStatus(status);
    const hasText = String(text || '').trim().length > 0;
    if (has(CANCELLED_STATUSES, normalized)) return COMPLETION.CANCELLED;
    if (has(FAILED_STATUSES, normalized)) return hasText ? COMPLETION.PARTIAL : COMPLETION.FAILED;
    if (has(PARTIAL_STATUSES, normalized)) return hasText ? COMPLETION.PARTIAL : COMPLETION.FAILED;
    if (has(COMPLETE_STATUSES, normalized)) return hasText ? COMPLETION.COMPLETE : COMPLETION.FAILED;
    return COMPLETION.PENDING;
  }

  // Content-side generation limits (content-scripts/pipeline-config.js
  // streaming.adaptiveTimeout.hardMax and preparation.streamStartTimeout).
  // tests/transport-contract.test.js keeps these numbers in sync.
  const CONTENT_LIMITS_MS = Object.freeze({
    standard: Object.freeze({ hardMax: 450000, streamStart: 45000 }),
    long: Object.freeze({ hardMax: 900000, streamStart: 90000 })
  });
  // Dispatch queueing (serialized focus), finalization stability checks and
  // background delivery on top of the content generation limit.
  const PANEL_WAIT_MARGIN_MS = 120000;

  // The panel must never give up before the tab itself can finish: otherwise a
  // legitimate long answer is lost to the pipeline while the tab still waits.
  function resolvePanelWaitTimeoutMs(profile = 'standard', requestedMs = 0) {
    const limits = profile === 'long' ? CONTENT_LIMITS_MS.long : CONTENT_LIMITS_MS.standard;
    const floor = limits.hardMax + limits.streamStart + PANEL_WAIT_MARGIN_MS;
    const requested = Number(requestedMs) || 0;
    return Math.max(floor, requested);
  }

  function makeTransportRequestId() {
    try {
      if (root.crypto?.randomUUID) return `treq-${root.crypto.randomUUID()}`;
    } catch (_) {}
    return `treq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  const api = Object.freeze({
    VERSION,
    COMPLETION,
    COMPLETE_STATUSES,
    PARTIAL_STATUSES,
    FAILED_STATUSES,
    CANCELLED_STATUSES,
    TERMINAL_STATUSES,
    CONTENT_LIMITS_MS,
    PANEL_WAIT_MARGIN_MS,
    normalizeStatus,
    isTerminalStatus,
    classifyCompletion,
    resolvePanelWaitTimeoutMs,
    makeTransportRequestId
  });

  root.TransportContract = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
