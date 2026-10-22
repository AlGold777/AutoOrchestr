/* eslint-disable no-console */

(function initUnifiedPipelineModules() {
  if (window.UnifiedPipelineModules) return;

  const detectLifecycleMode = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return 'background';
    }
    return window.__humanoidActivityMode || 'interactive';
  };

  const startLifecycleTrace = (source, context = {}) => {
    const events = window.HumanoidEvents;
    if (!events?.start) return null;
    try {
      return events.start(source, Object.assign({ mode: detectLifecycleMode() }, context));
    } catch (_) {
      return null;
    }
  };

  const heartbeatLifecycle = (traceId, progress = 0, meta = {}) => {
    if (!traceId) return;
    const events = window.HumanoidEvents;
    if (!events?.heartbeat) return;
    try {
      events.heartbeat(traceId, progress, meta);
    } catch (_) {}
  };

  const timelineLog = (label, meta = {}) => {
    const entry = { ts: Date.now(), label, ...meta };
    try {
      if (!Array.isArray(window.__SCROLL_TIMELINE)) {
        window.__SCROLL_TIMELINE = [];
      }
      window.__SCROLL_TIMELINE.push(entry);
      if (window.__SCROLL_TIMELINE.length > 500) {
        window.__SCROLL_TIMELINE.splice(0, window.__SCROLL_TIMELINE.length - 500);
      }
    } catch (_) {}
    try {
      console.debug('[SCROLL-TIMELINE]', label, meta);
    } catch (_) {}
  };

  const stopLifecycleTrace = (traceId, result = {}) => {
    if (!traceId) return;
    const events = window.HumanoidEvents;
    if (!events?.stop) return;
    try {
      events.stop(traceId, result);
    } catch (_) {}
  };

  const registerForceStopHandler = (handler) => {
    const registry = window.__humanoidForceStopRegistry;
    if (registry?.register) {
      return registry.register(handler);
    }
    if (typeof window.__registerHumanoidForceStopHandler === 'function') {
      return window.__registerHumanoidForceStopHandler(handler);
    }
    return () => {};
  };

  // ═══════════════════════════════════════════════════════════
  // ScrollCoordinator - Priority-based scroll conflict management
  // ═══════════════════════════════════════════════════════════
  class ScrollCoordinator {
    constructor() {
      this.activeScroller = null;
      this.activeSince = null;
      this.priorities = {
        'MaintenanceScroll': 3,
        'ContinuousActivity': 2,
        'KeepAlive': 1
      };
      this.registry = new Map();
      this.hardStop = false;
    }

    register(name, instance) {
      if (!this.priorities[name]) {
        console.warn(`[ScrollCoordinator] Unknown scroller: ${name}`);
        return;
      }
      this.registry.set(name, instance);
    }

    unregister(name) {
      this.registry.delete(name);
      if (this.activeScroller === name) {
        this.activeScroller = null;
        this.activeSince = null;
      }
    }

    requestScroll(name, scrollFn) {
      if (this.hardStop || window.__LLMScrollHardStop) {
        return false;
      }

      const requestPriority = this.priorities[name] || 0;
      const activePriority = this.activeScroller ? (this.priorities[this.activeScroller] || 0) : 0;

      if (!this.activeScroller || requestPriority > activePriority) {
        this.activeScroller = name;
        this.activeSince = Date.now();
        try {
          scrollFn();
          return true;
        } catch (err) {
          console.error(`[ScrollCoordinator] ${name} failed:`, err);
          this.release(name);
          return false;
        }
      }
      return false;
    }

    release(name) {
      if (this.activeScroller === name) {
        this.activeScroller = null;
        this.activeSince = null;
      }
    }
  }

  const scrollCoordinator = new ScrollCoordinator();

  class AdaptiveTimeoutManager {
    constructor(customConfig = {}) {
      const defaults = {
        short: { maxChars: 500, timeout: 15000 },
        medium: { maxChars: 2000, timeout: 30000 },
        long: { maxChars: 5000, timeout: 60000 },
        veryLong: { maxChars: Infinity, timeout: 120000 },
        softExtension: 15000,
        hardMax: 120000
      };
      this.config = Object.assign({}, defaults, customConfig);
      this.softDeadline = null;
      this.hardDeadline = null;
      this.startedAt = null;
      this.expectedLength = null;
    }

    setExpectedLength(expectedLength = null) {
      this.expectedLength = Object.prototype.hasOwnProperty.call(this.config, expectedLength)
        ? expectedLength
        : null;
      return this.expectedLength;
    }

    getExpectedTimeout(expectedLength = this.expectedLength) {
      return expectedLength && Object.prototype.hasOwnProperty.call(this.config, expectedLength)
        ? Number(this.config[expectedLength]?.timeout || 0)
        : 0;
    }

    calculateTimeout(currentContent = '', options = {}) {
      const length = typeof currentContent === 'string'
        ? currentContent.length
        : (Number(currentContent) || 0);
      const expectedLength = typeof options === 'string' ? options : options?.expectedLength;
      if (expectedLength) this.setExpectedLength(expectedLength);
      const base = Math.max(this.getBaseTimeout(length), this.getExpectedTimeout());
      const hard = Math.min(base * 2, this.config.hardMax);
      const soft = Math.min(base, this.config.hardMax);
      this.startedAt = Date.now();
      this.softDeadline = this.startedAt + soft;
      this.hardDeadline = this.startedAt + hard;
      return { soft, hard };
    }

    recalculateOnGrowth(currentContent = '') {
      if (this.startedAt === null || this.softDeadline === null || this.hardDeadline === null) {
        return this.calculateTimeout(currentContent);
      }
      const length = typeof currentContent === 'string'
        ? currentContent.length
        : (Number(currentContent) || 0);
      const base = Math.max(this.getBaseTimeout(length), this.getExpectedTimeout());
      const hardCap = this.startedAt + Number(this.config.hardMax || 0);
      this.softDeadline = Math.max(this.softDeadline, Math.min(this.startedAt + base, hardCap));
      this.hardDeadline = Math.max(this.hardDeadline, Math.min(this.startedAt + (base * 2), hardCap));
      return this.checkExpiration();
    }

    getBaseTimeout(length) {
      if (length <= this.config.short.maxChars) return this.config.short.timeout;
      if (length <= this.config.medium.maxChars) return this.config.medium.timeout;
      if (length <= this.config.long.maxChars) return this.config.long.timeout;
      return this.config.veryLong.timeout;
    }

    extendSoftTimeout() {
      if (!this.softDeadline || !this.hardDeadline) return false;
      const now = Date.now();
      if (now >= this.hardDeadline) return false;
      const newDeadline = Math.min(
        this.softDeadline + this.config.softExtension,
        this.hardDeadline
      );
      const extended = newDeadline > this.softDeadline;
      if (extended) {
        this.softDeadline = newDeadline;
      }
      return extended;
    }

    checkExpiration() {
      const now = Date.now();
      return {
        softExpired: this.softDeadline ? now >= this.softDeadline : false,
        hardExpired: this.hardDeadline ? now >= this.hardDeadline : false,
        softRemaining: this.softDeadline ? Math.max(0, this.softDeadline - now) : Infinity,
        hardRemaining: this.hardDeadline ? Math.max(0, this.hardDeadline - now) : Infinity
      };
    }

    getStatus() {
      return {
        softDeadline: this.softDeadline,
        hardDeadline: this.hardDeadline,
        ...this.checkExpiration()
      };
    }

    reset() {
      this.softDeadline = null;
      this.hardDeadline = null;
    }
  }

  const coordinationModes = {
    balanced: {
      waitFor: 'both',
      priority: 'answer',
      description: 'Wait for both, prioritize answer completion'
    },
    fast: {
      waitFor: 'first',
      earlyExit: true,
      description: 'First to complete (scroll OR answer)'
    }
  };

  class TabProtector {
    constructor() {
      this.audioContext = null;
      this.oscillator = null;
      this.gainNode = null;
    }

    start() {
      try {
        if (this.audioContext) return;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return { ok: false, reason: 'no_audio_context' };
        this.audioContext = new Ctx();
        this.oscillator = this.audioContext.createOscillator();
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = 0.0001;
        this.oscillator.connect(this.gainNode);
        this.gainNode.connect(this.audioContext.destination);
        this.oscillator.start();
        return { ok: true };
      } catch (err) {
        console.warn('[TabProtector] start failed', err);
        return { ok: false, reason: err?.message || 'start_failed' };
      }
    }

    stop() {
      try {
        if (this.oscillator) {
          this.oscillator.stop();
        }
      } catch (_) {}
      try {
        if (this.audioContext) {
          this.audioContext.close();
        }
      } catch (_) {}
      this.oscillator = null;
      this.gainNode = null;
      this.audioContext = null;
    }
  }

  function selectMode(context = {}) {
    if (context.expectedLength === 'short') return coordinationModes.fast;
    return coordinationModes.balanced;
  }

  class IntelligentRetryManager {
    constructor(customConfig = {}) {
      const defaults = {
        enabled: true,
        maxRetries: 5,
        backoffSequence: [300, 600, 1200, 2000, 2000],
        noGrowthThreshold: 2
      };
      this.config = Object.assign({}, defaults, customConfig);
      this.maxRetries = this.config.maxRetries;
    }

    async retryWithBackoff(attempt, operation, context) {
      const progress = this.checkProgress(context);
      if (progress.noGrowth && attempt >= 2) {
        console.log('[Retry] No growth detected, early exit');
        return { success: false, reason: 'no_progress' };
      }
      const delay = this.config.backoffSequence[Math.min(
        attempt - 1,
        this.config.backoffSequence.length - 1
      )];
      console.log(`[Retry] Attempt ${attempt}/${this.maxRetries}, backoff: ${delay}ms`);
      await this.sleep(delay);
      return operation();
    }

    checkProgress(context = {}) {
      const { lastScrollHeight = 0, currentScrollHeight = 0 } = context;
      const growth = currentScrollHeight - lastScrollHeight;
      return { growth, noGrowth: growth < (this.config.noGrowthThreshold ?? 2) };
    }

    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
  }

  class ContinuousHumanActivity {
    constructor(config = {}) {
      this.intervalId = null;
      this.config = Object.assign({
        interval: 5000,
        scrollRange: [50, 200],
        pauseBetweenMoves: 300,
        enabled: false,
        sessionTimeoutMs: 3 * 60 * 1000
      }, config);
      this.lifecycleTraceId = null;
      this.unregisterForceStop = null;
      this.sessionStopTimer = null;
    }

    startDuringWait() {
      if (window.__PRAGMATIST_SPEED_MODE) return;
      if (window.__LLMScrollHardStop) return;
      if (this.intervalId || !this.config.enabled) return;
      this._startSessionTimer();
      if (!this.lifecycleTraceId) {
        this.lifecycleTraceId = startLifecycleTrace('continuous-activity', {
          mode: detectLifecycleMode(),
          interval: this.config.interval
        });
      }
      if (!this.unregisterForceStop) {
        this.unregisterForceStop = registerForceStopHandler(() => this.stop('background-force-stop'));
      }
      this.intervalId = setInterval(() => this.performMicroActivity(), this.config.interval);
    }

    async performMicroActivity() {
      if (window.__PRAGMATIST_SPEED_MODE) return;
      if (window.__LLMScrollHardStop) return;
      
      // Use ScrollCoordinator to avoid conflicts
      const allowed = scrollCoordinator.requestScroll('ContinuousActivity', () => {
        if (this.lifecycleTraceId) {
          heartbeatLifecycle(this.lifecycleTraceId, 0, {
            phase: 'micro-activity',
            action: 'micro-scroll'
          });
        }
      });
      
      if (!allowed) return; // Lower priority scroller is active
      
      const direction = Math.random() > 0.5 ? 1 : -1;
      const distance = this.config.scrollRange[0] +
        Math.random() * (this.config.scrollRange[1] - this.config.scrollRange[0]);
      const mouseSim = window.LLMExtension?.mouseSimulator;
      const humanoid = window.Humanoid;
      
      const pauseBetweenMoves = this.config.pauseBetweenMoves || (200 + Math.random() * 200);
      const scheduleReverseAndRelease = (reverseFn) => {
        setTimeout(() => {
          if (scrollCoordinator.activeScroller !== 'ContinuousActivity') return;
          if (window.__LLMScrollHardStop) {
            scrollCoordinator.release('ContinuousActivity');
            return;
          }
          try {
            reverseFn?.();
          } finally {
            scrollCoordinator.release('ContinuousActivity');
          }
        }, pauseBetweenMoves);
      };

      try {
        if (mouseSim?.scrollWithMouse) {
          await mouseSim.scrollWithMouse(direction * distance);
          scheduleReverseAndRelease(() => {
            Promise.resolve(mouseSim.scrollWithMouse?.(-direction * distance)).catch(() => {});
          });
          return;
        }

        if (humanoid?.humanScroll) {
          await humanoid.humanScroll(direction * distance, {
            style: 'micro',
            settle: false,
            waitForIdle: false,
            jitter: false
          });
          scheduleReverseAndRelease(() => {
            Promise.resolve(humanoid.humanScroll?.(-direction * distance, {
              style: 'micro',
              settle: false,
              waitForIdle: false,
              jitter: false
            })).catch(() => {});
          });
          return;
        }

        window.scrollBy({ top: direction * distance, behavior: 'smooth' });
        scheduleReverseAndRelease(() => {
          window.scrollBy({ top: -direction * distance, behavior: 'smooth' });
        });
      } catch (err) {
        console.warn('[ContinuousActivity] micro-scroll failed', err);
        scrollCoordinator.release('ContinuousActivity');
      }
    }

    stop(reason = 'manual-stop') {
      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
      if (this.unregisterForceStop) {
        try { this.unregisterForceStop(); } catch (_) {}
        this.unregisterForceStop = null;
      }
      if (this.sessionStopTimer) {
        clearTimeout(this.sessionStopTimer);
        this.sessionStopTimer = null;
      }
      if (this.lifecycleTraceId) {
        stopLifecycleTrace(this.lifecycleTraceId, {
          status: reason === 'background-force-stop' ? 'forced' : 'stopped',
          reason
        });
        this.lifecycleTraceId = null;
      }
    }

    _startSessionTimer() {
      if (!this.config.sessionTimeoutMs || this.sessionStopTimer) return;
      this.sessionStopTimer = setTimeout(() => {
        this.stop('session-timeout');
      }, this.config.sessionTimeoutMs);
    }
  }

  class HumanSessionController {
    constructor(deps = {}, config = {}) {
      this.continuousActivity = deps.continuousActivity || null;
      this.getHumanoid = deps.getHumanoid || (() => window.Humanoid || null);
      this.baseTimeoutMs = config.baseTimeoutMs || 180000;
      this.jitterPct = typeof config.jitterPct === 'number' ? config.jitterPct : 0.2;
      this.passiveMin = config.passiveMin || 0; // никаких пассивных пульсов после тайм-аута
      this.passiveMax = config.passiveMax || 0;
      // Жёсткий 3-минутный потолок без продлений
      const hardCeiling = config.baseTimeoutMs || 180000;
      this.hardStopMin = config.hardStopMin || hardCeiling;
      this.hardStopMax = config.hardStopMax || hardCeiling;
      this.hardStopAbsoluteMaxMs = typeof config.hardStopAbsoluteMaxMs === 'number'
        ? config.hardStopAbsoluteMaxMs
        : hardCeiling; // абсолютный потолок совпадает с 3-минутным лимитом
      this.activityExtendMs = 0; // не продлеваем при активности
      this.onHardStop = typeof config.onHardStop === 'function' ? config.onHardStop : null;
      this.state = 'IDLE';
      this.expireTimer = null;
      this.passiveTimer = null;
      this.visibilityHandler = null;
      this.hardStopTimer = null;
      this.hardStopDeadline = null;
      this.lastActivity = null;
      this.sessionStartedAt = null;
      this.killSwitches = new Set();
      this._scrollKillPatched = false;
      this._scrollAbortController = null;
      this._bodyOverflowBackup = null;
      this.expireOnHidden = config.expireOnHidden === true;
      this.hiddenAt = null;
      this._publishState('IDLE');
    }

    startSession() {
      this.stopSession('restart');
      this.state = 'ACTIVE';
      this._releaseScrollKillSwitch();
      const duration = this._computeDuration();
      this.lastActivity = Date.now();
      this.sessionStartedAt = this.lastActivity;
      this.expireTimer = setTimeout(() => this.expireSession('time-limit'), duration);
      this._scheduleHardStop();
      this._attachVisibilityHandler();
      this._publishState('ACTIVE');
      timelineLog('session_start', { duration });
      try { window.humanSessionController = this; } catch (_) {}
    }

    expireSession(reason = 'time-limit') {
      if (this.state !== 'ACTIVE') return;
      this._hardStop(reason || 'time-limit');
    }

    stopSession(reason = 'manual-stop') {
      if (this.expireTimer) {
        clearTimeout(this.expireTimer);
        this.expireTimer = null;
      }
      if (this.passiveTimer) {
        clearTimeout(this.passiveTimer);
        this.passiveTimer = null;
      }
      if (this.hardStopTimer) {
        clearTimeout(this.hardStopTimer);
        this.hardStopTimer = null;
      }
      this._detachVisibilityHandler();
      this._stopActiveModules(reason);
      this.state = 'IDLE';
      this.sessionStartedAt = null;
      this._publishState('IDLE');
      this._releaseScrollKillSwitch();
      timelineLog('session_stopped', { reason });
    }

    reportActivity(label = 'activity') {
      if (this.state === 'IDLE') return;
      this.lastActivity = Date.now();
      const extendTo = this.lastActivity + this.activityExtendMs;
      const ceiling = this._getHardStopCeiling();
      const cappedExtendTo = ceiling ? Math.min(extendTo, ceiling) : extendTo;
      if (!this.hardStopDeadline || cappedExtendTo > this.hardStopDeadline) {
        this.hardStopDeadline = cappedExtendTo;
        this._scheduleHardStop();
      }
      timelineLog('session_activity', { label, extendTo: this.hardStopDeadline });
    }

    getState() {
      return this.state;
    }

    isHardStopped() {
      return this.state === 'HARD_STOP';
    }

    _stopActiveModules(reason) {
      if (this.continuousActivity) {
        try { this.continuousActivity.stop(reason); } catch (_) {}
      }
      const humanoid = this.getHumanoid();
      if (humanoid?.stopAntiSleepDrift) {
        try { humanoid.stopAntiSleepDrift(); } catch (_) {}
      }
    }

    _startPassiveHeartbeat() {
      const scheduleNext = () => {
        const next = this.passiveMin + Math.random() * (this.passiveMax - this.passiveMin);
        this.passiveTimer = setTimeout(beat, next);
        timelineLog('passive_heartbeat_scheduled', { inMs: next });
      };
      const beat = () => {
        if (this.state !== 'EXPIRED') return;
        const hardStopFlag = Boolean(window.__LLMScrollHardStop);
        const isHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
        if (hardStopFlag || isHidden) {
          timelineLog('passive_heartbeat_skip', { hardStopFlag, isHidden });
          scheduleNext();
          return;
        }
        try {
          const delta = 1;
          window.scrollBy({ top: delta, behavior: 'auto' });
          setTimeout(() => {
            window.scrollBy({ top: -delta, behavior: 'auto' });
          }, 50);
          timelineLog('passive_heartbeat_pulse');
        } catch (_) {}
        scheduleNext();
      };
      scheduleNext();
    }

    _computeDuration() {
      const jitter = this.jitterPct;
      const base = this.baseTimeoutMs;
      const delta = base * jitter * (Math.random() * 2 - 1);
      return Math.max(60000, Math.round(base + delta));
    }

    _scheduleHardStop() {
      if (this.hardStopTimer) {
        clearTimeout(this.hardStopTimer);
        this.hardStopTimer = null;
      }
      const now = Date.now();
      if (!this.hardStopDeadline) {
        const min = this.hardStopMin;
        const max = this.hardStopMax;
        this.hardStopDeadline = now + (min + Math.random() * (max - min));
      }
      const ceiling = this._getHardStopCeiling();
      if (ceiling) {
        this.hardStopDeadline = Math.min(this.hardStopDeadline, ceiling);
      }
      const delay = Math.max(0, this.hardStopDeadline - now);
      timelineLog('hard_stop_scheduled', { deadline: this.hardStopDeadline, delay });
      this.hardStopTimer = setTimeout(() => this._hardStop(), delay);
    }

    _getHardStopCeiling() {
      if (!this.sessionStartedAt || !this.hardStopAbsoluteMaxMs) return null;
      return this.sessionStartedAt + this.hardStopAbsoluteMaxMs;
    }

    _hardStop(reason = 'hard-stop') {
      if (this.expireTimer) {
        clearTimeout(this.expireTimer);
        this.expireTimer = null;
      }
      if (this.passiveTimer) {
        clearTimeout(this.passiveTimer);
        this.passiveTimer = null;
      }
      if (this.hardStopTimer) {
        clearTimeout(this.hardStopTimer);
        this.hardStopTimer = null;
      }
      this._detachVisibilityHandler();
      this._stopActiveModules('hard-stop');
      this.state = 'HARD_STOP';
      this.sessionStartedAt = null;
      this._engageScrollKillSwitch();
      this._publishState('HARD_STOP');
      timelineLog('session_hard_stop', { reason });
      if (this.onHardStop) {
        try { this.onHardStop(); } catch (_) {}
      }
      this.killSwitches.forEach((fn) => {
        try { fn('hard-stop'); } catch (_) {}
      });
    }

    _attachVisibilityHandler() {
      this._detachVisibilityHandler();
      this.visibilityHandler = () => {
        if (this.state !== 'ACTIVE') return;
        if (document.hidden) {
          if (this.expireOnHidden) {
            this.expireSession('hidden');
            return;
          }
          if (!this.hiddenAt) {
            this.hiddenAt = Date.now();
            this._stopActiveModules('hidden');
            timelineLog('session_hidden', { hiddenAt: this.hiddenAt });
          }
          return;
        }
        if (this.hiddenAt) {
          timelineLog('session_visible', { hiddenForMs: Date.now() - this.hiddenAt });
          this.hiddenAt = null;
        }
      };
      document.addEventListener('visibilitychange', this.visibilityHandler, { passive: true });
    }

    _detachVisibilityHandler() {
      if (this.visibilityHandler) {
        document.removeEventListener('visibilitychange', this.visibilityHandler, { passive: true });
        this.visibilityHandler = null;
      }
    }

    _publishState(state) {
      try {
        window.__HumanoidSessionState = { state, ts: Date.now() };
        window.__LLMScrollHardStop = state === 'HARD_STOP';
        const gatekeeper = window.__ScrollGatekeeper;
        if (gatekeeper) {
          if (state === 'HARD_STOP') {
            gatekeeper.engageHardStop();
          } else {
            gatekeeper.release();
          }
        }
        timelineLog('session_state', { state });
        try {
          chrome.runtime?.sendMessage?.({
            type: 'SCROLL_HARD_STOP',
            state
          });
        } catch (_) {}
        if (state !== 'HARD_STOP') {
          this._releaseScrollKillSwitch();
        }
      } catch (_) {}
    }

    registerKillSwitch(fn) {
      if (typeof fn === 'function') {
        this.killSwitches.add(fn);
        return () => this.killSwitches.delete(fn);
      }
      return () => {};
    }

    forceHardStop(reason = 'kill-switch') {
      try {
        this._hardStop(reason);
      } catch (err) {
        console.warn('[HumanSessionController] forceHardStop failed', err);
      }
    }

    _engageScrollKillSwitch() {
      if (this._scrollKillPatched) return;
      if (typeof window === 'undefined') return;
      this._scrollKillPatched = true;
      timelineLog('scroll_kill_engaged');
      try { this._scrollAbortController?.abort(); } catch (_) {}
      this._scrollAbortController = new AbortController();
      const { signal } = this._scrollAbortController;
      const block = (event) => {
        if (!window.__LLMScrollHardStop) return;
        try {
          event.stopImmediatePropagation();
          event.preventDefault();
        } catch (_) {}
      };
      const blockKeys = (event) => {
        const keys = [' ', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
        if (keys.includes(event.key)) {
          block(event);
        }
      };
      const listenerOptions = { capture: true, passive: false, signal };
      try { window.addEventListener('wheel', block, listenerOptions); } catch (_) {}
      try { window.addEventListener('scroll', block, listenerOptions); } catch (_) {}
      try { window.addEventListener('touchmove', block, listenerOptions); } catch (_) {}
      try { window.addEventListener('keydown', blockKeys, listenerOptions); } catch (_) {}
      if (document?.body) {
        this._bodyOverflowBackup = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
      }
    }

    _releaseScrollKillSwitch() {
      if (!this._scrollKillPatched) return;
      try {
        if (this._scrollAbortController) {
          this._scrollAbortController.abort();
          this._scrollAbortController = null;
        }
      } catch (_) {}
      if (document?.body && typeof this._bodyOverflowBackup !== 'undefined') {
        document.body.style.overflow = this._bodyOverflowBackup || '';
      }
      this._bodyOverflowBackup = null;
      this._scrollKillPatched = false;
      timelineLog('scroll_kill_released');
    }
  }

  class MaintenanceScroll {
    constructor(config = {}, sessionController = null) {
      this.intervalId = null;
      this.enabled = false;
      this.config = Object.assign({
        checkInterval: 3000,
        growthThreshold: 50,
        scrollStep: 120,
        idleThreshold: 5000,
        maxDuration: 20000
      }, config);
      this.lifecycleTraceId = null;
      this.unregisterForceStop = null;
      this.currentCleanup = null;
      this.sessionController = sessionController || null;
      this.unregisterKillSwitch = null;
    }

    run(target) {
      if (this.sessionController?.getState?.() === 'HARD_STOP') {
        return Promise.resolve({ ran: false, reason: 'session_hard_stop' });
      }
      if (!target) return Promise.resolve({ ran: false, reason: 'no_target' });
      if (this.enabled) return Promise.resolve({ ran: false, reason: 'already_running' });
      this.enabled = true;
      const isWindowTarget = target.element === window;
      const container = isWindowTarget ? document.documentElement : target.element;
      if (!container) {
        this.enabled = false;
        return Promise.resolve({ ran: false, reason: 'invalid_container' });
      }

      let lastHeight = container.scrollHeight || document.documentElement.scrollHeight || 0;
      let lastGrowthTs = Date.now();
      let cycles = 0;
      const startTime = Date.now();
      timelineLog('maintenance_start', {
        target: isWindowTarget ? 'window' : container.tagName || 'unknown',
        config: this.config
      });

      return new Promise((resolve) => {
        let finished = false;
        const cleanup = (reason = 'manual_stop') => {
          if (finished) return;
          finished = true;
          if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
          }
          if (this.unregisterForceStop) {
            try { this.unregisterForceStop(); } catch (_) {}
            this.unregisterForceStop = null;
          }
          this.enabled = false;
          if (this.unregisterKillSwitch) {
            try { this.unregisterKillSwitch(); } catch (_) {}
            this.unregisterKillSwitch = null;
          }
          const duration = Date.now() - startTime;
          stopLifecycleTrace(this.lifecycleTraceId, {
            status: reason === 'stable' ? 'success' : reason === 'background-force-stop' ? 'forced' : 'stopped',
            reason,
            cycles,
            duration
          });
          timelineLog('maintenance_stop', { reason, cycles, duration });
          this.lifecycleTraceId = null;
          this.currentCleanup = null;
          resolve({
            ran: true,
            reason,
            cycles,
            duration
          });
        };
        this.currentCleanup = cleanup;
        if (!this.lifecycleTraceId) {
          this.lifecycleTraceId = startLifecycleTrace('maintenance-scroll', {
            mode: detectLifecycleMode(),
            target: container === window ? 'window' : container.tagName || 'unknown'
          });
        }
        if (!this.unregisterForceStop) {
          this.unregisterForceStop = registerForceStopHandler(() => cleanup('background-force-stop'));
        }
        if (!this.unregisterKillSwitch && this.sessionController?.registerKillSwitch) {
          this.unregisterKillSwitch = this.sessionController.registerKillSwitch(
            (reason = 'session_hard_stop') => cleanup(reason)
          );
        }

        this.intervalId = setInterval(() => {
          if (this.sessionController?.getState?.() === 'HARD_STOP') {
            cleanup('session_hard_stop');
            return;
          }
          const currentHeight = container.scrollHeight || document.documentElement.scrollHeight || 0;
          const growth = currentHeight - lastHeight;
          if (growth > this.config.growthThreshold) {
            // Use ScrollCoordinator with highest priority
            scrollCoordinator.requestScroll('MaintenanceScroll', () => {
              Promise.resolve(this.scroll(container, this.config.scrollStep, isWindowTarget))
                .catch(() => {})
                .finally(() => scrollCoordinator.release('MaintenanceScroll'));
            });
            lastHeight = currentHeight;
            lastGrowthTs = Date.now();
            cycles += 1;
            timelineLog('maintenance_scroll', { growth, cycles, scrollHeight: currentHeight });
            heartbeatLifecycle(this.lifecycleTraceId, Math.min(0.95, cycles / 10), {
              phase: 'maintenance',
              action: 'growth-scroll',
              scrollHeight: currentHeight,
              growth,
              cycles
            });
          } else if (Date.now() - lastGrowthTs >= this.config.idleThreshold) {
            cleanup('stable');
          }

          if (Date.now() - startTime >= this.config.maxDuration) {
            cleanup('timeout');
          }
          heartbeatLifecycle(this.lifecycleTraceId, Math.min(0.95, cycles / 10), {
            phase: 'maintenance-watch',
            scrollHeight: currentHeight,
            growth,
            cycles
          });
        }, this.config.checkInterval);
      });
    }

    async scroll(container, amount, isWindowTarget) {
      try {
        const humanoid = window.Humanoid;
        if (humanoid?.humanScroll) {
          await humanoid.humanScroll(amount, {
            style: 'maintenance',
            settle: false,
            waitForIdle: false,
            targetNode: { element: container, type: isWindowTarget ? 'window' : 'container' }
          });
          return;
        }
        if (isWindowTarget) {
          window.scrollBy({ top: amount, behavior: 'smooth' });
        } else if (typeof container.scrollBy === 'function') {
          container.scrollBy({ top: amount, behavior: 'smooth' });
        } else {
          container.scrollTop += amount;
        }
      } catch (err) {
        console.warn('[MaintenanceScroll] scroll failed', err);
      }
    }

    stop(reason = 'manual_stop') {
      if (typeof this.currentCleanup === 'function') {
        this.currentCleanup(reason);
        return;
      }
      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
      if (this.unregisterForceStop) {
        try { this.unregisterForceStop(); } catch (_) {}
        this.unregisterForceStop = null;
      }
      if (this.lifecycleTraceId) {
        stopLifecycleTrace(this.lifecycleTraceId, {
          status: reason === 'background-force-stop' ? 'forced' : 'stopped',
          reason
        });
        this.lifecycleTraceId = null;
      }
      this.enabled = false;
    }
  }

  class UniversalCompletionCriteria {
    constructor(customConfig = {}) {
      const defaults = {
        mutationIdle: 1500,
        scrollStable: 2000,
        contentStable: 1500,
        completionSignalEnabled: true,
        copyButtonSignalEnabled: true
      };
      this.config = Object.assign({}, defaults, customConfig);
      this.criteria = {
        mutationIdle: { threshold: this.config.mutationIdle, met: false },
        scrollStable: { threshold: this.config.scrollStable, met: false },
        typingGone: { met: false },
        sentinelVisible: { met: false },
        contentStable: { threshold: this.config.contentStable, met: false },
        completionSignal: { enabled: this.config.completionSignalEnabled !== false, met: false },
        copyButtonVisible: { enabled: this.config.copyButtonSignalEnabled !== false, met: false }
      };
    }

    reset() {
      Object.keys(this.criteria).forEach((key) => {
        if (typeof this.criteria[key].met !== 'undefined') {
          this.criteria[key].met = false;
        }
      });
    }

    mark(name, met = true) {
      if (this.criteria[name]) {
        this.criteria[name].met = met;
      }
    }

    metCount() {
      return Object.values(this.criteria).filter((c) => c.met && (c.enabled !== false)).length;
    }

    getPriorityScore() {
      const total = Object.values(this.criteria).filter((c) => c.enabled !== false).length || 1;
      if (this.criteria.typingGone.met) return 1;
      return this.metCount() / total;
    }
  }

  class ComprehensiveTelemetry {
    constructor() {
      this.traceId = this.generateTraceId();
      this.events = [];
    }

    logPhase(phaseName, data = {}) {
      const event = {
        traceId: this.traceId,
        timestamp: Date.now(),
        phase: phaseName,
        ...data
      };
      this.events.push(event);
      try {
        chrome.runtime?.sendMessage?.({ type: 'TELEMETRY_EVENT', event });
      } catch (err) {
        console.warn('[Telemetry] sendMessage failed', err);
      }
    }

    generateReport() {
      if (!this.events.length) {
        return { traceId: this.traceId, totalDuration: 0, phases: [] };
      }
      return {
        traceId: this.traceId,
        totalDuration: this.events[this.events.length - 1].timestamp - this.events[0].timestamp,
        phases: this.groupByPhase(),
        completionReason: this.getCompletionReason(),
        retryCount: this.getRetryCount(),
        confidence: this.getConfidenceScore()
      };
    }

    groupByPhase() {
      return this.events.reduce((acc, event) => {
        acc[event.phase] = acc[event.phase] || [];
        acc[event.phase].push(event);
        return acc;
      }, {});
    }

    getCompletionReason() {
      const reasons = [
        'typing-gone',
        'stable-text',
        'scroll-plateau',
        'sentinel-visible',
        'mutation-idle',
        'soft-timeout',
        'hard-timeout',
        'error'
      ];
      for (const reason of reasons) {
        if (this.hasReason(reason)) return reason;
      }
      return 'unknown';
    }

    hasReason(reason) {
      return this.events.some((event) => event.reason === reason);
    }

    getRetryCount() {
      return this.events.filter((event) => event.type === 'retry').length;
    }

    getConfidenceScore() {
      const reason = this.getCompletionReason();
      const mapping = {
        'typing-gone': 1,
        'stable-text': 0.9,
        'scroll-plateau': 0.8,
        'sentinel-visible': 0.75,
        'mutation-idle': 0.7,
        'soft-timeout': 0.5,
        'hard-timeout': 0.3,
        error: 0.2,
        unknown: 0.4
      };
      return mapping[reason] ?? 0.4;
    }

    generateTraceId() {
      return `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }
  }

  class PerplexityStabilization {
    constructor() {
      this.lastTextContent = '';
      this.stableChecks = 0;
      this.requiredStableChecks = 3;
    }

    async waitForStabilization(element) {
      return new Promise((resolve) => {
        const callback = () => {
          const currentText = element.textContent || '';
          if (currentText === this.lastTextContent) {
            this.stableChecks += 1;
            if (this.stableChecks >= this.requiredStableChecks) {
              stopObserve();
              resolve({ stable: true, text: currentText });
            }
          } else {
            this.stableChecks = 0;
            this.lastTextContent = currentText;
          }
        };

        const stopObserve = window.ContentUtils?.observeMutations
          ? window.ContentUtils.observeMutations(element, { characterData: true, subtree: true, childList: false }, callback)
          : (() => () => {})();
      });
    }
  }

  try {
    chrome.runtime?.onMessage?.addListener((message) => {
      if (message?.type === 'FORCE_HARD_STOP_RESTORE') {
        if (typeof window.ContentUtils?.isStopCommandCurrent === 'function'
            && !window.ContentUtils.isStopCommandCurrent(message)) return false;
        window.__LLMScrollHardStop = true;
        if (window.__ScrollGatekeeper) {
          window.__ScrollGatekeeper.engageHardStop();
        }
      }
    });
  } catch (_) {}

  window.UnifiedPipelineModules = {
    ScrollCoordinator,
    AdaptiveTimeoutManager,
    coordinationModes,
    selectMode,
    IntelligentRetryManager,
    ContinuousHumanActivity,
    HumanSessionController,
    MaintenanceScroll,
    UniversalCompletionCriteria,
    ComprehensiveTelemetry,
    PerplexityStabilization
  };
})();
