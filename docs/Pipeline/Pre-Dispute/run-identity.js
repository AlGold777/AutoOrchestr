// shared/run-identity.js
// Minimal run/dispatch identity contract for stale event quarantine.

(function initRunIdentity(root) {
  'use strict';

  function hashText(value = '') {
    const text = String(value || '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function normalizeNumber(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function build(input = {}) {
    const runSessionId = normalizeNumber(input.runSessionId || input.sessionId);
    const dispatchId = input.dispatchId ? String(input.dispatchId) : null;
    const tabId = normalizeNumber(input.tabId);
    const promptHash = input.promptHash || (input.prompt ? hashText(input.prompt) : null);
    return {
      schemaVersion: 1,
      runSessionId,
      dispatchId,
      tabId,
      promptHash,
      contentScriptInstanceId: input.contentScriptInstanceId || null,
      navigationSeq: normalizeNumber(input.navigationSeq),
      createdAt: normalizeNumber(input.createdAt) || Date.now()
    };
  }

  function validateEvent(entry = {}, event = {}, expected = {}) {
    const expectedRunSessionId = normalizeNumber(expected.runSessionId || entry.runIdentity?.runSessionId);
    const incomingRunSessionId = normalizeNumber(event.runSessionId || event.sessionId);
    if (expectedRunSessionId && incomingRunSessionId && incomingRunSessionId !== expectedRunSessionId) {
      return {
        ok: false,
        reason: 'stale_run_session',
        expectedRunSessionId,
        incomingRunSessionId
      };
    }

    const incomingDispatchId = event.dispatchId ? String(event.dispatchId) : null;
    const expectedDispatchId = expected.dispatchId || entry.runIdentity?.dispatchId || entry.lastDispatchMeta?.dispatchId || null;
    const recentDispatchIds = Array.isArray(entry.recentDispatchIds) ? entry.recentDispatchIds.filter(Boolean).map(String) : [];
    if (incomingDispatchId && expectedDispatchId && incomingDispatchId !== String(expectedDispatchId)) {
      return {
        ok: false,
        reason: 'stale_dispatch',
        expectedDispatchId,
        incomingDispatchId,
        recentDispatchIds
      };
    }
    if (expected.requireDispatchId === true && expectedDispatchId && !incomingDispatchId) {
      return {
        ok: false,
        reason: 'missing_dispatch_identity',
        expectedDispatchId,
        incomingDispatchId: null,
        recentDispatchIds
      };
    }

    const incomingTabId = normalizeNumber(event.tabId);
    const expectedTabId = normalizeNumber(expected.tabId || entry.runIdentity?.tabId || entry.tabId);
    if (incomingTabId && expectedTabId && incomingTabId !== expectedTabId && event.allowTabMismatch !== true) {
      return {
        ok: false,
        reason: 'stale_tab',
        expectedTabId,
        incomingTabId
      };
    }

    return {
      ok: true,
      reason: 'identity_accepted',
      expectedRunSessionId,
      incomingRunSessionId,
      expectedDispatchId,
      incomingDispatchId,
      expectedTabId,
      incomingTabId
    };
  }

  const api = Object.freeze({
    build,
    validateEvent,
    hashText
  });

  root.RunIdentity = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
