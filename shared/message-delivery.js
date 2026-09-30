// shared/message-delivery.js
// End-to-end delivery proof for model messages. Every outgoing prompt carries a per-model token
// that the model repeats on its last line. An incoming answer is:
//   verified — contains its own token;
//   missing  — final answer without the token (shown, marked "attribution unverified");
//   foreign  — contains another request's token (a stale answer: not shown).
// Tokens and other transport tags are removed before anything reaches the feed.
// The journal is mirrored to chrome.storage.session for the telemetry window (Automation tab).
(function initMessageDelivery(root) {
  'use strict';

  const JOURNAL_KEY = 'messageDelivery.journal';
  const JOURNAL_LIMIT = 500;
  const TOKEN_RE = /\[\[AO-[a-z0-9]{6}\]\]/gi;
  const INSTRUCTION = 'Последней строкой ответа напиши только метку';
  const INSTRUCTION_RE = new RegExp(`^.*${INSTRUCTION}.*$`, 'gim');
  const ANGLE_MARKER_RE = /(?:<<<|&lt;&lt;&lt;)[^\n]*?(?:>>>|&gt;&gt;&gt;)/g;

  const expected = new Map(); // model -> { token, sentAt, batchId }
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
      .replace(ANGLE_MARKER_RE, '')
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // HTML answers: the same tags appear as plain text inside the markup.
  function cleanHtml(html) {
    return String(html || '')
      .replace(TOKEN_RE, '')
      .replace(ANGLE_MARKER_RE, '')
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

  // Outgoing: one token per model; returns the per-model prompt map to dispatch.
  function prepare({ prompt, promptsByModel, models, batchId = '' }) {
    const out = {};
    models.forEach((model) => {
      const token = makeToken();
      const base = promptsByModel?.[model] ?? prompt;
      out[model] = wrap(base, token);
      expected.set(model, { token, sentAt: Date.now(), batchId, final: false });
      record({ kind: 'sent', model, token, batchId, chars: out[model].length });
    });
    return out;
  }

  // Incoming: returns null when the message must be dropped (stale answer),
  // otherwise the message with cleaned text/html and attribution metadata.
  function receive(message, { final = false } = {}) {
    const model = message?.llmName;
    const entry = model ? expected.get(model) : null;
    if (!entry) return message;
    const answer = message.answer && typeof message.answer === 'object'
      ? String(message.answer.text || message.answer.answer || '')
      : String(message.answer || '');
    const state = inspect(answer, entry.token);
    if (state === 'foreign') {
      if (!entry.staleLogged) { entry.staleLogged = true; record({ kind: 'stale_dropped', model, token: entry.token, chars: answer.length }); }
      return null;
    }
    const metadata = { ...(message.metadata || {}) };
    if (final && !entry.final) {
      entry.final = true;
      record({ kind: state === 'verified' ? 'verified' : 'missing_token', model, token: entry.token, chars: answer.length, ms: Date.now() - entry.sentAt });
    }
    if (final && state === 'missing') {
      metadata.attributionState = 'unproven';
      metadata.attributionLabel = 'Без метки доставки';
    }
    const cleaned = { ...message, metadata };
    if (message.answer && typeof message.answer === 'object') {
      cleaned.answer = { ...message.answer, text: clean(answer), html: cleanHtml(message.answer.html || message.answer.answerHtml || '') };
    } else {
      cleaned.answer = clean(answer);
    }
    if (message.answerHtml) cleaned.answerHtml = cleanHtml(message.answerHtml);
    if (message.html) cleaned.html = cleanHtml(message.html);
    return cleaned;
  }

  function reset() {
    expected.clear();
    journal.length = 0;
    try { root.chrome?.storage?.session?.remove(JOURNAL_KEY); } catch (_) { /* ignore */ }
  }

  // A page load starts a new session: the previous journal is not carried over.
  try { root.chrome?.storage?.session?.remove(JOURNAL_KEY); } catch (_) { /* ignore */ }

  const api = Object.freeze({ JOURNAL_KEY, makeToken, wrap, clean, cleanHtml, inspect, prepare, receive, record, reset, journal: () => journal.slice() });
  root.MessageDelivery = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
