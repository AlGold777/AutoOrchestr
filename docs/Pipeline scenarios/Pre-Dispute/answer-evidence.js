// shared/answer-evidence.js
// Lightweight normalized answer evidence contract shared by recovery and finalization paths.

(function initAnswerEvidence(root) {
  'use strict';

  const ProofNormalization = root.AnswerProofNormalization || (() => {
    try { return typeof require === 'function' ? require('./answer-proof-normalization.js') : null; } catch (_) { return null; }
  })();

  // Defaults come from shared/answer-length-policy.js when it is loaded first;
  // the literal fallbacks are the same numbers and exist for legacy load orders.
  const lengthPolicyDefaults = root.AnswerLengthPolicy?.DEFAULTS || null;
  const DEFAULT_MIN_CHARS = lengthPolicyDefaults?.minTerminalChars || 80;
  const DEFAULT_STABLE_MIN_CHARS = lengthPolicyDefaults?.stableForceMinChars || 1200;
  const DEFAULT_SNAPSHOT_TERMINAL_MIN_CHARS = lengthPolicyDefaults?.snapshotTerminalMinChars || 1200;

  function hashText(value = '') {
    if (ProofNormalization?.hashText) return ProofNormalization.hashText(value);
    const text = String(value || '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function normalizeSource(value = '') {
    return String(value || '').trim().toLowerCase();
  }

  function includesAny(value, needles = []) {
    const haystack = String(value || '').toLowerCase();
    return needles.some((needle) => haystack.includes(needle));
  }

  function isSnapshotSource(source) {
    return includesAny(source, ['snapshot', 'inline_executescript', 'inline_execute_script', 'dom_snapshot']);
  }

  function isMaterializeSource(source) {
    return includesAny(source, ['materialize', 'terminal_failure_blocked_by_answer_evidence']);
  }

  function isPanelSource(source) {
    return includesAny(source, ['panel', 'ui_panel', 'panel_extraction']);
  }

  function isApiSource(source) {
    return includesAny(source, ['api', 'api_response', 'api_transport']);
  }

  function isTimeoutReason(reason) {
    return includesAny(reason, ['timeout', 'streaming_incomplete', 'hard_timeout', 'soft_timeout', 'stream_start_timeout']);
  }

  function isHardStopReason(reason) {
    return includesAny(reason, ['hard_stop', 'script_runtime_hard_stop', 'force_stop', 'terminal_hard_stop']);
  }

  function isStableReason(reason, source) {
    return includesAny(reason, ['stable', 'stabilization', 'generation_inactive', 'content_mutation_stable'])
      || includesAny(source, ['deferred_finalization', 'stable']);
  }

  function buildAnswerEvidence(input = {}) {
    const responseMeta = input.responseMeta && typeof input.responseMeta === 'object' ? input.responseMeta : {};
    const text = String(input.text || input.answer || '').trim();
    const source = input.source || responseMeta.source || responseMeta.answerSource || input.answerSource || null;
    const normalizedSource = normalizeSource(source);
    const completionReason = input.completionReason || responseMeta.completionReason || responseMeta.answerReason || null;
    const normalizedReason = normalizeSource(completionReason);
    const hardStopReason = input.hardStopReason || responseMeta.hardStopReason || null;
    const normalizedHardStopReason = normalizeSource(hardStopReason);
    const length = text.length;
    const proofIdentity = ProofNormalization?.evidence?.(text, {
      dispatchId: input.dispatchId || responseMeta.dispatchId || null,
      attemptId: input.attemptId || responseMeta.attemptId || responseMeta.sourceRevisionId || null
    }) || null;
    const minChars = Number(input.minChars || DEFAULT_MIN_CHARS);
    const stableMinChars = Number(input.stableMinChars || DEFAULT_STABLE_MIN_CHARS);
    const snapshotTerminalMinChars = Number(input.snapshotTerminalMinChars || responseMeta.snapshotTerminalMinChars || DEFAULT_SNAPSHOT_TERMINAL_MIN_CHARS);
    const stableForMs = Number(input.stableForMs || responseMeta.stableForMs || 0) || 0;
    const sameTextSeenCount = Number(input.sameTextSeenCount || responseMeta.sameTextSeenCount || 0) || 0;
    const promptConfirmed = typeof input.promptConfirmed === 'boolean'
      ? input.promptConfirmed
      : (typeof responseMeta.sendConfirmed === 'boolean' ? responseMeta.sendConfirmed : null);
    const generationActive = typeof input.generationActive === 'boolean'
      ? input.generationActive
      : (typeof responseMeta.generationActive === 'boolean' ? responseMeta.generationActive : null);
    const stopButtonVisible = typeof input.stopButtonVisible === 'boolean'
      ? input.stopButtonVisible
      : (typeof responseMeta.stopVisible === 'boolean' ? responseMeta.stopVisible : null);
    const busyIndicatorVisible = typeof input.busyIndicatorVisible === 'boolean'
      ? input.busyIndicatorVisible
      : (typeof responseMeta.busyVisible === 'boolean' ? responseMeta.busyVisible : null);

    // The typed run result, when the pipeline produced one. It does not
    // replace the source/reason heuristics below — it constrains them: a run
    // whose own proof came out UNKNOWN or OBSERVER_LOST must not reach the
    // caller as a plain success just because its text is long enough.
    const runResult = input.runResult || responseMeta.runResult || null;
    const resultType = runResult?.type ? String(runResult.type).toUpperCase() : null;
    const unprovenResultType = Boolean(resultType && ['UNKNOWN', 'OBSERVER_LOST', 'FAILED', 'CANCELLED'].includes(resultType));
    // A run the contract committed is terminal evidence in its own right, and
    // the strongest one available: it already required proven identity, proven
    // terminality and a guarantee above heuristic. Without this the best proof
    // in the system would fall through to the source/reason heuristics below
    // and land on `text_without_terminal_signal`.
    const committedResultType = Boolean(resultType && ['COMMITTED', 'COMMITTED_TRUNCATED'].includes(resultType));

    const snapshot = isSnapshotSource(normalizedSource);
    const materialize = isMaterializeSource(normalizedSource);
    const panel = isPanelSource(normalizedSource);
    const api = isApiSource(normalizedSource);
    const timeout = isTimeoutReason(normalizedReason);
    const hardStop = isHardStopReason(normalizedReason) || isHardStopReason(normalizedHardStopReason);
    const stable = isStableReason(normalizedReason, normalizedSource) || stableForMs > 0 || sameTextSeenCount >= 2;
    // Heuristic guard for DOM-extracted text (page error banners); not a status channel.
    const validText = length >= minChars && !/^error\s*:/i.test(text);
    const explicitTerminalSource = Boolean(
      responseMeta.forceTerminalSuccess
      || responseMeta.lateCollectFinal
      || responseMeta.manualRecovery
      || responseMeta.manualOverride
    );
    const explicitCompletionEvidence = Boolean(
      responseMeta.answerCompleteDetected
      || responseMeta.lifecycleReady
      || responseMeta.completionEvidence
      || responseMeta.completionReason === 'generation_inactive'
      || responseMeta.completionReason === 'api_response'
    );
    const snapshotTerminalEligible = Boolean(snapshot && (length >= snapshotTerminalMinChars || explicitTerminalSource));
    const materializeTerminalEligible = Boolean(materialize && (length >= stableMinChars || explicitTerminalSource || explicitCompletionEvidence));
    const stableTerminalEligible = Boolean(stable && length >= stableMinChars && stopButtonVisible !== true);
    const terminalEligible = Boolean(
      validText
      && !unprovenResultType
      && (
        committedResultType
        || input.verifiedCurrentAnswer === true
        || snapshotTerminalEligible
        || materializeTerminalEligible
        || panel
        || api
        || timeout
        || hardStop
        || stableTerminalEligible
        || explicitTerminalSource
      )
    );

    const reason = (() => {
      if (!validText) return length ? 'text_too_short_or_error' : 'empty_text';
      if (unprovenResultType) return `unproven_run_result_${resultType.toLowerCase()}`;
      if (committedResultType) return `proven_run_result_${resultType.toLowerCase()}`;
      if (timeout) return 'timeout_with_text';
      if (hardStop) return 'hardstop_with_text';
      if (snapshot && !snapshotTerminalEligible) return 'snapshot_text_too_short_without_terminal_signal';
      if (snapshot) return 'snapshot_with_text';
      if (materialize && !materializeTerminalEligible) return 'materialize_text_without_completion_evidence';
      if (materialize) return 'materialize_with_text';
      if (panel) return 'panel_with_text';
      if (api) return 'api_with_text';
      if (stable && stopButtonVisible === true) return 'stable_text_stop_visible';
      if (stable && length >= stableMinChars) return 'stable_text';
      if (responseMeta.forceTerminalSuccess) return 'forced_success_with_text';
      if (responseMeta.lateCollectFinal) return 'late_collect_with_text';
      if (responseMeta.preTerminalMaterialize) return 'prefinal_materialize_without_completion_evidence';
      return 'text_without_terminal_signal';
    })();

    return {
      schemaVersion: 1,
      llmName: input.llmName || null,
      dispatchId: input.dispatchId || responseMeta.dispatchId || null,
      pipelineRunId: input.pipelineRunId || responseMeta.pipelineRunId || null,
      tabId: input.tabId || responseMeta.tabId || null,
      source: source || null,
      sourceKind: snapshot ? 'snapshot' : (materialize ? 'materialize' : (panel ? 'panel' : (api ? 'api' : (timeout ? 'timeout' : (hardStop ? 'hardstop' : (stable ? 'stable' : 'dom')))))),
      text,
      htmlLength: String(input.html || '').length,
      length,
      hash: length ? hashText(text) : null,
      normalizationVersion: proofIdentity?.normalizationVersion || null,
      normalizedLength: proofIdentity?.normalizedLength ?? null,
      normalizedHash: proofIdentity?.normalizedHash || null,
      payloadEvidenceId: proofIdentity?.payloadEvidenceId || null,
      attemptId: input.attemptId || responseMeta.attemptId || responseMeta.sourceRevisionId || null,
      promptConfirmed,
      promptSubmittedInferred: !!input.promptSubmittedInferred || !!responseMeta.promptSubmittedInferred,
      generationActive,
      stopButtonVisible,
      busyIndicatorVisible,
      stableForMs,
      sameTextSeenCount,
      snapshotTerminalMinChars,
      confidence: typeof input.confidence === 'number' ? input.confidence : (typeof responseMeta.confidence === 'number' ? responseMeta.confidence : null),
      resultType,
      resultGuarantee: runResult?.guarantee || null,
      evidenceClass: runResult?.strongestEvidenceClass || null,
      terminalEligible,
      partialAllowed: Boolean(
        timeout
        || hardStop
        || unprovenResultType
        || resultType === 'COMMITTED_TRUNCATED'
        || responseMeta.partial
        || responseMeta.degraded
      ),
      reason,
      rejectReason: terminalEligible ? null : reason,
      createdAt: Number(input.createdAt || Date.now())
    };
  }

  function shouldFinalizeWithEvidence(evidence = {}, options = {}) {
    const minChars = Number(options.minChars || DEFAULT_MIN_CHARS);
    if (!evidence || typeof evidence !== 'object') {
      return { ok: false, reason: 'missing_evidence' };
    }
    if (Number(evidence.length || 0) < minChars) {
      return { ok: false, reason: 'text_too_short' };
    }
    if (!evidence.terminalEligible) {
      return { ok: false, reason: evidence.rejectReason || 'not_terminal_eligible' };
    }
    return {
      ok: true,
      reason: evidence.reason || 'answer_evidence_terminal',
      finalStatus: evidence.partialAllowed ? 'PARTIAL' : 'SUCCESS'
    };
  }

  const api = Object.freeze({
    DEFAULT_MIN_CHARS,
    DEFAULT_STABLE_MIN_CHARS,
    DEFAULT_SNAPSHOT_TERMINAL_MIN_CHARS,
    hashText,
    buildAnswerEvidence,
    shouldFinalizeWithEvidence,
    isSnapshotSource,
    isMaterializeSource,
    isPanelSource,
    isApiSource,
    isTimeoutReason,
    isHardStopReason,
    isStableReason
  });

  root.AnswerEvidence = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
