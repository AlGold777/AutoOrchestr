// Shared privacy-safe normalization and payload identity for proof telemetry.
(function initAnswerProofNormalization(root) {
  'use strict';

  const VERSION = 'answer-proof-normalization@1.0.0';

  function normalizeText(value = '') {
    const source = String(value ?? '');
    const unicode = typeof source.normalize === 'function' ? source.normalize('NFKC') : source;
    return unicode
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function hashNormalizedText(normalizedText = '') {
    const text = String(normalizedText || '');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  function hashText(value = '') {
    return hashNormalizedText(normalizeText(value));
  }

  function safeIdentityPart(value) {
    return String(value ?? '').trim().replace(/[^a-zA-Z0-9:._-]+/g, '_').slice(0, 180);
  }

  function evidence(value = '', identity = {}) {
    const normalized = normalizeText(value);
    const hash = normalized ? hashNormalizedText(normalized) : null;
    const dispatchId = safeIdentityPart(identity.dispatchId);
    const attemptId = safeIdentityPart(identity.attemptId || identity.sourceRevisionId);
    const payloadEvidenceId = dispatchId && attemptId && hash
      ? `payload:${dispatchId}:${attemptId}:${hash.slice(-8)}`
      : null;
    return Object.freeze({
      normalizationVersion: VERSION,
      normalizedLength: normalized.length,
      normalizedHash: hash,
      payloadEvidenceId
    });
  }

  function compare(left = {}, right = {}) {
    if (!left.normalizationVersion || !right.normalizationVersion) {
      return { status: 'incomparable', reason: 'normalization_version_missing' };
    }
    if (left.normalizationVersion !== right.normalizationVersion) {
      return { status: 'incomparable', reason: 'normalization_version_mismatch' };
    }
    if (!left.normalizedHash || !right.normalizedHash) {
      return { status: 'incomparable', reason: 'normalized_hash_missing' };
    }
    return left.normalizedHash === right.normalizedHash
      ? { status: 'matched', reason: null }
      : { status: 'mismatched', reason: 'normalized_hash_mismatch' };
  }

  const api = Object.freeze({ VERSION, normalizeText, hashNormalizedText, hashText, evidence, compare });
  root.AnswerProofNormalization = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
