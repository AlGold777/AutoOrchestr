(function initResponseLifecycleDetector() {
  const VERSION = '2.3.0';
  const BUILD_VERSION = (() => {
    try { return chrome?.runtime?.getManifest?.()?.version || 'unknown'; } catch (_) { return 'unknown'; }
  })();
  const CompletionProtocol = window.CompletionProtocol || (() => {
    if (typeof require !== 'function') return null;
    try { return require('../shared/completion-protocol.js'); } catch (_) { return null; }
  })();
  const existingDetector = window.LLMExtension?.ResponseLifecycleDetector || window.ResponseLifecycleDetector;
  const existingCompatible = existingDetector?.version === VERSION
    && existingDetector?.protocolVersion === CompletionProtocol?.version
    && existingDetector?.buildVersion === BUILD_VERSION;
  if (existingCompatible) {
    try { existingDetector?.announceRuntimeReady?.('compatible_reinjection'); } catch (_) {}
    return;
  }
  try { existingDetector?.dispose?.({ reason: 'runtime_upgrade' }); } catch (_) {}
  const BODY_MUTATION_THROTTLE_MS = 500;
  const ANSWER_GENERATING_TELEMETRY_THROTTLE_MS = 15000;
  const POST_TERMINAL_OBSERVATION_OFFSETS_MS = Object.freeze([1000, 3000, 8000, 15000, 30000]);
  const STUCK_BUSY_OVERRIDE_MIN_MS = 6000;
  const LIFECYCLE_READINESS_RESOLVER_TIMEOUT_MS = 800;
  const RESPONSE_LIFECYCLE_DEFAULTS = {
    enabled: true,
    answerStartTimeoutMs: 30000,
    // The effective per-run value is raised to the active pipeline hardMax:
    // 450s Standard / 900s Long.
    answerCompleteTimeoutMs: 450000,
    stableMs: 1500,
    pollIntervalMs: 600,
    minCompleteConfidence: 0.75,
    completionProtocolV2: 'enforced',
    allowLegacyCompletionRollout: false
  };
  const GENERATING_SELECTORS = [
    '[aria-label*="Stop" i]',
    '[aria-label*="Останов" i]',
    '[aria-label*="Detener" i]',
    '[aria-label*="Arrêter" i]',
    '[title*="Stop" i]',
    '[title*="Останов" i]',
    '[title*="Detener" i]',
    '[title*="Arrêter" i]',
    'button[data-testid*="stop" i]',
    '[aria-busy="true"]',
    '[data-loading="true"]',
    '[class*="loading" i]',
    '[class*="spinner" i]',
    '[class*="streaming" i]',
    '[class*="generating" i]',
    '[role="progressbar"]'
  ];

  const trackers = new Map();
  const trackerStartFlights = new Map();
  const registeredCandidates = new Map();
  const lifecycleDocumentInstanceId = `lifecycle-document-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let lifecycleNavigationEpoch = 0;
  let settingsPromise = null;
  let cachedSettings = null;
  let runtimePatched = false;
  let bodyMutationScheduledAt = 0;
  const answerNodeIds = new WeakMap();
  let nextAnswerNodeId = 1;

  function answerNodeKey(node) {
    if (!node || (typeof node !== 'object' && typeof node !== 'function')) return null;
    if (!answerNodeIds.has(node)) answerNodeIds.set(node, `answer-node-${nextAnswerNodeId++}`);
    return answerNodeIds.get(node);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function sendRuntimeMessageForAck(message, {
    acceptedStatus,
    timeoutMs = 5000,
    attempts = 2
  } = {}) {
    const run = (attempt) => new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => finish({ ok: false, reason: 'ack_timeout' }), timeoutMs);
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const runtimeError = chrome.runtime?.lastError?.message || '';
          if (runtimeError) {
            finish({ ok: false, reason: runtimeError });
            return;
          }
          const ok = response?.status === acceptedStatus;
          finish({
            ok,
            reason: ok ? null : (response?.reason || response?.status || 'ack_rejected'),
            response: response || null
          });
        });
      } catch (error) {
        finish({ ok: false, reason: error?.message || 'runtime_send_failed' });
      }
    }).then(async (result) => {
      if (result.ok || attempt >= attempts) return result;
      await sleep(100 * attempt);
      return run(attempt + 1);
    });
    return run(1);
  }

  function isTrackerActive(tracker) {
    return !!tracker && tracker.state !== 'CANCELLED' && tracker.cancelledAt == null;
  }

  function trackerCancelledResult(tracker) {
    return {
      ok: false,
      state: 'CANCELLED',
      reason: tracker?.cancelReason || 'cancelled'
    };
  }

  function clearTrackerTimers(tracker) {
    if (!tracker) return;
    const pollTimers = Array.isArray(tracker.pollTimers) ? tracker.pollTimers : [];
    const timeoutTimers = Array.isArray(tracker.timeoutTimers) ? tracker.timeoutTimers : [];
    pollTimers.forEach((entry) => {
      try { clearTimeout(entry?.id ?? entry); } catch (_) {}
      try { entry?.resolve?.(false); } catch (_) {}
    });
    timeoutTimers.forEach((entry) => {
      try { clearTimeout(entry?.id ?? entry); } catch (_) {}
      try { entry?.resolve?.(false); } catch (_) {}
    });
    tracker.pollTimers = [];
    tracker.timeoutTimers = [];
  }

  function releaseTrackerResources(tracker, reason = 'terminal_cleanup') {
    if (!tracker || tracker.resourcesReleased) return false;
    tracker.resourcesReleased = true;
    try { tracker.observer?.disconnect?.(); } catch (_) {}
    tracker.observer = null;
    clearTrackerTimers(tracker);
    const waiters = Array.isArray(tracker.completionWaiters) ? tracker.completionWaiters.splice(0) : [];
    waiters.forEach((resolve) => { try { resolve(tracker.completionTerminalResult || null); } catch (_) {} });
    const registered = registeredCandidates.get(tracker.modelName);
    if (!registered || !tracker.traceId || !registered.traceId || String(registered.traceId) === String(tracker.traceId)) {
      registeredCandidates.delete(tracker.modelName);
    }
    tracker.latestAnswerEl = null;
    tracker.baselineElement = null;
    tracker.sendButtonEl = null;
    tracker.observedTarget = null;
    tracker.lastWitnessSignatures?.clear?.();
    if (trackers.get(tracker.modelName) === tracker) trackers.delete(tracker.modelName);
    tracker.releaseReason = reason;
    return true;
  }

  function scheduleTrackerRelease(tracker, delayMs = 2000, reason = 'terminal_cleanup') {
    if (!tracker || tracker.releaseScheduled || tracker.resourcesReleased) return false;
    tracker.releaseScheduled = true;
    setTimeout(() => releaseTrackerResources(tracker, reason), Math.max(0, Number(delayMs || 0)));
    return true;
  }

  function wakeTracker(tracker) {
    if (!isTrackerActive(tracker)) return false;
    const pending = Array.isArray(tracker.pollTimers) ? tracker.pollTimers.splice(0) : [];
    pending.forEach((entry) => {
      try { clearTimeout(entry?.id ?? entry); } catch (_) {}
      try { entry?.resolve?.(true); } catch (_) {}
    });
    return pending.length > 0;
  }

  function wakeAllTrackers() {
    let count = 0;
    trackers.forEach((tracker) => {
      if (wakeTracker(tracker)) count += 1;
    });
    return count;
  }

  function delayForTracker(tracker, ms, timerKind = 'poll') {
    if (!isTrackerActive(tracker)) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      const timerId = setTimeout(() => {
        const list = timerKind === 'timeout' ? tracker.timeoutTimers : tracker.pollTimers;
        if (Array.isArray(list)) {
          const idx = list.findIndex((entry) => entry?.id === timerId || entry === timerId);
          if (idx !== -1) list.splice(idx, 1);
        }
        resolve(isTrackerActive(tracker));
      }, ms);
      const list = timerKind === 'timeout' ? tracker.timeoutTimers : tracker.pollTimers;
      if (Array.isArray(list)) {
        list.push({ id: timerId, resolve });
      }
    });
  }

  function elementRect(el) {
    try {
      const rect = el?.getBoundingClientRect?.();
      if (!rect) return null;
      return {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      };
    } catch (_) {
      return null;
    }
  }

  function isVisible(el) {
    const rect = elementRect(el);
    if (!el || !el.isConnected || !rect || rect.width <= 1 || rect.height <= 1) return false;
    try {
      const style = getComputedStyle(el);
      if (style.display === 'none') return false;
      if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
      if (Number(style.opacity || '1') <= 0.05) return false;
    } catch (_) {}
    return true;
  }

  function isEditableElement(el) {
    if (!el || !isVisible(el)) return false;
    if (el.disabled || el.readOnly) return false;
    if (el.isContentEditable) return true;
    const tagName = String(el.tagName || '').toUpperCase();
    if (tagName === 'TEXTAREA') return true;
    if (tagName === 'INPUT') {
      const type = String(el.getAttribute?.('type') || 'text').toLowerCase();
      return ['text', 'search', 'email', 'url'].includes(type);
    }
    return String(el.getAttribute?.('role') || '').toLowerCase() === 'textbox';
  }

  function detectCheapComposerReadiness(tracker = null) {
    const active = document.activeElement;
    if (isEditableElement(active)) {
      return { composerReady: true, sendButtonReady: false, source: 'active_element' };
    }
    if (tracker?.composerEl && isEditableElement(tracker.composerEl)) {
      const sendButtonReady = !!(tracker.sendButtonEl?.isConnected && !tracker.sendButtonEl.disabled && isVisible(tracker.sendButtonEl));
      return { composerReady: true, sendButtonReady, source: 'tracker_composer' };
    }
    const vh = Math.max(1, window.innerHeight || document.documentElement?.clientHeight || 1);
    const candidates = Array.from(document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]')).slice(0, 60);
    const composer = candidates.find((el) => {
      const rect = elementRect(el);
      return isEditableElement(el) && rect && rect.top >= vh * 0.45;
    });
    if (composer) {
      return { composerReady: true, sendButtonReady: false, source: 'lower_viewport_candidate', composerEl: composer };
    }
    return { composerReady: false, sendButtonReady: false, source: 'inconclusive' };
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function shortHash(input) {
    const text = String(input || '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function platformForModel(modelName) {
    const normalized = String(modelName || '').trim().toLowerCase();
    if (normalized === 'gpt' || normalized === 'chatgpt') return 'chatgpt';
    if (normalized === 'le chat' || normalized === 'mistral') return 'lechat';
    if (normalized === 'z.ai' || normalized === 'zai') return 'zai';
    if (normalized === 'kimi' || normalized === 'moonshot') return 'kimi';
    return normalized;
  }

  function resolveStructuralTurn(modelName, turnAnchor = 0) {
    const platform = platformForModel(modelName);
    const selectors = window.AnswerPipelineSelectors?.PLATFORM_SELECTORS?.[platform];
    if (!selectors || !window.TurnResolver?.resolveTurn) return null;
    return window.TurnResolver.resolveTurn({
      platform,
      selectors,
      document,
      anchorAnswerCount: Math.max(0, Number(turnAnchor || 0)),
      minimumTextLength: 1
    });
  }

  function captureTurnAnchor(modelName) {
    const turn = resolveStructuralTurn(modelName, 0);
    return turn && Array.isArray(turn.candidates) ? turn.candidates.length : null;
  }

  function captureStructuralSnapshot(tracker) {
    if (!tracker || !window.AnswerStructure?.inspect || !window.GenerationSignal?.inspect) return null;
    const platform = platformForModel(tracker.modelName);
    const selectors = window.AnswerPipelineSelectors?.PLATFORM_SELECTORS?.[platform];
    const turn = resolveStructuralTurn(tracker.modelName, tracker.turnAnchor);
    if (!selectors || !turn?.answerNode) return null;
    const selectedText = window.AnswerStructure.linearizeText(turn.answerNode);
    const messageRootText = window.AnswerStructure.linearizeText(turn.messageRoot);
    const structure = window.AnswerStructure.inspect(turn.messageRoot, turn.answerNode);
    const generation = window.GenerationSignal.inspect({
      selectors,
      queryAll: (selector) => {
        try { return Array.from(document.querySelectorAll(selector)); } catch (_) { return []; }
      }
    });
    const identity = window.ContentUtils?.ensureDispatchMeta?.({
      runSessionId: tracker.runSessionId || null,
      dispatchId: tracker.dispatchId || null
    }, tracker.modelName) || {};
    const nodes = turn.candidates.slice(-12).map((node) => {
      const text = window.AnswerStructure.linearizeText(node);
      return {
        tag: String(node?.tagName || '').toLowerCase(),
        role: node?.getAttribute?.('role') || null,
        length: text.length,
        hash: shortHash(text)
      };
    });
    const selectedCandidateIndex = turn.candidates.indexOf(turn.answerNode);
    return {
      observedAt: Date.now(),
      runSessionId: identity.runSessionId ?? tracker.runSessionId ?? null,
      dispatchId: identity.dispatchId ?? tracker.dispatchId ?? null,
      generationEpoch: identity.generationEpoch ?? null,
      turnAnchor: tracker.turnAnchor ?? null,
      selectedHash: shortHash(selectedText),
      selectedLength: selectedText.length,
      selectedNodeKey: answerNodeKey(turn.answerNode),
      selectedCandidateIndex,
      candidateOrdinalAfterAnchor: selectedCandidateIndex >= 0
        ? selectedCandidateIndex - Number(tracker.turnAnchor || 0) + 1
        : null,
      messageRootHash: shortHash(messageRootText),
      messageRootLength: messageRootText.length,
      candidateSetHash: shortHash(JSON.stringify(nodes)),
      candidateCount: turn.candidates.length,
      nodes,
      resolution: turn.resolution,
      resolutionReason: turn.reason,
      messageRootSelector: turn.messageRootSelector || null,
      structuralComplete: turn.resolution === 'exact' && structure.complete === true,
      structuralIssues: Array.isArray(structure.issues) ? structure.issues : [],
      selectedHtml: String(turn.answerNode?.innerHTML || ''),
      structuralHash: shortHash(String(turn.answerNode?.innerHTML || '')),
      generationActive: generation.active,
      generationSignalKind: generation.kind,
      generationSignalSelector: generation.selector || null,
      generationSignalChecks: Array.isArray(generation.checks) ? generation.checks : [],
      _selectedText: selectedText
    };
  }

  async function verifyStructuralCompletion(tracker) {
    if (!window.AnswerVerification?.verifySnapshotPair) return null;
    if (typeof window.AnswerPipelineTiming?.whenProfileReady === 'function') {
      await window.AnswerPipelineTiming.whenProfileReady();
    }
    const finalization = window.AnswerPipelineConfig?.finalization;
    if (!finalization) return null;
    const checks = Math.max(2, Number(finalization.stabilityChecks || 2));
    const retryBudget = Math.max(0, Number(finalization.stabilityRetryBudget || 0));
    const interval = Math.max(5, Number(finalization.stabilityInterval || 25));
    const maxSnapshots = checks + retryBudget;
    let previous = null;
    let latest = null;
    let latestResult = null;
    let verifiedCount = 0;
    let maxObservedTextLength = 0;
    let lengthDecreaseCount = 0;
    let lastLengthDecrease = null;
    let lengthRegressionActive = false;
    let lengthRegressionFloor = 0;
    const recentLengths = [];
    for (let index = 0; index < maxSnapshots; index += 1) {
      if (!isTrackerActive(tracker)) return null;
      latest = captureStructuralSnapshot(tracker);
      if (!latest) return null;
      const selectedLength = Number(latest.selectedLength || 0);
      const maximumBeforeSnapshot = maxObservedTextLength;
      maxObservedTextLength = Math.max(maxObservedTextLength, selectedLength);
      recentLengths.push({ observedAt: latest.observedAt, length: latest.selectedLength, nodeKey: latest.selectedNodeKey });
      if (recentLengths.length > 12) recentLengths.shift();
      if (previous) {
        if (selectedLength < Number(previous.selectedLength || 0)) {
          lengthDecreaseCount += 1;
          lengthRegressionActive = true;
          lengthRegressionFloor = Math.max(lengthRegressionFloor, maximumBeforeSnapshot, Number(previous.selectedLength || 0));
          lastLengthDecrease = {
            observedAt: latest.observedAt,
            from: Number(previous.selectedLength || 0),
            to: selectedLength,
            delta: selectedLength - Number(previous.selectedLength || 0),
            recoveryFloor: lengthRegressionFloor
          };
          emitLifecycleTelemetry('ANSWER_LENGTH_DECREASED', {
            modelName: tracker.modelName, state: tracker.state, level: 'warning',
            textLength: latest.selectedLength, phaseEvidence: lastLengthDecrease
          });
        }
        if (lengthRegressionActive && selectedLength >= lengthRegressionFloor) {
          lengthRegressionActive = false;
          verifiedCount = 0;
          emitLifecycleTelemetry('ANSWER_LENGTH_REGRESSION_RECOVERED', {
            modelName: tracker.modelName, state: tracker.state, level: 'info',
            textLength: selectedLength,
            phaseEvidence: { selectedLength, recoveryFloor: lengthRegressionFloor }
          });
        }
        if (previous.selectedNodeKey && latest.selectedNodeKey && previous.selectedNodeKey !== latest.selectedNodeKey) {
          emitLifecycleTelemetry('ANSWER_NODE_REPLACED', {
            modelName: tracker.modelName, state: tracker.state, level: 'warning',
            textLength: latest.selectedLength,
            phaseEvidence: { previousNodeKey: previous.selectedNodeKey, selectedNodeKey: latest.selectedNodeKey }
          });
        }
        latestResult = window.AnswerVerification.verifySnapshotPair(previous, latest, { minimumLength: 1 });
        verifiedCount = lengthRegressionActive ? 0 : (latestResult.verified ? verifiedCount + 1 : 0);
        if (verifiedCount >= checks - 1) {
          const { _selectedText, ...snapshot } = latest;
          const verifiedSnapshot = {
            ...latestResult,
            ...snapshot,
            snapshotsCompared: index + 1,
            requiredSnapshots: checks,
            retryBudget,
            retriesUsed: Math.max(0, index + 1 - checks),
            maxObservedTextLength,
            lengthDecreaseCount,
            lastLengthDecrease,
            lengthRegressionActive,
            lengthRegressionFloor,
            recentLengths,
            candidateFirstSeenAt: tracker.answerStartedAt || latest.observedAt,
            firstMutationAfterDispatchAt: tracker.firstMutationAfterDispatchAt || null,
            effectiveConfig: window.AnswerPipelineTiming?.getEffectiveSnapshot?.() || null,
            selectedText: _selectedText
          };
          const selectedBaselineHash = shortHash(normalizeText(_selectedText || ''));
          const baselineEquivalent = tracker.baselineTextLength > 0
            && selectedBaselineHash === tracker.baselineTextHash;
          verifiedSnapshot.baselineEquivalent = baselineEquivalent;
          if (baselineEquivalent) {
            return {
              ...verifiedSnapshot,
              verified: false,
              state: 'candidate',
              reasons: Array.from(new Set([
                ...(Array.isArray(verifiedSnapshot.reasons) ? verifiedSnapshot.reasons : []),
                'stale_baseline_answer'
              ]))
            };
          }
          return verifiedSnapshot;
        }
      }
      previous = latest;
      if (index + 1 < maxSnapshots && !(await delayForTracker(tracker, interval, 'poll'))) return null;
    }
    const { _selectedText, ...snapshot } = latest || {};
    if (latest && lengthRegressionActive) {
      const result = {
        ...(latestResult || {}),
        ...snapshot,
        verified: false,
        state: 'candidate',
        snapshotsCompared: maxSnapshots,
        requiredSnapshots: checks,
        retryBudget,
        retriesUsed: Math.max(0, maxSnapshots - checks),
        maxObservedTextLength,
        lengthDecreaseCount,
        lastLengthDecrease,
        lengthRegressionActive,
        lengthRegressionFloor,
        recentLengths,
        candidateFirstSeenAt: tracker.answerStartedAt || latest?.observedAt || null,
        firstMutationAfterDispatchAt: tracker.firstMutationAfterDispatchAt || null,
        effectiveConfig: window.AnswerPipelineTiming?.getEffectiveSnapshot?.() || null,
        selectedText: _selectedText || ''
      };
      result.reasons = Array.from(new Set([
        ...(Array.isArray(result.reasons) ? result.reasons : []),
        'answer_length_regression_unrecovered'
      ]));
      return result;
    }
    return latest ? {
      ...(latestResult || { verified: false, state: 'candidate', reasons: ['insufficient_stable_observations'] }),
      ...snapshot,
      verified: false,
      state: 'candidate',
      snapshotsCompared: maxSnapshots,
      requiredSnapshots: checks,
      retryBudget,
      retriesUsed: Math.max(0, maxSnapshots - checks),
      maxObservedTextLength,
      lengthDecreaseCount,
      lastLengthDecrease,
      lengthRegressionActive,
      lengthRegressionFloor,
      recentLengths,
      candidateFirstSeenAt: tracker.answerStartedAt || latest?.observedAt || null,
      firstMutationAfterDispatchAt: tracker.firstMutationAfterDispatchAt || null,
      effectiveConfig: window.AnswerPipelineTiming?.getEffectiveSnapshot?.() || null,
      selectedText: _selectedText || ''
    } : null;
  }

  async function readStorage(key) {
    try {
      if (chrome?.storage?.local?.get) {
        const result = await chrome.storage.local.get({ [key]: null });
        return result?.[key] ?? null;
      }
    } catch (_) {}
    try {
      const raw = window.localStorage?.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  async function getSettings() {
    if (cachedSettings) return cachedSettings;
    if (!settingsPromise) {
      settingsPromise = readStorage('responseLifecycleDetectorSettings')
        .then((stored) => {
          const settings = Object.assign({}, RESPONSE_LIFECYCLE_DEFAULTS, stored || {});
          // Completion is a mandatory correctness boundary. Historical
          // `enabled:false` and shadow defaults may not disable that boundary.
          settings.enabled = true;
          settings.completionProtocolV2 = settings.allowLegacyCompletionRollout === true
            ? CompletionProtocol?.CompletionRollout?.normalize?.(settings.completionProtocolV2)
            : 'enforced';
          return settings;
        })
        .catch(() => Object.assign({}, RESPONSE_LIFECYCLE_DEFAULTS))
        .then((settings) => {
          cachedSettings = settings;
          return settings;
        });
    }
    return settingsPromise;
  }

  function emitLifecycleTelemetry(event, payload = {}) {
    try {
      const tracker = trackers.get(payload.modelName) || null;
      const candidateId = payload.candidateId || tracker?.candidateId || null;
      chrome.runtime.sendMessage({
        type: 'LLM_DIAGNOSTIC_EVENT',
        llmName: payload.modelName,
        event: {
          type: 'LIFECYCLE',
          label: event,
          level: payload.level || (payload.state === 'ERROR' ? 'warning' : 'info'),
          details: `state=${payload.state || 'n/a'} textLength=${payload.textLength || 0}`,
          meta: {
            modelName: payload.modelName || null,
            runSessionId: payload.runSessionId ?? tracker?.runSessionId ?? null,
            dispatchId: payload.dispatchId ?? tracker?.dispatchId ?? null,
            generationEpoch: payload.generationEpoch ?? tracker?.generationEpoch ?? null,
            turnAnchor: payload.turnAnchor ?? tracker?.turnAnchor ?? null,
            turnId: payload.turnId || (tracker?.turnAnchor !== null && tracker?.turnAnchor !== undefined ? `turn-anchor:${tracker.turnAnchor}` : null),
            candidateId,
            documentInstanceId: payload.documentInstanceId || tracker?.documentInstanceId || lifecycleDocumentInstanceId,
            navigationEpoch: payload.navigationEpoch ?? tracker?.navigationEpoch ?? lifecycleNavigationEpoch,
            state: payload.state || null,
            textLength: payload.textLength || 0,
            answerHash: payload.answerHash || tracker?.lastTextHash || null,
            normalizedLength: payload.normalizedLength ?? null,
            normalizedHash: payload.normalizedHash || null,
            normalizationVersion: payload.normalizationVersion || null,
            observationWindowClosed: payload.observationWindowClosed ?? null,
            observationWindowOutcome: payload.observationWindowOutcome || null,
            observationCoverage: payload.observationCoverage || null,
            observationOffsetMs: payload.observationOffsetMs ?? null,
            observationSampleCount: payload.observationSampleCount ?? null,
            elapsedMs: payload.elapsedMs || 0,
            stableMs: payload.stableMs || 0,
            mutationCount: payload.mutationCount || 0,
            hasStopButton: !!payload.hasStopButton,
            hasLoadingIndicator: !!payload.hasLoadingIndicator,
            composerReady: !!payload.composerReady,
            sendButtonReady: !!payload.sendButtonReady,
            confidence: typeof payload.confidence === 'number' ? payload.confidence : null,
            answerMethod: payload.answerMethod || null,
            responsePhase: payload.responsePhase || null,
            observerStoppedAt: payload.observerStoppedAt ?? null,
            stopReason: payload.stopReason ?? null,
            phaseEvidence: payload.phaseEvidence || null
          }
        }
      });
    } catch (_) {}
  }

  function completionRuntimeDescriptor() {
    return {
      buildVersion: BUILD_VERSION,
      detectorVersion: VERSION,
      protocolVersion: CompletionProtocol?.version || null,
      completionSessionAvailable: typeof CompletionProtocol?.CompletionSession === 'function',
      authorityMode: RESPONSE_LIFECYCLE_DEFAULTS.completionProtocolV2
    };
  }

  function announceRuntimeReady(reason = 'detector_initialized') {
    const runtime = completionRuntimeDescriptor();
    try {
      chrome.runtime.sendMessage({
        type: 'COMPLETION_RUNTIME_READY',
        reason,
        runtime
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  function closePostTerminalObservationWindow(tracker, outcome, measurement = {}) {
    const audit = tracker?.postTerminalObservation;
    if (!audit || audit.closed) return false;
    audit.closed = true;
    const unavailable = outcome === 'unavailable';
    emitLifecycleTelemetry('POST_TERMINAL_ANSWER_WINDOW_CLOSED', {
      modelName: tracker.modelName,
      state: 'POST_TERMINAL_AUDIT',
      textLength: unavailable ? 0 : Number(measurement.textLength ?? audit.lastLength ?? audit.baselineLength ?? 0),
      answerHash: unavailable ? null : (measurement.answerHash || audit.lastHash || audit.baselineHash || null),
      normalizedLength: unavailable ? null : (measurement.normalizedLength ?? audit.lastNormalizedLength ?? audit.baselineNormalizedLength ?? null),
      normalizedHash: unavailable ? null : (measurement.normalizedHash || audit.lastNormalizedHash || audit.baselineNormalizedHash || null),
      normalizationVersion: unavailable ? null : (measurement.normalizationVersion || audit.normalizationVersion || null),
      observationWindowClosed: true,
      observationWindowOutcome: outcome,
      observationCoverage: unavailable ? 'unavailable' : 'complete',
      observationOffsetMs: Math.max(0, Date.now() - audit.startedAt),
      observationSampleCount: audit.sampleCount
    });
    scheduleTrackerRelease(tracker, 0, `post_terminal_${outcome}`);
    return true;
  }

  function schedulePostTerminalObservationWindow(tracker, baseline = {}) {
    if (!tracker || tracker.postTerminalObservation) return false;
    tracker.postTerminalObservation = {
      startedAt: Date.now(),
      baselineLength: Number(baseline.textLength || 0),
      baselineHash: baseline.answerHash || null,
      baselineNormalizedLength: baseline.normalizedLength ?? null,
      baselineNormalizedHash: baseline.normalizedHash || null,
      normalizationVersion: baseline.normalizationVersion || null,
      lastLength: Number(baseline.textLength || 0),
      lastHash: baseline.answerHash || null,
      lastNormalizedLength: baseline.normalizedLength ?? null,
      lastNormalizedHash: baseline.normalizedHash || null,
      sampleCount: 0,
      closed: false
    };
    POST_TERMINAL_OBSERVATION_OFFSETS_MS.forEach((offsetMs, index) => {
      const timerEntry = { id: null };
      timerEntry.id = setTimeout(async () => {
        const timers = tracker.timeoutTimers || [];
        const timerIndex = timers.indexOf(timerEntry);
        if (timerIndex !== -1) timers.splice(timerIndex, 1);
        if (!isTrackerActive(tracker) || tracker.postTerminalObservation?.closed) return;
        const snapshot = await getLatestAnswerSnapshot(tracker.modelName, tracker.traceId);
        if (!isTrackerActive(tracker) || tracker.postTerminalObservation?.closed) return;
        const text = String(snapshot?.rawText || snapshot?.text || '').trim();
        if (!text) {
          if (index === POST_TERMINAL_OBSERVATION_OFFSETS_MS.length - 1) {
            closePostTerminalObservationWindow(tracker, 'unavailable');
          }
          return;
        }
        const attemptId = `${tracker.traceId || tracker.dispatchId || tracker.modelName}:post-terminal:${index + 1}`;
        const proof = window.AnswerProofNormalization?.evidence?.(text, {
          dispatchId: tracker.dispatchId || null,
          attemptId
        }) || null;
        const measurement = {
          textLength: text.length,
          answerHash: shortHash(normalizeText(text)),
          normalizedLength: proof?.normalizedLength ?? null,
          normalizedHash: proof?.normalizedHash || null,
          normalizationVersion: proof?.normalizationVersion || null
        };
        const audit = tracker.postTerminalObservation;
        audit.sampleCount += 1;
        audit.lastLength = measurement.textLength;
        audit.lastHash = measurement.answerHash;
        audit.lastNormalizedLength = measurement.normalizedLength;
        audit.lastNormalizedHash = measurement.normalizedHash;
        emitLifecycleTelemetry('POST_TERMINAL_ANSWER_OBSERVED', {
          modelName: tracker.modelName,
          state: 'POST_TERMINAL_AUDIT',
          ...measurement,
          observationWindowClosed: false,
          observationWindowOutcome: 'observed',
          observationCoverage: 'partial',
          observationOffsetMs: offsetMs,
          observationSampleCount: audit.sampleCount
        });
        if (index === POST_TERMINAL_OBSERVATION_OFFSETS_MS.length - 1) {
          const growth = Number(measurement.normalizedLength ?? measurement.textLength)
            > Number(audit.baselineNormalizedLength ?? audit.baselineLength);
          closePostTerminalObservationWindow(tracker, growth ? 'changed' : 'unchanged', measurement);
        }
      }, offsetMs);
      tracker.timeoutTimers.push(timerEntry);
    });
    return true;
  }

  function detectResponsePhaseEvidence(modelName, snapshotElement = null) {
    const normalizedModel = String(modelName || '').trim().toLowerCase();
    if (normalizedModel !== 'qwen') {
      return {
        phase: 'unknown',
        snapshotInsideReasoning: false,
        snapshotInsideAnswer: false,
        reasoningVisible: false,
        answerVisible: false,
        reasoningTextLength: 0,
        answerTextLength: 0
      };
    }
    const reasoningSelectors = [
      '[class*="reasoning" i]',
      '[class*="thinking" i]',
      '[data-testid*="reason" i]',
      '[data-testid*="think" i]',
      '[aria-label*="reason" i]',
      '[aria-label*="think" i]'
    ];
    const answerSelectors = [
      '.qwen-chat-message-assistant .custom-qwen-markdown',
      '.qwen-chat-message-assistant .qwen-markdown',
      '[data-testid="chat-response"] .qwen-markdown'
    ];
    const collectVisible = (selectors) => {
      const nodes = [];
      selectors.forEach((selector) => {
        try {
          document.querySelectorAll(selector).forEach((node) => {
            if (isVisible(node) && !nodes.includes(node)) nodes.push(node);
          });
        } catch (_) {}
      });
      return nodes;
    };
    const reasoningNodes = collectVisible(reasoningSelectors);
    const answerNodes = collectVisible(answerSelectors);
    const containsSnapshot = (nodes) => !!snapshotElement && nodes.some((node) => (
      node === snapshotElement
      || node.contains?.(snapshotElement)
      || snapshotElement.contains?.(node)
    ));
    const maxTextLength = (nodes) => nodes.reduce((max, node) => Math.max(
      max,
      normalizeText(node.innerText || node.textContent || '').length
    ), 0);
    const snapshotInsideReasoning = containsSnapshot(reasoningNodes);
    const snapshotInsideAnswer = containsSnapshot(answerNodes);
    const reasoningVisible = reasoningNodes.length > 0;
    const answerVisible = answerNodes.length > 0;
    const phase = snapshotInsideReasoning && !snapshotInsideAnswer
      ? 'reasoning'
      : snapshotInsideAnswer && !snapshotInsideReasoning
        ? 'answer'
        : reasoningVisible && !answerVisible
          ? 'reasoning'
          : reasoningVisible && answerVisible
            ? 'mixed'
            : 'unknown';
    return {
      phase,
      snapshotInsideReasoning,
      snapshotInsideAnswer,
      reasoningVisible,
      answerVisible,
      reasoningTextLength: maxTextLength(reasoningNodes),
      answerTextLength: maxTextLength(answerNodes)
    };
  }

  function isTextStable(previous, current, stableSince, stableMs) {
    const currentHash = shortHash(normalizeText(current || ''));
    const previousHash = previous?.hash || null;
    const previousLength = previous?.length || 0;
    const currentLength = normalizeText(current || '').length;
    if (currentHash !== previousHash || Math.abs(currentLength - previousLength) > 2) {
      return {
        stable: false,
        hash: currentHash,
        length: currentLength,
        stableSince: Date.now()
      };
    }
    return {
      stable: Date.now() - stableSince >= stableMs,
      hash: currentHash,
      length: currentLength,
      stableSince
    };
  }

  function detectGeneratingIndicators({ modelName = null, root = document }) {
    const indicators = [];
    const canQuery = !!(root && typeof root.querySelectorAll === 'function');
    let queriesAttempted = 0;
    let queriesFailed = 0;
    const platform = platformForModel(modelName);
    const platformSelectors = window.AnswerPipelineSelectors?.PLATFORM_SELECTORS?.[platform] || null;
    const selectorApi = window.GenerationSignal;
    const configuredDescriptors = platformSelectors && selectorApi?.selectorList
      ? [
          ...selectorApi.selectorList(platformSelectors.generatingIndicators).map((selector) => ({ selector, kind: 'generating' })),
          ...selectorApi.selectorList(platformSelectors.streaming).map((selector) => ({ selector, kind: 'streaming' })),
          ...selectorApi.selectorList(platformSelectors.stopButton).map((selector) => ({ selector, kind: 'stopButton' })),
          ...GENERATING_SELECTORS.filter((selector) => /stop|останов|detener|arrêter/i.test(selector))
            .map((selector) => ({ selector, kind: 'stopButton' }))
        ]
      : GENERATING_SELECTORS.map((selector) => ({ selector, kind: 'legacy' }));
    if (canQuery) {
      for (const descriptor of configuredDescriptors) {
        const { selector } = descriptor;
        queriesAttempted += 1;
        try {
          const visible = selectorApi?.isVisible
            ? (node) => selectorApi.isVisible(node)
            : (node) => isVisible(node);
          const nodes = Array.from(root.querySelectorAll(selector)).filter((node) => {
            if (!visible(node)) return false;
            if (descriptor.kind === 'stopButton' || /stop|останов|detener|arrêter/i.test(selector)) {
              return !node.disabled
                && node.getAttribute?.('aria-disabled') !== 'true'
                && node.getAttribute?.('data-disabled') !== 'true';
            }
            return true;
          });
          if (nodes.length) indicators.push(descriptor);
        } catch (_) { queriesFailed += 1; }
      }
    }
    // Localized stop labels (Останов/Detener/Arrêter) do not contain "stop"; without
    // matching them a present stop button would read as absent -> false completion.
    const hasStopButton = indicators.some(({ selector, kind }) =>
      kind === 'stopButton' || /stop|останов|detener|arrêter/i.test(selector));
    const hasLoadingIndicator = indicators.some(({ selector, kind }) =>
      kind === 'generating' || /busy|loading|spinner|generating/i.test(selector));
    const hasStreamingCursor = indicators.some(({ selector, kind }) =>
      kind === 'streaming' || /streaming/i.test(selector));
    const hasProgressbar = indicators.some(({ selector }) => /progressbar/i.test(selector));
    // Tri-state completion contract: the probe is trustworthy only if we could query the
    // DOM and not every query threw. When untrustworthy, "no stop button" means UNKNOWN,
    // not "generation finished" — so completion must NOT be inferred from absence
    // (unknown !== false). Genuine absence (probe ran, nothing matched) stays `false`.
    const probeTrusted = canQuery && queriesAttempted > 0 && queriesFailed < queriesAttempted;
    const stopButtonSignal = hasStopButton ? true : (probeTrusted ? false : 'unknown');
    return {
      hasStopButton,
      hasLoadingIndicator,
      hasStreamingCursor,
      hasProgressbar,
      stopButtonSignal,
      probeTrusted,
      indicators: indicators.map(({ selector }) => selector),
      diagnostics: { platform, configured: !!platformSelectors }
    };
  }

  async function getLatestAnswerSnapshot(modelName, traceId = null) {
    const tracker = trackers.get(modelName);
    const turn = resolveStructuralTurn(modelName, tracker?.turnAnchor || 0);
    if (turn?.resolution === 'exact' && turn.answerNode) {
      const rawText = window.AnswerStructure?.linearizeText?.(turn.answerNode)
        || String(turn.answerNode.innerText || turn.answerNode.textContent || '').trim();
      const text = normalizeText(rawText);
      return { element: turn.answerNode, text, rawText, textLength: text.length,
        method: 'current_turn', traceId };
    }
    const resolver = window.LLMExtension?.SelectorResolverV2;
    const registered = registeredCandidates.get(modelName);
    const registeredMatchesTrace = !traceId || !registered?.traceId || String(registered.traceId) === String(traceId);
    if (registeredMatchesTrace && registered?.element?.isConnected) {
      const rawText = String(registered.element.innerText || registered.element.textContent || '').trim();
      const text = normalizeText(rawText);
      return {
        element: registered.element,
        text,
        rawText,
        textLength: text.length,
        method: registered.method || 'registered',
        traceId
      };
    }
    if (resolver?.resolveLatestAssistantAnswer) {
      const result = await resolver.resolveLatestAssistantAnswer({
        modelName,
        reason: 'collect',
        traceId
      });
      if (result?.ok && result.element) {
        const rawText = String(result.element.innerText || result.element.textContent || '').trim();
        const text = normalizeText(rawText);
        return {
          element: result.element,
          text,
          rawText,
          textLength: text.length,
          method: result.method || 'resolver',
          traceId
        };
      }
    }
    return {
      element: null,
      text: '',
      textLength: 0,
      method: 'none',
      traceId
    };
  }

  function attachTrackerObserver(tracker, target) {
    if (!tracker || !target || !target.isConnected) return false;
    if (tracker.observer) {
      try { tracker.observer.disconnect(); } catch (_) {}
      tracker.observer = null;
    }
    const observeTarget = target === document.body ? document.body : target;
    if (!observeTarget) return false;
    const observingBody = observeTarget === document.body;
    const observer = new MutationObserver((mutations) => {
      const now = Date.now();
      if (observingBody && now - bodyMutationScheduledAt < BODY_MUTATION_THROTTLE_MS) {
        // Throttle accounting, not liveness: a Stop/loading removal can be the
        // second mutation in the window and must still wake a sleeping check.
        wakeTracker(tracker);
        return;
      }
      bodyMutationScheduledAt = now;
      tracker.lastMutationAt = now;
      if (!tracker.firstMutationAfterDispatchAt && now >= Number(tracker.promptSubmittedAt || 0)) {
        tracker.firstMutationAfterDispatchAt = now;
      }
      tracker.mutationCount += 1;
      if (tracker.completionSession && CompletionProtocol?.MutationClassifier) {
        const currentText = normalizeText(tracker.latestAnswerEl?.innerText || tracker.latestAnswerEl?.textContent || '');
        const currentHash = shortHash(currentText);
        const currentStructuralHash = shortHash(String(tracker.latestAnswerEl?.innerHTML || ''));
        const classifications = new CompletionProtocol.MutationClassifier().classify(mutations, {
          responseRoot: tracker.latestAnswerEl,
          normalizedBefore: tracker.lastSemanticMutationHash,
          normalizedAfter: currentHash,
          structuralBefore: tracker.lastSemanticStructuralHash,
          structuralAfter: currentStructuralHash,
          isProducerControl: (node) => !!node?.closest?.('button,[role="button"],[aria-label*="stop" i],[data-testid*="stop" i]'),
          isCosmetic: (node) => !!node?.closest?.('[aria-live],[class*="cursor" i],[class*="toolbar" i]')
        });
        const substantive = classifications.find((item) => item.substantive);
        if (substantive) {
          tracker.lastSemanticMutationHash = currentHash;
          tracker.lastSemanticStructuralHash = currentStructuralHash;
          appendCompletionWitness(tracker, substantive.kind === 'CONTENT_PROGRESS' ? 'CONTENT_PROGRESS' : 'RESPONSE_STRUCTURE_CHANGED', {
            mutationCount: mutations.length
          }, 'MutationClassifier');
        } else if (classifications.some((item) => item.kind === 'COSMETIC')) {
          appendCompletionWitness(tracker, 'COSMETIC_MUTATION', { mutationCount: mutations.length }, 'MutationClassifier');
        }
      }
      wakeTracker(tracker);
    });
    observer.observe(observeTarget, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true
    });
    tracker.observer = observer;
    tracker.observedTarget = observeTarget;
    return true;
  }

  function registerAnswerCandidate({
    modelName,
    element,
    method,
    selector,
    score,
    confidence,
    traceId,
    observedAt
  }) {
    if (!modelName || !element) return false;
    registeredCandidates.set(modelName, {
      modelName,
      element,
      method: method || 'resolver',
      selector: selector || null,
      score: Number(score || 0),
      confidence: Number(confidence || 0),
      traceId: traceId || null,
      observedAt: observedAt || Date.now()
    });
    const tracker = trackers.get(modelName);
    if (tracker) {
      tracker.latestAnswerEl = element;
      // Generation controls usually live outside the answer node. Keep the
      // observer on the page body so removal of Stop/loading wakes completion
      // checks even while Chrome throttles timers in a background tab.
      attachTrackerObserver(tracker, document.body);
    }
    return true;
  }

  function createTracker({
    modelName,
    dispatchId = null,
    runSessionId = null,
    generationEpoch = null,
    candidateId = null,
    documentInstanceId = lifecycleDocumentInstanceId,
    navigationEpoch = lifecycleNavigationEpoch,
    promptSubmittedAt = Date.now(),
    traceId = null,
    baselineSnapshot = null
  }) {
    return {
      modelName,
      dispatchId,
      runSessionId,
      generationEpoch,
      candidateId,
      documentInstanceId,
      navigationEpoch,
      navigationUrl: window.location.href,
      sendActionAt: null,
      preservedNavigation: null,
      traceId,
      startedAt: Date.now(),
      promptSubmittedAt,
      observationStartedAt: null,
      observationPromise: null,
      attemptAuthorityAcceptedAt: null,
      attemptAuthorityResponse: null,
      lifecycleSettings: null,
      completionRolloutMode: null,
      baselineElement: baselineSnapshot?.element || null,
      baselineTextHash: shortHash(normalizeText(baselineSnapshot?.text || '')),
      baselineTextLength: Number(baselineSnapshot?.textLength || 0),
      baselineCapturedAt: Date.now(),
      turnAnchor: null,
      freshAnswerObserved: false,
      answerStartedAt: null,
      lastMutationAt: 0,
      firstMutationAfterDispatchAt: null,
      lastTextChangeAt: 0,
      lastTextHash: null,
      lastTextLength: 0,
      stableSince: Date.now(),
      state: 'ATTEMPT_PREPARED',
      latestAnswerEl: null,
      latestAnswerText: '',
      mutationCount: 0,
      diagnostics: {},
      observer: null,
      observedTarget: null,
      pollTimers: [],
      timeoutTimers: [],
      finalReadinessCheckedAt: null,
      nextStructuralVerificationAt: 0,
      cancelledAt: null,
      cancelReason: null,
      cancelled: false,
      completionSession: null,
      completionTerminalResult: null,
      completionWaiters: [],
      lastWitnessSignatures: new Map(),
      lastSemanticMutationHash: shortHash(normalizeText(baselineSnapshot?.text || '')),
      lastSemanticStructuralHash: shortHash(String(baselineSnapshot?.element?.innerHTML || ''))
    };
  }

  function appendCompletionWitness(tracker, type, payload = null, source = 'ResponseLifecycleDetector') {
    if (!tracker?.completionSession || tracker.completionTerminalResult) return null;
    const witnessGroup = ({
      STOP_VISIBLE: 'stop', STOP_ABSENT: 'stop',
      GENERATION_ACTIVE: 'generation', GENERATION_INACTIVE: 'generation',
      FRESH_RESPONSE_OBSERVED: 'fresh', CONTENT_PROGRESS: 'content',
      RESPONSE_STRUCTURE_CHANGED: 'structure', COSMETIC_MUTATION: 'cosmetic',
      PROVIDER_ERROR_VISIBLE: 'provider-error', CONTINUE_VISIBLE: 'continue'
    })[type] || type;
    const witnessSignature = `${type}:${JSON.stringify(payload || null)}`;
    const repeatedTerminalCandidate = ['STOP_ABSENT', 'GENERATION_INACTIVE', 'COPY_VISIBLE', 'REGENERATE_VISIBLE', 'COMPLETION_MARKER_VISIBLE'].includes(type)
      && tracker.completionSession?.producer?.state === 'ACTIVE';
    if (!repeatedTerminalCandidate && tracker.lastWitnessSignatures?.get(witnessGroup) === witnessSignature) return null;
    tracker.lastWitnessSignatures?.set(witnessGroup, witnessSignature);
    let record = null;
    try {
      record = tracker.completionSession.observe({ type, observedAt: Date.now(), source, payload });
    } catch (_) { return null; }
    return record;
  }

  function emitCompletionTransition(tracker, transition) {
    if (!tracker || !transition?.type) return;
    emitLifecycleTelemetry(transition.type, {
      modelName: tracker.modelName,
      state: transition.terminalResult?.status || tracker.state,
      level: transition.terminalResult && transition.terminalResult.status !== 'SUCCESS_TERMINAL' ? 'warning' : 'info',
      phaseEvidence: {
        ...transition,
        protocolVersion: CompletionProtocol?.version || null,
        rolloutMode: tracker.completionSession?.rolloutMode || null,
        facts: tracker.completionSession ? { ...tracker.completionSession.facts } : null
      }
    });
    if (transition.type === 'TERMINAL_DECISION' && transition.terminalResult) {
      try {
        chrome.runtime.sendMessage({
          type: 'LLM_COMPLETION_TERMINAL',
          llmName: tracker.modelName,
          meta: {
            runSessionId: tracker.runSessionId,
            dispatchId: tracker.dispatchId,
            generationEpoch: tracker.generationEpoch,
            rolloutMode: tracker.completionSession?.rolloutMode || 'enforced',
            protocolVersion: CompletionProtocol?.version || null,
            terminalResult: transition.terminalResult
          }
        });
      } catch (_) {}
    }
  }

  function commitCompletionResult(tracker, result) {
    if (!tracker || !result || tracker.completionTerminalResult) return tracker?.completionTerminalResult || null;
    tracker.completionTerminalResult = result;
    tracker.state = result.status;
    const shadowComparison = CompletionProtocol?.CompletionRollout?.compare?.({
      legacySuccess: !!tracker.legacyCompletionCandidate,
      legacyCompletionReason: tracker.legacyCompletionCandidate || null,
      terminalResult: result,
      responseLength: tracker.lastTextLength || tracker.latestAnswerText?.length || 0,
      contentHash: tracker.lastTextHash || null
    });
    if (shadowComparison) {
      emitLifecycleTelemetry('COMPLETION_SHADOW_DECISION', {
        modelName: tracker.modelName,
        state: result.status,
        phaseEvidence: shadowComparison
      });
    }
    const waiters = Array.isArray(tracker.completionWaiters) ? tracker.completionWaiters.splice(0) : [];
    waiters.forEach((resolve) => { try { resolve(result); } catch (_) {} });
    if (result.status !== 'SUCCESS_TERMINAL') scheduleTrackerRelease(tracker, 2500, `terminal_${result.status.toLowerCase()}`);
    return result;
  }

  function observeWitness({ modelName, dispatchId = null, type, payload = null, source = 'external' } = {}) {
    const tracker = trackers.get(modelName);
    if (!tracker || (dispatchId && tracker.dispatchId && String(dispatchId) !== String(tracker.dispatchId))) return false;
    if (source === 'UnifiedAnswerCompletionWatcher' && ['COPY_VISIBLE', 'REGENERATE_VISIBLE', 'COMPLETION_MARKER_VISIBLE'].includes(type)) {
      tracker.legacyCompletionCandidate = type.toLowerCase();
    }
    return !!appendCompletionWitness(tracker, type, payload, source);
  }

  function getTerminalResult({ modelName, dispatchId = null } = {}) {
    const tracker = trackers.get(modelName);
    if (!tracker || (dispatchId && tracker.dispatchId && String(dispatchId) !== String(tracker.dispatchId))) return null;
    return tracker.completionTerminalResult || null;
  }

  function getCompletionSnapshot({ modelName, dispatchId = null } = {}) {
    const tracker = trackers.get(modelName);
    if (!tracker || (dispatchId && tracker.dispatchId && String(dispatchId) !== String(tracker.dispatchId))) return null;
    return tracker.completionSession?.snapshot?.() || null;
  }

  function waitForTerminalResult({ modelName, dispatchId = null, timeoutMs = 450000 } = {}) {
    const tracker = trackers.get(modelName);
    if (!tracker || (dispatchId && tracker.dispatchId && String(dispatchId) !== String(tracker.dispatchId))) {
      return Promise.resolve(null);
    }
    if (tracker.completionTerminalResult) return Promise.resolve(tracker.completionTerminalResult);
    return new Promise((resolve) => {
      tracker.completionWaiters.push(resolve);
      const entry = { id: null };
      entry.id = setTimeout(() => {
        const index = tracker.completionWaiters.indexOf(resolve);
        if (index !== -1) tracker.completionWaiters.splice(index, 1);
        resolve(tracker.completionTerminalResult || null);
      }, Math.max(0, Number(timeoutMs || 0)));
      tracker.timeoutTimers.push(entry);
    });
  }

  function reconcileRecovery({ modelName, persisted = null, current = null } = {}) {
    const tracker = trackers.get(modelName);
    const currentContext = current || (tracker ? {
      runSessionId: tracker.runSessionId,
      dispatchId: tracker.dispatchId,
      generationEpoch: tracker.generationEpoch,
      contextValid: tracker.documentInstanceId === lifecycleDocumentInstanceId && tracker.navigationEpoch === lifecycleNavigationEpoch
    } : null);
    const result = CompletionProtocol?.RecoveryReconciler?.reconcile?.(persisted, currentContext) || 'CONTEXT_LOST';
    if (tracker && result !== 'RESUME') {
      appendCompletionWitness(tracker, result === 'CONTEXT_LOST' ? 'CONTEXT_INVALIDATED' : 'NODE_REPLACED', { recoveryResult: result }, 'RecoveryReconciler');
      const terminalResult = tracker.completionSession?.evaluate?.(Date.now());
      if (terminalResult) commitCompletionResult(tracker, terminalResult);
    }
    return result;
  }

  async function waitForAnswerStart({
    modelName,
    promptSubmittedAt,
    timeoutMs = 30000,
    pollIntervalMs = 500,
    traceId = null
  }) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const tracker = trackers.get(modelName);
      if (!isTrackerActive(tracker)) {
        return trackerCancelledResult(tracker);
      }
      const snapshot = await getLatestAnswerSnapshot(modelName, traceId);
      const phaseEvidence = detectResponsePhaseEvidence(modelName, snapshot.element);
      const registered = registeredCandidates.get(modelName);
      if (snapshot.element && !tracker.latestAnswerEl) {
        tracker.latestAnswerEl = snapshot.element;
        attachTrackerObserver(tracker, snapshot.element);
      } else if (!tracker.latestAnswerEl && registered?.element) {
        tracker.latestAnswerEl = registered.element;
        attachTrackerObserver(tracker, registered.element);
      } else if (!tracker.latestAnswerEl) {
        attachTrackerObserver(tracker, document.body);
      }
      const textLength = snapshot.textLength || 0;
      const indicators = detectGeneratingIndicators({ modelName, root: document });
      const snapshotHash = shortHash(normalizeText(snapshot.text || ''));
      const newAnswerElement = !!snapshot.element && !!tracker.baselineElement && snapshot.element !== tracker.baselineElement;
      const firstAnswerElement = !!snapshot.element && !tracker.baselineElement;
      const baselineElementChanged = !!snapshot.element
        && snapshot.element === tracker.baselineElement
        && snapshotHash !== tracker.baselineTextHash
        && tracker.lastMutationAt > promptSubmittedAt;
      const generationSignal = indicators.hasStopButton
        || indicators.hasLoadingIndicator
        || indicators.hasStreamingCursor
        || indicators.hasProgressbar;
      const hasStarted = (textLength >= 1 && (newAnswerElement || firstAnswerElement || baselineElementChanged)) || generationSignal;
      if (hasStarted) {
        const answerStartedAt = Date.now();
        tracker.answerStartedAt = answerStartedAt;
        tracker.state = 'ANSWER_STARTED';
        tracker.latestAnswerText = snapshot.text;
        tracker.freshAnswerObserved = true;
        tracker.completionSession?.capabilityHealth?.report?.('answerResolution', snapshot.element ? 'HEALTHY' : 'DEGRADED');
        tracker.completionSession?.capabilityHealth?.report?.('generationSignal', generationSignal ? 'HEALTHY' : 'DEGRADED');
        appendCompletionWitness(tracker, 'FRESH_RESPONSE_OBSERVED', {
          candidateCount: snapshot.candidateCount || null,
          baselineChanged: baselineElementChanged,
          generationSignal
        });
        if (generationSignal) appendCompletionWitness(tracker, 'GENERATION_ACTIVE', { indicators: indicators.indicators || [] });
        if (!isTrackerActive(tracker)) {
          return trackerCancelledResult(tracker);
        }
        emitLifecycleTelemetry('ANSWER_START_DETECTED', {
          modelName,
          state: 'ANSWER_STARTED',
          textLength,
          elapsedMs: answerStartedAt - promptSubmittedAt,
          mutationCount: tracker.mutationCount,
          answerMethod: snapshot.method || null,
          responsePhase: phaseEvidence.phase,
          phaseEvidence
        });
        return {
          ok: true,
          state: 'ANSWER_STARTED',
          answerStartedAt,
          latestAnswerEl: snapshot.element,
          textLength,
          diagnostics: { method: snapshot.method }
        };
      }
      if (!(await delayForTracker(tracker, pollIntervalMs, 'poll'))) {
        return trackerCancelledResult(tracker);
      }
    }
    return {
      ok: false,
      state: 'TIMEOUT',
      reason: 'answer_start_timeout'
    };
  }

  async function waitForAnswerComplete({
    modelName,
    timeoutMs = 180000,
    stableMs = 1500,
    pollIntervalMs = 600,
    traceId = null
  }) {
    const deadline = Date.now() + timeoutMs;
    const activeSession = trackers.get(modelName)?.completionSession;
    if (activeSession?.producer) {
      activeSession.producer.confirmationWindowMs = Math.max(0, Math.min(
        Number(activeSession.producer.confirmationWindowMs || stableMs || 0),
        Number(stableMs || activeSession.producer.confirmationWindowMs || 0)
      ));
    }
    let previous = { hash: null, length: 0 };
    let stableSince = Date.now();
    while (Date.now() < deadline) {
      const tracker = trackers.get(modelName);
      if (!isTrackerActive(tracker)) {
        return trackerCancelledResult(tracker);
      }
      const snapshot = await getLatestAnswerSnapshot(modelName, traceId);
      const phaseEvidence = detectResponsePhaseEvidence(modelName, snapshot.element);
      tracker.latestAnswerEl = snapshot.element || tracker.latestAnswerEl;
      tracker.latestAnswerText = snapshot.text;
      if (!tracker.observer || tracker.observedTarget !== document.body) {
        attachTrackerObserver(tracker, document.body);
      }
      const previousHash = previous.hash;
      const stability = isTextStable(previous, snapshot.text, stableSince, stableMs);
      if (previousHash && previousHash !== stability.hash) {
        appendCompletionWitness(tracker, 'CONTENT_PROGRESS', { textLength: stability.length, contentHash: stability.hash });
      }
      previous = { hash: stability.hash, length: stability.length };
      stableSince = stability.stableSince;
      tracker.lastTextHash = stability.hash;
      tracker.lastTextLength = stability.length;
      tracker.stableSince = stability.stableSince;
      const mutationQuiet = Date.now() - (tracker.lastMutationAt || 0) >= stableMs;
      let composerReady = false;
      let sendButtonReady = false;
      let indicators = {
        hasStopButton: false,
        hasLoadingIndicator: false,
        hasStreamingCursor: false,
        hasProgressbar: false,
        indicators: [],
        diagnostics: {}
      };
      if (stability.stable && !tracker.finalReadinessCheckedAt) {
        tracker.finalReadinessCheckedAt = Date.now();
        indicators = detectGeneratingIndicators({ modelName, root: document });
        const cheap = detectCheapComposerReadiness(tracker);
        composerReady = !!cheap.composerReady;
        sendButtonReady = !!cheap.sendButtonReady;
        if (cheap.composerEl) {
          tracker.composerEl = cheap.composerEl;
        }
        if (!composerReady) {
          const resolver = window.LLMExtension?.SelectorResolverV2;
          if (resolver?.resolveComposer) {
            try {
              const composer = await resolver.resolveComposer({
                modelName,
                reason: 'lifecycle_final_readiness',
                timeoutMs: LIFECYCLE_READINESS_RESOLVER_TIMEOUT_MS,
                preferCached: true,
                traceId
              });
              if (!isTrackerActive(tracker)) {
                return trackerCancelledResult(tracker);
              }
              composerReady = !!(composer?.ok && composer.element);
              tracker.composerEl = composer?.element || tracker.composerEl || null;
              if (composer?.ok && resolver.resolveSendButton) {
                const sendButton = await resolver.resolveSendButton({
                  modelName,
                  composerEl: composer.element,
                  reason: 'lifecycle_final_readiness',
                  timeoutMs: LIFECYCLE_READINESS_RESOLVER_TIMEOUT_MS,
                  preferCached: true,
                  traceId
                });
                if (!isTrackerActive(tracker)) {
                  return trackerCancelledResult(tracker);
                }
                sendButtonReady = !!(sendButton?.ok && sendButton.element && !sendButton.element.disabled);
                tracker.sendButtonEl = sendButton?.element || tracker.sendButtonEl || null;
              }
            } catch (_) {}
          }
        }
      } else if (tracker.finalReadinessCheckedAt) {
        const cheap = detectCheapComposerReadiness(tracker);
        composerReady = !!cheap.composerReady;
        sendButtonReady = !!cheap.sendButtonReady;
        indicators = detectGeneratingIndicators({ modelName, root: document });
      }
      const completionSignals = {
        textStable: !!stability.stable,
        // Only a *confirmed* absent stop button counts (stopButtonSignal === false).
        // An 'unknown' (untrusted probe) grants no completion credit.
        noStopButton: indicators.stopButtonSignal === false,
        stopButtonUnknown: indicators.stopButtonSignal === 'unknown',
        noLoadingIndicator: !indicators.hasLoadingIndicator && !indicators.hasProgressbar,
        composerReady,
        sendButtonReady,
        mutationQuiet
      };
      let diagnosticConfidence = 0;
      if (completionSignals.textStable) diagnosticConfidence += 0.35;
      if (completionSignals.noStopButton) diagnosticConfidence += 0.20;
      if (completionSignals.noLoadingIndicator) diagnosticConfidence += 0.15;
      if (completionSignals.mutationQuiet) diagnosticConfidence += 0.15;
      if (completionSignals.composerReady) diagnosticConfidence += 0.10;
      if (completionSignals.sendButtonReady) diagnosticConfidence += 0.05;
      if (indicators.hasStopButton || indicators.hasLoadingIndicator || indicators.hasProgressbar) {
        tracker.completionSession?.capabilityHealth?.report?.('producerControls', 'HEALTHY');
        appendCompletionWitness(tracker, indicators.hasStopButton ? 'STOP_VISIBLE' : 'GENERATION_ACTIVE', { indicators: indicators.indicators });
      } else if (indicators.stopButtonSignal === false) {
        tracker.completionSession?.capabilityHealth?.report?.('producerControls', 'HEALTHY');
        appendCompletionWitness(tracker, 'STOP_ABSENT', { probeTrusted: indicators.probeTrusted });
        appendCompletionWitness(tracker, 'GENERATION_INACTIVE', { probeTrusted: indicators.probeTrusted });
      }
      const providerErrorSurface = window.ContentUtils?.detectProviderErrorSurface?.();
      if (providerErrorSurface?.detected) {
        appendCompletionWitness(tracker, 'PROVIDER_ERROR_VISIBLE', { selector: providerErrorSurface.selector || null });
      }
      const continueVisible = Array.from(document.querySelectorAll('button,[role="button"]')).slice(0, 120).some((node) => {
        if (!isVisible(node)) return false;
        const label = normalizeText(`${node.getAttribute?.('aria-label') || ''} ${node.textContent || ''}`);
        return /continue (?:generating|generation)|продолжить (?:генерацию|ответ)|continuar (?:generando|generación)/i.test(label);
      });
      if (continueVisible) appendCompletionWitness(tracker, 'CONTINUE_VISIBLE', null);
      tracker.completionSession?.capabilityHealth?.report?.('continueDetection', 'HEALTHY');
      const immediateTerminalResult = tracker.completionSession?.evaluate?.(Date.now()) || null;
      if (immediateTerminalResult) {
        commitCompletionResult(tracker, immediateTerminalResult);
        return { ok: false, state: immediateTerminalResult.status, reason: immediateTerminalResult.reason, terminalResult: immediateTerminalResult };
      }
      const timeoutState = tracker.completionSession?.timeouts?.evaluate?.(Date.now()) || null;
      if (timeoutState) {
        tracker.completionSession.facts.timeoutState = timeoutState;
        const timeoutResult = tracker.completionSession.evaluate(Date.now());
        if (timeoutResult) {
          commitCompletionResult(tracker, timeoutResult);
          emitLifecycleTelemetry(`TIMEOUT_${timeoutState}`, {
            modelName, state: timeoutResult.status, level: 'warning',
            textLength: snapshot.textLength,
            phaseEvidence: { timeoutState }
          });
          return { ok: false, state: timeoutResult.status, reason: timeoutResult.reason, terminalResult: timeoutResult };
        }
      }
      tracker.state = stability.stable && (indicators.hasLoadingIndicator || indicators.hasStopButton) ? 'GENERATING' : (stability.stable ? 'STABLE' : 'ANSWER_STARTED');
      if (stability.stable && (indicators.hasLoadingIndicator || indicators.hasStopButton)) {
        // Throttle: a stuck busy indicator over stable text used to emit this on every
        // poll tick (~50 identical events for DeepSeek in run 1781157526316), flooding
        // the diagnostics buffer and evicting terminal events before export.
        const lastGenerating = tracker.lastGeneratingTelemetry || null;
        const generatingChanged = !lastGenerating
          || lastGenerating.textLength !== snapshot.textLength
          || (Date.now() - lastGenerating.ts) >= ANSWER_GENERATING_TELEMETRY_THROTTLE_MS;
        if (generatingChanged) {
          tracker.lastGeneratingTelemetry = { textLength: snapshot.textLength, ts: Date.now() };
          emitLifecycleTelemetry('ANSWER_GENERATING', {
            modelName,
            state: 'GENERATING',
            textLength: snapshot.textLength,
            elapsedMs: Date.now() - tracker.promptSubmittedAt,
            mutationCount: tracker.mutationCount,
            hasStopButton: indicators.hasStopButton,
            hasLoadingIndicator: indicators.hasLoadingIndicator,
            answerMethod: snapshot.method || null,
            responsePhase: phaseEvidence.phase,
            phaseEvidence
          });
        }
      } else if (stability.stable) {
        emitLifecycleTelemetry('ANSWER_TEXT_STABLE', {
          modelName,
          state: 'STABLE',
          textLength: snapshot.textLength,
          elapsedMs: Date.now() - tracker.promptSubmittedAt,
          stableMs,
          mutationCount: tracker.mutationCount
        });
      }
      const textLength = snapshot.textLength || 0;
      // Decide completion by *what the text is*, not a blunt length>=20 (review P1.3).
      // The classifier accepts short-but-meaningful answers and rejects UI noise /
      // provider-error surfaces that pass the length bar. Falls back to length>=20 if
      // the classifier module is not present. (No prompt here, so prompt-echo is left
      // to the background/adapter guards.)
      const classifierApi = (typeof window !== 'undefined' && window.AnswerContentClassifier)
        || (typeof globalThis !== 'undefined' && globalThis.AnswerContentClassifier)
        || null;
      const contentEligible = classifierApi
        ? classifierApi.classify(snapshot.text || '', { minValid: 20 }).terminalEligible
        : (textLength >= 20);
      const stableForMs = Date.now() - stability.stableSince;
      const stuckBusyOverride = indicators.hasLoadingIndicator
        && !indicators.hasProgressbar
        && indicators.stopButtonSignal === false
        && completionSignals.mutationQuiet
        && stableForMs >= Math.max(4 * stableMs, STUCK_BUSY_OVERRIDE_MIN_MS);
      if (stuckBusyOverride) completionSignals.stuckBusyOverride = true;
      if (
        tracker.freshAnswerObserved &&
        contentEligible &&
        completionSignals.textStable &&
        indicators.stopButtonSignal === false &&
        (!indicators.hasLoadingIndicator || stuckBusyOverride) &&
        !indicators.hasProgressbar &&
        tracker.completionSession?.producer?.evaluate?.(Date.now()) === 'TERMINAL' &&
        Date.now() >= Number(tracker.nextStructuralVerificationAt || 0)
      ) {
        if (!isTrackerActive(tracker)) {
          return trackerCancelledResult(tracker);
        }
        const structuralVerification = await verifyStructuralCompletion(tracker);
        tracker.diagnostics.lastStructuralVerification = structuralVerification;
        if (!isTrackerActive(tracker)) {
          return trackerCancelledResult(tracker);
        }
        const structuralProofAvailable = !!(
          window.AnswerVerification?.verifySnapshotPair
          && window.AnswerStructure?.inspect
          && window.GenerationSignal?.inspect
          && window.TurnResolver?.resolveTurn
        );
        const ownershipReasons = Array.isArray(structuralVerification?.reasons) ? structuralVerification.reasons : [];
        const lifecycleCorroboratesInactive = tracker.completionSession?.ledger?.getLatest?.('STOP_ABSENT') != null
          && tracker.completionSession?.ledger?.getLatest?.('GENERATION_INACTIVE') != null;
        const recoverableVerificationReasons = ownershipReasons.length > 0 && ownershipReasons.every((reason) => (
          reason === 'identity_missing:generationEpoch'
          || (reason === 'generation_inactive_unproven' && lifecycleCorroboratesInactive)
        ));
        const structuralVerified = structuralVerification?.verified === true || (
          recoverableVerificationReasons
          && structuralVerification?.resolution === 'exact'
          && structuralVerification?.structuralComplete === true
          && structuralVerification?.lengthRegressionActive !== true
        );
        if (structuralVerified && structuralVerification?.verified !== true) {
          structuralVerification.verified = true;
          structuralVerification.originalVerified = false;
          structuralVerification.lifecycleCorroborated = true;
          structuralVerification.state = 'verified';
          if (structuralVerification.generationActive == null && lifecycleCorroboratesInactive) {
            structuralVerification.generationActive = false;
          }
        }
        const ownershipConflict = !recoverableVerificationReasons
          && ownershipReasons.some((reason) => /node|identity|candidate_set|dispatch|session|epoch/i.test(String(reason)));
        tracker.completionSession.confirmOwnership({
          status: structuralVerified && structuralVerification?.resolution === 'exact'
            ? 'CONFIRMED'
            : (ownershipConflict ? 'CONFLICT' : 'UNKNOWN'),
          responseIdentity: structuralVerification ? {
            runSessionId: structuralVerification.runSessionId,
            dispatchId: structuralVerification.dispatchId,
            generationEpoch: structuralVerification.generationEpoch,
            nodeKey: structuralVerification.selectedNodeKey,
            candidateOrdinalAfterAnchor: structuralVerification.candidateOrdinalAfterAnchor,
            candidateSetHash: structuralVerification.candidateSetHash,
            messageRootHash: structuralVerification.messageRootHash
          } : undefined,
          reasons: ownershipReasons,
          verifiedAt: Date.now()
        });
        const ownershipTerminalResult = tracker.completionSession.evaluate(Date.now());
        if (ownershipTerminalResult?.status === 'AMBIGUOUS') {
          commitCompletionResult(tracker, ownershipTerminalResult);
          return { ok: false, state: ownershipTerminalResult.status, reason: ownershipTerminalResult.reason, terminalResult: ownershipTerminalResult };
        }
        if (structuralProofAvailable && !structuralVerified) {
          const reasons = Array.isArray(structuralVerification?.reasons)
            ? structuralVerification.reasons
            : [structuralVerification ? 'structural_verification_pending' : 'anchored_turn_unresolved'];
          tracker.state = 'STABLE';
          tracker.nextStructuralVerificationAt = Date.now() + Math.max(50, Math.min(1000, pollIntervalMs * 2));
          emitLifecycleTelemetry('LIFECYCLE_STRUCTURAL_VERIFICATION_PENDING', {
            modelName,
            state: 'STABLE',
            level: 'info',
            textLength: Number(structuralVerification?.selectedLength || textLength || 0),
            elapsedMs: Date.now() - tracker.promptSubmittedAt,
            answerMethod: snapshot.method || null,
            phaseEvidence: {
              reasons,
              resolution: structuralVerification?.resolution || 'unresolved',
              structuralComplete: structuralVerification?.structuralComplete === true,
              generationActive: structuralVerification?.generationActive ?? null,
              snapshotsCompared: Number(structuralVerification?.snapshotsCompared || 0)
            }
          });
          if (!(await delayForTracker(tracker, Math.min(pollIntervalMs, 1000), 'poll'))) {
            return trackerCancelledResult(tracker);
          }
          continue;
        }
        const materializationBefore = structuralVerification;
        let materializationCaptureCount = 0;
        const materialization = await new CompletionProtocol.MaterializationHydrationGate().materialize({
          provider: platformForModel(modelName),
          capture: async () => {
            const value = materializationCaptureCount++ === 0 ? materializationBefore : captureStructuralSnapshot(tracker);
            return value ? {
              ...value,
              text: value.selectedText || '',
              contentHash: value.selectedHash,
              structuralHash: value.structuralHash
            } : null;
          },
          forceBottom: async () => { try { tracker.latestAnswerEl?.scrollIntoView?.({ block: 'end', behavior: 'auto' }); } catch (_) {} },
          waitForSettle: async () => delayForTracker(tracker, Math.max(5, Math.min(pollIntervalMs || stableMs, 250)), 'poll')
        });
        const materializationAfter = materialization.after;
        const materializationChanged = !materializationAfter || materialization.changed;
        if (materializationChanged) {
          tracker.completionSession.setContentVerification({
            stable: true,
            structurallyComplete: structuralVerification.structuralComplete === true,
            lengthRegressionRecovered: structuralVerification.lengthRegressionActive !== true
          }, materialization, null);
          appendCompletionWitness(tracker, 'CONTENT_PROGRESS', { reason: 'materialization_changed' }, 'MaterializationHydrationGate');
          emitLifecycleTelemetry('CONTENT_MATERIALIZATION_CHANGED', { modelName, state: 'STABLE', phaseEvidence: {
            beforeHash: materializationBefore.selectedHash, afterHash: materializationAfter?.selectedHash || null
          } });
          tracker.nextStructuralVerificationAt = Date.now() + Math.max(50, Math.min(1000, pollIntervalMs * 2));
          continue;
        }
        const responseIdentity = tracker.completionSession.ownershipResult?.responseIdentity || {};
        tracker.completionSession.setContentVerification({
          stable: true,
          structurallyComplete: structuralVerification.structuralComplete === true,
          lengthRegressionRecovered: structuralVerification.lengthRegressionActive !== true
        }, materialization, {
          text: String(structuralVerification.selectedText || ''),
          html: String(structuralVerification.selectedHtml || ''),
          contentHash: structuralVerification.selectedHash,
          structuralHash: structuralVerification.structuralHash,
          responseIdentity,
          answerVerification: structuralVerification,
          observedAt: structuralVerification.observedAt
        });
        const terminalResult = tracker.completionSession.evaluate(Date.now());
        if (terminalResult?.status !== 'SUCCESS_TERMINAL') {
          if (terminalResult) commitCompletionResult(tracker, terminalResult);
          if (terminalResult) return { ok: false, state: terminalResult.status, reason: terminalResult.reason, terminalResult };
          continue;
        }
        commitCompletionResult(tracker, terminalResult);
        const completedAt = Date.now();
        const extractionSnapshot = tracker.completionSession.extractionSnapshot;
        const completedAnswerText = String(extractionSnapshot?.text || '').trim();
        const answerVerification = structuralVerification
          ? (({ selectedText: _selectedText, ...value }) => value)(structuralVerification)
          : null;
        const answerAttemptId = `${tracker.traceId || tracker.dispatchId || modelName}:response-ready:1`;
        const proofEvidence = window.AnswerProofNormalization?.evidence?.(completedAnswerText, {
          dispatchId: tracker.dispatchId || null,
          attemptId: answerAttemptId
        }) || null;
        tracker.state = 'COMPLETE';
        if (phaseEvidence.phase === 'reasoning') {
          emitLifecycleTelemetry('LIFECYCLE_COMPLETION_PHASE_SUSPECT', {
            modelName,
            state: 'COMPLETE',
            level: 'warning',
            textLength,
            elapsedMs: completedAt - tracker.promptSubmittedAt,
            answerMethod: snapshot.method || null,
            responsePhase: phaseEvidence.phase,
            phaseEvidence
          });
        }
        emitLifecycleTelemetry('ANSWER_COMPLETE_DETECTED', {
          modelName,
          state: 'COMPLETE',
          textLength,
          elapsedMs: completedAt - tracker.promptSubmittedAt,
          stableMs,
          mutationCount: tracker.mutationCount,
          hasStopButton: false,
          hasLoadingIndicator: false,
          composerReady,
          sendButtonReady,
          confidence: diagnosticConfidence,
          answerMethod: snapshot.method || null,
          responsePhase: phaseEvidence.phase,
          phaseEvidence
        });
        if (!isTrackerActive(tracker)) {
          return trackerCancelledResult(tracker);
        }
        try {
          chrome.runtime.sendMessage({
            type: 'LLM_RESPONSE_READY',
            llmName: modelName,
            // Atomic completion contract: background must evaluate the exact
            // snapshot that produced COMPLETE, not re-select the DOM later.
            answerText: completedAnswerText,
            meta: {
              dispatchId: tracker.dispatchId || null,
              runSessionId: tracker.runSessionId || null,
              sessionId: tracker.runSessionId || null,
              state: 'COMPLETE',
              confidence: diagnosticConfidence,
              textLength,
              answerHash: proofEvidence?.normalizedHash || shortHash(completedAnswerText),
              normalizedHash: proofEvidence?.normalizedHash || null,
              normalizedLength: proofEvidence?.normalizedLength ?? completedAnswerText.length,
              normalizationVersion: proofEvidence?.normalizationVersion || null,
              payloadEvidenceId: proofEvidence?.payloadEvidenceId || null,
              attemptId: answerAttemptId,
              answerMethod: snapshot.method || null,
              responsePhase: phaseEvidence.phase,
              phaseEvidence,
              completionSignals,
              answerVerification,
              generationEpoch: answerVerification?.generationEpoch ?? null,
              turnAnchor: answerVerification?.turnAnchor ?? tracker.turnAnchor ?? null,
              completedAt
              , terminalResult
              , extractionSnapshot
            }
          });
        } catch (_) {}
        schedulePostTerminalObservationWindow(tracker, {
          textLength: completedAnswerText.length,
          answerHash: shortHash(normalizeText(completedAnswerText)),
          normalizedLength: proofEvidence?.normalizedLength ?? null,
          normalizedHash: proofEvidence?.normalizedHash || null,
          normalizationVersion: proofEvidence?.normalizationVersion || null
        });
        return {
          ok: true,
          state: 'COMPLETE',
          completedAt,
          latestAnswerEl: snapshot.element,
          answerText: completedAnswerText,
          textLength,
          confidence: diagnosticConfidence,
          completionSignals,
          terminalResult,
          extractionSnapshot,
          diagnostics: {
            mutationCount: tracker.mutationCount
          }
        };
      }
      const producerGate = tracker.completionSession?.producer;
      const producerConfirmationRemaining = producerGate?.state === 'CANDIDATE'
        ? Math.max(1, Number(producerGate.confirmationWindowMs || 0) - (Date.now() - Number(producerGate.candidateSince || Date.now())))
        : pollIntervalMs;
      if (!(await delayForTracker(tracker, Math.min(pollIntervalMs, producerConfirmationRemaining), 'poll'))) {
        return trackerCancelledResult(tracker);
      }
    }
    const tracker = trackers.get(modelName);
    if (!isTrackerActive(tracker)) {
      return trackerCancelledResult(tracker);
    }
    const latest = await getLatestAnswerSnapshot(modelName, traceId);
    const partial = !!normalizeText(latest.text);
    emitLifecycleTelemetry('ANSWER_COMPLETE_TIMEOUT', {
      modelName,
      state: 'TIMEOUT',
      textLength: latest.textLength,
      elapsedMs: Date.now() - (trackers.get(modelName)?.promptSubmittedAt || Date.now()),
      mutationCount: trackers.get(modelName)?.mutationCount || 0
    });
    if (partial) {
      emitLifecycleTelemetry('ANSWER_PARTIAL_ON_TIMEOUT', {
        modelName,
        state: 'TIMEOUT',
        textLength: latest.textLength,
        elapsedMs: Date.now() - (trackers.get(modelName)?.promptSubmittedAt || Date.now())
      });
    }
    try {
      chrome.runtime.sendMessage({
        type: 'AUTOMATION_DEADLINE_SIGNAL',
        llmName: modelName,
        phase: 'generation',
        budgetMs: timeoutMs,
        meta: {
          dispatchId: tracker.dispatchId || null,
          runSessionId: tracker.runSessionId || null,
          sessionId: tracker.runSessionId || null,
          source: 'response_lifecycle_timeout',
          textLength: latest.textLength,
          partial
        }
      });
    } catch (_) {}
    tracker.completionSession.facts.timeoutState = 'HARD';
    const terminalResult = tracker.completionSession.evaluate(Date.now());
    if (terminalResult) commitCompletionResult(tracker, terminalResult);
    return {
      ok: false,
      state: terminalResult?.status || 'STALLED',
      reason: terminalResult?.reason || 'answer_complete_timeout',
      terminalResult,
      completionSnapshot: tracker.completionSession?.snapshot?.() || null,
      lifecycleDiagnostics: tracker.diagnostics || null,
      latestAnswerText: latest.text,
      textLength: latest.textLength,
      partial,
      diagnostics: {
        partial,
        completionReason: partial ? 'streaming_incomplete' : 'hard_timeout',
        sanityWarnings: partial ? ['content_growing', 'hard_timeout'] : ['hard_timeout'],
        sanityConfidence: partial ? 0.5 : 0.2
      }
    };
  }

  function startResponseLifecycleTracking(options = {}) {
    const modelName = String(options?.modelName || '').trim();
    if (!modelName) {
      emitLifecycleTelemetry('COMPLETION_ATTEMPT_BOOTSTRAP_FAILED', {
        modelName: 'SYSTEM',
        state: 'ERROR',
        runSessionId: options?.runSessionId || options?.sessionId || null,
        dispatchId: options?.dispatchId || null,
        phaseEvidence: { reason: 'missing_model', runtime: completionRuntimeDescriptor() }
      });
      return Promise.resolve({ ok: false, reason: 'missing_model' });
    }
    const dispatchId = String(options?.dispatchId || 'unbound');
    const flightKey = `${modelName}:${dispatchId}`;
    const activeFlight = trackerStartFlights.get(flightKey);
    if (activeFlight) {
      return activeFlight.then((result) => {
        if (options.activateObservation === true && result?.ok && result?.tracker) {
          return activateResponseLifecycleTracking(result.tracker, options);
        }
        return result;
      });
    }
    const flight = startResponseLifecycleTrackingInternal(options)
      .finally(() => {
        if (trackerStartFlights.get(flightKey) === flight) trackerStartFlights.delete(flightKey);
      });
    trackerStartFlights.set(flightKey, flight);
    return flight;
  }

  async function startResponseLifecycleTrackingInternal({
    modelName,
    dispatchId = null,
    runSessionId = null,
    generationEpoch = null,
    candidateId = null,
    documentInstanceId = lifecycleDocumentInstanceId,
    navigationEpoch = lifecycleNavigationEpoch,
    promptSubmittedAt = Date.now(),
    traceId = null,
    baselineText = null,
    turnAnchor = null,
    activateObservation = false
  }) {
    const activeTracker = trackers.get(modelName);
    const sameDispatch = !!activeTracker
      && isTrackerActive(activeTracker)
      && (!dispatchId || !activeTracker.dispatchId || String(activeTracker.dispatchId) === String(dispatchId))
      && (!runSessionId || !activeTracker.runSessionId || Number(activeTracker.runSessionId) === Number(runSessionId))
      && (generationEpoch === null || generationEpoch === undefined
        || activeTracker.generationEpoch === null || activeTracker.generationEpoch === undefined
        || Number(activeTracker.generationEpoch) === Number(generationEpoch));
    if (sameDispatch) {
      if (activateObservation === true) {
        return activateResponseLifecycleTracking(activeTracker, { promptSubmittedAt });
      }
      return { ok: true, reused: true, tracker: activeTracker };
    }

    // Capture the positional baseline synchronously, before the first await.
    // All adapters report their dispatch baseline before interacting with Send;
    // waiting for storage or PROMPT_SUBMITTED here can otherwise count the new
    // assistant node as part of the old conversation.
    const suppliedBaseline = typeof baselineText === 'string'
      ? {
          element: null,
          text: normalizeText(baselineText),
          textLength: normalizeText(baselineText).length,
          method: 'dispatch_baseline',
          traceId
        }
      : null;
    const capturedTurnAnchor = turnAnchor !== null
      && turnAnchor !== undefined
      && Number.isFinite(Number(turnAnchor))
      ? Math.max(0, Number(turnAnchor))
      : captureTurnAnchor(modelName);
    stopResponseLifecycleTracking({ modelName, reason: 'new_dispatch' });
    const storedIdentity = window.ContentUtils?.ensureDispatchMeta?.({
      runSessionId,
      dispatchId,
      generationEpoch
    }, modelName) || {};
    const tracker = createTracker({
      modelName,
      dispatchId: dispatchId || storedIdentity.dispatchId || null,
      runSessionId: runSessionId || storedIdentity.runSessionId || null,
      generationEpoch: generationEpoch ?? storedIdentity.generationEpoch ?? null,
      candidateId: candidateId || storedIdentity.candidateId || null,
      documentInstanceId,
      navigationEpoch,
      promptSubmittedAt,
      traceId,
      baselineSnapshot: suppliedBaseline
    });
    tracker.turnAnchor = capturedTurnAnchor;
    trackers.set(modelName, tracker);
    attachTrackerObserver(tracker, document.body);

    const settings = await getSettings();
    if (!CompletionProtocol?.CompletionSession) {
      emitLifecycleTelemetry('COMPLETION_ATTEMPT_BOOTSTRAP_FAILED', {
        modelName,
        state: 'ERROR',
        runSessionId,
        dispatchId,
        phaseEvidence: { reason: 'completion_protocol_unavailable', runtime: completionRuntimeDescriptor() }
      });
      stopResponseLifecycleTracking({ modelName, dispatchId, runSessionId, reason: 'completion_protocol_unavailable' });
      return { ok: false, reason: 'completion_protocol_unavailable' };
    }
    tracker.lifecycleSettings = settings;
    tracker.completionRolloutMode = CompletionProtocol.CompletionRollout.normalize(settings.completionProtocolV2);
    const authorityAck = await sendRuntimeMessageForAck({
      type: 'LLM_COMPLETION_ATTEMPT',
      llmName: modelName,
      meta: {
        runSessionId: tracker.runSessionId,
        dispatchId: tracker.dispatchId,
        generationEpoch: tracker.generationEpoch,
        rolloutMode: tracker.completionRolloutMode,
        protocolVersion: CompletionProtocol?.version || null
      }
    }, {
      acceptedStatus: 'completion_attempt_recorded',
      timeoutMs: 5000,
      attempts: 2
    });
    if (!authorityAck.ok) {
      emitLifecycleTelemetry('COMPLETION_ATTEMPT_BOOTSTRAP_FAILED', {
        modelName,
        state: 'ERROR',
        runSessionId,
        dispatchId,
        phaseEvidence: { reason: authorityAck.reason || 'authority_ack_failed', runtime: completionRuntimeDescriptor() }
      });
      stopResponseLifecycleTracking({ modelName, dispatchId, runSessionId, reason: 'authority_ack_failed' });
      return { ok: false, reason: authorityAck.reason || 'authority_ack_failed' };
    }
    tracker.attemptAuthorityAcceptedAt = Date.now();
    tracker.attemptAuthorityResponse = authorityAck.response || null;
    emitLifecycleTelemetry('ATTEMPT_CONTEXT_CAPTURED', {
      modelName,
      state: tracker.state,
      phaseEvidence: {
        attemptContext: {
          runSessionId: tracker.runSessionId,
          dispatchId: tracker.dispatchId,
          generationEpoch: tracker.generationEpoch,
          baselineAnswerSignature: tracker.baselineTextHash,
          anchorAnswerCount: tracker.turnAnchor,
          provider: platformForModel(modelName)
        },
        authorityAccepted: true,
        observationArmed: false
      }
    });
    const previouslyRegistered = registeredCandidates.get(modelName);
    if (previouslyRegistered?.traceId && traceId && String(previouslyRegistered.traceId) !== String(traceId)) {
      registeredCandidates.delete(modelName);
    }
    if (!suppliedBaseline) {
      const baselineSnapshot = await getLatestAnswerSnapshot(modelName, traceId);
      if (!isTrackerActive(tracker)) return trackerCancelledResult(tracker);
      tracker.baselineElement = baselineSnapshot?.element || null;
      tracker.baselineTextHash = shortHash(normalizeText(baselineSnapshot?.text || ''));
      tracker.baselineTextLength = Number(baselineSnapshot?.textLength || 0);
      tracker.baselineCapturedAt = Date.now();
    }
    const registered = registeredCandidates.get(modelName);
    if (registered?.element) {
      tracker.latestAnswerEl = registered.element;
      attachTrackerObserver(tracker, registered.element);
    } else {
      attachTrackerObserver(tracker, document.body);
    }
    if (activateObservation === true) {
      return activateResponseLifecycleTracking(tracker, { promptSubmittedAt });
    }
    return { ok: true, tracker, authorityAccepted: true, observationArmed: false };
  }

  function activateResponseLifecycleTracking(tracker, options = {}) {
    if (!tracker || !isTrackerActive(tracker)) return trackerCancelledResult(tracker);
    if (!tracker.attemptAuthorityAcceptedAt) return { ok: false, reason: 'attempt_authority_unconfirmed' };
    if (tracker.observationPromise) {
      return { ok: true, reused: true, tracker, observationArmed: true };
    }
    const settings = tracker.lifecycleSettings || RESPONSE_LIFECYCLE_DEFAULTS;
    const submittedAt = Number(options.promptSubmittedAt || Date.now());
    tracker.promptSubmittedAt = submittedAt;
    tracker.observationStartedAt = Date.now();
    tracker.state = 'PROMPT_SUBMITTED';
    tracker.completionSession = new CompletionProtocol.CompletionSession(Object.freeze({
      runSessionId: tracker.runSessionId,
      dispatchId: tracker.dispatchId,
      generationEpoch: tracker.generationEpoch,
      promptSubmittedAt: submittedAt,
      baselineAnswerSignature: tracker.baselineTextHash,
      anchorAnswerCount: tracker.turnAnchor,
      provider: platformForModel(tracker.modelName)
    }), {
      attemptId: tracker.traceId || tracker.dispatchId || `${tracker.modelName}:${submittedAt}`,
      rolloutMode: tracker.completionRolloutMode || CompletionProtocol.CompletionRollout.normalize(settings.completionProtocolV2),
      confirmationWindowMs: Number(settings.producerConfirmationWindowMs || settings.stableMs || 1500),
      timeouts: {
        progressTimeoutMs: Number(settings.progressTimeoutMs || settings.answerCompleteTimeoutMs),
        producerStuckTimeoutMs: Number(settings.producerStuckTimeoutMs || settings.answerCompleteTimeoutMs),
        hardAttemptTimeoutMs: Math.max(Number(settings.answerCompleteTimeoutMs || 0), Number(window.AnswerPipelineConfig?.streaming?.adaptiveTimeout?.hardMax || 0))
      },
      onTransition: (transition) => emitCompletionTransition(tracker, transition)
    });
    emitLifecycleTelemetry('ATTEMPT_CONTEXT_CAPTURED', {
      modelName: tracker.modelName,
      state: tracker.state,
      phaseEvidence: {
        attemptContext: tracker.completionSession.context,
        authorityAccepted: true,
        observationArmed: true
      }
    });
    tracker.observationPromise = waitForAnswerStart({
      modelName: tracker.modelName,
      promptSubmittedAt: submittedAt,
      timeoutMs: settings.answerStartTimeoutMs,
      pollIntervalMs: Math.min(settings.pollIntervalMs, 500),
      traceId: tracker.traceId
    }).then((startResult) => {
      if (!startResult?.ok) {
        if (isTrackerActive(tracker) && tracker.completionSession) {
          tracker.completionSession.facts.timeoutState = 'PROGRESS';
          const terminalResult = tracker.completionSession.evaluate(Date.now());
          if (terminalResult) commitCompletionResult(tracker, terminalResult);
          return { ...startResult, state: terminalResult?.status || startResult.state, terminalResult };
        }
        return startResult;
      }
      if (!isTrackerActive(tracker)) {
        return trackerCancelledResult(tracker);
      }
      tracker.state = 'GENERATING';
      const pipelineHardMaxMs = Number(
        window.AnswerPipelineConfig?.streaming?.adaptiveTimeout?.hardMax
        || 0
      );
      return waitForAnswerComplete({
        modelName: tracker.modelName,
        timeoutMs: Math.max(
          Number(settings.answerCompleteTimeoutMs || 0),
          pipelineHardMaxMs
        ),
        stableMs: settings.stableMs,
        pollIntervalMs: settings.pollIntervalMs,
        traceId: tracker.traceId
      });
    }).catch((err) => {
      emitLifecycleTelemetry('LIFECYCLE_TRACKING_ERROR', {
        modelName: tracker.modelName,
        state: 'ERROR',
        confidence: 0
      });
      try {
        chrome.runtime.sendMessage({
          type: 'LLM_DIAGNOSTIC_EVENT',
          llmName: tracker.modelName,
          event: {
            type: 'LIFECYCLE',
            label: 'LIFECYCLE_TRACKING_ERROR',
            level: 'warning',
            details: err?.message || String(err),
            meta: { modelName: tracker.modelName, traceId: tracker.traceId }
          }
        });
      } catch (_) {}
    });
    return { ok: true, tracker, observationArmed: true };
  }

  function stopResponseLifecycleTracking({
    modelName = null,
    dispatchId = null,
    runSessionId = null,
    reason = 'cancelled'
  } = {}) {
    let stopped = false;
    const shouldStop = (tracker) => {
      if (!tracker) return false;
      if (modelName && tracker.modelName !== modelName) return false;
      if (dispatchId && tracker.dispatchId !== dispatchId) return false;
      if (runSessionId && tracker.runSessionId !== runSessionId) return false;
      return true;
    };
    Array.from(trackers.entries()).forEach(([key, tracker]) => {
      if (!shouldStop(tracker)) return;
      if (!tracker.completionTerminalResult && tracker.completionSession) {
        const contextLoss = /spa_navigation|session_expired|context|navigation/.test(String(reason));
        appendCompletionWitness(tracker, contextLoss ? 'CONTEXT_INVALIDATED' : 'USER_INTERRUPTED', { reason });
        const terminalResult = tracker.completionSession.evaluate(Date.now());
        if (terminalResult) commitCompletionResult(tracker, terminalResult);
      }
      if (!tracker.cancelledAt) {
        tracker.cancelledAt = Date.now();
      }
      closePostTerminalObservationWindow(tracker, 'unavailable');
      tracker.cancelReason = reason;
      tracker.cancelled = true;
      tracker.state = 'CANCELLED';
      try { tracker.observer?.disconnect?.(); } catch (_) {}
      tracker.observer = null;
      clearTrackerTimers(tracker);
      emitLifecycleTelemetry('LIFECYCLE_TRACKING_STOPPED', {
        modelName: tracker.modelName,
        state: 'CANCELLED',
        dispatchId: tracker.dispatchId,
        runSessionId: tracker.runSessionId,
        observerStoppedAt: tracker.cancelledAt,
        stopReason: reason,
        level: 'info',
        textLength: tracker.lastTextLength || 0,
        phaseEvidence: { reason }
      });
      if (tracker.diagnostics) {
        tracker.diagnostics.stopReason = reason;
      }
      trackers.delete(key);
      stopped = true;
    });
    return {
      ok: true,
      stopped,
      reason: stopped ? reason : 'no_active_tracker'
    };
  }

  async function maybePatchRuntimeMessaging() {
    if (runtimePatched) return;
    if (!chrome?.runtime?.sendMessage) return;
    runtimePatched = true;
    const originalSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = function patchedSendMessage(message, callback) {
      const cb = typeof callback === 'function' ? callback : null;
      if (message?.type === 'PROMPT_SUBMITTED' && message.llmName) {
        notePromptSendAttempt({ ...message.meta, modelName: message.llmName });
        const result = originalSendMessage(message, cb);
        Promise.resolve().then(() => startResponseLifecycleTracking({
          modelName: message.llmName,
          dispatchId: message?.meta?.dispatchId || null,
          runSessionId: message?.meta?.runSessionId || message?.meta?.sessionId || null,
          generationEpoch: message?.meta?.generationEpoch ?? null,
          candidateId: message?.meta?.candidateId || message?.meta?.answerCandidateId || null,
          documentInstanceId: message?.meta?.documentInstanceId || lifecycleDocumentInstanceId,
          navigationEpoch: message?.meta?.navigationEpoch ?? lifecycleNavigationEpoch,
          promptSubmittedAt: Date.now(),
          traceId: message?.meta?.traceId || message?.meta?.dispatchId || null,
          activateObservation: true
        })).catch(() => {});
        return result;
      }
      if ((message?.type === 'LLM_RESPONSE' || message?.type === 'FINAL_LLM_RESPONSE') && message.llmName && !message.error) {
        const answerText = normalizeText(message.answer || '');
        // A short answer is still an answer. Re-selecting it through a broad
        // fallback changed the text while retaining the original proof/HTML.
        if (answerText) {
          return originalSendMessage(message, cb);
        }
        Promise.resolve().then(async () => {
          const resolver = window.LLMExtension?.SelectorResolverV2;
          if (!resolver?.resolveLatestAssistantAnswer) {
            return originalSendMessage(message, cb);
          }
          const result = await resolver.resolveLatestAssistantAnswer({
            modelName: message.llmName,
            reason: 'collect',
            traceId: message?.meta?.traceId || message?.meta?.dispatchId || null
          });
          if (result?.ok && result.element) {
            registerAnswerCandidate({
              modelName: message.llmName,
              element: result.element,
              method: result.method,
              selector: result.selector,
              score: result.score,
              confidence: result.confidence,
              traceId: message?.meta?.traceId || message?.meta?.dispatchId || null,
              observedAt: Date.now()
            });
            const fallbackText = normalizeText(result.element.innerText || result.element.textContent || '');
            if (fallbackText) {
              const nextMessage = Object.assign({}, message, {
                answer: fallbackText
              });
              return originalSendMessage(nextMessage, cb);
            }
          }
          return originalSendMessage(message, cb);
        }).catch(() => {
          originalSendMessage(message, cb);
        });
        return;
      }
      return originalSendMessage(message, cb);
    };
  }

  function installLifecycleStopListeners() {
    try {
      chrome.runtime.onMessage?.addListener?.((message) => {
        const stopTypes = new Set(['STOP_AND_CLEANUP', 'SESSION_EXPIRED', 'SPA_NAVIGATION']);
        if (stopTypes.has(message?.type)) {
          if (message?.type === 'SPA_NAVIGATION') handleSpaNavigation(message);
          else stopResponseLifecycleTracking({ reason: String(message.type).toLowerCase() });
        } else if (message?.type === 'LATE_COLLECT_PING' || message?.action === 'LATE_COLLECT_PING') {
          wakeAllTrackers();
        } else if (message?.type === 'RESTORE_ATTEMPT' && message?.llmName) {
          reconcileRecovery({ modelName: message.llmName, persisted: message.persistedAttempt || message.meta?.persistedAttempt || null });
        }
      });
    } catch (_) {}
    try {
      window.addEventListener('LLM_CODEX_SPA_NAVIGATION', (event) => {
        handleSpaNavigation(event.detail || {});
      }, { passive: true });
    } catch (_) {}
    try {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') wakeAllTrackers();
      }, { passive: true });
    } catch (_) {}
  }

  // Creating a conversation changes the URL in the same document. It must not
  // cancel the dispatch that caused it, or poison its completion authority.
  // Keep this decision shared with provider cleanup and the base adapter.
  const conversationRoutes = {
    GPT: ['chatgpt.com', /^\/$/, /^\/c\/[^/]+$/],
    Claude: ['claude.ai', /^\/(?:new)?$/, /^\/chat\/[^/]+$/],
    Gemini: ['gemini.google.com', /^\/app$/, /^\/app\/[^/]+$/],
    Grok: ['grok.com', /^\/$/, /^\/c\/[^/]+$/],
    DeepSeek: ['chat.deepseek.com', /^\/(?:a\/chat)?$/, /^\/a\/chat\/s\/[^/]+$/],
    'Le Chat': ['chat.mistral.ai', /^\/(?:chat)?$/, /^\/chat\/[^/]+$/],
    Perplexity: ['perplexity.ai', /^\/$/, /^\/search\/[^/]+$/],
    Qwen: ['chat.qwen.ai', /^\/$/, /^\/c\/[^/]+$/],
    Kimi: ['kimi.ai', /^\/$/, /^\/chat\/[^/]+$/],
    'Z.ai': ['chat.z.ai', /^\/$/, /^\/c\/[^/]+$/]
  };

  function notePromptSendAttempt({ modelName, dispatchId, runSessionId } = {}) {
    const tracker = trackers.get(modelName);
    if (!isTrackerActive(tracker) || !dispatchId
      || String(tracker.dispatchId) !== String(dispatchId)
      || String(tracker.runSessionId) !== String(runSessionId)) return false;
    tracker.sendActionAt = Date.now();
    return true;
  }

  function shouldPreserveNavigation(detail = {}) {
    const modelName = detail.llmName || detail.modelName;
    const routes = conversationRoutes[modelName];
    if (!routes) return false;
    try {
      const previous = new URL(detail.previousUrl || detail.oldUrl);
      const next = new URL(detail.nextUrl || detail.newUrl);
      if (previous.origin !== next.origin || next.hostname.replace(/^www\./, '') !== routes[0]) return false;
      const oldPath = previous.pathname.replace(/\/$/, '') || '/';
      const newPath = next.pathname.replace(/\/$/, '') || '/';
      // Query/hash updates (e.g. Grok's rid) do not select a different chat.
      if (oldPath === newPath && (routes[1].test(oldPath) || routes[2].test(oldPath))) return true;
      const tracker = trackers.get(modelName);
      if (!isTrackerActive(tracker)) return false;
      const pair = `${previous.href}\n${next.href}`;
      if (tracker.preservedNavigation === pair) return true;
      return !tracker.preservedNavigation
        && tracker.navigationUrl === previous.href
        && tracker.turnAnchor === 0
        && tracker.sendActionAt !== null
        && Date.now() - tracker.sendActionAt <= 120000
        && detail.reason !== 'popstate'
        && routes[1].test(oldPath) && routes[2].test(newPath);
    } catch (_) { return false; }
  }

  function handleSpaNavigation(detail = {}) {
    const modelName = detail.llmName || detail.modelName;
    if (shouldPreserveNavigation(detail)) {
      const tracker = trackers.get(modelName);
      if (tracker) {
        const previousUrl = detail.previousUrl || detail.oldUrl;
        const nextUrl = detail.nextUrl || detail.newUrl;
        if (new URL(previousUrl).pathname !== new URL(nextUrl).pathname) {
          tracker.preservedNavigation = `${new URL(previousUrl).href}\n${new URL(nextUrl).href}`;
        }
        tracker.navigationUrl = nextUrl;
        attachTrackerObserver(tracker, document.body);
        wakeAllTrackers();
      }
      return true;
    }
    lifecycleNavigationEpoch += 1;
    stopResponseLifecycleTracking({ reason: 'spa_navigation' });
    return false;
  }

  function dispose({ reason = 'disposed' } = {}) {
    Array.from(trackers.values()).forEach((tracker) => releaseTrackerResources(tracker, reason));
    registeredCandidates.clear();
    trackerStartFlights.clear();
    return true;
  }

  async function runSelfTest() {
    const failures = [];
    try {
      const stable = isTextStable({ hash: 'a', length: 10 }, 'text', Date.now() - 2000, 1500);
      if (typeof stable.stable !== 'boolean') failures.push('isTextStable_invalid');
    } catch (err) {
      failures.push(`isTextStable_throw:${err?.message || err}`);
    }
    try {
      const indicators = detectGeneratingIndicators({ root: document });
      if (!indicators || typeof indicators !== 'object') failures.push('detectGeneratingIndicators_invalid');
    } catch (err) {
      failures.push(`detectGeneratingIndicators_throw:${err?.message || err}`);
    }
    return {
      ok: failures.length === 0,
      passed: failures.length ? 0 : 2,
      failed: failures.length,
      failures
    };
  }

  const ResponseLifecycleDetector = {
    createTracker,
    startResponseLifecycleTracking,
    activateResponseLifecycleTracking,
    stopResponseLifecycleTracking,
    notePromptSendAttempt,
    shouldPreserveNavigation,
    detectGenerationState: detectGeneratingIndicators,
    detectGeneratingIndicators,
    detectCheapComposerReadiness,
    waitForAnswerStart,
    waitForAnswerComplete,
    isTextStable,
    isTrackerActive,
    getLatestAnswerSnapshot,
    registerAnswerCandidate,
    captureTurnAnchor,
    verifyStructuralCompletion,
    observeWitness,
    getTerminalResult,
    getCompletionSnapshot,
    waitForTerminalResult,
    reconcileRecovery,
    schedulePostTerminalObservationWindow,
    closePostTerminalObservationWindow,
    POST_TERMINAL_OBSERVATION_OFFSETS_MS,
    RESPONSE_LIFECYCLE_DEFAULTS,
    LIFECYCLE_READINESS_RESOLVER_TIMEOUT_MS,
    STUCK_BUSY_OVERRIDE_MIN_MS,
    version: VERSION,
    buildVersion: BUILD_VERSION,
    protocolVersion: CompletionProtocol?.version || null,
    completionRuntimeDescriptor,
    announceRuntimeReady,
    runSelfTest
    , dispose
  };

  window.LLMExtension = window.LLMExtension || {};
  window.LLMExtension.ResponseLifecycleDetector = ResponseLifecycleDetector;
  window.ResponseLifecycleDetector = ResponseLifecycleDetector;
  installLifecycleStopListeners();
  // Read settings while the page initializes, outside the focused Send path.
  getSettings().catch(() => {});
  maybePatchRuntimeMessaging().catch(() => {});
  announceRuntimeReady();
})();
