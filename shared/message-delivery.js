// shared/message-delivery.js
// End-to-end delivery proof for model messages. Every outgoing prompt carries a per-model token
// that the model repeats on its last line. An incoming answer is:
//   verified — contains its own token;
//   missing  — final answer without the token (shown, marked "attribution unverified");
//   foreign  — contains another request's token (a stale answer: not shown).
// The token is secondary evidence: request ownership is decided by transportRequestId
// (TransportContract). Tokens are registered per transport request, so preparing a new
// request never invalidates the token of a request that is still in flight.
// Only our own transport tags are removed; the answer content is never rewritten otherwise.
// The journal is mirrored to chrome.storage.session for the telemetry window (Automation tab).
(function initMessageDelivery(root) {
  'use strict';

  const JOURNAL_KEY = 'messageDelivery.journal';
  // A multi-stage run of ten models produces ~20 events per message.
  const JOURNAL_LIMIT = 3000;
  const EXPECTED_LIMIT = 200;
  const TOKEN_RE = /\[\[AO-[a-z0-9]{6}\]\]/gi;
  const INSTRUCTION = 'Последней строкой ответа напиши только метку';
  const INSTRUCTION_RE = new RegExp(`^.*${INSTRUCTION}.*$`, 'gim');
  // Only the judge-prompt response delimiters (shared/judge-prompt-builder.js) are
  // transport tags. Generic <<<...>>> is user content (CUDA launches, templates).
  const RESPONSE_MARKER_RE = /(?:<<<|&lt;&lt;&lt;)RESPONSE [^\n<>&]{1,200}? (?:START|END)(?:>>>|&gt;&gt;&gt;)/g;

  const expectedByRequest = new Map(); // transportRequestId -> entry
  const latestByModel = new Map(); // model -> entry (requests without a transport id)
  const journal = [];
  let mirrorTimer = null;

  function makeToken() {
    const bytes = new Uint8Array(6);
    (root.crypto || globalThis.crypto).getRandomValues(bytes);
    return `AO-${Array.from(bytes, (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('')}`;
  }

  const tag = (token) => `[[${token}]]`;

  function wrap(prompt, token) {
    return `${String(prompt || '').trimEnd()}\n\n${INSTRUCTION} ${tag(token)}`;
  }

  function clean(text) {
    return String(text || '')
      .replace(TOKEN_RE, '')
      .replace(INSTRUCTION_RE, '')
      .replace(RESPONSE_MARKER_RE, '')
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // HTML answers: the same tags appear as plain text inside the markup.
  function cleanHtml(html) {
    return String(html || '')
      .replace(TOKEN_RE, '')
      .replace(RESPONSE_MARKER_RE, '')
      .replace(/<(p|div|li)[^>]*>\s*(?:<br\s*\/?>)?\s*<\/\1>/gi, '');
  }

  function inspect(text, token) {
    const found = String(text || '').match(TOKEN_RE) || [];
    if (!token) return 'untracked';
    if (found.some((value) => value.toLowerCase() === tag(token).toLowerCase())) return 'verified';
    return found.length ? 'foreign' : 'missing';
  }

  function record(event) {
    journal.push({ at: new Date().toISOString(), ...event });
    if (journal.length > JOURNAL_LIMIT) journal.splice(0, journal.length - JOURNAL_LIMIT);
    const storage = root.chrome?.storage?.session;
    if (!storage) return;
    clearTimeout(mirrorTimer);
    mirrorTimer = setTimeout(() => { try { storage.set({ [JOURNAL_KEY]: journal }); } catch (_) { /* telemetry only */ } }, 300);
  }

  const completionOf = (status, text) => {
    const contract = root.TransportContract || globalThis.TransportContract;
    return contract?.classifyCompletion ? contract.classifyCompletion(status, text) : null;
  };

  const requestIdOf = (message) => String(message?.transportRequestId || message?.metadata?.transportRequestId || '') || null;

  function pruneExpected() {
    if (expectedByRequest.size <= EXPECTED_LIMIT) return;
    const overflow = expectedByRequest.size - EXPECTED_LIMIT;
    Array.from(expectedByRequest.keys()).slice(0, overflow).forEach((key) => expectedByRequest.delete(key));
  }

  // Outgoing: one token per model; returns the per-model prompt map to dispatch.
  // The journal records 'prepared': nothing has been sent yet at this point.
  function prepare({ prompt, promptsByModel, models, batchId = '', requestIds = null }) {
    const out = {};
    models.forEach((model) => {
      const token = makeToken();
      const base = promptsByModel?.[model] ?? prompt;
      const requestId = String(requestIds?.[model] || '') || null;
      out[model] = wrap(base, token);
      const entry = { token, sentAt: Date.now(), batchId, final: false, model, requestId };
      if (requestId) expectedByRequest.set(requestId, entry);
      latestByModel.set(model, entry);
      record({ kind: 'prepared', model, token, batchId, requestId, chars: out[model].length });
    });
    pruneExpected();
    return out;
  }

  function entryFor(message) {
    const requestId = requestIdOf(message);
    if (requestId) return expectedByRequest.get(requestId) || null;
    const model = message?.llmName;
    return model ? latestByModel.get(model) || null : null;
  }

  function cleanMessage(message, metadata, { tracked = true } = {}) {
    const answer = message.answer && typeof message.answer === 'object'
      ? String(message.answer.text || message.answer.answer || '')
      : String(message.answer || '');
    const cleaned = { ...message };
    if (tracked || message.metadata) cleaned.metadata = metadata;
    if (message.answer && typeof message.answer === 'object') {
      cleaned.answer = { ...message.answer, text: clean(answer), html: cleanHtml(message.answer.html || message.answer.answerHtml || '') };
    } else {
      cleaned.answer = clean(answer);
    }
    if (message.answerHtml) cleaned.answerHtml = cleanHtml(message.answerHtml);
    if (message.html) cleaned.html = cleanHtml(message.html);
    return cleaned;
  }

  // Incoming: returns null when the message must be dropped (stale answer),
  // otherwise the message with cleaned text/html and attribution metadata.
  function receive(message, { final = false } = {}) {
    if (!message) return message;
    const entry = entryFor(message);
    // Unknown request (e.g. the panel was reloaded): still strip our transport
    // tags so a token never leaks into the feed or into the next stage prompt.
    if (!entry) return cleanMessage(message, { ...(message.metadata || {}) }, { tracked: false });
    const model = message.llmName;
    const answer = message.answer && typeof message.answer === 'object'
      ? String(message.answer.text || message.answer.answer || '')
      : String(message.answer || '');
    const state = inspect(answer, entry.token);
    if (state === 'foreign') {
      if (!entry.staleLogged) { entry.staleLogged = true; record({ kind: 'stale_dropped', model, token: entry.token, requestId: entry.requestId, chars: answer.length }); }
      return null;
    }
    const metadata = { ...(message.metadata || {}) };
    if (answer.trim() && !entry.firstText) {
      entry.firstText = true;
      record({ kind: 'first_text', model, token: entry.token, requestId: entry.requestId, chars: answer.length, ms: Date.now() - entry.sentAt });
    }
    if (final && !entry.final) {
      entry.final = true;
      const kind = !answer.trim() ? 'empty_answer' : state === 'verified' ? 'verified' : 'missing_token';
      const status = String(message.status || metadata.status || metadata.finalStatus || '');
      entry.finalKind = kind;
      record({
        kind, model, token: entry.token, requestId: entry.requestId, chars: answer.length, ms: Date.now() - entry.sentAt,
        status,
        completion: completionOf(status || (answer.trim() ? 'SUCCESS' : 'FAILED'), answer),
        dispatchId: message.dispatchId || metadata.dispatchId || null,
        source: String(metadata.source || metadata.answerSource || 'live'),
        reason: String(metadata.reason || metadata.completionReason || metadata.failureClass || metadata.hardStopReason || '')
      });
    } else if (final && entry.final && entry.finalKind === 'empty_answer' && answer.trim()) {
      // A usable answer upgraded an earlier empty/failed terminal of the same request.
      const status = String(message.status || metadata.status || metadata.finalStatus || '');
      entry.finalKind = state === 'verified' ? 'verified' : 'missing_token';
      record({
        kind: entry.finalKind, model, token: entry.token, requestId: entry.requestId, chars: answer.length, ms: Date.now() - entry.sentAt,
        status, completion: completionOf(status || 'SUCCESS', answer), dispatchId: message.dispatchId || metadata.dispatchId || null,
        source: String(metadata.source || metadata.answerSource || 'live'), reason: 'upgraded_after_failure'
      });
    } else if (final && entry.final && metadata.revision === true) {
      record({ kind: 'revision', model, token: entry.token, requestId: entry.requestId, chars: answer.length, reason: String(metadata.reason || '') });
    }
    if (final && state === 'missing') {
      metadata.attributionState = 'unproven';
      metadata.attributionLabel = 'Без метки доставки';
    }
    return cleanMessage(message, metadata);
  }

  // Runtime facts the background already broadcasts: model statuses, opened tabs,
  // dispatch phases (TRANSPORT_DISPATCH_PHASE) and provider stop results.
  function observeRuntime(message) {
    if (!message) return;
    if (message.type === 'TRANSPORT_DISPATCH_PHASE') {
      const entry = entryFor(message);
      record({
        kind: 'dispatch', model: message.llmName, token: entry?.token || null, requestId: requestIdOf(message),
        phase: String(message.phase || ''), dispatchId: message.dispatchId || null, tabId: message.tabId ?? null,
        reason: message.reason || null, dispatchReason: message.dispatchReason || null, attempt: message.attempt ?? null,
        ms: entry ? Date.now() - entry.sentAt : null
      });
      return;
    }
    if (message.type === 'PROVIDER_STOP_RESULT') {
      const entry = latestByModel.get(message.llmName);
      record({ kind: 'provider_stop', model: message.llmName || null, token: entry?.token || null, requestId: entry?.requestId || null, stopped: message.stopped === true, reason: message.reason || null });
      return;
    }
    if (message.type === 'STATUS_UPDATE') {
      const entry = latestByModel.get(message.llmName);
      const status = String(message.status || '').toUpperCase();
      if (!entry || entry.final || !status || entry.lastStatus === status) return;
      entry.lastStatus = status;
      record({ kind: 'status', model: message.llmName, token: entry.token, requestId: entry.requestId, status });
    } else if (message.type === 'GLOBAL_STATE_BROADCAST') {
      const map = message.state?.tabs?.map || {};
      latestByModel.forEach((entry, model) => {
        if (entry.tabSeen || entry.final || !Number.isInteger(map[model])) return;
        entry.tabSeen = true;
        record({ kind: 'tab', model, token: entry.token, requestId: entry.requestId, tabId: map[model], ms: Date.now() - entry.sentAt });
      });
    }
  }

  // The batch finished waiting: models that never produced a final answer.
  function closeBatch({ models = [], timedOut = false, failed = {}, requestIds = null, cancelled = false, reason = '' } = {}) {
    models.forEach((model) => {
      const requestId = String(requestIds?.[model] || '') || null;
      const entry = requestId ? expectedByRequest.get(requestId) : latestByModel.get(model);
      if (!entry || entry.final) return;
      entry.final = true;
      record({
        kind: cancelled ? 'cancelled' : 'no_answer', model, token: entry.token, requestId: entry.requestId,
        ms: Date.now() - entry.sentAt, timedOut, status: String(failed[model] || ''), reason: String(reason || '')
      });
    });
  }

  // Batch-level facts from the panel (start, refusals, acceptance, outcome) and
  // answers the panel refused for their identity. Not tied to one token.
  function batchEvent(kind, fields = {}) {
    record({ kind, ...fields });
  }

  // Clears only the journal; tokens of requests still in flight stay valid.
  function clearJournal() {
    journal.length = 0;
    try { root.chrome?.storage?.session?.remove(JOURNAL_KEY); } catch (_) { /* ignore */ }
  }

  function reset() {
    expectedByRequest.clear();
    latestByModel.clear();
    journal.length = 0;
    try { root.chrome?.storage?.session?.remove(JOURNAL_KEY); } catch (_) { /* ignore */ }
  }

  // A page load starts a new session: the previous journal is not carried over.
  try { root.chrome?.storage?.session?.remove(JOURNAL_KEY); } catch (_) { /* ignore */ }

  const api = Object.freeze({ JOURNAL_KEY, makeToken, wrap, clean, cleanHtml, inspect, prepare, receive, observeRuntime, closeBatch, batchEvent, record, clearJournal, reset, journal: () => journal.slice() });
  root.MessageDelivery = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
