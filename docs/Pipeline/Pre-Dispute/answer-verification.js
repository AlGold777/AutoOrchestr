// Shared answer-completeness, stage-timeline and revision helpers.
(function initAnswerVerification(root) {
  'use strict';

  const ProofNormalization = root.AnswerProofNormalization || (() => {
    try { return typeof require === 'function' ? require('./answer-proof-normalization.js') : null; } catch (_) { return null; }
  })();

  const VERIFICATION_STATES = Object.freeze({
    NONE: 'none',
    CANDIDATE: 'candidate',
    STABLE: 'stable',
    VERIFIED: 'verified',
    PARTIAL: 'partial',
    REJECTED: 'rejected'
  });
  const MAX_TIMELINE = 120;
  const MAX_REVISIONS = 30;
  const REQUIRED_IDENTITY_KEYS = Object.freeze(['runSessionId', 'dispatchId', 'generationEpoch', 'turnAnchor']);

  function normalizeText(value = '') {
    return ProofNormalization?.normalizeText
      ? ProofNormalization.normalizeText(value)
      : String(value || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  function hashText(value = '') {
    if (ProofNormalization?.hashText) return ProofNormalization.hashText(value);
    const text = normalizeText(value);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function safeDetails(details = {}) {
    if (!details || typeof details !== 'object') return {};
    const next = {};
    Object.entries(details).slice(0, 20).forEach(([key, value]) => {
      if (/^(answer|text|html|prompt|content)$/i.test(key)) return;
      if (typeof value === 'string') next[key] = value.slice(0, 240);
      else if (typeof value === 'number' || typeof value === 'boolean' || value == null) next[key] = value;
    });
    return next;
  }

  function appendTimeline(entry, event = {}) {
    if (!entry || typeof entry !== 'object') return null;
    const item = {
      stage: String(event.stage || 'unknown').toLowerCase(),
      state: event.state ? String(event.state).toLowerCase() : null,
      ts: Number(event.ts || Date.now()),
      runSessionId: event.runSessionId || entry.modelRunState?.runSessionId || null,
      dispatchId: event.dispatchId || entry.confirmedDispatchId || entry.lastDispatchMeta?.dispatchId || null,
      generationEpoch: Number(event.generationEpoch || entry.generationEpoch || 0) || null,
      tabId: event.tabId || entry.tabId || null,
      source: event.source || null,
      details: safeDetails(event.details)
    };
    entry.stageTimeline = Array.isArray(entry.stageTimeline) ? entry.stageTimeline : [];
    const previous = entry.stageTimeline[entry.stageTimeline.length - 1];
    if (previous?.ts && item.ts >= previous.ts) item.elapsedFromPreviousMs = item.ts - previous.ts;
    if (previous && previous.stage === item.stage && previous.state === item.state
      && previous.dispatchId === item.dispatchId && item.ts - previous.ts < 250) return previous;
    entry.stageTimeline.push(item);
    if (entry.stageTimeline.length > MAX_TIMELINE) entry.stageTimeline.splice(0, entry.stageTimeline.length - MAX_TIMELINE);
    return item;
  }

  function appendRevision(entry, revision = {}) {
    if (!entry || typeof entry !== 'object') return null;
    const normalized = normalizeText(revision.text || '');
    const attemptId = revision.attemptId || revision.sourceRevisionId || `revision-${Number(entry.answerRevisionCounter || 0) + 1}`;
    const proofIdentity = ProofNormalization?.evidence?.(normalized, {
      dispatchId: revision.dispatchId || entry.confirmedDispatchId || entry.lastDispatchMeta?.dispatchId || null,
      attemptId
    }) || null;
    const item = {
      revision: Number(entry.answerRevisionCounter || 0) + 1,
      hash: revision.hash || (normalized ? hashText(normalized) : null),
      normalizationVersion: proofIdentity?.normalizationVersion || null,
      normalizedHash: proofIdentity?.normalizedHash || null,
      payloadEvidenceId: revision.payloadEvidenceId || proofIdentity?.payloadEvidenceId || null,
      attemptId,
      length: Number(revision.length ?? normalized.length) || 0,
      channel: revision.channel || revision.source || 'unknown',
      decision: revision.decision || 'observed',
      reason: revision.reason || null,
      sourceTimestamp: Number(revision.sourceTimestamp || 0) || null,
      receivedTimestamp: Number(revision.receivedTimestamp || Date.now()),
      appliedTimestamp: Number(revision.appliedTimestamp || 0) || null,
      runSessionId: revision.runSessionId || entry.modelRunState?.runSessionId || null,
      dispatchId: revision.dispatchId || entry.confirmedDispatchId || entry.lastDispatchMeta?.dispatchId || null,
      generationEpoch: Number(revision.generationEpoch || entry.generationEpoch || 0) || null,
      turnAnchor: revision.turnAnchor || null,
      verified: revision.verified === true
    };
    entry.answerRevisionCounter = item.revision;
    entry.answerRevisions = Array.isArray(entry.answerRevisions) ? entry.answerRevisions : [];
    entry.answerRevisions.push(item);
    if (entry.answerRevisions.length > MAX_REVISIONS) entry.answerRevisions.splice(0, entry.answerRevisions.length - MAX_REVISIONS);
    return item;
  }

  function markLatestRevisionApplied(entry, context = {}) {
    if (!entry || !Array.isArray(entry.answerRevisions) || !entry.answerRevisions.length) return null;
    const dispatchId = context.dispatchId || null;
    const revision = [...entry.answerRevisions].reverse().find((item) => !dispatchId || !item.dispatchId || item.dispatchId === dispatchId);
    if (!revision) return null;
    revision.appliedTimestamp = Number(context.appliedTimestamp || Date.now());
    revision.decision = context.decision || 'applied';
    revision.verified = context.verified === true || revision.verified === true;
    return revision;
  }

  function hasIdentityValue(value) {
    return value !== null && value !== undefined && value !== '';
  }

  function compareIdentity(a = {}, b = {}, options = {}) {
    const strict = options.strict !== false;
    const keys = Array.isArray(options.requiredKeys) && options.requiredKeys.length
      ? options.requiredKeys : REQUIRED_IDENTITY_KEYS;
    const missing = [];
    const mismatched = [];
    keys.forEach((key) => {
      const hasA = hasIdentityValue(a[key]);
      const hasB = hasIdentityValue(b[key]);
      if (!hasA || !hasB) {
        if (strict) missing.push(key);
        return;
      }
      if (String(a[key]) !== String(b[key])) mismatched.push(key);
    });
    return { ok: missing.length === 0 && mismatched.length === 0, strict, missing, mismatched, keys };
  }

  function sameIdentity(a = {}, b = {}, options = {}) {
    return compareIdentity(a, b, options).ok;
  }

  function verifySnapshotPair(first = {}, second = {}, options = {}) {
    const reasons = [];
    const identity = compareIdentity(first, second, { strict: options.strictIdentity !== false });
    if (identity.missing.length) reasons.push(`identity_missing:${identity.missing.join(',')}`);
    if (identity.mismatched.length) reasons.push(`identity_changed:${identity.mismatched.join(',')}`);
    if (!first.selectedHash || first.selectedHash !== second.selectedHash) reasons.push('selected_text_changed');
    if (first.selectedNodeKey && second.selectedNodeKey && first.selectedNodeKey !== second.selectedNodeKey) {
      reasons.push('selected_node_replaced');
    }
    if (!first.candidateSetHash || first.candidateSetHash !== second.candidateSetHash) reasons.push('candidate_set_changed');
    if (first.messageRootHash && second.messageRootHash && first.messageRootHash !== second.messageRootHash) reasons.push('message_root_changed');
    if (second.generationActive !== false) reasons.push(second.generationActive === true
      ? 'generation_still_active' : 'generation_inactive_unproven');
    if (second.resolution !== 'exact') reasons.push(`turn_resolution_${second.resolution || 'unknown'}`);
    if (second.structuralComplete !== true) reasons.push(...(second.structuralIssues || ['structural_completeness_unproven']));
    const minimumLength = Number(options.minimumLength || 1);
    if (Number(second.selectedLength || 0) < minimumLength) reasons.push('answer_too_short');
    return {
      verified: reasons.length === 0,
      state: reasons.length === 0 ? VERIFICATION_STATES.VERIFIED : VERIFICATION_STATES.CANDIDATE,
      reasons: Array.from(new Set(reasons)),
      selectedHash: second.selectedHash || null,
      selectedLength: Number(second.selectedLength || 0),
      selectedNodeKey: second.selectedNodeKey || null,
      selectedCandidateIndex: Number.isFinite(Number(second.selectedCandidateIndex)) ? Number(second.selectedCandidateIndex) : null,
      candidateOrdinalAfterAnchor: Number.isFinite(Number(second.candidateOrdinalAfterAnchor)) ? Number(second.candidateOrdinalAfterAnchor) : null,
      candidateSetHash: second.candidateSetHash || null,
      messageRootHash: second.messageRootHash || null,
      resolution: second.resolution || 'unknown',
      structuralComplete: second.structuralComplete === true,
      structuralIssues: Array.isArray(second.structuralIssues) ? second.structuralIssues.slice(0, 20) : [],
      generationActive: typeof second.generationActive === 'boolean' ? second.generationActive : null,
      generationSignalKind: second.generationSignalKind || null,
      generationSignalSelector: second.generationSignalSelector || null,
      generationSignalChecks: Array.isArray(second.generationSignalChecks) ? second.generationSignalChecks.slice(0, 40) : [],
      messageRootLength: Number(second.messageRootLength || 0),
      runSessionId: second.runSessionId ?? null,
      dispatchId: second.dispatchId ?? null,
      generationEpoch: second.generationEpoch ?? null,
      turnAnchor: second.turnAnchor ?? null,
      observedAt: Number(second.observedAt || Date.now())
    };
  }

  function classifyTextDelta(previous = '', next = '') {
    const before = normalizeText(previous);
    const after = normalizeText(next);
    if (before === after) return { kind: 'same', safeUpgrade: false };
    if (!before) return { kind: 'initial', safeUpgrade: true };
    if (after.startsWith(before) && after.length > before.length) return { kind: 'append', safeUpgrade: true };
    if (after.includes(before) && after.length > before.length) return { kind: 'superset', safeUpgrade: true };
    return { kind: 'rewrite', safeUpgrade: false };
  }

  function canAutoUpgrade(previous = {}, next = {}, context = {}) {
    const reasons = [];
    const manual = context.manual === true;
    const identity = compareIdentity(
      { ...previous, ...context.previousIdentity },
      { ...next, ...context.nextIdentity },
      { strict: !manual }
    );
    if (identity.missing.length) reasons.push(`identity_missing:${identity.missing.join(',')}`);
    if (identity.mismatched.length) reasons.push(`identity_mismatch:${identity.mismatched.join(',')}`);
    if (next.verified !== true && next.verificationState !== VERIFICATION_STATES.VERIFIED) reasons.push('candidate_not_verified');
    if (next.resolution !== 'exact') reasons.push(`turn_resolution_${next.resolution || 'unknown'}`);
    if (next.structuralComplete !== true) reasons.push('structural_completeness_unproven');
    if (next.generationActive !== false) reasons.push(next.generationActive === true
      ? 'generation_still_active' : 'generation_inactive_unproven');
    const hasPreviousText = typeof context.previousText === 'string' && context.previousText.length > 0;
    const hasNextText = typeof context.nextText === 'string' && context.nextText.length > 0;
    const previousText = hasPreviousText ? context.previousText : '';
    const nextText = hasNextText ? context.nextText : '';
    if (!manual && (!hasPreviousText || !hasNextText)) {
      reasons.push('upgrade_texts_required');
    } else if (hasPreviousText && hasNextText) {
      const delta = classifyTextDelta(previousText, nextText);
      if (!delta.safeUpgrade) reasons.push(`unsafe_${delta.kind}`);
    }
    return { ok: reasons.length === 0, reasons: Array.from(new Set(reasons)) };
  }

  const api = Object.freeze({
    VERIFICATION_STATES,
    normalizeText,
    hashText,
    appendTimeline,
    appendRevision,
    markLatestRevisionApplied,
    REQUIRED_IDENTITY_KEYS,
    compareIdentity,
    sameIdentity,
    verifySnapshotPair,
    classifyTextDelta,
    canAutoUpgrade
  });
  root.AnswerVerification = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
