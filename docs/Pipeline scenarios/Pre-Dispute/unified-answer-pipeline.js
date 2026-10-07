(function initUnifiedAnswerPipeline() {
  if (window.UnifiedAnswerPipeline) return;

  const Modules = window.UnifiedPipelineModules;
  const Config = window.AnswerPipelineConfig;
  const SelectorBundle = window.AnswerPipelineSelectors;
  const namespace = window.AnswerPipeline || {};
  const WatcherClass = namespace.UnifiedAnswerCompletionWatcher;
  const SanityCheckClass = namespace.SanityCheck;

  if (!Modules || !Config || !SelectorBundle || !WatcherClass || !SanityCheckClass) {
    console.error('[UnifiedAnswerPipeline] Missing dependencies:', {
      Modules: !!Modules,
      Config: !!Config,
      SelectorBundle: !!SelectorBundle,
      WatcherClass: !!WatcherClass,
      SanityCheckClass: !!SanityCheckClass
    });
    return;
  }
  console.log('[UnifiedAnswerPipeline] All dependencies loaded successfully');

  const {
    AdaptiveTimeoutManager,
    coordinationModes,
    selectMode,
    IntelligentRetryManager,
    ContinuousHumanActivity,
    MaintenanceScroll,
    ComprehensiveTelemetry,
    PerplexityStabilization,
    HumanSessionController
  } = Modules;
  const { PLATFORM_SELECTORS, detectPlatform } = SelectorBundle;

  const clone = (obj) => JSON.parse(JSON.stringify(obj || {}));

  const deepMerge = (target, source) => {
    if (!source) return target;
    Object.keys(source).forEach((key) => {
      const value = source[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        target[key] = deepMerge(target[key] || {}, value);
      } else {
        target[key] = value;
      }
    });
    return target;
  };

  const LOCAL_STATE_PREFIX = 'llm_ext_';
  const persistLocalState = (sessionId, payload = {}) => {
    if (!sessionId) return;
    try {
      const key = `${LOCAL_STATE_PREFIX}${sessionId}`;
      const prev = window.localStorage.getItem(key);
      const prevObj = prev ? JSON.parse(prev) : {};
      const merged = Object.assign({}, prevObj, payload, { ts: Date.now() });
      window.localStorage.setItem(key, JSON.stringify(merged));
    } catch (err) {
      console.warn('[Pipeline] persistLocalState failed', err);
    }
  };

  const sendTabState = (payload = {}) => {
    try {
      const platform = payload.platform || (typeof window.__PragmatistAdapter?.adapter?.name === 'string' ? window.__PragmatistAdapter.adapter.name : null);
      const sessionId = payload.sessionId || window.__PragmatistAdapter?.sessionId || null;
      const visibilityState = typeof document !== 'undefined' ? document.visibilityState : null;
      const hasFocus = typeof document !== 'undefined' && typeof document.hasFocus === 'function'
        ? document.hasFocus()
        : null;
      chrome.runtime?.sendMessage?.({
        type: 'STORE_TAB_STATE',
        state: Object.assign({ ts: Date.now(), platform, sessionId, visibilityState, hasFocus }, payload)
      }, () => chrome.runtime?.lastError);
    } catch (_) {}
  };

  // Purpose: emit pipeline phase telemetry to background diagnostics.
  const LLM_NAME_ALIASES = {
    chatgpt: 'GPT',
    gpt: 'GPT',
    gemini: 'Gemini',
    claude: 'Claude',
    grok: 'Grok',
    lechat: 'Le Chat',
    mistral: 'Le Chat',
    qwen: 'Qwen',
    deepseek: 'DeepSeek',
    perplexity: 'Perplexity',
    'z.ai': 'Z.ai',
    zai: 'Z.ai',
    kimi: 'Kimi',
    moonshot: 'Kimi'
  };

  const resolveLlmName = (value) => {
    if (!value) return null;
    const raw = String(value).trim();
    const normalized = raw.toLowerCase();
    return LLM_NAME_ALIASES[normalized] || raw;
  };

  // v2.54.24 (2025-12-22 23:14 UTC): PIPELINE_EVENT wiring (Purpose: unify pipeline telemetry routing).
  const sendDiagnosticsEvent = (llmName, payload = {}) => {
    if (!llmName) return;
    const safeSend = window.ContentUtils?.safeRuntimeSendMessage;
    const message = { type: 'PIPELINE_EVENT', llmName, event: payload };
    if (safeSend) {
      safeSend(message);
      return;
    }
    if (!chrome?.runtime?.sendMessage) return;
    try {
      chrome.runtime.sendMessage(message, () => chrome.runtime?.lastError);
    } catch (_) {}
  };

  const answerNodeIds = new WeakMap();
  let nextAnswerNodeId = 1;
  const answerNodeKey = (node) => {
    if (!node || (typeof node !== 'object' && typeof node !== 'function')) return null;
    if (!answerNodeIds.has(node)) answerNodeIds.set(node, `answer-node-${nextAnswerNodeId++}`);
    return answerNodeIds.get(node);
  };

  class UnifiedAnswerPipeline {
    constructor(platform, overrides = {}) {
      const normalizedPlatform = typeof platform === 'string' ? platform.toLowerCase() : platform;
      this.platform = normalizedPlatform || detectPlatform?.() || 'generic';
      this.configOverrides = clone(overrides);
      const baseConfig = clone(Config);
      this.config = deepMerge(baseConfig, clone(this.configOverrides));
      if (window.__PRAGMATIST_SPEED_MODE) {
        this.config.streaming = this.config.streaming || {};
        this.config.streaming.continuousActivity = Object.assign({}, this.config.streaming.continuousActivity, { enabled: false });
        this.config.streaming.initialScrollKick = Object.assign({}, this.config.streaming.initialScrollKick, { enabled: false });
      }
      const platformSelectors = PLATFORM_SELECTORS[this.platform];
      this.selectors = platformSelectors || PLATFORM_SELECTORS.generic || {};
      this.platformSelectorsMissing = !platformSelectors || !Object.keys(platformSelectors || {}).length;

      // F6: anchor to the assistant text already on the page before this run produces
      // an answer. On a conversation page (prompt sent into existing history) the
      // last-assistant selector resolves to the *previous* answer until the new one
      // renders; capturing it here lets finalization reject that stale answer for all
      // adapters instead of each adapter reinventing the guard. An explicit
      // `baselineText` override wins; otherwise we read the current last-assistant node.
      this.baselineAnswerSignature = '';
      try {
        if (typeof overrides.baselineText === 'string') {
          this.baselineAnswerSignature = this.normalizeAnswerSignature(overrides.baselineText);
        } else {
          const baselineEl = this.getAnswerElement();
          if (baselineEl) this.baselineAnswerSignature = this.normalizeAnswerSignature(this.extractText(baselineEl));
        }
      } catch (_) {
        this.baselineAnswerSignature = '';
      }

      // F6.2: positional turn anchor — how many answer candidates the page
      // already holds at dispatch time. Everything at or before this index is a
      // previous conversation turn; extraction may only prefer nodes appended
      // after it (see getAnswerElement). Exposed on window so the dispatch
      // baseline report can carry it to the background for the inline scans.
      this.anchorAnswerCount = 0;
      const pipelineLlmName = resolveLlmName(this.config?.llmName || this.platform || window.__PragmatistAdapter?.adapter?.name);
      const preDispatchAnchor = window.__LLMPreDispatchTurnAnchor;
      const canonicalAnchorUsable = preDispatchAnchor
        && preDispatchAnchor.llmName === pipelineLlmName
        && preDispatchAnchor.anchorAnswerCount !== null
        && preDispatchAnchor.anchorAnswerCount !== undefined
        && Number.isFinite(Number(preDispatchAnchor.anchorAnswerCount))
        && Date.now() - Number(preDispatchAnchor.capturedAt || 0) < 120000;
      if (canonicalAnchorUsable) {
        this.anchorAnswerCount = Math.max(0, Number(preDispatchAnchor.anchorAnswerCount));
      } else {
        try {
          this.anchorAnswerCount = this.collectSortedAnswerCandidates().sorted.length;
        } catch (_) {
          this.anchorAnswerCount = 0;
        }
      }
      try {
        window.__UnifiedPipelineTurnAnchor = {
          platform: this.platform,
          anchorAnswerCount: this.anchorAnswerCount,
          capturedAt: Date.now()
        };
      } catch (_) {}

      this.adaptiveTimeout = new AdaptiveTimeoutManager(this.config.streaming?.adaptiveTimeout);
      this.retryManager = new IntelligentRetryManager(this.config.streaming?.intelligentRetry);
      this.humanActivity = new ContinuousHumanActivity(this.config.streaming?.continuousActivity);
      this.tabProtector = Modules.TabProtector ? new Modules.TabProtector() : null;
      this._initHumanSession();
      this.maintenanceScroll = new MaintenanceScroll(this.config.streaming?.maintenanceScroll, this.humanSession);
      this.sanityCheck = new SanityCheckClass(this.config.finalization?.sanityCheck);
      this.telemetry = new ComprehensiveTelemetry();
      this.perplexityHelper = /perplexity/i.test(this.platform || '') ? new PerplexityStabilization() : null;
      this.answerWatcherClass = WatcherClass;
      this.sessionId = window.__PragmatistAdapter?.sessionId || this.telemetry?.traceId || `session-${Date.now()}`;
      this.llmName = resolveLlmName(this.config?.llmName || this.platform || window.__PragmatistAdapter?.adapter?.name);
      this.fsmState = 'INIT';
      this.state = {
        phase: 'idle',
        startTime: 0,
        phaseTimings: {},
        preparationResult: null,
        scrollResult: null,
        answerResult: null,
        finalizationResult: null,
        container: null,
        maintenanceResult: null,
        initialScrollKick: null
      };
      this._recoverLocalState();

      this.scrollToolkit = window.__UniversalScrollToolkit || null;
      this.lifecycle = window.HumanoidEvents || null;
      this.lifecycleTraceId = null;
      this.hardStopTriggered = false;
      this.effectiveTimingSnapshot = null;
    }

    async lockEffectiveTimingConfig() {
      const readiness = await (window.AnswerPipelineTiming?.whenProfileReady?.()
        || Promise.resolve(window.AnswerPipelineTiming?.getEffectiveSnapshot?.() || null));
      this.config = deepMerge(clone(Config), clone(this.configOverrides));
      if (window.__PRAGMATIST_SPEED_MODE) {
        this.config.streaming = this.config.streaming || {};
        this.config.streaming.continuousActivity = Object.assign({}, this.config.streaming.continuousActivity, { enabled: false });
        this.config.streaming.initialScrollKick = Object.assign({}, this.config.streaming.initialScrollKick, { enabled: false });
      }
      this.adaptiveTimeout = new AdaptiveTimeoutManager(this.config.streaming?.adaptiveTimeout);
      this.retryManager = new IntelligentRetryManager(this.config.streaming?.intelligentRetry);
      this.humanActivity = new ContinuousHumanActivity(this.config.streaming?.continuousActivity);
      this._initHumanSession();
      this.maintenanceScroll = new MaintenanceScroll(this.config.streaming?.maintenanceScroll, this.humanSession);
      this.sanityCheck = new SanityCheckClass(this.config.finalization?.sanityCheck);
      const criteria = this.config.streaming?.completionCriteria || {};
      this.effectiveTimingSnapshot = {
        profile: readiness?.profile || window.AnswerPipelineTiming?.getTimingProfile?.() || 'standard',
        profileLoaded: readiness?.profileLoaded === true,
        stabilityChecks: Number(this.config.finalization?.stabilityChecks || 0),
        stabilityRetryBudget: Number(this.config.finalization?.stabilityRetryBudget || 0),
        stabilityInterval: Number(this.config.finalization?.stabilityInterval || 0),
        mutationIdle: Number(criteria.mutationIdle || 0),
        contentStable: Number(criteria.contentStable || 0),
        contentStableChecks: Number(criteria.contentStableChecks || 0),
        streamingHardMax: Number(this.config.streaming?.adaptiveTimeout?.hardMax || 0)
      };
      this.emitPipelineTelemetry('PIPELINE_EFFECTIVE_CONFIG', { meta: this.effectiveTimingSnapshot });
      return this.effectiveTimingSnapshot;
    }

    emitPipelineTelemetry(event, { details = '', meta = {}, level = 'info' } = {}) {
      if (!event) return;
      const llmName = this.llmName || resolveLlmName(this.config?.llmName || this.platform || window.__PragmatistAdapter?.adapter?.name);
      if (!llmName) return;
      sendDiagnosticsEvent(llmName, {
        ts: Date.now(),
        type: 'PIPELINE',
        label: event,
        details: details || '',
        level,
        meta: Object.assign({
          event,
          platform: this.platform,
          llmName,
          pipelineSessionId: this.sessionId
        }, meta || {})
      });
    }

    emitPipelineStep(step, { details = '', meta = {}, level = 'info' } = {}) {
      if (!step) return;
      const visibilityState = typeof document !== 'undefined' ? document.visibilityState : null;
      const hasFocus = typeof document !== 'undefined' && typeof document.hasFocus === 'function'
        ? document.hasFocus()
        : null;
      this.emitPipelineTelemetry('PIPELINE_STEP', {
        details,
        level,
        meta: Object.assign({ step, visibilityState, hasFocus }, meta || {})
      });
    }

    transitionState(nextState, meta = {}) {
      if (!nextState || this.fsmState === nextState) return;
      const prev = this.fsmState;
      this.fsmState = nextState;
      this.emitPipelineTelemetry('STATE_CHANGE', {
        meta: Object.assign({ from: prev, to: nextState }, meta || {})
      });
    }

    _recoverLocalState() {
      try {
        const keys = Object.keys(window.localStorage || {}).filter((k) => k.startsWith(LOCAL_STATE_PREFIX));
        if (!keys.length) return;
        const lastKey = keys.sort().slice(-1)[0];
        const cached = window.localStorage.getItem(lastKey);
        if (cached) {
          this.state.recoveredCache = JSON.parse(cached);
          this.telemetry.logPhase('cache_recovered', { key: lastKey });
        }
      } catch (err) {
        console.warn('[Pipeline] recoverLocalState failed', err);
      }
    }

    _initHumanSession() {
      const self = this;
      const cfg = Object.assign({
        onHardStop() {
          self.streamingTimedOut = true;
          self.hardStopTriggered = true;
        }
      }, this.config.streaming?.humanSession || {});
      this.humanSession = new HumanSessionController({
        continuousActivity: this.humanActivity,
        getHumanoid: () => window.Humanoid || null
      }, cfg);
      try {
        window.humanSessionController = this.humanSession;
      } catch (_) {}
    }

    async execute() {
      console.log(`[UnifiedAnswerPipeline] Execute called for platform: ${this.platform}`);
      
      if (this.platformSelectorsMissing) {
        const error = 'selectors_not_supported';
        console.error(`[UnifiedAnswerPipeline] FATAL: Platform selectors missing for ${this.platform}`);
        this.telemetry.logPhase('selectors_missing', { platform: this.platform, error });
        persistLocalState(this.sessionId, { platform: this.platform, status: 'error', phase: 'preparation', error });
        sendTabState({ status: 'error', phase: 'preparation', error, platform: this.platform, sessionId: this.sessionId });
        return this.handleError('preparation', error);
      }

      await this.lockEffectiveTimingConfig();
      
      console.log(`[UnifiedAnswerPipeline] Starting pipeline execution for ${this.platform}`);
      this.transitionState('DISPATCHING', { phase: 'preparation' });
      this.emitPipelineStep('pipeline_start', { meta: { phase: 'preparation' } });

      this.state.phase = 'preparation';
      this.state.startTime = Date.now();
      this.telemetry.logPhase('pipeline_start', { platform: this.platform });
      this._lifecycleHeartbeat('pipeline_start', 0.05);
      persistLocalState(this.sessionId, { platform: this.platform, status: 'pipeline_start' });
      sendTabState({ status: 'pipeline_start', platform: this.platform, sessionId: this.sessionId });

      const lifecycle = this.lifecycle;
      if (lifecycle && !this.lifecycleTraceId) {
        this.lifecycleTraceId = lifecycle.start('pipeline', {
          platform: this.platform,
          mode: this.config.streaming?.coordinationMode
        });
      }

      let lifecycleStatus = 'error';
      let lifecycleHeartbeatInterval = null;
      if (this.lifecycleTraceId && lifecycle) {
        lifecycleHeartbeatInterval = setInterval(() => {
          lifecycle.heartbeat(this.lifecycleTraceId, null, { phase: this.state.phase });
        }, 7000);
      }

      try {
        const preparation = await this.runPreparationPhase();
        if (!preparation.success) {
          this._reportLifecycleError('preparation', preparation.error);
          persistLocalState(this.sessionId, { status: 'error', phase: 'preparation', error: preparation.error });
          sendTabState({ status: 'error', phase: 'preparation', error: preparation.error, sessionId: this.sessionId });
          return this.handleError('preparation', preparation.error);
        }
        this._lifecycleHeartbeat('preparation', 0.3);
        persistLocalState(this.sessionId, { status: 'streaming_start', phase: 'preparation_done' });
        sendTabState({ status: 'streaming_start', sessionId: this.sessionId });

        if (this.tabProtector) {
          const audioResult = this.tabProtector.start();
          if (audioResult?.ok) {
            this.emitPipelineTelemetry('AUDIO_CONTEXT_OK', {
              meta: { reason: audioResult?.reason || null }
            });
          } else {
            this.emitPipelineTelemetry('AUDIO_CONTEXT_FAIL', {
              level: 'warning',
              meta: { reason: audioResult?.reason || 'unknown' }
            });
          }
        }
        const streaming = await this.runStreamingPhase(preparation);
        if (!streaming.success) {
          this._reportLifecycleError('streaming', streaming.error);
          persistLocalState(this.sessionId, { status: 'error', phase: 'streaming', error: streaming.error });
          sendTabState({ status: 'error', phase: 'streaming', error: streaming.error, sessionId: this.sessionId });
          return this.handleError('streaming', streaming.error);
        }
        this._lifecycleHeartbeat('streaming', 0.7);

        const finalization = await this.runFinalizationPhase(streaming);
        if (!finalization.success) {
          this._reportLifecycleError('finalization', finalization.error);
          persistLocalState(this.sessionId, { status: 'error', phase: 'finalization', error: finalization.error });
          sendTabState({ status: 'error', phase: 'finalization', error: finalization.error, sessionId: this.sessionId });
          return this.handleError('finalization', finalization.error);
        }

        this.state.phase = 'complete';
        const report = this.telemetry.generateReport();
        this._lifecycleHeartbeat('finalization', 1);
        lifecycleStatus = 'success';
        this.transitionState('COLLECTING', { phase: 'finalization' });
        this.emitPipelineTelemetry('PIPELINE_COMPLETE', {
          level: 'success',
          meta: {
            duration: report.totalDuration,
            completionReason: report.completionReason,
            answerLength: finalization.answer?.length || 0,
            // Carried into telemetry so the calibration can ask how often a
            // green result was actually proven, not merely returned.
            resultType: finalization.runResult?.type || null,
            resultGuarantee: finalization.runResult?.guarantee || null,
            evidenceClass: finalization.runResult?.strongestEvidenceClass || null,
            terminalReason: finalization.runResult?.terminalReason || null
          }
        });
        this.transitionState('DONE', { phase: 'complete' });
        persistLocalState(this.sessionId, {
          status: 'complete',
          duration: report.totalDuration,
          answerLength: finalization.answer?.length || 0,
          completionReason: finalization.sanityCheck?.overallConfidence ? 'success' : report.completionReason
        });
        sendTabState({
          status: 'complete',
          duration: report.totalDuration,
          answerLength: finalization.answer?.length || 0,
          sessionId: this.sessionId,
          platform: this.platform
        });

        return {
          success: true,
          answer: finalization.answer,
          answerHtml: finalization.answerHtml,
          metadata: {
            traceId: report.traceId,
            platform: this.platform,
            duration: report.totalDuration,
            phases: report.phases,
            completionReason: report.completionReason,
            confidence: finalization.sanityCheck?.overallConfidence ?? report.confidence,
            preparation: this.state.preparationResult,
            scroll: this.state.scrollResult,
            answer: this.state.answerResult,
            maintenance: this.state.maintenanceResult,
            finalization: finalization,
            sanityCheck: finalization.sanityCheck,
            answerHtml: finalization.answerHtml,
            runResult: finalization.runResult || null
          }
        };
      } catch (error) {
        if (this.lifecycleTraceId && lifecycle) {
          lifecycle.error(this.lifecycleTraceId, error, true);
        }
        persistLocalState(this.sessionId, { status: 'error', phase: 'unexpected', error: error?.message || String(error) });
        sendTabState({ status: 'error', phase: 'unexpected', error: error?.message || String(error), sessionId: this.sessionId });
        return this.handleError('unexpected', error);
      } finally {
        if (this.tabProtector) {
          this.tabProtector.stop();
        }
        if (lifecycleHeartbeatInterval) {
          clearInterval(lifecycleHeartbeatInterval);
        }
        if (this.lifecycleTraceId && lifecycle) {
          lifecycle.stop(this.lifecycleTraceId, {
            status: lifecycleStatus,
            phase: this.state.phase
          });
          this.lifecycleTraceId = null;
        }
        this.humanSession.stopSession('pipeline-exit');
      }
    }

    async runPreparationPhase() {
      const phaseStart = Date.now();
      this.emitPipelineStep('preparation_start', { meta: { phase: 'preparation' } });
      this.telemetry.logPhase('preparation_start');
      const tabActive = await this.activateTab();
      if (!tabActive) {
        return { success: false, error: 'tab_activation_failed' };
      }
      this.telemetry.logPhase('tab_activated');

      const streamOk = await this.waitForStreamStart();
      if (!streamOk) {
        return { success: false, error: 'stream_start_timeout' };
      }

      const containerInfo = this.detectContainer();
      if (!containerInfo) {
        return { success: false, error: 'container_not_found' };
      }

      this.state.container = containerInfo;
      const duration = Date.now() - phaseStart;
      this.state.phaseTimings.preparation = duration;
      this.state.preparationResult = { success: true, duration, containerInfo };
      this.telemetry.logPhase('preparation_done', { duration });
      this.emitPipelineStep('preparation_done', { meta: { duration } });
      return this.state.preparationResult;
    }

    waitForStreamStart() {
      const selectors = this.selectors.streamStart?.length
        ? this.selectors.streamStart
        : this.getDefaultStreamStartSelectors();
      const platformPrep = this.config.platforms?.[this.platform]?.preparation || {};
      const timeout = platformPrep.streamStartTimeout || this.config.preparation?.streamStartTimeout || 45000;
      return new Promise((resolve) => {
        const hasFreshStart = () => {
          const candidates = this.collectSortedAnswerCandidates().sorted;
          if (candidates.length > Number(this.anchorAnswerCount || 0)) return true;
          const latest = candidates[candidates.length - 1] || null;
          const latestSignature = latest ? this.normalizeAnswerSignature(this.extractText(latest)) : '';
          if (latestSignature && latestSignature !== this.baselineAnswerSignature) return true;
          return window.GenerationSignal?.inspect?.({
            selectors: this.selectors,
            queryAll: (selector) => this.querySelectorAllSafe(selector)
          }).active === true;
        };
        if (hasFreshStart()) {
          resolve(true);
          return;
        }

        const timer = setTimeout(() => {
          stopObserve();
          resolve(false);
        }, timeout);

        const stopObserve = window.ContentUtils?.observeMutations
          ? window.ContentUtils.observeMutations(document.body, { childList: true, subtree: true }, () => {
            if (hasFreshStart()) {
              clearTimeout(timer);
              stopObserve();
              resolve(true);
            }
          })
          : (() => () => {})();
      });
    }

    async activateTab() {
      if (this.config?.preparation?.allowTabActivation === false) return true;
      if (!document.hidden) return true;
      const timeoutMs = this.config.preparation?.tabActivationTimeout || 5000;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          document.removeEventListener('visibilitychange', handler);
          resolve(false);
        }, timeoutMs);

        const handler = () => {
          if (!document.hidden) {
            clearTimeout(timer);
            document.removeEventListener('visibilitychange', handler);
            resolve(true);
          }
        };

        document.addEventListener('visibilitychange', handler);

        try {
          chrome?.tabs?.getCurrent?.((tab) => {
            if (tab?.id) chrome.tabs.update(tab.id, { active: true });
          });
        } catch (_) {
          // ignore
        }
      });
    }

    detectContainer() {
      try {
        if (this.scrollToolkit) {
          const toolkit = new this.scrollToolkit();
          const candidates = toolkit.containerDetector?.findScrollable() || [];
          return candidates[0] || { element: window, type: 'window' };
        }
      } catch (err) {
        console.warn('[Pipeline] ScrollToolkit container detection failed', err);
      }
      const container = this.querySelectorSafe(this.selectors.answerContainer) || document.documentElement;
      return { element: container, type: container === window ? 'window' : 'container' };
    }

    async runStreamingPhase(prepResult) {
      const phaseStart = Date.now();
      this.state.phase = 'streaming';
      this.transitionState('GENERATING', { phase: 'streaming' });
      const expectedLength = this.config.streaming?.expectedLength || this.config.expectedLength || 'medium';
      const modeName = this.config.streaming?.coordinationMode || 'balanced';
      const configuredMode = coordinationModes[modeName] || selectMode({ expectedLength });
      this.telemetry.logPhase('streaming_start', { mode: modeName });
      this.emitPipelineStep('streaming_start', {
        meta: { mode: modeName }
      });

      this.humanSession.startSession();
      this.streamingTimedOut = false;
      //-- 1.1. Адаптивный timeout: учитываем скорость модели --//
const baseTimeouts = this.adaptiveTimeout.calculateTimeout(this.config.seedContent || '', { expectedLength });
const timeouts = {
  soft: baseTimeouts.soft,
  hard: baseTimeouts.hard
};
console.log(`[Pipeline] Timeouts for ${this.platform}: soft=${timeouts.soft}ms, hard=${timeouts.hard}ms`);
let watchdog = null;
const hardTimeoutPromise = new Promise((_, reject) => {
  watchdog = setTimeout(() => {
    this.streamingTimedOut = true;
    reject(new Error('hard_timeout'));
  }, timeouts.hard);
});

      this.humanActivity.startDuringWait();
      let guardInterval = null;
      let textStabilityMonitor = null;
      const clearGuardInterval = () => {
        if (guardInterval) {
          clearInterval(guardInterval);
          guardInterval = null;
        }
      };

      try {
        await this.runInitialScrollKick(prepResult);
        const scrollPromise = this.runScrollSettlement(prepResult);
        const answerPromise = this.runAnswerCompletion(prepResult.containerInfo);

        //-- 2.1. Fallback: завершение по отсутствию изменений текста --//
textStabilityMonitor = setInterval(() => {
  if (this.streamingTimedOut || this.hardStopTriggered) {
    clearInterval(textStabilityMonitor);
    return;
  }
  
  const currentAnswer = this.getAnswerElement();
  if (!currentAnswer) return;
  
  const currentText = this.extractText(currentAnswer);
  const currentLength = currentText.length;
  
  if (!this._lastAnswerLength) {
    this._lastAnswerLength = currentLength;
    this._lastAnswerChangeAt = Date.now();
    return;
  }
  
  // Text stability is weak evidence only; final completion is decided by the watcher/finalization phases.
  if (currentLength === this._lastAnswerLength) {
    const stableMs = Date.now() - this._lastAnswerChangeAt;
    if (stableMs >= 2000 && currentLength > 100) {
      console.log(`[Pipeline] Text stable evidence for ${stableMs}ms, length=${currentLength}`);
      clearInterval(textStabilityMonitor);
      window.dispatchEvent(new CustomEvent('LLM_ANSWER_STABLE', { 
        detail: { platform: this.platform, length: currentLength, stableMs, evidenceOnly: true } 
      }));
    }
  } else {
    this._lastAnswerLength = currentLength;
    this._lastAnswerChangeAt = Date.now();
  }
}, 500);

// Очистка при завершении streaming
this.humanSession.on?.('session-stop', () => clearInterval(textStabilityMonitor));

        let scrollResult;
        let answerResult;

          if (configuredMode.waitFor === 'both') {
            [scrollResult, answerResult] = await Promise.race([
              Promise.all([scrollPromise, answerPromise]),
              hardTimeoutPromise
            ]);
          } else {
            const first = await Promise.race([
              scrollPromise.then((res) => {
                clearGuardInterval();
                return { type: 'scroll', res };
              }),
              answerPromise.then((res) => {
                clearGuardInterval();
                return { type: 'answer', res };
              }),
              hardTimeoutPromise,
              new Promise((_, reject) => {
                guardInterval = setInterval(() => {
                  if (this.hardStopTriggered) {
                    clearGuardInterval();
                    reject(new Error('hard_stop'));
                  }
                }, 300);
              })
            ]);
          if (first?.type === 'scroll') {
            scrollResult = first.res;
            answerResult = await answerPromise;
          } else if (first?.type === 'answer') {
            answerResult = first.res;
            scrollResult = await scrollPromise;
          }
        }

        clearTimeout(watchdog);
        clearGuardInterval();
        clearInterval(textStabilityMonitor);
        this.humanActivity.stop();

        if (this.streamingTimedOut) {
          return { success: false, error: 'hard_timeout' };
        }

        this.state.scrollResult = scrollResult;
        this.state.answerResult = answerResult;

        const v2Accepted = answerResult?.success && answerResult?.terminalResult?.status === 'SUCCESS_TERMINAL';
        const legacyRolloutAccepted = answerResult?.success
          && ['legacy', 'shadow'].includes(answerResult?.rolloutMode)
          && answerResult?.legacyDecision?.accepted === true;
        if (!v2Accepted && !legacyRolloutAccepted) {
          return { success: false, error: answerResult?.terminalResult?.reason || answerResult?.reason || 'streaming_incomplete' };
        }

        const duration = Date.now() - phaseStart;
        this.state.phaseTimings.streaming = duration;
        this.telemetry.logPhase('streaming_done', { duration });
        this.emitPipelineStep('streaming_done', { meta: { duration } });
        return { success: true, duration };
      } catch (error) {
        clearTimeout(watchdog);
        clearGuardInterval();
        clearInterval(textStabilityMonitor);
        this.humanActivity.stop();
        this.humanSession.stopSession('streaming-error');
        return { success: false, error: error.message || 'streaming_failed' };
      }
    }

    async runInitialScrollKick(prepResult) {
      if (this.humanSession?.isHardStopped?.() || window.__LLMScrollHardStop) {
        this.telemetry.logPhase('scroll_kick_skip', { reason: 'hard_stop' });
        return { ran: false, reason: 'hard_stop' };
      }
      if (!this.config.streaming?.initialScrollKick?.enabled) {
        return { ran: false, reason: 'disabled' };
      }
      if (!prepResult || !prepResult.containerInfo) {
        return { ran: false, reason: 'no_container' };
      }
      const delay = Number(this.config.streaming.initialScrollKick.delay) || 0;
      if (delay > 0) {
        await this.sleep(delay);
      }
      const target = prepResult.containerInfo.element || window;
      try {
        if (this.scrollToolkit) {
          const tk = new this.scrollToolkit({ logLevel: 'error' });
          await tk.scrollToBottom({ targetNode: target });
          this.state.initialScrollKick = { ran: true, tool: 'scrollToolkit' };
          this.telemetry.logPhase('scroll_kick', { tool: 'scrollToolkit' });
          return this.state.initialScrollKick;
        }
        const humanoid = window.Humanoid;
        if (humanoid?.humanScroll) {
          const el = target === window ? document.documentElement : target;
          const start = target === window ? window.scrollY : (target.scrollTop || 0);
          const height = el?.scrollHeight || document.documentElement.scrollHeight || 0;
          const view = el?.clientHeight || window.innerHeight || 0;
          const distance = Math.max(0, height - view - start);
          await humanoid.humanScroll(distance || 800, { targetNode: target, style: 'reading' });
          this.state.initialScrollKick = { ran: true, tool: 'humanoid' };
          this.telemetry.logPhase('scroll_kick', { tool: 'humanoid', distance });
          return this.state.initialScrollKick;
        }
        const el = target === window ? document.documentElement : target;
        if (el?.scrollTo) {
          el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
          this.state.initialScrollKick = { ran: true, tool: 'native' };
          this.telemetry.logPhase('scroll_kick', { tool: 'native' });
          return this.state.initialScrollKick;
        }
      } catch (err) {
        this.telemetry.logPhase('scroll_kick_error', { message: err.message });
        this.state.initialScrollKick = { ran: false, reason: err.message };
        return this.state.initialScrollKick;
      }
      this.state.initialScrollKick = { ran: false, reason: 'no_tool' };
      return this.state.initialScrollKick;
    }

    async runScrollSettlement(prepResult) {
      if (this.humanSession?.isHardStopped?.() || window.__LLMScrollHardStop) {
        this.telemetry.logPhase('scroll_settlement_skip', { reason: 'hard_stop' });
        return { success: false, reason: 'hard_stop' };
      }
      const { containerInfo } = prepResult;
      const target = containerInfo?.element ? containerInfo : { element: window, type: 'window' };
      const useRetry = this.config.streaming?.intelligentRetry?.enabled && this.scrollToolkit;

      if (!useRetry) {
        return this.performScrollAttempt(target);
      }

      let lastScrollHeight = this.getScrollHeight(target);
      for (let attempt = 1; attempt <= (this.retryManager.maxRetries || 5); attempt += 1) {
        const context = {
          lastScrollHeight,
          currentScrollHeight: this.getScrollHeight(target)
        };
        lastScrollHeight = context.currentScrollHeight;
        const attemptResult = await this.retryManager.retryWithBackoff(
          attempt,
          () => this.performScrollAttempt(target),
          context
        );

        this.telemetry.logPhase('streaming_scroll_attempt', {
          attempt,
          success: attemptResult?.success,
          growth: context.currentScrollHeight - context.lastScrollHeight
        });

        if (attemptResult?.success) {
          return Object.assign({ success: true, attempts: attempt }, attemptResult);
        }
      }
      return { success: false, reason: 'scroll_settlement_failed' };
    }

    async performScrollAttempt(target) {
      if (this.humanSession?.isHardStopped?.() || window.__LLMScrollHardStop) {
        this.telemetry.logPhase('scroll_attempt_skip', { reason: 'hard_stop' });
        return { success: false, reason: 'hard_stop' };
      }
      if (this.scrollToolkit) {
        const toolkit = new this.scrollToolkit({ logLevel: 'error' });
        const settled = await toolkit.scrollToBottom({ targetNode: target.element });
        return { success: settled, settled };
      }
      const el = target.element === window ? document.documentElement : target.element;
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      return { success: true, reason: 'fallback' };
    }

    getScrollHeight(target) {
      const el = target?.element === window ? document.documentElement : target?.element;
      return el?.scrollHeight || document.documentElement.scrollHeight || 0;
    }

    async runAnswerCompletion(containerInfo) {
      if (!this.answerWatcherClass) {
        return { success: false, reason: 'watcher_missing' };
      }
      const watcher = new this.answerWatcherClass(this.platform, {
        completionCriteria: this.config.streaming?.completionCriteria,
        adaptiveTimeout: this.config.streaming?.adaptiveTimeout,
        humanSession: this.humanSession,
        llmName: this.llmName,
        expectedLength: this.config.streaming?.expectedLength || this.config.expectedLength || 'medium',
        verboseCriteria: this.config.streaming?.verboseCriteria === true ? true : undefined,
        baselineAnswerSignature: this.baselineAnswerSignature,
        anchorAnswerCount: this.anchorAnswerCount
        , answerSelectors: this.config.answerSelectors
      });
      const dispatchIdentity = window.ContentUtils?.ensureDispatchMeta?.({}, this.llmName) || {};
      const result = await watcher.waitForCompletion({
        container: containerInfo,
        // Scopes the transport evidence to this dispatch: without it the
        // observer can only say "some stream started after this run began".
        dispatchId: this.runIdentity?.dispatchId
          || this.config.dispatchId
          || dispatchIdentity.dispatchId
          || null
      });
      // v2.54.24 (2025-12-22 23:14 UTC): Stop-disappeared signal (Purpose: detect completion when stop hides).
      if (result?.reason === 'stop_disappeared') {
        this.emitPipelineTelemetry('STOP_DISAPPEARED', {
          meta: { duration: result.duration, criteriaMet: result.criteriaMet, confidence: result.confidence }
        });
      }
      return result;
    }

    async runFinalizationPhase() {
      const phaseStart = Date.now();
      this.state.phase = 'finalization';
      this.transitionState('FINALIZING', { phase: 'finalization' });
      this.telemetry.logPhase('finalization_start');
      this.emitPipelineStep('finalization_start', { meta: { phase: 'finalization' } });

      const authoritySnapshot = this.state.answerResult?.extractionSnapshot || null;
      if (authoritySnapshot) this.lastAnswerVerification = authoritySnapshot.answerVerification || null;
      const maintenanceResult = authoritySnapshot
        ? { ran: false, reason: 'immutable_extraction_already_captured' }
        : await this.runMaintenanceScroll(this.state.container);
      this.state.maintenanceResult = maintenanceResult;

      const stable = authoritySnapshot ? true : await this.runFinalStabilityChecks();
      if (!stable) {
        this.telemetry.logPhase('finalization_unstable_answer', { platform: this.platform });
        return { success: false, error: 'answer_not_stable' };
      }
      let answer = authoritySnapshot?.text;
      let answerHtml = authoritySnapshot?.html || '';
      if (!authoritySnapshot) {
        try {
          const extracted = await this.extractAnswerWithHtml();
          answer = extracted.text;
          answerHtml = extracted.html;
        } catch (err) {
          const message = err?.message || String(err) || 'answer_extract_failed';
          this.telemetry.logPhase('finalization_extract_failed', { message });
          return { success: false, error: message };
        }
      }

      if (!String(answer || '').trim()) {
        this.telemetry.logPhase('finalization_empty_answer', { platform: this.platform });
        return { success: false, error: 'empty_answer' };
      }
      const providerErrorSurface = authoritySnapshot ? null : window.ContentUtils?.detectProviderErrorSurface?.();
      if (providerErrorSurface?.detected) {
        this.telemetry.logPhase('finalization_provider_error_surface', {
          platform: this.platform,
          selector: providerErrorSurface.selector || null,
          length: String(providerErrorSurface.text || '').length
        });
        return { success: false, error: 'provider_error_surface' };
      }
      if (this.isStaleBaselineAnswer(answer)) {
        // Only the pre-run (previous) answer is on the page; fail so the adapter
        // keeps waiting / falls back instead of returning the stale answer.
        this.telemetry.logPhase('finalization_stale_baseline', { platform: this.platform, length: answer.length });
        return { success: false, error: 'stale_baseline_answer' };
      }
      // Reject finals that are not actually answers (provider-error / UI-noise surfaces
      // that pass the length bar). No prompt here, so prompt-echo is left to the
      // adapter/background guards. Conservative: only fail on clearly non-eligible
      // classes, and only when the classifier module is present.
      const classifier = (typeof window !== 'undefined' && window.AnswerContentClassifier)
        || (typeof globalThis !== 'undefined' && globalThis.AnswerContentClassifier)
        || null;
      if (classifier) {
        const classification = classifier.classify(answer, { minValid: 20 });
        if (!classification.terminalEligible) {
          this.telemetry.logPhase('finalization_non_answer_content', {
            platform: this.platform,
            contentClass: classification.contentClass,
            length: answer.length
          });
          return { success: false, error: `non_answer_content:${classification.contentClass}` };
        }
      }
      const sanityCheck = await this.sanityCheck.execute({
        answer,
        scrollResult: this.state.scrollResult,
        answerResult: this.state.answerResult,
        platform: this.platform,
        llmName: this.config.llmName || this.platform
      });

      const duration = Date.now() - phaseStart;
      this.state.phaseTimings.finalization = duration;
      const selectorTier = this.lastAnswerSelectorTier || 'unknown';
      const runResult = this.buildFinalRunResult(answer);
      this.state.finalizationResult = {
        success: true, duration, answer, answerHtml, sanityCheck, stable,
        selectorTier, selectorUsed: this.lastAnswerSelector || null,
        answerVerification: this.lastAnswerVerification || null,
        terminalResult: this.state.answerResult?.terminalResult || null,
        extractionSnapshot: authoritySnapshot,
        completionRolloutMode: this.state.answerResult?.rolloutMode || 'enforced',
        legacyCompletionDecision: this.state.answerResult?.legacyDecision || null,
        metadata: {
          completionTerminalResult: this.state.answerResult?.terminalResult || null,
          extractionSnapshot: authoritySnapshot,
          completionRolloutMode: this.state.answerResult?.rolloutMode || 'enforced',
          legacyCompletionDecision: this.state.answerResult?.legacyDecision || null,
          answerVerification: this.lastAnswerVerification || null
        },
        runResult: runResult ? runResult.serialize() : null
      };
      this.telemetry.logPhase('finalization_done', { duration, sanityCheck, selectorTier });
      this.emitPipelineStep('finalization_done', {
        meta: { duration, answerLength: answer?.length || 0, sanityConfidence: sanityCheck?.overallConfidence ?? null, selectorTier,
          verificationState: this.lastAnswerVerification?.state || 'unknown' }
      });
      // Observability for selector drift (review P1.1 + health->extraction follow-up):
      // a final answer coming from a generic/last-resort selector means the specific
      // platform selectors missed — a leading signal of selector breakage.
      if (selectorTier === 'last_resort_generic' || selectorTier === 'generic_markdown') {
        this.telemetry.logPhase('finalization_low_tier_selector', { selectorTier, selectorUsed: this.lastAnswerSelector || null });
      }

      return this.state.finalizationResult;
    }

    // Binds the watcher's decision record to the text that was actually
    // extracted. The watcher proves terminality; this phase materializes the
    // answer — separate components, joined here into one typed result so that
    // whoever consumes the text also gets the strength of the claim behind it.
    buildFinalRunResult(answer) {
      const contract = window.RunResultContract;
      const proof = this.state.answerResult?.runProof || null;
      if (!contract || !proof) return null;
      const verification = this.lastAnswerVerification || null;
      const structuralComplete = verification?.structuralComplete;
      const semantic = structuralComplete === true
        ? contract.AXIS_STATES.PROVEN
        : (structuralComplete === false ? contract.AXIS_STATES.CONTRADICTED : contract.AXIS_STATES.UNPROVEN);
      // Two independent readings of the same answer agreeing across the
      // verification snapshots is the integrity evidence available here.
      const integrity = verification?.verified === true
        ? contract.AXIS_STATES.PROVEN
        : contract.AXIS_STATES.UNPROVEN;
      return contract.buildRunResult({
        type: proof.declaredType,
        guarantee: proof.guarantee,
        terminalReason: proof.terminalReason,
        axes: Object.assign({}, proof.axes, { semantic, integrity }),
        strongestEvidenceClass: proof.strongestEvidenceClass,
        reasons: proof.reasons,
        llmName: this.llmName || this.platform,
        dispatchId: proof.dispatchId || null,
        text: answer
      });
    }

    async runMaintenanceScroll(containerInfo) {
      if (!containerInfo || !this.config.streaming?.maintenanceScroll?.enabled) {
        return { ran: false, reason: 'disabled' };
      }
      try {
        return await this.maintenanceScroll.run(containerInfo);
      } catch (error) {
        return { ran: false, reason: error.message };
      }
    }

    describeAnswerNode(element) {
      if (!element || element.nodeType !== 1) return null;
      const text = this.extractText(element);
      const classes = typeof element.className === 'string'
        ? element.className.split(/\s+/).filter(Boolean).slice(0, 4).join('.')
        : '';
      return {
        tag: String(element.tagName || '').toLowerCase(),
        role: element.getAttribute?.('role') || null,
        id: String(element.id || '').slice(0, 80) || null,
        classes: classes.slice(0, 160) || null,
        length: text.length,
        hash: this.hashString(text)
      };
    }

    captureAnswerStructureSnapshot() {
      const turn = this.resolveCurrentTurn();
      const selected = turn.answerNode;
      if (!selected) return null;
      const selectedText = this.extractText(selected);
      const candidates = turn.candidates;
      const descriptors = candidates.slice(-12).map((node) => this.describeAnswerNode(node)).filter(Boolean);
      const messageRoot = turn.messageRoot;
      const rootText = this.extractText(messageRoot);
      const structure = window.AnswerStructure?.inspect
        ? window.AnswerStructure.inspect(messageRoot, selected)
        : { complete: false, issues: ['structural_inspector_unavailable'], omittedBlockCount: 0, omittedBlocks: [] };
      const generationSignal = window.GenerationSignal?.inspect?.({
        selectors: this.selectors,
        queryAll: (selector) => this.querySelectorAllSafe(selector)
      }) || { active: true, kind: 'detector_unavailable', selector: null };
      const storedIdentity = window.ContentUtils?.ensureDispatchMeta?.({}, this.llmName) || {};
      const identity = this.runIdentity || this.config.runIdentity || storedIdentity;
      const selectedCandidateIndex = candidates.indexOf(selected);
      return {
        observedAt: Date.now(),
        runSessionId: identity.runSessionId || storedIdentity.runSessionId || this.config.runSessionId || null,
        dispatchId: identity.dispatchId || storedIdentity.dispatchId || this.config.dispatchId || null,
        generationEpoch: identity.generationEpoch ?? storedIdentity.generationEpoch ?? this.config.generationEpoch ?? null,
        turnAnchor: this.anchorAnswerCount ?? null,
        selectedHash: this.hashString(selectedText),
        selectedLength: selectedText.length,
        selectedNodeKey: answerNodeKey(selected),
        selectedCandidateIndex,
        candidateOrdinalAfterAnchor: selectedCandidateIndex >= 0
          ? selectedCandidateIndex - Number(this.anchorAnswerCount || 0) + 1
          : null,
        messageRootHash: this.hashString(rootText),
        messageRootLength: rootText.length,
        candidateSetHash: this.hashString(JSON.stringify(descriptors.map(({ hash, length, tag, role }) => ({ hash, length, tag, role })))),
        candidateCount: descriptors.length,
        nodes: descriptors,
        selectorTier: this.lastAnswerSelectorTier || null,
        selectorUsed: this.lastAnswerSelector || null,
        uncoveredBlockCount: structure.omittedBlockCount,
        uncoveredBlocks: structure.omittedBlocks,
        resolution: turn.resolution,
        resolutionReason: turn.reason,
        messageRootSelector: turn.messageRootSelector || null,
        structuralComplete: Boolean(turn.resolution === 'exact' && structure.complete),
        structuralIssues: structure.issues,
        generationActive: generationSignal.active,
        generationSignalKind: generationSignal.kind,
        generationSignalSelector: generationSignal.selector,
        generationSignalChecks: Array.isArray(generationSignal.checks) ? generationSignal.checks : []
      };
    }

    async verifyFallbackAnswer(text) {
      // Reuse this dispatch's original anchor and baseline; creating a new
      // pipeline here would anchor to the answer we are trying to verify.
      try {
        const stable = await this.runFinalStabilityChecks({ emitVerification: false });
        const proof = this.lastAnswerVerification || {};
        const matches = proof.selectedHash === this.hashString(String(text || ''))
          && proof.selectedLength === String(text || '').length;
        const baseline = this.isStaleBaselineAnswer(text);
        const verified = stable && proof.verified === true && matches && !baseline;
        return {...proof, verified, state: verified ? 'verified' : 'candidate',
          reasons: [...new Set([...(proof.reasons || []),
            ...(!matches ? ['fallback_text_mismatch'] : []),
            ...(baseline ? ['stale_baseline_answer'] : [])])]};
      } catch (err) {
        return {verified:false, state:'candidate', reasons:['fallback_verification_failed']};
      }
    }

    async runFinalStabilityChecks({ emitVerification = true } = {}) {
      const checks = this.config.finalization?.stabilityChecks || 3;
      const retryBudget = Math.max(0, Number(this.config.finalization?.stabilityRetryBudget || 0));
      const maxSnapshots = checks + retryBudget;
      const interval = this.config.finalization?.stabilityInterval || 800;
      let previous = null;
      let verifiedCount = 0;
      let lastResult = null;
      let snapshotsCompared = 0;
      let maxObservedTextLength = 0;
      let lengthDecreaseCount = 0;
      let lastLengthDecrease = null;
      let lengthRegressionActive = false;
      let lengthRegressionFloor = 0;
      const recentLengths = [];
      for (let i = 0; i < maxSnapshots; i += 1) {
        const snapshot = this.captureAnswerStructureSnapshot();
        if (!snapshot) return false;
        snapshotsCompared = i + 1;
        const selectedLength = Number(snapshot.selectedLength || 0);
        const maximumBeforeSnapshot = maxObservedTextLength;
        maxObservedTextLength = Math.max(maxObservedTextLength, selectedLength);
        recentLengths.push({ observedAt: snapshot.observedAt, length: snapshot.selectedLength, nodeKey: snapshot.selectedNodeKey });
        if (recentLengths.length > 12) recentLengths.shift();
        if (previous) {
          if (selectedLength < Number(previous.selectedLength || 0)) {
            lengthDecreaseCount += 1;
            lengthRegressionActive = true;
            lengthRegressionFloor = Math.max(lengthRegressionFloor, maximumBeforeSnapshot, Number(previous.selectedLength || 0));
            lastLengthDecrease = {
              observedAt: snapshot.observedAt,
              from: Number(previous.selectedLength || 0),
              to: selectedLength,
              delta: selectedLength - Number(previous.selectedLength || 0),
              recoveryFloor: lengthRegressionFloor
            };
            this.emitPipelineTelemetry('ANSWER_LENGTH_DECREASED', { level: 'warning', meta: lastLengthDecrease });
          }
          if (lengthRegressionActive && selectedLength >= lengthRegressionFloor) {
            lengthRegressionActive = false;
            verifiedCount = 0;
            this.emitPipelineTelemetry('ANSWER_LENGTH_REGRESSION_RECOVERED', { level: 'info', meta: {
              observedAt: snapshot.observedAt, selectedLength, recoveryFloor: lengthRegressionFloor
            } });
          }
          if (previous.selectedNodeKey && snapshot.selectedNodeKey && previous.selectedNodeKey !== snapshot.selectedNodeKey) {
            this.emitPipelineTelemetry('ANSWER_NODE_REPLACED', { level: 'warning', meta: {
              observedAt: snapshot.observedAt, previousNodeKey: previous.selectedNodeKey, selectedNodeKey: snapshot.selectedNodeKey
            } });
          }
          lastResult = window.AnswerVerification?.verifySnapshotPair
            ? window.AnswerVerification.verifySnapshotPair(previous, snapshot, { minimumLength: 1 })
            : { verified: previous.selectedHash === snapshot.selectedHash, reasons: [] };
          if (lengthRegressionActive) verifiedCount = 0;
          else if (lastResult.verified) verifiedCount += 1;
          else verifiedCount = 0;
          if (verifiedCount >= checks - 1) {
            this.lastAnswerVerification = { ...lastResult, snapshotsCompared, requiredSnapshots: checks,
              retryBudget, retriesUsed: Math.max(0, snapshotsCompared - checks), nodes: snapshot.nodes,
              maxObservedTextLength, lengthDecreaseCount, lastLengthDecrease, recentLengths,
              lengthRegressionActive, lengthRegressionFloor,
              effectiveConfig: this.effectiveTimingSnapshot || window.AnswerPipelineTiming?.getEffectiveSnapshot?.() || null };
            if (emitVerification) this.emitPipelineTelemetry('ANSWER_VERIFICATION_RESULT', { level: 'success', meta: this.lastAnswerVerification });
            return true;
          }
        }
        previous = snapshot;
        // eslint-disable-next-line no-await-in-loop
        await this.sleep(interval);
      }
      this.lastAnswerVerification = {
        ...(lastResult || { verified: false, state: 'candidate', reasons: ['insufficient_stable_observations'] }),
        snapshotsCompared,
        requiredSnapshots: checks,
        retryBudget,
        retriesUsed: Math.max(0, snapshotsCompared - checks),
        maxObservedTextLength,
        lengthDecreaseCount,
        lastLengthDecrease,
        lengthRegressionActive,
        lengthRegressionFloor,
        recentLengths,
        nodes: previous?.nodes || [],
        effectiveConfig: this.effectiveTimingSnapshot || window.AnswerPipelineTiming?.getEffectiveSnapshot?.() || null
      };
      if (lengthRegressionActive) {
        this.lastAnswerVerification.verified = false;
        this.lastAnswerVerification.state = 'candidate';
        this.lastAnswerVerification.reasons = Array.from(new Set([
          ...(Array.isArray(this.lastAnswerVerification.reasons) ? this.lastAnswerVerification.reasons : []),
          'answer_length_regression_unrecovered'
        ]));
      }
      if (emitVerification) this.emitPipelineTelemetry('ANSWER_VERIFICATION_RESULT', { level: 'warning', meta: this.lastAnswerVerification });
      return false;
    }

    // Collect all answer candidates in document order. Shared by getAnswerElement
    // and the turn-anchor capture so both see the same candidate space.
    collectSortedAnswerCandidates() {
      const turn = this.resolveCurrentTurn();
      return {
        ...turn,
        sorted: turn.candidates,
        selectorByElement: turn.metadataByElement,
        selectors: turn.candidateSelectors,
        totalSelectors: turn.candidateSelectors.length
      };
    }

    resolveCurrentTurn() {
      const circuit = (typeof window !== 'undefined' && window.SelectorCircuit) || null;
      const deepQuery = window.TurnResolver?.createDeepQuery?.(document);
      const classifier = window.AnswerContentClassifier;
      const rejectedCandidateClasses = classifier?.CLASSES ? new Set([
        classifier.CLASSES.EMPTY,
        classifier.CLASSES.PROMPT_ECHO,
        classifier.CLASSES.UI_NOISE,
        classifier.CLASSES.TECHNICAL_MESSAGE
      ]) : null;
      const turn = window.TurnResolver?.resolveTurn?.({
        platform: this.platform,
        selectors: this.selectors,
        answerSelectors: this.config.answerSelectors,
        selectorAllowed: (selector) => !circuit || circuit.shouldUse(selector, this.platform, 'answer') !== false,
        anchorAnswerCount: this.anchorAnswerCount,
        minimumTextLength: 1,
        candidateEligible: ({ node, text }) => {
          const role = String(node?.getAttribute?.('data-role') || node?.getAttribute?.('data-message-author-role') || '').toLowerCase();
          const identity = `${node?.id || ''} ${node?.className || ''}`.toLowerCase();
          if (role === 'user' || /(^|[\s_-])user([\s_-]|$)/.test(identity)) return false;
          if (!classifier?.classify) return true;
          const classification = classifier.classify(text, { minValid: 20 });
          return !rejectedCandidateClasses.has(classification.contentClass);
        },
        queryAll: (selector) => deepQuery?.all?.(selector) || this.querySelectorAllSafe(selector),
        queryOne: (selector) => deepQuery?.one?.(selector) || this.querySelectorSafe(selector)
      }) || {
        platform: this.platform, resolution: 'unresolved', reason: 'turn_resolver_unavailable',
        answerNode: null, messageRoot: null, candidates: [], candidatePool: [], metadataByElement: new Map(),
        matchedIndices: new Set(), candidateSelectors: []
      };
      this.lastTurnResolution = turn;
      const key = `${turn.resolution}:${turn.reason}:${turn.selectorUsed || ''}:${turn.messageRootSelector || ''}`;
      if (this.lastTurnResolutionTelemetryKey !== key) {
        this.lastTurnResolutionTelemetryKey = key;
        this.emitPipelineTelemetry('TURN_RESOLUTION', {
          level: turn.resolution === 'exact' ? 'info' : 'warning',
          details: `${turn.resolution}:${turn.reason}`,
          meta: {
            resolution: turn.resolution,
            reason: turn.reason,
            selectorUsed: turn.selectorUsed || null,
            selectorTier: turn.selectorTier || null,
            messageRootSelector: turn.messageRootSelector || null,
            candidateCount: turn.candidates.length
          }
        });
      }
      return turn;
    }

    getAnswerElement(opts = {}) {
      const reportHealth = opts.reportHealth === true;
      const circuit = (typeof window !== 'undefined' && window.SelectorCircuit) || null;
      const { sorted, selectorByElement, matchedIndices, selectors, totalSelectors, answerNode, positionalFiltered } = this.collectSortedAnswerCandidates();
      const candidates = sorted;

      // At finalize (answer is present), feed the circuit: success for the selector that
      // produced the accepted answer; failure for any higher-priority selector that
      // matched nothing while a lower-priority one won — that is selector drift, and
      // after `threshold` consecutive misses the circuit disables it (auto-demotion).
      const reportToCircuit = (winnerIndex) => {
        if (!reportHealth || !circuit || winnerIndex == null) return;
        for (const { selector, index } of selectors) {
          if (index === winnerIndex) circuit.report(selector, this.platform, 'answer', true);
          else if (index < winnerIndex && !matchedIndices.has(index)) circuit.report(selector, this.platform, 'answer', false);
        }
      };

      const recordTier = (el) => {
        const info = selectorByElement.get(el) || null;
        this.lastAnswerSelector = info?.selector || null;
        this.lastAnswerSelectorTier = this.classifySelectorTier(info?.selector, info?.index, totalSelectors);
        reportToCircuit(info?.index);
      };

      if (!candidates.length) {
        this.lastAnswerSelector = null;
        this.lastAnswerSelectorTier = null;
        return null;
      }
      this.lastAnswerPositionalFiltered = positionalFiltered === true;
      if (answerNode) recordTier(answerNode);
      return answerNode || null;
    }

    // Classify the selector that produced the answer into a trust tier (review P1.1).
    // index 0 = the most specific platform selector; the generic DOM selectors
    // (.prose / article / [class*="markdown"] / main) are last-resort.
    classifySelectorTier(selector, index, total) {
      if (!selector) return 'unknown';
      const s = String(selector).toLowerCase();
      if (/\.prose|^article$|\barticle\b|\[class\*="markdown"\]|(^|\s)main(\s|$)|generic/.test(s)) {
        return 'last_resort_generic';
      }
      if (index === 0) return 'primary_assistant';
      if (typeof total === 'number' && total > 0 && index >= total - 2) return 'generic_markdown';
      return 'secondary_platform_specific';
    }

    async extractAnswer() {
      const element = this.getAnswerElement();
      if (!element) throw new Error('answer_element_missing');
      if (this.perplexityHelper) {
        await this.perplexityHelper.waitForStabilization(element);
        return this.extractText(element);
      }
      return this.extractText(element);
    }

    async extractAnswerWithHtml() {
      // reportHealth: this is the finalize extraction (answer present), so it is safe to
      // feed the selector circuit with success/drift signals here.
      const element = this.getAnswerElement({ reportHealth: true });
      if (!element) throw new Error('answer_element_missing');
      let text = '';
      if (this.perplexityHelper) {
        await this.perplexityHelper.waitForStabilization(element);
        text = this.extractText(element);
      } else {
        text = this.extractText(element);
      }
      const html = this.extractHtml(element);
      return { text, html };
    }

    extractHtml(element) {
      if (!element) return '';
      try {
        const builder = window.ContentUtils?.buildInlineHtml;
        if (typeof builder === 'function') {
          return String(builder(element, { includeRoot: true }) || '').trim();
        }
        const clone = element.cloneNode(true);
        return String(clone.outerHTML || '').trim();
      } catch (_) {
        return '';
      }
    }

    // Normalized form used only for the stale-baseline comparison (F6): collapse
    // whitespace and lowercase so cosmetic differences don't defeat the guard.
    normalizeAnswerSignature(text) {
      return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    // True when the extracted answer is the pre-run baseline (the previous answer
    // on a conversation page) rather than a freshly generated one.
    isStaleBaselineAnswer(answer) {
      if (!this.baselineAnswerSignature) return false;
      const candidate = this.normalizeAnswerSignature(answer);
      if (!candidate) return false;
      return candidate === this.baselineAnswerSignature;
    }

    extractText(element) {
      if (!element) return '';
      return window.AnswerStructure?.linearizeText?.(element) || '';
    }

    hashString(str) {
      let hash = 0;
      for (let i = 0; i < str.length; i += 1) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
      }
      return hash.toString(36);
    }

    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    getDefaultStreamStartSelectors() {
      return [
        '[data-testid=\"conversation-turn\"]',
        '.chat-message',
        'article',
        '[data-scroll-anchor]'
      ];
    }

    querySelectorSafe(selector) {
      if (!selector) return null;
      try {
        return document.querySelector(selector);
      } catch (err) {
        console.warn('[Pipeline] Invalid selector', selector, err);
        return null;
      }
    }

    querySelectorAllSafe(selector) {
      if (!selector) return [];
      try {
        return Array.from(document.querySelectorAll(selector));
      } catch (err) {
        console.warn('[Pipeline] Invalid selector (all)', selector, err);
        return [];
      }
    }

    _lifecycleHeartbeat(phase, progress) {
      if (this.lifecycle && this.lifecycleTraceId) {
        this.lifecycle.heartbeat(this.lifecycleTraceId, progress, { phase });
      }
    }

    _reportLifecycleError(phase, message) {
      if (this.lifecycle && this.lifecycleTraceId) {
        const err = new Error(message || phase);
        this.lifecycle.error(this.lifecycleTraceId, err, false);
      }
    }

    handleError(phase, error) {
      this.state.phase = 'error';
      this.transitionState('ERROR', { phase });
      const payload = {
        success: false,
        error: {
          phase,
          message: typeof error === 'string' ? error : error.message
        }
      };
      this.telemetry.logPhase('pipeline_error', payload.error);
      const visibilityState = typeof document !== 'undefined' ? document.visibilityState : null;
      const hasFocus = typeof document !== 'undefined' && typeof document.hasFocus === 'function'
        ? document.hasFocus()
        : null;
      this.emitPipelineTelemetry('PIPELINE_ERROR', {
        level: 'error',
        meta: { phase, message: payload.error.message, visibilityState, hasFocus }
      });
      return payload;
    }
  }

  window.UnifiedAnswerPipeline = UnifiedAnswerPipeline;
})();
