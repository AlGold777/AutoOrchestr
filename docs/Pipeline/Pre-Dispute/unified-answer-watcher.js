/* eslint-disable no-console */

(function initUnifiedAnswerWatcher() {
  const namespace = window.AnswerPipeline = window.AnswerPipeline || {};
  if (namespace.UnifiedAnswerCompletionWatcher) return;

  const Modules = window.UnifiedPipelineModules;
  const Config = window.AnswerPipelineConfig;
  const SelectorBundle = window.AnswerPipelineSelectors;
  if (!Modules || !Config || !SelectorBundle) {
    console.warn('[AnswerWatcher] Missing dependencies (modules/config/selectors)');
    return;
  }

  const { PLATFORM_SELECTORS, detectPlatform } = SelectorBundle;
  const {
    UniversalCompletionCriteria,
    AdaptiveTimeoutManager
  } = Modules;

  const SELECTOR_MISS_WINDOW_MS = Number(Config.telemetry?.selectorMissWindowMs || 5000);
  const SELECTOR_STATS_WINDOW_MS = Number(Config.telemetry?.selectorStatsWindowMs || SELECTOR_MISS_WINDOW_MS);
  const SELECTOR_STATS_DEDUP_WINDOW_MS = Number(Config.telemetry?.selectorStatsDedupWindowMs || 30000);
  const selectorStatsBuckets = new Map();
  const selectorStatsLastEmit = new Map();
  const selectorTargetLastHitAt = new Map();

  const buildSelectorStatKey = (llmName, targetType, selector) => {
    const normalizedName = (llmName || 'unknown').toString().trim();
    const normalizedTarget = (targetType || 'generic').toString().trim();
    const normalizedSelector = selector.toString().trim();
    return `${normalizedName}::${normalizedTarget}::${normalizedSelector}`;
  };

  const flushSelectorStatsBucket = (key) => {
    const bucket = selectorStatsBuckets.get(key);
    if (!bucket) return;
    clearTimeout(bucket.timer);
    selectorStatsBuckets.delete(key);
    const now = Date.now();
    const durationMs = Math.max(1, now - (bucket.firstTs || now));
    const detailSelector = bucket.selector || 'unknown';
    const detailType = bucket.targetType ? ` (${bucket.targetType})` : '';
    const hitCount = Number(bucket.hitCount || 0);
    const missCount = Number(bucket.missCount || 0);
    const totalCount = hitCount + missCount;
    const hitRate = totalCount ? Math.round((hitCount / totalCount) * 100) : 0;
    const targetKey = `${bucket.llmName || bucket.platform || 'unknown'}::${bucket.targetType || 'generic'}`;
    const lastAlternativeHitAt = Number(selectorTargetLastHitAt.get(targetKey) || 0);
    const coveredByAlternative = hitCount === 0
      && lastAlternativeHitAt >= Number(bucket.firstTs || 0)
      && lastAlternativeHitAt <= now;
    const details = `${detailSelector}${detailType} hit=${hitCount} miss=${missCount} (${hitRate}%) over ${durationMs}ms`;
    const signature = `${detailSelector}|${bucket.targetType || ''}|${hitCount}|${missCount}|${hitRate}`;
    const previousEmit = selectorStatsLastEmit.get(key);
    const isDuplicate = previousEmit
      && previousEmit.signature === signature
      && (now - Number(previousEmit.ts || 0)) < SELECTOR_STATS_DEDUP_WINDOW_MS;
    if (isDuplicate) {
      return;
    }
    selectorStatsLastEmit.set(key, { signature, ts: now });
    const event = {
      ts: now,
      type: 'SELECTOR',
      label: 'SELECTOR_STATS',
      details,
      level: coveredByAlternative ? 'info' : 'warning',
      meta: Object.assign({
        platform: bucket.platform,
        target: bucket.targetType,
        selector: bucket.selector,
        aggregated: true,
        hitCount,
        missCount,
        totalCount,
        hitRate,
        durationMs,
        coveredByAlternative,
        selectorPackVersion: bucket.selectorPackVersion || null
      }, bucket.meta || {})
    };
    try {
      chrome.runtime?.sendMessage?.({
        type: 'LLM_DIAGNOSTIC_EVENT',
        llmName: bucket.llmName || bucket.platform,
        event
      });
    } catch (err) {
      console.warn('[AnswerWatcher] selector miss aggregate failed', err);
    }
  };

  const queueSelectorStatsAggregation = (llmName, targetType, selector, { hit = false, meta = {} } = {}) => {
    if (!selector) return;
    const key = buildSelectorStatKey(llmName, targetType, selector);
    const existing = selectorStatsBuckets.get(key) || {
      llmName,
      platform: llmName || 'unknown',
      targetType,
      selector,
      hitCount: 0,
      missCount: 0,
      firstTs: Date.now(),
      meta: meta,
      selectorPackVersion: meta?.selectorPackVersion || null,
      timer: null
    };
    if (hit) {
      existing.hitCount += 1;
      selectorTargetLastHitAt.set(`${llmName || 'unknown'}::${targetType || 'generic'}`, Date.now());
    } else {
      existing.missCount += 1;
    }
    existing.meta = Object.assign({}, existing.meta || {}, meta || {});
    if (!existing.timer) {
      existing.firstTs = existing.firstTs || Date.now();
      existing.timer = setTimeout(() => flushSelectorStatsBucket(key), SELECTOR_STATS_WINDOW_MS);
    }
    selectorStatsBuckets.set(key, existing);
  };

  // v2.54.24 (2025-12-22 23:14 UTC): Verbose flags for completion watcher (Purpose: enable detailed criteria logging).
  const readFlag = (key) => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return null;
      return raw === 'true' || raw === '1';
    } catch (_) {
      return null;
    }
  };

  const resolveVerboseCriteria = (options = {}) => {
    if (typeof options.verboseCriteria === 'boolean') return options.verboseCriteria;
    const flags = window.LLMExtension?.flags || {};
    if (typeof flags.verboseAnswerWatcher === 'boolean') return flags.verboseAnswerWatcher;
    if (typeof flags.verboseLogging === 'boolean') return flags.verboseLogging;
    const storageFlag = readFlag('__verbose_answer_watcher');
    return storageFlag === null ? false : storageFlag;
  };

  class UnifiedAnswerCompletionWatcher {
    constructor(platform, options = {}) {
      this.platform = platform || detectPlatform?.() || 'generic';
      this.selectors = PLATFORM_SELECTORS[this.platform] || PLATFORM_SELECTORS.generic || {};
      const completionConfig = Object.assign({}, Config.streaming?.completionCriteria || {}, options.completionCriteria || {});
      const adaptiveConfig = Object.assign({}, Config.streaming?.adaptiveTimeout || {}, options.adaptiveTimeout || {});
      this.config = completionConfig;
      this.humanSession = options.humanSession || null;
      this.criteria = new UniversalCompletionCriteria(completionConfig);
      this.timeoutManager = new AdaptiveTimeoutManager(adaptiveConfig);
      this.expectedLength = options.expectedLength || null;
      this.timeoutManager.setExpectedLength?.(this.expectedLength);
      this.checkInterval = completionConfig.checkInterval || 1000;
      this.minMetCriteria = completionConfig.minMetCriteria || 4;
      this.stopButtonCheckMode = completionConfig.stopButtonCheckMode || 'cached';
      this.stopButtonCacheMaxAgeMs = Number(completionConfig.stopButtonCacheMaxAgeMs) || this.checkInterval;
      this.options = options;
      this.llmName = options.llmName || null;
      this.baselineAnswerSignature = String(options.baselineAnswerSignature || '');
      this.anchorAnswerCount = Number(options.anchorAnswerCount || 0) || 0;
      this.freshAnswerObserved = false;
      this.lastAnswerCandidateCount = 0;
      this.verboseCriteria = resolveVerboseCriteria(options);
      this.scrollHeightHistory = [];
      this.invalidSelectors = new Set();
      this.lastStopVisible = false;
      this.lastStopVisibleAt = 0;
      this.stopSeenAt = 0;
      this.stopDisappearedAt = 0;
      this.lastCriteriaLogKey = '';
      this.lastStopSelector = null;
      this.lastStopSelectorAttempt = null;
      this.lastRegenerateSelector = null;
      this.lastRegenerateSelectorAttempt = null;
      this.lastCopySelector = null;
      this.lastCopySelectorAttempt = null;
      this.lastCopyButtonMeta = null;
      this.lastCopySignalLogKey = '';
      this.autoDiscoveredSelectors = this.initAutoDiscoveredSelectors();
      this.autoDiscoveryInFlight = new Set();
      this.contentStableStreak = 0;
      this.fingerprintStableStreak = 0;
      this.lastFingerprint = '';
      this.fingerprintStable = false;
      this.latestContentLength = 0;
      this.lastContentChangeAt = 0;
      this.scoreThreshold = completionConfig.scoring?.threshold || 0.6;
      this.scoreWeights = Object.assign({
        typingGone: 0.35,
        contentStable: 0.3,
        mutationIdle: 0.2,
        scrollStable: 0.05,
        sentinelVisible: 0.05,
        copyButtonVisible: 0.15
      }, completionConfig.scoring?.weights || {});
      this.fingerprintBonus = typeof completionConfig.scoring?.fingerprintBonus === 'number'
        ? completionConfig.scoring.fingerprintBonus
        : 0.1;
      this.scoringEnabled = completionConfig.scoring?.enabled !== false;
      this.contentStableChecks = Number(completionConfig.contentStableChecks || 3);
      this.contentStableDelta = Number(completionConfig.contentStableDelta || 5);
      this.copyButtonSignalEnabled = completionConfig.copyButtonSignalEnabled !== false;
      this.copyButtonRequiresStableText = completionConfig.copyButtonRequiresStableText !== false;
      this.copyButtonMinAnswerLength = Number(completionConfig.copyButtonMinAnswerLength || 80);
      this.copyButtonMaxDistancePx = Number(completionConfig.copyButtonMaxDistancePx || 900);
      this.fingerprintStableChecks = Number(completionConfig.fingerprintStableChecks || 3);
      this.fingerprintSampleLength = Number(completionConfig.fingerprintSampleLength || 100);
      this.detectorWindowMs = Number(Config.telemetry?.detectorTickWindowMs || 5000);
      this.detectorWindowStart = 0;
      this.detectorWindowCount = 0;
      this.lastDetectorSnapshot = null;
      this.lastContentDelta = 0;
      this.firstTokenAt = 0;
      this.firstTokenLength = 0;
      this.firstStopSeenAt = 0;
      this.firstRegenerateSeenAt = 0;
      this.metrics = {
        stopVisible: false,
        stopDisappeared: false
      };
      this.state = {
        lastChangeTime: Date.now()
      };
      // Evidence layer. The watcher keeps returning the same `{completed,
      // reason, confidence}` shape it always did; what is new is that every
      // result now also carries a typed run result saying how strongly it was
      // proven, and that a contradicting fact can veto a commit the DOM
      // signals would otherwise have made.
      this.transport = window.TransportEvidence?.forPlatform?.(this.platform, { llmName: this.llmName }) || null;
      this.maxObservedTextLength = 0;
      this.lastLadderVerdict = null;
      this.lastWitnessSet = null;
      this.runtimeIdAtStart = this.readRuntimeId();
      this.lastWitnessState = new Map();
      this.currentAnswerElement = null;
      this.lastMutationContentHash = null;
      this.lastMutationStructuralHash = null;
    }

    emitWitness(type, payload = null, dedupeKey = type) {
      const lifecycle = window.LLMExtension?.ResponseLifecycleDetector || window.ResponseLifecycleDetector;
      if (!lifecycle?.observeWitness || !this.llmName) return false;
      const signature = JSON.stringify(payload || null);
      if (dedupeKey && this.lastWitnessState.get(dedupeKey) === signature) return false;
      if (dedupeKey) this.lastWitnessState.set(dedupeKey, signature);
      return lifecycle.observeWitness({
        modelName: this.llmName,
        dispatchId: this.runDispatchId,
        type,
        payload,
        source: 'UnifiedAnswerCompletionWatcher'
      });
    }

    buildAuthorityResult(terminalResult, recentGrowth = 0) {
      const lifecycle = window.LLMExtension?.ResponseLifecycleDetector || window.ResponseLifecycleDetector;
      const snapshot = lifecycle?.getCompletionSnapshot?.({ modelName: this.llmName, dispatchId: this.runDispatchId }) || null;
      const success = terminalResult?.status === 'SUCCESS_TERMINAL';
      return {
        success,
        completed: success,
        reason: terminalResult?.reason || 'completion_authority_unavailable',
        terminalResult: terminalResult || null,
        extractionSnapshot: snapshot?.extractionSnapshot || null,
        duration: Date.now() - this.startTime,
        indicators: { streaming: terminalResult == null },
        scrollGrowthInLast2s: recentGrowth,
        diagnosticConfidence: this.calculateScore(),
        criteriaMet: this.criteria.metCount()
      };
    }

    buildLegacyRolloutResult(rolloutMode, legacyDecision, recentGrowth = 0) {
      return {
        success: legacyDecision?.accepted === true,
        completed: legacyDecision?.accepted === true,
        reason: legacyDecision?.reason || 'legacy_candidate_unproven',
        terminalResult: null,
        extractionSnapshot: null,
        rolloutMode,
        legacyDecision: legacyDecision || null,
        duration: Date.now() - this.startTime,
        indicators: { streaming: false },
        scrollGrowthInLast2s: recentGrowth,
        diagnosticConfidence: this.calculateScore(),
        criteriaMet: this.criteria.metCount()
      };
    }

    async waitForCompletion(params = {}) {
      this.container = this.resolveContainer(params?.container);
      this.criteria.reset();
      this.scrollHeightHistory = [];
      this.startTime = Date.now();
      this.firstTokenAt = 0;
      this.firstTokenLength = 0;
      this.firstStopSeenAt = 0;
      this.firstRegenerateSeenAt = 0;
      this.maxObservedTextLength = 0;
      this.runDispatchId = params?.dispatchId || this.options.dispatchId || null;
      this.transport?.beginRun?.({ startedAt: this.startTime, dispatchId: this.runDispatchId });
      const currentLength = this.getCurrentContentLength();
      const { soft, hard } = this.timeoutManager.calculateTimeout(currentLength, {
        expectedLength: this.expectedLength
      });
      let typingActive = true;
      const growthHistory = [];

      const recordGrowth = (diff) => {
        const now = Date.now();
        growthHistory.push({ ts: now, diff });
        while (growthHistory.length && now - growthHistory[0].ts > 2000) {
          growthHistory.shift();
        }
      };

      const getRecentGrowth = () => {
        const now = Date.now();
        return growthHistory
          .filter((item) => now - item.ts <= 2000)
          .reduce((sum, item) => sum + item.diff, 0);
      };

      let lastMutation = Date.now();
      let lastScrollHeight = this.getScrollHeight();
      let lastContentLength = 0;
      const mutationOptions = { childList: true, subtree: true, characterData: true, attributes: true };
      const stopObserve = window.ContentUtils?.observeMutations
        ? window.ContentUtils.observeMutations(this.container, mutationOptions, (mutations) => {
          const answerRoot = this.currentAnswerElement;
          const currentText = answerRoot ? this.readAnswerText(answerRoot) : '';
          const currentHash = this.hashString(currentText);
          const currentStructuralHash = this.hashString(String(answerRoot?.innerHTML || ''));
          const classifier = window.CompletionProtocol?.MutationClassifier
            ? new window.CompletionProtocol.MutationClassifier()
            : null;
          const classified = classifier?.classify?.(mutations, {
            responseRoot: answerRoot,
            normalizedBefore: this.lastMutationContentHash,
            normalizedAfter: currentHash,
            structuralBefore: this.lastMutationStructuralHash,
            structuralAfter: currentStructuralHash,
            isProducerControl: (node) => !!node?.closest?.('button,[role="button"],[aria-label*="stop" i],[data-testid*="stop" i]'),
            isCosmetic: (node) => !!node?.closest?.('[aria-live],[class*="cursor" i],[class*="toolbar" i]')
          }) || [];
          const substantive = !classifier || !answerRoot || classified.some((entry) => entry.substantive);
          this.lastMutationContentHash = currentHash;
          this.lastMutationStructuralHash = currentStructuralHash;
          if (substantive) {
            lastMutation = Date.now();
            this.criteria.mark('mutationIdle', false);
            this.humanSession?.reportActivity?.('mutation');
            const structural = classified.some((entry) => entry.kind === 'RESPONSE_STRUCTURE');
            this.emitWitness(structural ? 'RESPONSE_STRUCTURE_CHANGED' : 'CONTENT_PROGRESS', {
              mutationCount: classified.length,
              contentHash: currentHash,
              structuralHash: currentStructuralHash
            }, null);
          } else if (classified.some((entry) => entry.kind === 'COSMETIC')) {
            this.emitWitness('COSMETIC_MUTATION', { mutationCount: classified.length }, 'cosmetic-mutation');
          }
        })
        : (() => () => {})();

      let cleanup = () => {};
      const updateHandle = setInterval(() => {
        const hardStopped = window.__LLMScrollHardStop || this.humanSession?.getState?.() === 'HARD_STOP';
        if (hardStopped) {
          this.emitWitness('USER_INTERRUPTED', { reason: 'hard_stop' }, null);
          cleanup(this.buildResult('hard_stop', 0, typingActive, getRecentGrowth(), false));
          return;
        }
        const now = Date.now();
        if (now - lastMutation > (this.criteria.criteria.mutationIdle?.threshold || 1500)) {
          this.criteria.mark('mutationIdle', true);
        }

        const height = this.getScrollHeight();
        this.scrollHeightHistory.push({ timestamp: now, height });
        while (this.scrollHeightHistory.length > 40) {
          this.scrollHeightHistory.shift();
        }
        if (Math.abs(height - lastScrollHeight) < 2) {
          this.criteria.mark('scrollStable', true);
        } else {
          if (height - lastScrollHeight > 0) {
            recordGrowth(height - lastScrollHeight);
          }
          lastScrollHeight = height;
          this.criteria.mark('scrollStable', false);
        }

        typingActive = this.detectTyping();
        this.criteria.mark('typingGone', !typingActive);
        const regenerateVisible = this.detectRegenerateVisible();
        this.criteria.mark('regenerateVisible', regenerateVisible);

        const sentinelVisible = this.isSentinelVisible();
        this.criteria.mark('sentinelVisible', sentinelVisible);

          const answerEl = this.getAnswerElement();
          if (answerEl) {
            this.currentAnswerElement = answerEl;
            const text = this.readAnswerText(answerEl);
            const len = text.length || 0;
            const normalizedText = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (
              (this.lastAnswerCandidateCount > this.anchorAnswerCount)
              || (!!normalizedText && normalizedText !== this.baselineAnswerSignature)
            ) {
              this.freshAnswerObserved = true;
              this.emitWitness('FRESH_RESPONSE_OBSERVED', { textLength: len }, 'fresh-response');
            }
          this.latestContentLength = len;
          // Within one turn text does not un-generate. A shorter observation
          // than the maximum already seen means the current reading is not the
          // final one, so it must not be committed on.
          if (len > this.maxObservedTextLength) this.maxObservedTextLength = len;
          const delta = len - lastContentLength;
          this.lastContentDelta = delta;
          const absDelta = Math.abs(delta);
          if (absDelta > 0) {
            this.lastContentChangeAt = now;
            this.emitWitness('CONTENT_PROGRESS', { textLength: len, delta }, null);
          }
          if (len > 0 && absDelta <= this.contentStableDelta) {
            this.contentStableStreak += 1;
          } else {
            this.contentStableStreak = 0;
          }
          lastContentLength = len;
          if (!this.firstTokenAt && len > 0) {
            this.firstTokenAt = Date.now();
            this.firstTokenLength = len;
          }
          this.criteria.mark('contentStable', this.contentStableStreak >= this.contentStableChecks);

          const sample = this.fingerprintSampleLength > 0
            ? text.slice(-this.fingerprintSampleLength)
            : text;
          const fingerprint = this.hashString(sample);
          if (fingerprint && fingerprint === this.lastFingerprint) {
            this.fingerprintStableStreak += 1;
          } else {
            this.lastFingerprint = fingerprint;
            this.fingerprintStableStreak = 0;
          }
          this.fingerprintStable = this.fingerprintStableStreak >= this.fingerprintStableChecks;
          if (delta > 0) {
            this.timeoutManager.recalculateOnGrowth?.(len);
            this.humanSession?.reportActivity?.('content-change');
          }
        } else {
          this.criteria.mark('contentStable', false);
          this.fingerprintStable = false;
        }
      }, this.checkInterval / 2);

      return new Promise((resolve) => {
        let checkHandle;
        cleanup = (payload) => {
          clearInterval(checkHandle);
          clearInterval(updateHandle);
          stopObserve();
          this.emitDetectorDone(payload, this.lastDetectorSnapshot || {});
          resolve(payload);
        };

        checkHandle = setInterval(() => {
          const lifecycle = window.LLMExtension?.ResponseLifecycleDetector || window.ResponseLifecycleDetector;
          const terminalResult = lifecycle?.getTerminalResult?.({ modelName: this.llmName, dispatchId: this.runDispatchId }) || null;
          if (terminalResult) {
            cleanup(this.buildAuthorityResult(terminalResult, getRecentGrowth()));
            return;
          }
          if (this.config.completionSignalEnabled) {
            const stopBtn = this._findStopButton();
            if (stopBtn) {
              this.metrics.stopVisible = true;
              this.state.lastChangeTime = Date.now();
            } else if (this.metrics.stopVisible) {
              const changeTs = Date.now();
              this.metrics.stopVisible = false;
              this.metrics.stopDisappeared = true;
              this.state.lastChangeTime = changeTs;
              this.stopDisappearedAt = changeTs;
            }
          }
          // stop_disappeared is evidence only; final completion needs corroborating signals below.
          const stopVisible = this.getStopVisible();
          this.emitWitness(stopVisible ? 'STOP_VISIBLE' : 'STOP_ABSENT', { visible: stopVisible }, 'stop-state');
          const stopDisappeared = Boolean(this.stopDisappearedAt) && !stopVisible;
          const regenerateVisible = this.detectRegenerateVisible();
          const completionSignal = this.detectCompletionIndicator();
          const copyButtonReady = this.copyButtonSignalEnabled ? this.detectCopyButtonNearLatestAnswer() : false;
          const copyButtonMeta = this.lastCopyButtonMeta || {};
          const copyButtonStable = copyButtonReady
            && !stopVisible
            && this.latestContentLength >= this.copyButtonMinAnswerLength
            && (!this.copyButtonRequiresStableText || this.criteria.criteria.contentStable?.met || this.fingerprintStable);
          if (regenerateVisible) this.emitWitness('REGENERATE_VISIBLE', null, 'regenerate-visible');
          if (completionSignal) this.emitWitness('COMPLETION_MARKER_VISIBLE', null, 'completion-marker-visible');
          if (copyButtonReady) this.emitWitness('COPY_VISIBLE', { stable: copyButtonStable }, 'copy-visible');
          this.criteria.mark('completionSignal', completionSignal);
          this.criteria.mark('copyButtonVisible', copyButtonStable);
          const contentMutationStableNow = Boolean(this.criteria.criteria.contentStable?.met && this.criteria.criteria.mutationIdle?.met);
          const evidence = this.evaluateEvidence({
            stopVisible,
            stopDisappeared,
            regenerateVisible,
            completionSignal,
            copyButtonStable,
            contentMutationStable: contentMutationStableNow,
            scoreMet: false,
            // An observer is only expected to be saying something while output
            // is believed to be in flight. Quiet sensors after the answer is
            // written are correct behaviour, not a health problem.
            outputExpected: Boolean(typingActive || stopVisible || this.transport?.isStreamOpen?.())
          });
          // A contradicting fact — the provider stream still delivering, the
          // text shorter than its own maximum — forbids the commit that the
          // DOM signals below would otherwise make. Waiting longer is the
          // cheap error; committing an unfinished answer is the expensive one.
          const vetoed = Boolean(evidence?.veto?.active);
          const expiration = this.timeoutManager.checkExpiration();
          if (stopVisible) {
            if (expiration.hardExpired) {
              cleanup(this.buildResult('hard_timeout', 0.3, typingActive, getRecentGrowth(), false));
            }
            return;
          }
          // The provider said the turn is over on its own protocol. Committing
          // still waits for the renderer to catch up with the producer: the
          // terminal fact is about the stream, the text comes from the page.
          const metCount = this.criteria.metCount();
          const criteriaTotal = Object.values(this.criteria.criteria).filter((c) => c.enabled !== false).length || 5;
          const snapshot = {
            signal: {
              stopVisible,
              regenerateVisible,
              completionSignal,
              copyButtonPresent: !!copyButtonMeta.present,
              copyButtonVisible: !!copyButtonMeta.visible,
              copyButtonInteractable: !!copyButtonMeta.interactable,
              copyButtonStable,
              copyType: copyButtonMeta.copyType || null,
              stopDisappeared,
              typingActive
            },
            metCount,
            criteriaTotal,
            score: this.calculateScore(),
            contentLength: this.latestContentLength,
            contentDelta: this.lastContentDelta,
            contentHash: this.lastFingerprint || null,
            contentStableStreak: this.contentStableStreak,
            fingerprintStableStreak: this.fingerprintStableStreak,
            contentStableChecks: this.contentStableChecks,
            fingerprintStableChecks: this.fingerprintStableChecks,
            responseTextLength: this.latestContentLength,
            growthRate: this.latestContentLength > 0
              ? (this.latestContentLength / Math.max(1, (Date.now() - this.startTime) / 1000))
              : 0,
            timeToFirstToken: this.firstTokenAt ? (this.firstTokenAt - this.startTime) : null,
            timeToStopVisible: this.firstStopSeenAt ? (this.firstStopSeenAt - this.startTime) : null,
            timeToRegenerateVisible: this.firstRegenerateSeenAt ? (this.firstRegenerateSeenAt - this.startTime) : null,
            hidden: !!document.hidden,
            hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : null,
            evidenceClass: evidence?.strongestClass || null,
            evidenceTerminality: evidence?.terminality || null,
            evidenceGuarantee: evidence?.guarantee || null,
            evidenceVeto: vetoed ? (evidence?.veto?.kinds || []).join(',') : null,
            transportAvailable: this.lastTransportSnapshot?.available ?? null,
            transportStreamOpen: this.lastTransportSnapshot?.streamOpen ?? null,
            maxObservedTextLength: this.maxObservedTextLength
          };
          this.lastDetectorSnapshot = snapshot;
          this.maybeEmitDetectorTick(snapshot);
          this.maybeLogCriteria({
            stopVisible,
            regenerateVisible,
            completionSignal,
            copyButtonVisible: !!copyButtonMeta.visible,
            copyButtonStable,
            stopDisappeared,
            metCount,
            criteriaTotal
          });
          const contentMutationStable = contentMutationStableNow;
          if (contentMutationStable) this.emitWitness('COSMETIC_MUTATION', { contentStable: true }, 'stable-observation');

          const completionSnapshot = lifecycle?.getCompletionSnapshot?.({ modelName: this.llmName, dispatchId: this.runDispatchId }) || null;
          const rolloutMode = window.CompletionProtocol?.CompletionRollout?.normalize?.(completionSnapshot?.rolloutMode) || 'enforced';
          if (window.CompletionProtocol?.CompletionRollout?.permitsLegacyDelivery?.(rolloutMode)) {
            const legacyDecision = window.CompletionProtocol.CompletionRollout.evaluateLegacyCandidate({
              freshAnswerObserved: this.freshAnswerObserved,
              vetoActive: vetoed,
              stopVisible,
              contentStable: this.criteria.criteria.contentStable?.met === true,
              fingerprintStable: this.fingerprintStable,
              transportTerminal: evidence?.canCommit === true,
              regenerateVisible,
              completionMarkerVisible: completionSignal,
              copyButtonStable,
              contentMutationStable,
              signals: [
                evidence?.canCommit === true ? 'transport_terminal' : null,
                regenerateVisible ? 'regenerate_visible' : null,
                completionSignal ? 'completion_marker_visible' : null,
                copyButtonStable ? 'copy_button_stable' : null,
                contentMutationStable ? 'content_mutation_stable' : null
              ].filter(Boolean)
            });
            if (legacyDecision.accepted) {
              cleanup(this.buildLegacyRolloutResult(rolloutMode, legacyDecision, getRecentGrowth()));
              return;
            }
          }

          if (expiration.hardExpired) {
            cleanup(this.buildResult('hard_timeout', 0.3, typingActive, getRecentGrowth(), false));
            return;
          }

          if (expiration.softExpired) {
            if (metCount >= 2 && this.timeoutManager.extendSoftTimeout()) {
              return;
            }
            cleanup(this.buildResult('soft_timeout', 0.5, typingActive, getRecentGrowth(), false));
          }
        }, this.checkInterval);
      });
    }

    // Builds the witness set for this tick. The DOM observer is only healthy
    // while this document is the one it attached to and the page is not hidden
    // behind a discard; anything else is reported as blindness, because a
    // blinded observer's silence must not read as a finished model.
    buildWitnessSet(observations = {}) {
      const health = window.ObserverHealth;
      if (!health) return null;
      const now = Date.now();
      const transportInput = this.transport?.snapshot?.({ expectSignals: observations.outputExpected === true })?.observerInput
        || { installed: false };
      const witnessSet = health.buildWitnessSet({
        transport: transportInput,
        application: { installed: false },
        dom: {
          installed: true,
          lastSignalAt: this.lastContentChangeAt || this.startTime || now,
          expectSignals: observations.outputExpected === true,
          contextInvalidated: this.isRuntimeInvalidated(),
          documentEpochChanged: false
        },
        lifecycle: {
          installed: true,
          lastSignalAt: now,
          discarded: false
        }
      }, { now });
      this.lastWitnessSet = witnessSet;
      return witnessSet;
    }

    readRuntimeId() {
      try {
        if (typeof chrome === 'undefined' || !chrome || !chrome.runtime) return null;
        return chrome.runtime.id || null;
      } catch (_) {
        return null;
      }
    }

    // Only a real teardown counts: an id that was there at the start of the run
    // and is gone now. Never having had one (test harness, non-extension host)
    // is no opinion about the observer, not blindness.
    isRuntimeInvalidated() {
      if (!this.runtimeIdAtStart) return false;
      return this.readRuntimeId() !== this.runtimeIdAtStart;
    }

    // Everything the ladder needs for this tick: which completion signals are
    // present, and which facts contradict a commit right now.
    evaluateEvidence(observations = {}) {
      const ladder = window.CompletionEvidenceLadder;
      if (!ladder) return null;
      const transportSnapshot = this.transport?.snapshot?.({ outputExpected: true }) || null;
      const signals = [];
      const contradictions = [];

      if (transportSnapshot) {
        signals.push(...(transportSnapshot.signals || []));
        contradictions.push(...(transportSnapshot.contradictions || []));
      }
      if (observations.regenerateVisible) signals.push({ kind: 'regenerate_visible' });
      if (observations.completionSignal) signals.push({ kind: 'completion_indicator' });
      if (observations.copyButtonStable) signals.push({ kind: 'copy_button_stable' });
      if (observations.contentMutationStable) signals.push({ kind: 'content_mutation_stable' });
      if (observations.stopDisappeared) signals.push({ kind: 'stop_button_gone' });
      if (observations.scoreMet) signals.push({ kind: 'score_threshold' });
      if (observations.timeoutKind) signals.push({ kind: observations.timeoutKind });

      if (observations.stopVisible) {
        contradictions.push({ kind: 'stop_button_visible' });
      }
      if (this.maxObservedTextLength > 0 && this.latestContentLength < this.maxObservedTextLength) {
        contradictions.push({
          kind: 'text_shrunk',
          detail: `observed ${this.latestContentLength} after a maximum of ${this.maxObservedTextLength}`
        });
      }

      const verdict = ladder.evaluate({
        signals,
        contradictions,
        witnessSet: this.buildWitnessSet({ outputExpected: observations.outputExpected !== false }),
        transportOneToOne: window.ProviderStreamSemantics?.isOneToOne?.(this.platform) === true
      });
      this.lastLadderVerdict = verdict;
      this.lastTransportSnapshot = transportSnapshot;
      return verdict;
    }

    initAutoDiscoveredSelectors() {
      const cache = window.__AnswerWatcherSelectorCache || {};
      const key = this.platform || 'generic';
      if (!cache[key]) {
        cache[key] = {};
      }
      window.__AnswerWatcherSelectorCache = cache;
      return cache[key];
    }

    getAutoDiscoveredSelectors(type) {
      const values = this.autoDiscoveredSelectors?.[type];
      if (!values) return [];
      if (Array.isArray(values)) return values;
      return [values];
    }

    queueAutoDiscovery(type) {
      if (!type || this.autoDiscoveryInFlight.has(type)) return;
      const finder = window.SelectorFinder;
      if (!finder?.findOrDetectSelector) return;
      this.autoDiscoveryInFlight.add(type);
      const modelName = this.llmName || this.platform;
      finder.findOrDetectSelector({
        modelName,
        elementType: type,
        timeout: 1500,
        referenceElement: this.container || null
      })
        .then((result) => {
          const selector = result?.selector;
          if (!selector) return;
          const bucket = this.autoDiscoveredSelectors[type] || [];
          if (!bucket.includes(selector)) {
            bucket.unshift(selector);
          }
          this.autoDiscoveredSelectors[type] = bucket.slice(0, 5);
        })
        .catch(() => {})
        .finally(() => {
          this.autoDiscoveryInFlight.delete(type);
        });
    }

    getSelectorPackVersion() {
      try {
        return window.SelectorConfig?.detectUIVersion?.(this.platform) || null;
      } catch (_) {
        return null;
      }
    }

    emitDetectorEvent(label, meta = {}) {
      if (!label) return;
      const llmName = this.llmName || this.platform;
      const payload = {
        ts: Date.now(),
        type: 'TELEMETRY',
        label,
        details: '',
        level: 'info',
        meta: Object.assign({
          platform: this.platform,
          llmName
        }, meta || {})
      };
      const message = { type: 'LLM_DIAGNOSTIC_EVENT', llmName, event: payload };
      const safeSend = window.ContentUtils?.safeRuntimeSendMessage;
      if (safeSend) {
        safeSend(message);
        return;
      }
      try {
        chrome.runtime?.sendMessage?.(message);
      } catch (_) {}
    }

    // One short, low-cardinality string saying why this tick did not conclude.
    // The canonical export folds detector ticks into observation intervals and
    // keeps only the distinct `reason` values, so this is the whole budget for
    // answering "it ticked thirty times and decided nothing — why". Keep the
    // vocabulary closed, or the interval degenerates into one bucket per tick.
    describeEvidenceState() {
      const verdict = this.lastLadderVerdict;
      const transport = this.lastTransportSnapshot;
      const transportTag = transport?.available
        ? (transport.streamOpen ? 'transport:open' : 'transport:idle')
        : 'transport:off';
      // Checked first: no fresh answer means every commit branch is skipped
      // before any evidence is even weighed.
      if (!this.freshAnswerObserved) return `no_fresh_answer|${transportTag}`;
      if (!verdict) return `no_verdict|${transportTag}`;
      if (verdict.veto?.active) return `veto:${(verdict.veto.kinds || []).join('+') || 'unknown'}|${transportTag}`;
      if (!verdict.strongestClass) return `no_terminal_evidence|${transportTag}`;
      return `${verdict.terminality}:${verdict.strongestClass}|${transportTag}`;
    }

    maybeEmitDetectorTick(snapshot = {}) {
      const now = Date.now();
      if (!this.detectorWindowStart) {
        this.detectorWindowStart = now;
      }
      this.detectorWindowCount += 1;
      this.lastDetectorSnapshot = snapshot;
      if (now - this.detectorWindowStart < this.detectorWindowMs) return;
      const payload = Object.assign({
        windowMs: this.detectorWindowMs,
        tickCount: this.detectorWindowCount,
        // Aggregated by the ledger into the interval's distinct reasons.
        reason: this.describeEvidenceState()
      }, snapshot || {});
      this.detectorWindowStart = now;
      this.detectorWindowCount = 0;
      this.emitDetectorEvent('DETECTOR_TICK', payload);
    }

    emitDetectorDone(result, snapshot = {}) {
      const now = Date.now();
      const lastChangeMsAgo = this.lastContentChangeAt
        ? Math.max(0, now - this.lastContentChangeAt)
        : null;
      this.emitDetectorEvent('DETECT_DONE', Object.assign({
        reason: result?.reason || null,
        completed: !!result?.completed,
        confidence: typeof result?.confidence === 'number' ? result.confidence : null,
        stableChecksUsed: this.contentStableStreak || 0,
        lastChangeMsAgo
      }, snapshot || {}));
    }

    emitCopyCompletionSignal(meta = {}) {
      const safeMeta = Object.assign({
        found: false,
        valid: false,
        present: false,
        visible: false,
        interactable: false,
        copyType: 'rejected'
      }, meta || {});
      const key = [
        safeMeta.found ? 1 : 0,
        safeMeta.valid ? 1 : 0,
        safeMeta.present ? 1 : 0,
        safeMeta.visible ? 1 : 0,
        safeMeta.interactable ? 1 : 0,
        safeMeta.copyType || '',
        safeMeta.selector || '',
        safeMeta.rejectedReason || safeMeta.reason || '',
        safeMeta.answerHash || ''
      ].join('|');
      if (key === this.lastCopySignalLogKey) return;
      this.lastCopySignalLogKey = key;
      this.emitDetectorEvent('COPY_COMPLETION_SIGNAL', safeMeta);
    }

    emitSelectorMiss(targetType, selector, meta = {}) {
      if (!selector) return;
      queueSelectorStatsAggregation(this.llmName || this.platform, targetType, selector, {
        hit: false,
        meta: Object.assign({
          platform: this.platform,
          target: targetType,
          selector,
          selectorPackVersion: this.getSelectorPackVersion()
        }, meta || {})
      });
    }

    recordSelectorHit(targetType, selector, meta = {}) {
      if (!selector) return;
      queueSelectorStatsAggregation(this.llmName || this.platform, targetType, selector, {
        hit: true,
        meta: Object.assign({
          platform: this.platform,
          target: targetType,
          selector,
          selectorPackVersion: this.getSelectorPackVersion()
        }, meta || {})
      });
    }

    normalizeSelectorList(input) {
      if (!input) return [];
      if (Array.isArray(input)) return input.filter(Boolean);
      if (typeof input === 'string') {
        return input
          .split(',')
          .map((sel) => sel.trim())
          .filter(Boolean);
      }
      return [];
    }

    mergeSelectors(primary = [], secondary = []) {
      const merged = [...primary, ...secondary].filter(Boolean);
      return Array.from(new Set(merged));
    }

    filterSelectors(list, type) {
      const circuit = window.SelectorCircuit;
      if (!circuit) return list || [];
      const filtered = [];
      (list || []).forEach((selector) => {
        if (circuit.shouldUse(selector, this.platform, type)) {
          filtered.push(selector);
        } else if (type === 'stopButton' || type === 'regenerateButton') {
          this.queueAutoDiscovery(type);
        }
      });
      return filtered;
    }

    getStopVisible() {
      const mode = this.stopButtonCheckMode;
      if (mode === 'direct') {
        return this.detectStopButtonVisible();
      }
      if (mode === 'fresh') {
        const ageMs = this.lastStopVisibleAt ? (Date.now() - this.lastStopVisibleAt) : Infinity;
        if (ageMs <= this.stopButtonCacheMaxAgeMs) return this.lastStopVisible;
        return this.detectStopButtonVisible();
      }
      return this.lastStopVisible;
    }

    _findStopButton() {
      const selectors = this.getStopSelectors();
      for (const selector of selectors) {
        const node = this.safeQuery(selector);
        const visible = node ? this.isElementVisible(node) : false;
        const disabled = node?.disabled || node?.getAttribute?.('aria-disabled') === 'true' || node?.getAttribute?.('data-disabled') === 'true';
        if (visible && !disabled) {
          return node;
        }
      }
      return null;
    }

    resolveContainer(containerParam) {
      if (containerParam?.element && containerParam.element !== window && containerParam.element.nodeType === 1) {
        return containerParam.element;
      }
      const candidates = [
        this.selectors.answerContainer,
        this.selectors.lastMessage
      ].filter(Boolean);
      for (const sel of candidates) {
        const el = this.safeQuery(sel);
        if (el) {
          if (this.selectors.answerContainer && sel === this.selectors.answerContainer) {
            return el;
          }
          return el.parentElement || el;
        }
      }
      const main = document.querySelector('main article') || document.querySelector('main') || document.querySelector('article');
      if (main) return main;
      return document.scrollingElement || document.documentElement || document.body;
    }

    detectTyping() {
      const circuit = window.SelectorCircuit;
      const filteredSelectors = {
        generatingIndicators: this.filterSelectors(this.selectors.generatingIndicators, 'generating'),
        streaming: this.filterSelectors(this.selectors.streaming, 'streaming'),
        stopButton: this.getStopSelectors()
      };
      const signal = window.GenerationSignal?.inspect?.({
        selectors: filteredSelectors,
        queryAll: (selector) => this.safeQueryAll(selector),
        isVisible: (node) => this.isElementVisible(node)
      }) || { active: true, kind: 'detector_unavailable', selector: null };
      if (signal.active && signal.selector) {
        circuit?.report(signal.selector, this.platform, signal.kind || 'generating', true);
      }
      return signal.active;
    }

    getStopSelectors() {
      const base = this.normalizeSelectorList(this.selectors.stopButton);
      const filtered = this.filterSelectors(base, 'stopButton');
      if (!filtered.length && base.length) {
        this.queueAutoDiscovery('stopButton');
      }
      const discovered = this.getAutoDiscoveredSelectors('stopButton');
      return this.mergeSelectors(discovered, filtered);
    }

    getRegenerateSelectors() {
      const base = this.normalizeSelectorList(this.selectors.regenerateButton);
      const fallback = base.length ? base : this.normalizeSelectorList(this.selectors.completionIndicators);
      const filtered = this.filterSelectors(fallback, 'regenerateButton');
      if (!filtered.length && fallback.length) {
        this.queueAutoDiscovery('regenerateButton');
      }
      const discovered = this.getAutoDiscoveredSelectors('regenerateButton');
      return this.mergeSelectors(discovered, filtered);
    }

    getCopyButtonSelectors() {
      const base = this.normalizeSelectorList(this.selectors.copyButton || this.selectors.copyButtons);
      const fallback = base.length ? base : this.normalizeSelectorList([
        'button[aria-label*="Copy" i]',
        'button[title*="Copy" i]',
        'button[data-testid*="copy" i]',
        '[role="button"][aria-label*="Copy" i]',
        '[role="button"][title*="Copy" i]',
        '[data-testid*="copy" i]',
        '[aria-label*="Copy response" i]',
        '[aria-label*="Copy answer" i]',
        '[aria-label*="Копировать"]',
        'button[class*="copy" i]'
      ]);
      const filtered = this.filterSelectors(fallback, 'copyButton');
      const discovered = this.getAutoDiscoveredSelectors('copyButton');
      return this.mergeSelectors(discovered, filtered);
    }

    detectStopButtonVisible() {
      const stopSelectors = this.getStopSelectors();
      let stopButton = null;
      let matchedSelector = null;
      for (const selector of stopSelectors) {
        this.lastStopSelectorAttempt = selector;
        const node = this.safeQuery(selector);
        const visible = node ? this.isElementVisible(node) : false;
        const disabled = node?.disabled || node?.getAttribute?.('aria-disabled') === 'true' || node?.getAttribute?.('data-disabled') === 'true';
        if (visible && !disabled) {
          stopButton = node;
          matchedSelector = selector;
          break;
        }
        this.emitSelectorMiss('stopButton', selector, {
          visible,
          disabled
        });
      }
      if (matchedSelector) {
        this.lastStopSelector = matchedSelector;
        this.recordSelectorHit('stopButton', matchedSelector, { visible: true });
        if (!this.firstStopSeenAt) {
          this.firstStopSeenAt = Date.now();
        }
      }
      const stopVisible = stopButton ? this.isElementVisible(stopButton) : false;
      const disabled = stopButton?.disabled || stopButton?.getAttribute?.('aria-disabled') === 'true' || stopButton?.getAttribute?.('data-disabled') === 'true';
      const wasVisible = this.lastStopVisible;
      this.lastStopVisible = Boolean(stopVisible && !disabled);
      if (wasVisible && !this.lastStopVisible) {
        this.stopDisappearedAt = Date.now();
      }
      if (this.lastStopVisible) {
        this.stopSeenAt = Date.now();
        this.stopDisappearedAt = 0;
      }
      this.lastStopVisibleAt = Date.now();
      return this.lastStopVisible;
    }

    isSentinelVisible() {
      const sentinel = document.getElementById('toolkit-sentinel');
      if (!sentinel) return false;
      const rect = sentinel.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight;
    }

    getScrollHeight() {
      const node = this.container === document.body ? document.documentElement : this.container;
      return node?.scrollHeight || document.documentElement.scrollHeight || 0;
    }

    getAnswerElement() {
      const deepQuery = window.TurnResolver?.createDeepQuery?.(document);
      const turn = window.TurnResolver?.resolveTurn?.({
        platform: this.platform,
        selectors: this.selectors,
        answerSelectors: this.options.answerSelectors,
        anchorAnswerCount: this.anchorAnswerCount,
        minimumTextLength: 1,
        selectorAllowed: (selector) => !window.SelectorCircuit
          || window.SelectorCircuit.shouldUse(selector, this.platform, 'answer') !== false,
        queryAll: (selector) => deepQuery?.all?.(selector) || this.safeQueryAll(selector),
        queryOne: (selector) => deepQuery?.one?.(selector) || this.safeQuery(selector)
      }) || null;
      this.lastTurnResolution = turn;
      this.lastAnswerCandidateCount = turn?.candidates?.length || 0;
      return turn?.answerNode || null;
    }

    getCurrentContentLength() {
      const el = this.getAnswerElement();
      return this.readAnswerText(el).length;
    }

    readAnswerText(element) {
      if (!element) return '';
      return window.AnswerStructure?.linearizeText?.(element) || '';
    }

    isCurrentTurnCompletionControl(el, currentRoot) {
      if (!currentRoot || !el || el.closest?.('[hidden], [aria-hidden="true"], [inert], pre, code')
        || el.disabled || el.getAttribute?.('aria-disabled') === 'true') return false;
      for (const selector of this.normalizeSelectorList(this.selectors.messageRoot)) {
        let owner = null;
        try { owner = el.closest(selector); } catch (_) {}
        if (owner && owner !== currentRoot && !currentRoot.contains(owner)) return false;
      }
      return true;
    }

    detectCompletionIndicator() {
      const completionSelectors = this.filterSelectors(this.selectors.completionIndicators, 'completion');
      if (!completionSelectors.length) return false;
      const circuit = window.SelectorCircuit;
      this.getAnswerElement();
      const currentRoot = this.lastTurnResolution?.messageRoot;
      if (!currentRoot) return false;
      return completionSelectors.some((selector) => {
        const nodes = this.safeQueryAll(selector);
        const found = Array.from(nodes).some((el) => {
          if (!this.isCurrentTurnCompletionControl(el, currentRoot)) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        });
        if (found) circuit?.report(selector, this.platform, 'completion', true);
        if (found) this.recordSelectorHit('completion', selector, { visible: true });
        return found;
      });
    }

    getAnswerScopes(answerEl) {
      if (!answerEl) return [];
      const scopes = [];
      const closest = answerEl.closest?.([
        '[data-testid*="conversation-turn" i]',
        '[data-testid*="message" i]',
        '[data-message-author-role="assistant"]',
        '[data-author-role="assistant"]',
        '[data-role="assistant"]',
        '[data-is-response="true"]',
        '.qwen-chat-message-assistant',
        '[class*="assistant" i]',
        '[role="article"]',
        'article',
        'section'
      ].join(', '));
      if (closest) scopes.push(closest);
      scopes.push(answerEl);
      let node = closest || answerEl;
      for (let depth = 0; depth < 3 && node?.parentElement; depth += 1) {
        node = node.parentElement;
        if (!node || node === document.body || node === document.documentElement) break;
        scopes.push(node);
      }
      return Array.from(new Set(scopes.filter(Boolean)));
    }

    querySelectorAllWithin(scope, selector) {
      try {
        return scope?.querySelectorAll?.(selector) || [];
      } catch (err) {
        if (!this.invalidSelectors.has(selector)) {
          this.invalidSelectors.add(selector);
          console.warn('[AnswerWatcher] Invalid scoped selector', selector, err);
        }
        window.SelectorCircuit?.report(selector, this.platform, 'copyButton', false);
        return [];
      }
    }

    getElementLabel(el) {
      if (!el) return '';
      return [
        el.getAttribute?.('aria-label'),
        el.getAttribute?.('title'),
        el.getAttribute?.('data-testid'),
        el.getAttribute?.('class'),
        el.textContent
      ].filter(Boolean).join(' ').trim();
    }

    isDisabledControl(el) {
      return !!(el?.disabled
        || el?.getAttribute?.('aria-disabled') === 'true'
        || el?.getAttribute?.('data-disabled') === 'true'
        || (typeof el?.getAttribute === 'function' && el.getAttribute('disabled') !== null));
    }

    getElementVisibilityState(el) {
      const present = !!el;
      const rawVisible = present ? this.isElementVisible(el) : false;
      let pointerEvents = '';
      let opacity = '';
      try {
        const style = present ? window.getComputedStyle(el) : null;
        pointerEvents = style?.pointerEvents || '';
        opacity = style?.opacity || '';
      } catch (_) {
        pointerEvents = '';
        opacity = '';
      }
      const visible = rawVisible && opacity !== '0';
      const disabled = this.isDisabledControl(el);
      return {
        present,
        visible,
        disabled,
        interactable: present && visible && !disabled && pointerEvents !== 'none'
      };
    }

    isAssistantScope(scope, answerEl = null) {
      const nodes = [scope, answerEl].filter(Boolean);
      const attrText = nodes.map((node) => [
        node.getAttribute?.('data-message-author-role'),
        node.getAttribute?.('data-author-role'),
        node.getAttribute?.('data-role'),
        node.getAttribute?.('role'),
        node.getAttribute?.('data-testid'),
        node.getAttribute?.('class')
      ].filter(Boolean).join(' ')).join(' ').toLowerCase();
      const htmlHint = nodes.map((node) => {
        try {
          return String(node.outerHTML || '').split('>')[0].slice(0, 700).toLowerCase();
        } catch (_) {
          return '';
        }
      }).join(' ');
      const haystack = `${attrText} ${htmlHint}`;
      const explicitAssistant = /(assistant|model-response|bot|response|answer|qwen-chat-message-assistant|claude-response)/i.test(haystack);
      const explicitUser = /(data-message-author-role=["']?user|data-author-role=["']?user|data-role=["']?user|\buser-message\b|\bhuman\b|\bprompt\b)/i.test(haystack);
      if (explicitAssistant && !explicitUser) {
        return { ok: true, confidence: attrText.includes('assistant') ? 'explicit' : 'inferred' };
      }
      return {
        ok: false,
        confidence: explicitUser ? 'rejected_user_scope' : 'unknown',
        reason: explicitUser ? 'user_scope' : 'not_assistant_scope'
      };
    }

    classifyCopyButton(button, answerEl, scope, selector, answerRect) {
      const state = this.getElementVisibilityState(button);
      const label = this.getElementLabel(button).toLowerCase();
      const assistantScope = this.isAssistantScope(scope, answerEl);
      const inCodeBlock = !!button?.closest?.('pre, code, [data-testid*="code" i], [class*="code" i]');
      const rect = button?.getBoundingClientRect?.() || null;
      const distancePx = this.getVerticalDistance(answerRect, rect);
      const hasCopyLabel = /(copy|clipboard|копир)/i.test(label);
      const misleadingLabel = /(share|link|url)/i.test(label) && !/(copy|clipboard|response|answer|message|code|копир)/i.test(label);
      let copyType = 'rejected';
      if (hasCopyLabel && assistantScope.ok && !inCodeBlock) {
        copyType = state.interactable ? 'message_toolbar' : 'answer_scope';
      } else if (hasCopyLabel && assistantScope.ok && inCodeBlock) {
        copyType = 'code_block';
      }
      const reasons = [];
      if (!hasCopyLabel) reasons.push('missing_copy_label');
      if (misleadingLabel) reasons.push('misleading_label');
      if (!assistantScope.ok) reasons.push(assistantScope.reason || 'not_assistant_scope');
      if (distancePx > this.copyButtonMaxDistancePx) reasons.push('too_far_from_answer');
      if (state.disabled) reasons.push('disabled');
      if (!state.present) reasons.push('not_present');
      if (!state.visible) reasons.push('not_visible');
      if (!state.interactable) reasons.push('not_interactable');
      if (inCodeBlock) reasons.push('code_block_only');
      const valid = hasCopyLabel
        && !misleadingLabel
        && assistantScope.ok
        && state.interactable
        && !inCodeBlock
        && distancePx <= this.copyButtonMaxDistancePx;
      return {
        valid,
        present: state.present,
        visible: state.visible,
        interactable: state.interactable,
        disabled: state.disabled,
        selector,
        label: label.slice(0, 120),
        copyType,
        inCodeBlock,
        assistantScope: assistantScope.ok,
        assistantScopeConfidence: assistantScope.confidence,
        distancePx,
        rejectedReason: valid ? null : (reasons[0] || 'rejected'),
        rejectedReasons: reasons
      };
    }

    getVerticalDistance(a, b) {
      if (!a || !b) return 0;
      if (a.bottom < b.top) return b.top - a.bottom;
      if (b.bottom < a.top) return a.top - b.bottom;
      return 0;
    }

    detectCopyButtonNearLatestAnswer() {
      this.lastCopyButtonMeta = { found: false, valid: false, present: false, visible: false, interactable: false, copyType: 'rejected', reason: 'not_checked' };
      const answerEl = this.getAnswerElement();
      if (!answerEl) {
        this.lastCopyButtonMeta = { found: false, valid: false, present: false, visible: false, interactable: false, copyType: 'rejected', reason: 'no_answer_element' };
        this.emitCopyCompletionSignal(this.lastCopyButtonMeta);
        return false;
      }
      const answerText = this.readAnswerText(answerEl);
      const textLength = answerText.length;
      const answerHash = this.hashString(answerText.slice(-500));
      if (textLength < this.copyButtonMinAnswerLength) {
        this.lastCopyButtonMeta = { found: false, valid: false, present: false, visible: false, interactable: false, copyType: 'rejected', reason: 'answer_too_short', textLength, answerHash };
        this.emitCopyCompletionSignal(this.lastCopyButtonMeta);
        return false;
      }
      const selectors = this.getCopyButtonSelectors();
      if (!selectors.length) {
        this.lastCopyButtonMeta = { found: false, valid: false, present: false, visible: false, interactable: false, copyType: 'rejected', reason: 'no_copy_selectors', textLength, answerHash };
        this.emitCopyCompletionSignal(this.lastCopyButtonMeta);
        return false;
      }
      const answerRect = answerEl.getBoundingClientRect?.() || null;
      const scopes = this.getAnswerScopes(answerEl);
      let best = null;
      for (const scope of scopes) {
        for (const selector of selectors) {
          this.lastCopySelectorAttempt = selector;
          const nodes = Array.from(this.querySelectorAllWithin(scope, selector));
          const classifications = [];
          for (const node of nodes) {
            const classified = this.classifyCopyButton(node, answerEl, scope, selector, answerRect);
            classifications.push(classified);
            const score = (classified.valid ? 100 : 0)
              + (classified.copyType === 'message_toolbar' ? 20 : 0)
              + (classified.copyType === 'answer_scope' ? 10 : 0)
              + (classified.copyType === 'code_block' ? 3 : 0)
              + (classified.present ? 2 : 0)
              + (classified.visible ? 2 : 0)
              + (classified.interactable ? 2 : 0);
            if (!best || score > best.score) {
              best = Object.assign({}, classified, {
                score,
                found: classified.present && /copy|clipboard|копир/i.test(classified.label || ''),
                textLength,
                answerHash,
                scopeTag: scope.tagName || null,
                scopeRole: scope.getAttribute?.('role') || null,
                candidateCount: nodes.length
              });
            }
          }
          const valid = classifications.find((item) => item.valid);
          if (valid) {
            this.lastCopySelector = selector;
            this.lastCopyButtonMeta = Object.assign({}, valid, {
              found: true,
              textLength,
              answerHash,
              scopeTag: scope.tagName || null,
              scopeRole: scope.getAttribute?.('role') || null,
              candidateCount: nodes.length,
              rejectedCount: classifications.filter((item) => !item.valid).length
            });
            window.SelectorCircuit?.report(selector, this.platform, 'copyButton', true);
            this.recordSelectorHit('copyButton', selector, this.lastCopyButtonMeta);
            this.emitCopyCompletionSignal(this.lastCopyButtonMeta);
            return true;
          }
          this.emitSelectorMiss('copyButton', selector, {
            visible: false,
            textLength,
            candidateCount: nodes.length,
            rejectedCount: classifications.length,
            scopeTag: scope.tagName || null
          });
        }
      }
      this.lastCopyButtonMeta = Object.assign({
        found: false,
        valid: false,
        present: false,
        visible: false,
        interactable: false,
        copyType: 'rejected',
        reason: best?.rejectedReason || 'no_visible_answer_copy_button',
        textLength,
        answerHash,
        scopeCount: scopes.length
      }, best || {});
      this.emitCopyCompletionSignal(this.lastCopyButtonMeta);
      return false;
    }

    detectRegenerateVisible() {
      const regenSelectors = this.getRegenerateSelectors();
      if (!regenSelectors.length) return false;
      this.getAnswerElement();
      const currentRoot = this.lastTurnResolution?.messageRoot;
      let match = null;
      for (const selector of regenSelectors) {
        this.lastRegenerateSelectorAttempt = selector;
        const node = Array.from(this.safeQueryAll(selector)).find((candidate) =>
          this.isCurrentTurnCompletionControl(candidate, currentRoot) && this.isElementVisible(candidate));
        const visible = Boolean(node);
        const disabled = node?.disabled
          || node?.getAttribute?.('aria-disabled') === 'true'
          || node?.getAttribute?.('data-disabled') === 'true';
        if (visible && !disabled) {
          match = selector;
          break;
        }
        this.emitSelectorMiss('regenerateButton', selector, {
          visible,
          disabled
        });
      }
      if (match) {
        this.lastRegenerateSelector = match;
        this.recordSelectorHit('regenerateButton', match, { visible: true });
        if (!this.firstRegenerateSeenAt) {
          this.firstRegenerateSeenAt = Date.now();
        }
        return true;
      }
      return false;
    }

    isElementVisible(el) {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }

    calculateScore() {
      const snapshot = this.buildCriteriaSnapshot();
      const weights = this.scoreWeights || {};
      let totalWeight = 0;
      let rawScore = 0;
      Object.keys(weights).forEach((key) => {
        const weight = Number(weights[key]) || 0;
        if (weight <= 0) return;
        const entry = snapshot[key];
        if (entry && entry.enabled !== false) {
          totalWeight += weight;
          if (entry.met) rawScore += weight;
        }
      });
      let score = totalWeight > 0 ? rawScore / totalWeight : 0;
      if (this.fingerprintStable) {
        score = Math.min(1, score + this.fingerprintBonus);
      }
      return score;
    }

    // The decision record for this run: which type the evidence supports,
    // under which guarantee, and on which axes. Text is not part of it — the
    // answer is materialized later, and the proof of terminality and the
    // source of the text are deliberately different components.
    buildRunProof(reason, completed) {
      const contract = window.RunResultContract;
      if (!contract) return null;
      const { RESULT_TYPES, AXIS_STATES } = contract;
      const verdict = this.lastLadderVerdict || null;
      const transport = this.lastTransportSnapshot || null;
      const witnessSet = this.lastWitnessSet || null;
      const observerAxis = window.ObserverHealth?.observerAxisState?.(witnessSet)
        || verdict?.observerAxis
        || AXIS_STATES.UNPROVEN;

      const claimed = (() => {
        if (reason === 'hard_stop') return RESULT_TYPES.CANCELLED;
        if (!completed) {
          return this.criteria.criteria.contentStable?.met
            ? RESULT_TYPES.SUSPECTED_COMPLETE
            : RESULT_TYPES.UNKNOWN;
        }
        return RESULT_TYPES.COMMITTED;
      })();

      return contract.buildRunResult({
        type: claimed,
        guarantee: verdict?.guarantee || contract.GUARANTEE.BLIND,
        terminalReason: transport?.terminalReason || (completed ? null : 'UNKNOWN'),
        axes: {
          // The watcher's identity evidence is that the observed answer is not
          // the pre-run one; anything weaker is not an identity proof.
          identity: this.freshAnswerObserved ? AXIS_STATES.PROVEN : AXIS_STATES.UNPROVEN,
          terminality: verdict?.terminality || AXIS_STATES.UNPROVEN,
          // No cross-channel reconciliation happens in the watcher, so
          // integrity stays honestly unproven here.
          integrity: AXIS_STATES.UNPROVEN,
          semantic: AXIS_STATES.UNPROVEN,
          observer: observerAxis
        },
        strongestEvidenceClass: verdict?.strongestClass || null,
        reasons: [`watcher:${reason}`, ...(verdict?.reasons || [])],
        llmName: this.llmName,
        // The proof names the dispatch it claims to be about; a proof that
        // cannot say which run it belongs to is not a proof of that run.
        dispatchId: this.runDispatchId || null,
        text: ''
      });
    }

    buildResult(reason, confidence, typingActive, recentGrowth, completed = false) {
      // Legacy shape retained for callers, but the watcher is witness-only.
      // Only buildAuthorityResult() may expose CompletionSession's terminal decision.
      completed = false;
      const criteriaSnapshot = this.buildCriteriaSnapshot();
      const runProof = this.buildRunProof(reason, completed);
      this.lastRunProof = runProof;
      return {
        success: completed,
        completed,
        reason,
        confidence,
        runProof: runProof ? runProof.serialize() : null,
        evidence: this.lastLadderVerdict
          ? {
            terminality: this.lastLadderVerdict.terminality,
            strongestClass: this.lastLadderVerdict.strongestClass,
            guarantee: this.lastLadderVerdict.guarantee,
            veto: this.lastLadderVerdict.veto,
            reasons: this.lastLadderVerdict.reasons,
            observerCeiling: this.lastLadderVerdict.observerCeiling,
            transport: this.lastTransportSnapshot
              ? {
                available: this.lastTransportSnapshot.available,
                streamOpen: this.lastTransportSnapshot.streamOpen,
                streamCount: this.lastTransportSnapshot.streamCount,
                bytes: this.lastTransportSnapshot.bytes,
                terminalReason: this.lastTransportSnapshot.terminalReason
              }
              : null
          }
          : null,
        duration: Date.now() - this.startTime,
        indicators: { streaming: typingActive },
        scrollGrowthInLast2s: recentGrowth,
        criteriaMet: this.criteria.metCount(),
        score: this.calculateScore(),
        metrics: {
          scrollHeightHistory: this.scrollHeightHistory.slice(-20),
          timeoutStatus: this.timeoutManager.getStatus(),
          typingActive,
          contentLength: this.latestContentLength,
          criteriaStatus: this.buildCriteriaStatus(criteriaSnapshot),
          criteriaSnapshot,
          completionSelectors: {
            stopButton: this.lastStopSelector || null,
            regenerateButton: this.lastRegenerateSelector || null,
            copyButton: this.lastCopySelector || null
          },
          selectorAttempts: {
            stopButton: this.lastStopSelectorAttempt || null,
            regenerateButton: this.lastRegenerateSelectorAttempt || null,
            copyButton: this.lastCopySelectorAttempt || null
          },
          copyButton: this.lastCopyButtonMeta || null
        }
      };
    }

    buildCriteriaSnapshot() {
      const criteria = this.criteria?.criteria || {};
      const snapshot = {};
      Object.keys(criteria).forEach((key) => {
        const entry = criteria[key] || {};
        snapshot[key] = {
          met: !!entry.met,
          enabled: entry.enabled !== false,
          threshold: entry.threshold ?? null
        };
      });
      snapshot.fingerprintStable = {
        met: !!this.fingerprintStable,
        enabled: true,
        threshold: this.fingerprintStableChecks
      };
      return snapshot;
    }

    buildCriteriaStatus(criteriaSnapshot = null) {
      const snapshot = criteriaSnapshot || this.buildCriteriaSnapshot();
      return Object.keys(snapshot).map((key) => {
        const entry = snapshot[key];
        if (entry?.enabled === false) return `${key}:off`;
        return `${key}:${entry?.met ? '1' : '0'}`;
      }).join(' ');
    }

    maybeLogCriteria({ stopVisible, regenerateVisible, completionSignal, copyButtonVisible, copyButtonStable, stopDisappeared, metCount, criteriaTotal }) {
      if (!this.verboseCriteria) return;
      const status = this.buildCriteriaStatus();
      const score = this.calculateScore();
      const key = `${stopVisible ? 1 : 0}|${regenerateVisible ? 1 : 0}|${completionSignal ? 1 : 0}|${copyButtonVisible ? 1 : 0}|${copyButtonStable ? 1 : 0}|${stopDisappeared ? 1 : 0}|${metCount}|${status}|${score.toFixed(2)}`;
      if (key === this.lastCriteriaLogKey) return;
      this.lastCriteriaLogKey = key;
      const prefix = this.llmName ? `[AnswerWatcher:${this.llmName}]` : '[AnswerWatcher]';
      console.log(`${prefix} stop=${stopVisible ? '1' : '0'} regen=${regenerateVisible ? '1' : '0'} completion=${completionSignal ? '1' : '0'} copy=${copyButtonVisible ? '1' : '0'} copyStable=${copyButtonStable ? '1' : '0'} stopGone=${stopDisappeared ? '1' : '0'} met=${metCount}/${criteriaTotal} score=${score.toFixed(2)} | ${status}`);
    }

    hashString(value = '') {
      let hash = 0;
      const str = String(value || '');
      for (let i = 0; i < str.length; i += 1) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
      }
      return hash.toString(16);
    }

    safeQuery(selector) {
      try {
        const circuit = window.SelectorCircuit;
        if (circuit && !circuit.shouldUse(selector, this.platform, 'query')) return null;
        const node = document.querySelector(selector);
        if (node) circuit?.report(selector, this.platform, 'query', true);
        return node;
      } catch (err) {
        window.SelectorMetrics?.record?.(this.platform, 'query', 'fail');
        if (!this.invalidSelectors.has(selector)) {
          this.invalidSelectors.add(selector);
          console.warn('[AnswerWatcher] Invalid selector', selector, err);
        }
        window.SelectorCircuit?.report(selector, this.platform, 'query', false);
        return null;
      }
    }

    safeQueryAll(selector) {
      try {
        return document.querySelectorAll(selector);
      } catch (err) {
        if (!this.invalidSelectors.has(selector)) {
          this.invalidSelectors.add(selector);
          console.warn('[AnswerWatcher] Invalid selector', selector, err);
        }
        return [];
      }
    }
  }

  namespace.UnifiedAnswerCompletionWatcher = UnifiedAnswerCompletionWatcher;
})();
