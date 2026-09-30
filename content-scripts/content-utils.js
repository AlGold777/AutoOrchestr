// Shared utilities for content scripts (sleep, selectors cache, visibility checks, smart scroll)
(function initContentUtils() {
  if (window.ContentUtils) return;

  const sleep = (ms) => {
    const baseMs = Number(ms) || 0;
    const speedMode = !!window.__PRAGMATIST_SPEED_MODE;
    const factor = speedMode ? 0.35 : 1;
    const minMs = speedMode ? 25 : 0;
    const finalMs = Math.max(minMs, baseMs * factor);
    return new Promise((resolve) => setTimeout(resolve, finalMs));
  };

  const buildResponseMeta = (metadata = null, options = {}) => {
    const source = String(options.source || 'pipeline');
    const pipelineMeta = metadata && typeof metadata === 'object' ? metadata : {};
    const finalization = pipelineMeta.finalization && typeof pipelineMeta.finalization === 'object'
      ? pipelineMeta.finalization
      : {};
    const sanityCheck = pipelineMeta.sanityCheck && typeof pipelineMeta.sanityCheck === 'object'
      ? pipelineMeta.sanityCheck
      : (finalization.sanityCheck && typeof finalization.sanityCheck === 'object'
        ? finalization.sanityCheck
        : {});
    const fallback = source !== 'pipeline';
    return {
      source,
      completionReason: options.completionReason
        || pipelineMeta.completionReason
        || (fallback ? 'pipeline_failed' : 'success'),
      sanityWarnings: Array.isArray(options.sanityWarnings)
        ? options.sanityWarnings
        : (Array.isArray(sanityCheck.warnings) ? sanityCheck.warnings : (fallback ? ['unverified_fallback'] : [])),
      sanityConfidence: typeof options.sanityConfidence === 'number'
        ? options.sanityConfidence
        : (typeof sanityCheck.overallConfidence === 'number' ? sanityCheck.overallConfidence : null),
      answerVerification: options.answerVerification
        || finalization.answerVerification
        || pipelineMeta.answerVerification
        || null,
      // The typed run result has to survive the trip to the background, or the
      // strength of the claim is lost exactly where the answer is accepted:
      // AnswerEvidence reads responseMeta.runResult, and without this line it
      // would see an UNKNOWN run as an ordinary success.
      runResult: options.runResult
        || finalization.runResult
        || pipelineMeta.runResult
        || null
    };
  };

  const isExtensionContextValid = () => {
    try {
      return !!chrome?.runtime?.id;
    } catch (_) {
      return false;
    }
  };

  let mainBridgeToken = typeof window.__LLMMainBridgeToken === 'string'
    ? window.__LLMMainBridgeToken
    : null;
  let storedPipelineRunId = null;
  const getMainBridgeToken = () => mainBridgeToken || null;
  const setMainBridgeToken = (token) => {
    mainBridgeToken = typeof token === 'string' && token.trim() ? token.trim() : null;
    window.__LLMMainBridgeToken = mainBridgeToken;
    return mainBridgeToken;
  };
  const getPipelineRunId = () => storedPipelineRunId || null;

  const cleanupKeyByLlm = {
    'GPT': 'chatgpt',
    'Gemini': 'gemini',
    'Claude': 'claude',
    'Grok': 'grok',
    'Le Chat': 'lechat',
    'Qwen': 'qwen',
    'DeepSeek': 'deepseek',
    'Perplexity': 'perplexity',
    'Z.ai': 'zai',
    'Kimi': 'kimi'
  };

  const resolveCleanupHandler = (llmName) => {
    if (!llmName) return null;
    const key = cleanupKeyByLlm[llmName] || String(llmName).toLowerCase().replace(/\s+/g, '');
    const handler = key ? window[`__cleanup_${key}`] : null;
    return typeof handler === 'function' ? handler : null;
  };

  const runCleanupForLlm = (llmName, reason) => {
    const handler = resolveCleanupHandler(llmName);
    if (!handler) return false;
    try {
      handler(reason || 'cleanup');
      return true;
    } catch (err) {
      console.warn('[ContentUtils] Cleanup handler failed', llmName, err);
      return false;
    }
  };

  const runAllKnownCleanups = (reason) => {
    const targets = Object.keys(cleanupKeyByLlm);
    targets.forEach((name) => runCleanupForLlm(name, reason));
  };

  const handleContextInvalidation = () => {
    if (window.__LLMCodexContextInvalidated) return;
    window.__LLMCodexContextInvalidated = true;
    try {
      if (window.humanSessionController?.forceHardStop) {
        window.humanSessionController.forceHardStop('extension-invalidated');
      }
    } catch (_) {}
    runAllKnownCleanups('extension-invalidated');
    console.warn('[ContentUtils] Extension context invalidated');
  };

  const safeRuntimeSendMessage = (message, callback) => {
    if (!isExtensionContextValid()) {
      handleContextInvalidation();
      return false;
    }
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const errMsg = chrome.runtime?.lastError?.message || '';
        if (errMsg.includes('Extension context invalidated')) {
          handleContextInvalidation();
          return;
        }
        if (typeof callback === 'function') {
          callback(response);
        }
      });
      return true;
    } catch (err) {
      if ((err?.message || '').includes('Extension context invalidated')) {
        handleContextInvalidation();
        return false;
      }
      throw err;
    }
  };

  const sendRuntimeMessageForAck = (message, {
    acceptedStatus,
    timeoutMs = 5000,
    attempts = 2
  } = {}) => {
    const run = (attempt) => new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(result);
      };
      const timeoutId = setTimeout(() => finish({ ok: false, reason: 'ack_timeout' }), timeoutMs);
      const sent = safeRuntimeSendMessage(message, (response) => {
        const ok = response?.status === acceptedStatus;
        finish({
          ok,
          reason: ok ? null : (response?.reason || response?.status || 'ack_rejected'),
          response: response || null
        });
      });
      if (!sent) finish({ ok: false, reason: 'runtime_send_failed' });
    }).then(async (result) => {
      if (result.ok || attempt >= attempts) return result;
      await sleep(100 * attempt);
      return run(attempt + 1);
    });
    return run(1);
  };

  // Purpose: keep track of dispatch metadata for correlating telemetry.
  let storedSessionId = null;
  let storedRunSessionId = null;
  let storedDispatchId = null;
  let storedTabSessionId = null;
  let storedGenerationEpoch = null;
  let sessionExpired = false;
  const resetSessionExpiredState = () => {
    sessionExpired = false;
    try { delete window.__SESSION_EXPIRED__; } catch (_) {}
  };
  const storeSessionId = (sessionId) => {
    if (!sessionId) return;
    resetSessionExpiredState();
    storedSessionId = sessionId;
    storedRunSessionId = storedRunSessionId || sessionId;
    window.__CURRENT_SESSION_ID__ = sessionId;
  };
  const getSessionId = () => storedSessionId || window.__CURRENT_SESSION_ID__ || null;

  const storeDispatchMeta = (meta = {}) => {
    const runSessionId = meta.runSessionId || meta.sessionId || null;
    if (runSessionId) {
      storedRunSessionId = runSessionId;
      storedSessionId = storedSessionId || runSessionId;
      window.__CURRENT_SESSION_ID__ = storedSessionId;
    }
    if (meta.pipelineRunId) {
      storedPipelineRunId = meta.pipelineRunId;
    }
    if (meta.dispatchId) {
      storedDispatchId = meta.dispatchId;
    }
    if (meta.tabSessionId) {
      storedTabSessionId = meta.tabSessionId;
    }
    if (meta.generationEpoch !== null && meta.generationEpoch !== undefined && meta.generationEpoch !== '') {
      storedGenerationEpoch = meta.generationEpoch;
    }
  };

  const ensureDispatchMeta = (meta, llmName) => {
    const base = meta && typeof meta === 'object' ? Object.assign({}, meta) : {};
    storeDispatchMeta(base);
    const runSessionId = base.runSessionId || storedRunSessionId || getSessionId();
    if (runSessionId) {
      base.runSessionId = runSessionId;
      if (!base.sessionId) {
        base.sessionId = runSessionId;
      }
    }
    if (storedDispatchId && !base.dispatchId) {
      base.dispatchId = storedDispatchId;
    }
    if (storedTabSessionId && !base.tabSessionId) {
      base.tabSessionId = storedTabSessionId;
    }
    if (storedPipelineRunId && !base.pipelineRunId) {
      base.pipelineRunId = storedPipelineRunId;
    }
    if (storedGenerationEpoch !== null && storedGenerationEpoch !== undefined && base.generationEpoch == null) {
      base.generationEpoch = storedGenerationEpoch;
    }
    if (llmName && !base.llmName) {
      base.llmName = llmName;
    }
    return Object.keys(base).length ? base : null;
  };

  const FOCUS_REQUEST_THROTTLE_MS = 3000;
  let lastFocusRequestAt = 0;
  let activeRequestCount = 0;
  // Track on-going GET_ANSWER work so focus requests only fire while an active request is in flight.
  const startActiveRequest = () => { activeRequestCount += 1; };
  const stopActiveRequest = () => {
    if (activeRequestCount > 0) {
      activeRequestCount -= 1;
    }
  };
  const hasActiveRequest = () => activeRequestCount > 0;
  // Gate NEED_FOCUS to active GET_ANSWER cycles and throttle repeated notifications.
  const requestFocusFromBackground = (reason = 'visibility') => {
    if (!storedSessionId) return false;
    if (sessionExpired) return false;
    if (!hasActiveRequest()) return false;
    const now = Date.now();
    if (now - lastFocusRequestAt < FOCUS_REQUEST_THROTTLE_MS) return false;
    lastFocusRequestAt = now;
    return safeRuntimeSendMessage({
      type: 'NEED_FOCUS',
      sessionId: storedSessionId,
      reason
    });
  };

  const readInputValue = (el) => {
    try {
      if (!el) return '';
      if ('value' in el && String(el.value || '').length) return String(el.value || '');
      return String(el.innerText || el.textContent || '');
    } catch (_) {
      return '';
    }
  };

  const normalizeForPaste = (value = '') => String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  // Field evidence 2.81.201: a run where the prompt reached only one provider
  // still reported SUCCESS for two others, because each returned the answer that
  // was already on its reused page — DeepSeek baseline 5055 chars vs delivered
  // 5005, Qwen 646 vs 648. Strict equality let both through as "new": a
  // re-render, a trimmed trailing token or a re-streamed tail is enough to move
  // a few characters. The guard now also rejects a candidate that is the
  // baseline to within a small edge difference, measured as a shared prefix and
  // suffix covering nearly all of the shorter text. A genuinely new answer
  // diverges early, so it does not reach this threshold.
  const BASELINE_NEAR_MATCH_RATIO = 0.97;
  const BASELINE_NEAR_MATCH_MIN_CHARS = 120;

  const sharedPrefixLength = (a, b) => {
    const limit = Math.min(a.length, b.length);
    let index = 0;
    while (index < limit && a[index] === b[index]) index += 1;
    return index;
  };

  const sharedSuffixLength = (a, b, skip) => {
    const limit = Math.min(a.length, b.length) - skip;
    let index = 0;
    while (index < limit && a[a.length - 1 - index] === b[b.length - 1 - index]) index += 1;
    return index;
  };

  const isBaselineEquivalent = (candidateText = '', baselineText = '') => {
    const candidate = normalizeForPaste(candidateText);
    const baseline = normalizeForPaste(baselineText);
    if (!candidate || !baseline) return false;
    if (candidate === baseline) return true;
    // Only applied to substantial answers: short texts differ too easily by
    // chance, and rejecting them on similarity would suppress real replies.
    const shorter = Math.min(candidate.length, baseline.length);
    if (shorter < BASELINE_NEAR_MATCH_MIN_CHARS) return false;
    const prefix = sharedPrefixLength(candidate, baseline);
    const suffix = sharedSuffixLength(candidate, baseline, prefix);
    return (prefix + suffix) >= Math.floor(shorter * BASELINE_NEAR_MATCH_RATIO);
  };

  const PROVIDER_ERROR_SURFACE_PATTERNS = [
    /\b(something went wrong|an error occurred|please try again|try again later)\b/i,
    /\b(rate ?limit|too many requests|usage limit|message limit)\b/i,
    /\b(network error|connection (error|lost)|failed to (fetch|generate|load))\b/i,
    /\b(service is (temporarily )?unavailable|capacity|high demand|heavy load)\b/i,
    /\b(model|system|server|provider|service)\s+(is\s+)?(overloaded|busy|at capacity|unavailable|temporarily unavailable)\b/i,
    /\b(overloaded|temporarily unavailable|currently unavailable|server is busy)\b/i,
    /\b(unable to (respond|answer|generate|complete)|can('|’)?t (respond|answer|generate|complete))\b/i,
    /\b(couldn('|’)?t (generate|complete)|failed to generate (a )?(response|answer))\b/i
  ];

  const PROVIDER_ERROR_SURFACE_SELECTORS = [
    '[role="alert"]',
    '[role="status"]',
    '[role="dialog"]',
    '[aria-live="assertive"]',
    '[aria-live="polite"]',
    '[data-testid*="toast" i]',
    '[data-testid*="error" i]',
    '[data-testid*="modal" i]',
    '[class*="toast" i]',
    '[class*="error" i]',
    '[class*="modal" i]',
    '[class*="dialog" i]',
    '[class*="notification" i]',
    '[class*="banner" i]'
  ];

  const detectProviderErrorSurface = (scope = document) => {
    const root = scope || document;
    const seen = new Set();
    for (const selector of PROVIDER_ERROR_SURFACE_SELECTORS) {
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll(selector)); } catch (_) { nodes = []; }
      for (const node of nodes) {
        if (!node || seen.has(node) || !isElementInteractable(node)) continue;
        seen.add(node);
        const text = String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text || text.length > 1000) continue;
        const matched = PROVIDER_ERROR_SURFACE_PATTERNS.find((re) => re.test(text));
        if (matched) {
          return {
            detected: true,
            text,
            selector,
            reason: 'provider_error_surface'
          };
        }
      }
    }
    return { detected: false };
  };

  const countPromptOccurrences = (current, prompt) => {
    const expected = normalizeForPaste(prompt);
    const actual = normalizeForPaste(current);
    if (!expected || !actual || expected.length < 8) return 0;
    let count = 0;
    let offset = 0;
    while (offset <= actual.length - expected.length) {
      const found = actual.indexOf(expected, offset);
      if (found === -1) break;
      count += 1;
      offset = found + expected.length;
      if (count > 1) break;
    }
    return count;
  };

  const pasteMatchesPrompt = (current, prompt) => {
    const expected = normalizeForPaste(prompt);
    const actual = normalizeForPaste(current);
    if (!expected || !actual) return false;
    // Never accept "prompt + prompt" as a prepared composer. The old paste
    // cascade could perform execCommand, synthetic paste and another
    // execCommand in one pass, while this broad includes() check still marked
    // the duplicated draft as valid.
    if (countPromptOccurrences(actual, expected) > 1) return false;
    // Some rich editors remove only the line breaks at our Prompt envelope.
    // Compare the complete enclosed text, so this cannot accept a truncated or
    // altered body merely because its first/last fragments match.
    const expectedEnvelope = expected.match(/^<prompt>\s*([\s\S]*?)\s*<\/prompt>$/);
    const actualEnvelope = actual.match(/^<prompt>\s*([\s\S]*?)\s*<\/prompt>$/);
    if (expectedEnvelope && actualEnvelope) return actualEnvelope[1] === expectedEnvelope[1];
    if (actual.includes(expected)) return true;
    // Rich editors may place attachment/chip nodes inside the editor DOM. Use
    // two independent prompt fingerprints instead of requiring one continuous
    // 120-character DOM substring; both ends must belong to this request.
    const width = Math.min(32, Math.max(12, Math.floor(expected.length / 3)));
    const head = expected.slice(0, width);
    const tail = expected.slice(-width);
    return actual.includes(head) && actual.includes(tail);
  };

  const clearComposerForPrompt = (element) => {
    if (!element) return;
    try { element.focus?.({ preventScroll: true }); } catch (_) { try { element.focus?.(); } catch (_) {} }
    try {
      const doc = element.ownerDocument || document;
      doc.execCommand?.('selectAll', false, null);
      doc.execCommand?.('delete', false, null);
    } catch (_) {}
    try {
      if ('value' in element) {
        const proto = Object.getPrototypeOf(element);
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
          || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(element, '');
        else element.value = '';
      } else if (element.isContentEditable || element.getAttribute?.('contenteditable') === 'true') {
        element.textContent = '';
      }
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
    } catch (_) {
      try { element.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
    }
  };

  const pasteTextFirst = async (element, text = '') => {
    if (!element) return false;
    const payload = String(text || '');
    if (!payload) return false;
    const existing = readInputValue(element);
    if (pasteMatchesPrompt(existing, payload)) return true;
    // Replace the editor selection atomically. Clearing a controlled rich
    // editor through textContent leaves its framework state holding the old
    // draft; the next native insert can then append to that restored draft.
    const selectForReplacement = () => {
      if ('value' in element) return clearComposerForPrompt(element);
      try { element.focus?.({ preventScroll: true }); } catch (_) { element.focus?.(); }
      const doc = element.ownerDocument || document;
      const range = doc.createRange();
      range.selectNodeContents(element);
      const selection = doc.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    };
    selectForReplacement();
    try {
      const doc = element.ownerDocument || document;
      doc.execCommand?.('insertText', false, payload);
    } catch (e) { console.warn('[ContentUtils] Fast-track failed', e); }
    await sleep(60);
    if (element.isConnected === false) return false;
    if (pasteMatchesPrompt(readInputValue(element), payload)) return true;

    selectForReplacement();
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', payload);
      const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      if (!ev.clipboardData) {
        try { Object.defineProperty(ev, 'clipboardData', { value: dt }); } catch (_) {}
      }
      element.dispatchEvent(ev);
    } catch (_) {}
    await sleep(80);
    if (element.isConnected === false) return false;
    if (pasteMatchesPrompt(readInputValue(element), payload)) return true;

    selectForReplacement();
    try {
      const doc = element.ownerDocument || document;
      doc?.execCommand?.('insertText', false, payload);
    } catch (_) {}
    await sleep(80);
    const current = readInputValue(element);
    if (pasteMatchesPrompt(current, payload)) return true;
    return false;
  };

  // Report whether the prompt actually reached the composer, for both outcomes.
  // Without a positive report the `insertion_outcome` slot of the
  // prompt-not-inserted report stays `unavailable`, and the question "was the
  // prompt inserted at all?" cannot be answered from the run's own telemetry —
  // absence of an insertion event is not evidence of a failed insertion.
  // Call it from the adapter's own verdict, after any recovery path has run —
  // the composer gate below does not know whether the adapter still intends to
  // repair a detached or replaced composer. Exactly one verdict per dispatch.
  // Fire-and-forget: dispatch must never wait on a proof message.
  const reportPromptInsertion = (llmName, meta, outcome = {}) => {
    if (!llmName) return false;
    const inserted = outcome.state === 'inserted' || outcome.ok === true;
    return safeRuntimeSendMessage({
      type: 'PROMPT_INSERTION_OBSERVED',
      llmName,
      insertionState: inserted ? 'inserted' : 'failed',
      method: outcome.method ? String(outcome.method) : null,
      reason: outcome.reason ? String(outcome.reason) : null,
      promptLength: Number.isFinite(Number(outcome.promptLength)) ? Number(outcome.promptLength) : null,
      composerLength: Number.isFinite(Number(outcome.composerLength)) ? Number(outcome.composerLength) : null,
      attempt: Number.isFinite(Number(outcome.attempt)) ? Number(outcome.attempt) : null,
      meta: ensureDispatchMeta(meta && typeof meta === 'object' ? meta : {}, llmName) || {}
    });
  };

  const reportDispatchStage = (llmName, meta, stage, outcome = {}) => {
    const normalizedStage = String(stage || '').trim().toLowerCase();
    if (!llmName || !normalizedStage) return false;
    if (normalizedStage === 'send_action_requested') {
      window.ResponseLifecycleDetector?.notePromptSendAttempt?.({
        ...ensureDispatchMeta(meta || {}, llmName), modelName: llmName
      });
    }
    return safeRuntimeSendMessage({
      type: 'PROVIDER_DISPATCH_STAGE_OBSERVED',
      llmName,
      stage: normalizedStage,
      outcome: outcome.outcome ? String(outcome.outcome) : null,
      reason: outcome.reason ? String(outcome.reason) : null,
      elapsedMs: Number.isFinite(Number(outcome.elapsedMs)) ? Number(outcome.elapsedMs) : null,
      composerVisible: typeof outcome.composerVisible === 'boolean' ? outcome.composerVisible : null,
      composerConnected: typeof outcome.composerConnected === 'boolean' ? outcome.composerConnected : null,
      meta: ensureDispatchMeta(meta && typeof meta === 'object' ? meta : {}, llmName) || {}
    });
  };

  const reportProviderPipelineState = (llmName, meta, phase, active) => {
    if (!llmName || !['composer', 'answer_collection'].includes(String(phase || ''))) return false;
    return safeRuntimeSendMessage({
      type: 'PROVIDER_DISPATCH_PIPELINE_STATE',
      llmName,
      phase,
      active: active === true,
      meta: ensureDispatchMeta(meta && typeof meta === 'object' ? meta : {}, llmName) || {}
    });
  };

  // Canonical composer transaction gate. Dispatch code may proceed to Send only
  // when the live composer contains the current prompt, never merely because an
  // input/paste event was fired or because the composer is non-empty.
  const ensurePromptPrepared = async (element, prompt = '', options = {}) => {
    const payload = String(prompt || '');
    if (!element || !payload) return { ok: false, reason: 'missing_composer_or_prompt', value: '' };
    const fallback = typeof options.fallback === 'function' ? options.fallback : null;
    const resolveLive = () => {
      if (typeof options.resolveComposer === 'function') element = options.resolveComposer() || element;
      return element?.isConnected === false ? null : element;
    };
    const attempts = Math.max(1, Number(options.attempts || 2));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (!resolveLive()) return { ok: false, reason: 'composer_detached', value: '' };
      await pasteTextFirst(element, payload);
      if (!resolveLive()) continue;
      let current = readInputValue(element);
      if (pasteMatchesPrompt(current, payload)) {
        return { ok: true, method: 'paste', value: current, attempt, composer: element };
      }
      if (fallback) {
        await fallback(element, payload, { attempt });
        await sleep(Number(options.settleMs || 120));
        if (!resolveLive()) continue;
        current = readInputValue(element);
        if (pasteMatchesPrompt(current, payload)) {
          return { ok: true, method: 'fallback', value: current, attempt, composer: element };
        }
      }
    }
    return { ok: false, reason: 'prompt_not_present', value: readInputValue(element) };
  };

  // Report the on-page answer the adapter sees *before* it submits a follow-up prompt.
  // The background stores this signature and rejects it as a stale candidate until a new
  // answer renders (background/job-orchestrator.js isStaleBaselineCandidate). Fire this
  // before sending so the guard works even when the submit is never confirmed. The
  // normalization MUST match normalizeAnswerSignatureBg in the orchestrator.
  const reportDispatchBaseline = async (llmName, meta, baselineText = '') => {
    if (!llmName) return false;
    const signature = normalizeForPaste(baselineText);
    const lifecycle = window.LLMExtension?.ResponseLifecycleDetector || window.ResponseLifecycleDetector;
    let anchorAnswerCount = null;
    try {
      const lifecycleAnchor = lifecycle?.captureTurnAnchor?.(llmName);
      if (lifecycleAnchor !== null
        && lifecycleAnchor !== undefined
        && Number.isFinite(Number(lifecycleAnchor))) {
        anchorAnswerCount = Math.max(0, Number(lifecycleAnchor));
      }
    } catch (_) {}
    // Prime lifecycle tracking before Send. PROMPT_SUBMITTED is confirmation,
    // not a safe place to establish the old-turn baseline: fast providers may
    // already have inserted their new assistant node by then.
    let lifecycleStartPromise;
    try {
      const start = lifecycle?.startResponseLifecycleTracking;
      if (typeof start !== 'function') return false;
      lifecycleStartPromise = Promise.resolve(start.call(lifecycle, {
        modelName: llmName,
        dispatchId: meta?.dispatchId || null,
        runSessionId: meta?.runSessionId || meta?.sessionId || null,
        promptSubmittedAt: Date.now(),
        traceId: meta?.traceId || meta?.dispatchId || null,
        baselineText: String(baselineText || ''),
        turnAnchor: anchorAnswerCount
      })).catch(() => ({ ok: false, reason: 'lifecycle_start_failed' }));
    } catch (_) {
      return false;
    }
    // F6.2: attach the positional turn anchor captured by the unified pipeline
    // at dispatch time (number of answer nodes already on the page), so the
    // background inline scans can skip previous conversation turns too.
    if (anchorAnswerCount === null) {
      try {
        const anchor = window.__UnifiedPipelineTurnAnchor;
        if (anchor && Number.isFinite(Number(anchor.anchorAnswerCount))
          && anchor.dispatchId
          && meta?.dispatchId
          && String(anchor.dispatchId) === String(meta.dispatchId)
          && Date.now() - Number(anchor.capturedAt || 0) < 120000) {
          anchorAnswerCount = Number(anchor.anchorAnswerCount);
        }
      } catch (_) {}
    }
    if (anchorAnswerCount === null) {
      try {
        const selectors = lateSnapshotSelectorsByModel[llmName] || [];
        const nodes = new Set();
        selectors.forEach((selector) => {
          try { document.querySelectorAll(selector).forEach((node) => nodes.add(node)); } catch (_) {}
        });
        anchorAnswerCount = nodes.size;
      } catch (_) {
        anchorAnswerCount = null;
      }
    }
    try {
      window.__LLMPreDispatchTurnAnchor = {
        llmName,
        dispatchId: meta?.dispatchId || null,
        anchorAnswerCount,
        capturedAt: Date.now()
      };
    } catch (_) {}
    // Both requests are bound to the same pre-Send identity. Their ACKs are
    // independent; serial round trips added seconds before any text was typed.
    const acknowledgements = Promise.all([lifecycleStartPromise, sendRuntimeMessageForAck({
        type: 'DISPATCH_BASELINE_CAPTURED',
        llmName,
        meta: meta && typeof meta === 'object' ? meta : null,
        signature,
        anchorAnswerCount
      }, {
        acceptedStatus: 'dispatch_baseline_ack',
        timeoutMs: 5000,
        attempts: 2
      })]);
    const finishPreflight = async () => {
      const [lifecycleStart, baselineAck] = await acknowledgements;
      const preflightOk = lifecycleStart?.ok === true && baselineAck.ok === true;
      try {
        if (window.__LLMPreDispatchTurnAnchor?.dispatchId !== (meta?.dispatchId || null)) return false;
        window.__LLMDispatchPreflight = {
          llmName,
          dispatchId: meta?.dispatchId || null,
          ok: preflightOk,
          reason: lifecycleStart?.ok !== true ? (lifecycleStart?.reason || 'lifecycle_start_failed') : (baselineAck.reason || null),
          capturedAt: Date.now()
        };
      } catch (_) {}
      return preflightOk;
    };
    if (meta?.simpleFirstPass === true) {
      // Baseline and tracker were captured synchronously above, before editing.
      // Round 1 only delivers the prompt. Authority ACKs still gate answer
      // acceptance, but no longer delay typing; Round 2 handles failed setup.
      window.__LLMDispatchPreflight = {
        llmName, dispatchId: meta.dispatchId || null, ok: false, pending: true, capturedAt: Date.now()
      };
      void finishPreflight().catch(() => {});
      return true;
    }
    return finishPreflight();
  };

  const recoverPreparedComposerSend = async (llmName, prompt, meta = {}) => {
    const expected = normalizeForPaste(prompt);
    if (!expected) return { ok: false, status: 'send_only_rejected', reason: 'empty_prompt' };
    const candidates = Array.from(document.querySelectorAll([
      'textarea:not([disabled])',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"]'
    ].join(',')));
    const composer = candidates.find((element) => (
      element?.isConnected
      && isElementInteractable(element)
      && pasteMatchesPrompt(readInputValue(element), prompt)
    ));
    if (!composer) {
      return { ok: false, status: 'send_only_rejected', reason: 'visible_current_composer_prompt_mismatch' };
    }
    reportDispatchStage(llmName, meta, 'send_only_recovery_started', {
      composerVisible: true,
      composerConnected: true
    });
    const noLongerPrepared = () => !pasteMatchesPrompt(readInputValue(composer), prompt);
    try {
      composer.focus?.({ preventScroll: true });
    } catch (_) { try { composer.focus?.(); } catch (_) {} }
    const useMeta = llmName === 'Qwen' && typeof navigator !== 'undefined'
      && /Mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
    try {
      composer.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        ctrlKey: !useMeta, metaKey: useMeta, bubbles: true, cancelable: true
      }));
      composer.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        ctrlKey: !useMeta, metaKey: useMeta, bubbles: true, cancelable: true
      }));
    } catch (_) {}
    await sleep(600);
    let method = useMeta ? 'cmd_enter' : 'ctrl_enter';
    if (!noLongerPrepared()) {
      const buttons = Array.from(document.querySelectorAll([
        'button[data-testid*="send" i]',
        'button[aria-label*="send" i]',
        'button[title*="send" i]',
        'button[type="submit"]'
      ].join(',')));
      const button = buttons.find((candidate) => (
        candidate?.isConnected
        && isElementInteractable(candidate)
        && !candidate.disabled
        && candidate.getAttribute?.('aria-disabled') !== 'true'
      ));
      if (button) {
        try { button.click(); } catch (_) {}
        method = 'send_button';
      }
      await sleep(1200);
    }
    if (!noLongerPrepared()) {
      reportDispatchStage(llmName, meta, 'send_only_recovery_failed', {
        outcome: 'failed', reason: 'send_not_observed'
      });
      return { ok: false, status: 'send_only_failed', reason: 'send_not_observed' };
    }
    const submissionMeta = ensureDispatchMeta(meta, llmName) || meta || {};
    reportDispatchStage(llmName, submissionMeta, 'send_only_recovery_completed', {
      outcome: 'confirmed', reason: method
    });
    safeRuntimeSendMessage({
      type: 'PROMPT_SUBMITTED',
      llmName,
      ts: Date.now(),
      meta: submissionMeta
    });
    return { ok: true, status: 'send_only_confirmed', method };
  };

  try {
    chrome.runtime.onMessage?.addListener?.((message, _sender, sendResponse) => {
      if (message?.type !== 'RECOVER_PROVIDER_SEND') return false;
      const llmName = String(message.llmName || '');
      if (!llmName || llmName === 'Grok' || llmName === 'Perplexity') return false;
      recoverPreparedComposerSend(llmName, message.prompt, message.meta || {})
        .then((result) => sendResponse?.(result))
        .catch((error) => sendResponse?.({
          ok: false,
          status: 'send_only_failed',
          reason: error?.message || 'send_only_runtime_error'
        }));
      return true;
    });
  } catch (_) {}

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      requestFocusFromBackground('visibility');
    }
  });

  try {
    const lastSpaCleanupAt = new Map();
    window.addEventListener('LLM_CODEX_SPA_NAVIGATION', (event) => {
      const detail = event?.detail || {};
      const llmName = detail.llmName;
      if (!llmName) return;
      if (window.ResponseLifecycleDetector?.shouldPreserveNavigation?.(detail)) return;
      const now = Date.now();
      const last = lastSpaCleanupAt.get(llmName) || 0;
      if (now - last < 2000) return;
      lastSpaCleanupAt.set(llmName, now);
      runCleanupForLlm(llmName, `spa_navigation:${detail.reason || 'unknown'}`);
    }, { passive: true });
  } catch (_) {}

  const markSessionExpired = (meta = {}) => {
    if (sessionExpired) return false;
    sessionExpired = true;
    activeRequestCount = 0;
    const payload = {
      reason: meta.reason || 'session_expired',
      previousSessionId: storedSessionId || null,
      newSessionId: meta.newSessionId || null,
      triggeredBy: meta.triggeredBy || 'background',
      ts: Date.now()
    };
    window.__SESSION_EXPIRED__ = payload;
    try {
      if (window.humanSessionController?.forceHardStop) {
        window.humanSessionController.forceHardStop(payload.reason);
      }
    } catch (_) {}
    try {
      window.__LLMScrollHardStop = true;
    } catch (_) {}
    console.warn('[ContentUtils] Session expired locally', payload);
    return true;
  };

  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'SESSION_EXPIRED') {
        const incomingSessionId = message.currentSessionId;
        if (!incomingSessionId || incomingSessionId === storedSessionId) return false;
        markSessionExpired({
          reason: message.reason || 'session_mismatch',
          newSessionId: incomingSessionId,
          triggeredBy: 'background_session_switch'
        });
      }
    });
  } catch (_) {}

  // Cancelling a run must stop the provider generation it started, not only our
  // observation of it: otherwise the site keeps generating and the next command
  // lands in a busy conversation. Only a tab with a request of ours in flight is
  // touched. Registered before the adapters' listeners (manifest order), so the
  // active-request check runs before an adapter resets its counters.
  const findProviderStopButton = () => {
    const bundle = window.AnswerPipelineSelectors;
    const platform = bundle?.detectPlatform?.();
    const selector = platform ? bundle?.PLATFORM_SELECTORS?.[platform]?.stopButton : null;
    if (!selector) return null;
    return Array.from(document.querySelectorAll(selector))
      .find((button) => !button.disabled && isElementInteractable(button)) || null;
  };
  const stopProviderGeneration = async (timeoutMs = 3000) => {
    const button = findProviderStopButton();
    if (!button) return { stopped: false, reason: 'no_stop_control' };
    button.click();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (!findProviderStopButton()) return { stopped: true, reason: 'stop_confirmed' };
    }
    return { stopped: false, reason: 'stop_unconfirmed' };
  };
  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type !== 'STOP_AND_CLEANUP' || !hasActiveRequest()) return false;
      stopProviderGeneration()
        .then((result) => console.info('[ContentUtils] provider generation stop', result))
        .catch((err) => console.warn('[ContentUtils] provider generation stop failed', err));
      return false;
    });
  } catch (_) {}

  const isElementInteractable = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect?.();
    const style = window.getComputedStyle?.(el);
    return !!rect && !!style && rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };

  const getCoordinator = () =>
    window.chatgptScrollCoordinator ||
    window.leChatScrollCoordinator ||
    window.perplexityScrollCoordinator ||
    window.geminiScrollCoordinator ||
    window.qwenScrollCoordinator ||
    window.deepseekScrollCoordinator ||
    window.grokScrollCoordinator ||
    window.scrollCoordinator;

  async function withSmartScroll(asyncOperation, options = {}) {
    await ensureScrollToolkit();
    const coordinator = options.coordinator || getCoordinator();
    if (coordinator?.run) {
      return coordinator.run(asyncOperation, options);
    }
    return asyncOperation();
  }

  const loadedScripts = new Map();
  function loadScriptOnce(path) {
    if (loadedScripts.has(path)) return loadedScripts.get(path);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL(path);
      script.onload = () => resolve(true);
      script.onerror = (err) => reject(err);
      (document.head || document.documentElement || document.body).appendChild(script);
    }).catch((err) => {
      console.warn('[ContentUtils] Failed to load script', path, err);
      return false;
    });
    loadedScripts.set(path, promise);
    return promise;
  }

  async function ensureMainWorldBridge() {
    if (window.__extMainBridgeInjected) return true;
    const loaded = await loadScriptOnce('content-scripts/content-bridge.js');
    if (loaded) window.__extMainBridgeInjected = true;
    return loaded;
  }

  async function ensureScrollToolkit() {
    if (window.__UniversalScrollToolkit) return true;
    await loadScriptOnce('scroll-toolkit.js');
    return !!window.__UniversalScrollToolkit;
  }

  async function ensureHumanoid() {
    if (window.LLMExtension?.Humanoid) return true;
    await ensureScrollToolkit();
    await loadScriptOnce('humanoid.js');
    return !!(window.LLMExtension?.Humanoid);
  }

  // Shared MutationObserver registry to reduce duplicate observers per target
  const mutationRegistry = new Map(); // target -> { observer, callbacks, options }
  function observeMutations(target, options, handler) {
    if (!target || typeof handler !== 'function') return () => {};
    const key = target;
    let entry = mutationRegistry.get(key);
    if (!entry) {
      entry = { callbacks: new Set(), observer: null, options };
      entry.observer = new MutationObserver((muts) => {
        entry.callbacks.forEach((cb) => {
          try { cb(muts); } catch (err) { console.warn('[ContentUtils] observeMutations handler failed', err); }
        });
      });
      try {
        entry.observer.observe(target, options || { childList: true, subtree: true, characterData: true });
      } catch (err) {
        console.warn('[ContentUtils] observeMutations failed to observe', err);
        return () => {};
      }
      mutationRegistry.set(key, entry);
    }
    entry.callbacks.add(handler);
    return () => {
      const current = mutationRegistry.get(key);
      if (!current) return;
      current.callbacks.delete(handler);
      if (!current.callbacks.size) {
        current.observer.disconnect();
        mutationRegistry.delete(key);
      }
    };
  }

  async function findAndCacheElement(selectorKey, selectorArray, timeout = 30000, scope = document, extras = {}) {
    // Support calling with options object as third arg
    if (typeof timeout === 'object') {
      extras = timeout;
      timeout = extras.timeout || 30000;
      scope = extras.scope || document;
    }
    const model = extras.model || window.MODEL || 'generic';
    const metricsCollector = extras.metricsCollector;
    const cacheVersion = '2025-12-11';
    const storageKey = `selector_cache_${model}_${selectorKey}_${cacheVersion}`;
    const startedAt = performance.now();
    const cachedSelector = (() => {
      try {
        const allKeys = Object.keys(window.localStorage || {}).filter((k) => k.startsWith(`selector_cache_${model}_${selectorKey}_`));
        const stale = allKeys.filter((k) => k !== storageKey);
        stale.forEach((k) => {
          try { window.localStorage.removeItem(k); } catch (_) {}
        });
        return window.localStorage?.getItem(storageKey);
      } catch (_) {
        return null;
      }
    })();
    if (cachedSelector) {
      const node = safeQuery(cachedSelector, scope);
      if (node) {
        metricsCollector?.finishOperation?.(`find_${selectorKey}`, { status: 'cache_hit', selector: cachedSelector });
        return node;
      }
    }

    const end = performance.now() + timeout;
    while (performance.now() < end) {
      for (const selector of selectorArray || []) {
        const node = safeQuery(selector, scope);
        if (node && isElementInteractable(node)) {
          try { window.localStorage?.setItem(storageKey, selector); } catch (_) {}
          metricsCollector?.finishOperation?.(`find_${selectorKey}`, { status: 'success', selector, durationMs: performance.now() - startedAt });
          return node;
        }
      }
      await sleep(100);
    }
    metricsCollector?.finishOperation?.(`find_${selectorKey}`, { status: 'timeout', durationMs: performance.now() - startedAt });
    return null;
  }

  function safeQuery(selector, scope = document) {
    try {
      return scope.querySelector(selector);
    } catch (_) {
      return null;
    }
  }

  const INLINE_STYLE_PROPERTIES = [
    'color',
    'background-color',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'text-decoration',
    'text-transform',
    'line-height',
    'letter-spacing',
    'text-align',
    'white-space',
    'margin',
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
    'padding',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'border',
    'border-top',
    'border-right',
    'border-bottom',
    'border-left',
    'border-radius',
    'list-style-type',
    'list-style-position'
  ];

  const buildInlineStyle = (element) => {
    if (!element || element.nodeType !== 1) return '';
    const computed = window.getComputedStyle?.(element);
    if (!computed) return '';
    return INLINE_STYLE_PROPERTIES.map((prop) => {
      const value = computed.getPropertyValue(prop);
      return value ? `${prop}:${value.trim()};` : '';
    }).join('');
  };

  const applyInlineStyles = (source, target) => {
    const style = buildInlineStyle(source);
    if (style) {
      target.setAttribute('style', style);
    }
  };

  const cloneElementWithInlineStyles = (element) => {
    if (!element || element.nodeType !== 1) return null;
    const clone = element.cloneNode(true);
    const sourceWalker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT, null);
    const cloneWalker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT, null);
    let sourceNode = element;
    let cloneNode = clone;
    while (sourceNode && cloneNode) {
      applyInlineStyles(sourceNode, cloneNode);
      sourceNode = sourceWalker.nextNode();
      cloneNode = cloneWalker.nextNode();
    }
    return clone;
  };

  const stripHiddenElements = (root) => {
    if (!root || root.nodeType !== 1) return;
    root.querySelectorAll('[style*="display: none"], [style*="visibility: hidden"]').forEach((node) => node.remove());
  };

  const RESPONSE_CLEANUP_SELECTORS = [
    'script',
    'style',
    'noscript',
    'svg',
    'canvas',
    'button',
    '[role="button"]',
    'header',
    'footer',
    'nav',
    'aside',
    'form'
  ].join(', ');

  const buildInlineHtml = (element, options = {}) => {
    if (!element || element.nodeType !== 1) return '';
    const includeRoot = options.includeRoot !== false;
    const clone = cloneElementWithInlineStyles(element) || element.cloneNode(true);
    try { stripHiddenElements(clone); } catch (_) {}
    try {
      clone.querySelectorAll(RESPONSE_CLEANUP_SELECTORS).forEach((node) => node.remove());
    } catch (_) {}
    return includeRoot ? (clone.outerHTML || '') : (clone.innerHTML || '');
  };

  const detectLlmNameFromLocation = () => {
    const host = String(window.location?.hostname || '').toLowerCase();
    if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'GPT';
    if (host.includes('gemini.google.com') || host.includes('bard.google.com')) return 'Gemini';
    if (host.includes('claude.ai')) return 'Claude';
    if (host.includes('grok.com') || host.includes('grok.x.ai') || host === 'x.com') return 'Grok';
    if (host.includes('chat.qwen.ai')) return 'Qwen';
    if (host.includes('chat.mistral.ai')) return 'Le Chat';
    if (host.includes('chat.deepseek.com')) return 'DeepSeek';
    if (host.includes('perplexity.ai')) return 'Perplexity';
    if (host === 'chat.z.ai') return 'Z.ai';
    if (host === 'kimi.ai' || host.endsWith('.kimi.ai')) return 'Kimi';
    return window.MODEL || null;
  };

  const extractSafeVisibleText = (el, maxChars = 10000) => {
    if (!el) return '';
    let text = '';
    try {
      text = el.innerText || el.textContent || '';
    } catch (_) {
      text = '';
    }
    return String(text)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, Math.max(0, Number(maxChars) || 10000));
  };

  const lateSnapshotSelectorsByModel = {
    GPT: [
      '[data-message-author-role="assistant"] .markdown',
      '[data-message-author-role="assistant"]',
      'article .markdown',
      'article'
    ],
    Gemini: [
      'model-response',
      '.model-response-text',
      'message-content',
      '[data-test-id="model-response-text"]',
      '[data-message-author-role="assistant"]',
      '.markdown',
      'article'
    ],
    Claude: [
      '[data-testid*="assistant" i]',
      '[data-is-streaming="false"] .font-claude-message',
      '.font-claude-message',
      '[data-testid="message"]',
      '.markdown',
      'article'
    ],
    Grok: [
      '[data-testid="conversation-turn"] .markdown',
      '[data-testid="chat-message"] .markdown',
      '[data-testid="message-bubble"]',
      '.markdown',
      'article'
    ],
    'Le Chat': [
      'div[data-testid="lechat-response"] .prose',
      '[data-testid="answer"] .prose',
      '[data-testid="message-content"]',
      '.prose',
      '.answer',
      '.result'
    ],
    Qwen: [
      'div.qwen-chat-message.qwen-chat-message-assistant div.response-message-content div.custom-qwen-markdown > div.qwen-markdown.qwen-markdown-loose',
      'div.qwen-chat-message-assistant div.custom-qwen-markdown .qwen-markdown',
      '[data-testid="chat-response"] .qwen-markdown',
      'div.custom-qwen-markdown',
      'div.qwen-markdown.qwen-markdown-loose'
    ],
    DeepSeek: [
      '.message-item[data-role="assistant"] .markdown-body',
      '.message-item[data-role="assistant"] .message-content',
      '[data-role="assistant"] .markdown-body',
      'div.ds-message div.ds-markdown',
      '.assistant-message .markdown-body',
      '.markdown-body',
      '.message-content'
    ],
    Perplexity: [
      '[data-testid="answer-card"] .prose',
      '[data-testid="answer-card"]',
      '[data-testid="answer"] .prose',
      '[data-testid="chat-message"] .prose',
      '[data-testid="conversation-turn"] .prose',
      '.answer',
      '.prose',
      'article'
    ],
    'Z.ai': [
      '.chat-assistant.markdown-prose',
      '[id^="message-"] .chat-assistant.markdown-prose',
      '[data-message-author-role="assistant"]',
      '[data-role="assistant"]',
      '[data-testid*="assistant"]',
      '[class*="assistant-message"]',
      '[class*="assistant"] [class*="markdown"]'
    ],
    Kimi: [
      '.segment-assistant .markdown-container:not([class*="think" i]):not([class*="thought" i]):not([class*="reason" i])',
      '.chat-content-item-assistant .markdown-container:not([class*="think" i]):not([class*="thought" i]):not([class*="reason" i])',
      '.segment-assistant [class*="markdown" i]:not([class*="think" i]):not([class*="thought" i]):not([class*="reason" i])',
      '.segment-assistant',
      '[class*="segment-assistant" i]',
      '[data-message-author-role="assistant"]',
      '[data-role="assistant"]',
      '[class*="assistant-message" i]',
      '[class*="assistant" i] [class*="markdown" i]:not([class*="think" i]):not([class*="thought" i]):not([class*="reason" i])'
    ]
  };

  const isLateSnapshotRejectedNode = (node) => {
    const tag = String(node?.tagName || '').toLowerCase();
    if (['input', 'textarea', 'button', 'nav', 'header', 'footer', 'form', 'aside'].includes(tag)) return true;
    try {
      return !!node?.closest?.('textarea,input,button,nav,header,footer,form,aside,[contenteditable="true"],[role="combobox"]');
    } catch (_) {
      return false;
    }
  };

  const collectLateSnapshotCandidate = (llmName = detectLlmNameFromLocation(), minChars = 80) => {
    const selectors = lateSnapshotSelectorsByModel[llmName] || [];
    const seen = new Set();
    const nodes = [];
    const visitRoot = (root) => {
      if (!root?.querySelectorAll) return;
      selectors.forEach((selector) => {
        try {
          root.querySelectorAll(selector).forEach((node) => {
            if (node && !seen.has(node)) {
              seen.add(node);
              nodes.push(node);
            }
          });
        } catch (_) {}
      });
      try {
        root.querySelectorAll('*').forEach((node) => {
          if (node?.shadowRoot) visitRoot(node.shadowRoot);
        });
      } catch (_) {}
    };
    visitRoot(document);
    const candidates = nodes
      .filter((node) => node && !isLateSnapshotRejectedNode(node))
      .map((node, index) => {
        const text = extractSafeVisibleText(node, 200000);
        let visible = true;
        try {
          const style = window.getComputedStyle(node);
          visible = style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
        } catch (_) {}
        return { node, text, visible, score: (visible ? 1000000 : 0) + index };
      })
      .filter((item) => item.text.length >= minChars)
      .sort((a, b) => b.score - a.score);
    const best = candidates[0] || null;
    return best
      ? { ok: true, llmName, text: best.text, html: buildInlineHtml(best.node), visible: best.visible, candidates: candidates.length }
      : { ok: false, llmName, text: '', html: '', candidates: candidates.length };
  };

  const simpleSnapshotHash = (value = '') => {
    const text = String(value || '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  };

  const initLateAnswerSnapshotObserver = () => {
    if (window.__LLMLateAnswerSnapshotObserverStarted) return false;
    window.__LLMLateAnswerSnapshotObserverStarted = true;
    let lastHash = '';
    let lastSentAt = 0;
    let timer = null;
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const llmName = detectLlmNameFromLocation();
        if (!llmName) return;
        const snapshot = collectLateSnapshotCandidate(llmName, 80);
        if (!snapshot.ok || !snapshot.text) return;
        const hash = simpleSnapshotHash(snapshot.text);
        const now = Date.now();
        // Throttle streaming snapshots: 900ms debounce above plus min 1200ms between messages.
        if (hash === lastHash || now - lastSentAt < 1200) return;
        lastHash = hash;
        lastSentAt = now;
        const meta = ensureDispatchMeta({}, llmName) || {};
        safeRuntimeSendMessage({
          type: 'ANSWER_SNAPSHOT',
          llmName,
          text: snapshot.text,
          html: snapshot.html || '',
          hash,
          length: snapshot.text.length,
          url: location.href,
          meta
        });
      }, 900);
    };
    try {
      const observer = observeMutations(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true
      }, schedule);
      window.__LLMLateAnswerSnapshotObserver = observer;
      schedule();
      return true;
    } catch (_) {
      return false;
    }
  };

  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.action === 'LATE_COLLECT_PING' || message?.type === 'LATE_COLLECT_PING') {
        sendResponse?.({
          ok: true,
          status: 'late_collect_pong',
          llmName: detectLlmNameFromLocation(),
          href: location.href,
          readyState: document.readyState,
          snapshotObserver: !!window.__LLMLateAnswerSnapshotObserverStarted
        });
        return false;
      }
      return false;
    });
  } catch (_) {}

  initLateAnswerSnapshotObserver();

  window.ContentUtils = {
    sleep,
    buildResponseMeta,
    isElementInteractable,
    isExtensionContextValid,
    getMainBridgeToken,
    setMainBridgeToken,
    getPipelineRunId,
    safeRuntimeSendMessage,
    sendRuntimeMessageForAck,
    storeSessionId,
    storeDispatchMeta,
    getSessionId,
    ensureDispatchMeta,
    pasteTextFirst,
    promptMatchesComposer: pasteMatchesPrompt,
    countPromptOccurrences,
    ensurePromptPrepared,
    reportPromptInsertion,
    reportDispatchStage,
    reportProviderPipelineState,
    reportDispatchBaseline,
    recoverPreparedComposerSend,
    isBaselineEquivalent,
    detectProviderErrorSurface,
    requestFocusFromBackground,
    startActiveRequest,
    stopActiveRequest,
    hasActiveRequest,
    withSmartScroll,
    findAndCacheElement,
    ensureMainWorldBridge,
    ensureScrollToolkit: ensureScrollToolkit,
    ensureHumanoid,
    observeMutations,
    cloneElementWithInlineStyles,
    buildInlineHtml,
    extractSafeVisibleText,
    collectLateSnapshotCandidate,
    initLateAnswerSnapshotObserver
  };
})();
