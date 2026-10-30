// shared/run-error.js
// Structured run error contract shared by background and results UI.
(function initRunError(root) {
  'use strict';

  const CODES = Object.freeze({
    TAB_INVALID: 'tab_invalid',
    TAB_CLOSED: 'tab_closed',
    CONNECTION_FAILED: 'connection_failed',
    CIRCUIT_OPEN: 'circuit_open',
    RATE_LIMIT: 'rate_limit',
    CAPTCHA: 'captcha_detected',
    SUBMIT_TIMEOUT: 'submit_timeout',
    EMPTY_RESPONSE: 'empty_response',
    FALLBACK_UNAVAILABLE: 'fallback_unavailable',
    FALLBACK_FAILED: 'fallback_failed',
    RUN_CANCELLED: 'run_cancelled',
    DUPLICATE_DISPATCH: 'duplicate_dispatch',
    // Basic participant chat (R01, R06): the request is refused before the send, nothing is sent.
    PARTICIPANT_CHAT_LOST: 'participant_chat_lost',
    PARTICIPANT_BINDING_FAILED: 'participant_binding_failed',
    PARTICIPANT_API_UNSUPPORTED: 'participant_api_unsupported',
    UNKNOWN: 'unknown'
  });

  const RECOVERABLE = new Set([CODES.CONNECTION_FAILED, CODES.RATE_LIMIT, CODES.SUBMIT_TIMEOUT, CODES.TAB_CLOSED]);

  function makeRunError(code, message = '', meta = null) {
    const normalized = Object.values(CODES).includes(code) ? code : CODES.UNKNOWN;
    return {
      ok: false,
      type: normalized,
      errorCode: normalized,
      message: String(message || ''),
      recoverable: RECOVERABLE.has(normalized),
      meta: meta && typeof meta === 'object' ? meta : null
    };
  }

  function isRunError(value) {
    return !!value && typeof value === 'object' && value.ok === false && typeof value.errorCode === 'string';
  }

  const api = Object.freeze({ CODES, makeRunError, isRunError });
  root.RunError = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
